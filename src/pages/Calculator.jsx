// src/pages/Calculator.jsx
// v13.28 — Extraído de SimplePages.jsx
// Duas calculadoras: custo de importação + lucro de venda

import { useState } from 'react'

export function CalculatorPage({ rate: liveRate, perm }) {
  const [tab, setTab] = useState('cost')
  return <div>
    <div className="chip-bar" style={{ marginBottom: 20 }}>
      <button className={`chip-filter${tab === 'cost' ? ' on' : ''}`} onClick={() => setTab('cost')}>🧮 Custo Importação</button>
      <button className={`chip-filter${tab === 'profit' ? ' on' : ''}`} onClick={() => setTab('profit')}>💰 Lucro Venda</button>
    </div>
    {tab === 'cost' && <CostCalc liveRate={liveRate} />}
    {tab === 'profit' && <ProfitCalc />}
  </div>
}

function CostCalc({ liveRate }) {
  const [priceUsd, setPriceUsd] = useState('')
  const [factor, setFactor] = useState('1.5')
  const [qty, setQty] = useState('1')
  const [customRate, setCustomRate] = useState('')
  const r = customRate ? parseFloat(customRate) : liveRate || 0
  const p = parseFloat(priceUsd) || 0
  const f = parseFloat(factor) || 1
  const q = parseInt(qty) || 1
  const unit = p * f * r
  const total = unit * q
  return <div className="card" style={{ maxWidth: 600 }}>
    <div className="card-title">🧮 Custo de Importação</div>
    <div className="form-row">
      <div className="form-group"><label className="field-label">Preço USD</label><input className="field" type="number" step="0.01" value={priceUsd} onChange={e => setPriceUsd(e.target.value)} placeholder="17.50" /></div>
      <div className="form-group"><label className="field-label">Fator</label><input className="field" type="number" step="0.1" value={factor} onChange={e => setFactor(e.target.value)} /></div>
    </div>
    <div className="form-row">
      <div className="form-group"><label className="field-label">Cotação</label><input className="field" type="number" step="0.01" value={customRate} onChange={e => setCustomRate(e.target.value)} placeholder={liveRate ? `R$ ${liveRate.toFixed(2)}` : ''} /></div>
      <div className="form-group"><label className="field-label">Quantidade</label><input className="field" type="number" value={qty} onChange={e => setQty(e.target.value)} /></div>
    </div>
    {p > 0 && (
      <div style={{ padding: 16, background: '#f9fafb', borderRadius: 8, marginTop: 12 }}>
        <div className="text-sm text-muted">{p.toFixed(2)} × {f} × R$ {r.toFixed(2)}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--primary)', marginTop: 8 }}>
          Custo unitário: R$ {unit.toFixed(2)}
        </div>
        {q > 1 && <div style={{ fontSize: 16, marginTop: 4 }}>Total ({q} un): R$ {total.toFixed(2)}</div>}
      </div>
    )}
  </div>
}

