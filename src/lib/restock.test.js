// src/lib/restock.test.js
// v13.75 — Radar da loja. Os casos usam os números reais de 20/09/2026.
import { describe, it, expect } from 'vitest'
import { buildStoreIndex, storeSignalForProduct, inFlightForProduct, restockForProduct, restockForColor, buildRestockView } from './restock'

const NOW = new Date(2026, 8, 20, 12, 0, 0).getTime()
const DAY = 86400000

// Cache com 180 dias de cobertura (pedido mais antigo há 180 dias)
const shopifyCache = {
  products: [
    { title: 'Peruca Cassandra Loira', variants: [{ sku: 'CAS613', inventory_quantity: 4 }] },
    { title: 'Peruca Verona Castanha', variants: [{ sku: 'VERONA2', inventory_quantity: 0 }] },
    { title: 'Peruca Carol Curta', variants: [{ sku: 'CAROL1B', inventory_quantity: 40 }] },
    { title: 'Peruca Carolina Longa', variants: [{ sku: 'CAROLINA2', inventory_quantity: 47 }] },
    { title: 'Peruca Andira', variants: [{ sku: 'ANDIRA2', inventory_quantity: 29 }] },
  ],
  orders: [
    { created_at: new Date(NOW - 180 * DAY).toISOString(), line_items: [{ sku: 'CAS613', quantity: 317 }] },
    { created_at: new Date(NOW - 90 * DAY).toISOString(), line_items: [{ sku: 'VERONA2', quantity: 32 }, { sku: 'CAROLINA2', quantity: 15 }] },
    { created_at: new Date(NOW - 10 * DAY).toISOString(), line_items: [{ sku: 'ANDIRA2', quantity: 25 }] },
  ],
}

const products = [
  { id: 'cas', name: 'CASSANDRA', factory: 'HAIR FORTUNE', color_variants: [{ code: '613', sku: 'CAS613' }] },
  { id: 'ver', name: 'VERONA', factory: 'EPF', color_variants: [{ code: '2' }] },          // liga por título
  { id: 'carol', name: 'CAROL', factory: 'HAIRCHUAN', color_variants: [{ code: '1B' }] },
  { id: 'carolina', name: 'CAROLINA', factory: 'EPF', color_variants: [{ code: '2' }] },
  { id: 'andira', name: 'ANDIRA', factory: 'EPF', color_variants: [{ code: '2' }] },
  { id: 'nova', name: 'MODELO NOVO', factory: 'EPF', color_variants: [] },
]

const orders = [
  { id: 'ago', order_name: 'AGO/26', factory: 'HAIR FORTUNE', status: 'manufacturing', expected_arrival: '2026-11-30',
    items: [{ product_id: 'cas', colors: [{ code: '613', qty: 800 }] }] },
  { id: 'velho', status: 'completed', items: [{ product_id: 'ver', colors: [{ code: '2', qty: 500 }] }] },
  { id: 'lixo', status: 'manufacturing', deleted_at: '2026-09-01', items: [{ product_id: 'ver', colors: [{ code: '2', qty: 999 }] }] },
]

const storeIndex = buildStoreIndex(shopifyCache, { now: NOW })
const lead = new Map([['HAIR FORTUNE', { avgDays: 180, sampleSize: 1 }], ['EPF', { avgDays: 60, sampleSize: 2 }]])
const sig = (id) => storeSignalForProduct(products.find(p => p.id === id), storeIndex, products)

describe('ligação com a loja', () => {
  it('usa o SKU cadastrado quando existe', () => {
    const r = sig('cas')
    expect(r.matchedBy).toBe('sku')
    expect(r.stock).toBe(4)
    expect(r.sold).toBe(317)
    expect(r.perDay).toBeCloseTo(317 / 180, 3)
  })

  it('cai pro nome do modelo no título quando não há SKU', () => {
    const r = sig('ver')
    expect(r.matchedBy).toBe('title')
    expect(r.sold).toBe(32)
    expect(r.stock).toBe(0)
  })

  it('CAROL não rouba as vendas da CAROLINA', () => {
    expect(sig('carol').sold).toBe(0)
    expect(sig('carol').stock).toBe(40)
    expect(sig('carolina').sold).toBe(15)
    expect(sig('carolina').stock).toBe(47)
  })

  it('modelo que não existe na loja fica sem sinal', () => {
    expect(sig('nova').matchedBy).toBe(null)
    expect(sig('nova').perDay).toBe(0)
  })
})

