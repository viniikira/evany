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
  
  it('calcula média por fábrica', () => {
    const orders = [
      order({ factory: 'EPF', created_at: '2026-01-01', updated_at: '2026-02-01' }),  // 31d
      order({ factory: 'EPF', created_at: '2026-01-01', updated_at: '2026-02-21' }),  // 51d
    ]
    const r = computeFactoryLeadTime(orders)
    expect(r.get('EPF').avgDays).toBe(41)
    expect(r.get('EPF').sampleSize).toBe(2)
  })
  
  it('separa por fábrica', () => {
    const orders = [
      order({ factory: 'EPF', created_at: '2026-01-01', updated_at: '2026-02-01' }),
      order({ factory: 'Hairchuan', created_at: '2026-01-01', updated_at: '2026-03-01' }),
    ]
    const r = computeFactoryLeadTime(orders)
    expect(r.has('EPF')).toBe(true)
    expect(r.has('Hairchuan')).toBe(true)
    expect(r.size).toBe(2)
  })
  
  it('filtra outliers (mesmo dia ou >365 dias)', () => {
    const orders = [
      order({ created_at: '2026-01-01', updated_at: '2026-01-01' }),  // 0 dias → ignorado
      order({ created_at: '2024-01-01', updated_at: '2026-01-01' }),  // >365 → ignorado
      order({ created_at: '2026-01-01', updated_at: '2026-02-01' }),  // 31 → ok
    ]
    const r = computeFactoryLeadTime(orders)
    expect(r.get('EPF').sampleSize).toBe(1)
    expect(r.get('EPF').avgDays).toBe(31)
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
