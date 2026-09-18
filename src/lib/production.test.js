// src/lib/production.test.js
// v13.73 — Produção derivada dos pedidos. Os casos espelham o banco real de
// 18/09/2026, onde a tela mostrava 3.400 peças e os pedidos somavam 4.785.
import { describe, it, expect } from 'vitest'
import { buildProductionView } from './production'

const NOW = new Date(2026, 8, 18, 12, 0, 0).getTime()   // 18/09/2026 local

const products = [
  { id: 'valentina', name: 'VALENTINA', factory: 'HAIRCHUAN', color_variants: [
    { code: '1B', status: 'production' },
    { code: '6', status: 'production' },         // está no pedido em trânsito
    { code: 'FHBRULEE', status: 'production' },  // etiqueta esquecida: nenhum pedido
  ] },
  { id: 'lara', name: 'LARA', factory: 'EPF', color_variants: [
    { code: '1B', status: 'catalog' },           // reposição de cor do catálogo
  ] },
  { id: 'alice', name: 'ALICE', factory: 'HAIRCHUAN', color_variants: [
    { code: '2', status: 'production' },         // já está no navio
  ] },
]

const line = (product_id, code, qty) => ({ product_id, colors: [{ code, qty }] })

const orders = [
  { id: 'ago', order_name: 'AGO/26 · HAIR FORTUNE', factory: 'HAIR FORTUNE', status: 'manufacturing',
    expected_arrival: '2026-11-30', items: [line('valentina', '1B', 250)] },
  { id: 'jul', order_name: 'Julho 2026', factory: 'HAIRCHUAN', status: 'manufacturing',
    items: [line('valentina', '1b', 100)] },   // código em minúsculo: mesma cor
  { id: 'epf', order_name: null, factory: 'EPF', status: 'sent',
    items: [line('lara', '1B', 950), line('lara', 'P4/27', 320)] },   // P4/27 não cadastrada no produto
  { id: 'nov', order_name: 'NOVEMBRO 2025', factory: 'HAIRCHUAN', status: 'in_transit',
    expected_arrival: '2026-05-20', items: [line('alice', '2', 800), line('valentina', '6', 50)] },
  { id: 'velho', order_name: 'Outubro 2025', factory: 'EPF', status: 'completed', items: [line('lara', '1B', 700)] },
  { id: 'lixo', order_name: 'Apagado', factory: 'EPF', status: 'manufacturing', deleted_at: '2026-09-01', items: [line('lara', '1B', 999)] },
]

const view = buildProductionView({ products, orders, colors: [], now: NOW })
const group = (factory, productId) => view.groups.find(g => g.factoryName === factory && g.product.id === productId)

describe('buildProductionView — peças vêm dos pedidos', () => {
  it('soma TODAS as linhas de pedido ativo, inclusive reposição de cor do catálogo e cor não cadastrada', () => {
    // 250 + 100 + 950 + 320 = 1.620 (antes só contava cor com etiqueta "em produção")
    expect(view.kpis.totalQty).toBe(1620)
    const lara = group('EPF', 'lara')
    expect(lara.totalQty).toBe(1270)
    expect(lara.cores.map(c => c.code).sort()).toEqual(['1B', 'P4/27'])
  })

  it('separa o que está em revisão do que está fabricando', () => {
    expect(view.kpis.reviewQty).toBe(1270)
    expect(view.kpis.manufacturingQty).toBe(350)
  })

  it('agrupa pela fábrica DO PEDIDO, não do cadastro', () => {
    const hf = group('HAIR FORTUNE', 'valentina')
    expect(hf.totalQty).toBe(250)
    expect(hf.registeredFactory).toBe('HAIRCHUAN')
    expect(group('HAIRCHUAN', 'valentina').cores.find(c => c.code === '1B').qty).toBe(100)
  })

  it('ignora pedidos concluídos, em trânsito e apagados', () => {
    const all = view.groups.flatMap(g => g.cores).reduce((s, c) => s + c.qty, 0)
    expect(all).toBe(1620)
    expect(view.groups.some(g => g.orders.some(o => o.id === 'lixo' || o.id === 'velho' || o.id === 'nov'))).toBe(false)
  })
})

describe('buildProductionView — etiquetas do cadastro', () => {
  it('cor marcada "em produção" que está no navio NÃO vira alarme', () => {
    expect(view.flaggedInTransit).toBe(2)               // ALICE 2 e VALENTINA 6
    expect(view.groups.some(g => g.product.id === 'alice')).toBe(false)
  })

  it('só a etiqueta realmente esquecida vira aviso, no card do produto', () => {
    expect(view.kpis.orphanCount).toBe(1)
    expect(view.orphanFlags[0].code).toBe('FHBRULEE')
    const orphanCard = view.groups.find(g => g.cores.some(c => c.code === 'FHBRULEE'))
    expect(orphanCard.cores.find(c => c.code === 'FHBRULEE').hasOrder).toBe(false)
  })

  it('etiqueta órfã vai pro card da fábrica do CADASTRO quando ele existe', () => {
    // VALENTINA é da HAIRCHUAN e tem card lá (Julho 2026) e na HAIR FORTUNE
    const card = view.groups.find(g => g.cores.some(c => c.code === 'FHBRULEE'))
    expect(card.factoryName).toBe('HAIRCHUAN')
  })

  it('etiqueta sem pedido vai por último dentro do card', () => {
    const card = view.groups.find(g => g.cores.some(c => c.code === 'FHBRULEE'))
    expect(card.cores[card.cores.length - 1].code).toBe('FHBRULEE')
  })
})

describe('buildProductionView — panorama por modelo', () => {
  it('junta as fábricas do mesmo modelo', () => {
    const v = view.byProduct.get('valentina')
    expect(v.totalQty).toBe(350)
    expect(v.factories.map(f => f.name).sort()).toEqual(['HAIR FORTUNE', 'HAIRCHUAN'])
    expect(v.cores.find(c => c.code === '1B').qty).toBe(350)
    expect(v.orders.map(o => o.id).sort()).toEqual(['ago', 'jul'])
  })
})

describe('buildProductionView — chegadas', () => {
  it('"próxima chegada" nunca é uma data que já passou', () => {
    expect(view.nextArrival.expectedArrival).toBe('2026-11-30')
  })

  it('chegada prevista vencida vira alerta com os dias de atraso', () => {
    expect(view.overdueArrivals).toHaveLength(1)
    expect(view.overdueArrivals[0].name).toBe('NOVEMBRO 2025')
    expect(view.overdueArrivals[0].daysOverdue).toBe(121)
  })
})

describe('buildProductionView — itens sem cadastro', () => {
  it('item manual entra com o nome digitado, na fábrica do pedido', () => {
    const v = buildProductionView({
      products: [],
      orders: [{ id: 'x', factory: 'EPF', status: 'manufacturing', items: [{ product_id: null, name_manual: 'Peruca Nova', colors: [{ code: '1B', qty: 10 }] }] }],
      now: NOW,
    })
    expect(v.groups[0].product.name).toBe('Peruca Nova')
    expect(v.groups[0].factoryName).toBe('EPF')
    expect(v.groups[0].registeredFactory).toBe(null)
    expect(v.kpis.totalQty).toBe(10)
  })

  it('linha com quantidade zero não conta', () => {
    const v = buildProductionView({
      products,
      orders: [{ id: 'x', factory: 'EPF', status: 'manufacturing', items: [line('lara', '1B', 0)] }],
      now: NOW,
    })
    expect(v.groups.some(g => g.product.id === 'lara')).toBe(false)
  })
})
