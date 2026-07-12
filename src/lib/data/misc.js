// src/lib/data/misc.js
// Ideas, factories, collections, colors, names, logs, shopify cache.
// Todos sem relacionamentos complexos — CRUD direto.

import { supabase } from '../supabase'
import { log } from '../logger'

// ═══════════════════════════════════════════════════════════════════
// IDEAS
// ═══════════════════════════════════════════════════════════════════
export async function listIdeas() {
  const { data, error } = await supabase.from('ideas').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Helpers de sanitização (evita "invalid input syntax for numeric: ''")
function sanNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}
function sanText(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export async function createIdea(idea) {
  const NUMERIC = new Set(['price_usd'])
  const TEXT = new Set(['collection','factory','factory_code','finish_type','reparticao','reparticao_size','reparticao_acabamento','hair_type','length','material','notes','card_image_url'])
  const allowed = ['name','status','collection','factory','factory_code','finish_type','reparticao','reparticao_size','reparticao_acabamento','pre_plucked','hair_type','length','material','notes','card_image_url','photos','price_usd','timeline','created_by']
  const payload = {}
  for (const k of allowed) {
    if (idea[k] === undefined) continue
    if (NUMERIC.has(k)) payload[k] = sanNum(idea[k])
    else if (TEXT.has(k)) payload[k] = sanText(idea[k])
    else payload[k] = idea[k]
  }
  const { data, error } = await supabase.from('ideas').insert(payload).select().single()
  if (error) throw error
  return data
}

export async function updateIdea(id, patch) {
  const NUMERIC = new Set(['price_usd'])
  const TEXT = new Set(['collection','factory','factory_code','finish_type','reparticao','reparticao_size','reparticao_acabamento','hair_type','length','material','notes','card_image_url'])
  const allowed = ['name','status','collection','factory','factory_code','finish_type','reparticao','reparticao_size','reparticao_acabamento','pre_plucked','hair_type','length','material','notes','card_image_url','photos','price_usd','timeline']
  const payload = {}
  for (const k of allowed) {
    if (patch[k] === undefined) continue
    if (NUMERIC.has(k)) payload[k] = sanNum(patch[k])
    else if (TEXT.has(k)) payload[k] = sanText(patch[k])
    else payload[k] = patch[k]
  }
  const { error } = await supabase.from('ideas').update(payload).eq('id', id)
  if (error) throw error
}

export async function deleteIdea(id) {
  const { error } = await supabase.from('ideas').delete().eq('id', id)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════
// FACTORIES
// ═══════════════════════════════════════════════════════════════════
export async function listFactories() {
  const { data, error } = await supabase.from('factories').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function upsertFactory(factory) {
  const payload = {
    ...(factory.id ? { id: factory.id } : {}),
    name: factory.name,
    country: factory.country || 'China',
    contact: factory.contact || null,
    notes: factory.notes || null,
    wechats: factory.wechats || [],
  }
  const { data, error } = await supabase.from('factories').upsert(payload).select().single()
  if (error) throw error
  return data
}

export async function deleteFactory(id) {
  const { error } = await supabase.from('factories').delete().eq('id', id)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════
// COLLECTIONS
// ═══════════════════════════════════════════════════════════════════
export async function listCollections() {
  const { data, error } = await supabase.from('collections').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function upsertCollection(collection) {
  const payload = {
    ...(collection.id ? { id: collection.id } : {}),
    name: collection.name,
    description: collection.description || null,
    active: collection.active ?? true,
    logo_url: collection.logo_url || null,
  }
  const { data, error } = await supabase.from('collections').upsert(payload).select().single()
  if (error) throw error
  return data
}

export async function deleteCollection(id) {
  const { error } = await supabase.from('collections').delete().eq('id', id)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════
// COLORS
// ═══════════════════════════════════════════════════════════════════
// v13.23 listColors agora traz array `category_ids` com IDs das categorias atribuídas.
// Faz 2 queries em paralelo (cores + assignments) e mescla client-side
// — mais previsível que JOIN aninhado do Supabase pra esse caso.
export async function listColors() {
  const [colorsRes, assignsRes] = await Promise.all([
    supabase.from('colors').select('*').order('code'),
    supabase.from('color_category_assignments').select('color_id, category_id').then(r => r).catch(() => ({ data: [] })),
  ])
  if (colorsRes.error) throw colorsRes.error
  
  // Indexa assignments por color_id
  const byColor = new Map()
  for (const a of (assignsRes.data || [])) {
    if (!byColor.has(a.color_id)) byColor.set(a.color_id, [])
    byColor.get(a.color_id).push(a.category_id)
  }
  
  return (colorsRes.data || []).map(c => ({
    ...c,
    category_ids: byColor.get(c.id) || [],
  }))
}

export async function upsertColor(color) {
  const payload = {
    code: color.code,
    name_pt: color.name_pt || null,
    hex: color.hex || null,
    photo_url: color.photo_url || null,
    factories: color.factories || [],
    notes: color.notes || null,
  }
  // Se tem id, é UPDATE explícito (preserva id e não dispara unique constraint).
  // Se não tem, é INSERT puro.
  // Bug v13.20→v13.22: upsert sem onConflict tentava inserir mesmo com id setado,
  // o que disparava unique constraint em colors.code se a cor já existia.
  let savedColor
  if (color.id) {
    const { data, error } = await supabase
      .from('colors')
      .update(payload)
      .eq('id', color.id)
      .select()
      .single()
    if (error) throw error
    savedColor = data
  } else {
    const { data, error } = await supabase
      .from('colors')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    savedColor = data
  }
  
  // v13.23 Sincroniza categorias se passadas (replace mode: apaga todas + insere as novas)
  if (Array.isArray(color.category_ids)) {
    await syncColorCategories(savedColor.id, color.category_ids)
  }
  
  return { ...savedColor, category_ids: color.category_ids || [] }
}

export async function deleteColor(id) {
  // ON DELETE CASCADE em color_category_assignments cuida da junction
  const { error } = await supabase.from('colors').delete().eq('id', id)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════
// v13.23 COLOR CATEGORIES (livres + N:N)
// ═══════════════════════════════════════════════════════════════════
export async function listColorCategories() {
  const [catsRes, assignsRes] = await Promise.all([
    supabase.from('color_categories').select('*').order('sort_order').order('name'),
    supabase.from('color_category_assignments').select('category_id').then(r => r).catch(() => ({ data: [] })),
  ])
  if (catsRes.error) throw catsRes.error
  
  // Conta cores por categoria
  const counts = new Map()
  for (const a of (assignsRes.data || [])) {
    counts.set(a.category_id, (counts.get(a.category_id) || 0) + 1)
  }
  
  return (catsRes.data || []).map(c => ({ ...c, color_count: counts.get(c.id) || 0 }))
}

export async function upsertColorCategory(cat) {
  const payload = {
    name: (cat.name || '').trim(),
    hex: cat.hex || null,
    icon: cat.icon || null,
    sort_order: cat.sort_order != null ? Number(cat.sort_order) : 0,
  }
  if (!payload.name) throw new Error('Nome da categoria é obrigatório')
  
  if (cat.id) {
    const { data, error } = await supabase
      .from('color_categories')
      .update(payload)
      .eq('id', cat.id)
      .select()
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .from('color_categories')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteColorCategory(id) {
  // ON DELETE CASCADE remove assignments automaticamente
  const { error } = await supabase.from('color_categories').delete().eq('id', id)
  if (error) throw error
}

// Sincroniza categorias de uma cor: substitui o set inteiro pelo novo
async function syncColorCategories(colorId, categoryIds) {
  // 1. Deleta todos assignments dessa cor
  const { error: delErr } = await supabase
    .from('color_category_assignments')
    .delete()
    .eq('color_id', colorId)
  if (delErr) throw delErr
  
  // 2. Insere os novos (se houver)
  if (categoryIds.length === 0) return
  const rows = categoryIds.map(cid => ({ color_id: colorId, category_id: cid }))
  const { error: insErr } = await supabase
    .from('color_category_assignments')
    .insert(rows)
  if (insErr) throw insErr
}

// ═══════════════════════════════════════════════════════════════════
// NAMES (banco de nomes livre)
// ═══════════════════════════════════════════════════════════════════
export async function listNames() {
  const { data, error } = await supabase.from('names').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function addName(name) {
  const { data, error } = await supabase.from('names').insert({ name }).select().single()
  if (error) throw error
  return data
}

export async function deleteName(id) {
  const { error } = await supabase.from('names').delete().eq('id', id)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY LOG (append-only)
// ═══════════════════════════════════════════════════════════════════
export async function listLogs(limit = 100) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// #11 — Lista logs de uma entidade específica (produto, pedido, etc.)
// Usado pra mostrar "📜 Mudanças Recentes" no detalhe.
export async function listLogsForEntity(entityType, entityId, limit = 15) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    log.warn('[KIRA] Falha ao buscar logs:', error.message)
    return []
  }
  return data || []
}

export async function addLog({ userId, userName, action, target, details, entityType, entityId }) {
  const { error } = await supabase.from('activity_logs').insert({
    user_id: userId || null,
    user_name_snapshot: userName || 'Sistema',
    action,
    target: target || null,
    details: details || null,
    entity_type: entityType || null,
    entity_id: entityId || null,
  })
  // Não lança erro pra não atrapalhar fluxo principal — log falhando não é crítico
  if (error) log.warn('[KIRA] Falha ao gravar log:', error.message)
}

// ═══════════════════════════════════════════════════════════════════
// SHOPIFY CACHE (singleton)
// ═══════════════════════════════════════════════════════════════════
export async function getShopifyCache() {
  const { data, error } = await supabase.from('shopify_cache').select('*').eq('id', 1).single()
  if (error) return { products: [], orders: [], last_sync: null }
  return data
}

export async function setShopifyCache(products, orders) {
  const { error } = await supabase
    .from('shopify_cache')
    .update({
      products,
      orders,
      last_sync: new Date().toISOString(),
    })
    .eq('id', 1)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════
// PROFILES / USERS
// ═══════════════════════════════════════════════════════════════════
export async function listProfiles() {
  const { data, error } = await supabase.from('profiles').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function updateProfileRole(id, role) {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════
// Retenção de logs: deleta registros com mais de N dias
// Disparado uma vez por dia (via runOncePerDay no App.jsx)
// ═══════════════════════════════════════════════════════════════════
export async function cleanOldLogs(retentionDays = 90) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - retentionDays)
  const cutoffISO = cutoff.toISOString()
  
  try {
    const { error, count } = await supabase
      .from('logs')
      .delete({ count: 'exact' })
      .lt('created_at', cutoffISO)
    
    if (error) {
      log.warn('[logs-clean] erro:', error.message)
      return { success: false, error: error.message }
    }
    
    if (count && count > 0) {
      log.info(`[logs-clean] ✓ ${count} logs antigos removidos (>${retentionDays}d)`)
    }
    return { success: true, removed: count || 0 }
  } catch (e) {
    log.warn('[logs-clean] exceção:', e)
    return { success: false, error: String(e) }
  }
}
