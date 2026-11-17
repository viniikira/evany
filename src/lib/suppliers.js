// src/lib/suppliers.js
// v13.84 — FÁBRICAS × MARCAS PARCEIRAS
//
// Fábrica (HAIRCHUAN, HAIR FORTUNE, EPF): modelos exclusivos da Evany Hair,
// preço em dólar (FOB) + trading por cima, pago em reais no câmbio do dia.
// Marca parceira (ex.: Slick): modelos PRONTOS, não exclusivos; pedido
// personalizado só na cor; preço muda a cada pedido e é cobrado em REAIS.
//
// Os dois nunca se misturam: produtos e pedidos de marca ficam em abas
// próprias, fora da Produção e do radar de fabricação.

import { formatFixedBR } from './moneyMask'

export const SUPPLIER_KINDS = [
  { id: 'factory', label: 'Fábrica', plural: 'Fábricas', hint: 'Fabrica modelos exclusivos da Evany Hair (preço em dólar)' },
  { id: 'brand', label: 'Marca parceira', plural: 'Marcas parceiras', hint: 'Modelos prontos da marca, não exclusivos (preço em reais)' },
]

export const isBrandFactory = (f) => f?.kind === 'brand'
export const isBrandProduct = (p) => p?.kind === 'brand'
export const isBrandOrder = (o) => o?.kind === 'brand'
export const orderCurrency = (o) => (o?.currency === 'BRL' ? 'BRL' : 'USD')

/** Fornecedor (fábrica ou marca) pelo nome. */
export const supplierByName = (factories = [], name) =>
  (factories || []).find(f => (f?.name || '').trim().toUpperCase() === String(name || '').trim().toUpperCase()) || null

/** 'R$ 1.234,56' ou 'US$ 1.234,56' */
export function formatMoney(n, currency = 'USD', decimals = 2) {
  return (currency === 'BRL' ? 'R$ ' : 'US$ ') + formatFixedBR(Number(n) || 0, decimals)
}

/** Valores de um pedido NA MOEDA DELE (a partir de computeOrderBalance). */
export function orderMoney(bal) {
  if (bal?.currency === 'BRL') {
    return { currency: 'BRL', total: bal.totalBrl || 0, paid: bal.paidBrl || 0, remaining: bal.remainingBrl || 0 }
  }
  return { currency: 'USD', total: bal?.total || 0, paid: bal?.paidUsd || 0, remaining: bal?.remainingUsd || 0 }
}
