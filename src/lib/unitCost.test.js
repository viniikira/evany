// src/lib/unitCost.test.js — v13.82
import { describe, it, expect } from 'vitest'
import { computeUnitCosts, allocateCents, sumPaymentsForCost } from './unitCost'

const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0)
const cents = (n) => Math.round(n * 100)

const item = (id, price, colors, extra = {}) => ({ id, product_id: 'p' + id, price_usd: price, price_usd_snapshot: price, colors, ...extra })
const pay = (brl, rate, date = '2026-01-10') => ({ payment_date: date, amount_brl: brl, rate_paid: rate, amount_usd: Math.round((brl / rate) * 100) / 100 })

describe('allocateCents — reparte sem perder centavo', () => {
  it('a soma das partes é sempre o total', () => {
    const parts = allocateCents(10000, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000)
    expect(parts).toEqual([3334, 3333, 3333])
  })
  it('respeita a proporção', () => {
    expect(allocateCents(900, [2, 1])).toEqual([600, 300])
  })
  it('sem peso nenhum devolve zeros', () => {
    expect(allocateCents(500, [0, 0])).toEqual([0, 0])
  })
})

describe('sumPaymentsForCost', () => {
  it('ignora registro vazio e completa o que falta pelo câmbio', () => {
    const r = sumPaymentsForCost([
      { amount_brl: 5000, rate_paid: 5, amount_usd: 1000 },
      { amount_brl: null, amount_usd: null },
      { amount_brl: null, rate_paid: 5.5, amount_usd: 100 },
      { amount_brl: 300, rate_paid: null, amount_usd: null },
    ])
    expect(r.usd).toBe(1100)
    expect(r.brl).toBe(5550)
    expect(r.empty).toBe(1)
    expect(r.incomplete).toBe(1)
    expect(r.count).toBe(2)
  })
})

describe('computeUnitCosts — pedido quitado com valores da trading', () => {
  // 2 modelos; uma cor do A tem valor de trading diferente
  const order = {
    conversion_factor: 1.6,
    items: [
      item('a', 15, [
        { code: '1B', qty: 100, final_price_usd: 25 },
        { code: 'COPPER', qty: 50, final_price_usd: 28 },
      ]),
      item('b', 10, [{ code: '613', qty: 50, final_price_usd: 16 }]),
    ],
    // total trading = 2500 + 1400 + 800 = 4700; pago em 2 câmbios diferentes
    payments: [pay(10000, 5, '2026-01-10'), { payment_date: '2026-03-01', amount_brl: 16200, rate_paid: 6, amount_usd: 2700 }],
  }
  const r = computeUnitCosts(order, 5.5)

  it('é custo real', () => {
    expect(r.kind).toBe('real')
    expect(r.weightBasis).toBe('trading')
    expect(r.pieces).toBe(200)
  })
  it('o total é exatamente o que saiu do banco', () => {
    expect(r.totalBrl).toBe(26200)
    expect(r.totalUsd).toBe(4700)
    expect(cents(sum(r.lines, l => l.brlTotal))).toBe(cents(26200))
    expect(cents(sum(r.models, m => m.brlTotal))).toBe(cents(26200))
  })
  it('câmbio efetivo é a média ponderada das parcelas, não a média simples', () => {
    expect(r.paidRate).toBeCloseTo(26200 / 4700, 6)   // 5,574 — e não 5,5
  })
  it('cada peça custa o valor da trading × câmbio efetivo', () => {
    const rate = 26200 / 4700
    const black = r.lines.find(l => l.colorCode === '1B')
    const copper = r.lines.find(l => l.colorCode === 'COPPER')
    expect(black.brlUnit).toBeCloseTo(25 * rate, 2)
    expect(copper.brlUnit).toBeCloseTo(28 * rate, 2)
    expect(black.usdUnit).toBeCloseTo(25, 2)
  })
  it('modelo com cores de preço diferente não é uniforme', () => {
    const a = r.models.find(m => m.itemId === 'a')
    const b = r.models.find(m => m.itemId === 'b')
    expect(a.uniform).toBe(false)
    expect(a.qty).toBe(150)
    expect(b.uniform).toBe(true)
  })
  it('fator real sobre o FOB', () => {
    // FOB = 150×15 + 50×10 = 2750 → 4700 / 2750
    expect(r.realMultiplier).toBeCloseTo(4700 / 2750, 6)
  })
})

