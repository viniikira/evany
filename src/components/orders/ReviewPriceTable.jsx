// src/components/orders/ReviewPriceTable.jsx
// v13.78 — Revisão do pedido com preços EDITÁVEIS ali mesmo.
//
// Reclamação dela (14/10/2026): "tudo deveria ser mais fácil — revisar, já
// botar preço, alterar preço, botar preço de trading. Salvar, voltar e depois
// clicar em valor de trading… tá tudo muito difícil".
//
// Antes: a revisão só MOSTRAVA os preços (em formato americano), e o valor
// final da trading ficava num modal separado, acessível só depois de salvar,
// fechar e abrir o pedido. Agora, na própria revisão:
//   • FOB/un e valor FINAL da trading/un editáveis por cor (campo calculadora)
//   • "base" por modelo: digitou uma vez, vale pra todas as cores vazias
//   • fator (final ÷ FOB) e totais ao vivo, no padrão brasileiro
//   • tudo é salvo junto com o pedido, no mesmo botão
//
// Totais pela mesma regra do resto do sistema (lib/financial.js): linha sem
// final da trading = estimativa (FOB × fator do pedido), sempre marcada.

import { useMemo } from 'react'
import { ColorSwatch } from '../ColorSwatch'
import { MoneyInput } from '../MoneyInput'
import { computeOrderFinal } from '../../lib/financial'
import { formatFixedBR } from '../../lib/moneyMask'
import { UC } from '../../lib/utils'
import '../../styles/order-review.css'

const usd = (n) => `US$ ${formatFixedBR(n || 0)}`
const brl = (n) => `R$ ${Math.round(n || 0).toLocaleString('pt-BR')}`
const num = (v) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return isFinite(n) ? n : null
}

