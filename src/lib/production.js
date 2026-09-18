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

const PRODUCING = new Set(['sent', 'manufacturing'])
const norm = (s) => (s || '').toString().trim().toLowerCase()

const isLive = (o) => o && !o.deleted_at && !o.purged_at

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
      name: o.order_name || o.factory,
      status: o.status,
      factory: o.factory,
      expectedArrival: o.expected_arrival || null,
      isLate: !!delay?.isLate,
      daysLate: delay?.daysLate || 0,
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
