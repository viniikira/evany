// src/components/ui.jsx
// Componentes básicos reutilizáveis: Modal, ConfirmDialog, Toast, Lightbox, etc

import { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react'

// ═══════════════════════════════════════════════════════════════════
// MODAL — não fecha ao clicar fora se estiver "dirty"
// ═══════════════════════════════════════════════════════════════════
export function Modal({ children, onClose, width, isDirty = false, allowOutsideClose = false, zIndex }) {
  const handleOverlay = () => {
    if (isDirty) {
      if (confirm('Há alterações não salvas. Fechar mesmo assim?')) onClose()
      return
    }
    if (allowOutsideClose) onClose()
  }

  useEffect(() => {
    const onEsc = (e) => {
      if (e.key === 'Escape') {
        if (isDirty) {
          if (confirm('Há alterações não salvas. Fechar mesmo assim?')) onClose()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [isDirty, onClose])

  // zIndex permite empilhar modais (ex: clicar pedido dentro de produto abre por cima)
  const overlayStyle = zIndex ? { zIndex } : undefined
  return (
    <div className="overlay" onClick={handleOverlay} style={overlayStyle}>
      <div className="modal" style={{ maxWidth: width || 620 }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export function MH({ title, onClose, actions }) {
  return (
    <div className="mh">
      <h2 className="mt">{title}</h2>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {actions}
        {onClose && <button className="btn-icon" onClick={onClose} aria-label="Fechar">✕</button>}
      </div>
    </div>
  )
}

export function MB({ children }) { return <div className="mb">{children}</div> }
export function MF({ children }) { return <div className="mf">{children}</div> }

// ═══════════════════════════════════════════════════════════════════
// LIGHTBOX — ampliação de foto
// ═══════════════════════════════════════════════════════════════════
export function Lightbox({ src, sources, initialIndex = 0, onClose }) {
  // Aceita src (string única, uso original) OU sources (array com navegação)
  const list = Array.isArray(sources) && sources.length > 0
    ? sources.filter(Boolean)
    : (src ? [src] : [])
  
  const [idx, setIdx] = useState(initialIndex)
  const touchStartRef = useRef(null)
  
  // Reset idx quando abre uma nova lista ou sua posição inicial muda
  useEffect(() => {
    setIdx(Math.min(initialIndex, Math.max(0, list.length - 1)))
  }, [src, sources?.length, initialIndex])
  
  // Teclado: ←/→ navegar, Esc fechar
  useEffect(() => {
    if (list.length === 0) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
      else if (e.key === 'ArrowLeft' && list.length > 1) setIdx(i => (i - 1 + list.length) % list.length)
      else if (e.key === 'ArrowRight' && list.length > 1) setIdx(i => (i + 1) % list.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list.length, onClose])
  
  if (list.length === 0) return null
  
  const hasNav = list.length > 1
  const prev = () => setIdx(i => (i - 1 + list.length) % list.length)
  const next = () => setIdx(i => (i + 1) % list.length)
  
  // Swipe em mobile
  const onTouchStart = (e) => { touchStartRef.current = e.touches[0].clientX }
  const onTouchEnd = (e) => {
    if (touchStartRef.current == null || !hasNav) return
    const diff = e.changedTouches[0].clientX - touchStartRef.current
    if (Math.abs(diff) > 50) { diff < 0 ? next() : prev() }
    touchStartRef.current = null
  }
  
  return (
    <div className="lightbox" onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <img
        src={list[idx]}
        alt=""
        onClick={e => e.stopPropagation()}
        style={{ userSelect: 'none' }}
      />
      <button className="lb-close" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar lightbox">✕</button>
      {hasNav && (
        <>
          <button
            onClick={e => { e.stopPropagation(); prev() }}
            style={{
              position: 'fixed', left: 20, top: '50%', transform: 'translateY(-50%)',
              width: 50, height: 50, borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)', color: '#fff',
              border: 'none', fontSize: 24, cursor: 'pointer', zIndex: 10000,
            }}
            title="Anterior (←)"
          >‹</button>
          <button
            onClick={e => { e.stopPropagation(); next() }}
            style={{
              position: 'fixed', right: 20, top: '50%', transform: 'translateY(-50%)',
              width: 50, height: 50, borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)', color: '#fff',
              border: 'none', fontSize: 24, cursor: 'pointer', zIndex: 10000,
            }}
            title="Próxima (→)"
          >›</button>
          <div style={{
            position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            padding: '6px 14px', borderRadius: 20, fontSize: 13,
            zIndex: 10000,
          }}>
            {idx + 1} / {list.length}
          </div>
        </>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CONFIRM DIALOG — substitui confirm() nativo
// Uso: const confirm = useConfirm();  await confirm({ title, message, confirmLabel, danger })
// ═══════════════════════════════════════════════════════════════════
const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const resolveRef = useRef(null)

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setDialog({
        title: opts.title || 'Confirmar',
        message: opts.message || '',
        details: opts.details,
        confirmLabel: opts.confirmLabel || 'Confirmar',
        cancelLabel: opts.cancelLabel || 'Cancelar',
        danger: opts.danger || false,
      })
    })
  }, [])

  const handle = (result) => {
    setDialog(null)
    if (resolveRef.current) {
      resolveRef.current(result)
      resolveRef.current = null
    }
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <Modal onClose={() => handle(false)} width={480} allowOutsideClose>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>
              {dialog.danger ? '⚠️' : '🤔'}
            </div>
            <h2 style={{ fontSize: 18, marginBottom: 10, color: dialog.danger ? '#B91C1C' : 'var(--primary)' }}>
              {dialog.title}
            </h2>
            <p style={{ lineHeight: 1.5, marginBottom: 12, color: '#374151', whiteSpace: 'pre-wrap' }}>
              {dialog.message}
            </p>
            {dialog.details && (
              <div style={{ background: '#f5f5f5', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 16, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {dialog.details}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" onClick={() => handle(false)}>
                {dialog.cancelLabel}
              </button>
              <button
                className="btn"
                style={{
                  background: dialog.danger ? '#EF4444' : 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                }}
                onClick={() => handle(true)}
                autoFocus
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}

// ═══════════════════════════════════════════════════════════════════
// TOAST — notificações temporárias (substituí alert())
// ═══════════════════════════════════════════════════════════════════
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const push = useCallback((message, opts = {}) => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2)
    const t = {
      id,
      message,
      kind: opts.kind || 'info',  // info, success, error, warning
      duration: opts.duration || 3500,
      action: opts.action,  // { label, onClick } — botão "Desfazer"
    }
    setToasts(prev => [...prev, t])
    if (t.duration > 0) {
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), t.duration)
    }
    return id
  }, [])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(x => x.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400,
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.kind === 'error' ? '#FEE2E2'
                      : t.kind === 'success' ? '#D1FAE5'
                      : t.kind === 'warning' ? '#FEF3C7'
                      : '#fff',
            border: '1px solid ' + (t.kind === 'error' ? '#F87171'
                                 : t.kind === 'success' ? '#34D399'
                                 : t.kind === 'warning' ? '#FBBF24'
                                 : '#D1D5DB'),
            color: t.kind === 'error' ? '#991B1B'
                 : t.kind === 'success' ? '#065F46'
                 : t.kind === 'warning' ? '#92400E'
                 : '#111827',
            padding: '12px 16px',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,.12)',
            display: 'flex', alignItems: 'center', gap: 10,
            animation: 'slideIn .2s',
          }}>
            <span style={{ flex: 1, fontSize: 14 }}>{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action.onClick(); dismiss(t.id) }}
                style={{
                  background: 'transparent', border: 'none', fontWeight: 700,
                  color: 'inherit', cursor: 'pointer', textDecoration: 'underline',
                  fontSize: 13,
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => dismiss(t.id)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', opacity: .6, fontSize: 16 }}
            >✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

// ═══════════════════════════════════════════════════════════════════
// SKELETON — placeholders animados pra loading
// ═══════════════════════════════════════════════════════════════════
export function Skeleton({ width = '100%', height = 12, style = {} }) {
  return <span className="skel" style={{ width, height, ...style }} />
}

export function SkeletonProductGrid({ count = 8 }) {
  return (
    <div className="skel-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel-card" style={{ padding: 0, overflow: 'hidden' }}>
          <span className="skel skel-img" style={{ display: 'block' }} />
          <div style={{ padding: 12 }}>
            <span className="skel skel-line skel-line-medium" style={{ display: 'block' }} />
            <span className="skel skel-line skel-line-short" style={{ display: 'block' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function SkeletonList({ rows = 5 }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-card" style={{ marginBottom: 8 }}>
          <span className="skel skel-line skel-line-medium" style={{ display: 'block' }} />
          <span className="skel skel-line skel-line-short" style={{ display: 'block' }} />
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SAVING INDICATOR — mostra "Salvando..." / "Salvo" no topo
// ═══════════════════════════════════════════════════════════════════
export function SavingIndicator({ status }) {
  if (status === 'idle') return null
  return (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 999,
      background: status === 'saving' ? '#3B82F6' : status === 'saved' ? '#10B981' : '#EF4444',
      color: '#fff',
      padding: '6px 14px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      boxShadow: '0 4px 12px rgba(0,0,0,.15)',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {status === 'saving' && <><span className="spinner-sm"/>Salvando...</>}
      {status === 'saved' && <>✓ Salvo</>}
      {status === 'error' && <>⚠ Erro ao salvar</>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PendenciasDrawer — painel lateral com lista de pendências automáticas
// Disparado pelo sino 🔔 no header do menu lateral.
// ═══════════════════════════════════════════════════════════════════
export function PendenciasDrawer({ open, pendencias, onClose, onPendenciaClick }) {
  if (!open) return null
  
  const grouped = { 1: [], 2: [], 3: [] }
  for (const p of pendencias) {
    grouped[p.priority].push(p)
  }
  
  const labels = {
    1: { name: '🚨 Urgentes', color: '#DC2626' },
    2: { name: '⚠️ Atenção', color: '#D97706' },
    3: { name: '💭 Sugestões', color: '#2563EB' },
  }
  
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,.3)',
          zIndex: 9000,
        }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(420px, 90vw)',
        background: 'var(--surface)',
        boxShadow: '-4px 0 20px rgba(0,0,0,.15)',
        zIndex: 9001,
        display: 'flex', flexDirection: 'column',
        animation: 'slideInRight .25s ease',
      }}>
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Fraunces', serif", color: 'var(--primary)' }}>
              🔔 Pendências do Sistema
            </div>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
              {pendencias.length === 0 ? 'Tudo em ordem! ✓' : `${pendencias.length} ite${pendencias.length !== 1 ? 'ns' : 'm'} para revisar`}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar pendências" style={{
            background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer',
            color: 'var(--text-muted, #6b7280)',
          }}>✕</button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {pendencias.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted, #9ca3af)' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Nada pendente!</div>
              <div style={{ fontSize: 12 }}>O sistema não detectou itens que precisem da sua atenção agora.</div>
            </div>
          ) : (
            [1, 2, 3].map(prio => grouped[prio].length > 0 && (
              <div key={prio} style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  color: labels[prio].color, marginBottom: 6, padding: '0 4px',
                }}>
                  {labels[prio].name} ({grouped[prio].length})
                </div>
                {grouped[prio].map(p => (
                  <div
                    key={p.id}
                    onClick={() => onPendenciaClick?.(p)}
                    style={{
                      padding: 10, marginBottom: 6,
                      background: 'var(--surface)',
                      border: `1px solid ${labels[prio].color}30`,
                      borderLeft: `3px solid ${labels[prio].color}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      transition: 'all .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#FAF8F6'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{p.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{p.title}</div>
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>{p.description}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// AtividadeDrawer — timeline cronológica global
// O que aconteceu no sistema (você + sistema + automatic)
// ═══════════════════════════════════════════════════════════════════
export function AtividadeDrawer({ open, logs = [], onClose }) {
  if (!open) return null
  
  // Agrupa logs por dia (hoje, ontem, esta semana, mais antigos)
  const grouped = {
    today: [],
    yesterday: [],
    thisWeek: [],
    older: [],
  }
  
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000)
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86400000)
  
  for (const log of logs) {
    const when = new Date(log.created_at)
    if (when >= startOfToday) grouped.today.push(log)
    else if (when >= startOfYesterday) grouped.yesterday.push(log)
    else if (when >= startOfWeek) grouped.thisWeek.push(log)
    else grouped.older.push(log)
  }
  
  // Resumo do dia: contar ações
  const todaySummary = (() => {
    const counts = {}
    for (const log of grouped.today) {
      const key = log.action || 'outras'
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  })()
  
  const sectionLabels = {
    today: '📅 Hoje',
    yesterday: '🌗 Ontem',
    thisWeek: '🗓️ Esta semana',
    older: '⏳ Anteriores',
  }
  
  const renderLogItem = (log) => {
    const when = new Date(log.created_at)
    const time = when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    const isSystem = (log.action || '').startsWith('sistema')
    return (
      <div key={log.id} style={{
        padding: '8px 10px', marginBottom: 4,
        background: isSystem ? '#F0F9FF' : '#fff',
        border: `1px solid ${isSystem ? '#BAE6FD' : '#E5E7EB'}`,
        borderLeft: `3px solid ${isSystem ? '#0284C7' : 'var(--primary)'}`,
        borderRadius: 4,
        fontSize: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
          <strong style={{ color: isSystem ? '#0284C7' : 'var(--primary)' }}>
            {isSystem ? '🤖' : '👤'} {log.user_name_snapshot || 'Sistema'}
          </strong>
          <span className="text-muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{time}</span>
        </div>
        <div style={{ marginTop: 2 }}>
          <span style={{ fontStyle: 'italic', color: '#6B7280' }}>{log.action}</span>
          {log.target && <span> · <strong>{log.target}</strong></span>}
        </div>
        {log.details && (
          <div className="text-muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>
            {log.details}
          </div>
        )}
      </div>
    )
  }
  
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,.3)',
        zIndex: 9000,
      }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(440px, 90vw)',
        background: 'var(--surface)',
        boxShadow: '-4px 0 20px rgba(0,0,0,.15)',
        zIndex: 9001,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Fraunces', serif", color: 'var(--primary)' }}>
              📊 Centro de Atividade
            </div>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
              {logs.length === 0 ? 'Sem atividades registradas ainda' : `${logs.length} eventos no histórico`}
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar atividades" style={{
            background: 'transparent', border: 'none', fontSize: 22, cursor: 'pointer',
            color: 'var(--text-muted, #6b7280)',
          }}>✕</button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {logs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted, #9ca3af)' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Nada por aqui</div>
              <div style={{ fontSize: 12 }}>Quando você ou o sistema fizerem alguma ação, ela aparece aqui.</div>
            </div>
          ) : (
            <>
              {/* Resumo de hoje em destaque */}
              {grouped.today.length > 0 && (
                <div style={{
                  padding: 10, marginBottom: 12,
                  background: 'linear-gradient(135deg, #FAF5FF, #F3E8FF)',
                  border: '1px solid #D8B4FE',
                  borderRadius: 8,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6B21A8', textTransform: 'uppercase', marginBottom: 6 }}>
                    ✨ Resumo de Hoje
                  </div>
                  <div style={{ fontSize: 13, color: '#581C87' }}>
                    {Object.entries(todaySummary).map(([action, count], i, arr) => (
                      <span key={action}>
                        <strong>{count}</strong> {action}{i < arr.length - 1 ? ' · ' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              
              {['today', 'yesterday', 'thisWeek', 'older'].map(section => grouped[section].length > 0 && (
                <div key={section} style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    color: 'var(--text-muted, #6b7280)', marginBottom: 6, padding: '0 4px',
                  }}>
                    {sectionLabels[section]} ({grouped[section].length})
                  </div>
                  {grouped[section].map(renderLogItem)}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SaveButton — botão com estado "Salvando..." automatizado.
// Evita double-click, mostra spinner, desabilita durante operação.
// Uso: <SaveButton onSave={async () => await save()} disabled={!valid}>Salvar</SaveButton>
// ═══════════════════════════════════════════════════════════════════
export function SaveButton({ onSave, disabled, children = 'Salvar', className = 'btn btn-primary', icon = '💾' }) {
  const [saving, setSaving] = useState(false)
  
  const handle = async () => {
    if (saving || disabled) return
    setSaving(true)
    try {
      await onSave()
    } finally {
      // Pequeno delay pra usuário ver o "Salvando..." mesmo em saves rápidos
      setTimeout(() => setSaving(false), 300)
    }
  }
  
  return (
    <button
      className={className}
      onClick={handle}
      disabled={disabled || saving}
      style={{ opacity: (disabled || saving) ? 0.6 : 1, cursor: (disabled || saving) ? 'not-allowed' : 'pointer' }}
    >
      {saving ? (
        <>
          <span className="spinner-sm" style={{ marginRight: 6, display: 'inline-block', verticalAlign: 'middle' }}></span>
          Salvando...
        </>
      ) : (
        <>{icon} {children}</>
      )}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CopyChip — texto copiável com 1 clique. Toast de confirmação.
// Uso: <CopyChip text="LAU-613-22" label="SKU" />
// ═══════════════════════════════════════════════════════════════════
export function CopyChip({ text, label, style = {} }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  
  if (!text) return null
  
  const handle = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    // import dinâmico pra evitar circular
    const { copyToClipboard } = await import('../lib/utils')
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      toast.push(`✓ ${label || 'Copiado'}: ${text}`, { kind: 'success', duration: 2000 })
      setTimeout(() => setCopied(false), 1200)
    } else {
      toast.push('Não foi possível copiar', { kind: 'error' })
    }
  }
  
  return (
    <span
      onClick={handle}
      title={`Clique para copiar: ${text}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 6px',
        background: copied ? '#D1FAE5' : '#F5F2EF',
        border: `1px solid ${copied ? '#A7F3D0' : 'var(--border, #E5E7EB)'}`,
        borderRadius: 4,
        fontSize: 12,
        fontFamily: 'monospace',
        cursor: 'pointer',
        transition: 'background .15s',
        userSelect: 'all',
        ...style,
      }}
    >
      {text}
      <span style={{ fontSize: 10, opacity: 0.7 }}>{copied ? '✓' : '📋'}</span>
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ClearFiltersButton — limpa todos os filtros pegajosos com um prefixo
// Uso: <ClearFiltersButton prefix="products" hasActiveFilters={...} onClear={...} />
// ═══════════════════════════════════════════════════════════════════
export function ClearFiltersButton({ visible, onClear }) {
  if (!visible) return null
  return (
    <button
      onClick={onClear}
      title="Limpar todos os filtros aplicados"
      style={{
        background: '#FEE2E2', border: '1px solid #FCA5A5',
        color: '#991B1B', padding: '4px 10px', borderRadius: 14,
        fontSize: 11, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}
    >
      ✕ Limpar filtros
    </button>
  )
}
