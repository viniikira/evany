// src/components/orders/OrdersBoard.jsx
// v13.76 — Lista de pedidos redesenhada do zero.
//
// O que ela pediu: "o que está em revisão está junto do trânsito, da
// fabricação… fontes feias, cores feias, não está inteligente".
//
// Estrutura (de cima pra baixo):
//   1. ETAPAS — uma faixa com o ciclo do pedido. Cada etapa mostra quantos
//      pedidos, quantas peças e quanto falta pagar. Clicar filtra.
//   2. PRECISA DE VOCÊ — os problemas escritos em português, com o botão que
//      resolve ali mesmo (mudar previsão, marcar que chegou, abrir).
//   3. UMA TABELA POR ETAPA — linhas alinhadas, então dá pra comparar prazo e
//      pagamento entre pedidos de relance. Concluídos ficam recolhidos.
//
// Visual: Inter, fundo neutro, uma cor discreta por etapa (o ponto), vermelho
// só pra problema real. Estilos em main.css com prefixo ob-.

import { useMemo, useState } from 'react'
import { groupOrdersByStage, buildAttention, ORDER_STAGES } from '../../lib/orderSort'
import { computeOrderBalance } from '../../lib/financial'
import { computeOrderDelay } from '../../lib/pendencias'
import { formatDate, parseDateLocal } from '../../lib/utils'
import { ArrivalEditor } from './ArrivalEditor'
import '../../styles/orders-board.css'

const STAGE_VAR = {
  draft: 'var(--st-draft)', sent: 'var(--st-sent)', manufacturing: 'var(--st-mfg)',
  in_transit: 'var(--st-transit)', completed: 'var(--st-done)',
}
const DAY = 86400000
const usd = (n) => 'US$ ' + Math.round(n || 0).toLocaleString('pt-BR')
const brl = (n) => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR')
const today = () => new Date(new Date().toDateString()).getTime()

const piecesOf = (o) => (o.items || []).reduce((a, it) => a + (it.colors || []).reduce((b, c) => b + (Number(c.qty) || 0), 0), 0)
const colorsOf = (o) => (o.items || []).reduce((a, it) => a + (it.colors || []).filter(c => Number(c.qty) > 0).length, 0)

