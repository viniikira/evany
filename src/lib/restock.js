// src/lib/restock.js
// v13.75 — O RADAR DA LOJA: o que está vendendo, o que está acabando e o que
// já vem vindo — pra decidir QUANTO pedir em vez de repetir o último pedido.
//
// Até aqui a sugestão de quantidade olhava só o histórico de pedidos (média do
// que ela já pediu). Isso repete o passado: se um modelo encalhou, ele continua
// sendo sugerido; se estourou em vendas e zerou, ninguém avisa.
//
// Com o cache da Shopify recuperado (v13.74) dá pra cruzar as três pontas:
//   VENDE (loja) · TEM (estoque) · VEM (pedidos ativos + trânsito)
// Exemplos reais de 20/09/2026:
//   VERONA  → vendeu 32 em 6 meses, estoque 0, nada pedido  → ruptura invisível
//   CASSANDRA → 1,76/dia, estoque 4 (2 dias), 800 chegando em nov → fura 3 meses
//   ANDIRA  → 209 dias de estoque parado → não pedir
//
// Regra de ouro: nada aqui inventa número sozinho. Sem venda registrada, a
// sugestão é null e a tela cai no histórico (orderIntelligence).

import { shopifyCoverageDays } from './shopifySlim'
import { parseDateLocal } from './utils'

const IN_FLIGHT = new Set(['sent', 'manufacturing', 'in_transit'])
const DAY = 86400000

// Normaliza pra comparar nome de modelo com título da loja:
// "VITÓRIA" → "vitoria", "CAROLINA - 2" → "carolina 2"
export const normName = (s) => (s || '')
  .toString()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const normSku = (s) => (s || '').toString().trim().toUpperCase()

// O nome aparece como PALAVRA INTEIRA no título? ("carol" não casa com
// "carolina", senão as vendas da CAROLINA iam parar na CAROL)
function titleHasName(titleNorm, nameNorm) {
  if (!titleNorm || !nameNorm) return false
  return new RegExp(`(^|\\s)${nameNorm.replace(/\s+/g, '\\s+')}(\\s|$)`).test(titleNorm)
}

/**
 * Índice da loja: estoque por SKU/título e vendas no período coberto pelo cache.
 * @returns {{coverageDays, bySku: Map, titles: Array<{title, titleNorm, skus, stock, sold}>}}
 */
export function buildStoreIndex(shopifyCache, { now = Date.now() } = {}) {
  const coverageDays = shopifyCoverageDays(shopifyCache?.orders, now)

  const soldBySku = new Map()
  for (const o of (shopifyCache?.orders || [])) {
    for (const li of (o?.line_items || [])) {
      const sku = normSku(li?.sku)
      if (!sku) continue
      soldBySku.set(sku, (soldBySku.get(sku) || 0) + (Number(li.quantity) || 0))
    }
  }

  const bySku = new Map()
  const titles = []
  for (const p of (shopifyCache?.products || [])) {
    const title = p?.title || ''
    const entry = { title, titleNorm: normName(title), skus: [], stock: 0, sold: 0 }
    for (const v of (p?.variants || [])) {
      const sku = normSku(v?.sku)
      const stock = Number(v?.inventory_quantity) || 0
      const sold = sku ? (soldBySku.get(sku) || 0) : 0
      if (sku) {
        bySku.set(sku, { stock, sold, title })
        entry.skus.push(sku)
      }
      entry.stock += stock
      entry.sold += sold
    }
    titles.push(entry)
  }
  return { coverageDays, bySku, titles }
}

/**
 * Liga um produto do sistema à loja. Prioridade:
 *   1. SKUs cadastrados nas cores (ligação explícita, sempre vence)
 *   2. nome do modelo como palavra inteira no título — e o título fica com o
 *      nome MAIS LONGO que casar (senão "CAROL" rouba as vendas de "CAROLINA")
 * @returns {{matchedBy:'sku'|'title'|null, stock, sold, perDay, titles:Array<string>}}
 */
