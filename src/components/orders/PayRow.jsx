// src/components/orders/PayRow.jsx
// v13.36 — Extraído de Orders.jsx no refator.
//
// Linha de pagamento controlada (value+useEffect sincroniza com props).
// Resolve o problema do defaultValue que não atualizava quando savePay
// recalculava o lado oposto (BRL após editar USD, ou vice-versa).

import { useState, useEffect } from 'react'

export function PayRow({ payment, index, onSave, onRemove, onUploadReceipt, onViewReceipt }) {
  const [local, setLocal] = useState({
    payment_date: payment.payment_date || '',
    amount_usd: payment.amount_usd ?? '',
    rate_paid: payment.rate_paid ?? '',
    amount_brl: payment.amount_brl ?? '',
    bank: payment.bank || '',
  })
  
  // Sincroniza local com props quando payment muda externamente
  // (ex: outro campo foi editado e o backend recalculou este)
  useEffect(() => {
    setLocal({
      payment_date: payment.payment_date || '',
      amount_usd: payment.amount_usd ?? '',
      rate_paid: payment.rate_paid ?? '',
      amount_brl: payment.amount_brl ?? '',
      bank: payment.bank || '',
    })
  }, [payment.payment_date, payment.amount_usd, payment.rate_paid, payment.amount_brl, payment.bank])
  
  const handle = (key, raw) => {
    setLocal(s => ({ ...s, [key]: raw }))
  }
  
  const commit = (key) => {
    const raw = local[key]
    const isNumeric = key === 'amount_usd' || key === 'rate_paid' || key === 'amount_brl'
    const value = raw === '' ? null : (isNumeric ? parseFloat(raw) : raw)
    if (isNumeric && value !== null && isNaN(value)) return  // ignora lixo
    onSave({ [key]: value })
  }
  
  return (
    <div style={{ background: 'var(--surface)', padding: 12, borderRadius: 6, marginBottom: 8, border: '1px solid #FDE68A' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>💵 Pagamento #{index + 1}</strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {payment.receipt_url && <button className="btn btn-outline btn-sm" onClick={onViewReceipt}>📄 Ver comprovante</button>}
          <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer' }}>
            {payment.receipt_url ? '📎 Trocar' : '📎 Anexar'}
            <input type="file" accept="image/*,.pdf" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && onUploadReceipt(e.target.files[0])} />
          </label>
          <button className="btn btn-outline btn-sm text-danger" onClick={onRemove} title="Remover pagamento">
            🗑 Remover
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr 1fr 1fr', gap: 6 }}>
        <div>
          <label className="text-muted" style={{ fontSize: 10 }}>
            Data {!local.payment_date && <span style={{ color: '#DC2626', fontWeight: 700 }}>*</span>}
          </label>
          <input
            className="field field-sm"
            type="date"
            value={local.payment_date}
            onChange={e => handle('payment_date', e.target.value)}
            onBlur={() => commit('payment_date')}
            style={!local.payment_date ? { borderColor: '#DC2626', background: '#FEF2F2' } : undefined}
            required
          />
        </div>
        <div>
          <label className="text-muted" style={{ fontSize: 10 }}>USD</label>
          <input className="field field-sm" type="number" step="0.01" value={local.amount_usd} onChange={e => handle('amount_usd', e.target.value)} onBlur={() => commit('amount_usd')} placeholder="$" />
        </div>
        <div>
          <label className="text-muted" style={{ fontSize: 10 }}>Câmbio</label>
          <input className="field field-sm" type="number" step="0.0001" value={local.rate_paid} onChange={e => handle('rate_paid', e.target.value)} onBlur={() => commit('rate_paid')} placeholder="ex: 5,42" />
        </div>
        <div>
          <label className="text-muted" style={{ fontSize: 10 }}>BRL</label>
          <input className="field field-sm" type="number" step="0.01" value={local.amount_brl} onChange={e => handle('amount_brl', e.target.value)} onBlur={() => commit('amount_brl')} placeholder="R$" />
        </div>
        <div>
          <label className="text-muted" style={{ fontSize: 10 }}>Banco</label>
          <input className="field field-sm" value={local.bank} onChange={e => handle('bank', e.target.value)} onBlur={() => commit('bank')} placeholder="Ex: Wise" />
        </div>
      </div>
      {/* #FIX-2 Aviso quando data falta — crítico pra auditoria tributária */}
      {!local.payment_date && (
        <div style={{
          marginTop: 6, padding: '6px 10px',
          background: '#FEE2E2', border: '1px solid #FCA5A5',
          borderRadius: 4, fontSize: 11, color: '#991B1B', fontWeight: 600,
        }}>
          ⚠️ Data do pagamento obrigatória. Use a data real do banco/Wise pra auditoria correta.
        </div>
      )}
      <div className="text-muted text-xs" style={{ marginTop: 4 }}>
        💡 Edite USD ou BRL e digite o câmbio — o outro valor calcula automático.
      </div>
    </div>
  )
}
