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
  { id: 'smart', label: '📋 Por etapa' },
  { id: 'date', label: '📅 Data do pedido' },
  { id: 'debt', label: '💸 Falta pagar' },
  { id: 'value', label: '💵 Valor do pedido' },
]

// (ORDER_GROUPS da v13.72 removido na v13.76: a lista agora é por etapa)

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
  const delay = computeOrderDelay(order, leadTimeByFactory, now)
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

// ═══════════════════════════════════════════════════════════════════
// v13.76 — POR ETAPA. A v13.72 juntava revisão, fabricação e trânsito num
// único "Em andamento" — ela não conseguia ver onde cada pedido estava.
// Agora cada status é um bloco, na ordem do ciclo de vida, e o que precisa
// de atenção sobe pro topo DENTRO da própria etapa (borda vermelha + motivo).
// ═══════════════════════════════════════════════════════════════════
export const ORDER_STAGES = [
  { id: 'draft',         label: 'Rascunho',       icon: '📝', color: '#9CA3AF', hint: 'ainda não foi pra fábrica' },
  { id: 'sent',          label: 'Em revisão',     icon: '🔍', color: '#3B82F6', hint: 'esperando a fábrica/trading confirmar' },
  { id: 'manufacturing', label: 'Em fabricação',  icon: '🏭', color: '#F59E0B', hint: 'na fábrica — o prazo está correndo' },
  { id: 'in_transit',    label: 'Em trânsito',    icon: '✈️', color: '#8B5CF6', hint: 'a caminho do Brasil' },
  { id: 'completed',     label: 'Concluídos',     icon: '✅', color: '#10B981', hint: 'já chegaram', collapsedByDefault: true },
]

const piecesOf = (o) => (o?.items || []).reduce((a, it) => {
  const cls = it.colors || []
  return a + cls.reduce((b, c) => b + (Number(c.qty) || 0), 0) + (cls.length === 0 ? (Number(it.quantity) || 0) : 0)
}, 0)

const sentAtOf = (o) => {
  const h = [...(o?.status_history || [])].reverse().find(x => x?.status === 'sent')
  const t = h?.at ? new Date(h.at).getTime() : NaN
  return isNaN(t) ? dateOf(o) : t
}

// Ordem DENTRO da etapa: o que precisa de atenção primeiro, depois o que
// acontece antes (chega antes / vence antes / espera há mais tempo).
function stageKey(o, c, ctx) {
  const attention = c.reasons.length > 0 ? 0 : 1
  const daysLate = c.group === 'attention' ? -(c.sortKey?.[0] ?? 0) : 0
  const now = ctx.now ?? Date.now()
  let within = 0
  switch (o.status) {
    case 'in_transit': within = parseDateLocal(o.expected_arrival)?.getTime() ?? Infinity; break
    case 'manufacturing': {
      const d = computeOrderDelay(o, ctx.leadTimeByFactory || new Map(), now)
      within = d?.deadlineDays != null ? d.deadlineDays - d.daysElapsed : Infinity
      break
    }
    case 'sent': within = sentAtOf(o); break            // esperando há mais tempo primeiro
    default: within = -dateOf(o)                        // rascunho/concluído: mais recente primeiro
  }
  return [attention, -daysLate, within]
}

/**
 * Pedidos agrupados por etapa, com totais pro cabeçalho de cada bloco.
 * @returns {{stages: Array<{...stage, orders, pieces, remainingUsd, attentionCount}>, reasonsById, attentionTotal}}
 */
