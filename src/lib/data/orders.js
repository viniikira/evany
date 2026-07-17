// src/lib/data/orders.js
// Pedidos: order + order_items + payments (3 tabelas relacionadas)

import { supabase } from '../supabase'
import { log } from '../logger'

export async function listOrders() {
  const [ordersRes, itemsRes, paymentsRes] = await Promise.all([
    // #18 Lixeira: por padrão, lista APENAS pedidos não deletados
    supabase.from('orders').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('order_items').select('*'),
    supabase.from('payments').select('id, order_id, payment_date, amount_usd, rate_paid, amount_brl, bank, receipt_url, created_at'),
  ])
  if (ordersRes.error) throw ordersRes.error
  if (itemsRes.error) throw itemsRes.error
  if (paymentsRes.error) throw paymentsRes.error

  const itemsByOrder = new Map()
  for (const it of itemsRes.data || []) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, [])
    itemsByOrder.get(it.order_id).push(it)
  }
  const paymentsByOrder = new Map()
  for (const p of paymentsRes.data || []) {
    if (!paymentsByOrder.has(p.order_id)) paymentsByOrder.set(p.order_id, [])
    paymentsByOrder.get(p.order_id).push(p)
  }

  return (ordersRes.data || []).map(o => ({
    ...o,
    items: itemsByOrder.get(o.id) || [],
    payments: paymentsByOrder.get(o.id) || [],
  }))
}

export async function getOrder(id) {
  const [oRes, itemsRes, pRes] = await Promise.all([
    supabase.from('orders').select('*').eq('id', id).single(),
    supabase.from('order_items').select('*').eq('order_id', id),
    supabase.from('payments').select('*').eq('order_id', id),
  ])
  if (oRes.error) throw oRes.error
  return { ...oRes.data, items: itemsRes.data || [], payments: pRes.data || [] }
}

export async function createOrder(order) {
  const { items, payments, ...rest } = order
  const insertData = cleanOrderPayload(rest)
  const { data, error } = await supabase
    .from('orders').insert(insertData).select().single()
  if (error) throw error

  if (items?.length) await replaceOrderItems(data.id, items)
  // Pagamentos não são criados junto — fluxo separado

  return await getOrder(data.id)
}

export async function updateOrder(id, patch) {
  const { items, payments, ...rest } = patch
  const updateData = cleanOrderPayload(rest)
  const { error } = await supabase.from('orders').update(updateData).eq('id', id)
  if (error) throw error

  if (items !== undefined) await replaceOrderItems(id, items)
  return await getOrder(id)
}

// v13.23 Duplica um pedido: cria rascunho novo com os mesmos items.
// NÃO copia: payments (financeiro é único do pedido), status_history (timeline zera),
// deleted_at/purged_at (claro), promised_lead_days, manufacturing_started_at,
// expected_arrival, created_by mantém o usuário atual.
// Items preservam product_id, cores, qtd, preços snapshot — você revisa antes de enviar.
//
// v13.29 — lógica pura extraída em buildDuplicateOrderPayload (testável sem Supabase)
export function buildDuplicateOrderPayload(sourceOrder, newOrderName) {
  const items = (sourceOrder.items || []).map(it => ({
    product_id: it.product_id || null,
    product_name_snapshot: it.product_name_snapshot || null,
    product_code_snapshot: it.product_code_snapshot || null,
    product_cap_snapshot: it.product_cap_snapshot || null,
    selected_photo_url: it.selected_photo_url || null,
    name_manual: it.name_manual || null,
    code_manual: it.code_manual || null,
    cap_manual: it.cap_manual || null,
    quantity: it.quantity || 0,
    price_usd: it.price_usd || null,
    price_usd_snapshot: it.price_usd_snapshot || null,
    requirements: it.requirements || null,
    colors: (it.colors || []).map(c => ({
      code: c.code || '',
      qty: c.qty || 0,
      price_usd: c.price_usd != null ? c.price_usd : null,
    })),
  }))
  
  return {
    factory: sourceOrder.factory,
    order_name: newOrderName || `${sourceOrder.order_name || sourceOrder.factory} (cópia)`,
    status: 'draft',  // sempre começa como rascunho
    notes: sourceOrder.notes || null,
    items,
  }
}

export async function duplicateOrder(sourceOrder, newOrderName) {
  const newOrder = buildDuplicateOrderPayload(sourceOrder, newOrderName)
  
  return await createOrder(newOrder)
}

