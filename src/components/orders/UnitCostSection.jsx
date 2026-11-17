// src/components/orders/UnitCostSection.jsx
// v13.83 — "Quanto saiu cada peça" dentro do pedido.
//
// Ela pediu o valor UNITÁRIO de cada peça, não o total nem a média ("tem peça
// que é mais cara, tem peça que é mais barata"). Então o bloco é a lista:
// modelo por modelo, cor por cor, com o valor de cada uma em destaque.
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
  // 'order' = na ordem do pedido · 'desc' = mais caras primeiro
  const [sort, setSort] = useState('order')
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
  // v13.84 — pedido de marca parceira: tudo em reais (sem FOB nem dólar)
  const brl1 = c.currency === 'BRL'
  // marcado como pago mas sem (todos os) pagamentos lançados: já saiu, só não dá pra fechar
  const paidOutside = !real && c.isManuallySettled
  const title = real || paidOutside ? 'Quanto saiu cada peça' : 'Quanto vai sair cada peça'
  const tag = real ? 'Custo real · pedido quitado'
    : paidOutside ? 'Estimativa · faltam pagamentos lançados'
    : c.kind === 'partial' ? `Previsão · ${pct(Math.min(1, c.coverage ?? 0))} pago`
    : 'Previsão · nada pago ainda'
  const priceHead = real ? 'Cada peça saiu por' : paidOutside ? 'Saiu por volta de' : 'Cada peça deve sair por'

  const models = sort === 'desc' ? [...c.models].sort((x, y) => y.brlUnitMax - x.brlUnitMax) : c.models
  const linesOf = (m) => sort === 'desc' ? [...m.lines].sort((x, y) => y.brlUnit - x.brlUnit) : m.lines
  const lineLabel = (l) => l ? `${nameOf(l.itemId)}${l.colorCode ? ' · ' + l.colorCode : ''}` : ''
  const spread = !!c.cheapest && !!c.priciest && c.priciest.brlUnit - c.cheapest.brlUnit >= 0.01

  const copy = async () => {
    const rows = [brl1
      ? ['Modelo', 'Cor', 'Peças', 'Custo por peça (R$)']
      : ['Modelo', 'Cor', 'Peças', 'FOB por peça (US$)', 'Custo por peça (US$)', 'Custo por peça (R$)']]
    for (const m of models) {
      for (const l of linesOf(m)) {
        rows.push(brl1
          ? [nameOf(m.itemId), l.colorCode || '', l.qty, l.hasPrice ? formatFixedBR(l.brlUnit, 2) : '']
          : [
              nameOf(m.itemId), l.colorCode || '', l.qty,
              l.fobUnit > 0 ? formatFixedBR(l.fobUnit, 2) : '',
              l.hasPrice ? formatFixedBR(l.usdUnit, 2) : '',
              l.hasPrice ? formatFixedBR(l.brlUnit, 2) : '',
            ])
      }
    }
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
          {spread && (
            <button type="button" className="uc-btn" onClick={() => setSort(v => v === 'desc' ? 'order' : 'desc')} aria-pressed={sort === 'desc'}>
              {sort === 'desc' ? 'Ordem do pedido' : 'Mais caras primeiro'}
            </button>
          )}
          <button type="button" className="uc-btn" onClick={copy}>{copied ? 'Copiado ✓' : 'Copiar tabela'}</button>
        </div>
      </header>

      {/* A mais barata e a mais cara do pedido, de relance */}
      {spread && (
        <div className="uc-ends">
          <div>
            <span>Mais barata</span>
            <strong>{brl(c.cheapest.brlUnit)}</strong>
            <em>{lineLabel(c.cheapest)}</em>
          </div>
          <div>
            <span>Mais cara</span>
            <strong>{brl(c.priciest.brlUnit)}</strong>
            <em>{lineLabel(c.priciest)}</em>
          </div>
        </div>
      )}

      {/* Avisos: tudo que impede o número de ser exato, dito em português */}
      <Notes c={c} onEditPrices={onEditPrices} />

      {/* O valor de CADA peça: modelo por modelo, cor por cor */}
      <div className={`uc-table${brl1 ? ' brl' : ''}`} role="table">
        <div className="uc-row uc-row-head" role="row">
          <span>Peça</span>
          <span className="num">Quantas</span>
          {!brl1 && <span className="num">FOB</span>}
          {!brl1 && <span className="num">Em dólar</span>}
          <span className="num">{priceHead}</span>
        </div>
        {models.map(m => {
          const photo = photoOf(m.itemId)
          const first = m.lines[0]
          return (
            <div key={m.itemId} role="rowgroup">
              <div className="uc-row uc-model" role="row">
                <span className="uc-name">
                  {photo ? <img src={photo} alt="" loading="lazy" /> : <i className="uc-nophoto" />}
                  <span>
                    <strong>{nameOf(m.itemId)}</strong>
                    <em>
                      {m.uniform
                        ? (m.lines.length > 1 ? `${m.lines.length} cores, todas pelo mesmo valor` : (first?.colorCode || ''))
                        : `${m.lines.length} cores com valores diferentes`}
                    </em>
                  </span>
                </span>
                <span className="num">{int(m.qty)}</span>
                {m.uniform ? (
                  <>
                    {!brl1 && <span className="num muted">{first?.fobUnit > 0 ? usd(first.fobUnit) : '—'}</span>}
                    {!brl1 && <span className="num muted">{usd(m.usdUnit)}</span>}
                    <span className="num uc-price">{brl(m.brlUnit)}</span>
                  </>
                ) : brl1 ? <span /> : <><span /><span /><span /></>}
              </div>
              {!m.uniform && linesOf(m).map((l, i) => (
                <div key={i} className="uc-row uc-color" role="row">
                  <span className="uc-color-name">{l.colorCode || '—'}{!l.hasPrice && <small className="warn"> sem preço</small>}</span>
                  <span className="num">{int(l.qty)}</span>
                  {!brl1 && <span className="num muted">{l.fobUnit > 0 ? usd(l.fobUnit) : '—'}</span>}
                  {!brl1 && <span className="num muted">{l.hasPrice ? usd(l.usdUnit) : '—'}</span>}
                  <span className="num uc-price">{l.hasPrice ? brl(l.brlUnit) : '—'}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <p className="uc-how">
        <strong>Como foi calculado:</strong>{' '}
        {real
          ? <>tudo que foi pago em reais ({brl(c.paidBrl)}{c.paidRate ? `, câmbio médio de ${rateBR(c.paidRate)} em ${c.paymentsCount} pagamento${c.paymentsCount !== 1 ? 's' : ''}` : ''}) foi repartido entre as peças </>
          : brl1
            ? <>o que já foi pago ({brl(c.paidBrl)}) mais o que falta ({brl(c.pendingUsd)}) foi repartido entre as peças </>
            : <>o que já foi pago ({brl(c.paidBrl)}) mais o que falta ({usd(c.pendingUsd)} a {rateBR(c.projRate)}) foi repartido entre as peças </>}
        {brl1 && c.weightBasis !== 'pieces' && 'na proporção do preço combinado com a marca pra cada modelo e cor.'}
        {!brl1 && c.weightBasis === 'trading' && 'na proporção do valor final que a trading passou pra cada modelo e cor.'}
        {c.weightBasis === 'fob' && 'na proporção do FOB de cada modelo e cor (a trading não detalhou o valor final por linha).'}
        {c.weightBasis === 'mixed' && 'na proporção do valor da trading — e, nas linhas sem valor da trading, do FOB × fator do pedido.'}
        {c.weightBasis === 'pieces' && 'em partes iguais, porque o pedido não tem preço por modelo.'}
        {real && ` Conferência: o valor de cada peça × a quantidade, somando as ${int(c.pieces)} peças, dá exatamente o que foi pago.`}
        {c.realMultiplier ? ` No fim, cada peça custou ×${formatFixedBR(c.realMultiplier, 2)} o FOB da fábrica.` : ''}
      </p>
    </section>
  )
}

function Notes({ c, onEditPrices }) {
  const notes = []
  const real = c.kind === 'real'
  const brl1 = c.currency === 'BRL'
  const money = brl1 ? brl : usd

  if (c.missingPayments && c.kind === 'estimate') {
    notes.push({ sev: 'warn', text: <>O pedido está marcado como pago, mas <strong>não tem nenhum pagamento lançado</strong>. Os valores abaixo são só uma estimativa — lance os pagamentos (data, valor em reais e câmbio) pra ter o custo real de cada peça.</> })
  } else if (c.missingPayments) {
    notes.push({ sev: 'warn', text: <>O pedido está marcado como pago, mas os pagamentos lançados cobrem só <strong>{pct(c.coverage)}</strong> do valor ({money(c.paidUsd)} de {money(c.expectedUsd)}). Parece faltar pagamento: o que falta entrou como previsão. Lance os que faltam pra fechar o custo real.</> })
  }
  if (real && Math.abs(c.diffUsd) >= 0.01 && c.expectedUsd > 0) {
    const less = c.diffUsd < 0
    notes.push({
      sev: 'info',
      text: <>Você pagou <strong>{money(c.paidUsd)}</strong>; {brl1 ? 'o combinado com a marca era' : c.weightBasis === 'trading' ? 'o valor da trading era' : 'a previsão era'} {money(c.expectedUsd)} — {money(Math.abs(c.diffUsd))} {less ? 'a menos' : 'a mais'}. Os valores abaixo usam o que foi <strong>realmente pago</strong>.</>,
    })
  }
  if (real && !brl1 && c.weightBasis !== 'trading' && c.weightBasis !== 'pieces') {
    notes.push({
      sev: 'info',
      text: <>O valor de cada peça segue a proporção do FOB, porque {c.weightBasis === 'mixed' ? 'parte das linhas não tem' : 'o pedido não tem'} o valor final da trading por linha.
        {onEditPrices && <> <button type="button" className="uc-link" onClick={onEditPrices}>Lançar valores da trading</button> deixa o valor de cada peça exato.</>}</>,
    })
  }
  if (c.weightBasis === 'pieces') {
    notes.push({ sev: 'warn', text: <>O pedido não tem preço por modelo, então todas as peças aparecem com o mesmo custo.{onEditPrices && <> <button type="button" className="uc-link" onClick={onEditPrices}>Lançar preços</button> pra separar por modelo.</>}</> })
  }
  if (c.unpricedQty > 0) {
    notes.push({
      sev: 'warn',
      text: <><strong>{c.unpricedQty.toLocaleString('pt-BR')} peças estão sem preço</strong>
        {real ? ' e ficaram fora da divisão — o custo delas caiu em cima das outras.' : ' e ainda não entram nesta previsão.'}
        {onEditPrices && <> <button type="button" className="uc-link" onClick={onEditPrices}>Lançar preços</button></>}</>,
    })
  }
  if (c.incompletePayments > 0) {
    notes.push({ sev: 'warn', text: <>{c.incompletePayments} pagamento{c.incompletePayments !== 1 ? 's estão' : ' está'} sem o valor em reais ou sem o câmbio e não {c.incompletePayments !== 1 ? 'entraram' : 'entrou'} na conta.</> })
  }
  if (c.kind === 'partial' && !c.missingPayments && c.pendingUsd > 0.01) {
    notes.push({ sev: 'info', text: brl1
      ? <>Já pago: {brl(c.paidBrl)}. Falta {brl(c.pendingUsd)} — os valores fecham quando o pedido for quitado.</>
      : <>Já pago: {brl(c.paidBrl)} ({usd(c.paidUsd)}). Falta {usd(c.pendingUsd)}, projetado a {rateBR(c.projRate)} — os valores fecham quando o pedido for quitado.</> })
  }

  if (notes.length === 0) return null
  return (
    <ul className="uc-notes">
      {notes.map((n, i) => <li key={i} className={n.sev}>{n.text}</li>)}
    </ul>
  )
}
