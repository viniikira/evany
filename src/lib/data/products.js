// src/lib/data/products.js
// Camada de acesso a produtos. Usa tabelas relacionais.
// products tem color_variants e suppliers separados.
//
// LEITURA: usa a view `products_safe` que mascara fábrica/preço no servidor
// pra quem não é admin/gerente (bug #18). Equipe nem via DevTools enxerga.
// ESCRITA: continua na tabela `products` direto (RLS bloqueia equipe).

import { supabase } from '../supabase'

export async function listProducts() {
  const [prodsRes, cvsRes, suppRes] = await Promise.all([
    supabase.from('products_safe').select('*').order('created_at', { ascending: false }),
    supabase.from('color_variants').select('*'),
    // Suppliers só é populado pra admin (RLS impede leitura pra outros — retorna vazio)
    supabase.from('suppliers').select('*'),
  ])
  if (prodsRes.error) throw prodsRes.error
  if (cvsRes.error) throw cvsRes.error
  // suppliers pode dar erro pra não-admin; tratamos como lista vazia em vez de explodir
  const suppData = suppRes.error ? [] : (suppRes.data || [])

  const cvsByProduct = new Map()
  for (const cv of cvsRes.data || []) {
    if (!cvsByProduct.has(cv.product_id)) cvsByProduct.set(cv.product_id, [])
    cvsByProduct.get(cv.product_id).push(cv)
  }
  const suppByProduct = new Map()
  for (const s of suppData) {
    if (!suppByProduct.has(s.product_id)) suppByProduct.set(s.product_id, [])
    suppByProduct.get(s.product_id).push(s)
  }

  return (prodsRes.data || []).map(p => ({
    ...p,
    color_variants: cvsByProduct.get(p.id) || [],
    suppliers: suppByProduct.get(p.id) || [],
  }))
}

export async function getProduct(id) {
  const [p, cvs, supp] = await Promise.all([
    supabase.from('products_safe').select('*').eq('id', id).single(),
    supabase.from('color_variants').select('*').eq('product_id', id),
    supabase.from('suppliers').select('*').eq('product_id', id),
  ])
  if (p.error) throw p.error
  return { 
    ...p.data, 
    color_variants: cvs.data || [], 
    suppliers: supp.error ? [] : (supp.data || []),
  }
}

// Cria um produto (sem color_variants nem suppliers — esses são upsertados separados)
export async function createProduct(product) {
  const { color_variants, suppliers, ...rest } = product
  const insertData = cleanProductPayload(rest)
  const { data, error } = await supabase
    .from('products')
    .insert(insertData)
    .select()
    .single()
  if (error) throw error

  if (color_variants?.length) await upsertColorVariants(data.id, color_variants)
  if (suppliers?.length) await upsertSuppliers(data.id, suppliers)

  return await getProduct(data.id)
}