describe('computeUnitCosts — quitado mas o pago não bate com o previsto', () => {
  it('pagou um pouco MENOS que o previsto e marcou como pago: vale o que pagou', () => {
    // caso real do NOVEMBRO 2025: sem valores da trading, FOB × 1,5 = previsto
    const order = {
      conversion_factor: 1.5,
      settled_at: '2026-06-01T00:00:00Z',
      items: [item('a', 20, [{ code: '1B', qty: 100 }]), item('b', 10, [{ code: '613', qty: 100 }])],
      payments: [{ amount_brl: 23400, rate_paid: 5.2, amount_usd: 4400 }],   // previsto: 4500
    }
    const r = computeUnitCosts(order, 5.5)
    expect(r.kind).toBe('real')
    expect(r.weightBasis).toBe('fob')
    expect(r.totalBrl).toBe(23400)
    expect(r.diffUsd).toBeCloseTo(-100, 6)
    expect(cents(sum(r.lines, l => l.brlTotal))).toBe(cents(23400))
    // modelo A vale o dobro do B por peça
    const a = r.models.find(m => m.itemId === 'a'), b = r.models.find(m => m.itemId === 'b')
    expect(a.brlUnit).toBeCloseTo(156, 2)
    expect(b.brlUnit).toBeCloseTo(78, 2)
    expect(r.realMultiplier).toBeCloseTo(4400 / 3000, 6)
  })
  it('pagou A MAIS (taxa/arredondamento): o excedente entra no custo', () => {
    const order = {
      items: [item('a', 10, [{ code: '1B', qty: 10, final_price_usd: 20 }])],
      payments: [{ amount_brl: 1060, rate_paid: 5, amount_usd: 212 }],
    }
    const r = computeUnitCosts(order, 5)
    expect(r.kind).toBe('real')
    expect(r.diffUsd).toBeCloseTo(12, 6)
    expect(r.lines[0].brlUnit).toBeCloseTo(106, 6)
  })
  it('marcado como pago com poucos pagamentos lançados: avisa e projeta o resto', () => {
    const order = {
      settled_at: '2026-06-01T00:00:00Z',
      items: [item('a', 10, [{ code: '1B', qty: 100, final_price_usd: 20 }])],   // 2000
      payments: [{ amount_brl: 5000, rate_paid: 5, amount_usd: 1000 }],
    }
    const r = computeUnitCosts(order, 6)
    expect(r.kind).toBe('partial')
    expect(r.missingPayments).toBe(true)
    expect(r.pendingUsd).toBe(1000)
    // o que falta é projetado no câmbio médio já pago (5), não na cotação do dia
    expect(r.totalBrl).toBe(10000)
  })
  it('marcado como pago sem nenhum pagamento lançado: só estimativa, com aviso', () => {
    const order = {
      settled_at: '2026-06-01T00:00:00Z',
      conversion_factor: 1.5,
      items: [item('a', 10, [{ code: '1B', qty: 100 }])],
      payments: [{ amount_brl: null, amount_usd: null }],
    }
    const r = computeUnitCosts(order, 5)
    expect(r.kind).toBe('estimate')
    expect(r.missingPayments).toBe(true)
    expect(r.emptyPayments).toBe(1)
    expect(r.totalBrl).toBe(7500)
  })
})

describe('computeUnitCosts — pedido em aberto', () => {
  const order = {
    budget_rate: 5.7,
    items: [item('a', 10, [{ code: '1B', qty: 100, final_price_usd: 20 }])],   // 2000
    payments: [{ amount_brl: 2500, rate_paid: 5, amount_usd: 500 }],
  }
  it('parte paga no câmbio real + resto no câmbio orçado', () => {
    const r = computeUnitCosts(order, 6)
    expect(r.kind).toBe('partial')
    expect(r.pendingUsd).toBe(1500)
    expect(r.totalBrl).toBe(2500 + 1500 * 5.7)
    expect(r.avgBrlUnit).toBeCloseTo((2500 + 8550) / 100, 6)
  })
  it('nada pago: estimativa', () => {
    const r = computeUnitCosts({ ...order, payments: [] }, 6)
    expect(r.kind).toBe('estimate')
    expect(r.totalBrl).toBe(2000 * 5.7)
  })
})

describe('computeUnitCosts — preços faltando', () => {
  it('pedido inteiro sem preço: divide igual por peça', () => {
    const order = {
      settled_at: '2026-06-01T00:00:00Z',
      items: [item('a', 0, [{ code: '1B', qty: 30 }]), item('b', 0, [{ code: '613', qty: 70 }])],
      payments: [{ amount_brl: 10000, rate_paid: 5, amount_usd: 2000 }],
    }
    const r = computeUnitCosts(order, 5)
    expect(r.kind).toBe('real')
    expect(r.weightBasis).toBe('pieces')
    expect(r.lines[0].brlUnit).toBeCloseTo(100, 6)
    expect(r.lines[1].brlUnit).toBeCloseTo(100, 6)
    expect(r.unpricedQty).toBe(0)
  })
  it('só uma linha sem preço: sinaliza quantas peças ficaram de fora', () => {
    const order = {
      items: [item('a', 10, [{ code: '1B', qty: 10, final_price_usd: 20 }]), item('b', 0, [{ code: '613', qty: 5 }])],
      payments: [{ amount_brl: 1000, rate_paid: 5, amount_usd: 200 }],
    }
    const r = computeUnitCosts(order, 5)
    expect(r.unpricedQty).toBe(5)
    expect(r.lines.find(l => l.colorCode === '613').hasPrice).toBe(false)
    expect(cents(sum(r.lines, l => l.brlTotal))).toBe(cents(1000))
  })
  it('previsão com peças sem preço: a média considera só as que têm preço', () => {
    const order = {
      conversion_factor: 1.5, budget_rate: 5,
      items: [item('a', 10, [{ code: '1B', qty: 10 }]), item('b', 0, [{ code: '613', qty: 90 }])],
      payments: [],
    }
    const r = computeUnitCosts(order, 5)
    expect(r.kind).toBe('estimate')
    expect(r.unpricedQty).toBe(90)
    expect(r.avgBrlUnit).toBeCloseTo(75, 6)   // 10 × 1,5 × 5 — e não 7,50 diluído em 100 peças
  })
  it('centavos quebrados continuam fechando', () => {
    const order = {
      items: [item('a', 7, [{ code: 'A', qty: 3, final_price_usd: 7.77 }, { code: 'B', qty: 7, final_price_usd: 9.13 }, { code: 'C', qty: 11, final_price_usd: 11.01 }])],
      payments: [{ amount_brl: 1234.57, rate_paid: 5.4321, amount_usd: 208.33 }],
      settled_at: '2026-06-01T00:00:00Z',
    }
    const r = computeUnitCosts(order, 5)
    expect(cents(sum(r.lines, l => l.brlTotal))).toBe(123457)
    expect(cents(sum(r.lines, l => l.usdTotal))).toBe(20833)
  })
})
