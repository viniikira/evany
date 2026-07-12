// src/components/NameAutocomplete.jsx
// v13.35 — Autocomplete customizado pro campo Nome de Ideias e Produtos.
//
// Substitui o <datalist> nativo que tinha problemas:
// - Some ao perder foco e não volta
// - Filtragem depende do navegador (alguns só prefixo)
// - Visual fora do tema do app
//
// Comportamento novo:
// - Dropdown abre ao focar (mostra TODAS) ou ao digitar (filtradas por substring)
// - Mantém-se disponível enquanto usuária edita o campo
// - Keyboard: ↑↓ navega, Enter seleciona, Esc fecha, Tab fecha e segue pro próximo
// - Click fora fecha
// - Click no ícone de seta abre/fecha manualmente

import { useEffect, useMemo, useRef, useState } from 'react'
import { UC } from '../lib/utils'

export function NameAutocomplete({
  value = '',
  onChange,
  suggestions = [],          // [{ id, name }]
  excludeNames = [],         // lista de nomes (strings) pra filtrar fora (já usados)
  placeholder = 'Nome',
  autoFocus = false,
}) {
  const [open, setOpen] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  
  // Set normalizado de nomes excluídos pra lookup O(1)
  const excludedSet = useMemo(() => {
    return new Set(excludeNames.map(n => (n || '').toLowerCase().trim()))
  }, [excludeNames])
  
  // Filtra por substring do que o usuário digitou; exclui já usados
  const filtered = useMemo(() => {
    const q = (value || '').toLowerCase().trim()
    let list = (suggestions || [])
      .filter(n => n && n.name)
      .filter(n => !excludedSet.has(n.name.toLowerCase().trim()))
    
    if (q) {
      // Substring match (mais flexível que prefixo só)
      list = list.filter(n => n.name.toLowerCase().includes(q))
      
      // Ordenação: nomes que começam com a busca vêm primeiro
      list.sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(q)
        const bStarts = b.name.toLowerCase().startsWith(q)
        if (aStarts && !bStarts) return -1
        if (!aStarts && bStarts) return 1
        return a.name.localeCompare(b.name)
      })
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }
    
    return list
  }, [suggestions, value, excludedSet])
  
  // Se usuária digitou exatamente um nome existente, não precisa mostrar ele como sugestão
  const showCurrentInList = useMemo(() => {
    const q = (value || '').trim().toLowerCase()
    return !filtered.some(n => n.name.toLowerCase() === q)
  }, [filtered, value])
  
  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setHighlightIdx(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  
  // Reset highlight ao mudar filtragem
  useEffect(() => {
    setHighlightIdx(-1)
  }, [value])
  
  const select = (name) => {
    onChange?.(UC(name))
    setOpen(false)
    setHighlightIdx(-1)
  }
  
  const handleKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setOpen(true)
      return
    }
    
    if (e.key === 'Escape') {
      setOpen(false)
      setHighlightIdx(-1)
      return
    }
    
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    
    if (!open || filtered.length === 0) return
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (highlightIdx >= 0 && highlightIdx < filtered.length) {
        e.preventDefault()
        select(filtered[highlightIdx].name)
      }
    }
  }
  
  // Conta pra mostrar na label
  const hasAny = filtered.length > 0 && showCurrentInList
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        className="field"
        value={value}
        onChange={e => {
          onChange?.(UC(e.target.value))
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder}
        style={{ textTransform: 'uppercase', paddingRight: 32 }}
        autoComplete="off"
      />
      
      {/* Botão seta — abre/fecha manualmente */}
      <button
        type="button"
        onClick={() => {
          setOpen(o => !o)
          inputRef.current?.focus()
        }}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 10, padding: 6,
          lineHeight: 1,
        }}
        tabIndex={-1}
        title={open ? 'Fechar sugestões' : 'Ver sugestões'}
      >
        ▼
      </button>
      
      {/* Dropdown */}
      {open && hasAny && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
          zIndex: 100, maxHeight: 260, overflow: 'auto',
        }}>
          <div style={{
            padding: '6px 10px', fontSize: 10, fontWeight: 700,
            letterSpacing: 0.5, color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border-light)',
            background: 'var(--surface)',
            position: 'sticky', top: 0,
          }}>
            {filtered.length} SUGESTÃO{filtered.length !== 1 ? 'ÕES' : ''} DO BANCO DE NOMES
          </div>
          {filtered.map((n, i) => {
            const highlighted = highlightIdx === i
            return (
              <button
                key={n.id || n.name}
                type="button"
                onClick={() => select(n.name)}
                onMouseEnter={() => setHighlightIdx(i)}
                style={{
                  width: '100%', display: 'block',
                  padding: '7px 12px',
                  background: highlighted ? 'var(--border-light)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                  color: 'var(--text)', fontSize: 13, fontWeight: 600,
                  letterSpacing: 0.3,
                }}
              >
                {n.name}
              </button>
            )
          })}
        </div>
      )}
      
      {/* Dropdown sem resultados — mostra mensagem suave */}
      {open && !hasAny && (value || '').trim().length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 14px',
          fontSize: 12, color: 'var(--text-muted)',
          boxShadow: '0 4px 16px rgba(0,0,0,.08)',
          zIndex: 100,
        }}>
          Nome novo. Continue digitando — será salvo.
        </div>
      )}
    </div>
  )
}
