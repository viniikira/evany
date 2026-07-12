// src/lib/data/favorites.js
// v13.44 — Sistema universal de favoritos.
//
// API clean + genérica: aceita qualquer entity_type (product, idea, color, order, etc).
// Cada função opera apenas nos favoritos do usuário autenticado (garantido por RLS).

import { supabase } from '../supabase'

/**
 * Retorna todos os favoritos do usuário logado.
 * Opcionalmente filtra por tipo.
 *
 * @param {string} [entityType] - Filtro opcional (product, idea, color, order...)
 * @returns {Promise<Array<{id, entity_type, entity_id, created_at}>>}
 */
export async function listFavorites(entityType) {
  let q = supabase.from('user_favorites').select('*').order('created_at', { ascending: false })
  if (entityType) q = q.eq('entity_type', entityType)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Retorna um Set<string> com chaves "entity_type|entity_id" pra lookup O(1).
 * Útil pra decidir qual estrela mostrar em listas grandes.
 */
export async function listFavoritesAsSet() {
  const list = await listFavorites()
  const set = new Set()
  for (const f of list) {
    set.add(`${f.entity_type}|${f.entity_id}`)
  }
  return set
}

/**
 * Marca uma entity como favorita.
 * Idempotente — se já for favorita, não duplica (UNIQUE constraint + ON CONFLICT).
 *
 * @param {string} entityType
 * @param {string|number} entityId
 */
export async function addFavorite(entityType, entityId) {
  if (!entityType || entityId == null) throw new Error('entityType e entityId são obrigatórios')
  const { data: userRes } = await supabase.auth.getUser()
  const userId = userRes?.user?.id
  if (!userId) throw new Error('Usuário não autenticado')

  const { error } = await supabase
    .from('user_favorites')
    .upsert(
      { user_id: userId, entity_type: entityType, entity_id: String(entityId) },
      { onConflict: 'user_id,entity_type,entity_id', ignoreDuplicates: true }
    )
  if (error) throw error
}

/**
 * Remove dos favoritos.
 */
export async function removeFavorite(entityType, entityId) {
  if (!entityType || entityId == null) throw new Error('entityType e entityId são obrigatórios')
  const { error } = await supabase
    .from('user_favorites')
    .delete()
    .eq('entity_type', entityType)
    .eq('entity_id', String(entityId))
  if (error) throw error
}

/**
 * Toggle (conveniente pra UI).
 *
 * @param {string} entityType
 * @param {string|number} entityId
 * @param {boolean} currentState - estado atual (se for true, remove; senão, adiciona)
 * @returns {boolean} novo estado
 */
export async function toggleFavorite(entityType, entityId, currentState) {
  if (currentState) {
    await removeFavorite(entityType, entityId)
    return false
  }
  await addFavorite(entityType, entityId)
  return true
}
