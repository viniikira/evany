// src/lib/financial.js
// Cálculos financeiros centralizados — reusados pela tela Financeiro (todas as abas).
// Tudo client-side baseado em orders já em memória. Sem RPC.

// Coleta todos os pagamentos achatados, com referências do pedido.
// Retorna array { ...payment, _orderId, _factory, _orderName, _orderStatus }
export function flattenPayments(orders = []) {
  const out = []
  for (const o of orders) {
    for (const p of (o.payments || [])) {
      out.push({
        ...p,
        _orderId: o.id,
        _factory: o.factory,
        _orderName: o.order_name || o.factory,
        _orderStatus: o.status,
      })
    }
  }
  return out
}

// Filtra pagamentos por período (em dias). null/all = sem corte.
export function filterPaymentsByPeriod(payments, days) {
  if (!days) return payments
  const cutoff = Date.now() - days * 86400000
  return payments.filter(p => {
    const date = p.payment_date || p.created_at
    if (!date) return false
    const t = new Date(date).getTime()
    return !isNaN(t) && t >= cutoff
  })
}

// Câmbio médio ponderado: soma BRL / soma USD (de pagamentos com ambos)
export function computeAvgRate(payments) {
  const valid = payments.filter(p =>
    parseFloat(p.amount_usd) > 0 && parseFloat(p.amount_brl) > 0
  )
  const sumUsd = valid.reduce((a, p) => a + parseFloat(p.amount_usd), 0)
  const sumBrl = valid.reduce((a, p) => a + parseFloat(p.amount_brl), 0)
  return sumUsd > 0 ? sumBrl / sumUsd : 0
}

// Totais USD e BRL
export function computeTotals(payments) {
  return {
    usd: payments.reduce((a, p) => a + (parseFloat(p.amount_usd) || 0), 0),
    brl: payments.reduce((a, p) => a + (parseFloat(p.amount_brl) || 0), 0),
  }
}

// Comparação de câmbio: período atual vs período anterior do mesmo tamanho
export function computeRateComparison(allPayments, days) {
  if (!days) return null
  const cutoff = Date.now() - days * 86400000
  const prevCutoff = cutoff - days * 86400000
  
  const inWindow = (p, from, to) => {
    const date = p.payment_date || p.created_at
    if (!date) return false
    const t = new Date(date).getTime()
    return !isNaN(t) && t >= from && t < to
  }
  
  const currPayments = allPayments.filter(p => inWindow(p, cutoff, Date.now() + 86400000))
  const prevPayments = allPayments.filter(p => inWindow(p, prevCutoff, cutoff))
  
  const current = computeAvgRate(currPayments)
  const previous = computeAvgRate(prevPayments)
  
  if (current <= 0 || previous <= 0) return null
  return {
    current,
    previous,
    variation: ((current - previous) / previous) * 100,
  }
}

// Top N fábricas por gasto USD
export function topFactoriesByGasto(payments, limit = 5) {
  const map = new Map()
  for (const p of payments) {
    if (!p._factory) continue
    const usd = parseFloat(p.amount_usd) || 0
    if (usd <= 0) continue
    if (!map.has(p._factory)) {
      map.set(p._factory, { factory: p._factory, totalUsd: 0, totalBrl: 0, paymentsCount: 0 })
    }
    const f = map.get(p._factory)
    f.totalUsd += usd
    f.totalBrl += parseFloat(p.amount_brl) || 0
    f.paymentsCount += 1
  }
  return Array.from(map.values())
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, limit)
}

// FOB total de um pedido (respeita preço-por-cor + snapshot)
export function computeOrderFOB(order) {
  return (order.items || []).reduce((sum, it) => {
    const cls = it.colors || []
    const itemPrice = parseFloat(it.price_usd_snapshot || it.price_usd || 0)
    const fromColors = cls.reduce((b, c) => {
      const qty = Number(c.qty || 0)
      const cprice = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : itemPrice
      return b + qty * (cprice || 0)
    }, 0)
    return sum + fromColors + (cls.length === 0 ? itemPrice * Number(it.quantity || 0) : 0)
  }, 0)
}

// Pagamento total feito num pedido
export function computeOrderPaid(order) {
  return (order.payments || []).reduce((a, p) => a + (parseFloat(p.amount_usd) || 0), 0)
}

