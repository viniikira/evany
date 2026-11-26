// src/lib/orderIntelligence.js
// v13.50 — Inteligência de criação de pedido (Fase 1: apoio à decisão).
//
// Funções puras que extraem "sugestões" do histórico de pedidos que já existe,
// pra ajudar na hora de criar: quanto pedir de cada combinação, quais cores o
// modelo costuma levar, se já tem algo daquele modelo a caminho, e sinal de
// preço. Nada disso persiste — é só leitura do histórico.

import { buildProductPriceHistory, computePriceStats, computePriceTrend } from './priceHistory'
import { parseDateLocal } from './utils'

const norm = (s) => (s || '').toString().trim().toLowerCase()
// v13.80 — sugestão de quantidade sempre de 5 em 5 (ninguém pede 33 peças)
const to5 = (n) => (n > 0 ? Math.max(5, Math.round(n / 5) * 5) : 0)

// Pedidos que contam como "demanda histórica" (já foram de fato encomendados).
// Rascunho não conta (ainda não é pedido); lixeira/purga também não.
const HISTORICAL = new Set(['sent', 'manufacturing', 'in_transit', 'completed'])
// Pedidos ainda "em aberto" a caminho — usados pra avisar de reencomenda.
const IN_FLIGHT = new Set(['sent', 'manufacturing', 'in_transit'])

const isCounted = (o) => o && !o.deleted_at && !o.purged_at

/**
 * Quantidade sugerida pra um modelo+cor, a partir da média histórica.
 * @returns {{avg:number, last:number, count:number}|null}
 */
export function suggestQuantity(productId, colorCode, orders = []) {
  if (!productId || !colorCode) return null
  const key = norm(colorCode)
  const qtys = []
  let lastQty = null
  let lastTime = -Infinity
  for (const o of orders) {
    if (!isCounted(o) || !HISTORICAL.has(o.status)) continue
    const t = parseDateLocal(o.order_date || o.created_at)?.getTime() ?? -Infinity
    for (const it of (o.items || [])) {
      if (it.product_id !== productId) continue
      for (const c of (it.colors || [])) {
        if (norm(c.code) !== key) continue
        const q = Number(c.qty || 0)
        if (q <= 0) continue
        qtys.push(q)
        if (!isNaN(t) && t >= lastTime) { lastTime = t; lastQty = q }
      }
    }
  }
  if (!qtys.length) return null
  return {
    avg: to5(qtys.reduce((a, b) => a + b, 0) / qtys.length),
    last: lastQty,
    count: qtys.length,
  }
}

/**
 * Cores que o modelo costuma ser pedido, ranqueadas por frequência.
 * @returns {Array<{code, count, totalQty, avgQty, lastOrderedAt}>}
 */
export function suggestColorsForModel(productId, orders = []) {
  if (!productId) return []
  const map = new Map()
  for (const o of orders) {
    if (!isCounted(o) || !HISTORICAL.has(o.status)) continue
    const t = parseDateLocal(o.order_date || o.created_at)?.getTime() ?? -Infinity
    for (const it of (o.items || [])) {
      if (it.product_id !== productId) continue
      for (const c of (it.colors || [])) {
        const q = Number(c.qty || 0)
        if (!c.code || q <= 0) continue
        const k = norm(c.code)
        const cur = map.get(k) || { code: c.code, count: 0, totalQty: 0, lastTime: -Infinity }
        cur.count += 1
        cur.totalQty += q
        if (!isNaN(t) && t > cur.lastTime) cur.lastTime = t
        map.set(k, cur)
      }
    }
  }
  return [...map.values()]
    .map(x => ({
      code: x.code,
      count: x.count,
      totalQty: x.totalQty,
      avgQty: to5(x.totalQty / x.count),
      lastOrderedAt: x.lastTime > -Infinity ? new Date(x.lastTime).toISOString() : null,
    }))
    .sort((a, b) => b.count - a.count || b.totalQty - a.totalQty)
}

/**
 * Pedidos ainda a caminho (sent/manufacturing/in_transit) que já contêm o modelo.
 * Serve pra avisar "você já tem isso vindo" antes de reencomendar.
 * @returns {Array<{orderId, orderName, status, expectedArrival, colors:Array<{code,qty}>}>}
 */
