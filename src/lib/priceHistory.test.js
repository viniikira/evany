// src/lib/priceHistory.test.js
// v13.33 — Testes pra histórico de preço (lógica pura)

import { describe, it, expect } from 'vitest'
import { buildProductPriceHistory, computePriceStats, computePriceTrend } from './priceHistory'

const order = (o = {}) => ({
  id: 'o1', factory: 'EPF', status: 'manufacturing',
  order_name: 'P1', created_at: '2026-01-15T00:00:00Z',
  items: [], purged_at: null,
  ...o,
})

describe('buildProductPriceHistory', () => {
  it('retorna [] se sem productId', () => {
    expect(buildProductPriceHistory(null, [])).toEqual([])
    expect(buildProductPriceHistory('', [])).toEqual([])
  })
  
  it('retorna [] se sem pedidos', () => {
    expect(buildProductPriceHistory('p1', [])).toEqual([])
  })
  
  it('extrai 1 ponto por pedido com price_usd_snapshot do item', () => {
    const orders = [
      order({ id: 'o1', items: [{ product_id: 'p1', price_usd_snapshot: '15.50', colors: [{ qty: 1 }] }] }),
      order({ id: 'o2', created_at: '2026-02-15T00:00:00Z', items: [{ product_id: 'p1', price_usd_snapshot: '16.00', colors: [{ qty: 1 }] }] }),
    ]
    const r = buildProductPriceHistory('p1', orders)
    expect(r).toHaveLength(2)
    expect(r[0].priceUsd).toBe(15.50)
    expect(r[1].priceUsd).toBe(16.00)
  })
  
  it('ordena cronologicamente do mais antigo', () => {
    const orders = [
      order({ id: 'o2', created_at: '2026-03-01T00:00:00Z', items: [{ product_id: 'p1', price_usd_snapshot: '20', colors: [{ qty: 1 }] }] }),
      order({ id: 'o1', created_at: '2026-01-01T00:00:00Z', items: [{ product_id: 'p1', price_usd_snapshot: '10', colors: [{ qty: 1 }] }] }),
    ]
    const r = buildProductPriceHistory('p1', orders)
    expect(r[0].priceUsd).toBe(10)
    expect(r[1].priceUsd).toBe(20)
  })
  
  it('preço por cor diferente do item gera ponto separado', () => {
    const orders = [
      order({
        items: [{
          product_id: 'p1',
          price_usd_snapshot: '15',
          colors: [
            { code: '1B', qty: 1, price_usd: 15 },     // igual ao item — usa item
            { code: '27', qty: 1, price_usd: 18 },     // diferente — gera ponto próprio
          ],
        }],
      }),
    ]
    const r = buildProductPriceHistory('p1', orders)
    // 1 ponto da cor 27 (preço diferente) + 1 ponto do item (cores não cobriram tudo)
    // Mas a regra é: registeredColorPrices=true se PELO MENOS 1 cor teve preço diferente,
    // então item não é registrado. Vou ler o código novamente pra ter certeza...
    // Pelo código: se registeredColorPrices, NÃO registra preço do item
    expect(r).toHaveLength(1)
    expect(r[0].priceUsd).toBe(18)
    expect(r[0].colorCode).toBe('27')
  })
  
  it('cores todas com preço igual ao item: registra preço do item', () => {
    const orders = [
      order({
        items: [{
          product_id: 'p1',
          price_usd_snapshot: '15',
          colors: [
            { code: '1B', qty: 1, price_usd: 15 },
            { code: '27', qty: 1, price_usd: 15 },
          ],
        }],
      }),
    ]
    const r = buildProductPriceHistory('p1', orders)
    expect(r).toHaveLength(1)
    expect(r[0].source).toBe('item')
  })
  
  it('cores sem price_usd: registra preço do item', () => {
    const orders = [
      order({
        items: [{
          product_id: 'p1',
          price_usd_snapshot: '15',
          colors: [{ code: '1B', qty: 1 }],
        }],
      }),
    ]
    const r = buildProductPriceHistory('p1', orders)
    expect(r).toHaveLength(1)
    expect(r[0].priceUsd).toBe(15)
  })
  
  it('ignora pedidos cancelados ou purgados', () => {
    const orders = [
      order({ id: 'o1', status: 'cancelled', items: [{ product_id: 'p1', price_usd_snapshot: '10', colors: [{ qty: 1 }] }] }),
      order({ id: 'o2', purged_at: '2026-02-01', items: [{ product_id: 'p1', price_usd_snapshot: '11', colors: [{ qty: 1 }] }] }),
      order({ id: 'o3', items: [{ product_id: 'p1', price_usd_snapshot: '12', colors: [{ qty: 1 }] }] }),
    ]
    const r = buildProductPriceHistory('p1', orders)
    expect(r).toHaveLength(1)
    expect(r[0].priceUsd).toBe(12)
  })
  
  it('ignora itens de outros produtos', () => {
    const orders = [
      order({ items: [
        { product_id: 'p1', price_usd_snapshot: '10', colors: [{ qty: 1 }] },
        { product_id: 'p2', price_usd_snapshot: '99', colors: [{ qty: 1 }] },
      ]}),
    ]
    const r = buildProductPriceHistory('p1', orders)
    expect(r).toHaveLength(1)
    expect(r[0].priceUsd).toBe(10)
  })
  
  it('ignora pedido sem created_at', () => {
    const orders = [
      order({ created_at: null, items: [{ product_id: 'p1', price_usd_snapshot: '10', colors: [{ qty: 1 }] }] }),
    ]
    expect(buildProductPriceHistory('p1', orders)).toEqual([])
  })
  
  it('item sem snapshot E sem cores próprias: não gera ponto', () => {
    const orders = [
      order({ items: [{ product_id: 'p1', colors: [{ qty: 1 }] }] }),  // sem price_usd_snapshot
    ]
    expect(buildProductPriceHistory('p1', orders)).toEqual([])
  })
})

