// src/lib/financial.test.js
// Testes pros cálculos financeiros centralizados.
// Foco em casos de borda + comportamento conhecido pelo usuário.

import { describe, it, expect } from 'vitest'
import {
  flattenPayments, filterPaymentsByPeriod, computeAvgRate, computeTotals,
  computeRateComparison, topFactoriesByGasto, computeOrderFOB, computeOrderPaid,
  computeUnpaidOrders, computeMissingReceipts, computeMonthlyTrend,
  computeCashflowProjection, sumRemaining,
} from './financial'

// Helpers pra montar fixtures
const order = (overrides = {}) => ({
  id: 'o1',
  factory: 'EPF',
  status: 'manufacturing',
  order_name: 'Pedido 1',
  created_at: '2026-03-01T00:00:00Z',
  items: [],
  payments: [],
  ...overrides,
})

const payment = (overrides = {}) => ({
  id: 'p1',
  amount_usd: '1000',
  amount_brl: '5000',
  payment_date: '2026-03-15T00:00:00Z',
  receipt_url: null,
  bank: 'Wise',
  ...overrides,
})

describe('flattenPayments', () => {
  it('retorna [] pra entrada vazia', () => {
    expect(flattenPayments([])).toEqual([])
    expect(flattenPayments()).toEqual([])
  })
  
  it('achata pagamentos preservando referências do pedido', () => {
    const orders = [
      order({ id: 'o1', factory: 'EPF', payments: [payment({ id: 'p1' }), payment({ id: 'p2' })] }),
      order({ id: 'o2', factory: 'Hairchuan', payments: [payment({ id: 'p3' })] }),
    ]
    const flat = flattenPayments(orders)
    expect(flat).toHaveLength(3)
    expect(flat[0]._orderId).toBe('o1')
    expect(flat[0]._factory).toBe('EPF')
    expect(flat[2]._factory).toBe('Hairchuan')
  })
  
  it('pedido sem payments não quebra', () => {
    expect(flattenPayments([order()])).toEqual([])
    expect(flattenPayments([order({ payments: null })])).toEqual([])
  })
})

describe('filterPaymentsByPeriod', () => {
  const old = payment({ payment_date: '2024-01-01T00:00:00Z' })
  const recent = payment({ payment_date: new Date().toISOString() })
  
  it('retorna tudo se days é null/undefined', () => {
    expect(filterPaymentsByPeriod([old, recent], null)).toHaveLength(2)
    expect(filterPaymentsByPeriod([old, recent])).toHaveLength(2)
  })
  
  it('filtra apenas dentro do período em dias', () => {
    const r = filterPaymentsByPeriod([old, recent], 30)
    expect(r).toHaveLength(1)
    expect(r[0]).toBe(recent)
  })
  
  it('payment sem data é ignorado', () => {
    const noDate = payment({ payment_date: null, created_at: null })
    const r = filterPaymentsByPeriod([noDate, recent], 30)
    expect(r).toHaveLength(1)
  })
})

describe('computeAvgRate', () => {
  it('retorna 0 pra lista vazia', () => {
    expect(computeAvgRate([])).toBe(0)
  })
  
  it('calcula câmbio médio ponderado', () => {
    const ps = [
      payment({ amount_usd: '100', amount_brl: '500' }),  // 5.00
      payment({ amount_usd: '200', amount_brl: '1200' }), // 6.00
    ]
    // ponderado: (500+1200) / (100+200) = 1700/300 = 5.6667
    expect(computeAvgRate(ps)).toBeCloseTo(5.6667, 3)
  })
  
  it('ignora pagamentos sem USD ou sem BRL', () => {
    const ps = [
      payment({ amount_usd: '100', amount_brl: '500' }),
      payment({ amount_usd: '0', amount_brl: '0' }),       // ignorado
      payment({ amount_usd: '200', amount_brl: null }),    // ignorado
    ]
    expect(computeAvgRate(ps)).toBeCloseTo(5.0, 3)
  })
  
  it('retorna 0 se nenhum pagamento tem USD+BRL válidos', () => {
    const ps = [
      payment({ amount_usd: '100', amount_brl: '0' }),
      payment({ amount_usd: '0', amount_brl: '500' }),
    ]
    expect(computeAvgRate(ps)).toBe(0)
  })
})

describe('computeTotals', () => {
  it('soma USD e BRL', () => {
    const ps = [
      payment({ amount_usd: '100', amount_brl: '500' }),
      payment({ amount_usd: '50', amount_brl: '250' }),
    ]
    expect(computeTotals(ps)).toEqual({ usd: 150, brl: 750 })
  })
  
  it('lida com strings e números mistos', () => {
    const ps = [
      payment({ amount_usd: 100, amount_brl: 500 }),
      payment({ amount_usd: '50.5', amount_brl: '250.25' }),
    ]
    expect(computeTotals(ps).usd).toBeCloseTo(150.5)
    expect(computeTotals(ps).brl).toBeCloseTo(750.25)
  })
  
  it('lista vazia retorna zeros', () => {
    expect(computeTotals([])).toEqual({ usd: 0, brl: 0 })
  })
})