export function OrdersBoard({
  orders = [], products = [], perm = {}, rate, leadTimeByFactory = new Map(),
  mode = 'stage', flatOrders = null, stageFilter = 'all', onStageFilter,
  onOpen, onArrivalSave, onMarkArrived,
}) {
  const ctx = { rate, leadTimeByFactory }
  const grouped = useMemo(() => groupOrdersByStage(orders, ctx), [orders, rate, leadTimeByFactory])
  const attention = useMemo(() => buildAttention(orders, ctx), [orders, rate, leadTimeByFactory])
  const [showDone, setShowDone] = useState(false)
  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  // Nível de alerta por pedido (o mais grave dele): alto = vermelho, médio = âmbar
  const flagged = useMemo(() => {
    const m = new Map()
    for (const a of attention) {
      if (a.severity === 'low') continue
      if (m.get(a.order.id) !== 'high') m.set(a.order.id, a.severity)
    }
    return m
  }, [attention])
  // Contagem por etapa a partir do MESMO painel de atenção (antes vinha de outra regra)
  const flagsByStage = useMemo(() => {
    const m = new Map()
    for (const [id] of flagged) {
      const o = orders.find(x => x.id === id)
      const st = o?.status === 'cancelled' ? 'completed' : o?.status
      if (st) m.set(st, (m.get(st) || 0) + 1)
    }
    return m
  }, [flagged, orders])

  const showPrices = !!perm.prices
  const rowProps = { productsById, showPrices, rate, leadTimeByFactory, flagged, onOpen, onArrivalSave, onMarkArrived }

  const visibleStages = grouped.stages.filter(st =>
    st.orders.length > 0 && (stageFilter === 'all' || stageFilter === st.id))

  return (
    <div className="ob">
      {/* 1. Etapas */}
      <div className="ob-pipe" role="tablist" aria-label="Etapas do pedido">
        {grouped.stages.map(st => {
          const active = stageFilter === st.id
          return (
            <button
              key={st.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`ob-stage${active ? ' active' : ''}${st.orders.length === 0 ? ' empty' : ''}`}
              style={{ '--stage': STAGE_VAR[st.id] }}
              onClick={() => onStageFilter && onStageFilter(active ? 'all' : st.id)}
              title={active ? 'Mostrar todas as etapas' : `Ver só ${st.label.toLowerCase()}`}
            >
              <span className="ob-stage-label"><i className="ob-dot" />{st.label}</span>
              <span className="ob-stage-count">{st.orders.length}</span>
              <span className="ob-stage-meta">
                {st.orders.length === 0 ? 'nenhum pedido' : `${st.pieces.toLocaleString('pt-BR')} peças`}
              </span>
              {showPrices && st.id !== 'draft' && st.remainingUsd > 0.5 && (
                <span className="ob-stage-meta">falta {usd(st.remainingUsd)}</span>
              )}
              {flagsByStage.get(st.id) > 0 && <span className="ob-stage-flag" title="Pedidos desta etapa que precisam de você">{flagsByStage.get(st.id)}</span>}
            </button>
          )
        })}
      </div>

      {/* 2. Precisa de você */}
      {attention.length > 0 && stageFilter === 'all' && mode === 'stage' && (
        <section className="ob-panel" aria-label="Precisa de você">
          <header className="ob-panel-head">
            <h3>Precisa de você</h3>
            <span className="ob-count-bad">{attention.length}</span>
          </header>
          <ul className="ob-attn">
            {attention.map(a => (
              <li key={a.id} className={`ob-attn-row sev-${a.severity}`}>
                <i className="ob-sev" aria-hidden />
                <button type="button" className="ob-attn-text" onClick={() => onOpen && onOpen(a.order)}>
                  <strong>{a.name}</strong>
                  <span>{a.title}</span>
                </button>
                <div className="ob-attn-actions">
                  {a.actions.includes('arrived') && onMarkArrived && (
                    <button type="button" className="ob-btn ob-btn-good" onClick={() => onMarkArrived(a.order)}>Chegou</button>
                  )}
                  {a.actions.includes('arrival') && onArrivalSave && (
                    <ArrivalEditor
                      value={a.order.expected_arrival || ''}
                      overdue={a.kind === 'arrival_overdue'}
                      compact
                      label={a.order.expected_arrival ? 'Mudar previsão' : 'Definir previsão'}
                      onSave={(d) => onArrivalSave(a.order, d)}
                    />
                  )}
                  {a.actions.includes('open') && (
                    <button type="button" className="ob-btn" onClick={() => onOpen && onOpen(a.order)}>Abrir</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. Tabelas */}
      {mode === 'stage' ? (
        visibleStages.length === 0 ? (
          <div className="ob-empty">Nenhum pedido nesta etapa.</div>
        ) : visibleStages.map(st => {
          const collapsed = st.collapsedByDefault && !showDone && stageFilter !== st.id
          return (
            <section key={st.id} className="ob-section" style={{ '--stage': STAGE_VAR[st.id] }}>
              <header className="ob-section-head">
                <i className="ob-dot" />
                <h3>{st.label}</h3>
                <span className="ob-section-count">{st.orders.length}</span>
                <span className="ob-section-hint">{st.hint}</span>
                <span className="ob-section-meta">
                  {st.pieces.toLocaleString('pt-BR')} peças
                  {showPrices && st.id !== 'draft' && st.remainingUsd > 0.5 && <> · falta {usd(st.remainingUsd)}</>}
                </span>
                {st.collapsedByDefault && stageFilter !== st.id && (
                  <button type="button" className="ob-btn" onClick={() => setShowDone(v => !v)}>
                    {collapsed ? `Mostrar ${st.orders.length}` : 'Recolher'}
                  </button>
                )}
              </header>
              {!collapsed && <OrdersTable orders={st.orders} {...rowProps} />}
            </section>
          )
        })
      ) : (
        <OrdersTable orders={flatOrders || orders} showStage {...rowProps} />
      )}
    </div>
  )
}

function OrdersTable({ orders, showStage = false, ...rowProps }) {
  return (
    <div className={`ob-table${rowProps.showPrices ? '' : ' no-pay'}`}>
      <div className="ob-row ob-row-head" aria-hidden>
        <span />
        <span>Pedido</span>
        <span className="num">Peças</span>
        <span>Prazo e chegada</span>
        {rowProps.showPrices && <span>Pagamento</span>}
        <span />
      </div>
      {orders.map(o => <OrderRow key={o.id} order={o} showStage={showStage} {...rowProps} />)}
    </div>
  )
}

function OrderRow({ order: o, productsById, showPrices, rate, leadTimeByFactory, flagged, showStage, onOpen, onArrivalSave, onMarkArrived }) {
  const thumbs = []
  for (const it of (o.items || [])) {
    const p = productsById.get(it.product_id)
    const url = p?.card_image_url || (p?.photos || [])[0] || null
    if (url && !thumbs.includes(url)) thumbs.push(url)
  }
  const nModels = (o.items || []).length
  const pieces = piecesOf(o)
  const nColors = colorsOf(o)
  const stage = ORDER_STAGES.find(s => s.id === o.status)

  return (
    <div
      className={`ob-row${flagged.get(o.id) ? ` flagged-${flagged.get(o.id)}` : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen && onOpen(o)}
      onKeyDown={(e) => { if (e.key === 'Enter' && onOpen) onOpen(o) }}
    >
      <div className="ob-thumbs" aria-hidden>
        {thumbs.slice(0, 3).map((u, i) => <img key={i} src={u} alt="" loading="lazy" />)}
        {thumbs.length === 0 && <span className="ob-thumb-empty" />}
        {nModels > 3 && <span className="ob-thumb-more">+{nModels - 3}</span>}
      </div>

      <div className="ob-name">
        <strong>{o.order_name || <>{o.factory} <em>sem nome</em></>}</strong>
        <span>
          {showStage && stage && <><i className="ob-dot" style={{ '--stage': STAGE_VAR[o.status] }} />{stage.label} · </>}
          {o.factory}
          {(o.order_date || o.created_at) && <> · pedido {formatDate(o.order_date || o.created_at, 'full')}</>}
        </span>
      </div>

      <div className="ob-pieces num">
        <strong>{pieces.toLocaleString('pt-BR')}</strong>
        <span>{nModels} modelo{nModels !== 1 ? 's' : ''} · {nColors} cor{nColors !== 1 ? 'es' : ''}</span>
      </div>

      <div className="ob-timing" onClick={(e) => e.stopPropagation()}>
        <Timing order={o} leadTimeByFactory={leadTimeByFactory} onArrivalSave={onArrivalSave} onMarkArrived={onMarkArrived} />
      </div>

      {showPrices && <div className="ob-pay"><Payment order={o} rate={rate} /></div>}

      <span className="ob-chev" aria-hidden>›</span>
    </div>
  )
}

// Coluna "Prazo e chegada": o que importa muda conforme a etapa
function Timing({ order: o, leadTimeByFactory, onArrivalSave, onMarkArrived }) {
  const arrivalMs = parseDateLocal(o.expected_arrival)?.getTime() ?? null
  const daysToArrival = arrivalMs != null ? Math.round((arrivalMs - today()) / DAY) : null
  const editor = onArrivalSave && (o.status === 'manufacturing' || o.status === 'in_transit')
    ? <ArrivalEditor value={o.expected_arrival || ''} overdue={daysToArrival != null && daysToArrival < 0} compact onSave={(d) => onArrivalSave(o, d)} />
    : null

  if (o.status === 'draft') return <span className="ob-muted">Ainda não enviado</span>

  if (o.status === 'sent') {
    const h = [...(o.status_history || [])].reverse().find(x => x?.status === 'sent')
    const since = h?.at ? new Date(h.at).getTime() : (parseDateLocal(o.created_at)?.getTime() ?? null)
    const d = since ? Math.floor((Date.now() - since) / DAY) : null
    return (
      <>
        <span className={d >= 30 ? 'ob-bad' : 'ob-text'}>{d != null ? `Esperando revisão há ${d} dias` : 'Em revisão'}</span>
        {editor}
      </>
    )
  }

  if (o.status === 'manufacturing') {
    const d = computeOrderDelay(o, leadTimeByFactory)
    if (!d || d.deadlineDays == null) {
      return (
        <>
          <span className="ob-warn">{d?.source === 'legacy_no_start_date' ? 'Sem data de início' : 'Sem prazo definido'}</span>
          {editor}
        </>
      )
    }
    const pct = Math.min(100, Math.round((d.daysElapsed / d.deadlineDays) * 100))
    return (
      <>
        <div className="ob-progress" title={`${d.daysElapsed} de ${d.deadlineDays} dias`}>
          <i style={{ width: `${pct}%`, background: d.isLate ? 'var(--bad)' : (pct >= 80 ? 'var(--st-mfg)' : 'var(--st-mfg)') }} />
        </div>
        <span className={d.isLate ? 'ob-bad' : 'ob-text'}>
          {d.isLate ? `Atrasado ${d.daysLate} dias` : `Dia ${d.daysElapsed} de ${d.deadlineDays}`}
        </span>
        {editor}
      </>
    )
  }

  if (o.status === 'in_transit') {
    const overdue = daysToArrival != null && daysToArrival < 0
    return (
      <>
        <span className={overdue ? 'ob-bad' : 'ob-text'}>
          {daysToArrival == null ? 'Sem previsão de chegada'
            : overdue ? `Previsão venceu há ${-daysToArrival} dias`
            : daysToArrival === 0 ? 'Chega hoje'
            : `Chega em ${daysToArrival} dias`}
        </span>
        <div className="ob-inline">
          {editor}
          {overdue && onMarkArrived && (
            <button type="button" className="ob-btn ob-btn-good" onClick={() => onMarkArrived(o)}>Chegou</button>
          )}
        </div>
      </>
    )
  }

  // concluído
  const done = [...(o.status_history || [])].reverse().find(x => x?.status === 'completed')
  return <span className="ob-muted">{done ? `Chegou em ${formatDate(done.at, 'full')}` : 'Concluído'}</span>
}

// Coluna "Pagamento": barra + quanto falta (USD e BRL)
function Payment({ order: o, rate }) {
  const b = computeOrderBalance(o, rate)
  if (b.isManuallySettled || (b.isSettled && b.total > 0)) {
    return <span className="ob-good">Quitado</span>
  }
  if (!(b.total > 0)) return <span className="ob-muted">Sem preço</span>
  const pct = Math.max(0, Math.min(100, Math.round(b.percentPaid)))
  return (
    <>
      <div className="ob-progress pay" title={`${pct}% pago`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="ob-text">
        <strong>falta {usd(b.remainingUsd)}</strong>
        {b.remainingBrl > 0 && <span className="ob-muted"> · {brl(b.remainingBrl)}</span>}
      </span>
      <span className="ob-muted">
        {pct}% de {usd(b.total)}{!b.isFullyConfirmed && ' (estimado)'}
        {b.unpricedQty > 0 && <span className="ob-warn"> · {b.unpricedQty} pç sem preço</span>}
      </span>
    </>
  )
}