function ProfitCalc() {
  const [sellPrice, setSellPrice] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [packaging, setPackaging] = useState('10')
  const [taxNF, setTaxNF] = useState('13')
  const [coupon, setCoupon] = useState('0')
  const [cardFee, setCardFee] = useState('7')
  const [freight, setFreight] = useState('0')
  const [other, setOther] = useState('0')
  
  const sell = parseFloat(sellPrice) || 0
  const cost = parseFloat(costPrice) || 0
  const pkg = parseFloat(packaging) || 0
  const nf = parseFloat(taxNF) || 0
  const cup = parseFloat(coupon) || 0
  const card = parseFloat(cardFee) || 0
  const fr = parseFloat(freight) || 0
  const ot = parseFloat(other) || 0
  
  const valNF = sell * (nf / 100)
  const valCup = sell * (cup / 100)
  const valCard = sell * (card / 100)
  const totalDeductions = pkg + valNF + valCup + valCard + fr + ot
  const netRevenue = sell - totalDeductions
  const profit = netRevenue - cost
  const margin = sell > 0 ? profit / sell * 100 : 0
  const markup = cost > 0 ? ((sell - cost) / cost) * 100 : 0
  
  const DedRow = ({ label, val, note }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>
        {label} {note && <span className="text-muted text-xs">· {note}</span>}
      </span>
      <span style={{ color: 'var(--danger)' }}>-R$ {val.toFixed(2)}</span>
    </div>
  )
  
  return <div className="card" style={{ maxWidth: 640 }}>
    <div className="card-title">💰 Lucro de Venda</div>
    <div className="form-row">
      <div className="form-group">
        <label className="field-label">Preço de Venda (R$) *</label>
        <input className="field" type="number" step="0.01" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="550" />
      </div>
      <div className="form-group">
        <label className="field-label">Custo do Produto (R$) *</label>
        <input className="field" type="number" step="0.01" value={costPrice} onChange={e => setCostPrice(e.target.value)} placeholder="150" />
      </div>
    </div>
    <div className="field-label" style={{ marginTop: 10, marginBottom: 6 }}>TAXAS E DESPESAS</div>
    <div className="form-row">
      <div className="form-group">
        <label className="field-label">Embalagem (R$)</label>
        <input className="field" type="number" step="0.01" value={packaging} onChange={e => setPackaging(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="field-label">Frete (R$)</label>
        <input className="field" type="number" step="0.01" value={freight} onChange={e => setFreight(e.target.value)} />
      </div>
    </div>
    <div className="form-row">
      <div className="form-group">
        <label className="field-label">Imposto NF (%)</label>
        <input className="field" type="number" step="0.01" value={taxNF} onChange={e => setTaxNF(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="field-label">Taxa Cartão (%)</label>
        <input className="field" type="number" step="0.01" value={cardFee} onChange={e => setCardFee(e.target.value)} />
      </div>
    </div>
    <div className="form-row">
      <div className="form-group">
        <label className="field-label">Cupom/Desconto (%)</label>
        <input className="field" type="number" step="0.01" value={coupon} onChange={e => setCoupon(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="field-label">Outros (R$)</label>
        <input className="field" type="number" step="0.01" value={other} onChange={e => setOther(e.target.value)} />
      </div>
    </div>
    {sell > 0 && (
      <div style={{ padding: 16, background: '#f9fafb', borderRadius: 8, marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 600, paddingBottom: 6, borderBottom: '1px solid #e5e7eb' }}>
          <span>Receita bruta</span>
          <span className="text-success">R$ {sell.toFixed(2)}</span>
        </div>
        <div style={{ paddingTop: 6 }}>
          <div className="text-muted text-xs" style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: .5 }}>Deduções</div>
          {pkg > 0 && <DedRow label="Embalagem" val={pkg} />}
          {fr > 0 && <DedRow label="Frete" val={fr} />}
          {nf > 0 && <DedRow label="Imposto NF" val={valNF} note={`${nf}% de R$ ${sell.toFixed(2)}`} />}
          {card > 0 && <DedRow label="Taxa cartão" val={valCard} note={`${card}% de R$ ${sell.toFixed(2)}`} />}
          {cup > 0 && <DedRow label="Cupom/desconto" val={valCup} note={`${cup}% de R$ ${sell.toFixed(2)}`} />}
          {ot > 0 && <DedRow label="Outros" val={ot} />}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px dashed #ccc', fontSize: 13, fontWeight: 600 }}>
          <span>Total de deduções</span>
          <span className="text-danger">-R$ {totalDeductions.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, fontWeight: 600, color: 'var(--primary)' }}>
          <span>Receita líquida</span>
          <span>R$ {netRevenue.toFixed(2)}</span>
        </div>
        {cost > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }} className="text-muted">
              <span>Custo do produto</span>
              <span className="text-danger">-R$ {cost.toFixed(2)}</span>
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #4A1942',
              marginTop: 8, paddingTop: 10, fontSize: 18, fontWeight: 700,
              color: profit >= 0 ? 'var(--success)' : 'var(--danger)',
            }}>
              <span>LUCRO LÍQUIDO</span>
              <span>R$ {profit.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12 }} className="text-muted">
              <span>Margem: <strong style={{ color: profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{margin.toFixed(1)}%</strong> sobre a venda</span>
              <span>Markup: <strong>{markup.toFixed(0)}%</strong> sobre o custo</span>
            </div>
          </>
        )}
      </div>
    )}
  </div>
}
