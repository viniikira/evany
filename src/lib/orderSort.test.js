// src/lib/orderSort.test.js
// v13.72 — ordem/agrupamento da lista de pedidos e nome sugerido.
import { describe, it, expect } from 'vitest'
import { classifyOrder, groupOrders, sortOrders } from './orderSort'
import { proposeOrderName, monthTag } from './orderNaming'

const DAY = 86400000
const NOW = new Date(2026, 6, 30, 12, 0, 0).getTime()   // 30/07/2026 local
const iso = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Pedido com valor final lançado (dívida real) — 10 peças a $100
const order = (over = {}) => ({
  id: 'o-' + Math.random().toString(36).slice(2, 8),
  factory: 'HAIRCHUAN',
  status: 'manufacturing',
  order_date: iso(NOW - 10 * DAY),
  created_at: iso(NOW - 10 * DAY),
  items: [{ id: 'i1', price_usd_snapshot: '100', final_price_usd: '100', colors: [{ code: '1B', qty: 10 }] }],
  payments: [],
  reserves: [],
  ...over,
})

const ctx = { rate: 5.45, leadTimeByFactory: new Map([['HAIRCHUAN', { avgDays: 60 }]]), now: NOW }

describe('classifyOrder', () => {
  it('atraso em fabricação vai pra "precisa de você"', () => {
    // 200 dias corridos contra prazo prometido de 90
    const o = order({ order_date: iso(NOW - 200 * DAY), promised_lead_days: 90 })
    const c = classifyOrder(o, ctx)
    expect(c.group).toBe('attention')
    expect(c.reasons.map(r => r.id)).toContain('late')
  })

  it('concluído com saldo em aberto vai pra "precisa de você", não pra fechados', () => {
    const c = classifyOrder(order({ status: 'completed' }), ctx)
    expect(c.group).toBe('attention')
    expect(c.reasons.map(r => r.id)).toContain('open_debt_completed')
  })

  it('concluído e quitado vai pra fechados', () => {
    const c = classifyOrder(order({ status: 'completed', settled_at: iso(NOW) }), ctx)
    expect(c.group).toBe('closed')
    expect(c.reasons).toHaveLength(0)
  })

  it('chegada prevista vencida pede atenção', () => {
    const o = order({ status: 'in_transit', expected_arrival: iso(NOW - 3 * DAY), settled_at: iso(NOW) })
    const c = classifyOrder(o, ctx)
    expect(c.group).toBe('attention')
    expect(c.reasons.map(r => r.id)).toEqual(['arrival_late'])
  })

  it('rascunho esquecido pede atenção; rascunho novo não', () => {
    const velho = order({ status: 'draft', order_date: iso(NOW - 60 * DAY), settled_at: iso(NOW) })
    const novo = order({ status: 'draft', order_date: iso(NOW - 2 * DAY), settled_at: iso(NOW) })
    expect(classifyOrder(velho, ctx).reasons.map(r => r.id)).toEqual(['stale_draft'])
    expect(classifyOrder(novo, ctx).group).toBe('active')
  })

  it('em andamento sem nada de errado não gera motivo', () => {
    const c = classifyOrder(order({ settled_at: iso(NOW) }), ctx)
    expect(c.group).toBe('active')
    expect(c.reasons).toHaveLength(0)
  })
})

