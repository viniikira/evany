// src/lib/router.test.js
// v13.55 — Testa o mapeamento hash ↔ página e o guard de permissão.

import { describe, it, expect } from 'vitest'
import { PAGE_SLUGS, hashForPage, pageForHash, isPageAllowed } from './router'

describe('hashForPage / pageForHash', () => {
  it('ida e volta pra todas as páginas', () => {
    for (const page of Object.keys(PAGE_SLUGS)) {
      expect(pageForHash(hashForPage(page))).toBe(page)
    }
  })

  it('slugs em português nas telas principais', () => {
    expect(hashForPage('orders')).toBe('#/pedidos')
    expect(hashForPage('financial')).toBe('#/financeiro')
    expect(hashForPage('dashboard')).toBe('#/inicio')
  })

  it('tolera variações de formato', () => {
    expect(pageForHash('#/pedidos')).toBe('orders')
    expect(pageForHash('#pedidos')).toBe('orders')
    expect(pageForHash('#/pedidos/')).toBe('orders')
    expect(pageForHash('#/PEDIDOS')).toBe('orders')
    expect(pageForHash('#/pedidos/algum-id-futuro')).toBe('orders')
    expect(pageForHash('#/pedidos?x=1')).toBe('orders')
  })

  it('hash desconhecido ou vazio → null', () => {
    expect(pageForHash('#/nao-existe')).toBeNull()
    expect(pageForHash('')).toBeNull()
    expect(pageForHash('#/')).toBeNull()
    expect(pageForHash(undefined)).toBeNull()
  })

  it('página desconhecida vira raiz', () => {
    expect(hashForPage('xyz')).toBe('#/')
  })
})

describe('isPageAllowed', () => {
  const admin = { ideas: true, products: true, orders: true, prices: true, shopify: true, names: true, collections: true, factories: true, colors: true, logs: true, admin: true, backup: true, users: true }
  const equipe = { products: true, collections: true, colors: true }

  it('admin acessa tudo', () => {
    for (const page of Object.keys(PAGE_SLUGS)) {
      expect(isPageAllowed(page, admin)).toBe(true)
    }
  })

  it('equipe não acessa financeiro/pedidos/usuários', () => {
    expect(isPageAllowed('financial', equipe)).toBe(false)
    expect(isPageAllowed('orders', equipe)).toBe(false)
    expect(isPageAllowed('users', equipe)).toBe(false)
    expect(isPageAllowed('products', equipe)).toBe(true)
    expect(isPageAllowed('dashboard', equipe)).toBe(true)
  })

  it('sem perm, só dashboard', () => {
    expect(isPageAllowed('dashboard', null)).toBe(true)
    expect(isPageAllowed('orders', null)).toBe(false)
  })
})
