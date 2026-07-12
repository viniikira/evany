// src/components/GlobalSearch.jsx
// v13.37 — Busca global (Ctrl+K / Cmd+K) estilo Spotlight.
//
// Busca em: produtos, ideias, pedidos, coleções, fábricas, cores.
// Match substring case-insensitive no nome + campos relevantes.
// Navegação por teclado (↑↓ Enter Esc).
// Fonte: dashData já carregado — zero requisição nova.

import { useEffect, useMemo, useRef, useState } from 'react'

const MAX_PER_CATEGORY = 5

export function GlobalSearch({
  open,
  onClose,
  products = [],
  ideas = [],
  orders = [],
  colors = [],
  onNavigate,  // (target) => void — target é o resultado selecionado
}) {
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  
  // Reset ao abrir/fechar
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlightIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])
  
  // Constrói lista ordenada de resultados filtrados
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return { groups: [], flat: [] }
    
    const groups = []
    
    // ═══════════ PRODUTOS ═══════════
    const prodMatches = []
    for (const p of products) {
      const name = (p.name || '').toLowerCase()
      const code = (p.factory_code || '').toLowerCase()
      const factory = (p.factory || '').toLowerCase()
      if (name.includes(q) || code.includes(q) || factory.includes(q)) {
        prodMatches.push({
          type: 'product',
          id: p.id,
          label: p.name,
          sub: [p.factory, p.factory_code].filter(Boolean).join(' · '),
          icon: '💇',
          startsWith: name.startsWith(q),
        })
      }
    }
    prodMatches.sort((a, b) => (b.startsWith ? 1 : 0) - (a.startsWith ? 1 : 0) || a.label.localeCompare(b.label))
    if (prodMatches.length) groups.push({ key: 'products', label: 'PRODUTOS', icon: '💇', items: prodMatches.slice(0, MAX_PER_CATEGORY), total: prodMatches.length })
    
    // ═══════════ IDEIAS ═══════════
    const ideaMatches = []
    for (const i of ideas) {
      const name = (i.name || '').toLowerCase()
      if (name.includes(q)) {
        ideaMatches.push({
          type: 'idea',
          id: i.id,
          label: i.name,
          sub: i.factory || i.collection || '',
          icon: '💡',
          startsWith: name.startsWith(q),
        })
      }
    }
    ideaMatches.sort((a, b) => (b.startsWith ? 1 : 0) - (a.startsWith ? 1 : 0) || a.label.localeCompare(b.label))
    if (ideaMatches.length) groups.push({ key: 'ideas', label: 'IDEIAS', icon: '💡', items: ideaMatches.slice(0, MAX_PER_CATEGORY), total: ideaMatches.length })
    
    // ═══════════ PEDIDOS ═══════════
    const orderMatches = []
    for (const o of orders) {
      if (o.purged_at) continue
      const name = (o.order_name || '').toLowerCase()
      const factory = (o.factory || '').toLowerCase()
      const invoice = (o.invoice_number || '').toLowerCase()
      if (name.includes(q) || factory.includes(q) || invoice.includes(q)) {
        orderMatches.push({
          type: 'order',
          id: o.id,
          label: o.order_name || o.factory,
          sub: [o.factory, o.status].filter(Boolean).join(' · '),
          icon: '📦',
          startsWith: name.startsWith(q),
        })
      }
    }
    orderMatches.sort((a, b) => (b.startsWith ? 1 : 0) - (a.startsWith ? 1 : 0) || a.label.localeCompare(b.label))
    if (orderMatches.length) groups.push({ key: 'orders', label: 'PEDIDOS', icon: '📦', items: orderMatches.slice(0, MAX_PER_CATEGORY), total: orderMatches.length })
    
    // ═══════════ CORES ═══════════
    const colorMatches = []
    for (const c of colors) {
      const code = (c.code || '').toLowerCase()
      const name = (c.name_pt || '').toLowerCase()
      if (code.includes(q) || name.includes(q)) {
        colorMatches.push({
          type: 'color',
          id: c.id,
          label: c.code,
          sub: c.name_pt || '',
          icon: '🎨',
          startsWith: code.startsWith(q) || name.startsWith(q),
        })
      }
    }
    colorMatches.sort((a, b) => (b.startsWith ? 1 : 0) - (a.startsWith ? 1 : 0) || a.label.localeCompare(b.label))
    if (colorMatches.length) groups.push({ key: 'colors', label: 'CORES', icon: '🎨', items: colorMatches.slice(0, MAX_PER_CATEGORY), total: colorMatches.length })
    
    // Flatten pra navegação por teclado
    const flat = []
    for (const g of groups) {
      for (const item of g.items) flat.push(item)
    }
    
    return { groups, flat }
  }, [query, products, ideas, orders, colors])
  
  // Reset highlight ao mudar query
  useEffect(() => {
    setHighlightIdx(0)
  }, [query])
  
  // Click fora fecha
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])
  
  const handleSelect = (item) => {
    onNavigate?.(item)
    onClose?.()
  }
  
  const handleKeyDown = (e) => {
    const flat = results.flat
    if (flat.length === 0) return
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(i => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightIdx >= 0 && flat[highlightIdx]) {
        handleSelect(flat[highlightIdx])
      }
    }
  }
  
  // Scroll highlight into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${highlightIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx])
  
  if (!open) return null
  
  const totalResults = results.flat.length
  let globalIdx = -1
  
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,.4)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '92%', maxWidth: 620,
          background: 'var(--surface)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,.3)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '76vh',
        }}
      >
        {/* Input */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar produto, pedido, cor, ideia, fábrica..."
            style={{
              flex: 1,
              fontSize: 16,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          />
          <kbd style={{
            fontSize: 10, padding: '3px 7px',
            background: 'var(--border-light)', borderRadius: 4,
            color: 'var(--text-muted)', fontFamily: 'monospace',
          }}>
            ESC
          </kbd>
        </div>
        
        {/* Resultados */}
        <div ref={listRef} style={{ overflow: 'auto', flex: 1 }}>
          {!query.trim() && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              <div style={{ fontSize: 36, marginBottom: 10, opacity: .3 }}>🔍</div>
              <div style={{ marginBottom: 6 }}>Digite pra buscar em todo o sistema</div>
              <div style={{ fontSize: 11, opacity: .7 }}>
                Produtos · Ideias · Pedidos · Cores
              </div>
            </div>
          )}
          
          {query.trim() && totalResults === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Nenhum resultado para "<strong>{query}</strong>"
            </div>
          )}
          
          {results.groups.map(group => (
            <div key={group.key}>
              <div style={{
                padding: '8px 18px 4px',
                fontSize: 10, fontWeight: 700,
                letterSpacing: 0.8,
                color: 'var(--text-muted)',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--border-light)',
                position: 'sticky', top: 0,
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>{group.icon} {group.label}</span>
                {group.total > MAX_PER_CATEGORY && (
                  <span style={{ fontWeight: 400, opacity: .7 }}>
                    ({MAX_PER_CATEGORY} de {group.total})
                  </span>
                )}
              </div>
              {group.items.map(item => {
                globalIdx++
                const isHighlighted = globalIdx === highlightIdx
                const myIdx = globalIdx
                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    data-idx={myIdx}
                    type="button"
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setHighlightIdx(myIdx)}
                    style={{
                      width: '100%',
                      padding: '10px 18px',
                      display: 'flex', alignItems: 'center', gap: 12,
                      background: isHighlighted ? 'var(--border-light)' : 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border-light)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      color: 'var(--text)',
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{item.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.label}
                      </div>
                      {item.sub && (
                        <div style={{
                          fontSize: 11, color: 'var(--text-muted)',
                          marginTop: 2,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {item.sub}
                        </div>
                      )}
                    </div>
                    {isHighlighted && (
                      <kbd style={{
                        fontSize: 9, padding: '2px 6px',
                        background: 'var(--primary)', color: '#fff',
                        borderRadius: 3, fontFamily: 'monospace',
                      }}>
                        ↵ abrir
                      </kbd>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        
        {/* Footer com dicas */}
        {query.trim() && totalResults > 0 && (
          <div style={{
            padding: '8px 18px',
            borderTop: '1px solid var(--border)',
            fontSize: 10, color: 'var(--text-muted)',
            display: 'flex', gap: 14,
          }}>
            <span><kbd style={kbdStyle}>↑↓</kbd> navegar</span>
            <span><kbd style={kbdStyle}>↵</kbd> abrir</span>
            <span><kbd style={kbdStyle}>Esc</kbd> fechar</span>
          </div>
        )}
      </div>
    </div>
  )
}

const kbdStyle = {
  fontSize: 9, padding: '2px 5px',
  background: 'var(--border-light)', borderRadius: 3,
  fontFamily: 'monospace', marginRight: 4,
}
