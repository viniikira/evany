// src/components/orders/LeadTimePromptModal.jsx
// v13.36 — Extraído de Orders.jsx no refator.
// Pergunta o prazo prometido pela fábrica quando pedido vai pra "Em Fabricação".
// Sugere média histórica.

import { useState } from 'react'
import { Modal, MH, MB, MF } from '../ui'

export function LeadTimePromptModal({ order, suggestedDays, onClose, onConfirm, onSkip }) {
  const [days, setDays] = useState(suggestedDays || '')
  
  return (
    <Modal onClose={onClose} width={500}>
      <MH title="🏭 Prazo prometido pela fábrica" onClose={onClose} />
      <MB>
        <div style={{ marginBottom: 14, color: 'var(--text)' }}>
          O pedido <strong>{order.order_name || order.factory}</strong> está indo pra <strong>Em Fabricação</strong>.
        </div>
        <div style={{ marginBottom: 14, color: 'var(--text)' }}>
          Quantos dias <strong>{order.factory}</strong> prometeu pra entregar?
        </div>
        
        {suggestedDays && (
          <div style={{
            padding: '8px 12px', marginBottom: 12,
            background: '#F0F9FF', border: '1px solid #BAE6FD',
            borderRadius: 6, fontSize: 12, color: '#0C4A6E',
          }}>
            ⏱️ Média histórica desta fábrica: <strong>~{suggestedDays} dias</strong>
          </div>
        )}
        
        <div className="form-group">
          <label className="field-label">Prazo em dias *</label>
          <input
            className="field"
            type="number"
            min="1"
            max="365"
            value={days}
            onChange={e => setDays(e.target.value)}
            placeholder="Ex: 90"
            autoFocus
          />
          <div className="text-muted text-xs" style={{ marginTop: 4 }}>
            Sistema vai te avisar se passar deste prazo. Se você não sabe, pula essa etapa.
          </div>
        </div>
      </MB>
      <MF>
        <button className="btn-icon" onClick={onSkip} style={{ marginRight: 'auto', color: '#6B7280' }}>
          Pular (sem prazo)
        </button>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button
          className="btn btn-primary"
          onClick={() => {
            const n = parseInt(days, 10)
            if (n > 0 && n <= 365) onConfirm(n)
          }}
          disabled={!days || parseInt(days, 10) <= 0}
        >
          ✓ Confirmar prazo
        </button>
      </MF>
    </Modal>
  )
}
