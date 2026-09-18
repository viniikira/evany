// src/lib/pendencias.test.js
// Testes pra computeFactoryLeadTime + computeOrderDelay.
// computePendencias é mais complexo (depende de muitos shapes); deixo pra rodada futura.

import { describe, it, expect } from 'vitest'
import { computeFactoryLeadTime, computeOrderDelay } from './pendencias'

const order = (o = {}) => ({
  id: 'o1', factory: 'EPF', status: 'completed',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',  // 31 dias
  ...o,
})

describe('computeFactoryLeadTime', () => {
  it('retorna Map vazio pra entrada vazia', () => {
    const r = computeFactoryLeadTime([])
    expect(r.size).toBe(0)
  })
  
  it('só conta pedidos completed', () => {
    const orders = [
      order({ status: 'manufacturing' }),
      order({ status: 'sent' }),
      order({ status: 'draft' }),
    ]
    expect(computeFactoryLeadTime(orders).size).toBe(0)
  })
  
  // v13.74 — prazo = data do pedido → saída da fábrica (histórico), não mais
  // cadastro → última edição (dava "HAIRCHUAN ~2 dias" com os dados reais)
  const left = (at, status = 'completed') => ({ status_history: [{ status, at }] })

  it('calcula média por fábrica', () => {
    const orders = [
      order({ factory: 'EPF', order_date: '2026-01-01', ...left('2026-02-01T12:00:00Z') }),  // 31d
      order({ factory: 'EPF', order_date: '2026-01-01', ...left('2026-02-21T12:00:00Z') }),  // 51d
    ]
    const r = computeFactoryLeadTime(orders)
    expect(r.get('EPF').avgDays).toBe(41)
    expect(r.get('EPF').sampleSize).toBe(2)
  })
  
  it('separa por fábrica', () => {
    const orders = [
      order({ factory: 'EPF', order_date: '2026-01-01', ...left('2026-02-01T12:00:00Z') }),
      order({ factory: 'Hairchuan', order_date: '2026-01-01', ...left('2026-03-01T12:00:00Z', 'in_transit') }),
    ]
    const r = computeFactoryLeadTime(orders)
    expect(r.has('EPF')).toBe(true)
    expect(r.has('Hairchuan')).toBe(true)
    expect(r.size).toBe(2)
  })
  
  it('filtra outliers (mesmo dia ou >365 dias)', () => {
    const orders = [
      order({ order_date: '2026-01-01', ...left('2026-01-01T12:00:00Z') }),  // 0 dias → ignorado
      order({ order_date: '2024-01-01', ...left('2026-01-01T12:00:00Z') }),  // >365 → ignorado
      order({ order_date: '2026-01-01', ...left('2026-02-01T12:00:00Z') }),  // 31 → ok
    ]
    const r = computeFactoryLeadTime(orders)
    expect(r.get('EPF').sampleSize).toBe(1)
    expect(r.get('EPF').avgDays).toBe(31)
  })

  it('ignora data de cadastro/edição: pedido digitado e concluído depois não vira "2 dias"', () => {
    // Caso real: MAIO 2025 digitado em 20/04/2026 e concluído em 22/04/2026,
    // sem data do pedido nem histórico
    const r = computeFactoryLeadTime([
      order({ factory: 'HAIRCHUAN', created_at: '2026-04-20T02:05:47Z', updated_at: '2026-04-22T00:00:00Z', status_history: [] }),
    ])
    expect(r.has('HAIRCHUAN')).toBe(false)
  })

  it('usa a PRIMEIRA saída da fábrica (em trânsito antes de concluído)', () => {
    const r = computeFactoryLeadTime([order({
      status: 'completed', order_date: '2026-01-01',
      status_history: [
        { status: 'in_transit', at: '2026-03-02T12:00:00Z' },   // 60 dias
        { status: 'completed', at: '2026-04-15T12:00:00Z' },
      ],
    })])
    expect(r.get('EPF').avgDays).toBe(60)
  })
  
  it('ignora pedido sem factory ou sem datas', () => {
    const orders = [
      order({ factory: null }),
      order({ created_at: null }),
      order({ updated_at: null }),
    ]
    expect(computeFactoryLeadTime(orders).size).toBe(0)
  })
})

describe('computeOrderDelay', () => {
  it('retorna null se não é manufacturing', () => {
    expect(computeOrderDelay(order({ status: 'completed' }))).toBeNull()
    expect(computeOrderDelay(order({ status: 'draft' }))).toBeNull()
  })
  
  it('retorna null pra pedido inexistente', () => {
    expect(computeOrderDelay(null)).toBeNull()
  })
  
  it('pedido legado sem manufacturing_started_at retorna source=legacy', () => {
    const o = order({ status: 'manufacturing', manufacturing_started_at: null })
    const r = computeOrderDelay(o)
    expect(r.source).toBe('legacy_no_start_date')
    expect(r.isLate).toBe(false)
  })
  
  it('usa promised_lead_days quando disponível', () => {
    const start = new Date(Date.now() - 50 * 86400000).toISOString()  // começou há 50 dias
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: start,
      promised_lead_days: 30,
    })
    const r = computeOrderDelay(o)
    expect(r.source).toBe('promised')
    expect(r.deadlineDays).toBe(30)
    expect(r.isLate).toBe(true)
    expect(r.daysLate).toBeGreaterThanOrEqual(19)  // ~20 dias atrasado
  })
  
  it('NÃO está atrasado se ainda dentro do prazo', () => {
    const start = new Date(Date.now() - 10 * 86400000).toISOString()  // começou há 10 dias
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: start,
      promised_lead_days: 30,
    })
    const r = computeOrderDelay(o)
    expect(r.isLate).toBe(false)
    expect(r.daysLate).toBe(0)
  })
  
  it('usa média da fábrica + 15d quando sem prazo manual', () => {
    const leadMap = new Map([['EPF', { avgDays: 30, sampleSize: 5 }]])
    const start = new Date(Date.now() - 50 * 86400000).toISOString()
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: start,
      promised_lead_days: null,
    })
    const r = computeOrderDelay(o, leadMap)
    expect(r.source).toBe('avg_with_tolerance')
    expect(r.deadlineDays).toBe(45)  // 30 + 15
  })
  
  it('source=no_data se sem prazo manual e sem média', () => {
    const start = new Date(Date.now() - 50 * 86400000).toISOString()
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: start,
    })
    const r = computeOrderDelay(o)
    expect(r.source).toBe('no_data')
    expect(r.isLate).toBe(false)
  })
  
  it('data de start corrompida → null', () => {
    const o = order({
      status: 'manufacturing',
      manufacturing_started_at: 'invalid-date',
    })
    expect(computeOrderDelay(o)).toBeNull()
  })
})
