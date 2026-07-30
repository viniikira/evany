// src/components/orders/ReservesSection.jsx
// v13.68 — CAIXINHAS: dinheiro já guardado pra este pedido.
//
// A dona costuma separar o dinheiro do pedido antes de pagar (às vezes
// rendendo). Aqui ela registra quanto, em qual banco e se está rendendo —
// e vê na hora quanto do que falta já está coberto e quanto ainda precisa
// captar. A reserva é em BRL (banco brasileiro); a dívida em USD é
// convertida pela cotação de projeção do pedido.

import { useState } from 'react'

const fmtR$ = (n) => 'R$ ' + (Math.round(n || 0)).toLocaleString('pt-BR')

export function ReservesSection({ reserves = [], balance, onSave }) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ amount_brl: '', bank: '', yields: true, note: '' })

  const commit = (list) => onSave(list)

  const addReserve = () => {
    const amount = parseFloat(draft.amount_brl)
    if (!(amount > 0)) return
    commit([...reserves, { ...draft, amount_brl: amount }])
    setDraft({ amount_brl: '', bank: '', yields: true, note: '' })
    setAdding(false)
  }
  const removeReserve = (idx) => commit(reserves.filter((_, i) => i !== idx))
  const toggleYields = (idx) => commit(reserves.map((r, i) => i === idx ? { ...r, yields: !r.yields } : r))

  const { reservedBrl = 0, yieldingBrl = 0, coveragePercent = 0, toRaiseBrl = 0, isCovered, remainingBrl } = balance || {}
  const hasDebt = (remainingBrl || 0) > 0

  return (
    <div style={{ marginTop: 12, padding: 12, background: 'var(--surface)', border: '1px solid #BAE6FD', borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0C4A6E' }}>
          🏦 Já guardado pra este pedido
          {reservedBrl > 0 && <span style={{ marginLeft: 8, fontWeight: 800 }}>{fmtR$(reservedBrl)}</span>}
        </div>
        {!adding && (
          <button className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>+ Caixinha</button>
        )}
      </div>

      {/* Cobertura do que falta */}
      {hasDebt && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#0C4A6E', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
            <span>
              {isCovered
                ? <strong style={{ color: '#059669' }}>✓ O que falta já está todo guardado</strong>
                : <>Cobre <strong>{Math.round(coveragePercent)}%</strong> do que falta ({fmtR$(remainingBrl)})</>}
            </span>
            {!isCovered && toRaiseBrl > 0 && (
              <span style={{ color: '#991B1B', fontWeight: 700 }}>faltam captar {fmtR$(toRaiseBrl)}</span>
            )}
          </div>
          <div style={{ height: 8, borderRadius: 5, background: '#E0F2FE', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 5,
              width: `${Math.min(100, Math.max(0, coveragePercent))}%`,
              background: isCovered ? '#059669' : (coveragePercent > 50 ? '#0891B2' : '#F59E0B'),
              transition: 'width .4s',
            }} />
          </div>
          {yieldingBrl > 0 && (
            <div style={{ fontSize: 10.5, color: '#0C4A6E', marginTop: 4, opacity: .85 }}>
              📈 {fmtR$(yieldingBrl)} rendendo
              {yieldingBrl < reservedBrl && ` · ${fmtR$(reservedBrl - yieldingBrl)} parado`}
            </div>
          )}
        </div>
      )}

      {/* Lista */}
      {reserves.length === 0 && !adding && (
        <div className="text-muted" style={{ fontSize: 11.5 }}>
          Nenhuma caixinha registrada. Use quando já tiver separado o dinheiro deste pedido.
        </div>
      )}
      {reserves.map((r, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: idx > 0 ? '1px solid var(--border-light, var(--border))' : 'none' }}>
          <span style={{ fontSize: 13, fontWeight: 700, minWidth: 96 }}>{fmtR$(r.amount_brl)}</span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.bank || '—'}</span>
          <button
            onClick={() => toggleYields(idx)}
            title={r.yields ? 'Está rendendo — clique pra marcar como parado' : 'Está parado — clique pra marcar como rendendo'}
            style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${r.yields ? '#86EFAC' : 'var(--border)'}`,
              background: r.yields ? '#F0FDF4' : 'transparent',
              color: r.yields ? '#166534' : 'var(--text-muted, #6b7280)',
              fontWeight: 600,
            }}
          >{r.yields ? '📈 rendendo' : '💤 parado'}</button>
          {r.note && <span className="text-muted" style={{ fontSize: 11 }}>{r.note}</span>}
          <button className="btn-icon text-danger" style={{ marginLeft: 'auto' }} onClick={() => removeReserve(idx)} aria-label="Remover caixinha" title="Remover">✕</button>
        </div>
      ))}

      {/* Adicionar */}
      {adding && (
        <div style={{ marginTop: 8, padding: 10, background: 'var(--bg)', borderRadius: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 6, alignItems: 'end' }}>
            <div>
              <label className="text-muted" style={{ fontSize: 10 }}>Valor (R$)</label>
              <input
                className="field field-sm" type="number" step="0.01" min="0" autoFocus
                value={draft.amount_brl}
                onChange={e => setDraft(d => ({ ...d, amount_brl: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addReserve() }}
                placeholder="30000"
                aria-label="Valor guardado em reais"
              />
            </div>
            <div>
              <label className="text-muted" style={{ fontSize: 10 }}>Banco / onde está</label>
              <input
                className="field field-sm"
                value={draft.bank}
                onChange={e => setDraft(d => ({ ...d, bank: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addReserve() }}
                placeholder="Ex: Itaú, Cora, caixinha Nubank"
                aria-label="Banco da caixinha"
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, cursor: 'pointer', paddingBottom: 6, whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={draft.yields}
                onChange={e => setDraft(d => ({ ...d, yields: e.target.checked }))}
              />
              rendendo
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline btn-sm" onClick={() => { setAdding(false); setDraft({ amount_brl: '', bank: '', yields: true, note: '' }) }}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={addReserve} disabled={!(parseFloat(draft.amount_brl) > 0)}>Guardar</button>
          </div>
        </div>
      )}
    </div>
  )
}
