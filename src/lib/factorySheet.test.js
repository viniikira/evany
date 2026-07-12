// src/lib/factorySheet.test.js
// v13.47 — Testa a camada pura da planilha da fábrica (buildFactorySheetData).
// A geração do .xlsx em si depende de browser (canvas/download) e não é testada aqui.

import { describe, it, expect } from 'vitest'
import { buildFactorySheetData } from './factorySheet'

const baseOrder = {
  factory: 'EPF',
  order_name: 'Julho 2026',
  conversion_factor: 1.65,
  budget_rate: 5.75,
  items: [
    {
      id: 'i1',
      product_id: 'p1',
      product_name_snapshot: 'Lara',
      product_code_snapshot: 'E25A-LL87829',
      product_cap_snapshot: '13x4 HD',
      selected_photo_url: 'https://x/lara.jpg',
      price_usd_snapshot: '18.50',
      price_usd: '99.99',
      colors: [
        { code: '2', qty: 30 },
        { code: 'BALAYAGE CHOCOLATE', qty: 20, price_usd: '19.50' },
        { code: '99J', qty: 15 },
      ],
    },
  ],
}

const bank = [
  { code: '2', photo_url: 'https://x/c2.jpg', hex: '#1a1214', name_pt: 'Castanho escuro' },
  { code: '99j', photo_url: null, hex: '#4a1526', name_pt: 'Vinho' },
]

describe('buildFactorySheetData', () => {
  it('monta o bloco do modelo com snapshots (nome, código, cap, foto)', () => {
    const d = buildFactorySheetData(baseOrder, [], bank)
    expect(d.models).toHaveLength(1)
    const m = d.models[0]
    expect(m.name).toBe('LARA')
    expect(m.code).toBe('E25A-LL87829')
    expect(m.cap).toBe('13x4 HD')
    expect(m.photoUrl).toBe('https://x/lara.jpg')
  })

  it('usa price_usd_snapshot (não o price_usd atual) como FOB', () => {
    const d = buildFactorySheetData(baseOrder, [], bank)
    expect(d.models[0].colorRows[0].fob).toBe(18.5)
  })

  it('respeita preço próprio da cor quando existe', () => {
    const d = buildFactorySheetData(baseOrder, [], bank)
    const balayage = d.models[0].colorRows[1]
    expect(balayage.fob).toBe(19.5)
    expect(balayage.total).toBe(390)
  })

  it('calcula PP = FOB × fator e BRL = PP × câmbio (valores da planilha real)', () => {
    const d = buildFactorySheetData(baseOrder, [], bank)
    const r = d.models[0].colorRows[0]
    expect(r.pp).toBe(30.53)          // 18.50 × 1.65 = 30.525 → 30.53
    expect(r.brl).toBe(175.52)        // 18.50 × 1.65 × 5.75 = 175.51875 → 175.52 (igual à planilha real)
  })

  it('BRL fica null sem budget_rate nem rate fallback', () => {
    const o = { ...baseOrder, budget_rate: null }
    const d = buildFactorySheetData(o, [], bank)
    expect(d.models[0].colorRows[0].brl).toBeNull()
  })

  it('rate fallback é usado quando budget_rate está vazio', () => {
    const o = { ...baseOrder, budget_rate: null }
    const d = buildFactorySheetData(o, [], bank, { rate: '5.00' })
    expect(d.models[0].colorRows[0].brl).toBe(152.63) // 18.50 × 1.65 × 5.00 = 152.625
  })

  it('total do modelo e total geral batem com a soma das cores', () => {
    const d = buildFactorySheetData(baseOrder, [], bank)
    // 18.50×30 + 19.50×20 + 18.50×15 = 555 + 390 + 277.50 = 1222.50
    expect(d.models[0].modelTotal).toBe(1222.5)
    expect(d.grandTotal).toBe(1222.5)
    expect(d.grandQty).toBe(65)
  })

  it('item sem cores vira uma linha única com a quantidade do item', () => {
    const o = {
      ...baseOrder,
      items: [{ id: 'i2', product_name_snapshot: 'Anna', price_usd: '10', quantity: 5, colors: [] }],
    }
    const d = buildFactorySheetData(o, [], [])
    expect(d.models[0].colorRows).toHaveLength(1)
    expect(d.models[0].colorRows[0].qty).toBe(5)
    expect(d.models[0].colorRows[0].total).toBe(50)
  })

  it('deduplica cores case-insensitive e traz foto/hex do banco', () => {
    const d = buildFactorySheetData(baseOrder, [], bank)
    expect(d.usedColors).toHaveLength(3)
    const c2 = d.usedColors.find(c => c.code === '2')
    expect(c2.photoUrl).toBe('https://x/c2.jpg')
    const c99j = d.usedColors.find(c => c.code === '99J')
    expect(c99j.photoUrl).toBeNull()
    expect(c99j.hex).toBe('#4a1526')
  })

  it('nome manual e código manual têm precedência sobre snapshots', () => {
    const o = {
      ...baseOrder,
      items: [{ ...baseOrder.items[0], name_manual: 'custom', code_manual: 'ZZ-1' }],
    }
    const d = buildFactorySheetData(o, [], bank)
    expect(d.models[0].name).toBe('CUSTOM')
    expect(d.models[0].code).toBe('ZZ-1')
  })

  it('fator default 1.5 quando o pedido não tem conversion_factor', () => {
    const o = { ...baseOrder, conversion_factor: null }
    const d = buildFactorySheetData(o, [], bank)
    expect(d.models[0].colorRows[0].pp).toBe(27.75) // 18.50 × 1.5
  })
})
