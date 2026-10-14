// src/components/orders/PaymentsSection.jsx
// v13.77 — Pagamentos do pedido refeitos (reclamação de 14/10/2026: "essa
// sequência não está fazendo sentido, quando eu coloco ele reorganiza").
//
//   • Ordem SEMPRE do mais antigo pro mais novo; a numeração (1º, 2º…) segue a
//     data — não muda quando ela edita.
//   • Lista em modo leitura, com valores no padrão brasileiro (R$ 17.999,98).
//     Editar abre o formulário só daquele pagamento.
//   • Novo pagamento: formulário que só grava no "Salvar" (antes o botão criava
//     um registro vazio no banco na hora).
//   • Ela paga em REAIS com o câmbio do dia: digita R$ e câmbio, o sistema
//     mostra quanto deu em dólar. Se tiver o valor em dólar do contrato, pode
//     digitar e o câmbio é recalculado.
//   • Comprovante abre dentro do sistema (ReceiptViewer).

import { useState, useMemo } from 'react'
import { formatMoneyBR, formatRateBR, resolveAmounts, sortPaymentsChrono, summarizePayments, isEmptyPayment, validatePayment } from '../../lib/payments'
import { MoneyInput } from '../MoneyInput'
import { formatDate } from '../../lib/utils'
import '../../styles/payments.css'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const brl = (n) => `R$ ${formatMoneyBR(n)}`
const usd = (n) => `US$ ${formatMoneyBR(n)}`

