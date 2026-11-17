// src/components/orders/BrandReviewTable.jsx
// v13.84 — Revisão do pedido de MARCA PARCEIRA (ex.: Slick).
//
// A marca cobra em REAIS e o preço muda a cada pedido (orçamento). Não existe
// FOB, trading nem fator: o preço por peça que a marca passou É o custo.
//   • "Preço base" por modelo: digitou uma vez, vale pra todas as cores vazias
//   • cor com preço diferente: digita na linha dela
//   • total ao vivo pela mesma regra do financeiro (computeOrderFinal em reais)
// Mesmo visual da revisão das fábricas (classes orv-).

import { useMemo } from 'react'
import { ColorSwatch } from '../ColorSwatch'
import { MoneyInput } from '../MoneyInput'
import { computeOrderFinal } from '../../lib/financial'
import { formatFixedBR } from '../../lib/moneyMask'
import { UC } from '../../lib/utils'
import '../../styles/order-review.css'

const brl = (n) => `R$ ${formatFixedBR(n || 0)}`
const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return isFinite(n) ? n : null
}

export function BrandReviewTable({ items = [], colors = [], modelInfo, showPrices = true, onItemField, onColorField }) {
  const fin = useMemo(() => computeOrderFinal({ currency: 'BRL', items }), [items])

  return (
    <div className="orv">
      {items.map(it => {
        const info = modelInfo(it)
        const rows = (it.colors || []).map((c, idx) => ({ c, idx }))
        if (rows.length === 0) return null
        const base = num(it.price_brl)
        let pcs = 0, sum = 0, priced = 0
        const lines = rows.map(({ c, idx }) => {
          const qty = Number(c.qty) || 0
          const own = num(c.price_brl)
          const unit = own ?? base ?? 0
          pcs += qty; sum += unit * qty
          if (unit > 0) priced++
          return { c, idx, qty, own, unit }
        })

        return (
          <section key={it.id} className="orv-model">
            <header className="orv-model-head">
              <div className="orv-photo">{info.photo && <img src={info.photo} alt="" />}</div>
              <div className="orv-model-name">
                <strong>{UC(info.name)}</strong>
                {info.code && <span>{info.code}</span>}
                <em>{pcs.toLocaleString('pt-BR')} peças · {lines.filter(l => l.qty > 0).length} cor{lines.filter(l => l.qty > 0).length !== 1 ? 'es' : ''}</em>
              </div>
              {showPrices && (
                <div className="orv-bases">
                  <label title="Preço por peça que a marca passou — vale pra todas as cores sem preço próprio">
                    <span>Preço por peça (base)</span>
                    <MoneyInput className="orv-money final" prefix="R$" value={it.price_brl ?? ''} onChange={v => onItemField(it.id, 'price_brl', v ?? '')} ariaLabel={`Preço base de ${info.name}`} />
                  </label>
                </div>
              )}
            </header>

            <div className={`orv-table${showPrices ? ' brl' : ' no-price'}`}>
              <div className="orv-row orv-head">
                <span>Cor</span>
                <span className="num">Peças</span>
                {showPrices && <span className="num">Preço por peça</span>}
                {showPrices && <span className="num">Total</span>}
              </div>
              {lines.map(l => (
                <div key={l.idx} className="orv-row">
                  <span className="orv-color">
                    <ColorSwatch code={l.c.code} colors={colors} size="xs" />
                    {l.c.code}
                  </span>
                  <span className="num">
                    <input
                      className={`orv-qty${l.qty > 0 ? '' : ' zero'}`}
                      type="text" inputMode="numeric"
                      value={l.c.qty === '' || l.c.qty == null ? '' : String(l.c.qty)}
                      onChange={e => {
                        const d = e.target.value.replace(/\D/g, '').slice(0, 6)
                        onColorField(it.id, l.idx, 'qty', d === '' ? '' : Number(d))
                      }}
                      aria-label={`Quantidade da cor ${l.c.code}`}
                      title={l.qty > 0 ? undefined : 'Com 0 peças esta cor não vai pro pedido'}
                    />
                  </span>
                  {showPrices && (
                    <span>
                      <MoneyInput
                        className={`orv-money sm final${l.own != null ? ' own' : ''}`}
                        prefix="R$"
                        value={l.c.price_brl ?? ''}
                        placeholder={base ? formatFixedBR(base) : '0,00'}
                        onChange={v => onColorField(it.id, l.idx, 'price_brl', v)}
                        ariaLabel={`Preço por peça da cor ${l.c.code}`}
                        title={base ? 'Vazio usa o preço base do modelo' : 'Preço por peça que a marca passou'}
                      />
                    </span>
                  )}
                  {showPrices && (
                    <span className="num strong">{l.unit > 0 && l.qty > 0 ? brl(l.unit * l.qty) : '—'}</span>
                  )}
                </div>
              ))}
              {showPrices && (
                <div className="orv-row orv-sub">
                  <span>Subtotal</span>
                  <span className="num">{pcs.toLocaleString('pt-BR')}</span>
                  <span className="num orv-muted">{priced}/{lines.length} com preço</span>
                  <span className="num strong">{brl(sum)}</span>
                </div>
              )}
            </div>
          </section>
        )
      })}

      {showPrices && (fin.total > 0 || fin.unpricedQty > 0) && (
        <div className="orv-summary brl">
          <div className="orv-total">
            <span>Total do pedido</span>
            <strong>{brl(fin.total)}</strong>
            <em>pago em reais direto à marca</em>
          </div>
          <div>
            <span>Preço médio por peça</span>
            <strong>{fin.total > 0 ? brl(fin.total / Math.max(1, items.reduce((a, it) => a + (it.colors || []).reduce((b, c) => b + (Number(c.qty) || 0), 0), 0) - fin.unpricedQty)) : '—'}</strong>
          </div>
          <div>
            <span>Com preço</span>
            <strong>{fin.linesConfirmed}/{fin.linesTotal} linhas</strong>
            {fin.unpricedQty > 0 && <em>{fin.unpricedQty} peças ainda sem preço</em>}
          </div>
        </div>
      )}
    </div>
  )
}
