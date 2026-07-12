// src/lib/priceHistory.js
// v13.33 — Histórico de preço por produto
//
// Extrai série temporal de price_usd_snapshot dos pedidos (já existe nos dados).
// Calcula tendência, variação, alerta de aumento.

/**
 * Constrói histórico de preços de um produto a partir dos pedidos existentes.
 * 
 * @param {string} productId - ID do produto
 * @param {Array} orders - lista de pedidos (com items + price_usd_snapshot)
 * @returns {Array} pontos { date, priceUsd, orderName, factory, source } ordenados cronologicamente
 */
export function buildProductPriceHistory(productId, orders = []) {
  if (!productId) return []
  const points = []
  
  for (const o of orders) {
    if (o.status === 'cancelled' || o.purged_at) continue
    if (!o.created_at) continue
    
    for (const it of (o.items || [])) {
      if (it.product_id !== productId) continue
      
      // Coleta de preços: snapshot do item + snapshots por cor (se diferentes)
      const itemPrice = parseNum(it.price_usd_snapshot)
      const colors = it.colors || []
      
      // Se cores têm preços próprios, registra cada um
      let registeredColorPrices = false
      for (const c of colors) {
        const colorPrice = parseNum(c.price_usd)
        if (colorPrice != null && colorPrice !== itemPrice) {
          points.push({
            date: o.created_at,
            priceUsd: colorPrice,
            orderName: o.order_name || o.factory,
            orderId: o.id,
            factory: o.factory,
            colorCode: c.code,
            source: 'color',
          })
          registeredColorPrices = true
        }
      }
      
      // Se não teve preço por cor (ou todos iguais ao item), registra preço do item
      if (!registeredColorPrices && itemPrice != null) {
        points.push({
          date: o.created_at,
          priceUsd: itemPrice,
          orderName: o.order_name || o.factory,
          orderId: o.id,
          factory: o.factory,
          colorCode: null,
          source: 'item',
        })
      }
    }
  }
  
  // Ordena cronologicamente
  return points.sort((a, b) => new Date(a.date) - new Date(b.date))
}

function parseNum(v) {
  if (v == null || v === '') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

/**
 * Calcula estatísticas resumidas do histórico
 */
export function computePriceStats(history) {
  if (!history || history.length === 0) {
    return {
      count: 0,
      first: null,
      last: null,
      min: null,
      max: null,
      avg: null,
      changePct: null,
      hasIncreaseAlert: false,
    }
  }
  
  const prices = history.map(p => p.priceUsd)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const sum = prices.reduce((a, b) => a + b, 0)
  const avg = sum / prices.length
  const first = history[0]
  const last = history[history.length - 1]
  
  // Variação do primeiro pro último (% de mudança total no período)
  // Com 1 ponto só, não faz sentido calcular variação → null
  const changePct = (history.length >= 2 && first.priceUsd > 0)
    ? ((last.priceUsd - first.priceUsd) / first.priceUsd) * 100
    : null
  
  // Alerta: se ÚLTIMO preço subiu >15% vs o PENÚLTIMO
  let hasIncreaseAlert = false
  let lastIncreasePct = null
  if (history.length >= 2) {
    const prev = history[history.length - 2]
    if (prev.priceUsd > 0) {
      lastIncreasePct = ((last.priceUsd - prev.priceUsd) / prev.priceUsd) * 100
      hasIncreaseAlert = lastIncreasePct > 15
    }
  }
  
  return {
    count: history.length,
    first,
    last,
    min,
    max,
    avg,
    changePct,
    hasIncreaseAlert,
    lastIncreasePct,
  }
}

/**
 * Determina tendência geral (subindo, descendo, estável)
 */
export function computePriceTrend(history) {
  if (history.length < 2) return 'no_data'
  const stats = computePriceStats(history)
  if (stats.changePct == null) return 'no_data'
  if (stats.changePct > 5) return 'up'
  if (stats.changePct < -5) return 'down'
  return 'stable'
}
