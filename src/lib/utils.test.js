// src/lib/utils.test.js
// Testes pra helpers puros: UC, uid, formatDate, runOncePerDay
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UC, uid, formatDate, runOncePerDay } from './utils'

describe('UC', () => {
  it('converte string em maiúsculas', () => {
    expect(UC('hello')).toBe('HELLO')
    expect(UC('mariA')).toBe('MARIA')
  })
  
  it('retorna string vazia pra null/undefined sem crashar', () => {
    expect(UC(null)).toBe('')
    expect(UC(undefined)).toBe('')
  })
  
  it('retorna string vazia pra string vazia', () => {
    expect(UC('')).toBe('')
  })
  
  it('lida com números convertendo pra string', () => {
    expect(UC(42)).toBe('42')
  })
  
  it('preserva caracteres especiais e acentos', () => {
    expect(UC('café')).toBe('CAFÉ')
    expect(UC('1B/27')).toBe('1B/27')
  })
})

describe('uid', () => {
  it('retorna string', () => {
    expect(typeof uid()).toBe('string')
  })
  
  it('gera ids únicos', () => {
    const ids = new Set()
    for (let i = 0; i < 100; i++) ids.add(uid())
    expect(ids.size).toBe(100)
  })
  
  it('id tem comprimento razoável (não vazio, não enorme)', () => {
    const id = uid()
    expect(id.length).toBeGreaterThan(8)
    expect(id.length).toBeLessThan(60)
  })
})

describe('formatDate', () => {
  // Data fixa pra testes determinísticos: 15 de março de 2026, 14:30 UTC
  const DATE = '2026-03-15T14:30:00.000Z'
  
  it('modo "short" retorna dia/mês', () => {
    const r = formatDate(DATE, 'short')
    expect(r).toMatch(/15\/03|15 mar/i)
  })
  
  it('retorna string vazia pra entrada inválida', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('')).toBe('')
  })
  
  it('lida com data inválida sem crashar', () => {
    const r = formatDate('not-a-date')
    expect(typeof r).toBe('string')  // pode ser '—' ou vazio mas não crasha
  })
  
  it('aceita objeto Date', () => {
    const d = new Date(DATE)
    const r = formatDate(d, 'short')
    expect(r).toMatch(/15/)
  })
})

describe('runOncePerDay', () => {
  let store
  
  beforeEach(() => {
    // Vitest roda em node, sem localStorage. Stub global pra cada teste com store fresco.
    store = {}
    vi.stubGlobal('localStorage', {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
      clear: () => { Object.keys(store).forEach(k => delete store[k]) },
    })
  })
  
  it('executa fn quando key não existe no localStorage', async () => {
    const fn = vi.fn()
    runOncePerDay('test-key', fn)
    // fn é chamado num microtask (Promise.resolve().then) — espera flush
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
  })
  
  it('NÃO executa fn se já rodou hoje', async () => {
    const fn = vi.fn()
    runOncePerDay('test-key', fn)
    runOncePerDay('test-key', fn)
    runOncePerDay('test-key', fn)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
