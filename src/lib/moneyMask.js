// src/lib/moneyMask.js
// v13.78 — Campo de dinheiro "estilo calculadora" (pedido dela: "conforme você
// vai digitando ele já vai separando, como se fosse calculadora").
//
// Só se digitam números; eles entram pela direita:
//   1 → 0,01   12 → 0,12   125 → 1,25   1250050 → 12.500,50
// Sem precisar digitar ponto nem vírgula. Colar "17.999,98" ou "17999.98"
// também funciona (aí o texto colado é lido do jeito que está).

import { parseBR } from './payments'

/** Valor guardado (número, "17.5", "17,50" ou vazio) → número ou null */
export function toNumber(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return isFinite(value) ? value : null
  const s = String(value).trim()
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)   // formato de armazenamento ("17.5")
  return parseBR(s)
}

/** Número → texto no padrão brasileiro com casas fixas ("12.500,50") */
export function formatFixedBR(n, decimals = 2) {
  if (n == null || !isFinite(n)) return ''
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/**
 * O que ela digitou (o texto inteiro do campo) → número.
 * Pega só os dígitos e trata os últimos `decimals` como centavos.
 * @returns {number|null} null quando não sobrou dígito nenhum
 */
export function digitsToValue(text, decimals = 2, maxDigits = 12) {
  const digits = String(text || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, maxDigits)
  if (!digits) return null
  return Number(digits) / 10 ** decimals
}

/** Texto colado com separador ("17.999,98") é lido como está; só dígitos segue a regra da calculadora */
export function pastedToValue(text, decimals = 2, { money = true } = {}) {
  const s = String(text || '').trim()
  if (/[.,]/.test(s)) {
    const n = parseBR(s, { money })
    return n == null ? null : Math.round(n * 10 ** decimals) / 10 ** decimals
  }
  return digitsToValue(s, decimals)
}
