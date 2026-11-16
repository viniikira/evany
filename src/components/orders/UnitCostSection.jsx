// src/components/orders/UnitCostSection.jsx
// v13.82 — "Quanto saiu cada peça" dentro do pedido.
//
// Quitado: custo REAL (soma dos pagamentos em R$ repartida pelo valor de cada
// linha — fecha com o que saiu do banco). Em aberto: previsão, com a parte já
// paga no câmbio real. A conta está em lib/unitCost.js.
// Estilos em styles/unit-cost.css (prefixo uc-).

import { useMemo, useState } from 'react'
import { computeUnitCosts } from '../../lib/unitCost'
import { formatFixedBR } from '../../lib/moneyMask'
import { UC } from '../../lib/utils'
import '../../styles/unit-cost.css'

const brl = (n) => 'R$ ' + formatFixedBR(n || 0, 2)
const usd = (n) => 'US$ ' + formatFixedBR(n || 0, 2)
const rateBR = (n) => 'R$ ' + formatFixedBR(n || 0, 4)
const int = (n) => (n || 0).toLocaleString('pt-BR')
const pct = (n) => Math.round((n || 0) * 100) + '%'

export function UnitCostSection({ order, products = [], rate, onEditPrices = null }) {
  const c = useMemo(() => computeUnitCosts(order, rate), [order, rate])
  const [copied, setCopied] = useState(false)
  // previsão começa recolhida; custo real começa aberto (é o que ela veio ver)
  const [open, setOpen] = useState(c.kind === 'real')
  if (!(c.pieces > 0) || !(c.totalBrl > 0)) return null

  const itemsById = new Map((order.items || []).map(it => [it.id, it]))
  const nameOf = (itemId) => {
    const it = itemsById.get(itemId)
    const p = products.find(x => x.id === it?.product_id)
    return it?.name_manual || UC(p?.name || it?.product_name_snapshot || '—')
  }
  const photoOf = (itemId) => {
    const p = products.find(x => x.id === itemsById.get(itemId)?.product_id)
    return p?.card_image_url || (p?.photos || [])[0] || null
  }

  const real = c.kind === 'real'
  // marcado como pago mas sem (todos os) pagamentos lançados: já saiu, só não dá pra fechar
  const paidOutside = !real && c.isManuallySettled
  const title = real || paidOutside ? 'Quanto saiu cada peça' : 'Quanto vai sair cada peça'
  const tag = real ? 'Custo real · pedido quitado'
    : paidOutside ? 'Estimativa · faltam pagamentos lançados'
    : c.kind === 'partial' ? `Previsão · ${pct(Math.min(1, c.coverage ?? 0))} pago`
    : 'Previsão · nada pago ainda'

  const copy = async () => {
    const rows = [['Modelo', 'Cor', 'Peças', 'Custo por peça (R$)', 'Custo por peça (US$)', 'Total (R$)']]
    for (const m of c.models) {
      for (const l of m.lines) {
        rows.push([nameOf(m.itemId), l.colorCode || '', l.qty, formatFixedBR(l.brlUnit, 2), formatFixedBR(l.usdUnit, 2), formatFixedBR(l.brlTotal, 2)])
      }
    }
    rows.push(['TOTAL', '', c.pieces, formatFixedBR(c.avgBrlUnit, 2), formatFixedBR(c.avgUsdUnit, 2), formatFixedBR(c.totalBrl, 2)])
    try {
      await navigator.clipboard.writeText(rows.map(r => r.join('\t')).join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* sem permissão de área de transferência */ }
  }

  return (
    <section className={`uc ${real ? 'real' : 'forecast'}`} aria-label={title}>
      <header className="uc-head">
        <div>
          <h3>{title}</h3>
          <span className={`uc-tag ${real ? 'good' : ''}`}>{tag}</span>
        </div>
        <div className="uc-head-actions">
          {open && <button type="button" className="uc-btn" onClick={copy}>{copied ? 'Copiado ✓' : 'Copiar tabela'}</button>}
          <button type="button" className="uc-btn" onClick={() => setOpen(v => !v)} aria-expanded={open}>
            {open ? 'Recolher' : 'Ver por modelo'}
          </button>
        </div>
      </header>

      {/* Os números que respondem a pergunta */}
      <div className="uc-kpis">
        <div className="uc-kpi lead">
          <span>{real ? 'Cada peça saiu por' : paidOutside ? 'Cada peça saiu por volta de' : 'Cada peça deve sair por'}</span>
          <strong>{brl(c.avgBrlUnit)}</strong>
          <em>em média · {usd(c.avgUsdUnit)}</em>
        </div>
        <div className="uc-kpi">
          <span>{real ? 'Total pago' : paidOutside ? 'Total estimado' : 'Total previsto'}</span>
          <strong>{brl(c.totalBrl)}</strong>
          <em>{usd(c.totalUsd)} · {int(c.pieces)} peças</em>
        </div>
        <div className="uc-kpi">
          <span>{real ? 'Câmbio que valeu' : 'Câmbio'}</span>
          <strong>{c.paidRate ? rateBR(c.paidRate) : rateBR(c.projRate)}</strong>
          <em>
            {c.paidRate
              ? `média de ${c.paymentsCount} pagamento${c.paymentsCount !== 1 ? 's' : ''}`
              : 'câmbio de projeção'}
          </em>
        </div>
        {c.realMultiplier && (
          <div className="uc-kpi">
            <span>Em cima do FOB</span>
            <strong>×{formatFixedBR(c.realMultiplier, 2)}</strong>
            <em>FOB {usd(c.fobTotal)}</em>
          </div>
        )}
      </div>

      {/* Avisos: tudo que impede o número de ser exato, dito em português */}
      <Notes c={c} onEditPrices={onEditPrices} />

      {open && (
        <>
          <div className="uc-table" role="table">
            <div className="uc-row uc-row-head" role="row">
              <span>Modelo</span>
              <span className="num">Peças</span>
              <span className="num">Custo por peça</span>
              <span className="num">Em dólar</span>
              <span className="num">Total</span>
            </div>
            {c.models.map(m => {
              const photo = photoOf(m.itemId)
              return (
                <div key={m.itemId} role="rowgroup">
                  <div className="uc-row uc-model" role="row">
                    <span className="uc-name">
                      {photo ? <img src={photo} alt="" loading="lazy" /> : <i className="uc-nophoto" />}
                      <span>
                        <strong>{nameOf(m.itemId)}</strong>
                        <em>
                          {m.uniform
                            ? (m.lines.length > 1 ? `${m.lines.length} cores, mesmo valor` : (m.lines[0]?.colorCode || ''))
                            : `${m.lines.length} cores · de ${brl(m.brlUnitMin)} a ${brl(m.brlUnitMax)}`}
                        </em>
                      </span>
                    </span>
                    <span className="num">{int(m.qty)}</span>
                    <span className="num strong">{brl(m.brlUnit)}{!m.uniform && <small> média</small>}</span>
                    <span className="num muted">{usd(m.usdUnit)}</span>
                    <span className="num">{brl(m.brlTotal)}</span>
                  </div>
                  {!m.uniform && m.lines.map((l, i) => (
                    <div key={i} className="uc-row uc-color" role="row">
                      <span className="uc-color-name">{l.colorCode || '—'}{!l.hasPrice && <small className="warn"> sem preço</small>}</span>
                      <span className="num">{int(l.qty)}</span>
                      <span className="num">{l.hasPrice ? brl(l.brlUnit) : '—'}</span>
                      <span className="num muted">{l.hasPrice ? usd(l.usdUnit) : '—'}</span>
                      <span className="num">{l.hasPrice ? brl(l.brlTotal) : '—'}</span>
                    </div>
                  ))}
                </div>
              )
            })}
            <div className="uc-row uc-total" role="row">
              <span>Total</span>
              <span className="num">{int(c.pieces)}</span>
              <span className="num strong">{brl(c.avgBrlUnit)}<small> média</small></span>
              <span className="num muted">{usd(c.avgUsdUnit)}</span>
              <span className="num strong">{brl(c.totalBrl)}</span>
            </div>
          </div>

          <p className="uc-how">
            <strong>Como foi calculado:</strong>{' '}
            {real
              ? <>somei tudo que foi pago em reais ({brl(c.paidBrl)}) e reparti entre as peças </>
              : <>somei o que já foi pago ({brl(c.paidBrl)}) com o que falta ({usd(c.pendingUsd)} a {rateBR(c.projRate)}) e reparti entre as peças </>}
            {c.weightBasis === 'trading' && 'na proporção do valor final que a trading passou pra cada modelo e cor.'}
            {c.weightBasis === 'fob' && 'na proporção do FOB de cada modelo e cor (a trading não detalhou o valor final por linha).'}
            {c.weightBasis === 'mixed' && 'na proporção do valor da trading — e, nas linhas sem valor da trading, do FOB × fator do pedido.'}
            {c.weightBasis === 'pieces' && 'em partes iguais, porque o pedido não tem preço por modelo.'}
            {' '}A soma da coluna Total dá exatamente {brl(c.totalBrl)}.
          </p>
        </>
      )}
    </section>
  )
}

function Notes({ c, onEditPrices }) {
  const notes = []
  const real = c.kind === 'real'

  if (c.missingPayments && c.kind === 'estimate') {
    notes.push({ sev: 'warn', text: <>O pedido está marcado como pago, mas <strong>não tem nenhum pagamento lançado</strong>. O valor acima é só uma estimativa — lance os pagamentos (data, valor em reais e câmbio) pra ter o custo real.</> })
  } else if (c.missingPayments) {
    notes.push({ sev: 'warn', text: <>O pedido está marcado como pago, mas os pagamentos lançados cobrem só <strong>{pct(c.coverage)}</strong> do valor ({usd(c.paidUsd)} de {usd(c.expectedUsd)}). Parece faltar pagamento: o que falta entrou como previsão. Lance os que faltam pra fechar o custo real.</> })
  }
  if (real && Math.abs(c.diffUsd) >= 0.01 && c.expectedUsd > 0) {
    const less = c.diffUsd < 0
    notes.push({
      sev: 'info',
      text: <>Você pagou <strong>{usd(c.paidUsd)}</strong>; {c.weightBasis === 'trading' ? 'o valor da trading era' : 'a previsão era'} {usd(c.expectedUsd)} — {usd(Math.abs(c.diffUsd))} {less ? 'a menos' : 'a mais'}. O custo acima usa o que foi <strong>realmente pago</strong>.</>,
    })
  }
  if (real && c.weightBasis !== 'trading' && c.weightBasis !== 'pieces') {
    notes.push({
      sev: 'info',
      text: <>O total está exato. A divisão entre modelos segue o FOB, porque {c.weightBasis === 'mixed' ? 'parte das linhas não tem' : 'o pedido não tem'} o valor final da trading por linha.
        {onEditPrices && <> <button type="button" className="uc-link" onClick={onEditPrices}>Lançar valores da trading</button> deixa a divisão exata também.</>}</>,
    })
  }
  if (c.weightBasis === 'pieces') {
    notes.push({ sev: 'warn', text: <>O pedido não tem preço por modelo, então todas as peças aparecem com o mesmo custo.{onEditPrices && <> <button type="button" className="uc-link" onClick={onEditPrices}>Lançar preços</button> pra separar por modelo.</>}</> })
  }
  if (c.unpricedQty > 0) {
    notes.push({
      sev: 'warn',
      text: <><strong>{c.unpricedQty.toLocaleString('pt-BR')} peças estão sem preço</strong>
        {real ? ' e ficaram fora da divisão — o custo delas caiu em cima das outras.' : ' e ainda não entram nesta previsão — o total vai ser maior.'}
        {onEditPrices && <> <button type="button" className="uc-link" onClick={onEditPrices}>Lançar preços</button></>}</>,
    })
  }
  if (c.incompletePayments > 0) {
    notes.push({ sev: 'warn', text: <>{c.incompletePayments} pagamento{c.incompletePayments !== 1 ? 's estão' : ' está'} sem o valor em reais ou sem o câmbio e não {c.incompletePayments !== 1 ? 'entraram' : 'entrou'} na conta.</> })
  }
  if (c.kind === 'partial' && !c.missingPayments && c.pendingUsd > 0.01) {
    notes.push({ sev: 'info', text: <>Já pago: {brl(c.paidBrl)} ({usd(c.paidUsd)}). Falta {usd(c.pendingUsd)}, projetado a {rateBR(c.projRate)} — o número fecha quando o pedido for quitado.</> })
  }

  if (notes.length === 0) return null
  return (
    <ul className="uc-notes">
      {notes.map((n, i) => <li key={i} className={n.sev}>{n.text}</li>)}
    </ul>
  )
}
