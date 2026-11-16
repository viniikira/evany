// src/lib/unitCost.js
// v13.82 — "A quanto saiu cada peça no fim das contas?"
//
// Pedido dela: quando o pedido está quitado, mostrar o custo REAL de cada
// peça juntando todos os pagamentos e todos os câmbios — "tem que sair
// certinho, mesmo que fique faltando algum valor ali no quitado".
//
// A regra que fecha 100%:
//   O QUE SAIU DO BANCO (soma dos pagamentos em R$) é a verdade. Esse valor é
//   repartido entre as linhas do pedido na proporção do valor de cada uma
//   (valor final da trading; sem ele, o FOB). Assim a soma do custo de todas
//   as peças dá EXATAMENTE o que foi pago — centavo por centavo — mesmo quando
//   o total pago não bate com o total previsto (diferença de câmbio, taxa,
//   arredondamento da trading).
//
// O câmbio de cada parcela entra sozinho: quem pagou parte a 5,01 e parte a
// 5,60 tem um custo em reais que já é a média ponderada das duas.
//
// Três situações, nunca misturadas em silêncio (campo `kind`):
//   'real'     — quitado: custo fechado, vem só dos pagamentos
//   'partial'  — parte paga (câmbio real) + o que falta projetado
//   'estimate' — nada pago ainda: valor previsto × câmbio de projeção

import { computeOrderLines, computeOrderBalance } from './financial'