export function storeSignalForProduct(product, storeIndex, allProducts = []) {
  const idx = storeIndex || { bySku: new Map(), titles: [], coverageDays: 0 }
  const per = (sold) => (idx.coverageDays > 0 ? sold / idx.coverageDays : 0)

  const skus = (product?.color_variants || []).map(cv => normSku(cv?.sku)).filter(Boolean)
  const hits = skus.map(s => idx.bySku.get(s)).filter(Boolean)
  if (hits.length > 0) {
    const stock = hits.reduce((a, h) => a + h.stock, 0)
    const sold = hits.reduce((a, h) => a + h.sold, 0)
    return { matchedBy: 'sku', stock, sold, perDay: per(sold), titles: [...new Set(hits.map(h => h.title))] }
  }

  const nameNorm = normName(product?.name)
  if (!nameNorm) return { matchedBy: null, stock: 0, sold: 0, perDay: 0, titles: [] }
  // Outros nomes de modelo que contêm este (CAROL ⊂ CAROLINA)
  const longerNames = (allProducts || [])
    .map(p => normName(p?.name))
    .filter(n => n && n !== nameNorm && n.includes(nameNorm))

  const matched = idx.titles.filter(t => {
    if (!titleHasName(t.titleNorm, nameNorm)) return false
    return !longerNames.some(ln => titleHasName(t.titleNorm, ln))
  })
  if (matched.length === 0) return { matchedBy: null, stock: 0, sold: 0, perDay: 0, titles: [] }

  const stock = matched.reduce((a, t) => a + t.stock, 0)
  const sold = matched.reduce((a, t) => a + t.sold, 0)
  return { matchedBy: 'title', stock, sold, perDay: per(sold), titles: matched.map(t => t.title) }
}

/** Peças já a caminho de um produto (pedidos em revisão/fabricação/trânsito). */
export function inFlightForProduct(productId, orders = [], { excludeOrderId, now = Date.now() } = {}) {
  let qty = 0
  let nextArrival = null
  const list = []
  for (const o of orders || []) {
    if (!o || o.deleted_at || o.purged_at) continue
    if (!IN_FLIGHT.has(o.status)) continue
    if (excludeOrderId && o.id === excludeOrderId) continue
    let q = 0
    for (const it of (o.items || [])) {
      if (it.product_id !== productId) continue
      q += (it.colors || []).reduce((a, c) => a + (Number(c.qty) || 0), 0)
    }
    if (q <= 0) continue
    qty += q
    const t = parseDateLocal(o.expected_arrival)?.getTime() ?? null
    if (t != null && t >= now && (nextArrival == null || t < nextArrival)) nextArrival = t
    list.push({ id: o.id, name: o.order_name || o.factory, status: o.status, qty, expectedArrival: o.expected_arrival || null })
  }
  return {
    qty,
    orders: list,
    daysToNextArrival: nextArrival != null ? Math.ceil((nextArrival - now) / DAY) : null,
  }
}

/** Peças a caminho por COR (normalizada) de um produto. */
export function inFlightByColor(productId, orders = [], { excludeOrderId } = {}) {
  const map = new Map()
  for (const o of orders || []) {
    if (!o || o.deleted_at || o.purged_at || !IN_FLIGHT.has(o.status)) continue
    if (excludeOrderId && o.id === excludeOrderId) continue
    for (const it of (o.items || [])) {
      if (it.product_id !== productId) continue
      for (const c of (it.colors || [])) {
        const k = normName(c?.code)
        if (!k) continue
        map.set(k, (map.get(k) || 0) + (Number(c.qty) || 0))
      }
    }
  }
  return map
}

/**
 * Sinal de uma COR específica (quando ela tem SKU ligado à loja).
 * É onde a dona digita o número, então é onde a sugestão mais importa.
 * @returns {{stock, sold, perDay, inFlightQty, coverDays, suggestedQty}|null}
 */
export function restockForColor(product, colorCode, {
  storeIndex, orders = [], leadDays = DEFAULT_LEAD_DAYS,
  targetCoverDays = DEFAULT_TARGET_COVER_DAYS, excludeOrderId = null,
} = {}) {
  const cv = (product?.color_variants || []).find(v => normName(v?.code) === normName(colorCode))
  const sku = (cv?.sku || '').toString().trim().toUpperCase()
  const hit = sku ? storeIndex?.bySku?.get(sku) : null
  if (!hit) return null
  const perDay = storeIndex.coverageDays > 0 ? hit.sold / storeIndex.coverageDays : 0
  const inFlightQty = inFlightByColor(product.id, orders, { excludeOrderId }).get(normName(colorCode)) || 0
  const need = perDay * (leadDays + targetCoverDays) - hit.stock - inFlightQty
  return {
    stock: hit.stock,
    sold: hit.sold,
    perDay,
    inFlightQty,
    coverDays: perDay > 0 ? Math.round(hit.stock / perDay) : null,
    suggestedQty: perDay > 0 ? (need > 0 ? Math.ceil(need / 5) * 5 : 0) : null,
  }
}

