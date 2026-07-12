// src/lib/normalizeColorCode.test.js
// v13.34 — Testes pra normalizeColorCode (helper crítico pro bug fix de cores)

import { describe, it, expect } from 'vitest'
import { normalizeColorCode, UC } from './utils'

describe('normalizeColorCode', () => {
  it('converte pra maiúsculas', () => {
    expect(normalizeColorCode('1b')).toBe('1B')
    expect(normalizeColorCode('balayage')).toBe('BALAYAGE')
  })
  
  it('remove espaços nas pontas', () => {
    expect(normalizeColorCode(' 1B ')).toBe('1B')
    expect(normalizeColorCode('  P4/27  ')).toBe('P4/27')
  })
  
  it('combina UC + trim', () => {
    expect(normalizeColorCode(' 1b ')).toBe('1B')
  })
  
  it('null/undefined viram string vazia', () => {
    expect(normalizeColorCode(null)).toBe('')
    expect(normalizeColorCode(undefined)).toBe('')
  })
  
  it('string vazia vira string vazia', () => {
    expect(normalizeColorCode('')).toBe('')
    expect(normalizeColorCode('   ')).toBe('')
  })
  
  it('preserva caracteres especiais e acentos', () => {
    expect(normalizeColorCode('ash-latte')).toBe('ASH-LATTE')
    expect(normalizeColorCode('K16/613')).toBe('K16/613')
  })
  
  it('aceita números', () => {
    expect(normalizeColorCode(27)).toBe('27')
  })
  
  it('compara case-insensitive: cores que deveriam bater BATEM', () => {
    expect(normalizeColorCode('1B')).toBe(normalizeColorCode('1b'))
    expect(normalizeColorCode(' P4/27 ')).toBe(normalizeColorCode('P4/27'))
    expect(normalizeColorCode('ASH-LATTE')).toBe(normalizeColorCode('ash-latte'))
  })
  
  it('UC continua existindo (não quebrei o helper anterior)', () => {
    // Diferença: UC NÃO faz trim
    expect(UC(' 1b ')).toBe(' 1B ')
    expect(normalizeColorCode(' 1b ')).toBe('1B')
  })
})