export function ReviewPriceTable({
  items = [], colors = [], modelInfo, showPrices = true,
  conversionFactor, rate, onItemField, onColorField,
}) {
  const factor = num(conversionFactor) || 1.65
  // O que vai ser gravado: snapshot = preço digitado (mesma regra do save)
  const asSaved = useMemo(() => ({
    conversion_factor: factor,
    items: items.map(it => ({ ...it, price_usd_snapshot: num(it.price_usd) })),
  }), [items, factor])
  const fin = useMemo(() => computeOrderFinal(asSaved), [asSaved])

  return (
    <div className="orv">
      {items.map(it => {
        const info = modelInfo(it)
        // v13.80 — todas as cores do modelo (a linha não some se ela apagar a
        // quantidade pra digitar outra); quem fica com 0 não vai pro pedido
        const rows = (it.colors || []).map((c, idx) => ({ c, idx }))
        if (rows.length === 0) return null

        const baseFob = num(it.price_usd)
        const baseFinal = num(it.final_price_usd)
        let pcs = 0, fobSum = 0, finalSum = 0, confirmed = 0
        const lines = rows.map(({ c, idx }) => {
          const qty = Number(c.qty) || 0
          const fob = num(c.price_usd) ?? baseFob ?? 0
          const ownFinal = num(c.final_price_usd)
          const finalUnit = ownFinal ?? baseFinal
          const isConfirmed = finalUnit != null && finalUnit > 0
          const unit = isConfirmed ? finalUnit : (fob > 0 ? fob * factor : 0)
          pcs += qty; fobSum += fob * qty; finalSum += unit * qty
          if (isConfirmed) confirmed++
          return { c, idx, qty, fob, ownFinal, finalUnit, isConfirmed, unit }
        })

        return (
          <section key={it.id} className="orv-model">
            <header className="orv-model-head">
              <div className="orv-photo">{info.photo && <img src={info.photo} alt="" />}</div>
              <div className="orv-model-name">
                <strong>{UC(info.name)}</strong>
                {info.code && <span>{info.code}</span>}
                <em>{pcs.toLocaleString('pt-BR')} peças · {rows.filter(r => Number(r.c.qty) > 0).length} cor{rows.filter(r => Number(r.c.qty) > 0).length !== 1 ? 'es' : ''}</em>
              </div>
              {showPrices && (
                <div className="orv-bases">
                  <label title="Vale pra todas as cores sem preço próprio">
                    <span>FOB base</span>
                    <MoneyInput className="orv-money" prefix="US$" value={it.price_usd ?? ''} onChange={v => onItemField(it.id, 'price_usd', v ?? '')} ariaLabel={`FOB base de ${info.name}`} />
                  </label>
                  <label title="Valor final que a trading passou, por peça — vale pra todas as cores sem valor próprio">
                    <span>Final da trading (base)</span>
                    <MoneyInput className="orv-money final" prefix="US$" value={it.final_price_usd ?? ''} onChange={v => onItemField(it.id, 'final_price_usd', v)} placeholder="—" ariaLabel={`Valor final base de ${info.name}`} />
                  </label>
                </div>
              )}
            </header>

            <div className={`orv-table${showPrices ? '' : ' no-price'}`}>
              <div className="orv-row orv-head">
                <span>Cor</span>
                <span className="num">Peças</span>
                {showPrices && <span className="num">FOB / un</span>}
                {showPrices && <span className="num">Final trading / un</span>}
                {showPrices && <span className="num">Fator</span>}
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
                        className="orv-money sm"
                        value={l.c.price_usd ?? ''}
                        placeholder={baseFob ? formatFixedBR(baseFob) : '0,00'}
                        onChange={v => onColorField(it.id, l.idx, 'price_usd', v)}
                        ariaLabel={`FOB da cor ${l.c.code}`}
                        title={baseFob ? 'Vazio usa o FOB base do modelo' : undefined}
                      />
                    </span>
                  )}
                  {showPrices && (
                    <span>
                      <MoneyInput
                        className={`orv-money sm final${l.ownFinal != null ? ' own' : ''}`}
                        value={l.c.final_price_usd ?? ''}
                        placeholder={baseFinal ? formatFixedBR(baseFinal) : '—'}
                        onChange={v => onColorField(it.id, l.idx, 'final_price_usd', v)}
                        ariaLabel={`Valor final da trading da cor ${l.c.code}`}
                        title={baseFinal ? 'Vazio usa o final base do modelo' : 'Valor final que a trading passou, por peça'}
                      />
                    </span>
                  )}
                  {showPrices && (
                    <span className="num orv-factor">
                      {l.isConfirmed && l.fob > 0 ? `×${(l.finalUnit / l.fob).toFixed(2).replace('.', ',')}` : ''}
                    </span>
                  )}
                  {showPrices && (
                    <span className={`num ${l.isConfirmed ? 'strong' : 'orv-est'}`} title={l.isConfirmed ? 'Valor confirmado pela trading' : `Estimativa: FOB × fator ${formatFixedBR(factor)}`}>
                      {l.unit > 0 ? `${l.isConfirmed ? '' : '≈ '}${usd(l.unit * l.qty)}` : '—'}
                    </span>
                  )}
                </div>
              ))}
              {showPrices && (
                <div className="orv-row orv-sub">
                  <span>Subtotal</span>
                  <span className="num">{pcs.toLocaleString('pt-BR')}</span>
                  <span className="num">{usd(fobSum)}</span>
                  <span className="num orv-muted">{confirmed}/{lines.length} confirmadas</span>
                  <span />
                  <span className="num strong">{usd(finalSum)}</span>
                </div>
              )}
            </div>
          </section>
        )
      })}

      {showPrices && fin.total > 0 && (
        <div className="orv-summary">
          <div>
            <span>FOB (fábrica)</span>
            <strong>{usd(fin.fobTotal)}</strong>
          </div>
          <div className="orv-total">
            <span>Total da compra</span>
            <strong>{usd(fin.total)}</strong>
            {num(rate) > 0 && <em>≈ {brl(fin.total * num(rate))}</em>}
          </div>
          <div>
            <span>Fator médio</span>
            <strong>{fin.multiplier ? `×${fin.multiplier.toFixed(2).replace('.', ',')}` : '—'}</strong>
          </div>
          <div>
            <span>Confirmado pela trading</span>
            <strong>{fin.linesConfirmed}/{fin.linesTotal} linhas</strong>
            {!fin.isFullyConfirmed && <em>o resto é estimativa (FOB × {formatFixedBR(factor)})</em>}
          </div>
        </div>
      )}
    </div>
  )
}