// ═══════════════════════════════════════════════════════════════════
// v13.67 — VALOR FINAL DA TRADING (o que é realmente pago)
//
// A importação passa por uma trading que devolve o valor FINAL por linha
// (FOB + impostos + frete + tudo), com multiplicador ~1,5–1,8 que varia por
// produto e por cor. Até a v13.66 todo o financeiro media a dívida contra o
// FOB — subestimando em ~60%. Agora:
//   • linha COM final informado  → valor confirmado pela trading
//   • linha SEM final            → estimativa (FOB × fator do pedido)
// A estimativa nunca se disfarça de confirmada: quem consome recebe as duas
// partes e sabe quanto do total já é real.
// ═══════════════════════════════════════════════════════════════════

const num = (v) => {
  if (v == null || v === '') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

export const DEFAULT_TRADING_FACTOR = 1.65

/**
 * Percorre as linhas (produto × cor) de um pedido resolvendo FOB e FINAL.
 * @returns {Array<{itemId, colorCode, qty, fobUnit, finalUnit, isConfirmed, fobTotal, finalTotal, multiplier}>}
 */
export function computeOrderLines(order) {
  const factor = num(order?.conversion_factor) || DEFAULT_TRADING_FACTOR
  const lines = []
  for (const it of (order?.items || [])) {
    const fobItem = num(it.price_usd_snapshot) ?? num(it.price_usd) ?? 0
    const finalItem = num(it.final_price_usd)
    const cls = it.colors || []
    const push = (colorCode, qty, cFob, cFinal) => {
      const fobUnit = cFob ?? fobItem ?? 0
      const confirmed = cFinal ?? finalItem
      const isConfirmed = confirmed != null && confirmed > 0
      const finalUnit = isConfirmed ? confirmed : (fobUnit > 0 ? fobUnit * factor : 0)
      lines.push({
        itemId: it.id,
        colorCode: colorCode || null,
        qty,
        fobUnit,
        finalUnit,
        isConfirmed,
        fobTotal: fobUnit * qty,
        finalTotal: finalUnit * qty,
        multiplier: fobUnit > 0 ? finalUnit / fobUnit : null,
      })
    }
    if (cls.length > 0) {
      for (const c of cls) {
        push(c.code, Number(c.qty || 0), num(c.price_usd), num(c.final_price_usd))
      }
    } else {
      push(null, Number(it.quantity || 0), null, null)
    }
  }
  return lines
}

/**
 * Total FINAL de um pedido — o que a Kira realmente vai pagar.
 * @returns {{total, confirmed, estimated, isFullyConfirmed, hasAnyConfirmed,
 *            linesTotal, linesConfirmed, fobTotal, multiplier}}
 */
export function computeOrderFinal(order) {
  const lines = computeOrderLines(order)
  let total = 0, confirmed = 0, estimated = 0, linesConfirmed = 0, fobTotal = 0
  for (const l of lines) {
    total += l.finalTotal
    fobTotal += l.fobTotal
    if (l.isConfirmed) { confirmed += l.finalTotal; linesConfirmed++ }
    else estimated += l.finalTotal
  }
  const withQty = lines.filter(l => l.qty > 0)
  return {
    total,
    confirmed,
    estimated,
    isFullyConfirmed: withQty.length > 0 && withQty.every(l => l.isConfirmed),
    hasAnyConfirmed: linesConfirmed > 0,
    linesTotal: withQty.length,
    linesConfirmed: withQty.filter(l => l.isConfirmed).length,
    fobTotal,
    // Multiplicador efetivo do pedido (final ÷ FOB)
    multiplier: fobTotal > 0 ? total / fobTotal : null,
  }
}

/**
 * Situação financeira completa de um pedido: quanto custa, quanto foi pago,
 * quanto falta — em USD e em BRL (pela cotação informada).
 * @param {object} order
 * @param {number} rate cotação atual pra estimar o que falta em BRL
 */
export function computeOrderBalance(order, rate) {
  const fin = computeOrderFinal(order)
  const paidUsd = computeOrderPaid(order)
  const paidBrl = (order?.payments || []).reduce((a, p) => a + (num(p.amount_brl) || 0), 0)
  // v13.69 — quitado à mão: pedidos antigos foram pagos fora do sistema.
  // A marcação da dona vale mais que a soma dos pagamentos lançados.
  const isManuallySettled = !!order?.settled_at
  const remainingUsd = isManuallySettled ? 0 : fin.total - paidUsd
  // Câmbio pra projetar o que falta: média efetiva já paga > câmbio orçado > cotação atual
  const avgRate = paidUsd > 0 && paidBrl > 0 ? paidBrl / paidUsd : null
  const projRate = num(order?.budget_rate) || avgRate || num(rate) || 0
  return {
    ...fin,
    paidUsd,
    paidBrl,
    avgRate,
    projRate,
    remainingUsd,
    remainingBrl: projRate > 0 ? remainingUsd * projRate : null,
    percentPaid: isManuallySettled ? 100 : (fin.total > 0 ? (paidUsd / fin.total) * 100 : 0),
    isSettled: isManuallySettled || (fin.total > 0 && remainingUsd <= 0.01),
    isManuallySettled,
    settledAt: order?.settled_at || null,
    settledNote: order?.settled_note || null,
    // v13.68 — caixinhas: quanto do que falta já está guardado
    ...computeReserveCoverage(order, projRate > 0 ? remainingUsd * projRate : null),
  }
}

// ═══════════════════════════════════════════════════════════════════
// v13.68 — CAIXINHAS / RESERVAS (BRL guardado pra um pedido)
// A reserva é em reais (banco brasileiro) e a dívida em dólar — a
// comparação é feita em BRL, pela cotação de projeção do pedido.
// ═══════════════════════════════════════════════════════════════════

/** Total em BRL guardado pra um pedido. */
export function computeOrderReserved(order) {
  return (order?.reserves || []).reduce((a, r) => a + (num(r?.amount_brl) || 0), 0)
}

/**
 * Cobertura: quanto do que falta já está reservado.
 * @param {object} order
 * @param {number|null} remainingBrl o que falta pagar, em BRL
 */
export function computeReserveCoverage(order, remainingBrl) {
  const reservedBrl = computeOrderReserved(order)
  const yieldingBrl = (order?.reserves || [])
    .filter(r => r?.yields)
    .reduce((a, r) => a + (num(r?.amount_brl) || 0), 0)
  if (remainingBrl == null || remainingBrl <= 0) {
    return { reservedBrl, yieldingBrl, coveragePercent: reservedBrl > 0 ? 100 : 0, toRaiseBrl: 0, isCovered: true }
  }
  return {
    reservedBrl,
    yieldingBrl,
    coveragePercent: Math.min(100, (reservedBrl / remainingBrl) * 100),
    toRaiseBrl: Math.max(0, remainingBrl - reservedBrl),
    isCovered: reservedBrl >= remainingBrl - 0.01,
  }
}

/**
 * Panorama consolidado: quanto devo em TODOS os pedidos abertos.
 * @returns {{orders, totalFinal, totalPaid, totalRemainingUsd, totalRemainingBrl,
 *            confirmedRemaining, estimatedRemaining, criticalCount}}
 */
export function computePendingSummary(orders = [], rate) {
  const rows = []
  let totalFinal = 0, totalPaid = 0, totalRemainingUsd = 0, totalRemainingBrl = 0
  let confirmedRemaining = 0, estimatedRemaining = 0, criticalCount = 0
  let totalReservedBrl = 0, totalYieldingBrl = 0, estimatedCount = 0
  for (const o of orders) {
    if (o.deleted_at || o.purged_at) continue
    if (!['sent', 'manufacturing', 'in_transit', 'completed'].includes(o.status)) continue
    const b = computeOrderBalance(o, rate)
    if (b.total <= 0) continue
    totalFinal += b.total
    totalPaid += b.paidUsd
    if (b.remainingUsd > 0.01) {
      totalRemainingUsd += b.remainingUsd
      totalRemainingBrl += b.remainingBrl || 0
      totalReservedBrl += b.reservedBrl || 0
      totalYieldingBrl += b.yieldingBrl || 0
      if (b.isFullyConfirmed) confirmedRemaining += b.remainingUsd
      else { estimatedRemaining += b.remainingUsd; estimatedCount++ }
      if (o.status === 'completed') criticalCount++
      rows.push({
        id: o.id,
        order_name: o.order_name || o.factory,
        factory: o.factory,
        status: o.status,
        expected_arrival: o.expected_arrival || null,
        isCritical: o.status === 'completed',
        ...b,
      })
    }
  }
  rows.sort((a, b) => (b.isCritical - a.isCritical) || (b.remainingUsd - a.remainingUsd))
  return {
    orders: rows,
    totalFinal, totalPaid,
    totalRemainingUsd, totalRemainingBrl,
    confirmedRemaining, estimatedRemaining,
    criticalCount, estimatedCount,
    // v13.68 — o quanto do compromisso total já está guardado
    totalReservedBrl, totalYieldingBrl,
    toRaiseBrl: Math.max(0, totalRemainingBrl - totalReservedBrl),
    coveragePercent: totalRemainingBrl > 0
      ? Math.min(100, (totalReservedBrl / totalRemainingBrl) * 100)
      : (totalReservedBrl > 0 ? 100 : 0),
  }
}

// Pedidos com pagamento incompleto (sent + manufacturing + in_transit + completed)
// Concluídos com saldo aberto = CRÍTICO (recebi a mercadoria mas ainda devo)
//
// v13.67 — mede contra o VALOR FINAL da trading (antes era contra o FOB, que
// subestimava a dívida em ~60%). `fobTotal` continua no retorno pra quem
// mostra o custo de fábrica; `total` é o que de fato se deve.
export function computeUnpaidOrders(orders, rate) {
  const out = []
  for (const o of orders) {
    if (o.status !== 'manufacturing' && o.status !== 'sent' && o.status !== 'in_transit' && o.status !== 'completed') continue
    const b = computeOrderBalance(o, rate)
    if (b.total <= 0) continue
    if (b.remainingUsd > 0.01) {
      out.push({
        id: o.id,
        order_name: o.order_name || o.factory,
        factory: o.factory,
        status: o.status,
        // Compatibilidade: consumidores antigos leem fobTotal/remaining
        fobTotal: b.fobTotal,
        finalTotal: b.total,
        isFullyConfirmed: b.isFullyConfirmed,
        multiplier: b.multiplier,
        paidUsd: b.paidUsd,
        remaining: b.remainingUsd,
        remainingBrl: b.remainingBrl,
        percentPaid: b.percentPaid,
        created_at: o.created_at,
        expected_arrival: o.expected_arrival || null,
        isCritical: o.status === 'completed',
      })
    }
  }
  out.sort((a, b) => {
    if (a.isCritical && !b.isCritical) return -1
    if (!a.isCritical && b.isCritical) return 1
    return b.remaining - a.remaining
  })
  return out
}

// Comprovantes faltando (em pedidos manufacturing/completed)
export function computeMissingReceipts(orders) {
  let count = 0
  const orderIds = new Set()
  for (const o of orders) {
    if (o.status !== 'manufacturing' && o.status !== 'in_transit' && o.status !== 'completed') continue
    for (const p of (o.payments || [])) {
      if (!p.receipt_url && parseFloat(p.amount_usd) > 0) {
        count += 1
        orderIds.add(o.id)
      }
    }
  }
  return { paymentsCount: count, ordersCount: orderIds.size }
}

// Tendência mensal: agrupa pagamentos por YYYY-MM
// Retorna array ordenado [{month, usd, brl, count}]
export function computeMonthlyTrend(payments, monthsBack = 12) {
  const map = new Map()
  const cutoff = Date.now() - monthsBack * 30 * 86400000
  
  for (const p of payments) {
    const date = p.payment_date || p.created_at
    if (!date) continue
    const t = new Date(date).getTime()
    if (isNaN(t) || t < cutoff) continue
    const d = new Date(t)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!map.has(key)) map.set(key, { month: key, usd: 0, brl: 0, count: 0 })
    const m = map.get(key)
    m.usd += parseFloat(p.amount_usd) || 0
    m.brl += parseFloat(p.amount_brl) || 0
    m.count += 1
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month))
}

