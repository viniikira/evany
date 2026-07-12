// src/lib/pendencias.computePendencias.test.js
// Testes pra computePendencias (a função grande). Separado do pendencias.test.js
// pra manter cada arquivo focado.
//
// 9 tipos de pendência detectadas:
//   1. order_late (manufacturing atrasado)
//   2. idea_old (ideia parada >90d)
//   3. product_stale (developing >60d sem pedido)
//   4. payment_noreceipt (sem comprovante)
//   5. payment_nodate (sem data — crítico fiscal)
//   6. order_completed_unpaid (recebido mas devo)
//   7. product_noprimary (sem foto principal)
//   8. product_nocolors (catálogo vazio)

import { describe, it, expect } from 'vitest'
import { computePendencias } from './pendencias'

// Fixtures helpers
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString()

const order = (o = {}) => ({
  id: 'o1', factory: 'EPF', status: 'manufacturing',
  order_name: 'Pedido EPF',
  created_at: daysAgo(10),
  updated_at: daysAgo(5),
  manufacturing_started_at: null,
  promised_lead_days: null,
  items: [],
  payments: [],
  ...o,
})

const product = (p = {}) => ({
  id: 'p1', name: 'Peruca X',
  status: 'catalog',
  card_image_url: 'http://foto.jpg',
  photos: [],
  color_variants: [{ code: '1B' }],
  created_at: daysAgo(30),
  updated_at: daysAgo(30),
  ...p,
})

const idea = (i = {}) => ({
  id: 'i1', name: 'Ideia A',
  status: 'researching',
  created_at: daysAgo(30),
  updated_at: daysAgo(30),
  ...i,
})

const payment = (pay = {}) => ({
  id: 'pay1',
  amount_usd: '500',
  payment_date: daysAgo(5),
  receipt_url: 'http://comprovante.pdf',
  ...pay,
})

