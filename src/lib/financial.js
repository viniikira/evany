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

// Pedidos com pagamento incompleto (sent + manufacturing + completed)
// Concluídos com saldo aberto = CRÍTICO (recebi mas não paguei tudo)
export function computeUnpaidOrders(orders) {
  const out = []
  for (const o of orders) {
    if (o.status !== 'manufacturing' && o.status !== 'sent' && o.status !== 'in_transit' && o.status !== 'completed') continue
    const fobTotal = computeOrderFOB(o)
    if (fobTotal <= 0) continue
    const paidUsd = computeOrderPaid(o)
    const remaining = fobTotal - paidUsd
    if (remaining > 0.01) {
      out.push({
        id: o.id,
        order_name: o.order_name || o.factory,
        factory: o.factory,
        status: o.status,
        fobTotal,
        paidUsd,
        remaining,
        percentPaid: (paidUsd / fobTotal) * 100,
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