export function PaymentsSection({
  payments = [], adding = false, onStartAdd, onCancelAdd,
  onCreate, onUpdate, onRemove, onAttach, onViewReceipt, readOnly = false,
}) {
  const [editingId, setEditingId] = useState(null)
  const sorted = useMemo(() => sortPaymentsChrono(payments), [payments])
  const sum = useMemo(() => summarizePayments(payments), [payments])
  const banks = useMemo(() => [...new Set(payments.map(p => (p.bank || '').trim()).filter(Boolean))], [payments])

  // Numeração pela data: só conta pagamentos com valor
  let n = 0
  const rows = sorted.map(p => ({ p, number: isEmptyPayment(p) ? null : ++n }))

  return (
    <div className="pay">
      {sorted.length === 0 && !adding && (
        <div className="pay-empty">
          Nenhum pagamento registrado.
          {!readOnly && <button type="button" className="pay-btn primary" onClick={onStartAdd}>Registrar o primeiro pagamento</button>}
        </div>
      )}

      {sorted.length > 0 && (
        <div className="pay-table" role="table" aria-label="Pagamentos do pedido">
          <div className="pay-row pay-head" role="row">
            <span>Nº</span>
            <span>Data</span>
            <span className="num">Pago em reais</span>
            <span className="num">Câmbio</span>
            <span className="num">Em dólar</span>
            <span>Banco</span>
            <span>Arquivo</span>
            <span />
          </div>

          {rows.map(({ p, number }) => editingId === p.id ? (
            <div key={p.id} className="pay-row-form">
              <PaymentForm
                title={number ? `Editando o ${number}º pagamento` : 'Preenchendo pagamento'}
                initial={p}
                banks={banks}
                onCancel={() => setEditingId(null)}
                onSubmit={async (data) => {
                  const ok = await onUpdate(p.id, data)
                  if (ok !== false) setEditingId(null)
                  return ok
                }}
              />
            </div>
          ) : isEmptyPayment(p) ? (
            <div key={p.id} className="pay-row incomplete" role="row">
              <span className="pay-n">—</span>
              <span className="pay-incomplete-msg">Pagamento sem valor{p.payment_date ? ` (${formatDate(p.payment_date, 'full')})` : ''} — sobrou de uma versão antiga.</span>
              {!readOnly && (
                <span className="pay-actions">
                  <button type="button" className="pay-btn sm" onClick={() => setEditingId(p.id)}>Preencher</button>
                  <button type="button" className="pay-btn sm danger" onClick={() => onRemove(p)}>Excluir</button>
                </span>
              )}
            </div>
          ) : (
            <div key={p.id} className="pay-row" role="row">
              <span className="pay-n">{number}º</span>
              <span className={p.payment_date ? '' : 'pay-warn'}>{p.payment_date ? formatDate(p.payment_date, 'full') : 'sem data'}</span>
              <span className="num strong">{Number(p.amount_brl) > 0 ? brl(p.amount_brl) : '—'}</span>
              <span className="num">{Number(p.rate_paid) > 0 ? formatRateBR(Number(p.rate_paid)) : '—'}</span>
              <span className="num">{Number(p.amount_usd) > 0 ? usd(p.amount_usd) : '—'}</span>
              <span className="pay-bank" title={p.bank || undefined}>{p.bank || <em>—</em>}</span>
              <span>
                {p.receipt_url ? (
                  <button type="button" className="pay-link" onClick={() => onViewReceipt(p, number)} title="Abrir o comprovante aqui no sistema">Ver</button>
                ) : !readOnly ? (
                  <label className="pay-link muted" title="Anexar o comprovante deste pagamento">
                    Anexar
                    <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files?.[0] && onAttach(p.id, e.target.files[0])} />
                  </label>
                ) : <em className="pay-muted">—</em>}
              </span>
              {!readOnly && (
                <span className="pay-actions">
                  <button type="button" className="pay-btn sm" onClick={() => setEditingId(p.id)}>Editar</button>
                  <button type="button" className="pay-btn sm icon danger" onClick={() => onRemove(p)} aria-label={`Excluir o ${number}º pagamento`} title="Excluir pagamento">🗑</button>
                </span>
              )}
            </div>
          ))}

          {sum.count > 0 && (
            <div className="pay-row pay-total" role="row">
              <span />
              <span>Total</span>
              <span className="num strong">{brl(sum.brl)}</span>
              <span className="num" title={sum.avgRate ? `Câmbio médio: ${formatRateBR(sum.avgRate)} (total em reais ÷ total em dólar)` : undefined}>{sum.avgRate ? formatRateBR(Math.round(sum.avgRate * 100) / 100) : ''}</span>
              <span className="num strong">{usd(sum.usd)}</span>
              <span /><span /><span />
            </div>
          )}
        </div>
      )}

      {adding && (
        <div className="pay-new">
          <PaymentForm
            title="Novo pagamento"
            initial={{ payment_date: today() }}
            banks={banks}
            withFile
            onCancel={onCancelAdd}
            onSubmit={onCreate}
          />
        </div>
      )}

      {!adding && sorted.length > 0 && !readOnly && (
        <button type="button" className="pay-btn primary pay-add" onClick={onStartAdd}>+ Registrar pagamento</button>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// Formulário (novo ou editando). Nada é gravado até "Salvar".
// ═════════════════════════════════════════════════════════════
function PaymentForm({ title, initial = {}, banks = [], withFile = false, onSubmit, onCancel }) {
  const [date, setDate] = useState(initial.payment_date || '')
  // v13.78 — campos estilo calculadora (MoneyInput): guardam número direto
  const [brlVal, setBrl] = useState(Number(initial.amount_brl) > 0 ? Number(initial.amount_brl) : null)
  const [rateVal, setRate] = useState(Number(initial.rate_paid) > 0 ? Number(initial.rate_paid) : null)
  // Se o pagamento antigo não tem câmbio mas tem dólar, começa no modo "digitar em dólar"
  const startUsd = !(Number(initial.rate_paid) > 0) && Number(initial.amount_usd) > 0
  const [usdMode, setUsdMode] = useState(startUsd)
  const [usdVal, setUsd] = useState(Number(initial.amount_usd) > 0 ? Number(initial.amount_usd) : null)
  const [bank, setBank] = useState(initial.bank || '')
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const v = { brl: brlVal, rate: rateVal, usd: usdVal }
  const r = usdMode
    ? resolveAmounts({ brl: v.brl, usd: v.usd, rate: null, lastEdited: 'usd' })
    : resolveAmounts({ brl: v.brl, rate: v.rate, usd: null, lastEdited: 'rate' })

  const submit = async (e) => {
    e?.preventDefault()
    const data = {
      payment_date: date || null,
      amount_brl: r.brl > 0 ? r.brl : null,
      rate_paid: r.rate > 0 ? r.rate : null,
      amount_usd: r.usd > 0 ? r.usd : null,
      bank: bank.trim() || null,
    }
    const msg = validatePayment(data)
    if (msg) { setError(msg); return }
    setError(null)
    setSaving(true)
    try { await onSubmit(data, file) } finally { setSaving(false) }
  }

  return (
    <form className="pay-form" onSubmit={submit}>
      <div className="pay-form-title">{title}</div>
      <div className="pay-form-grid">
        <label className="pay-field">
          <span>Data do pagamento</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </label>
        <label className="pay-field">
          <span>Valor pago em reais</span>
          <MoneyInput
            className="pay-money" prefix="R$" value={brlVal} onChange={setBrl}
            autoFocus={!initial.amount_brl} ariaLabel="Valor pago em reais"
          />
        </label>
        {!usdMode ? (
          <label className="pay-field">
            <span>Câmbio do dia</span>
            <MoneyInput
              className="pay-money" value={rateVal} onChange={setRate} money={false}
              placeholder="0,00" ariaLabel="Câmbio do dia" title="Digite só os números: 501 vira 5,01"
            />
          </label>
        ) : (
          <label className="pay-field">
            <span>Valor em dólar</span>
            <MoneyInput className="pay-money" prefix="US$" value={usdVal} onChange={setUsd} ariaLabel="Valor em dólar" />
          </label>
        )}
        <div className="pay-field result">
          <span>{usdMode ? 'Câmbio resultante' : 'Deu em dólar'}</span>
          <strong>
            {usdMode
              ? (r.rate > 0 ? formatRateBR(r.rate) : '—')
              : (r.usd > 0 ? usd(r.usd) : '—')}
          </strong>
          <button type="button" className="pay-link" onClick={() => setUsdMode(m => !m)}>
            {usdMode ? 'Usar câmbio do dia' : 'Tenho o valor em dólar'}
          </button>
        </div>
        <label className="pay-field">
          <span>Banco</span>
          <input list="pay-banks" placeholder="ex.: Itaú" value={bank} onChange={e => setBank(e.target.value)} />
          <datalist id="pay-banks">{banks.map(b => <option key={b} value={b} />)}</datalist>
        </label>
        {withFile && (
          <label className="pay-field">
            <span>Comprovante <em>(opcional)</em></span>
            <input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
          </label>
        )}
      </div>

      {r.brl > 0 && r.usd > 0 && r.rate > 0 && (
        <div className="pay-formula">
          {brl(r.brl)} ÷ {formatRateBR(r.rate)} = <strong>{usd(r.usd)}</strong>
        </div>
      )}
      {error && <div className="pay-error">{error}</div>}

      <div className="pay-form-actions">
        <button type="button" className="pay-btn" onClick={onCancel} disabled={saving}>Cancelar</button>
        <button type="submit" className="pay-btn primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar pagamento'}</button>
      </div>
    </form>
  )
}