describe('topFactoriesByGasto', () => {
  it('agrupa e ordena por gasto', () => {
    const ps = [
      { ...payment({ amount_usd: '100' }), _factory: 'EPF' },
      { ...payment({ amount_usd: '300' }), _factory: 'Hairchuan' },
      { ...payment({ amount_usd: '200' }), _factory: 'EPF' },
    ]
    const r = topFactoriesByGasto(ps)
    expect(r[0].factory).toBe('EPF')   // 100+200=300
    expect(r[0].totalUsd).toBe(300)
    expect(r[0].paymentsCount).toBe(2)
    expect(r[1].factory).toBe('Hairchuan')
    expect(r[1].totalUsd).toBe(300)
    // tie-breaker: ordem de inserção (EPF apareceu primeiro)
  })
  
  it('respeita limit', () => {
    const ps = ['A', 'B', 'C', 'D'].map(f => ({ ...payment(), _factory: f }))
    expect(topFactoriesByGasto(ps, 2)).toHaveLength(2)
  })
  
  it('ignora payments sem _factory ou sem USD', () => {
    const ps = [
      { ...payment({ amount_usd: '100' }), _factory: null },
      { ...payment({ amount_usd: '0' }), _factory: 'EPF' },
      { ...payment({ amount_usd: '50' }), _factory: 'EPF' },
    ]
    expect(topFactoriesByGasto(ps)).toHaveLength(1)
    expect(topFactoriesByGasto(ps)[0].totalUsd).toBe(50)
  })
})

describe('computeOrderFOB', () => {
  it('soma corretamente colors com qty', () => {
    const o = order({
      items: [
        { price_usd_snapshot: 10, colors: [{ qty: 3 }, { qty: 2 }] },  // 10*5=50
        { price_usd_snapshot: 20, colors: [{ qty: 1 }] },              // 20*1=20
      ],
    })
    expect(computeOrderFOB(o)).toBe(70)
  })
  
  it('preço por cor sobrescreve preço do item', () => {
    const o = order({
      items: [
        { price_usd_snapshot: 10, colors: [
          { qty: 1, price_usd: 50 },  // usa 50
          { qty: 2 },                 // usa 10 do item
        ]},
      ],
    })
    expect(computeOrderFOB(o)).toBe(50 + 20)
  })
  
  it('item sem cores usa quantity', () => {
    const o = order({
      items: [
        { price_usd_snapshot: 15, quantity: 4, colors: [] },
      ],
    })
    expect(computeOrderFOB(o)).toBe(60)
  })
  
  it('snapshot tem prioridade sobre price_usd ativo', () => {
    const o = order({
      items: [{ price_usd_snapshot: 10, price_usd: 999, colors: [{ qty: 1 }] }],
    })
    expect(computeOrderFOB(o)).toBe(10)
  })
  
  it('pedido sem items retorna 0', () => {
    expect(computeOrderFOB(order())).toBe(0)
  })
})

describe('computeOrderPaid', () => {
  it('soma USD de todos os payments', () => {
    const o = order({ payments: [payment({ amount_usd: '100' }), payment({ amount_usd: '50' })] })
    expect(computeOrderPaid(o)).toBe(150)
  })
  
  it('pedido sem payments retorna 0', () => {
    expect(computeOrderPaid(order())).toBe(0)
  })
})

describe('computeUnpaidOrders', () => {
  it('marca completed sem pagar como CRÍTICO', () => {
    const o = order({
      status: 'completed',
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [],
    })
    const r = computeUnpaidOrders([o])
    expect(r).toHaveLength(1)
    expect(r[0].isCritical).toBe(true)
    expect(r[0].remaining).toBe(100)
  })
  
  it('manufacturing parcialmente pago entra na lista', () => {
    const o = order({
      status: 'manufacturing',
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [payment({ amount_usd: '40' })],
    })
    const r = computeUnpaidOrders([o])
    expect(r).toHaveLength(1)
    expect(r[0].remaining).toBe(60)
    expect(r[0].percentPaid).toBe(40)
    expect(r[0].isCritical).toBe(false)
  })
  
  it('totalmente pago não entra', () => {
    const o = order({
      status: 'manufacturing',
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [payment({ amount_usd: '100' })],
    })
    expect(computeUnpaidOrders([o])).toEqual([])
  })
  
  it('draft/cancelled não entra', () => {
    const drafts = [
      order({ status: 'draft', items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }] }),
      order({ status: 'cancelled', items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }] }),
    ]
    expect(computeUnpaidOrders(drafts)).toEqual([])
  })
  
  it('ordena críticos primeiro, depois por maior remaining', () => {
    const orders = [
      order({ id: 'o1', status: 'manufacturing', items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }], payments: [] }),
      order({ id: 'o2', status: 'completed',   items: [{ price_usd_snapshot: 50,  colors: [{ qty: 1 }] }], payments: [] }),
      order({ id: 'o3', status: 'manufacturing', items: [{ price_usd_snapshot: 200, colors: [{ qty: 1 }] }], payments: [] }),
    ]
    const r = computeUnpaidOrders(orders)
    expect(r[0].id).toBe('o2')  // crítico primeiro mesmo com remaining menor
    expect(r[1].id).toBe('o3')  // depois maior remaining (200)
    expect(r[2].id).toBe('o1')  // por último menor remaining (100)
  })
})