export function inFlightForModel(productId, orders = [], { excludeOrderId } = {}) {
  if (!productId) return []
  const out = []
  for (const o of orders) {
    if (!isCounted(o) || !IN_FLIGHT.has(o.status)) continue
    if (excludeOrderId && o.id === excludeOrderId) continue
    const item = (o.items || []).find(it => it.product_id === productId)
    if (!item) continue
    out.push({
      orderId: o.id,
      orderName: o.order_name || o.factory,
      status: o.status,
      expectedArrival: o.expected_arrival || null,
      colors: (item.colors || []).filter(c => Number(c.qty || 0) > 0).map(c => ({ code: c.code, qty: Number(c.qty || 0) })),
    })
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════
// v13.86 — NÃO PEDIR REPETIDO
// Ela pediu: "ao escolher um produto, já falar que tem esse produto em tais
// cores sendo fabricado em tal pedido — pra eu não misturar".
// Diferente do inFlightForModel (só a caminho), aqui entram TAMBÉM os
// rascunhos (ela tem vários rascunhos abertos ao mesmo tempo e é aí que a
// repetição acontece) e a resposta vem POR COR.
// ═══════════════════════════════════════════════════════════════════

// Rascunho conta (pode virar pedido); concluído não (já chegou)
const OPEN = new Set(['draft', 'sent', 'manufacturing', 'in_transit'])
// Mesma cor escrita de jeitos diferentes: "TT2/CARMEL" = "TT2-CARMEL", "1b" = "1B"
export const colorKey = (c) => norm(c).replace(/[\s/_-]+/g, '')

/**
 * Onde um modelo já está em pedidos abertos, cor por cor.
 * @returns {{orders: Array<{orderId, orderName, status, isDraft, expectedArrival, pieces, colors:Array<{code,qty}>}>,
 *            byColor: Map<string, Array<{orderId, orderName, status, isDraft, qty, expectedArrival}>>,
 *            pieces:number}}
 */
export function openOrdersForModel(productId, orders = [], { excludeOrderId } = {}) {
  const out = { orders: [], byColor: new Map(), pieces: 0 }
  if (!productId) return out
  for (const o of orders || []) {
    if (!isCounted(o) || !OPEN.has(o.status)) continue
    if (excludeOrderId && o.id === excludeOrderId) continue
    const items = (o.items || []).filter(it => it.product_id === productId)
    if (items.length === 0) continue
    const colors = new Map()
    for (const it of items) {
      for (const c of (it.colors || [])) {
        const q = Number(c.qty || 0)
        if (!c.code || q <= 0) continue
        const k = colorKey(c.code)
        const cur = colors.get(k) || { code: c.code, qty: 0 }
        cur.qty += q
        colors.set(k, cur)
      }
    }
    if (colors.size === 0) continue
    const entry = {
      orderId: o.id,
      orderName: o.order_name || `${o.factory} (sem nome)`,
      status: o.status,
      isDraft: o.status === 'draft',
      expectedArrival: o.expected_arrival || null,
      colors: [...colors.values()],
      pieces: [...colors.values()].reduce((a, c) => a + c.qty, 0),
    }
    out.orders.push(entry)
    out.pieces += entry.pieces
    for (const [k, c] of colors) {
      if (!out.byColor.has(k)) out.byColor.set(k, [])
      out.byColor.get(k).push({ orderId: o.id, orderName: entry.orderName, status: o.status, isDraft: entry.isDraft, qty: c.qty, expectedArrival: entry.expectedArrival })
    }
  }
  // a caminho primeiro (mais adiantado), rascunho por último
  const rank = { in_transit: 0, manufacturing: 1, sent: 2, draft: 3 }
  out.orders.sort((a, b) => rank[a.status] - rank[b.status])
  return out
}

/**
 * Combinações (modelo + cor) do pedido que está sendo montado que JÁ estão em
 * outro pedido aberto. Pra revisão: "atenção, isso aqui é repetido".
 * @returns Array<{itemId, productId, colorIndex, code, qty, others: Array<{orderName,status,isDraft,qty}>}>
 */
export function findRepeatedLines(items = [], orders = [], { excludeOrderId } = {}) {
  const cache = new Map()
  const out = []
  for (const it of items || []) {
    if (!it.product_id) continue
    if (!cache.has(it.product_id)) cache.set(it.product_id, openOrdersForModel(it.product_id, orders, { excludeOrderId }))
    const open = cache.get(it.product_id)
    ;(it.colors || []).forEach((c, idx) => {
      if (!c.code || !(Number(c.qty) > 0)) return
      const others = open.byColor.get(colorKey(c.code))
      if (others && others.length) out.push({ itemId: it.id, productId: it.product_id, colorIndex: idx, code: c.code, qty: Number(c.qty), others })
    })
  }
  return out
}

/**
 * Sinal de preço do modelo (reusa priceHistory).
 * @returns {{lastPrice, count, trend, changePct, hasIncreaseAlert, lastIncreasePct}|null}
 */
export function priceSignalForModel(productId, orders = []) {
  const hist = buildProductPriceHistory(productId, orders)
  if (!hist.length) return null
  const stats = computePriceStats(hist)
  return {
    lastPrice: stats.last?.priceUsd ?? null,
    count: stats.count,
    trend: computePriceTrend(hist),
    changePct: stats.changePct,
    hasIncreaseAlert: stats.hasIncreaseAlert,
    lastIncreasePct: stats.lastIncreasePct,
  }
}