describe('computePendencias — entrada vazia', () => {
  it('retorna [] sem dados', () => {
    expect(computePendencias({})).toEqual([])
    expect(computePendencias({ products: [], orders: [], ideas: [] })).toEqual([])
  })
  
  it('lida com argumento undefined sem crashar', () => {
    expect(() => computePendencias({ products: undefined })).not.toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════
// Tipo 1: order_late
// ═══════════════════════════════════════════════════════════════════
describe('order_late', () => {
  it('detecta pedido em manufacturing atrasado (prazo manual)', () => {
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: daysAgo(50),
      promised_lead_days: 30,
    })
    const r = computePendencias({ orders: [o] })
    const lates = r.filter(p => p.kind === 'order_late')
    expect(lates).toHaveLength(1)
    expect(lates[0].title).toMatch(/atrasado/)
  })
  
  it('atraso >=15d com prazo manual = crítico (priority 1)', () => {
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: daysAgo(50),
      promised_lead_days: 30,  // 20 dias atrasado, manual → crítico
    })
    const r = computePendencias({ orders: [o] })
    expect(r[0].priority).toBe(1)
    expect(r[0].icon).toBe('🚨')
  })
  
  it('atraso pequeno (manual <15d) = warning (priority 2)', () => {
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: daysAgo(35),
      promised_lead_days: 30,  // 5 dias atrasado
    })
    const r = computePendencias({ orders: [o] })
    expect(r[0].priority).toBe(2)
    expect(r[0].icon).toBe('⏰')
  })
  
  it('pedido dentro do prazo NÃO gera atraso', () => {
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: daysAgo(10),
      promised_lead_days: 30,
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'order_late')).toEqual([])
  })
  
  it('pedido draft/sent/completed/cancelled NÃO entra nessa regra', () => {
    const states = ['draft', 'sent', 'completed', 'cancelled']
    for (const s of states) {
      const o = order({
        status: s,
        manufacturing_started_at: daysAgo(50),
        promised_lead_days: 30,
      })
      const r = computePendencias({ orders: [o] })
      expect(r.filter(p => p.kind === 'order_late')).toEqual([])
    }
  })
  
  it('pedido legado sem manufacturing_started_at NÃO gera (proteção)', () => {
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: null,
      promised_lead_days: 30,
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'order_late')).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════
// Tipo 2: idea_old
// ═══════════════════════════════════════════════════════════════════
describe('idea_old', () => {
  it('detecta ideia parada >=90 dias', () => {
    const i = idea({ updated_at: daysAgo(95) })
    const r = computePendencias({ ideas: [i] })
    expect(r.filter(p => p.kind === 'idea_old')).toHaveLength(1)
  })
  
  it('ideia recente (<90d) NÃO gera', () => {
    const i = idea({ updated_at: daysAgo(30) })
    const r = computePendencias({ ideas: [i] })
    expect(r.filter(p => p.kind === 'idea_old')).toEqual([])
  })
  
  it('ideia descartada é IGNORADA mesmo se antiga', () => {
    const i = idea({ status: 'discarded', updated_at: daysAgo(200) })
    const r = computePendencias({ ideas: [i] })
    expect(r.filter(p => p.kind === 'idea_old')).toEqual([])
  })
  
  it('usa created_at se updated_at não existe', () => {
    const i = idea({ updated_at: null, created_at: daysAgo(120) })
    const r = computePendencias({ ideas: [i] })
    expect(r.filter(p => p.kind === 'idea_old')).toHaveLength(1)
  })
  
  it('priority é 3 (baixa)', () => {
    const i = idea({ updated_at: daysAgo(100) })
    const r = computePendencias({ ideas: [i] })
    expect(r[0].priority).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Tipo 3: product_stale
// ═══════════════════════════════════════════════════════════════════
describe('product_stale', () => {
  it('detecta produto developing >=60d sem pedido recente', () => {
    const p = product({
      status: 'developing',
      updated_at: daysAgo(70),
    })
    const r = computePendencias({ products: [p] })
    expect(r.filter(x => x.kind === 'product_stale')).toHaveLength(1)
  })
  
  it('produto developing recente (<60d) NÃO gera', () => {
    const p = product({
      status: 'developing',
      updated_at: daysAgo(30),
    })
    const r = computePendencias({ products: [p] })
    expect(r.filter(x => x.kind === 'product_stale')).toEqual([])
  })
  
  it('produto developing com pedido recente NÃO gera', () => {
    const p = product({
      status: 'developing',
      updated_at: daysAgo(80),
    })
    const o = order({
      created_at: daysAgo(20),
      items: [{ product_id: 'p1' }],
    })
    const r = computePendencias({ products: [p], orders: [o] })
    expect(r.filter(x => x.kind === 'product_stale')).toEqual([])
  })
  
  it('produto em catalog/discontinued/research NÃO entra', () => {
    const states = ['catalog', 'discontinued', 'research']
    for (const s of states) {
      const p = product({ status: s, updated_at: daysAgo(80) })
      const r = computePendencias({ products: [p] })
      expect(r.filter(x => x.kind === 'product_stale')).toEqual([])
    }
  })
})

// ═══════════════════════════════════════════════════════════════════
// Tipo 4: payment_noreceipt
// ═══════════════════════════════════════════════════════════════════
describe('payment_noreceipt', () => {
  it('detecta pagamento sem comprovante em manufacturing', () => {
    const o = order({
      status: 'manufacturing',
      payments: [payment({ receipt_url: null })],
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'payment_noreceipt')).toHaveLength(1)
  })
  
  it('detecta também em completed', () => {
    const o = order({
      status: 'completed',
      payments: [payment({ receipt_url: null })],
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'payment_noreceipt')).toHaveLength(1)
  })
  
  it('agrupa múltiplos pagamentos sem comprovante por pedido', () => {
    const o = order({
      status: 'manufacturing',
      payments: [
        payment({ id: 'p1', receipt_url: null }),
        payment({ id: 'p2', receipt_url: null }),
      ],
    })
    const r = computePendencias({ orders: [o] })
    const noreceipt = r.filter(p => p.kind === 'payment_noreceipt')
    expect(noreceipt).toHaveLength(1)  // 1 pendência por pedido (não 2)
    expect(noreceipt[0].title).toMatch(/2 pagamento/)
  })
  
  it('pgto com comprovante NÃO gera', () => {
    const o = order({
      status: 'manufacturing',
      payments: [payment({ receipt_url: 'http://...' })],
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'payment_noreceipt')).toEqual([])
  })
  
  it('draft/sent NÃO entram', () => {
    const states = ['draft', 'sent']
    for (const s of states) {
      const o = order({
        status: s,
        payments: [payment({ receipt_url: null })],
      })
      const r = computePendencias({ orders: [o] })
      expect(r.filter(p => p.kind === 'payment_noreceipt')).toEqual([])
    }
  })
})

// ═══════════════════════════════════════════════════════════════════
// Tipo 5: payment_nodate (crítico — auditoria fiscal)
// ═══════════════════════════════════════════════════════════════════
describe('payment_nodate', () => {
  it('detecta pagamento sem data', () => {
    const o = order({
      status: 'manufacturing',
      payments: [payment({ payment_date: null })],
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'payment_nodate')).toHaveLength(1)
  })
  
  it('priority é 1 (alta — afeta auditoria)', () => {
    const o = order({
      status: 'manufacturing',
      payments: [payment({ payment_date: null })],
    })
    const r = computePendencias({ orders: [o] })
    const noDate = r.find(p => p.kind === 'payment_nodate')
    expect(noDate.priority).toBe(1)
  })
  
  it('vale pra TODOS os status (não só manufacturing)', () => {
    const o = order({
      status: 'completed',
      payments: [payment({ payment_date: null })],
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'payment_nodate')).toHaveLength(1)
  })
  
  it('agrupa múltiplos sem data por pedido', () => {
    const o = order({
      status: 'manufacturing',
      payments: [
        payment({ id: 'p1', payment_date: null }),
        payment({ id: 'p2', payment_date: null }),
      ],
    })
    const r = computePendencias({ orders: [o] })
    const nd = r.filter(p => p.kind === 'payment_nodate')
    expect(nd).toHaveLength(1)
    expect(nd[0].title).toMatch(/2 pagamento/)
  })
  
  it('pgto sem amount_usd é IGNORADO', () => {
    const o = order({
      status: 'manufacturing',
      payments: [payment({ amount_usd: null, payment_date: null })],
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'payment_nodate')).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════
// Tipo 6: order_completed_unpaid (CRÍTICO)
// ═══════════════════════════════════════════════════════════════════
describe('order_completed_unpaid', () => {
  it('detecta concluído com saldo aberto', () => {
    const o = order({
      status: 'completed',
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [payment({ amount_usd: '40' })],  // 40% pago
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'order_completed_unpaid')).toHaveLength(1)
  })
  
  it('priority é 1 (urgente)', () => {
    const o = order({
      status: 'completed',
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [],
    })
    const r = computePendencias({ orders: [o] })
    const u = r.find(p => p.kind === 'order_completed_unpaid')
    expect(u.priority).toBe(1)
  })
  
  it('totalmente pago NÃO gera', () => {
    const o = order({
      status: 'completed',
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [payment({ amount_usd: '100' })],
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'order_completed_unpaid')).toEqual([])
  })
  
  it('manufacturing/sent NÃO entram nessa regra', () => {
    for (const s of ['manufacturing', 'sent']) {
      const o = order({
        status: s,
        items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
        payments: [],
      })
      const r = computePendencias({ orders: [o] })
      expect(r.filter(p => p.kind === 'order_completed_unpaid')).toEqual([])
    }
  })
  
  it('FOB zero (sem preços) NÃO gera', () => {
    const o = order({
      status: 'completed',
      items: [{ colors: [{ qty: 1 }] }],  // sem price_usd
      payments: [],
    })
    const r = computePendencias({ orders: [o] })
    expect(r.filter(p => p.kind === 'order_completed_unpaid')).toEqual([])
  })
  
  it('description menciona % e valores', () => {
    const o = order({
      status: 'completed',
      items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
      payments: [payment({ amount_usd: '40' })],
    })
    const r = computePendencias({ orders: [o] })
    const u = r.find(p => p.kind === 'order_completed_unpaid')
    expect(u.description).toMatch(/40/)
    expect(u.description).toMatch(/60/)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Tipo 7: product_noprimary
// ═══════════════════════════════════════════════════════════════════
describe('product_noprimary', () => {
  it('detecta produto sem foto principal mas com galeria', () => {
    const p = product({
      card_image_url: null,
      photos: ['http://1.jpg', 'http://2.jpg'],
    })
    const r = computePendencias({ products: [p] })
    expect(r.filter(x => x.kind === 'product_noprimary')).toHaveLength(1)
  })
  
  it('produto sem foto principal e SEM galeria NÃO gera', () => {
    const p = product({
      card_image_url: null,
      photos: [],
    })
    const r = computePendencias({ products: [p] })
    expect(r.filter(x => x.kind === 'product_noprimary')).toEqual([])
  })
  
  it('produto com foto principal NÃO gera', () => {
    const p = product({
      card_image_url: 'http://foto.jpg',
      photos: ['http://1.jpg'],
    })
    const r = computePendencias({ products: [p] })
    expect(r.filter(x => x.kind === 'product_noprimary')).toEqual([])
  })
  
  it('produto descontinuado é IGNORADO', () => {
    const p = product({
      status: 'discontinued',
      card_image_url: null,
      photos: ['http://1.jpg'],
    })
    const r = computePendencias({ products: [p] })
    expect(r.filter(x => x.kind === 'product_noprimary')).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════
// Tipo 8: product_nocolors (catálogo sem cores)
// ═══════════════════════════════════════════════════════════════════
describe('product_nocolors', () => {
  it('detecta catalog sem color_variants', () => {
    const p = product({
      status: 'catalog',
      color_variants: [],
    })
    const r = computePendencias({ products: [p] })
    expect(r.filter(x => x.kind === 'product_nocolors')).toHaveLength(1)
  })
  
  it('catalog COM cores NÃO gera', () => {
    const p = product({
      status: 'catalog',
      color_variants: [{ code: '1B' }],
    })
    const r = computePendencias({ products: [p] })
    expect(r.filter(x => x.kind === 'product_nocolors')).toEqual([])
  })
  
  it('developing/research/discontinued sem cores NÃO entram', () => {
    for (const s of ['developing', 'research', 'discontinued']) {
      const p = product({ status: s, color_variants: [] })
      const r = computePendencias({ products: [p] })
      expect(r.filter(x => x.kind === 'product_nocolors')).toEqual([])
    }
  })
  
  it('priority é 2', () => {
    const p = product({ status: 'catalog', color_variants: [] })
    const r = computePendencias({ products: [p] })
    expect(r[0].priority).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Ordenação geral
// ═══════════════════════════════════════════════════════════════════
describe('ordenação', () => {
  it('priority 1 vem antes de 2 e 3', () => {
    const orders = [
      // priority 3: ideia velha
    ]
    const ideas = [idea({ updated_at: daysAgo(120) })]  // p3
    const products = [
      product({ status: 'catalog', color_variants: [] }),  // p2
    ]
    const ords = [
      order({  // p1
        status: 'completed',
        items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
        payments: [],
      }),
    ]
    const r = computePendencias({ products, ideas, orders: ords })
    expect(r[0].priority).toBe(1)
    expect(r[r.length - 1].priority).toBe(3)
  })
  
  it('dentro do mesmo priority, ordena alfabético por title', () => {
    const products = [
      product({ id: 'pZ', name: 'Zebra', status: 'catalog', color_variants: [] }),
      product({ id: 'pA', name: 'Alfa', status: 'catalog', color_variants: [] }),
    ]
    const r = computePendencias({ products })
    // Ambos são priority 2 (product_nocolors)
    expect(r[0].title).toMatch(/Alfa/)
    expect(r[1].title).toMatch(/Zebra/)
  })
})

// ═══════════════════════════════════════════════════════════════════
// Cenário integrado: vários tipos juntos
// ═══════════════════════════════════════════════════════════════════
describe('cenário integrado', () => {
  it('detecta múltiplos tipos numa mesma chamada', () => {
    const products = [
      product({ id: 'p1', status: 'catalog', color_variants: [] }),  // nocolors
      product({ id: 'p2', card_image_url: null, photos: ['x'] }),    // noprimary
    ]
    const ideas = [idea({ updated_at: daysAgo(120) })]  // idea_old
    const orders = [
      order({  // completed unpaid
        id: 'o1',
        status: 'completed',
        items: [{ price_usd_snapshot: 100, colors: [{ qty: 1 }] }],
        payments: [],
      }),
      order({  // payment_nodate
        id: 'o2',
        status: 'sent',
        payments: [payment({ payment_date: null })],
      }),
    ]
    const r = computePendencias({ products, ideas, orders })
    
    const kinds = new Set(r.map(p => p.kind))
    expect(kinds.has('product_nocolors')).toBe(true)
    expect(kinds.has('product_noprimary')).toBe(true)
    expect(kinds.has('idea_old')).toBe(true)
    expect(kinds.has('order_completed_unpaid')).toBe(true)
    expect(kinds.has('payment_nodate')).toBe(true)
    
    // Total: 5 pendências (uma de cada tipo)
    expect(r).toHaveLength(5)
  })
})
