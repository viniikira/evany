// src/lib/orderSort.js
// v13.72 — Ordem e agrupamento da lista de pedidos.
//
// A lista vinha do banco por created_at (a data em que ela DIGITOU o pedido no
// sistema), então pedidos retroativos caíam em qualquer lugar e "Concluído"
// aparecia no meio de "Em Revisão"/"Em Fabricação" — reclamação dela.
//
// Ordem nova responde "o que eu preciso olhar agora?":
//   1. 🚨 Precisa de você  — atraso, chegada vencida, saldo em aberto, rascunho parado
//   2. 🔄 Em andamento     — pelo que acontece primeiro: chegando → fabricando → revisão → rascunho
//   3. ✅ Fechados          — concluído/cancelado, mais recente primeiro (sempre no fim)
//
// Nada disso é escondido: cada grupo tem cabeçalho com contagem, e ela pode
// trocar pra ordem por data / falta pagar / valor no seletor da toolbar.

import { computeOrderDelay } from './pendencias'
import { computeOrderBalance } from './financial'
import { parseDateLocal } from './utils'

export const SORT_MODES = [
  { id: 'smart', label: '🧠 Inteligente' },
  { id: 'date', label: '📅 Data do pedido' },
  { id: 'debt', label: '💸 Falta pagar' },
  { id: 'value', label: '💵 Valor do pedido' },
]

export const ORDER_GROUPS = [
  { id: 'attention', label: '🚨 Precisa de você', hint: 'atraso, chegada vencida ou dinheiro em aberto' },
  { id: 'active', label: '🔄 Em andamento', hint: 'na ordem do que acontece primeiro' },
  { id: 'closed', label: '✅ Fechados', hint: 'concluídos e cancelados' },
]

const CLOSED = new Set(['completed', 'cancelled'])
// Dentro de "em andamento": o que está mais perto de acontecer vem antes
const STAGE_ORDER = { in_transit: 0, manufacturing: 1, sent: 2, draft: 3 }
const DAY = 86400000
const STALE_DRAFT_DAYS = 30

const dateOf = (o) => parseDateLocal(o?.order_date || o?.created_at)?.getTime() ?? 0

// Classifica UM pedido: grupo, motivo (pra quem precisa de atenção) e a chave
// de ordenação dentro do grupo (menor = mais em cima).
export function classifyOrder(order, { rate, leadTimeByFactory = new Map(), now = Date.now() } = {}) {
  const status = order?.status
  const delay = computeOrderDelay(order, leadTimeByFactory)
  const bal = computeOrderBalance(order, rate)
  const openDebt = !bal.isSettled && bal.remainingUsd > 0.01

  const arrivalMs = parseDateLocal(order?.expected_arrival)?.getTime() ?? null
  const arrivalLate = arrivalMs != null && arrivalMs < now && !CLOSED.has(status)

  // ── 1. Precisa de você
  // id + label: o card já mostra atraso e saldo em aberto por conta própria, então
  // ele usa o id pra não repetir a mesma informação duas vezes.
  const reasons = []
  if (delay?.isLate && (status === 'manufacturing' || status === 'sent')) {
    reasons.push({ id: 'late', label: `atrasado ${delay.daysLate} dia${delay.daysLate !== 1 ? 's' : ''}` })
  }
  if (arrivalLate) {
    reasons.push({ id: 'arrival_late', label: 'chegada prevista já passou — atualize o status' })
  }
  if (status === 'completed' && openDebt) {
    reasons.push({ id: 'open_debt_completed', label: 'concluído com saldo em aberto' })
  }
  if (status === 'draft' && (now - dateOf(order)) > STALE_DRAFT_DAYS * DAY) {
    reasons.push({ id: 'stale_draft', label: `rascunho parado há mais de ${STALE_DRAFT_DAYS} dias` })
  }

  if (reasons.length > 0) {
    // Mais grave primeiro: dias de atraso, depois dívida maior
    const daysLate = delay?.daysLate || (arrivalLate ? Math.floor((now - arrivalMs) / DAY) : 0)
    return { group: 'attention', reasons, sortKey: [-daysLate, -(bal.remainingUsd || 0)] }
  }

  // ── 3. Fechados (mais recente primeiro)
  if (CLOSED.has(status)) {
    return { group: 'closed', reasons, sortKey: [-dateOf(order)] }
  }

  // ── 2. Em andamento
  const stage = STAGE_ORDER[status] ?? 9
  let within
  if (status === 'in_transit') {
    within = arrivalMs ?? Infinity                     // chega antes, aparece antes
  } else if (status === 'manufacturing' && delay?.deadlineDays != null) {
    within = delay.deadlineDays - delay.daysElapsed    // menos dias restando, mais em cima
  } else {
    within = -dateOf(order)                            // sem prazo: mais recente primeiro
  }
  return { group: 'active', reasons, sortKey: [stage, within] }
}

const cmpKeys = (a, b) => {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0
    if (av !== bv) return av < bv ? -1 : 1
  }
  return 0
}

// Ordena sem agrupar (usado nos modos não-inteligentes e dentro de cada grupo)
export function sortOrders(orders, mode = 'smart', ctx = {}) {
  const list = [...(orders || [])]
  if (mode === 'date') return list.sort((a, b) => dateOf(b) - dateOf(a))
  if (mode === 'debt' || mode === 'value') {
    const val = (o) => {
      const bal = computeOrderBalance(o, ctx.rate)
      return mode === 'debt' ? (bal.isSettled ? 0 : bal.remainingUsd) : bal.total
    }
    return list.sort((a, b) => val(b) - val(a))
  }
  return list
    .map(o => ({ o, c: classifyOrder(o, ctx) }))
    .sort((a, b) => cmpKeys(a.c.sortKey, b.c.sortKey))
    .map(x => x.o)
}

// Modo inteligente: [{ id, label, hint, orders, reasonsById }] só com grupos que têm pedido
export function groupOrders(orders, ctx = {}) {
  const buckets = new Map(ORDER_GROUPS.map(g => [g.id, []]))
  const reasonsById = new Map()

  for (const o of orders || []) {
    const c = classifyOrder(o, ctx)
    buckets.get(c.group).push({ o, key: c.sortKey })
    if (c.reasons.length) reasonsById.set(o.id, c.reasons)
  }

  return ORDER_GROUPS
    .map(g => ({
      ...g,
      orders: buckets.get(g.id).sort((a, b) => cmpKeys(a.key, b.key)).map(x => x.o),
    }))
    .filter(g => g.orders.length > 0)
    .map(g => ({ ...g, reasonsById }))
}
