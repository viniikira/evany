// src/lib/payments.js
// v13.77 — Pagamentos de importação: formato brasileiro, ordem cronológica e
// a conta R$ ÷ câmbio = US$, num lugar só (e testável).
//
// Por que existe (reclamação dela em 14/10/2026: "não está fazendo sentido,
// quando eu coloco ele reorganiza"):
//   • a lista vinha do banco SEM ordem — cada campo salvava ao sair dele e o
//     pagamento editado pulava de lugar; "#1, #2" era só a posição na tela
//   • "+ Pagamento" criava um registro vazio no banco antes de ela digitar
//   • os campos eram número cru ("17999,98"), sem cara de dinheiro
//
// Agora: sempre do mais antigo pro mais novo, numeração pela data, valores no
// padrão brasileiro (R$ 17.999,98) e nada é gravado até ela clicar Salvar.

const DAY = 86400000

/**
 * Lê um valor digitado do jeito que ela digitar:
 *   "17.999,98"  "17999,98"  "17999.98"  "R$ 17.999,98"  "17.999"
 * Dinheiro: ponto antes de 3 dígitos no fim = milhar ("17.999" = 17999).
 * Câmbio (money=false): ponto ou vírgula são sempre decimais ("5.01" = 5,01).
 * @returns {number|null}
 */
export function parseBR(raw, { money = true } = {}) {
  if (raw == null) return null
  if (typeof raw === 'number') return isFinite(raw) ? raw : null
  let s = String(raw).replace(/R\$|US\$|\$|\s/g, '').trim()
  if (!s) return null
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // o separador que aparece por último é o decimal
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (hasComma) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (hasDot && money && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '')            // "17.999" ou "1.234.567" = milhar
  }
  const n = Number(s)
  return isFinite(n) ? n : null
}

/** 17999.98 → "17.999,98" (sempre 2 casas) */
export function formatMoneyBR(n) {
  if (n == null || !isFinite(n)) return ''
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 5.0123 → "5,0123"; 5.01 → "5,01" (2 a 4 casas, sem zeros sobrando) */
export function formatRateBR(n) {
  if (n == null || !isFinite(n)) return ''
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/**
 * Completa o terceiro valor a partir dos outros dois.
 * Ela paga em REAIS com a cotação do dia, então o normal é: R$ + câmbio → US$.
 * Se ela digitar o US$ por último (ex.: copiou do contrato de câmbio), o câmbio
 * é recalculado a partir de R$ ÷ US$.
 * @param {{brl:number|null, rate:number|null, usd:number|null, lastEdited:'brl'|'rate'|'usd'|null}} v
 * @returns {{brl, rate, usd, derived:'usd'|'rate'|'brl'|null}}
 */
export function resolveAmounts({ brl = null, rate = null, usd = null, lastEdited = null }) {
  const ok = (x) => x != null && isFinite(x) && x > 0
  if (lastEdited === 'usd' && ok(usd) && ok(brl)) {
    return { brl, usd, rate: round(brl / usd, 4), derived: 'rate' }
  }
  if (ok(brl) && ok(rate)) return { brl, rate, usd: round(brl / rate, 2), derived: 'usd' }
  if (ok(usd) && ok(rate)) return { usd, rate, brl: round(usd * rate, 2), derived: 'brl' }
  if (ok(brl) && ok(usd)) return { brl, usd, rate: round(brl / usd, 4), derived: 'rate' }
  return { brl, rate, usd, derived: null }
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d

const timeOf = (s) => {
  if (!s) return null
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null
}

/** Mais antigo primeiro; sem data vai pro fim; empate pela ordem em que foram lançados. */
export function sortPaymentsChrono(payments = []) {
  return [...(payments || [])].sort((a, b) => {
    const ta = timeOf(a?.payment_date), tb = timeOf(b?.payment_date)
    if (ta == null && tb != null) return 1
    if (tb == null && ta != null) return -1
    if (ta != null && tb != null && ta !== tb) return ta - tb
    return String(a?.created_at || '').localeCompare(String(b?.created_at || ''))
  })
}

/** Pagamento sem valor nenhum (registro vazio criado pela versão antiga) */
export const isEmptyPayment = (p) => !(Number(p?.amount_brl) > 0) && !(Number(p?.amount_usd) > 0)

/** Totais pro rodapé da lista */
export function summarizePayments(payments = []) {
  let brl = 0, usd = 0, count = 0, incomplete = 0
  let first = null, last = null
  for (const p of payments || []) {
    if (isEmptyPayment(p)) { incomplete++; continue }
    count++
    brl += Number(p.amount_brl) || 0
    usd += Number(p.amount_usd) || 0
    const t = timeOf(p.payment_date)
    if (t != null) { first = first == null ? t : Math.min(first, t); last = last == null ? t : Math.max(last, t) }
    if (!p.payment_date) incomplete++
  }
  return {
    count,
    brl: round(brl, 2),
    usd: round(usd, 2),
    avgRate: usd > 0 && brl > 0 ? round(brl / usd, 4) : null,
    incomplete,
    spanDays: first != null && last != null ? Math.round((last - first) / DAY) : null,
  }
}

/** Valida o formulário antes de gravar. @returns {string|null} mensagem de erro */
export function validatePayment({ payment_date, amount_brl, amount_usd, rate_paid }) {
  if (!payment_date) return 'Informe a data do pagamento (a do comprovante do banco).'
  if (!(amount_brl > 0) && !(amount_usd > 0)) return 'Informe quanto foi pago em reais.'
  if (amount_brl > 0 && !(amount_usd > 0)) return 'Informe o câmbio do dia (ou o valor em dólar).'
  if (rate_paid != null && (rate_paid < 1 || rate_paid > 20)) return 'O câmbio parece errado — confira (ex.: 5,01).'
  return null
}
