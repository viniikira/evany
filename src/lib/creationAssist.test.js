// src/lib/creationAssist.test.js
// v13.51 — Testa o assistente de criação.

import { describe, it, expect } from 'vitest'
import { freeNames, findNameConflict, specTemplateFrom, proposeSku, SPEC_FIELDS, buildShopifyIndex, suggestShopifyLinks, findShopifyBySku } from './creationAssist'

// Cache fake da Shopify (formato real: products[].variants[])
const shopCache = {
  products: [
    { title: 'Afro Puff Preto Cacheado 1B', variants: [{ sku: 'CHEREY1B', inventory_quantity: 5 }] },
    { title: 'Afro Puff Castanho Cacheado', variants: [{ sku: 'CHEREY6', inventory_quantity: 3 }] },
    { title: 'Peruca Deusa Ondulada Cor 2', variants: [{ sku: 'DEUSA2', inventory_quantity: 8 }] },
    { title: 'Cola Ghost Bond', variants: [{ sku: 'GHOSTBOND', inventory_quantity: 12 }] },
    { title: 'Sem SKU', variants: [{ sku: '', inventory_quantity: 1 }] },
  ],
}

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

describe('proposeSku', () => {
  it('segue a convenção NOME+COR em maiúsculas (casos reais)', () => {
    expect(proposeSku('Valentina', '2')).toBe('VALENTINA2')
    expect(proposeSku('Valentina', '1B')).toBe('VALENTINA1B')
  })

  it('remove caracteres especiais do código e do nome', () => {
    expect(proposeSku('Ana Beatriz', '613')).toBe('ANABEATRIZ613')
    expect(proposeSku('Valentina', 'T1B/27')).toBe('VALENTINAT1B27')
  })

  it('retorna vazio se faltar nome ou código', () => {
    expect(proposeSku('', '2')).toBe('')
    expect(proposeSku('Lara', '')).toBe('')
    expect(proposeSku(null, null)).toBe('')
  })
})

describe('vínculo com a Shopify', () => {
  const index = buildShopifyIndex(shopCache)

  it('achata o cache ignorando variantes sem SKU', () => {
    expect(index).toHaveLength(4)
    expect(index[0]).toEqual({ sku: 'CHEREY1B', title: 'Afro Puff Preto Cacheado 1B', stock: 5 })
  })

  it('sugere SKUs reais pelo nome, ranqueando pela cor', () => {
    const sug = suggestShopifyLinks('Afro Puff', '1B', index)
    expect(sug.length).toBe(2)
    expect(sug[0].sku).toBe('CHEREY1B')   // sufixo do SKU bate com a cor → primeiro
  })

  it('nome sem correspondência na loja → vazio (não chuta)', () => {
    expect(suggestShopifyLinks('Valentina', '1B', index)).toEqual([])
    expect(suggestShopifyLinks('', '1B', index)).toEqual([])
  })

  it('acha por nome com acento/caixa diferente', () => {
    const sug = suggestShopifyLinks('DEUSA', '2', index)
    expect(sug[0].sku).toBe('DEUSA2')
  })

  it('findShopifyBySku valida o digitado (case-insensitive)', () => {
    expect(findShopifyBySku('cherey1b', index)?.title).toContain('Afro Puff Preto')
    expect(findShopifyBySku('NAOEXISTE', index)).toBeNull()
    expect(findShopifyBySku('', index)).toBeNull()
  })

  it('cache vazio/nulo não quebra', () => {
    expect(buildShopifyIndex(null)).toEqual([])
    expect(suggestShopifyLinks('Afro', '1B', [])).toEqual([])
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