// Projeção: pedidos ativos + saldo aberto, agrupados por janela temporal
// Retorna { next30d, next60d, next90d, beyond, noDate } cada um com array de pedidos
export function computeCashflowProjection(orders) {
  const unpaid = computeUnpaidOrders(orders)
  const now = Date.now()
  const buckets = {
    next30d: [],
    next60d: [],
    next90d: [],
    beyond: [],
    noDate: [],
  }
  
  for (const u of unpaid) {
    if (u.status === 'completed') {
      // Concluído sem pago = pagar AGORA (vai pra next30d)
      buckets.next30d.push({ ...u, _bucket: 'urgent' })
      continue
    }
    if (!u.expected_arrival) {
      buckets.noDate.push(u)
      continue
    }
    const arr = new Date(u.expected_arrival).getTime()
    if (isNaN(arr)) {
      buckets.noDate.push(u)
      continue
    }
    const days = Math.floor((arr - now) / 86400000)
    if (days <= 30) buckets.next30d.push(u)
    else if (days <= 60) buckets.next60d.push(u)
    else if (days <= 90) buckets.next90d.push(u)
    else buckets.beyond.push(u)
  }
  
  return buckets
}

// Soma USD de uma lista de pedidos não pagos (helper pra projeção)
export function sumRemaining(unpaidArr) {
  return unpaidArr.reduce((a, u) => a + u.remaining, 0)
}
