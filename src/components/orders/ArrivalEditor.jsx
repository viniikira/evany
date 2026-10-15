// src/components/orders/ArrivalEditor.jsx
// v13.76 — Previsão de chegada editável onde ela aparece.
//
// Antes a previsão só mudava abrindo o editor completo do pedido (etapa 3 do
// criador) — ela não achava ("e como atualiza a previsão?"). Agora a própria
// data vira um botão: clicou, escolhe a data (ou +15/+30 dias), salvou.
// Funciona dentro de linhas clicáveis (não deixa o clique vazar).
// Estilos em styles/orders-board.css (prefixo ae-).

import { useEffect, useRef, useState } from 'react'
import { formatDate, parseDateLocal } from '../../lib/utils'
import '../../styles/orders-board.css'

const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function ArrivalEditor({ value, onSave, disabled = false, overdue = false, label = null }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const [saving, setSaving] = useState(false)
  const stop = (e) => e.stopPropagation()
  // clicou fora do editor = fecha sem salvar
  const boxRef = useRef(null)
  useEffect(() => {
    if (!editing) return
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setEditing(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [editing])

  const save = async (next) => {
    setSaving(true)
    try {
      const ok = await onSave(next || null)
      if (ok !== false) setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  // Atalhos: na maioria das vezes ela só empurra a data pra frente.
  // Se a previsão já passou, soma a partir de hoje.
  const plusDays = (n) => {
    const cur = parseDateLocal(value)
    const base = cur && cur > new Date() ? cur : new Date()
    return toIso(new Date(base.getTime() + n * 86400000))
  }

  // v13.81 — a data fica no lugar; o editor abre por cima (popover), sem
  // empurrar a linha da tabela
  const trigger = (
      <button
        type="button"
        className={`ae-trigger${overdue ? ' overdue' : ''}`}
        disabled={disabled}
        onClick={(e) => { stop(e); setDraft(value || ''); setEditing(true) }}
        title={disabled ? undefined : 'Mudar a previsão de chegada'}
      >
        {label || (value ? `Previsão ${formatDate(value, 'full')}` : 'Definir previsão')}
      </button>
  )

  return (
    <span className="ae" onClick={stop} ref={boxRef}>
    {trigger}
    {editing && <div className="ae-pop" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }}>
      <input
        type="date"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        aria-label="Nova previsão de chegada"
        autoFocus
      />
      <button type="button" className="ob-btn" onClick={() => setDraft(plusDays(15))} title="Soma 15 dias (a partir de hoje se a previsão já passou)">+15 dias</button>
      <button type="button" className="ob-btn" onClick={() => setDraft(plusDays(30))} title="Soma 30 dias (a partir de hoje se a previsão já passou)">+30 dias</button>
      <button
        type="button"
        className="ob-btn good"
        disabled={saving || draft === (value || '')}
        onClick={() => save(draft)}
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
      {value && <button type="button" className="ob-btn" disabled={saving} onClick={() => save(null)}>Limpar</button>}
      <button type="button" className="ob-btn" onClick={() => setEditing(false)} aria-label="Cancelar">Cancelar</button>
    </div>}
    </span>
  )
}