describe('o que já vem vindo', () => {
  it('soma pedidos ativos e ignora concluído e lixeira', () => {
    const f = inFlightForProduct('ver', orders, { now: NOW })
    expect(f.qty).toBe(0)
    expect(inFlightForProduct('cas', orders, { now: NOW }).qty).toBe(800)
  })

  it('calcula dias até a próxima chegada', () => {
    const f = inFlightForProduct('cas', orders, { now: NOW })
    expect(f.daysToNextArrival).toBe(71)   // 20/09 → 30/11
  })

  it('não conta o pedido que está sendo editado', () => {
    expect(inFlightForProduct('cas', orders, { now: NOW, excludeOrderId: 'ago' }).qty).toBe(0)
  })
})

describe('quanto pedir', () => {
  const calc = (id) => restockForProduct(products.find(p => p.id === id), {
    orders, storeIndex, allProducts: products, leadTimeByFactory: lead, now: NOW,
  })

  it('VERONA: vende, zerou e nada vindo → ruptura com sugestão', () => {
    const r = calc('ver')
    expect(r.status).toBe('ruptura')
    // 32/180 = 0,178/dia × (60 + 90) = 26,7 → 30 (múltiplo de 5)
    expect(r.suggestedQty).toBe(30)
    expect(r.coverDays).toBe(0)
  })

  it('CASSANDRA: 2 dias de estoque mas 800 chegando → não precisa pedir mais', () => {
    const r = calc('cas')
    expect(r.coverDays).toBe(2)
    expect(r.status).toBe('critico')
    expect(r.inFlightQty).toBe(800)
    expect(r.suggestedQty).toBe(0)      // 1,76/dia × 270 = 475 < 4 + 800
    expect(r.coverWithIncomingDays).toBe(457)
  })

  it('ANDIRA: estoque pra 209 dias → sugestão zero', () => {
    const r = calc('andira')
    expect(r.coverDays).toBe(209)
    expect(r.suggestedQty).toBe(0)
  })

  it('modelo sem venda registrada não inventa número', () => {
    const r = calc('nova')
    expect(r.suggestedQty).toBe(null)
    expect(r.status).toBe('sem_dados')
    expect(r.explanation).toMatch(/histórico/)
  })

  it('prazo da fábrica entra na conta (fábrica lenta pede mais)', () => {
    const p = products.find(x => x.id === 'ver')
    const rapida = restockForProduct(p, { orders, storeIndex, allProducts: products, leadTimeByFactory: lead, factory: 'EPF', now: NOW })
    const lenta = restockForProduct(p, { orders, storeIndex, allProducts: products, leadTimeByFactory: lead, factory: 'HAIR FORTUNE', now: NOW })
    expect(lenta.suggestedQty).toBeGreaterThan(rapida.suggestedQty)
  })
})

describe('radar geral', () => {
  const view = buildRestockView({ products, orders, shopifyCache, leadTimeByFactory: lead, now: NOW })

  it('põe ruptura e crítico primeiro', () => {
    expect(view.all[0].status).toBe('ruptura')
    expect(view.all.map(r => r.product.id).slice(0, 2)).toContain('ver')
  })

  it('"repor primeiro" só traz quem precisa de peça nova', () => {
    const ids = view.urgent.map(r => r.product.id)
    expect(ids).toContain('ver')
    expect(ids).not.toContain('cas')   // crítico, mas já tem 800 vindo
  })

  it('ignora modelo descontinuado', () => {
    const v = buildRestockView({
      products: [...products, { id: 'off', name: 'VERONA', status: 'discontinued' }],
      orders, shopifyCache, leadTimeByFactory: lead, now: NOW,
    })
    expect(v.all.some(r => r.product.id === 'off')).toBe(false)
  })
})

describe('sinal por cor (onde ela digita)', () => {
  const prod = { id: 'cas', name: 'CASSANDRA', color_variants: [{ code: '613', sku: 'CAS613' }, { code: '1B' }] }
  it('usa o SKU da cor e desconta o que já vem daquela cor', () => {
    const r = restockForColor(prod, '613', { storeIndex, orders, leadDays: 180 })
    expect(r.stock).toBe(4)
    expect(r.inFlightQty).toBe(800)
    expect(r.suggestedQty).toBe(0)
  })
  it('cor sem SKU não tem sinal da loja', () => {
    expect(restockForColor(prod, '1B', { storeIndex, orders })).toBe(null)
  })
  it('código com grafia diferente ainda casa', () => {
    const r = restockForColor({ ...prod, color_variants: [{ code: '613 ', sku: 'cas613' }] }, '613', { storeIndex, orders })
    expect(r.stock).toBe(4)
  })
})