describe('groupOrders', () => {
  it('separa em 3 grupos e nunca deixa concluído no meio do caminho', () => {
    const orders = [
      order({ id: 'conc', status: 'completed', settled_at: iso(NOW) }),
      order({ id: 'fab', settled_at: iso(NOW) }),
      order({ id: 'atrasado', order_date: iso(NOW - 200 * DAY), promised_lead_days: 90, settled_at: iso(NOW) }),
    ]
    const gs = groupOrders(orders, ctx)
    expect(gs.map(g => g.id)).toEqual(['attention', 'active', 'closed'])
    expect(gs[0].orders.map(o => o.id)).toEqual(['atrasado'])
    expect(gs[1].orders.map(o => o.id)).toEqual(['fab'])
    expect(gs[2].orders.map(o => o.id)).toEqual(['conc'])
  })

  it('omite grupos vazios', () => {
    const gs = groupOrders([order({ settled_at: iso(NOW) })], ctx)
    expect(gs.map(g => g.id)).toEqual(['active'])
  })

  it('em andamento: trânsito antes de fabricação, e prazo mais apertado antes', () => {
    const orders = [
      order({ id: 'folgado', promised_lead_days: 300, settled_at: iso(NOW) }),
      order({ id: 'apertado', promised_lead_days: 12, settled_at: iso(NOW) }),
      order({ id: 'chegando', status: 'in_transit', expected_arrival: iso(NOW + 5 * DAY), settled_at: iso(NOW) }),
    ]
    const [g] = groupOrders(orders, ctx)
    expect(g.orders.map(o => o.id)).toEqual(['chegando', 'apertado', 'folgado'])
  })

  it('expõe os motivos por id do pedido', () => {
    const gs = groupOrders([order({ id: 'x', status: 'completed' })], ctx)
    expect(gs[0].reasonsById.get('x').map(r => r.id)).toContain('open_debt_completed')
  })
})

describe('sortOrders', () => {
  it('por data usa order_date (não a data em que foi digitado)', () => {
    const orders = [
      order({ id: 'antigo', order_date: '2025-10-11', created_at: '2026-07-20' }),
      order({ id: 'novo', order_date: '2026-07-30', created_at: '2026-01-02' }),
    ]
    expect(sortOrders(orders, 'date', ctx).map(o => o.id)).toEqual(['novo', 'antigo'])
  })

  it('por falta pagar coloca a maior dívida em cima e ignora quitado', () => {
    const orders = [
      order({ id: 'quitado', settled_at: iso(NOW) }),
      order({ id: 'pequeno', items: [{ id: 'i', price_usd_snapshot: '10', final_price_usd: '10', colors: [{ code: '1B', qty: 1 }] }] }),
      order({ id: 'grande' }),
    ]
    expect(sortOrders(orders, 'debt', ctx).map(o => o.id)).toEqual(['grande', 'pequeno', 'quitado'])
  })
})

describe('proposeOrderName', () => {
  it('usa MÊS/ANO · FÁBRICA', () => {
    expect(proposeOrderName({ factory: 'HAIRCHUAN', order_date: '2026-07-30' }, [])).toBe('JUL/26 · HAIRCHUAN')
    expect(proposeOrderName({ factory: 'epf', order_date: '2025-10-11' }, [])).toBe('OUT/25 · EPF')
  })

  it('numera quando o nome já existe', () => {
    const existentes = [{ id: 'a', order_name: 'JUL/26 · EPF' }, { id: 'b', order_name: 'jul/26 · epf (2)' }]
    expect(proposeOrderName({ factory: 'EPF', order_date: '2026-07-12' }, existentes)).toBe('JUL/26 · EPF (3)')
  })

  it('não conta o próprio pedido nem os da lixeira', () => {
    const existentes = [
      { id: 'eu', order_name: 'JUL/26 · EPF' },
      { id: 'z', order_name: 'JUL/26 · EPF (2)', deleted_at: '2026-07-01' },
    ]
    expect(proposeOrderName({ id: 'eu', factory: 'EPF', order_date: '2026-07-12' }, existentes)).toBe('JUL/26 · EPF')
  })

  it('sem fábrica não sugere nada', () => {
    expect(proposeOrderName({ order_date: '2026-07-30' }, [])).toBe('')
  })

  it('monthTag lê data "só dia" no fuso local', () => {
    expect(monthTag('2026-01-01')).toBe('JAN/26')
    expect(monthTag('2026-03-01')).toBe('MAR/26')
  })
})
