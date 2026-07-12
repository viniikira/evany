// src/lib/creationAssist.test.js
// v13.51 — Testa o assistente de criação.

import { describe, it, expect } from 'vitest'
import { freeNames, findNameConflict, specTemplateFrom, SPEC_FIELDS } from './creationAssist'

const names = [
  { id: 1, name: 'Anna' }, { id: 2, name: 'Bianca' }, { id: 3, name: 'Carla' }, { id: 4, name: 'Duda' },
]
const products = [{ id: 'p1', name: 'Anna' }]
const ideas = [{ id: 'i1', name: 'bianca' }] // case diferente de propósito

describe('freeNames', () => {
  it('remove nomes já usados por produto ou ideia (case-insensitive)', () => {
    const free = freeNames(names, products, ideas).map(n => n.name)
    expect(free).toEqual(['Carla', 'Duda'])
  })

  it('sem produtos/ideias, todos os nomes ficam livres', () => {
    expect(freeNames(names, [], []).length).toBe(4)
  })

  it('ignora entradas inválidas', () => {
    expect(freeNames([{ id: 9 }, null, { name: 'Ok' }], [], []).map(n => n.name)).toEqual(['Ok'])
  })
})

describe('findNameConflict', () => {
  it('detecta conflito com produto', () => {
    expect(findNameConflict('anna', products, ideas)).toEqual({ type: 'product', name: 'Anna' })
  })

  it('detecta conflito com ideia', () => {
    expect(findNameConflict('BIANCA', products, ideas)).toEqual({ type: 'idea', name: 'bianca' })
  })

  it('ignora o próprio registro em edição (currentId)', () => {
    expect(findNameConflict('bianca', products, ideas, 'i1')).toBeNull()
  })

  it('nome livre não gera conflito', () => {
    expect(findNameConflict('Carla', products, ideas)).toBeNull()
    expect(findNameConflict('', products, ideas)).toBeNull()
  })
})

describe('specTemplateFrom', () => {
  it('copia só campos técnicos preenchidos', () => {
    const src = {
      id: 'p1', name: 'Lara', card_image_url: 'x', status: 'catalog',
      finish_type: 'Lace Front', material: 'Fibra Premium', hair_type: 'Liso',
      length: '', factory: 'EPF', pre_plucked: true,
    }
    const t = specTemplateFrom(src)
    expect(t).toEqual({
      finish_type: 'Lace Front', material: 'Fibra Premium', hair_type: 'Liso',
      factory: 'EPF', pre_plucked: true,
    })
    // não vaza nome/foto/status
    expect(t.name).toBeUndefined()
    expect(t.card_image_url).toBeUndefined()
    expect(t.status).toBeUndefined()
    // length vazio não entra
    expect('length' in t).toBe(false)
  })

  it('fonte nula retorna objeto vazio', () => {
    expect(specTemplateFrom(null)).toEqual({})
  })

  it('SPEC_FIELDS não inclui campos de identidade', () => {
    for (const forbidden of ['name', 'card_image_url', 'photos', 'status', 'color_variants', 'price_usd']) {
      expect(SPEC_FIELDS).not.toContain(forbidden)
    }
  })
})