describe('computePriceStats', () => {
  it('retorna defaults pra histórico vazio', () => {
    const r = computePriceStats([])
    expect(r.count).toBe(0)
    expect(r.first).toBeNull()
    expect(r.last).toBeNull()
    expect(r.avg).toBeNull()
    expect(r.changePct).toBeNull()
    expect(r.hasIncreaseAlert).toBe(false)
  })
  
  it('calcula min, max, avg corretos', () => {
    const h = [
      { priceUsd: 10, date: '2026-01-01' },
      { priceUsd: 15, date: '2026-02-01' },
      { priceUsd: 20, date: '2026-03-01' },
    ]
    const r = computePriceStats(h)
    expect(r.min).toBe(10)
    expect(r.max).toBe(20)
    expect(r.avg).toBe(15)
    expect(r.count).toBe(3)
  })
  
  it('calcula changePct (primeiro → último)', () => {
    const h = [
      { priceUsd: 10, date: '2026-01-01' },
      { priceUsd: 15, date: '2026-03-01' },
    ]
    const r = computePriceStats(h)
    expect(r.changePct).toBe(50)  // 10 → 15 = +50%
  })
  
  it('alerta de aumento se último >15% maior que penúltimo', () => {
    const h = [
      { priceUsd: 10, date: '2026-01-01' },
      { priceUsd: 12, date: '2026-02-01' },
      { priceUsd: 15, date: '2026-03-01' },  // 12 → 15 = +25% → alerta
    ]
    const r = computePriceStats(h)
    expect(r.hasIncreaseAlert).toBe(true)
    expect(r.lastIncreasePct).toBeCloseTo(25, 1)
  })
  
  it('NÃO alerta se aumento <=15%', () => {
    const h = [
      { priceUsd: 10, date: '2026-01-01' },
      { priceUsd: 11, date: '2026-02-01' },  // +10% → sem alerta
    ]
    expect(computePriceStats(h).hasIncreaseAlert).toBe(false)
  })
  
  it('NÃO alerta se diminuiu', () => {
    const h = [
      { priceUsd: 20, date: '2026-01-01' },
      { priceUsd: 10, date: '2026-02-01' },  // -50% → sem alerta (alerta é só pra subida)
    ]
    expect(computePriceStats(h).hasIncreaseAlert).toBe(false)
  })
  
  it('1 ponto só: changePct null, sem alerta', () => {
    const r = computePriceStats([{ priceUsd: 10, date: '2026-01-01' }])
    expect(r.changePct).toBeNull()
    expect(r.hasIncreaseAlert).toBe(false)
  })
})

describe('computePriceTrend', () => {
  it('no_data com <2 pontos', () => {
    expect(computePriceTrend([])).toBe('no_data')
    expect(computePriceTrend([{ priceUsd: 10, date: '2026-01-01' }])).toBe('no_data')
  })
  
  it('"up" se subiu >5%', () => {
    const h = [
      { priceUsd: 10, date: '2026-01-01' },
      { priceUsd: 11, date: '2026-02-01' },  // +10%
    ]
    expect(computePriceTrend(h)).toBe('up')
  })
  
  it('"down" se caiu >5%', () => {
    const h = [
      { priceUsd: 10, date: '2026-01-01' },
      { priceUsd: 8, date: '2026-02-01' },  // -20%
    ]
    expect(computePriceTrend(h)).toBe('down')
  })
  
  it('"stable" se variação entre -5% e +5%', () => {
    const h = [
      { priceUsd: 10, date: '2026-01-01' },
      { priceUsd: 10.3, date: '2026-02-01' },  // +3%
    ]
    expect(computePriceTrend(h)).toBe('stable')
  })
})
