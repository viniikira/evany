// src/lib/utils.js
// Utilidades centralizadas: ID, datas, copy, formatadores de string.

import { log } from './logger'

// v13.28 — Helper UC promovido pra cá (era duplicado em SimplePages, Orders, Shopify)
// Maiúsculas + trim de null/undefined sem crashar.
export const UC = s => (s || '').toString().toUpperCase()

// v13.34 — Normaliza código de cor pra comparações case-insensitive E trim de espaços.
// Usado pra evitar bugs de "cor não encontrada" por causa de "1B" vs "1b" vs " 1B ".
export const normalizeColorCode = s => (s || '').toString().toUpperCase().trim()

// ═══════════════════════════════════════════════════════════════════
// uid — ID temporário no front (usado em items/colors antes do save)
// crypto.randomUUID() está disponível em todos os navegadores modernos.
// Fallback pra Math.random só pra ambientes muito antigos (não vai cair na prática).
// ═══════════════════════════════════════════════════════════════════
export function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'tmp-' + crypto.randomUUID().slice(0, 8)
  }
  // Fallback (legado — não deve ser executado em browsers modernos)
  return 'tmp-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// ═══════════════════════════════════════════════════════════════════
// formatDate — formato consistente em todo o sistema
// modes: 'relative' (há 3 dias), 'short' (18/04), 'full' (18 abr 2026),
//        'with-time' (18/04 14:30), 'iso' (2026-04-18)
// ═══════════════════════════════════════════════════════════════════
const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function formatDate(input, mode = 'short') {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (isNaN(d.getTime())) return ''
  
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  
  if (mode === 'short') return `${dd}/${mm}`
  if (mode === 'full') return `${dd}/${mm}/${yyyy}`
  if (mode === 'with-time') return `${dd}/${mm}/${yyyy} ${hh}:${min}`
  if (mode === 'iso') return `${yyyy}-${mm}-${dd}`
  
  if (mode === 'relative') {
    const now = new Date()
    const diffMs = now - d
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)
    
    if (diffSec < 60) return 'agora'
    if (diffMin < 60) return `há ${diffMin} min`
    if (diffHour < 24) return `há ${diffHour}h`
    if (diffDay === 1) return 'ontem'
    if (diffDay < 7) return `há ${diffDay} dias`
    if (diffDay < 30) return `há ${Math.floor(diffDay / 7)} sem.`
    if (diffDay < 365) return `${dd} ${MONTHS_PT[d.getMonth()]}`
    return `${dd} ${MONTHS_PT[d.getMonth()]} ${yyyy}`
  }
  
  // default = full
  return `${dd}/${mm}/${yyyy}`
}

// ═══════════════════════════════════════════════════════════════════
// copyToClipboard — copia texto + retorna Promise<boolean>
// Usa Clipboard API moderna com fallback pra execCommand legado
// ═══════════════════════════════════════════════════════════════════
export async function copyToClipboard(text) {
  if (!text) return false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(String(text))
      return true
    }
    // Fallback (HTTP, browsers antigos)
    const ta = document.createElement('textarea')
    ta.value = String(text)
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (e) {
    log.warn('[copy] falhou:', e)
    return false
  }
}

// ═══════════════════════════════════════════════════════════════════
// runOncePerDay — executa função no máx 1x por dia (chave em localStorage)
// Usado pra backup automático e limpeza de logs.
// ═══════════════════════════════════════════════════════════════════
export function runOncePerDay(key, fn) {
  const storageKey = `kira:lastRun:${key}`
  const today = new Date().toISOString().slice(0, 10)  // YYYY-MM-DD
  try {
    const last = localStorage.getItem(storageKey)
    if (last === today) return false  // já rodou hoje
    localStorage.setItem(storageKey, today)
    Promise.resolve().then(() => fn()).catch(e => {
      log.error(`[runOncePerDay:${key}] erro:`, e)
      // Se falhou, remove a marcação pra tentar de novo na próxima sessão
      try { localStorage.removeItem(storageKey) } catch {}
    })
    return true
  } catch (e) {
    log.warn('[runOncePerDay] localStorage indisponível:', e)
    return false
  }
}
