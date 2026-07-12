// src/components/ColorPicker.jsx
// v13.34 — Dropdown de cores com busca, swatch visual e UX consistente.
//
// Substitui o <datalist> nativo do navegador (que tinha problemas:
// sem busca, some quando perde foco, sem preview visual).
//
// Uso:
//   <ColorPicker
//     value="1B"                        // código atual
//     allColors={colors}                // banco de cores completo (do prop)
//     productColors={['1B', '27']}      // cores cadastradas no produto (highlight)
//     onChange={code => setCode(code)}  // callback ao escolher
//     onAllowFreeEntry={() => ...}      // opcional: permite digitar nova
//   />

import { useEffect, useMemo, useRef, useState } from 'react'
import { ColorSwatch } from './ColorSwatch'
import { normalizeColorCode } from '../lib/utils'

export function ColorPicker({
  value,
  allColors = [],
  productColors = [],
  onChange,
  onAllowFreeEntry,
  placeholder = 'Selecionar cor…',
  autoOpen = false,
  disabled = false,
}) {
  const [open, setOpen] = useState(autoOpen)
  const [search, setSearch] = useState('')
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  
  // Set de cores do produto pra highlight (case-insensitive)
  const productColorSet = useMemo(() => {
    return new Set(productColors.map(c => normalizeColorCode(c)))
  }, [productColors])
  
  // Lista filtrada e ordenada
  const filteredColors = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = (allColors || []).filter(c => c.code)
    
    if (q) {
      list = list.filter(c => {
        const code = c.code.toLowerCase()
        const name = (c.name_pt || '').toLowerCase()
        return code.includes(q) || name.includes(q)
      })
    }
    
    // Ordena: do produto primeiro, depois alfabético
    return list.sort((a, b) => {
      const aFromProd = productColorSet.has(normalizeColorCode(a.code))
      const bFromProd = productColorSet.has(normalizeColorCode(b.code))
      if (aFromProd && !bFromProd) return -1
      if (!aFromProd && bFromProd) return 1
      return a.code.localeCompare(b.code)
    })
  }, [allColors, search, productColorSet])
  
  // Encontra a cor atual selecionada
  const currentColor = useMemo(() => {
    if (!value) return null
    return allColors.find(c => normalizeColorCode(c.code) === normalizeColorCode(value))
  }, [value, allColors])
  
  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  
  // Foca no input quando abre
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])
  
  // Auto-open
  useEffect(() => {
    if (autoOpen) setOpen(true)
  }, [autoOpen])
  
  const handleSelect = (code) => {
    onChange?.(normalizeColorCode(code))
    setOpen(false)
    setSearch('')
  }
  
  const handleFreeEntry = () => {
    if (search.trim()) {
      onChange?.(normalizeColorCode(search))
    }
    setOpen(false)
    setSearch('')
  }
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* Trigger — exibe cor atual ou placeholder */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 6,
          fontSize: 13, fontFamily: 'inherit',
          color: 'var(--text)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          opacity: disabled ? 0.6 : 1,
          minHeight: 32,
        }}
      >
        {value ? (
          <>
            <ColorSwatch code={value} colors={allColors} size="sm" />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong>{value}</strong>
              {currentColor?.name_pt && (
                <span className="text-muted" style={{ marginLeft: 6, fontSize: 11 }}>· {currentColor.name_pt}</span>
              )}
            </span>
          </>
        ) : (
          <span className="text-muted" style={{ flex: 1 }}>{placeholder}</span>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>▼</span>
      </button>
      
      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.12)',
          zIndex: 100, maxHeight: 300, display: 'flex', flexDirection: 'column',
        }}>
          {/* Busca */}
          <div style={{ padding: 8, borderBottom: '1px solid var(--border-light)' }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setSearch('') }
                if (e.key === 'Enter' && filteredColors.length > 0) {
                  handleSelect(filteredColors[0].code)
                }
                if (e.key === 'Enter' && filteredColors.length === 0 && onAllowFreeEntry) {
                  handleFreeEntry()
                }
              }}
              placeholder="Buscar por código ou nome…"
              className="field field-sm"
              style={{ fontSize: 12 }}
            />
          </div>
          
          {/* Lista */}
          <div style={{ overflow: 'auto', flex: 1 }}>
            {filteredColors.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12 }} className="text-muted">
                {search.trim() ? 'Nenhuma cor encontrada' : 'Banco de cores vazio'}
                {search.trim() && onAllowFreeEntry && (
                  <button
                    type="button"
                    onClick={handleFreeEntry}
                    className="btn btn-outline btn-sm"
                    style={{ marginTop: 8, fontSize: 11 }}
                  >
                    + Usar "{normalizeColorCode(search)}" como cor nova
                  </button>
                )}
              </div>
            ) : (
              <>
                {filteredColors.map(c => {
                  const isFromProduct = productColorSet.has(normalizeColorCode(c.code))
                  const isSelected = normalizeColorCode(value) === normalizeColorCode(c.code)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelect(c.code)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px',
                        background: isSelected ? 'var(--border-light)' : 'transparent',
                        border: 'none', borderBottom: '1px solid var(--border-light)',
                        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                        color: 'var(--text)',
                      }}
                      onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--border-light)' }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                    >
                      <ColorSwatch code={c.code} colors={allColors} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {c.code}
                          {isFromProduct && (
                            <span style={{
                              marginLeft: 6, fontSize: 9, padding: '1px 5px',
                              background: 'var(--accent-light)', color: 'var(--primary)',
                              borderRadius: 3, fontWeight: 700,
                            }}>
                              ⭐ DO PRODUTO
                            </span>
                          )}
                        </div>
                        {c.name_pt && (
                          <div className="text-muted" style={{ fontSize: 11 }}>{c.name_pt}</div>
                        )}
                      </div>
                    </button>
                  )
                })}
                
                {/* Opção de free entry quando tem busca mas não bateu exato */}
                {search.trim() && onAllowFreeEntry && !filteredColors.some(c => normalizeColorCode(c.code) === normalizeColorCode(search)) && (
                  <button
                    type="button"
                    onClick={handleFreeEntry}
                    style={{
                      width: '100%', padding: '8px 10px',
                      background: '#FFFBEB', border: 'none',
                      borderTop: '1px dashed var(--border)',
                      cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                      color: '#92400E', textAlign: 'left',
                    }}
                  >
                    + Adicionar "<strong>{normalizeColorCode(search)}</strong>" como cor nova
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