// #18 deleteOrder agora faz SOFT DELETE: marca deleted_at em vez de remover.
// Pedido fica recuperável por 30 dias. Após isso, função SQL purge_old_deleted_orders
// (chamada via runOncePerDay) remove de vez com cascade nas tabelas filhas.
export async function deleteOrder(id) {
  const { error } = await supabase
    .from('orders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// #18 Restaura pedido da lixeira (zera deleted_at)
export async function restoreOrder(id) {
  const { error } = await supabase
    .from('orders')
    .update({ deleted_at: null })
    .eq('id', id)
  if (error) throw error
}

// v13.22 SOFT PURGE: marca purged_at em vez de DELETE físico.
// Pedido + items + payments + comprovantes ficam intactos no banco/Storage
// pra auditoria fiscal (que pode chegar até 5 anos depois).
// Pedido fica oculto da UI (filter purged_at IS NULL em todas as listagens).
// Pra recuperar: SQL UPDATE orders SET purged_at = NULL, deleted_at = NULL WHERE id = ...
export async function purgeOrderPermanently(id) {
  const { error } = await supabase
    .from('orders')
    .update({ purged_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// #18 Lista pedidos na lixeira (ordenados por mais recentemente deletados primeiro)
// Inclui items e payments pra mostrar resumo
export async function listDeletedOrders() {
  const [ordersRes, itemsRes, paymentsRes] = await Promise.all([
    // v13.22 Lixeira ativa = deleted mas não-purgado (purgados ficam só pra auditoria)
    supabase.from('orders').select('*').not('deleted_at', 'is', null).is('purged_at', null).order('deleted_at', { ascending: false }),
    supabase.from('order_items').select('*'),
    supabase.from('payments').select('id, order_id, payment_date, amount_usd, rate_paid, amount_brl, bank, receipt_url, created_at'),
  ])
  if (ordersRes.error) throw ordersRes.error
  if (itemsRes.error) throw itemsRes.error
  if (paymentsRes.error) throw paymentsRes.error

  const itemsByOrder = new Map()
  for (const it of itemsRes.data || []) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, [])
    itemsByOrder.get(it.order_id).push(it)
  }
  const paymentsByOrder = new Map()
  for (const p of paymentsRes.data || []) {
    if (!paymentsByOrder.has(p.order_id)) paymentsByOrder.set(p.order_id, [])
    paymentsByOrder.get(p.order_id).push(p)
  }

  return (ordersRes.data || []).map(o => ({
    ...o,
    items: itemsByOrder.get(o.id) || [],
    payments: paymentsByOrder.get(o.id) || [],
  }))
}

// #18 Roda função SQL pra purgar pedidos antigos da lixeira (>30d)
// Chamado via runOncePerDay. Falha silenciosa (logs no console).
export async function purgeOldTrash(retentionDays = 30) {
  try {
    const { data, error } = await supabase.rpc('purge_old_deleted_orders', { retention_days: retentionDays })
    if (error) {
      log.warn('[trash-purge] erro:', error.message)
      return { success: false, removed: 0 }
    }
    if (data && data > 0) log.info(`[trash-purge] ✓ ${data} pedido(s) removido(s) definitivamente`)
    return { success: true, removed: data || 0 }
  } catch (e) {
    log.warn('[trash-purge] exceção:', e)
    return { success: false, removed: 0 }
  }
}

// #21 updateOrderStatus agora também grava no status_history (timeline visual).
// Cada mudança de status registra: { status, at: timestamp, user_name }.
// Faz read-modify-write: lê status_history atual, anexa, grava.
// Falha silenciosa do read mantém compatibilidade com pedidos legados.
export async function updateOrderStatus(id, status, extra = {}) {
  // Lê status_history atual pra anexar
  let currentHistory = []
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('status_history')
      .eq('id', id)
      .single()
    if (!error && Array.isArray(data?.status_history)) {
      currentHistory = data.status_history
    }
  } catch (e) {
    // Tabela sem coluna ou erro qualquer → começa array vazio
    log.warn('[KIRA] Não consegui ler status_history:', e?.message)
  }
  
  const newEntry = {
    status,
    at: new Date().toISOString(),
    user_name: extra._user_name || null,
  }
  
  // Remove _user_name dos extras antes de gravar (não é coluna do banco)
  const cleanExtra = { ...extra }
  delete cleanExtra._user_name
  
  const payload = {
    status,
    status_history: [...currentHistory, newEntry],
    ...cleanExtra,
  }
  const { error } = await supabase.from('orders').update(payload).eq('id', id)
  if (error) throw error
}

function sanitizeNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}
function sanitizeTxt(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}
function sanitizeDate(v) {
  if (v === null || v === undefined || v === '') return null
  return v
}

function cleanOrderPayload(order) {
  const NUMERIC = new Set(['conversion_factor','budget_rate','real_cost_brl','promised_lead_days'])
  const TEXT = new Set(['order_name','dispatch_code','notes'])
  // v13.40 — order_date adicionado (DATE) pra registrar pedidos antigos retroativos
  const DATE = new Set(['expected_arrival','manufacturing_started_at','order_date'])
  const allowed = [
    'order_name','factory','status','dispatch_code','conversion_factor',
    'budget_rate','real_cost_brl','notes','expected_arrival','created_by',
    'promised_lead_days','manufacturing_started_at','order_date',
  ]
  const out = {}
  for (const k of allowed) {
    if (order[k] === undefined) continue
    if (NUMERIC.has(k)) out[k] = sanitizeNum(order[k])
    else if (TEXT.has(k)) out[k] = sanitizeTxt(order[k])
    else if (DATE.has(k)) out[k] = sanitizeDate(order[k])
    else out[k] = order[k]
  }
  return out
}

// Replace ATÔMICO via RPC. Ver explicação em data/products.js > replaceColorVariants.
async function replaceOrderItems(orderId, items) {
  const cleaned = (items || []).map(it => {
    const qty = sanitizeNum(it.quantity) || 0
    const price = sanitizeNum(it.price_usd)
    const priceSnapshot = sanitizeNum(it.price_usd_snapshot)
    // Sanitiza cores: qty é número, price_usd é opcional (null = herda do item)
    const colors = (it.colors || []).map(c => {
      const cprice = sanitizeNum(c.price_usd)
      return {
        code: sanitizeTxt(c.code) || '',
        qty: sanitizeNum(c.qty) || 0,
        price_usd: cprice != null ? String(cprice) : null,
      }
    }).filter(c => c.code)  // remove cores sem código
    return {
      product_id: sanitizeTxt(it.product_id),
      product_name_snapshot: sanitizeTxt(it.product_name_snapshot),
      product_code_snapshot: sanitizeTxt(it.product_code_snapshot),
      product_cap_snapshot: sanitizeTxt(it.product_cap_snapshot),
      selected_photo_url: sanitizeTxt(it.selected_photo_url),
      name_manual: sanitizeTxt(it.name_manual),
      code_manual: sanitizeTxt(it.code_manual),
      cap_manual: sanitizeTxt(it.cap_manual),
      quantity: String(qty),
      price_usd: price != null ? String(price) : null,
      price_usd_snapshot: priceSnapshot != null ? String(priceSnapshot) : null,
      requirements: sanitizeTxt(it.requirements),  // v13.58 — texto pra fábrica na planilha
      colors,
    }
  })
  
  const { error } = await supabase.rpc('replace_order_items', {
    p_order_id: orderId,
    p_items: cleaned,
  })
  if (error) throw error
}

// Atualização inline de quantidade (otimizada — não refaz o pedido todo)
export async function updateItemQuantity(itemId, colorIdx, newQty) {
  if (colorIdx < 0) {
    // Quantidade simples (sem cores)
    const { error } = await supabase
      .from('order_items')
      .update({ quantity: Number(newQty) || 0 })
      .eq('id', itemId)
    if (error) throw error
  } else {
    // Atualiza posição X no array colors
    const { data: item, error: e1 } = await supabase
      .from('order_items').select('colors').eq('id', itemId).single()
    if (e1) throw e1
    const colors = [...(item.colors || [])]
    if (!colors[colorIdx]) return
    colors[colorIdx] = { ...colors[colorIdx], qty: Number(newQty) || 0 }
    const { error: e2 } = await supabase
      .from('order_items').update({ colors }).eq('id', itemId)
    if (e2) throw e2
  }
}

// ═══════════════════════════════════════════════════════════════════
// PAYMENTS (CRUD dedicado, separado do pedido)
// ═══════════════════════════════════════════════════════════════════

export async function addPayment(orderId, payment) {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      order_id: orderId,
      payment_date: payment.payment_date || null,
      amount_usd: payment.amount_usd || null,
      rate_paid: payment.rate_paid || null,
      amount_brl: payment.amount_brl || null,
      bank: payment.bank || null,
      receipt_url: payment.receipt_url || null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePayment(id, patch) {
  const { error } = await supabase.from('payments').update(patch).eq('id', id)
  if (error) throw error
}

export async function deletePayment(id) {
  const { error } = await supabase.from('payments').delete().eq('id', id)
  if (error) throw error
}
