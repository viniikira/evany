// src/lib/dashboardInsights.test.js
// Testes pra detecção de atenções no Dashboard.

import { describe, it, expect } from 'vitest'
import { findStuckColors, computeAttentions } from './dashboardInsights'

const order = (o = {}) => ({
  id: 'o1', factory: 'EPF', status: 'manufacturing',
  order_name: 'P1', created_at: '2026-03-01T00:00:00Z',
  items: [], payments: [],
  ...o,
})

const product = (p = {}) => ({
  id: 'p1', name: 'Peruca', factory: 'EPF',
  color_variants: [],
  ...p,
})

describe('findStuckColors', () => {
  it('retorna [] se não há produtos', () => {
    expect(findStuckColors([], [])).toEqual([])
  })
  
  it('detecta cor em production sem pedido ativo correspondente', () => {
    const products = [
      product({
        id: 'p1',
        color_variants: [
          { code: '1B', status: 'production' },  // PRESA
          { code: '27', status: 'catalog' },      // OK
        ],
      }),
    ]
    const r = findStuckColors([], products)
    expect(r).toHaveLength(1)
    expect(r[0].colorVariant.code).toBe('1B')
  })
  
  it('cor em production COM pedido ativo correspondente NÃO é presa', () => {
    const products = [
      product({
        id: 'p1',
        color_variants: [{ code: '1B', status: 'production' }],
      }),
    ]
    const orders = [
      order({
        status: 'manufacturing',
        items: [{ product_id: 'p1', colors: [{ code: '1B', qty: 5 }] }],
      }),
    ]
    expect(findStuckColors(orders, products)).toEqual([])
  })
  
  it('pedido com cor mas em status concluído não conta como ativo', () => {
    const products = [
      product({ color_variants: [{ code: '1B', status: 'production' }] }),
    ]
    const orders = [
      order({
        status: 'completed',
        items: [{ product_id: 'p1', colors: [{ code: '1B', qty: 5 }] }],
      }),
    ]
    expect(findStuckColors(orders, products)).toHaveLength(1)
  })
})

describe('computeAttentions', () => {
  it('retorna estrutura padrão sem atenções', () => {
    const r = computeAttentions([], [])
    expect(r.all).toEqual([])
    expect(r.visible).toEqual([])
    expect(r.hiddenCount).toBe(0)
  })
  
  it('consolida 3+ cores do mesmo produto em 1 card agregado', () => {
    // v13.40 — quando há 3+ cores travadas do mesmo produto, agrega
    // (evita poluir dashboard com múltiplos cards idênticos)
    const products = [
      product({
        id: 'p1',
        name: 'ADELA',
        color_variants: Array.from({ length: 8 }, (_, i) => ({
          code: `C${i}`, status: 'production',
        })),
      }),
    ]
    const r = computeAttentions([], products)
    // 8 cores viram 1 card consolidado
    expect(r.all).toHaveLength(1)
    expect(r.all[0].grouped).toBe(true)
    expect(r.all[0].groupCount).toBe(8)
    expect(r.all[0].title).toContain('8 cores')
  })
  
  it('mantém 2 cores presas como cards individuais (não agrupa < 3)', () => {
    // v13.40 — menos de 3 = mantém cards individuais
    const products = [
      product({
        id: 'p1',
        name: 'ADELA',
        color_variants: [
          { code: 'C1', status: 'production' },
          { code: 'C2', status: 'production' },
        ],
      }),
    ]
    const r = computeAttentions([], products)
    expect(r.all).toHaveLength(2)
    expect(r.all.every(a => !a.grouped)).toBe(true)
  })
  
  it('limita visíveis em 6 (com produtos diferentes)', () => {
    // v13.40 — teste reescrito: 8 produtos distintos, 1 cor cada = 8 cards individuais
    const products = Array.from({ length: 8 }, (_, i) => product({
      id: `p${i}`,
      name: `Produto ${i}`,
      color_variants: [{ code: `C${i}`, status: 'production' }],
    }))
    const r = computeAttentions([], products)
    expect(r.all).toHaveLength(8)
    expect(r.visible).toHaveLength(6)
    expect(r.hiddenCount).toBe(2)
  })
  
  it('detecta pagamento sem comprovante (manufacturing)', () => {
    const orders = [
      order({
        status: 'manufacturing',
        payments: [{ id: 'p1', amount_usd: '100', receipt_url: null }],
      }),
    ]
    const r = computeAttentions(orders, [])
    const noReceipt = r.all.filter(a => a.type === 'missing-receipt')
    expect(noReceipt).toHaveLength(1)
  })
  
  it('agrupa múltiplos pagamentos sem comprovante por pedido', () => {
    const orders = [
      order({
        status: 'manufacturing',
        payments: [
          { id: 'p1', amount_usd: '100', receipt_url: null },
          { id: 'p2', amount_usd: '50', receipt_url: null },
        ],
      }),
    ]
    const r = computeAttentions(orders, [])
    // 1 atenção pro pedido (não 2)
    expect(r.all.filter(a => a.type === 'missing-receipt')).toHaveLength(1)
    // mas a description menciona 2
    expect(r.all.find(a => a.type === 'missing-receipt').description).toMatch(/2/)
  })
  
  it('ordena por severidade: critical → warning → info', () => {
    // Cria mistura
    const products = [
      product({ color_variants: [{ code: '1B', status: 'production' }] }),  // info
    ]
    const orders = [
      order({
        status: 'manufacturing',
        payments: [{ id: 'p1', amount_usd: '100', receipt_url: null }],     // warning
      }),
    ]
    const r = computeAttentions(orders, products)
    expect(r.all[0].severity).toBe('warning')  // missing-receipt
    expect(r.all[1].severity).toBe('info')     // color-stuck
  })
  
  it('cor em production com pedido ativo não gera atenção', () => {
    const products = [
      product({ color_variants: [{ code: '1B', status: 'production' }] }),
    ]
    const orders = [
      order({
        status: 'manufacturing',
        items: [{ product_id: 'p1', colors: [{ code: '1B', qty: 1 }] }],
      }),
    ]
    const r = computeAttentions(orders, products)
    expect(r.all.filter(a => a.type === 'color-stuck')).toEqual([])
  })
})
