// src/lib/production.js
// v13.73 — O que está sendo fabricado, derivado dos PEDIDOS.
//
// Até a v13.72 a página Produção listava as cores marcadas com a etiqueta
// "em produção" no cadastro do produto (color_variants.status) e só usava os
// pedidos pra somar quantidades. Com os dados reais de 18/09/2026 isso dava:
//   - 1.385 peças INVISÍVEIS (tela mostrava 3.400, os pedidos somavam 4.785):
//     reposição de cor que já está no catálogo (o caso mais comum — ela
//     reencomenda as mesmas cores), cor que não foi cadastrada no produto e
//     cor ainda marcada como ideia simplesmente não apareciam
//   - 18 alarmes FALSOS "sem pedido — considere encomendar ou tirar de
//     produção": eram as cores do NOVEMBRO 2025, que já está no navio
//   - peças agrupadas na fábrica do CADASTRO do produto, não na fábrica do
//     pedido (as 2.600 da HAIR FORTUNE apareciam somadas na HAIRCHUAN)
//
// Regra nova: peça em produção = linha de pedido ativo (em revisão ou em
// fabricação), agrupada pela fábrica DO PEDIDO. A etiqueta do cadastro só
// serve pra achar o que está marcado e não tem pedido nenhum — e se a cor
// está num pedido em trânsito, não é alarme: ela está a caminho.

import { computeFactoryLeadTime, computeOrderDelay } from './pendencias'
import { parseDateLocal } from './utils'
import { colorKey } from './orderIntelligence'

const PRODUCING = new Set(['sent', 'manufacturing'])
const DAY = 86400000
// Quando o pedido ainda não tem previsão de chegada, estimamos pelo fim da
// fabricação + este frete. É uma estimativa e a tela diz que é.
export const SHIPPING_DAYS_ESTIMATE = 30
const norm = (s) => (s || '').toString().trim().toLowerCase()

const isLive = (o) => o && !o.deleted_at && !o.purged_at

// v13.76 — quantos dias até chegar: a previsão quando existe; senão o fim da
// fabricação (prazo − dias corridos) + frete estimado.
function etaOf(order, delay, today) {
  const t = parseDateLocal(order?.expected_arrival)?.getTime()
  if (t != null) return { etaDays: Math.ceil((t - today) / DAY), etaEstimated: false }
  if (delay?.deadlineDays != null) {
    const left = Math.max(0, delay.deadlineDays - delay.daysElapsed)
    return { etaDays: left + SHIPPING_DAYS_ESTIMATE, etaEstimated: true }
  }
  return { etaDays: null, etaEstimated: false }
}

// Chegada mais próxima de uma lista de pedidos (a que resolve primeiro)
export function soonestEta(orderInfos = []) {
  let best = null
  for (const o of orderInfos) {
    if (o?.etaDays == null) continue
    if (!best || o.etaDays < best.etaDays) best = { etaDays: o.etaDays, etaEstimated: o.etaEstimated, orderName: o.name }
  }
  return best
}

