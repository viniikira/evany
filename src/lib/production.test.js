// src/lib/production.test.js
// v13.73 — Produção derivada dos pedidos. Os casos espelham o banco real de
// 18/09/2026, onde a tela mostrava 3.400 peças e os pedidos somavam 4.785.
import { describe, it, expect } from 'vitest'
import { buildProductionView, soonestEta, buildProductPipeline } from './production'

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

describe('chegada estimada por pedido (v13.76)', () => {
  it('usa a previsão quando existe', () => {
    const g = view.groups.find(x => x.factoryName === 'HAIR FORTUNE')
    const o = g.orders.find(x => x.id === 'ago')
    expect(o.etaDays).toBe(73)          // 18/09 → 30/11
    expect(o.etaEstimated).toBe(false)
  })

  it('sem previsão: fim da fabricação + frete, marcado como estimado', () => {
    const v = buildProductionView({
      products, now: NOW,
      orders: [{ id: 'x', factory: 'EPF', status: 'manufacturing', order_date: '2026-09-08', promised_lead_days: 60,
        items: [line('lara', '1B', 10)] }],
    })
    const o = v.groups[0].orders[0]
    expect(o.etaDays).toBe(50 + 30)     // 60 − 10 dias corridos + 30 de frete
    expect(o.etaEstimated).toBe(true)
  })

  it('soonestEta pega o pedido que chega primeiro', () => {
    expect(soonestEta([{ etaDays: 90, name: 'a' }, { etaDays: 20, etaEstimated: true, name: 'b' }, { etaDays: null }]))
      .toEqual({ etaDays: 20, etaEstimated: true, orderName: 'b' })
    expect(soonestEta([])).toBe(null)
  })
})

// ═══════════════════════════════════════════════════════════════════
// v13.87 — panorama por produto (revisão + fabricação + trânsito juntos)
// ═══════════════════════════════════════════════════════════════════
describe('buildProductPipeline — um cartão por modelo', () => {
  const prods = [
    { id: 'val', name: 'VALENTINA', factory: 'HAIRCHUAN', color_variants: [{ code: '1B' }] },
    { id: 'ana', name: 'ANA LACE', kind: 'brand', factory: 'SLEEK' },
  ]
  const ords = [
    { id: 'a', order_name: 'AGO/26 · HAIR FORTUNE', factory: 'HAIR FORTUNE', status: 'manufacturing', order_date: '2026-08-10', promised_lead_days: 90,
      items: [{ product_id: 'val', colors: [{ code: '1b', qty: 250 }, { code: 'TT2/CARMEL', qty: 100 }] }] },
    { id: 'b', order_name: 'NOVEMBRO 2025', factory: 'HAIRCHUAN', status: 'in_transit', expected_arrival: '2026-10-01',
      items: [{ product_id: 'val', colors: [{ code: '1B', qty: 50 }] }] },
    { id: 'c', order_name: 'Rascunho', factory: 'EPF', status: 'draft', items: [{ product_id: 'val', colors: [{ code: '1B', qty: 999 }] }] },
    { id: 'd', order_name: 'Concluído', factory: 'EPF', status: 'completed', items: [{ product_id: 'val', colors: [{ code: '1B', qty: 999 }] }] },
    { id: 'e', order_name: 'SLEEK 1', factory: 'SLEEK', kind: 'brand', status: 'sent', items: [{ product_id: 'ana', colors: [{ code: '2', qty: 25 }] }] },
  ]
  const r = buildProductPipeline({ products: prods, orders: ords, colors: [{ code: 'TT2-CARMEL' }], now: NOW })

  it('junta fábricas e etapas do mesmo modelo; ignora rascunho e concluído', () => {
    expect(r).toHaveLength(1)
    const v = r[0]
    expect(v.product.name).toBe('VALENTINA')
    expect(v.total).toBe(400)
    expect(v.byStatus).toEqual({ sent: 0, manufacturing: 350, in_transit: 50 })
    expect(v.factories).toEqual(['HAIRCHUAN', 'HAIR FORTUNE'])   // trânsito primeiro
  })
  it('por cor, quanto em cada pedido (grafias da cor unificadas)', () => {
    const black = r[0].colors.find(c => c.code === '1B')
    expect(black.total).toBe(300)
    expect(black.byOrder).toEqual({ a: 250, b: 50 })
    expect(r[0].colors.find(c => c.code === 'TT2-CARMEL').byOrder).toEqual({ a: 100 })
  })
  it('marcas parceiras num panorama separado', () => {
    const b = buildProductPipeline({ products: prods, orders: ords, now: NOW, kind: 'brand' })
    expect(b.map(x => x.product.name)).toEqual(['ANA LACE'])
    expect(b[0].byStatus.sent).toBe(25)
  })
  it('em revisão fica SEPARADO: fora do total confirmado e da chegada (v13.88)', () => {
    const withReview = [...ords, {
      id: 'r', order_name: 'DEZ/26 · EPF', factory: 'EPF', status: 'sent', expected_arrival: '2026-09-20',
      items: [{ product_id: 'val', colors: [{ code: '1B', qty: 80 }, { code: '613', qty: 40 }] }],
    }, {
      id: 's', order_name: 'Só revisão', factory: 'EPF', status: 'sent',
      items: [{ name_manual: 'IDEIA NOVA', colors: [{ code: '2', qty: 10 }] }],
    }]
    const v = buildProductPipeline({ products: prods, orders: withReview, now: NOW })
    const val = v.find(x => x.product.name === 'VALENTINA')
    expect(val.total).toBe(400)              // confirmado não muda
    expect(val.review).toBe(120)
    expect(val.totalWithReview).toBe(520)
    expect(val.orders.map(o => o.id)).toEqual(['b', 'a'])
    expect(val.reviewOrders.map(o => o.id)).toEqual(['r'])
    expect(val.nextEta.orderName).toBe('NOVEMBRO 2025')   // revisão não vira "chegada"
    const black = val.colors.find(c => c.code === '1B')
    expect([black.total, black.review]).toEqual([300, 80])
    const blonde = val.colors.find(c => c.code === '613')
    expect([blonde.total, blonde.review]).toEqual([0, 40])
    const idea = v.find(x => x.product.name === 'IDEIA NOVA')
    expect(idea.onlyReview).toBe(true)
    expect(idea.total).toBe(0)
    expect(v[v.length - 1]).toBe(idea)      // só-revisão vai pro fim
  })
})
