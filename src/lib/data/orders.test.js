// src/lib/data/orders.test.js
// Testes pra lógica pura extraída de duplicateOrder (buildDuplicateOrderPayload).
// duplicateOrder em si não é testada aqui (toca Supabase).

import { describe, it, expect } from 'vitest'
import { buildDuplicateOrderPayload } from './orders'

const baseSource = {
  id: 'o1',
  factory: 'EPF',
  order_name: 'Pedido Original',
  status: 'manufacturing',
  notes: 'Nota importante',
  // Coisas que NÃO devem ser copiadas
  deleted_at: '2026-03-01T00:00:00Z',
  purged_at: null,
  status_history: [{ status: 'sent', at: '2026-02-01' }],
  manufacturing_started_at: '2026-02-15',
  promised_lead_days: 30,
  expected_arrival: '2026-04-01',
  payments: [{ id: 'pay1', amount_usd: 1000 }],
  // Items copiáveis
  items: [
    {
      id: 'i1',
      product_id: 'prod1',
      product_name_snapshot: 'Peruca X',
      product_code_snapshot: 'PX',
      product_cap_snapshot: '13x4',
      selected_photo_url: 'http://...',
      name_manual: null,
      code_manual: null,
      cap_manual: null,
      quantity: 0,
      price_usd: '15.50',
      price_usd_snapshot: '14.00',
      colors: [
        { code: '1B', qty: 5, price_usd: 14 },
        { code: '27', qty: 3, price_usd: null },
      ],
    },
  ],
}

describe('buildDuplicateOrderPayload', () => {
  it('preserva fábrica, notas', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.factory).toBe('EPF')
    expect(r.notes).toBe('Nota importante')
  })
  
  it('SEMPRE vira draft, independente do status original', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.status).toBe('draft')
  })
  
  it('NÃO copia payments', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.payments).toBeUndefined()
  })
  
  it('NÃO copia status_history', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.status_history).toBeUndefined()
  })
  
  it('NÃO copia datas de fabricação', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.manufacturing_started_at).toBeUndefined()
    expect(r.promised_lead_days).toBeUndefined()
    expect(r.expected_arrival).toBeUndefined()
  })
  
  it('NÃO copia deleted_at / purged_at', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.deleted_at).toBeUndefined()
    expect(r.purged_at).toBeUndefined()
  })
  
  it('preserva items com snapshots de preço', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.items).toHaveLength(1)
    expect(r.items[0].product_id).toBe('prod1')
    expect(r.items[0].price_usd).toBe('15.50')
    expect(r.items[0].price_usd_snapshot).toBe('14.00')
    expect(r.items[0].product_name_snapshot).toBe('Peruca X')
  })
  
  it('preserva cores dos items', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.items[0].colors).toHaveLength(2)
    expect(r.items[0].colors[0]).toEqual({ code: '1B', qty: 5, price_usd: 14 })
    expect(r.items[0].colors[1]).toEqual({ code: '27', qty: 3, price_usd: null })
  })
  
  it('usa nome customizado se passado', () => {
    const r = buildDuplicateOrderPayload(baseSource, 'Pedido Customizado')
    expect(r.order_name).toBe('Pedido Customizado')
  })
  
  it('default name é "[original] (cópia)" se não passa nome', () => {
    const r = buildDuplicateOrderPayload(baseSource)
    expect(r.order_name).toBe('Pedido Original (cópia)')
  })
  
  it('fallback pra fábrica se source não tem order_name', () => {
    const src = { ...baseSource, order_name: null }
    const r = buildDuplicateOrderPayload(src)
    expect(r.order_name).toBe('EPF (cópia)')
  })
  
  it('lida com source sem items', () => {
    const r = buildDuplicateOrderPayload({ factory: 'EPF', items: null })
    expect(r.items).toEqual([])
  })
  
  it('lida com items sem cores', () => {
    const src = { factory: 'EPF', items: [{ product_id: 'p1', quantity: 5 }] }
    const r = buildDuplicateOrderPayload(src)
    expect(r.items[0].colors).toEqual([])
    expect(r.items[0].quantity).toBe(5)
  })
})
