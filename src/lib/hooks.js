// src/lib/hooks.js
// Hooks customizados: tab lock, session timeout, USD rate, saving indicator.

import { useState, useEffect, useRef, useCallback } from 'react'
import { log } from './logger'

// useDebouncedSave foi removido nesta versão por estar sem uso real.
// Saves no sistema atual disparam imediatamente em onBlur/onChange. 
// Quando precisarmos de debounce real (ex: campo "notes" do produto que
// salva enquanto digita), reintroduzimos o hook com flush em beforeunload.

// ═══════════════════════════════════════════════════════════════════
// useTabLock — coordena abas via BroadcastChannel
// Retorna { otherTabActive, claimActive }:
//   - otherTabActive: true se outra aba está ativa
//   - claimActive(): chame pra reivindicar ser a aba ativa (manda sinal pras outras)
// ═══════════════════════════════════════════════════════════════════
export function useTabLock() {
  const [otherTabActive, setOtherTabActive] = useState(false)
  const myIdRef = useRef((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2))
  const channelRef = useRef(null)

  useEffect(() => {
    if (!window.BroadcastChannel) return
    const bc = new BroadcastChannel('kira-tab-lock')
    channelRef.current = bc
    const myId = myIdRef.current
    let amActive = true  // assumo que sou ativo até alguém reivindicar

    // Anuncia presença na entrada
    bc.postMessage({ type: 'hello', id: myId })

    bc.onmessage = (e) => {
      if (e.data.id === myId) return  // mensagem minha
      if (e.data.type === 'hello') {
        // Outra aba abriu — respondo confirmando minha presença
        bc.postMessage({ type: 'present', id: myId, active: amActive })
        if (amActive) setOtherTabActive(false)  // ainda sou ativa
      }
      if (e.data.type === 'present' && e.data.active) {
        setOtherTabActive(true)
        amActive = false
      }
      if (e.data.type === 'claim') {
        // Outra aba reivindicou ser ativa — eu cedo
        amActive = false
        setOtherTabActive(true)
      }
    }

    return () => bc.close()
  }, [])

  const claimActive = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.postMessage({ type: 'claim', id: myIdRef.current })
    }
    setOtherTabActive(false)
  }, [])

  return { otherTabActive, claimActive }
}

// ═══════════════════════════════════════════════════════════════════
// useSavingState — feedback visual de saving/saved
// ═══════════════════════════════════════════════════════════════════
export function useSavingState() {
  const [status, setStatus] = useState('idle')  // idle, saving, saved, error
  const timeoutRef = useRef(null)

  const markSaving = useCallback(() => {
    clearTimeout(timeoutRef.current)
    setStatus('saving')
  }, [])

  const markSaved = useCallback(() => {
    setStatus('saved')
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setStatus('idle'), 2000)
  }, [])

  const markError = useCallback(() => {
    setStatus('error')
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setStatus('idle'), 5000)
  }, [])

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  return { status, markSaving, markSaved, markError }
}

// ═══════════════════════════════════════════════════════════════════
// useUsdRate — cotação USD/BRL com cache de sessão
// ═══════════════════════════════════════════════════════════════════
export function useUsdRate() {
  const [rate, setRate] = useState(null)
  useEffect(() => {
    const fetchRate = async () => {
      try {
        const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')
        const d = await r.json()
        setRate(parseFloat(d.USDBRL?.bid || 0) + 0.10)
      } catch {}
    }
    fetchRate()
    const iv = setInterval(fetchRate, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [])
  return rate
}

// ═══════════════════════════════════════════════════════════════════
// useSessionTimeout — desloga depois de X minutos sem atividade
// ═══════════════════════════════════════════════════════════════════
export function useSessionTimeout(minutes, onTimeout) {
  useEffect(() => {
    let lastActivity = Date.now()
    const ms = minutes * 60 * 1000

    const update = () => { lastActivity = Date.now() }
    const check = () => {
      if (Date.now() - lastActivity > ms) onTimeout()
    }

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach(e => document.addEventListener(e, update))
    const interval = setInterval(check, 60 * 1000)

    return () => {
      events.forEach(e => document.removeEventListener(e, update))
      clearInterval(interval)
    }
  }, [minutes, onTimeout])
}

// ═══════════════════════════════════════════════════════════════════
// useStickyFilter — preserva filtros entre navegações na mesma sessão.
// Evita ter que re-aplicar filtros toda vez que volta numa página.
// Resetam quando usuário fecha aba (sessionStorage, não localStorage).
// ═══════════════════════════════════════════════════════════════════
export function useStickyFilter(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = sessionStorage.getItem(`kira:filter:${key}`)
      return stored !== null ? JSON.parse(stored) : defaultValue
    } catch {
      return defaultValue
    }
  })
  
  useEffect(() => {
    try {
      sessionStorage.setItem(`kira:filter:${key}`, JSON.stringify(value))
    } catch {}
  }, [key, value])
  
  // Ouve evento global de "clear filters" e reseta se o prefixo bater
  useEffect(() => {
    const handler = (e) => {
      const prefix = e.detail?.prefix
      if (!prefix) return
      if (key.startsWith(`${prefix}.`)) {
        setValue(defaultValue)
      }
    }
    window.addEventListener('sticky-filters-cleared', handler)
    return () => window.removeEventListener('sticky-filters-cleared', handler)
  }, [key, defaultValue])
  
  return [value, setValue]
}

// ═══════════════════════════════════════════════════════════════════
// clearStickyFilters — limpa todos os filtros pegajosos com um prefixo
// Uso: clearStickyFilters('products')  // limpa products.search, products.status, etc
// ═══════════════════════════════════════════════════════════════════
export function clearStickyFilters(prefix) {
  try {
    const toRemove = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key && key.startsWith(`kira:filter:${prefix}.`)) {
        toRemove.push(key)
      }
    }
    toRemove.forEach(k => sessionStorage.removeItem(k))
    // Força re-render: dispara um evento que componentes podem ouvir
    window.dispatchEvent(new CustomEvent('sticky-filters-cleared', { detail: { prefix } }))
    return toRemove.length
  } catch (e) {
    log.warn('[clearStickyFilters] erro:', e)
    return 0
  }
}
