// src/hooks/useFavorites.js
// v13.44 — Hook singleton de favoritos.
//
// Mantém o Set de favoritos em estado compartilhado via event emitter simples,
// pra todos os <FavoriteStar /> na tela se manterem sincronizados sem prop drilling.
//
// Padrão: carrega uma vez no login, atualiza em memória ao toggle, reconcilia com o banco.

import { useState, useEffect, useCallback } from 'react'
import { listFavoritesAsSet, toggleFavorite } from '../lib/data/favorites'
import { log } from '../lib/logger'

// Estado global simples (sem libs)
let _cachedSet = null
let _loading = false
const _listeners = new Set()

function notify() {
  for (const l of _listeners) l(_cachedSet)
}

async function ensureLoaded() {
  if (_cachedSet) return _cachedSet
  if (_loading) {
    // Espera o loading em andamento
    await new Promise((resolve) => {
      const check = () => {
        if (_cachedSet || !_loading) resolve()
        else setTimeout(check, 50)
      }
      check()
    })
    return _cachedSet
  }
  _loading = true
  try {
    _cachedSet = await listFavoritesAsSet()
    notify()
  } catch (err) {
    log.error('[useFavorites] erro ao carregar:', err)
    _cachedSet = new Set()
  } finally {
    _loading = false
  }
  return _cachedSet
}

/**
 * Hook pra usar favoritos em componentes.
 * Retorna:
 *   - isFav(type, id): boolean
 *   - toggle(type, id): Promise<boolean>
 *   - ready: bool (true quando já carregou uma vez)
 */
export function useFavorites() {
  const [set, setSet] = useState(_cachedSet)
  const [ready, setReady] = useState(!!_cachedSet)

  useEffect(() => {
    const listener = (newSet) => {
      // Nova referência do Set pra forçar re-render
      setSet(new Set(newSet))
      setReady(true)
    }
    _listeners.add(listener)

    if (!_cachedSet) {
      ensureLoaded().then(() => {
        setSet(new Set(_cachedSet))
        setReady(true)
      })
    }

    return () => { _listeners.delete(listener) }
  }, [])

  const isFav = useCallback((type, id) => {
    if (!set) return false
    return set.has(`${type}|${String(id)}`)
  }, [set])

  const toggle = useCallback(async (type, id) => {
    const key = `${type}|${String(id)}`
    const wasFav = _cachedSet?.has(key) || false
    // Optimistic update
    if (!_cachedSet) _cachedSet = new Set()
    if (wasFav) _cachedSet.delete(key)
    else _cachedSet.add(key)
    notify()

    try {
      await toggleFavorite(type, id, wasFav)
    } catch (err) {
      // Reverte em caso de erro
      if (wasFav) _cachedSet.add(key)
      else _cachedSet.delete(key)
      notify()
      throw err
    }
    return !wasFav
  }, [])

  return { isFav, toggle, ready }
}

/**
 * Força reload do cache (usado em logout ou após ações externas).
 */
export function resetFavoritesCache() {
  _cachedSet = null
  _loading = false
  notify()
}