export async function updateProduct(id, patch) {
  const { color_variants, suppliers, ...rest } = patch
  const updateData = cleanProductPayload(rest)
  const { error } = await supabase.from('products').update(updateData).eq('id', id)
  if (error) throw error

  if (color_variants !== undefined) await replaceColorVariants(id, color_variants)
  if (suppliers !== undefined) await replaceSuppliers(id, suppliers)

  return await getProduct(id)
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

// Atualiza só o status (leve, não carrega tudo)
export async function updateProductStatus(id, status, timelineNote = '') {
  // Busca timeline atual pra adicionar evento
  const { data: prod, error: err1 } = await supabase
    .from('products').select('timeline').eq('id', id).single()
  if (err1) throw err1
  const tl = prod.timeline || []
  tl.push({ status, date: new Date().toISOString(), note: timelineNote })

  const { error } = await supabase.from('products').update({ status, timeline: tl }).eq('id', id)
  if (error) throw error
}

// Converte valor potencialmente "" ou null em null, ou número válido.
// Evita o bug "invalid input syntax for type numeric: ''" quando usuário
// deixa campo numérico em branco.
function sanitizeNumeric(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

// Strings vazias viram null pra colunas TEXT (evita lixo no banco).
function sanitizeText(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Remove campos que não devem ir pro INSERT/UPDATE e sanitiza vazios.
function cleanProductPayload(product) {
  const NUMERIC_KEYS = new Set(['price_usd'])
  const TEXT_KEYS = new Set(['collection','factory','factory_code','finish_type',
    'reparticao','reparticao_size','reparticao_acabamento','hair_type','length',
    'material','notes','card_image_url','sku'])
  const allowedKeys = [
    'name','status','collection','factory','factory_code','finish_type',
    'reparticao','reparticao_size','reparticao_acabamento','hair_type','length',
    'material','notes','card_image_url','photos','sku','pre_plucked','price_usd',
    'internal_notes','timeline','created_by','from_idea_id'
  ]
  const out = {}
  for (const k of allowedKeys) {
    if (product[k] === undefined) continue
    if (NUMERIC_KEYS.has(k)) out[k] = sanitizeNumeric(product[k])
    else if (TEXT_KEYS.has(k)) out[k] = sanitizeText(product[k])
    else out[k] = product[k]
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════
// COLOR VARIANTS
// ═══════════════════════════════════════════════════════════════════
async function upsertColorVariants(productId, variants) {
  if (!variants.length) return
  const rows = variants.map(cv => ({
    ...(cv.id && !String(cv.id).startsWith('tmp-') ? { id: cv.id } : {}),
    product_id: productId,
    code: cv.code,
    status: cv.status || 'idea',
    sku: cv.sku || null,
  }))
  const { error } = await supabase.from('color_variants').upsert(rows)
  if (error) throw error
}

// Replace ATÔMICO via RPC: DELETE + INSERT em uma transação no Postgres.
// Se INSERT falhar, DELETE é revertido. Resolve o bug histórico de "produto
// ficar sem cores" quando havia falha de rede no meio da operação.
async function replaceColorVariants(productId, variants) {
  // Filtra cores válidas (com code não vazio), deduplica por code
  const seen = new Set()
  const cleaned = (variants || [])
    .filter(cv => cv.code && cv.code.trim())
    .filter(cv => {
      const k = cv.code.trim().toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map(cv => ({
      code: cv.code.trim(),
      status: cv.status || 'idea',
      sku: cv.sku ? String(cv.sku).trim() : null,
    }))
  
  const { error } = await supabase.rpc('replace_color_variants', {
    p_product_id: productId,
    p_variants: cleaned,
  })
  if (error) throw error
}

export async function updateColorVariantStatus(variantId, status) {
  const { error } = await supabase.from('color_variants').update({ status }).eq('id', variantId)
  if (error) throw error
}

// Bulk: atualiza status de várias cores de uma vez (usado no fluxo pedido→cores)
// v13.34 — Atualiza status de várias cores de um produto.
// Case-insensitive na busca: procura cores com code matching independente de case
// (corrige bug onde "1B" no pedido não batia com "1b" no banco).
export async function bulkUpdateColorStatus(productId, codes, newStatus) {
  if (!codes.length) return
  
  // 1) Busca todas as cores do produto + filtra in-memory por code normalizado
  const { data: variants, error: fetchErr } = await supabase
    .from('color_variants')
    .select('id, code')
    .eq('product_id', productId)
  if (fetchErr) throw fetchErr
  
  const normalize = s => (s || '').toString().toUpperCase().trim()
  const targetCodesNorm = new Set(codes.map(normalize))
  const matchingIds = (variants || [])
    .filter(v => targetCodesNorm.has(normalize(v.code)))
    .map(v => v.id)
  
  if (matchingIds.length === 0) return
  
  // 2) Update por IDs (preciso, sem ambiguidade)
  const { error } = await supabase
    .from('color_variants')
    .update({ status: newStatus })
    .in('id', matchingIds)
  if (error) throw error
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIERS
// ═══════════════════════════════════════════════════════════════════
async function upsertSuppliers(productId, suppliers) {
  if (!suppliers.length) return
  const rows = suppliers.map(s => ({
    ...(s.id && !String(s.id).startsWith('tmp-') ? { id: s.id } : {}),
    product_id: productId,
    factory: s.factory,
    factory_code: s.factory_code || null,
    price_usd: s.price_usd || null,
  }))
  const { error } = await supabase.from('suppliers').upsert(rows)
  if (error) throw error
}

async function replaceSuppliers(productId, suppliers) {
  const cleaned = (suppliers || [])
    .filter(s => s.factory && String(s.factory).trim())
    .map(s => {
      const price = sanitizeNumeric(s.price_usd)
      return {
        factory: String(s.factory).trim(),
        factory_code: sanitizeText(s.factory_code),
        price_usd: price != null ? String(price) : null,
      }
    })
  
  const { error } = await supabase.rpc('replace_suppliers', {
    p_product_id: productId,
    p_suppliers: cleaned,
  })
  if (error) throw error
}