function startOfToday(now) {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Chave do "produto" de uma linha: o cadastro quando existe, senão o nome
// digitado (itens manuais / ideias ainda sem produto).
function productOf(item, order, productsById) {
  const prod = item.product_id ? productsById.get(item.product_id) : null
  if (prod) return { key: prod.id, product: prod }
  const name = item.name_manual || item.product_name_snapshot || item.idea_name_snapshot || 'Sem nome'
  return {
    key: `manual:${norm(name)}`,
    product: { id: `manual:${norm(name)}`, name, factory: order.factory, _manual: true },
  }
}

// ═══════════════════════════════════════════════════════════════════
// v13.87 — PANORAMA POR PRODUTO
// Ela pediu: "separar por produto, não por pedido nem por fábrica — Valentina:
// está sendo feita em tal; essa cor em tal; um panorama geral".
// Um cartão por modelo juntando TUDO que está vindo dele (em revisão, em
// fabricação e em trânsito), em qualquer fábrica/pedido, com a quantidade
// por cor em cada pedido.
// ═══════════════════════════════════════════════════════════════════
// v13.88 — "em revisão" NÃO é produção: o pedido ainda está sendo avaliado.
// Continua aparecendo (é o que PODE chegar), mas sempre SEPARADO: fora do
// total confirmado, da chegada prevista e do risco de faltar na loja.
export const PIPELINE_STATUS = {
  sent: { label: 'em revisão', rank: 2 },
  manufacturing: { label: 'em fabricação', rank: 1 },
  in_transit: { label: 'em trânsito', rank: 0 },
}

/**
 * @param kind 'own' (fabricação própria) | 'brand' (marcas parceiras)
 * @returns Array<{product, total, byStatus:{sent,manufacturing,in_transit}, factories:string[],
 *   orders: Array<{id,name,status,factory,expectedArrival,etaDays,etaEstimated,isLate,daysLate,qty}>,
 *   colors: Array<{code, colorData, total, byOrder: Object<orderId, qty>}>}>
 */
export function buildProductPipeline({ products = [], orders = [], colors = [], now = Date.now(), kind = 'own' } = {}) {
  const productsById = new Map(products.map(p => [p.id, p]))
  const colorsByKey = new Map(colors.map(c => [colorKey(c.code), c]))
  const lead = computeFactoryLeadTime(orders)
  const today = startOfToday(now)
  const wantBrand = kind === 'brand'
  const map = new Map()

  for (const o of orders) {
    if (!isLive(o) || !PIPELINE_STATUS[o.status]) continue
    if ((o.kind === 'brand') !== wantBrand) continue
    const delay = o.status === 'in_transit' ? null : computeOrderDelay(o, lead, now)
    const info = {
      id: o.id,
      name: o.order_name || `${o.factory} (sem nome)`,
      status: o.status,
      factory: (o.factory || '').trim() || '— sem fábrica —',
      expectedArrival: o.expected_arrival || null,
      isLate: !!delay?.isLate,
      daysLate: delay?.daysLate || 0,
      ...etaOf(o, delay, today),
    }
    for (const it of (o.items || [])) {
      const { key, product } = productOf(it, o, productsById)
      for (const c of (it.colors || [])) {
        const qty = Number(c.qty) || 0
        if (!c.code || qty <= 0) continue
        if (!map.has(key)) map.set(key, { product, total: 0, byStatus: { sent: 0, manufacturing: 0, in_transit: 0 }, orders: new Map(), colors: new Map() })
        const p = map.get(key)
        p.total += qty
        p.byStatus[o.status] += qty
        if (!p.orders.has(o.id)) p.orders.set(o.id, { ...info, qty: 0 })
        p.orders.get(o.id).qty += qty
        const ck = colorKey(c.code)
        if (!p.colors.has(ck)) {
          const cv = (product.color_variants || []).find(v => colorKey(v.code) === ck)
          p.colors.set(ck, { code: (cv?.code || colorsByKey.get(ck)?.code || c.code).trim(), colorData: colorsByKey.get(ck) || null, total: 0, byOrder: {} })
        }
        const col = p.colors.get(ck)
        col.total += qty
        col.byOrder[o.id] = (col.byOrder[o.id] || 0) + qty
      }
    }
  }

  return [...map.values()].map(p => {
    const ords = [...p.orders.values()].sort((a, b) =>
      PIPELINE_STATUS[a.status].rank - PIPELINE_STATUS[b.status].rank || (a.etaDays ?? 1e9) - (b.etaDays ?? 1e9))
    const confirmed = ords.filter(o => o.status !== 'sent')
    const reviewOrders = ords.filter(o => o.status === 'sent')
    const review = p.byStatus.sent
    const sumOf = (byOrder, list) => list.reduce((a, o) => a + (byOrder[o.id] || 0), 0)
    return {
      product: p.product,
      // total = só o CONFIRMADO (fabricação + trânsito); revisão vem à parte
      total: p.total - review,
      review,
      totalWithReview: p.total,
      onlyReview: confirmed.length === 0,
      byStatus: p.byStatus,
      factories: [...new Set(ords.map(o => o.factory))],
      orders: confirmed,
      reviewOrders,
      colors: [...p.colors.values()]
        .map(c => ({ ...c, total: sumOf(c.byOrder, confirmed), review: sumOf(c.byOrder, reviewOrders) }))
        .sort((a, b) => b.total - a.total || b.review - a.review || a.code.localeCompare(b.code)),
      nextEta: soonestEta(confirmed),
    }
  }).sort((a, b) => b.total - a.total || b.review - a.review || (a.product.name || '').localeCompare(b.product.name || ''))
}

export function buildProductionView({ products = [], orders = [], colors = [], now = Date.now() } = {}) {
  const productsById = new Map(products.map(p => [p.id, p]))
  const colorsByCode = new Map(colors.map(c => [norm(c.code), c]))
  const lead = computeFactoryLeadTime(orders)
  const today = startOfToday(now)

  // (fábrica do pedido | produto) → grupo
  const groups = new Map()
  // produto|cor que está em pedido ativo / em trânsito (pra checar as etiquetas)
  const activeKeys = new Set()
  const transitKeys = new Set()

  for (const o of orders) {
    if (!isLive(o)) continue
    if (o.status === 'in_transit') {
      for (const it of (o.items || [])) {
        if (!it.product_id) continue
        for (const c of (it.colors || [])) if (c.code) transitKeys.add(`${it.product_id}|${norm(c.code)}`)
      }
      continue
    }
    if (!PRODUCING.has(o.status)) continue

    const delay = computeOrderDelay(o, lead, now)
    const orderInfo = {
      id: o.id,
      name: o.order_name || `${o.factory} (sem nome)`,
      status: o.status,
      factory: o.factory,
      expectedArrival: o.expected_arrival || null,
      isLate: !!delay?.isLate,
      daysLate: delay?.daysLate || 0,
      ...etaOf(o, delay, today),
    }
    const factoryName = (o.factory || '').trim() || '— sem fábrica —'

    for (const it of (o.items || [])) {
      const { key: pKey, product } = productOf(it, o, productsById)
      for (const c of (it.colors || [])) {
        const qty = Number(c.qty) || 0
        if (!c.code || qty <= 0) continue
        const cKey = norm(c.code)
        if (it.product_id) activeKeys.add(`${it.product_id}|${cKey}`)

        const gKey = `${factoryName}|${pKey}`
        if (!groups.has(gKey)) groups.set(gKey, { key: gKey, factoryName, product, colorMap: new Map(), orderMap: new Map() })
        const g = groups.get(gKey)
        if (!g.colorMap.has(cKey)) {
          const cv = (product.color_variants || []).find(v => norm(v.code) === cKey)
          g.colorMap.set(cKey, {
            // Grafia do cadastro (produto > banco de cores) — pedido pode ter "1b"
            code: (cv?.code || colorsByCode.get(cKey)?.code || c.code).trim(),
            sku: cv?.sku || null,
            colorData: colorsByCode.get(cKey) || null,
            qty: 0,
            qtyReview: 0,
            hasOrder: true,
            orders: new Map(),
          })
        }
        const col = g.colorMap.get(cKey)
        col.qty += qty
        if (o.status === 'sent') col.qtyReview += qty
        col.orders.set(o.id, orderInfo)
        g.orderMap.set(o.id, orderInfo)
      }
    }
  }

  // Etiqueta "em produção" sem pedido ativo: se está no navio não é problema;
  // se não está em lugar nenhum, é etiqueta esquecida (vai pro card do produto,
  // na fábrica do cadastro, com o aviso de sempre).
  let flaggedInTransit = 0
  const orphanFlags = []
  for (const p of products) {
    for (const cv of (p.color_variants || [])) {
      if (cv.status !== 'production' || !cv.code) continue
      const k = `${p.id}|${norm(cv.code)}`
      if (activeKeys.has(k)) continue
      if (transitKeys.has(k)) { flaggedInTransit++; continue }
      orphanFlags.push({ product: p, code: cv.code.trim(), sku: cv.sku || null, colorData: colorsByCode.get(norm(cv.code)) || null })
    }
  }
  for (const f of orphanFlags) {
    // Vai pro card da fábrica do cadastro; se o modelo só está sendo feito em
    // outra fábrica, entra nesse card mesmo (não cria um card de 0 peças).
    const registered = (f.product.factory || '').trim() || '— sem fábrica —'
    const cards = [...groups.values()].filter(g => g.product.id === f.product.id)
    const factoryName = cards.some(g => g.factoryName === registered)
      ? registered
      : (cards[0]?.factoryName || registered)
    const gKey = `${factoryName}|${f.product.id}`
    if (!groups.has(gKey)) groups.set(gKey, { key: gKey, factoryName, product: f.product, colorMap: new Map(), orderMap: new Map() })
    const g = groups.get(gKey)
    const cKey = norm(f.code)
    if (!g.colorMap.has(cKey)) {
      g.colorMap.set(cKey, { code: f.code, sku: f.sku, colorData: f.colorData, qty: 0, qtyReview: 0, hasOrder: false, orders: new Map() })
    }
  }

  const finalGroups = [...groups.values()].map(g => {
    const cores = [...g.colorMap.values()]
      .map(c => ({ ...c, orders: [...c.orders.values()] }))
      // Mais peças primeiro; etiquetas sem pedido por último
      .sort((a, b) => (b.hasOrder - a.hasOrder) || (b.qty - a.qty) || a.code.localeCompare(b.code))
    return {
      key: g.key,
      factoryName: g.factoryName,
      product: g.product,
      cores,
      orders: [...g.orderMap.values()],
      totalQty: cores.reduce((s, c) => s + c.qty, 0),
      reviewQty: cores.reduce((s, c) => s + c.qtyReview, 0),
      // v13.88 — confirmado = fabricação (revisão fica à parte)
      confirmedQty: cores.reduce((s, c) => s + c.qty - c.qtyReview, 0),
      // O cadastro diz outra fábrica? (ex.: modelo da HAIRCHUAN feito na HAIR FORTUNE)
      registeredFactory: g.product._manual ? null : (g.product.factory || null),
    }
  })

  // Visão por PRODUTO (panorama): junta os cards do mesmo modelo em fábricas diferentes
  const byProduct = new Map()
  for (const g of finalGroups) {
    const id = g.product.id
    if (!byProduct.has(id)) {
      byProduct.set(id, { product: g.product, cores: [], orders: [], totalQty: 0, reviewQty: 0, factories: [] })
    }
    const m = byProduct.get(id)
    m.totalQty += g.totalQty
    m.reviewQty += g.reviewQty
    m.factories.push({ name: g.factoryName, qty: g.totalQty })
    for (const o of g.orders) if (!m.orders.some(x => x.id === o.id)) m.orders.push(o)
    for (const c of g.cores) {
      const ex = m.cores.find(x => norm(x.code) === norm(c.code))
      if (ex) {
        ex.qty += c.qty
        ex.hasOrder = ex.hasOrder || c.hasOrder
        for (const o of c.orders) if (!ex.orders.some(x => x.id === o.id)) ex.orders.push(o)
      } else {
        m.cores.push({ ...c, orders: [...c.orders] })
      }
    }
  }

  // Chegadas: próxima FUTURA + as vencidas (antes mostrava 20/05 como "próxima")
  let nextArrival = null
  const overdueArrivals = []
  for (const o of orders) {
    if (!isLive(o) || !(PRODUCING.has(o.status) || o.status === 'in_transit')) continue
    const t = parseDateLocal(o.expected_arrival)?.getTime()
    if (t == null) continue
    if (t < today) {
      overdueArrivals.push({
        id: o.id,
        name: o.order_name || o.factory,
        status: o.status,
        expectedArrival: o.expected_arrival,
        daysOverdue: Math.floor((today - t) / 86400000),
      })
    } else if (!nextArrival || t < parseDateLocal(nextArrival.expectedArrival).getTime()) {
      nextArrival = { id: o.id, name: o.order_name || o.factory, status: o.status, expectedArrival: o.expected_arrival }
    }
  }
  overdueArrivals.sort((a, b) => b.daysOverdue - a.daysOverdue)

  const totalQty = finalGroups.reduce((s, g) => s + g.totalQty, 0)
  const reviewQty = finalGroups.reduce((s, g) => s + g.reviewQty, 0)

  return {
    groups: finalGroups,
    byProduct,
    orphanFlags,
    flaggedInTransit,
    nextArrival,
    overdueArrivals,
    kpis: {
      totalQty,
      reviewQty,
      manufacturingQty: totalQty - reviewQty,
      products: byProduct.size,
      colors: finalGroups.reduce((s, g) => s + g.cores.filter(c => c.hasOrder).length, 0),
      orphanCount: orphanFlags.length,
    },
  }
}
