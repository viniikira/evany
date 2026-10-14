// src/lib/moneyMask.test.js — v13.78
import { describe, it, expect } from 'vitest'
import { toNumber, formatFixedBR, digitsToValue, pastedToValue } from './moneyMask'

describe('digitsToValue — estilo calculadora', () => {
  it('os números entram pela direita', () => {
    expect(digitsToValue('1')).toBe(0.01)
    expect(digitsToValue('12')).toBe(0.12)
    expect(digitsToValue('125')).toBe(1.25)
    expect(digitsToValue('1250050')).toBe(12500.5)
  })
  it('ignora o que já está formatado no campo (ponto, vírgula, R$)', () => {
    // campo mostrava "12.500,50" e ela digitou mais um 0 no fim
    expect(digitsToValue('12.500,500')).toBe(125005)
    expect(digitsToValue('R$ 1,25')).toBe(1.25)
  })
  it('apagar tudo deixa o campo vazio', () => {
    expect(digitsToValue('')).toBe(null)
    expect(digitsToValue(',')).toBe(null)
  })
  it('zeros à esquerda somem', () => {
    expect(digitsToValue('0,012')).toBe(0.12)
  })
  it('câmbio com 2 casas: 543 → 5,43', () => {
    expect(digitsToValue('543', 2)).toBe(5.43)
  })
  it('limita o tamanho', () => {
    expect(digitsToValue('9'.repeat(20), 2, 12)).toBe(9999999999.99)
  })
})

describe('formatFixedBR', () => {
  it('milhar com ponto e casas fixas com vírgula', () => {
    expect(formatFixedBR(12500.5)).toBe('12.500,50')
    expect(formatFixedBR(0.01)).toBe('0,01')
    expect(formatFixedBR(5.43)).toBe('5,43')
  })
})

describe('toNumber — lê o valor guardado', () => {
  it('aceita número, texto com ponto decimal e vazio', () => {
    expect(toNumber(17.5)).toBe(17.5)
    expect(toNumber('17.50')).toBe(17.5)
    expect(toNumber('17,50')).toBe(17.5)
    expect(toNumber('')).toBe(null)
    expect(toNumber(null)).toBe(null)
  })
})

describe('pastedToValue — colar valor pronto', () => {
  it('com separador, lê como está', () => {
    expect(pastedToValue('17.999,98')).toBe(17999.98)
    expect(pastedToValue('17999.98')).toBe(17999.98)
    expect(pastedToValue('R$ 3.592,81')).toBe(3592.81)
  })
  it('câmbio colado com ponto decimal', () => {
    expect(pastedToValue('5.01', 2, { money: false })).toBe(5.01)
  })
  it('só dígitos segue a regra da calculadora', () => {
    expect(pastedToValue('1250050')).toBe(12500.5)
  })
})
