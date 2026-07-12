// src/lib/analytics.js
// v13.31 — Sistema de tracking de uso (privacy-first, fica no seu Supabase)
//
// Uso:
//   trackPageview('dashboard')       // muda de página
//   trackAction('create_order', { factory: 'EPF' })  // ação importante
//   trackClick('export_pdf', { orderId: 'x' })       // click específico
//
// Performance: insere assíncrono via fire-and-forget. Falha silenciosa.
// Buffering: agrupa pageviews curtos em fila e envia em batch a cada 30s.

import { supabase } from './supabase'
import { log } from './logger'

let currentPageStart = null
let currentPage = null
let currentUserId = null
let currentUserName = null
let queue = []
let flushTimer = null

const FLUSH_INTERVAL_MS = 30 * 1000  // 30s
const MAX_QUEUE_SIZE = 20

/**
 * Inicializa o sistema com identidade do usuário.
 * Chamada após login no App.jsx.
 */
export function initAnalytics(user) {
  currentUserId = user?.id || null
  currentUserName = user?.name || null
  
  // Flush antes de fechar a aba
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushNow)
    window.addEventListener('pagehide', flushNow)
  }
  
  scheduleFlush()
}

/**
 * Para o tracking (logout). Limpa estado e flusha pendentes.
 */
export function stopAnalytics() {
  flushNow()
  currentUserId = null
  currentUserName = null
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
}

/**
 * Registra mudança de página. Calcula tempo na página anterior automático.
 */
export function trackPageview(page) {
  // Fecha view anterior
  if (currentPage && currentPageStart) {
    const duration = Date.now() - currentPageStart
    enqueue({
      event_type: 'pageview',
      event_name: currentPage,
      page: currentPage,
      duration_ms: duration,
      metadata: null,
    })
  }
  // Abre nova
  currentPage = page
  currentPageStart = Date.now()
}

/**
 * Registra uma ação (criar pedido, mudar status, etc.)
 */
export function trackAction(actionName, metadata = null) {
  enqueue({
    event_type: 'action',
    event_name: actionName,
    page: currentPage,
    duration_ms: null,
    metadata: metadata || null,
  })
}

/**
 * Registra um click específico (variante de action mais granular)
 */
export function trackClick(clickName, metadata = null) {
  enqueue({
    event_type: 'click',
    event_name: clickName,
    page: currentPage,
    duration_ms: null,
    metadata: metadata || null,
  })
}

// ═══════════════════════════════════════════════════════════════════
// Internal: queue + flush
// ═══════════════════════════════════════════════════════════════════
function enqueue(event) {
  if (!currentUserId) return  // não trackear antes de login
  queue.push({
    ...event,
    user_id: currentUserId,
    user_name: currentUserName,
  })
  if (queue.length >= MAX_QUEUE_SIZE) {
    flushNow()
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setInterval(flushNow, FLUSH_INTERVAL_MS)
}

async function flushNow() {
  if (queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  try {
    await supabase.from('analytics_events').insert(batch)
  } catch (e) {
    // Falha silenciosa — analytics não pode quebrar a app
    log.warn('[analytics] flush failed:', e?.message)
  }
}
