// src/lib/suppliers.test.js — v13.84 (marcas parceiras: pedido em reais)
import { describe, it, expect } from 'vitest'
import { computeOrderBalance, computeOrderFinal, computePendingSummary, computeUnpaidOrders, computeAvgRate, flattenPayments } from './financial'
import { orderMoney, formatMoney, supplierByName, isBrandOrder, orderCurrency } from './suppliers'
import { validatePayment } from './payments'

const brandOrder = (extra = {}) => ({
  id: 'b1', kind: 'brand', currency: 'BRL', factory: 'SLICK', status: 'manufacturing',
  items: [
    { id: 'i1', product_id: 'p1', price_brl: 300, colors: [{ code: '1B', qty: 10 }, { code: '613', qty: 5, price_brl: 360 }] },
    { id: 'i2', product_id: 'p2', colors: [{ code: '2', qty: 4 }] },   // sem preço ainda
  ],
  payments: [{ amount_brl: 2000, payment_date: '2026-10-01' }],
  ...extra,
})

describe('pedido de marca em reais', () => {
  it('total vem do preço em reais (cor > modelo), sem fator de trading', () => {
    const f = computeOrderFinal(brandOrder())
    expect(f.currency).toBe('BRL')
    expect(f.total).toBe(10 * 300 + 5 * 360)
    expect(f.unpricedQty).toBe(4)
    expect(f.isFullyConfirmed).toBe(false)
    expect(f.fobTotal).toBe(0)
  })
  it('saldo exato em reais; dólar é só equivalente', () => {
    const b = computeOrderBalance(brandOrder(), 5)
    expect(b.isBrl).toBe(true)
    expect(b.totalBrl).toBe(4800)
    expect(b.paidBrl).toBe(2000)
    expect(b.remainingBrl).toBe(2800)
    expect(b.remainingUsd).toBeCloseTo(560, 6)
    expect(b.percentPaid).toBeCloseTo(2000 / 4800 * 100, 6)
    expect(b.isSettled).toBe(false)
    expect(orderMoney(b)).toEqual({ currency: 'BRL', total: 4800, paid: 2000, remaining: 2800 })
  })
  it('sem cotação o saldo em reais continua certo', () => {
    const b = computeOrderBalance(brandOrder(), undefined)
    expect(b.remainingBrl).toBe(2800)
    expect(b.total).toBe(0)
  })
  it('quita quando pago ≥ total, ou à mão', () => {
    expect(computeOrderBalance(brandOrder({ payments: [{ amount_brl: 4800 }] }), 5).isSettled).toBe(true)
    const m = computeOrderBalance(brandOrder({ settled_at: '2026-11-01T00:00:00Z' }), 5)
    expect(m.isSettled).toBe(true)
    expect(m.remainingBrl).toBe(0)
  })
  it('entra no consolidado e na lista de não pagos mesmo sem cotação', () => {
    expect(computeUnpaidOrders([brandOrder()]).length).toBe(1)
    expect(computeUnpaidOrders([brandOrder()])[0].currency).toBe('BRL')
    const s = computePendingSummary([brandOrder()], 5)
    expect(s.totalRemainingBrl).toBe(2800)
  })
  it('pagamento em reais não distorce o câmbio médio das fábricas', () => {
    const factory = { id: 'f1', currency: 'USD', payments: [{ amount_brl: 5000, amount_usd: 1000 }] }
    const all = flattenPayments([factory, brandOrder()])
    expect(all.find(p => p._orderId === 'b1')._currency).toBe('BRL')
    expect(computeAvgRate(all)).toBe(5)
  })
  it('pedido de fábrica continua igual', () => {
    const o = { currency: 'USD', conversion_factor: 1.5, items: [{ id: 'x', price_usd: 10, colors: [{ code: '1B', qty: 10 }] }], payments: [] }
    const b = computeOrderBalance(o, 5)
    expect(b.currency).toBe('USD')
    expect(b.total).toBe(150)
    expect(orderMoney(b).currency).toBe('USD')
  })
})

describe('pagamento de pedido em reais', () => {
  it('não exige câmbio', () => {
    expect(validatePayment({ payment_date: '2026-11-01', amount_brl: 2500 }, { brlOnly: true })).toBe(null)
    expect(validatePayment({ payment_date: '2026-11-01', amount_brl: 2500 })).toMatch(/câmbio/)
    expect(validatePayment({ payment_date: '2026-11-01', amount_brl: null }, { brlOnly: true })).toMatch(/reais/)
  })
})

describe('helpers', () => {
  it('formatMoney', () => {
    expect(formatMoney(1234.5, 'BRL')).toBe('R$ 1.234,50')
    expect(formatMoney(1234.5, 'USD')).toBe('US$ 1.234,50')
  })
  it('supplierByName ignora maiúscula e espaço', () => {
    expect(supplierByName([{ name: 'Slick', kind: 'brand' }], ' SLICK ')?.kind).toBe('brand')
  })
  it('tipo e moeda do pedido', () => {
    expect(isBrandOrder({ kind: 'brand' })).toBe(true)
    expect(isBrandOrder({})).toBe(false)
    expect(orderCurrency({})).toBe('USD')
    expect(orderCurrency({ currency: 'BRL' })).toBe('BRL')
  })
})
