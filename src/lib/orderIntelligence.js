// src/lib/orderIntelligence.js
// v13.50 — Inteligência de criação de pedido (Fase 1: apoio à decisão).
//
// Funções puras que extraem "sugestões" do histórico de pedidos que já existe,
// pra ajudar na hora de criar: quanto pedir de cada combinação, quais cores o
// modelo costuma levar, se já tem algo daquele modelo a caminho, e sinal de
// preço. Nada disso persiste — é só leitura do histórico.

import { buildProductPriceHistory, computePriceStats, computePriceTrend } from './priceHistory'

const norm = (s) => (s || '').toString().trim().toLowerCase()

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
    const t = new Date(o.order_date || o.created_at).getTime()
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
    avg: Math.round(qtys.reduce((a, b) => a + b, 0) / qtys.length),
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
    const t = new Date(o.order_date || o.created_at).getTime()
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
      avgQty: Math.round(x.totalQty / x.count),
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