export function groupOrdersByStage(orders, ctx = {}) {
  const reasonsById = new Map()
  const buckets = new Map(ORDER_STAGES.map(s => [s.id, []]))
  for (const o of orders || []) {
    const c = classifyOrder(o, ctx)
    if (c.reasons.length) reasonsById.set(o.id, c.reasons)
    const stageId = o.status === 'cancelled' ? 'completed' : o.status
    const bucket = buckets.get(stageId) || buckets.get('draft')
    bucket.push({ o, key: stageKey(o, c, ctx), c })
  }
  let attentionTotal = 0
  const stages = ORDER_STAGES.map(s => {
    const rows = buckets.get(s.id).sort((a, b) => cmpKeys(a.key, b.key))
    const attentionCount = rows.filter(r => r.c.reasons.length > 0).length
    attentionTotal += attentionCount
    return {
      ...s,
      orders: rows.map(r => r.o),
      pieces: rows.reduce((a, r) => a + piecesOf(r.o), 0),
      remainingUsd: rows.reduce((a, r) => {
        const b = computeOrderBalance(r.o, ctx.rate)
        return a + (b.isSettled ? 0 : Math.max(0, b.remainingUsd))
      }, 0),
      attentionCount,
    }
  })
  return { stages, reasonsById, attentionTotal }
}

// ═══════════════════════════════════════════════════════════════════
// v13.76 — "PRECISA DE VOCÊ": cada problema escrito em português, com a ação
// que resolve. O sino e os cards só avisavam; aqui ela resolve na hora.
// action: 'arrival' (mudar previsão) | 'arrived' (marcar que chegou) | 'open'
// ═══════════════════════════════════════════════════════════════════
const SEVERITY = { high: 0, medium: 1, low: 2 }
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`

export function buildAttention(orders, ctx = {}) {
  const now = ctx.now ?? Date.now()
  const today = new Date(new Date(now).toDateString()).getTime()
  const out = []
  for (const o of orders || []) {
    if (!o || o.deleted_at) continue
    const name = o.order_name || `${o.factory} (sem nome)`
    const bal = computeOrderBalance(o, ctx.rate)
    const push = (kind, severity, title, actions, sortDays = 0) =>
      out.push({ id: `${kind}-${o.id}`, kind, severity, order: o, name, title, actions, sortDays })

    if (o.status === 'in_transit') {
      const t = parseDateLocal(o.expected_arrival)?.getTime()
      if (t != null && t < today) {
        const d = Math.floor((today - t) / DAY)
        push('arrival_overdue', 'high', `A previsão de chegada venceu há ${plural(d, 'dia', 'dias')}. Já chegou?`, ['arrived', 'arrival'], d)
      } else if (t == null) {
        push('arrival_missing', 'medium', 'Está em trânsito sem previsão de chegada.', ['arrival'])
      }
    }

    if (o.status === 'manufacturing') {
      const d = computeOrderDelay(o, ctx.leadTimeByFactory || new Map(), now)
      if (d?.isLate) {
        push('late', 'high', `Atrasado ${plural(d.daysLate, 'dia', 'dias')} — prazo era de ${d.deadlineDays} dias.`, ['open'], d.daysLate)
      } else if (d?.source === 'legacy_no_start_date') {
        push('no_start', 'medium', 'Sem data de início: o sistema não consegue avisar se atrasar.', ['open'])
      }
    }

    if (o.status === 'sent') {
      const waited = Math.floor((now - sentAtOf(o)) / DAY)
      if (waited >= 30) push('review_stale', 'medium', `Em revisão há ${waited} dias — a fábrica respondeu?`, ['open'], waited)
    }

    if (o.status === 'completed' && !bal.isSettled && bal.remainingUsd > 0.01 && bal.total > 0) {
      push('debt', 'high', `Já chegou, mas ainda faltam US$ ${Math.round(bal.remainingUsd).toLocaleString('pt-BR')} para pagar.`, ['open'])
    }

    if (o.status !== 'draft' && !bal.isManuallySettled && bal.unpricedQty > 0) {
      push('unpriced', 'low', `${plural(bal.unpricedQty, 'peça', 'peças')} sem preço — o total do pedido está incompleto.`, ['open'])
    }

    if (o.status === 'draft' && (now - dateOf(o)) > STALE_DRAFT_DAYS * DAY) {
      push('draft_stale', 'low', 'Rascunho parado há mais de 30 dias.', ['open'])
    }
  }
  return out.sort((a, b) =>
    SEVERITY[a.severity] - SEVERITY[b.severity] || b.sortDays - a.sortDays || a.name.localeCompare(b.name))
}