describe('computeMissingReceipts', () => {
  it('conta apenas em manufacturing/completed', () => {
    const orders = [
      order({ id: 'o1', status: 'manufacturing', payments: [payment({ amount_usd: '100', receipt_url: null })] }),
      order({ id: 'o2', status: 'completed',     payments: [payment({ amount_usd: '50',  receipt_url: null })] }),
      order({ id: 'o3', status: 'draft',         payments: [payment({ amount_usd: '200', receipt_url: null })] }),  // ignorado
      order({ id: 'o4', status: 'sent',          payments: [payment({ amount_usd: '200', receipt_url: null })] }),  // ignorado
    ]
    const r = computeMissingReceipts(orders)
    expect(r.paymentsCount).toBe(2)
    expect(r.ordersCount).toBe(2)
  })
  
  it('ignora pagamentos com receipt', () => {
    const o = order({
      status: 'manufacturing',
      payments: [
        payment({ amount_usd: '100', receipt_url: 'http://...' }),
        payment({ amount_usd: '50', receipt_url: null }),
      ],
    })
    const r = computeMissingReceipts([o])
    expect(r.paymentsCount).toBe(1)
    expect(r.ordersCount).toBe(1)
  })
  
  it('ignora pagamentos com USD = 0', () => {
    const o = order({
      status: 'manufacturing',
      payments: [payment({ amount_usd: '0', receipt_url: null })],
    })
    expect(computeMissingReceipts([o]).paymentsCount).toBe(0)
  })
})

describe('sumRemaining', () => {
  it('soma remaining de uma lista', () => {
    expect(sumRemaining([{ remaining: 100 }, { remaining: 50 }])).toBe(150)
  })
  
  it('lista vazia → 0', () => {
    expect(sumRemaining([])).toBe(0)
  })
})

describe('computeCashflowProjection', () => {
  const today = Date.now()
  const daysFromNow = (n) => new Date(today + n * 86400000).toISOString()
  
  it('completed sem pagar vai pra next30d com flag urgent', () => {
    const o = order({
      status: 'completed',
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [],
    })
    const b = computeCashflowProjection([o])
    expect(b.next30d).toHaveLength(1)
    expect(b.next30d[0]._bucket).toBe('urgent')
  })
  
  it('manufacturing com expected_arrival em 15 dias vai pra next30d', () => {
    const o = order({
      status: 'manufacturing',
      expected_arrival: daysFromNow(15),
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [],
    })
    expect(computeCashflowProjection([o]).next30d).toHaveLength(1)
  })
  
  it('manufacturing com expected_arrival em 45 dias vai pra next60d', () => {
    const o = order({
      status: 'manufacturing',
      expected_arrival: daysFromNow(45),
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [],
    })
    expect(computeCashflowProjection([o]).next60d).toHaveLength(1)
  })
  
  it('sem expected_arrival vai pra noDate', () => {
    const o = order({
      status: 'manufacturing',
      expected_arrival: null,
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [],
    })
    expect(computeCashflowProjection([o]).noDate).toHaveLength(1)
  })
})

describe('computeMonthlyTrend', () => {
  it('agrupa por YYYY-MM', () => {
    const ps = [
      payment({ payment_date: '2026-01-15T00:00:00Z', amount_usd: '100', amount_brl: '500' }),
      payment({ payment_date: '2026-01-25T00:00:00Z', amount_usd: '50',  amount_brl: '250' }),
      payment({ payment_date: '2026-02-10T00:00:00Z', amount_usd: '200', amount_brl: '1000' }),
    ]
    const r = computeMonthlyTrend(ps, 12)
    expect(r).toHaveLength(2)
    expect(r[0].month).toBe('2026-01')
    expect(r[0].usd).toBe(150)
    expect(r[0].count).toBe(2)
    expect(r[1].month).toBe('2026-02')
    expect(r[1].usd).toBe(200)
  })
  
  it('ordena cronologicamente', () => {
    const ps = [
      payment({ payment_date: '2026-03-01T00:00:00Z' }),
      payment({ payment_date: '2026-01-01T00:00:00Z' }),
      payment({ payment_date: '2026-02-01T00:00:00Z' }),
    ]
    const r = computeMonthlyTrend(ps)
    expect(r.map(x => x.month)).toEqual(['2026-01', '2026-02', '2026-03'])
  })
})