const num = (v) => {
  if (v == null || v === '') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

// Quitado à mão com pagamentos lançados abaixo disso = faltou lançar pagamento.
// Com valores da trading confirmados a folga é pequena; com estimativa
// (FOB × fator) o fator real varia de 1,5 a 1,8, então a folga é maior.
const COVERAGE_OK_CONFIRMED = 0.97
const COVERAGE_OK_ESTIMATED = 0.75

/**
 * Reparte `total` (em centavos inteiros) pelos pesos, sem perder nem criar
 * centavo: a sobra do arredondamento vai pras linhas com maior resto.
 */
export function allocateCents(totalCents, weights) {
  const sum = weights.reduce((a, w) => a + w, 0)
  if (!(sum > 0) || weights.length === 0) return weights.map(() => 0)
  const raw = weights.map(w => (totalCents * w) / sum)
  const out = raw.map(Math.floor)
  let left = totalCents - out.reduce((a, c) => a + c, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++
  return out
}

/** Soma os pagamentos, completando R$ ou US$ pelo câmbio quando só um dos dois foi lançado. */
export function sumPaymentsForCost(payments = []) {
  let usd = 0, brl = 0, empty = 0, incomplete = 0, count = 0
  for (const p of payments || []) {
    let u = num(p.amount_usd), b = num(p.amount_brl)
    const r = num(p.rate_paid)
    if (!(u > 0) && !(b > 0)) { empty++; continue }
    if (!(b > 0) && u > 0 && r > 0) b = u * r
    if (!(u > 0) && b > 0 && r > 0) u = b / r
    if (!(u > 0) || !(b > 0)) { incomplete++; continue }
    usd += u; brl += b; count++
  }
  return { usd, brl, count, empty, incomplete }
}

/**
 * Custo por peça de um pedido.
 * @param {object} order pedido com items e payments
 * @param {number} rate cotação atual (só usada pra projetar o que ainda não foi pago)
 */
export function computeUnitCosts(order, rate) {
  const bal = computeOrderBalance(order, rate)
  const lines = computeOrderLines(order).filter(l => l.qty > 0)
  const pieces = lines.reduce((a, l) => a + l.qty, 0)
  const pay = sumPaymentsForCost(order?.payments)
  const expectedUsd = bal.total || 0
  const coverage = expectedUsd > 0 ? pay.usd / expectedUsd : null
  const paidRate = pay.usd > 0 ? pay.brl / pay.usd : null
  const projRate = num(order?.budget_rate) || paidRate || num(rate) || 0

  // ── Em que situação o pedido está
  let kind, missingPayments = false
  const autoSettled = expectedUsd > 0 && pay.usd >= expectedUsd - 0.01
  if (!(pay.brl > 0)) {
    kind = 'estimate'
    missingPayments = !!bal.isManuallySettled
  } else if (autoSettled) {
    kind = 'real'
  } else if (bal.isManuallySettled) {
    const ok = coverage == null || coverage >= (bal.isFullyConfirmed ? COVERAGE_OK_CONFIRMED : COVERAGE_OK_ESTIMATED)
    kind = ok ? 'real' : 'partial'
    missingPayments = !ok
  } else {
    kind = 'partial'
  }

  // ── Quanto repartir
  const pendingUsd = kind === 'real' ? 0 : Math.max(0, expectedUsd - pay.usd)
  const totalUsd = kind === 'real' ? pay.usd : pay.usd + pendingUsd
  const totalBrl = kind === 'real' ? pay.brl : pay.brl + pendingUsd * projRate

  // ── Pesos: valor de cada linha. Sem preço nenhum no pedido → por peça.
  const priced = lines.filter(l => l.finalTotal > 0)
  const unpricedQty = lines.filter(l => !(l.finalTotal > 0)).reduce((a, l) => a + l.qty, 0)
  const byPiece = priced.length === 0
  // Peças que entram na média: no custo real, todas (o total pago é de todas);
  // na previsão, só as que têm preço — as sem preço ainda não estão no total.
  const avgPieces = (kind === 'real' || byPiece) ? pieces : pieces - unpricedQty
  const weights = lines.map(l => byPiece ? l.qty : l.finalTotal)
  const weightBasis = byPiece ? 'pieces'
    : priced.every(l => l.isConfirmed) ? 'trading'
    : priced.some(l => l.isConfirmed) ? 'mixed' : 'fob'

  const brlCents = allocateCents(Math.round(totalBrl * 100), weights)
  const usdCents = allocateCents(Math.round(totalUsd * 100), weights)

  const outLines = lines.map((l, i) => {
    const brlTotal = brlCents[i] / 100, usdTotal = usdCents[i] / 100
    return {
      itemId: l.itemId,
      colorCode: l.colorCode,
      qty: l.qty,
      fobUnit: l.fobUnit,
      tradingUnit: l.isConfirmed ? l.finalUnit : null,
      hasPrice: byPiece || l.finalTotal > 0,
      brlTotal, usdTotal,
      brlUnit: l.qty > 0 ? brlTotal / l.qty : 0,
      usdUnit: l.qty > 0 ? usdTotal / l.qty : 0,
    }
  })

  // ── Por modelo (item do pedido)
  const modelsMap = new Map()
  for (const l of outLines) {
    if (!modelsMap.has(l.itemId)) modelsMap.set(l.itemId, { itemId: l.itemId, qty: 0, brlTotal: 0, usdTotal: 0, lines: [] })
    const m = modelsMap.get(l.itemId)
    m.qty += l.qty; m.brlTotal += l.brlTotal; m.usdTotal += l.usdTotal; m.lines.push(l)
  }
  const models = [...modelsMap.values()].map(m => {
    const units = m.lines.filter(l => l.hasPrice).map(l => l.brlUnit)
    const min = units.length ? Math.min(...units) : 0, max = units.length ? Math.max(...units) : 0
    return {
      ...m,
      brlTotal: Math.round(m.brlTotal * 100) / 100,
      usdTotal: Math.round(m.usdTotal * 100) / 100,
      brlUnit: m.qty > 0 ? m.brlTotal / m.qty : 0,
      usdUnit: m.qty > 0 ? m.usdTotal / m.qty : 0,
      // todas as cores saíram pelo mesmo valor (diferença menor que 1 centavo)?
      uniform: max - min < 0.01 && m.lines.every(l => l.hasPrice),
      brlUnitMin: min, brlUnitMax: max,
    }
  })

  return {
    kind,
    pieces,
    totalBrl: Math.round(totalBrl * 100) / 100,
    totalUsd: Math.round(totalUsd * 100) / 100,
    avgBrlUnit: avgPieces > 0 ? totalBrl / avgPieces : 0,
    avgUsdUnit: avgPieces > 0 ? totalUsd / avgPieces : 0,
    // câmbio que realmente valeu (média ponderada de todas as parcelas)
    paidRate,
    projRate,
    paidUsd: pay.usd,
    paidBrl: pay.brl,
    paymentsCount: pay.count,
    pendingUsd,
    pendingBrl: pendingUsd * projRate,
    expectedUsd,
    // pago − previsto (só faz sentido no custo real): + pagou a mais, − pagou a menos
    diffUsd: kind === 'real' && expectedUsd > 0 ? pay.usd - expectedUsd : 0,
    coverage,
    // quanto o pedido custou em cima do FOB da fábrica (impostos + frete + trading)
    realMultiplier: bal.fobTotal > 0 && totalUsd > 0 ? totalUsd / bal.fobTotal : null,
    fobTotal: bal.fobTotal,
    weightBasis,
    unpricedQty: byPiece ? 0 : unpricedQty,
    isManuallySettled: !!bal.isManuallySettled,
    missingPayments,
    emptyPayments: pay.empty,
    incompletePayments: pay.incomplete,
    lines: outLines,
    models,
  }
}
