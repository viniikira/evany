// src/lib/factorySheet.test.js
// v13.58 — Testa a camada pura da planilha da fábrica (buildFactorySheetData).
// Formato: SEM valores (controle interno), requeriments por modelo, aviso geral,
// cores com foto por modelo. A geração do .xlsx depende de browser (canvas).

import { describe, it, expect } from 'vitest'
import { buildFactorySheetData } from './factorySheet'

const baseOrder = {
  factory: 'EPF',
  order_name: 'Julho 2026',
  notes: 'Our products fiber cant SHINE! All products should have the combs in the cap',
  items: [
    {
      id: 'i1',
      product_id: 'p1',
      product_name_snapshot: 'Manuela',
      product_code_snapshot: 'E24A-LB87377',
      product_cap_snapshot: '13x4 HD',
      selected_photo_url: 'https://x/manuela-frente.jpg',
      requirements: 'hd lace, same hairline, same cap, no baby hair',
      colors: [
        { code: '2', qty: 20 },
        { code: 'TT2/4325', qty: 15 },
      ],
    },
  ],
}

const products = [
  { id: 'p1', name: 'Manuela', factory_code: 'E24A-LB87377', photos: ['https://x/manuela-frente.jpg', 'https://x/manuela-verso.jpg'] },
]

const bank = [
  { code: '2', photo_url: 'https://x/c2.jpg', hex: '#1a1214' },
  { code: 'tt2/4325', photo_url: null, hex: '#c99b5f' },
]

describe('buildFactorySheetData (formato fábrica v13.58)', () => {
  it('monta o bloco do modelo com snapshots e requeriments próprios', () => {
    const d = buildFactorySheetData(baseOrder, products, bank)
    const m = d.models[0]
    expect(m.name).toBe('MANUELA')
    expect(m.code).toBe('E24A-LB87377')
    expect(m.cap).toBe('13x4 HD')
    expect(m.requirements).toBe('hd lace, same hairline, same cap, no baby hair')
  })

  it('aviso geral do pedido vem das observações', () => {
    const d = buildFactorySheetData(baseOrder, products, bank)
    expect(d.generalNote).toContain('cant SHINE')
    expect(buildFactorySheetData({ ...baseOrder, notes: '  ' }, [], []).generalNote).toBe('')
  })

  it('NÃO expõe valores (FOB/PP/BRL são controle interno)', () => {
    const d = buildFactorySheetData(baseOrder, products, bank)
    const row = d.models[0].colorRows[0]
    expect(row).toEqual({ colorCode: '2', qty: 20 })
    expect('fob' in row).toBe(false)
    expect('pp' in row).toBe(false)
    expect('brl' in row).toBe(false)
    expect('grandTotal' in d).toBe(false)
  })

  it('até 2 fotos do modelo (principal + galeria, sem duplicar)', () => {
    const d = buildFactorySheetData(baseOrder, products, bank)
    expect(d.models[0].photoUrls).toEqual(['https://x/manuela-frente.jpg', 'https://x/manuela-verso.jpg'])
  })

  it('cores com foto POR MODELO (case-insensitive no banco)', () => {
    const d = buildFactorySheetData(baseOrder, products, bank)
    const uc = d.models[0].usedColors
    expect(uc).toHaveLength(2)
    expect(uc[0]).toEqual({ code: '2', photoUrl: 'https://x/c2.jpg', hex: '#1a1214' })
    expect(uc[1].photoUrl).toBeNull()
    expect(uc[1].hex).toBe('#c99b5f')
  })

  it('total geral é só de peças', () => {
    const d = buildFactorySheetData(baseOrder, products, bank)
    expect(d.grandQty).toBe(35)
    expect(d.models[0].modelQty).toBe(35)
  })

  it('item sem cores vira linha única com a quantidade do item', () => {
    const o = { ...baseOrder, items: [{ id: 'i2', product_name_snapshot: 'Anna', quantity: 5, colors: [] }] }
    const d = buildFactorySheetData(o, [], [])
    expect(d.models[0].colorRows).toEqual([{ colorCode: '', qty: 5 }])
    expect(d.models[0].usedColors).toEqual([])
  })

  it('nome/código manual têm precedência; requirements ausente vira vazio', () => {
    const o = { ...baseOrder, items: [{ ...baseOrder.items[0], name_manual: 'custom', code_manual: 'ZZ-1', requirements: null }] }
    const d = buildFactorySheetData(o, products, bank)
    expect(d.models[0].name).toBe('CUSTOM')
    expect(d.models[0].code).toBe('ZZ-1')
    expect(d.models[0].requirements).toBe('')
  })
})
