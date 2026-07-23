// src/lib/shopifySlim.test.js
// v13.66 — Garante que o slim mantém o que o sistema usa e corta o resto.

import { describe, it, expect } from 'vitest'
import { slimShopifyProducts, slimShopifyOrders } from './shopifySlim'

// Variante "gorda" como a API real devolve (~25 campos)
const fatVariant = {
  id: 42094264516673, sku: 'CHEREY6', grams: 100, price: '99.90', title: 'Default Title',
  weight: 0.1, barcode: '', option1: 'Default Title', option2: null, option3: null,
  taxable: true, image_id: null, position: 1, created_at: '2025-03-25', product_id: 754,
  updated_at: '2026-03-01', weight_unit: 'kg', compare_at_price: '99.90',
  inventory_policy: 'deny', inventory_item_id: 442, requires_shipping: true,
  inventory_quantity: 5, fulfillment_service: 'manual', admin_graphql_api_id: 'gid://x',
  inventory_management: 'shopify', old_inventory_quantity: 5,
}
const fatLineItem = {
  id: 99, sku: 'CHEREY6', quantity: 2, price: '99.90', name: 'Afro Puff', title: 'Afro Puff',
  grams: 100, vendor: 'Kira', taxable: true, gift_card: false, variant_id: 420,
  properties: [], product_id: 754, tax_lines: [{ rate: 0.1 }], variant_title: '',
  total_discount: '0.00', fulfillment_status: null, price_set: { shop_money: {} },
  discount_allocations: [], admin_graphql_api_id: 'gid://y',
}

describe('slimShopifyProducts', () => {
  it('mantém só title + sku/estoque/preço das variantes', () => {
    const slim = slimShopifyProducts([{ title: 'Afro Puff', variants: [fatVariant], images: [1, 2], tags: 'x' }])
    expect(slim).toEqual([{ title: 'Afro Puff', variants: [{ sku: 'CHEREY6', inventory_quantity: 5, price: '99.90' }] }])
  })

  it('corta drasticamente o tamanho do payload', () => {
    const fat = Array.from({ length: 100 }, () => ({ title: 'P', variants: [fatVariant], images: [], tags: '' }))
    const before = JSON.stringify(fat).length
    const after = JSON.stringify(slimShopifyProducts(fat)).length
    expect(after).toBeLessThan(before / 5)
  })

  it('nulos e vazios não quebram', () => {
    expect(slimShopifyProducts(null)).toEqual([])
    expect(slimShopifyProducts([{ variants: [null] }])).toEqual([{ title: '', variants: [] }])
  })
})

describe('slimShopifyOrders', () => {
  it('mantém só created_at + sku/qtd/preço dos itens', () => {
    const slim = slimShopifyOrders([{ id: 1, name: '#1001', created_at: '2026-07-01', total_price: '199.80', financial_status: 'paid', line_items: [fatLineItem] }])
    expect(slim).toEqual([{ created_at: '2026-07-01', line_items: [{ sku: 'CHEREY6', quantity: 2, price: '99.90' }] }])
  })

  it('4.500 pedidos gordos viram payload pequeno', () => {
    const fat = Array.from({ length: 4500 }, () => ({ id: 1, created_at: '2026-07-01', line_items: [fatLineItem, fatLineItem], financial_status: 'paid', fulfillment_status: null, name: '#x', total_price: '10' }))
    const after = JSON.stringify(slimShopifyOrders(fat)).length
    expect(after).toBeLessThan(1_500_000)  // ~1.5MB máx pra 4.500 pedidos (era dezenas de MB)
  })

  it('nulos não quebram', () => {
    expect(slimShopifyOrders(null)).toEqual([])
    expect(slimShopifyOrders([{ line_items: null }])).toEqual([{ created_at: null, line_items: [] }])
  })
})
