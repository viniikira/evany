// src/lib/payments.test.js — v13.77 (números reais do NOVEMBRO 2025)
import { describe, it, expect } from 'vitest'
import { parseBR, formatMoneyBR, formatRateBR, resolveAmounts, sortPaymentsChrono, summarizePayments, isEmptyPayment, validatePayment } from './payments'

describe('parseBR — aceita do jeito que ela digitar', () => {
  it('formato brasileiro', () => {
    expect(parseBR('17.999,98')).toBe(17999.98)
    expect(parseBR('R$ 17.999,98')).toBe(17999.98)
    expect(parseBR('17999,98')).toBe(17999.98)
    expect(parseBR('1.234.567,8')).toBe(1234567.8)
  })
  it('formato com ponto decimal', () => {
    expect(parseBR('17999.98')).toBe(17999.98)
    expect(parseBR('3,592.81')).toBe(3592.81)
  })
  it('ponto antes de 3 dígitos é milhar em dinheiro', () => {
    expect(parseBR('17.999')).toBe(17999)
  })
  it('câmbio: ponto ou vírgula são sempre decimais', () => {
    expect(parseBR('5,01', { money: false })).toBe(5.01)
    expect(parseBR('5.01', { money: false })).toBe(5.01)
    expect(parseBR('5.012', { money: false })).toBe(5.012)
  })
  it('vazio ou lixo vira null', () => {
    expect(parseBR('')).toBe(null)
    expect(parseBR('abc')).toBe(null)
    expect(parseBR(null)).toBe(null)
  })
})

describe('formatação', () => {
  it('dinheiro com milhar e 2 casas', () => {
    expect(formatMoneyBR(17999.98)).toBe('17.999,98')
    expect(formatMoneyBR(3592.8)).toBe('3.592,80')
  })
  it('câmbio com 2 a 4 casas', () => {
    expect(formatRateBR(5.01)).toBe('5,01')
    expect(formatRateBR(5.1628)).toBe('5,1628')
  })
})

describe('resolveAmounts — R$ ÷ câmbio = US$', () => {
  it('caso normal: pagou em reais com a cotação do dia', () => {
    expect(resolveAmounts({ brl: 17999.98, rate: 5.01 })).toMatchObject({ usd: 3592.81, derived: 'usd' })
  })
  it('digitou o US$ por último: o câmbio é recalculado', () => {
    const r = resolveAmounts({ brl: 23380.68, rate: 5.3, usd: 4362.07, lastEdited: 'usd' })
    expect(r.rate).toBe(5.36)
    expect(r.derived).toBe('rate')
  })
  it('só US$ e câmbio: calcula os reais', () => {
    expect(resolveAmounts({ usd: 4274.99, rate: 5.09 })).toMatchObject({ brl: 21759.7, derived: 'brl' })
  })
  it('faltando dados não inventa nada', () => {
    expect(resolveAmounts({ brl: 1000 })).toMatchObject({ usd: null, derived: null })
  })
})

describe('ordem — do mais antigo pro mais novo', () => {
  const pays = [
    { id: 'c', payment_date: '2026-10-13', created_at: '2026-10-13T10:00:00Z' },
    { id: 'b', payment_date: '2026-07-15', created_at: '2026-07-15T10:00:00Z' },
    { id: 'vazio', payment_date: null, created_at: '2026-08-01T10:00:00Z' },
    { id: 'a', payment_date: '2025-11-17', created_at: '2026-04-20T10:00:00Z' },
  ]
  it('ordena pela data do pagamento, sem data no fim', () => {
    expect(sortPaymentsChrono(pays).map(p => p.id)).toEqual(['a', 'b', 'c', 'vazio'])
  })
  it('não depende do valor', () => {
    const r = sortPaymentsChrono([
      { id: 'grande', payment_date: '2026-03-26', amount_brl: 25221.17, created_at: '1' },
      { id: 'pequeno', payment_date: '2026-03-26', amount_brl: 729.47, created_at: '0' },
    ])
    expect(r.map(p => p.id)).toEqual(['pequeno', 'grande'])   // mesmo dia: ordem de lançamento
  })
  it('não altera a lista original', () => {
    const copy = [...pays]
    sortPaymentsChrono(pays)
    expect(pays).toEqual(copy)
  })
})

describe('resumo', () => {
  it('soma, câmbio médio e conta os incompletos', () => {
    const s = summarizePayments([
      { payment_date: '2025-11-17', amount_brl: 23380.68, amount_usd: 4362.07 },
      { payment_date: '2026-07-15', amount_brl: 21759.7, amount_usd: 4274.99 },
      { payment_date: '2026-10-13', amount_brl: 17999.98, amount_usd: 3592.81 },
      { payment_date: null, amount_brl: null, amount_usd: null },
    ])
    expect(s.count).toBe(3)
    expect(s.brl).toBe(63140.36)
    expect(s.usd).toBe(12229.87)
    expect(s.avgRate).toBeCloseTo(5.1628, 3)
    expect(s.incomplete).toBe(1)
  })
  it('registro vazio é reconhecido', () => {
    expect(isEmptyPayment({ amount_brl: null, amount_usd: null })).toBe(true)
    expect(isEmptyPayment({ amount_brl: 10 })).toBe(false)
  })
})

describe('validação', () => {
  it('exige data e valor', () => {
    expect(validatePayment({ amount_brl: 100, amount_usd: 20 })).toMatch(/data/)
    expect(validatePayment({ payment_date: '2026-10-13' })).toMatch(/reais/)
  })
  it('reais sem câmbio nem dólar pede o câmbio', () => {
    expect(validatePayment({ payment_date: '2026-10-13', amount_brl: 100 })).toMatch(/câmbio/)
  })
  it('câmbio absurdo (digitou 501 em vez de 5,01)', () => {
    expect(validatePayment({ payment_date: '2026-10-13', amount_brl: 100, amount_usd: 0.2, rate_paid: 501 })).toMatch(/errado/)
  })
  it('pagamento completo passa', () => {
    expect(validatePayment({ payment_date: '2026-10-13', amount_brl: 17999.98, amount_usd: 3592.81, rate_paid: 5.01 })).toBe(null)
  })
})