export const DEFAULT_TARGET_COVER_DAYS = 90   // quanto tempo de venda o pedido deve cobrir
export const DEFAULT_LEAD_DAYS = 120          // quando a fábrica não tem histórico

/**
 * Situação de um modelo e QUANTO pedir.
 *
 * Conta (explicada na tela, sem caixa-preta):
 *   precisa = venda/dia × (prazo da fábrica + cobertura desejada) − estoque − o que já vem
 *
 * @returns {{status, perDay, stock, inFlightQty, coverDays, coverWithIncomingDays,
 *            leadDays, horizonDays, suggestedQty, explanation}}
 */
export function restockForProduct(product, {
  orders = [],
  storeIndex,
  allProducts = [],
  leadTimeByFactory = new Map(),
  factory = null,
  targetCoverDays = DEFAULT_TARGET_COVER_DAYS,
  excludeOrderId = null,
  now = Date.now(),
} = {}) {
  const store = storeSignalForProduct(product, storeIndex, allProducts)
  const flight = inFlightForProduct(product?.id, orders, { excludeOrderId, now })
  const lead = leadTimeByFactory.get(factory || product?.factory)
  const leadDays = lead?.avgDays || DEFAULT_LEAD_DAYS
  const horizonDays = leadDays + targetCoverDays

  const perDay = store.perDay
  const coverDays = perDay > 0 ? Math.round(store.stock / perDay) : null
  const coverWithIncomingDays = perDay > 0 ? Math.round((store.stock + flight.qty) / perDay) : null

  let status = 'sem_dados'
  if (perDay > 0) {
    if (store.stock <= 0) status = 'ruptura'
    else if (coverDays < leadDays / 4) status = 'critico'
    else if (coverWithIncomingDays > 365) status = 'excesso'
    else status = 'ok'
  } else if (store.stock > 0) {
    status = 'parado'   // tem estoque e não vendeu nada no período
  }

  let suggestedQty = null
  if (perDay > 0) {
    const need = perDay * horizonDays - store.stock - flight.qty
    suggestedQty = need > 0 ? Math.ceil(need / 5) * 5 : 0
  }

  const explanation = perDay > 0
    ? `Vende ${perDay >= 1 ? perDay.toFixed(1) : perDay.toFixed(2)}/dia · estoque ${store.stock}` +
      (flight.qty > 0 ? ` + ${flight.qty} vindo` : '') +
      ` · cobrir ${leadDays}d de fábrica + ${targetCoverDays}d de venda`
    : 'Sem venda registrada no período — a sugestão vem do histórico de pedidos'

  return {
    status,
    matchedBy: store.matchedBy,
    sold: store.sold,
    perDay,
    stock: store.stock,
    storeTitles: store.titles,
    inFlightQty: flight.qty,
    inFlightOrders: flight.orders,
    daysToNextArrival: flight.daysToNextArrival,
    coverDays,
    coverWithIncomingDays,
    leadDays,
    horizonDays,
    suggestedQty,
    explanation,
  }
}

const RANK = { ruptura: 0, critico: 1, ok: 2, sem_dados: 3, parado: 4, excesso: 5 }

/**
 * Radar de todos os modelos, pra abrir o criador já sabendo por onde começar.
 * @returns {{all, urgent, byProduct: Map, storeIndex}}
 */
export function buildRestockView({
  products = [],
  orders = [],
  shopifyCache = null,
  leadTimeByFactory = new Map(),
  factory = null,
  targetCoverDays = DEFAULT_TARGET_COVER_DAYS,
  excludeOrderId = null,
  now = Date.now(),
} = {}) {
  const storeIndex = buildStoreIndex(shopifyCache, { now })
  const all = []
  const byProduct = new Map()
  for (const p of products) {
    if (!p || p.status === 'discontinued') continue
    const r = restockForProduct(p, {
      orders, storeIndex, allProducts: products, leadTimeByFactory,
      factory: factory || p.factory, targetCoverDays, excludeOrderId, now,
    })
    const row = { product: p, ...r }
    all.push(row)
    byProduct.set(p.id, row)
  }
  all.sort((a, b) =>
    (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) ||
    b.perDay - a.perDay ||
    (a.product.name || '').localeCompare(b.product.name || '')
  )
  // "Repor primeiro": vende, está acabando e o que vem não resolve
  const urgent = all.filter(r =>
    (r.status === 'ruptura' || r.status === 'critico') && (r.suggestedQty || 0) > 0
  )
  return { all, urgent, byProduct, storeIndex, coverageDays: storeIndex.coverageDays }
}
