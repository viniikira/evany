// src/lib/data/favorites.test.js
// v13.44 — Testes unitários do data layer de favoritos.
// Mocka o supabase client; testa apenas a lógica de transformação.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { supabase } from '../supabase'
import {
  listFavorites, listFavoritesAsSet,
  addFavorite, removeFavorite, toggleFavorite,
} from './favorites'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('favorites data layer', () => {
  describe('listFavoritesAsSet', () => {
    it('transforma lista em Set com chave "type|id"', async () => {
      const fakeData = [
        { id: 1, entity_type: 'product', entity_id: 'abc-123', created_at: '2026-01-01' },
        { id: 2, entity_type: 'idea', entity_id: '42', created_at: '2026-01-02' },
      ]
      supabase.from.mockReturnValue({
        select: () => ({
          order: () => Promise.resolve({ data: fakeData, error: null }),
        }),
      })
      const set = await listFavoritesAsSet()
      expect(set.has('product|abc-123')).toBe(true)
      expect(set.has('idea|42')).toBe(true)
      expect(set.has('product|xyz')).toBe(false)
      expect(set.size).toBe(2)
    })

    it('retorna Set vazio quando não há favoritos', async () => {
      supabase.from.mockReturnValue({
        select: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      })
      const set = await listFavoritesAsSet()
      expect(set.size).toBe(0)
    })

    it('lança erro quando supabase retorna erro', async () => {
      supabase.from.mockReturnValue({
        select: () => ({
          order: () => Promise.resolve({ data: null, error: new Error('RLS denied') }),
        }),
      })
      await expect(listFavoritesAsSet()).rejects.toThrow('RLS denied')
    })
  })

  describe('addFavorite', () => {
    it('valida parâmetros obrigatórios', async () => {
      await expect(addFavorite('', 'abc')).rejects.toThrow(/obrigatórios/)
      await expect(addFavorite('product', null)).rejects.toThrow(/obrigatórios/)
    })

    it('converte entity_id pra string', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-uuid' } } })
      const upsertSpy = vi.fn().mockResolvedValue({ error: null })
      supabase.from.mockReturnValue({ upsert: upsertSpy })
      await addFavorite('product', 123)  // numérico
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ entity_id: '123' }),
        expect.any(Object)
      )
    })

    it('lança erro quando usuário não autenticado', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: null } })
      await expect(addFavorite('product', 'abc')).rejects.toThrow(/autenticado/)
    })
  })

  describe('toggleFavorite', () => {
    it('chama remove se currentState=true', async () => {
      supabase.from.mockReturnValue({
        delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      })
      const next = await toggleFavorite('product', 'abc', true)
      expect(next).toBe(false)
    })

    it('chama add se currentState=false', async () => {
      supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-uuid' } } })
      supabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
      })
      const next = await toggleFavorite('product', 'abc', false)
      expect(next).toBe(true)
    })
  })
})
