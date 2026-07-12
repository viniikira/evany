// src/lib/orderIntelligence.test.js
// v13.50 — Testa as sugestões de criação a partir do histórico.

import { describe, it, expect } from 'vitest'
import {
  suggestQuantity,
  suggestColorsForModel,
  inFlightForModel,
  priceSignalForModel,
} from './orderIntelligence'

const order = (over) => ({
  id: 'o' + Math.round(over._n ?? 1),
  status: 'completed',
  created_at: '2026-05-01T00:00:00Z',
  order_date: null,
  deleted_at: null,
  purged_at: null,
  factory: 'EPF',
  items: [],
  ...over,
})

// LARA pedida 3x: cor 2 (20, 30) e 99J (10)
const orders = [
  order({ _n: 1, order_date: '2026-03-01', status: 'completed', items: [
    { product_id: 'p1', price_usd_snapshot: 18, colors: [{ code: '2', qty: 20 }, { code: '99J', qty: 10 }] },
  ] }),
  order({ _n: 2, order_date: '2026-05-01', status: 'completed', items: [
    { product_id: 'p1', price_usd_snapshot: 20, colors: [{ code: '2', qty: 30 }] },
  ] }),
  // rascunho não conta como demanda histórica
  order({ _n: 3, order_date: '2026-06-01', status: 'draft', items: [
    { product_id: 'p1', price_usd_snapshot: 99, colors: [{ code: '2', qty: 999 }] },
  ] }),
  // pedido a caminho (in_transit)
  order({ _n: 4, order_date: '2026-06-20', status: 'in_transit', expected_arrival: '2026-08-01', items: [
    { product_id: 'p1', price_usd_snapshot: 21, colors: [{ code: '613', qty: 25 }] },
  ] }),
]

describe('suggestQuantity', () => {
  it('média das quantidades históricas de um modelo+cor', () => {
    const r = suggestQuantity('p1', '2', orders)
    expect(r.avg).toBe(25)   // (20 + 30) / 2
    expect(r.count).toBe(2)
    expect(r.last).toBe(30)  // pedido mais recente (maio)
  })

  it('ignora rascunho (999 não entra)', () => {
    const r = suggestQuantity('p1', '2', orders)
    expect(r.avg).toBe(25)
  })

  it('matching de cor é case-insensitive', () => {
    expect(suggestQuantity('p1', '99j', orders).avg).toBe(10)
  })

  it('retorna null quando não há histórico da combinação', () => {
    expect(suggestQuantity('p1', 'INEXISTENTE', orders)).toBeNull()
    expect(suggestQuantity(null, '2', orders)).toBeNull()
  })
})

describe('suggestColorsForModel', () => {
  it('ranqueia cores por frequência e traz média/última', () => {
    const r = suggestColorsForModel('p1', orders)
    // cor 2 (2x) vem antes de 99J (1x); 613 é in_transit → conta como histórico? não: in_transit está em HISTORICAL
    const cor2 = r.find(c => c.code === '2')
    expect(cor2.count).toBe(2)
    expect(cor2.avgQty).toBe(25)
    expect(r[0].code).toBe('2') // mais frequente primeiro
  })

  it('inclui cor de pedido a caminho (in_transit conta como demanda)', () => {
    const r = suggestColorsForModel('p1', orders)
    expect(r.some(c => c.code === '613')).toBe(true)
  })

  it('não inclui cor de rascunho', () => {
    const r = suggestColorsForModel('p1', orders)
    const total = r.reduce((a, c) => a + c.totalQty, 0)
    expect(total).toBe(20 + 30 + 10 + 25) // sem os 999 do rascunho
  })
})

describe('inFlightForModel', () => {
  it('lista pedidos a caminho que contêm o modelo', () => {
    const r = inFlightForModel('p1', orders)
    expect(r).toHaveLength(1)
    expect(r[0].status).toBe('in_transit')
    expect(r[0].expectedArrival).toBe('2026-08-01')
    expect(r[0].colors).toEqual([{ code: '613', qty: 25 }])
  })

  it('não inclui concluídos nem rascunhos', () => {
    const r = inFlightForModel('p1', orders)
    expect(r.every(o => o.status === 'in_transit')).toBe(true)
  })

  it('respeita excludeOrderId', () => {
    expect(inFlightForModel('p1', orders, { excludeOrderId: 'o4' })).toHaveLength(0)
  })
})

describe('priceSignalForModel', () => {
  it('traz último preço e contagem do histórico', () => {
    const sig = priceSignalForModel('p1', orders)
    expect(sig).not.toBeNull()
    expect(sig.count).toBeGreaterThanOrEqual(2)
    expect(typeof sig.lastPrice).toBe('number')
  })

  it('retorna null sem histórico de preço', () => {
    expect(priceSignalForModel('inexistente', orders)).toBeNull()
  })
})
