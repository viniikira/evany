// src/lib/orderNaming.js
// v13.72 — Nome do pedido sugerido automaticamente.
//
// A dona nunca sabe o que escrever e vários pedidos ficaram "(sem nome)". Ela
// já pensa nos pedidos por mês ("Julho 2026", "Outubro 2025") — o que falta é a
// FÁBRICA, que é justamente o que diferencia dois pedidos do mesmo mês (julho/26
// tem um da HAIRCHUAN e um da EPF).
//
// Convenção: MÊS/ANO · FÁBRICA   →   "JUL/26 · HAIRCHUAN"
// Repetiu mês+fábrica no mesmo mês? entra sequência: "JUL/26 · EPF (2)".
//
// A sugestão nunca é obrigatória: ela pode escrever o que quiser em cima.

import { parseDateLocal } from './utils'

export const MONTHS_ABBR = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']

const normName = (s) => (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ')

// "JUL/26" a partir de uma data (aceita 'YYYY-MM-DD', ISO ou Date)
export function monthTag(date) {
  const d = parseDateLocal(date) || new Date()
  return `${MONTHS_ABBR[d.getMonth()]}/${String(d.getFullYear()).slice(-2)}`
}

// Sugere o nome. `order` precisa de factory; order_date é opcional (usa hoje).
// `allOrders` serve só pra evitar nome repetido (ignora o próprio pedido).
export function proposeOrderName(order, allOrders = []) {
  const factory = (order?.factory || '').toString().trim()
  if (!factory) return ''

  const base = `${monthTag(order?.order_date || order?.created_at)} · ${factory.toUpperCase()}`

  const taken = new Set(
    allOrders
      .filter(o => o && o.id !== order?.id && !o.deleted_at)
      .map(o => normName(o.order_name))
      .filter(Boolean)
  )
  if (!taken.has(normName(base))) return base

  for (let n = 2; n <= 20; n++) {
    const candidate = `${base} (${n})`
    if (!taken.has(normName(candidate))) return candidate
  }
  return base
}
