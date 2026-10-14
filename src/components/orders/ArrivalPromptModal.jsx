// src/components/orders/ArrivalPromptModal.jsx
// v13.80 — Ao marcar "Em trânsito", pergunta QUANDO CHEGA (como já pergunta o
// prazo ao ir pra fabricação). Antes o pedido ficava sem previsão até ela
// lembrar de procurar "Definir previsão" — e o sistema não conseguia avisar
// chegada atrasada.

import { useState } from 'react'
import { Modal, MH, MB, MF } from '../ui'
import { formatDate } from '../../lib/utils'

const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const inDays = (n) => toIso(new Date(Date.now() + n * 86400000))

export function ArrivalPromptModal({ order, onConfirm, onSkip, onClose }) {
  const [date, setDate] = useState('')

  return (
    <Modal onClose={onClose} width={480}>
      <MH title="✈️ Quando chega?" onClose={onClose} />
      <MB>
        <p style={{ marginBottom: 12 }}>
          O pedido <strong>{order.order_name || order.factory}</strong> saiu da fábrica.
          Qual a previsão de chegada?
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {[15, 30, 45, 60].map(n => (
            <button
              key={n}
              type="button"
              className={`btn btn-sm ${date === inDays(n) ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setDate(inDays(n))}
            >
              em {n} dias
            </button>
          ))}
        </div>
        <div className="form-group">
          <label className="field-label">Ou escolha a data</label>
          <input className="field" type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus />
          {date && <div className="text-muted text-xs" style={{ marginTop: 4 }}>Chega em {formatDate(date, 'full')}. Dá pra mudar depois clicando na data.</div>}
        </div>
      </MB>
      <MF>
        <button className="btn-icon" onClick={onSkip} style={{ marginRight: 'auto', color: 'var(--text-2)' }}>
          Pular (ainda não sei)
        </button>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!date} onClick={() => onConfirm(date)}>
          ✓ Confirmar
        </button>
      </MF>
    </Modal>
  )
}
