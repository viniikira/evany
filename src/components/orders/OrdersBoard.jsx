// src/components/orders/OrdersBoard.jsx
// v13.81 — Lista de pedidos, visual refeito com referência em painéis
// profissionais de pedidos:
//   • Shopify (lista de pedidos): ABAS com contagem + BUSCA no topo + tabela
//     compacta com etiqueta de situação.
//   • Linear: UMA lista só, com cabeçalhos de grupo finos (não uma tabela
//     separada por etapa, cada uma repetindo o cabeçalho).
//   • Stripe: números alinhados, cor só onde significa algo.
//
// Ela disse: "ainda tá feio, ruim de ver, confuso — e a forma de encontrar".
// Então: os 5 cartões grandes viraram abas; entrou busca por pedido, fábrica,
// modelo ou cor; "Precisa de você" ficou compacto (3 itens + ver todos);
// pagamento sem barra cinza vazia; concluídos ficam numa aba própria.
//
// Estilos em styles/orders-board.css (prefixo ob-).

import { useEffect, useMemo, useRef, useState } from 'react'
import { groupOrdersByStage, buildAttention, sortOrders, ORDER_STAGES } from '../../lib/orderSort'
import { computeOrderBalance } from '../../lib/financial'
import { computeOrderDelay } from '../../lib/pendencias'
import { formatDate, parseDateLocal } from '../../lib/utils'
import { ArrivalEditor } from './ArrivalEditor'
import '../../styles/orders-board.css'

const STAGE_VAR = {
  draft: 'var(--st-draft)', sent: 'var(--st-sent)', manufacturing: 'var(--st-mfg)',
  in_transit: 'var(--st-transit)', completed: 'var(--st-done)', cancelled: 'var(--st-draft)',
}
// Abas: "Em andamento" (padrão) junta tudo que ainda não chegou
export const ORDER_TABS = [
  { id: 'active', label: 'Em andamento', match: (o) => o.status !== 'completed' && o.status !== 'cancelled' },
  ...ORDER_STAGES.map(s => ({ id: s.id, label: s.label, match: (o) => (o.status === 'cancelled' ? 'completed' : o.status) === s.id })),
  { id: 'all', label: 'Todos', match: () => true },
]
const DAY = 86400000
const usd = (n) => 'US$ ' + Math.round(n || 0).toLocaleString('pt-BR')
const brl = (n) => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR')
const today = () => new Date(new Date().toDateString()).getTime()
const plural = (n, s, p) => `${n.toLocaleString('pt-BR')} ${n === 1 ? s : p}`

const piecesOf = (o) => (o.items || []).reduce((a, it) => a + (it.colors || []).reduce((b, c) => b + (Number(c.qty) || 0), 0), 0)
const colorsOf = (o) => (o.items || []).reduce((a, it) => a + (it.colors || []).filter(c => Number(c.qty) > 0).length, 0)

// Busca sem acento e sem diferença de maiúscula; todas as palavras precisam bater
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
function searchText(o, productsById, colorName) {
  const parts = [o.order_name, o.factory, o.notes]
  for (const it of (o.items || [])) {
    const p = productsById.get(it.product_id)
    parts.push(it.name_manual, p?.name, p?.sku, it.product_name_snapshot)
    for (const c of (it.colors || [])) {
      if (!(Number(c.qty) > 0)) continue
      parts.push(c.code, colorName.get(c.code))
    }
  }
  return norm(parts.filter(Boolean).join(' '))
}

export function OrdersBoard({
  orders = [], products = [], colors = [], perm = {}, rate, leadTimeByFactory = new Map(),
  sortMode = 'smart', tab = 'active', onTab, actions = null,
  onOpen, onArrivalSave, onMarkArrived,
}) {
  const ctx = { rate, leadTimeByFactory }
  const showPrices = !!perm.prices
  const productsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const colorName = useMemo(() => new Map(colors.map(c => [c.code, c.name_pt || c.name])), [colors])

  // ── Busca ("/" foca a busca, Esc limpa)
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const haystack = useMemo(() => new Map(orders.map(o => [o.id, searchText(o, productsById, colorName)])), [orders, productsById, colorName])
  const terms = norm(query).split(/\s+/).filter(Boolean)
  const searched = terms.length === 0 ? orders : orders.filter(o => terms.every(t => haystack.get(o.id)?.includes(t)))

  // ── Abas
  const activeTab = ORDER_TABS.find(t => t.id === tab) || ORDER_TABS[0]
  const tabOrders = searched.filter(activeTab.match)

  // ── Precisa de você (o que tem problema, só da aba atual)
  const attentionAll = useMemo(() => buildAttention(orders, ctx), [orders, rate, leadTimeByFactory])
  const flagged = useMemo(() => {
    const m = new Map()
    for (const a of attentionAll) {
      if (a.severity === 'low') continue
      if (m.get(a.order.id) !== 'high') m.set(a.order.id, a.severity)
    }
    return m
  }, [attentionAll])
  const tabIds = new Set(tabOrders.map(o => o.id))
  const attention = attentionAll.filter(a => tabIds.has(a.order.id))
  const [showAllAttn, setShowAllAttn] = useState(false)

  // ── Lista
  const grouped = groupOrdersByStage(tabOrders, ctx)
  const flat = sortMode === 'smart' ? null : sortOrders(tabOrders, sortMode, ctx)
  const [doneOpen, setDoneOpen] = useState(false)

  // ── Resumo da aba
  const summary = (() => {
    let pieces = 0, remUsd = 0, remBrl = 0, nextArrival = null
    for (const o of tabOrders) {
      pieces += piecesOf(o)
      if (o.status !== 'draft') {
        const b = computeOrderBalance(o, rate)
        if (!b.isSettled && b.remainingUsd > 0) { remUsd += b.remainingUsd; remBrl += b.remainingBrl || 0 }
      }
      if (o.status === 'in_transit') {
        const t = parseDateLocal(o.expected_arrival)?.getTime()
        if (t != null && (!nextArrival || t < nextArrival.t)) nextArrival = { t, o }
      }
    }
    return { pieces, remUsd, remBrl, nextArrival }
  })()

  const rowProps = { productsById, showPrices, leadTimeByFactory, flagged, rate, onOpen, onArrivalSave, onMarkArrived }
  const attnVisible = showAllAttn ? attention : attention.slice(0, 3)

  return (
    <div className="ob">
      {/* Abas */}
      <nav className="ob-tabs" role="tablist" aria-label="Etapas do pedido">
        {ORDER_TABS.map(t => {
          const n = searched.filter(t.match).length
          const hasFlag = t.id !== 'all' && t.id !== 'active' && searched.some(o => t.match(o) && flagged.has(o.id))
          const on = t.id === activeTab.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`ob-tab${on ? ' on' : ''}${n === 0 ? ' zero' : ''}`}
              onClick={() => onTab && onTab(t.id)}
            >
              {STAGE_VAR[t.id] && <i className="ob-dot" style={{ '--stage': STAGE_VAR[t.id] }} />}
              {t.label}
              <span className="ob-tab-n">{n}</span>
              {hasFlag && <span className="ob-tab-flag" title="Tem pedido aqui que precisa de você" />}
            </button>
          )
        })}
      </nav>

      {/* Busca + ações */}
      <div className="ob-bar">
        <label className="ob-search">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden><path fill="currentColor" d="M8.5 3a5.5 5.5 0 0 1 4.38 8.82l3.65 3.65a.75.75 0 1 1-1.06 1.06l-3.65-3.65A5.5 5.5 0 1 1 8.5 3Zm0 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /></svg>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
            placeholder="Buscar pedido, fábrica, modelo ou cor"
            aria-label="Buscar pedidos"
          />
          {query ? <button type="button" className="ob-search-x" onClick={() => setQuery('')} aria-label="Limpar busca">×</button> : <kbd>/</kbd>}
        </label>
        <div className="ob-bar-actions">{actions}</div>
      </div>

      {/* Resumo da aba numa linha */}
      {tabOrders.length > 0 && (
        <div className="ob-summary">
          <span><strong>{plural(tabOrders.length, 'pedido', 'pedidos')}</strong> · {plural(summary.pieces, 'peça', 'peças')}</span>
          {showPrices && summary.remUsd > 0.5 && (
            <span>Falta pagar <strong>{usd(summary.remUsd)}</strong>{summary.remBrl > 0 && <em> ≈ {brl(summary.remBrl)}</em>}</span>
          )}
          {summary.nextArrival && (() => {
            const d = Math.round((summary.nextArrival.t - today()) / DAY)
            const name = summary.nextArrival.o.order_name || summary.nextArrival.o.factory
            return (
              <span>Próxima chegada <strong>{name}</strong>{' '}
                <em className={d < 0 ? 'bad' : ''}>{d < 0 ? `venceu há ${d * -1} dias` : d === 0 ? 'hoje' : `em ${d} dias`}</em>
              </span>
            )
          })()}
        </div>
      )}

      {/* Precisa de você */}
      {terms.length === 0 && attention.length > 0 && (
        <section className="ob-attn" aria-label="Precisa de você">
          <header>
            <h3>Precisa de você</h3>
            <span className="ob-pill bad">{attention.length}</span>
          </header>
          <ul>
            {attnVisible.map(a => (
              <li key={a.id} className={`sev-${a.severity}`}>
                <i className="ob-sev" aria-hidden />
                <button type="button" className="ob-attn-text" onClick={() => onOpen && onOpen(a.order)}>
                  <strong>{a.name}</strong>
                  <span>{a.title}</span>
                </button>
                <div className="ob-attn-actions">
                  {a.actions.includes('arrived') && onMarkArrived && (
                    <button type="button" className="ob-btn good" onClick={() => onMarkArrived(a.order)}>Chegou</button>
                  )}
                  {a.actions.includes('arrival') && onArrivalSave && (
                    <ArrivalEditor
                      value={a.order.expected_arrival || ''}
                      overdue={a.kind === 'arrival_overdue'}
                      label={a.order.expected_arrival ? 'Mudar previsão' : 'Definir previsão'}
                      onSave={(d) => onArrivalSave(a.order, d)}
                    />
                  )}
                  {a.actions.includes('open') && (
                    <button type="button" className="ob-link" onClick={() => onOpen && onOpen(a.order)}>Abrir →</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {attention.length > 3 && (
            <button type="button" className="ob-attn-more" onClick={() => setShowAllAttn(v => !v)}>
              {showAllAttn ? 'Mostrar menos' : `Ver todos (${attention.length})`}
            </button>
          )}
        </section>
      )}

      {/* Lista */}
      {tabOrders.length === 0 ? (
        <div className="ob-empty">
          {terms.length > 0 ? (
            <>
              Nenhum pedido {activeTab.id === 'all' ? '' : `em “${activeTab.label}” `}com “{query}”.
              {searched.length > 0 && activeTab.id !== 'all' && (
                <> <button type="button" className="ob-link" onClick={() => onTab && onTab('all')}>Procurar em todos</button></>
              )}
              {' '}<button type="button" className="ob-link" onClick={() => setQuery('')}>Limpar busca</button>
            </>
          ) : `Nenhum pedido em “${activeTab.label}”.`}
        </div>
      ) : (
        <div className={`ob-table${showPrices ? '' : ' no-pay'}`} role="table">
          <div className="ob-row ob-head" role="row">
            <span role="columnheader">Pedido</span>
            <span role="columnheader" className="num">Peças</span>
            <span role="columnheader">Andamento</span>
            {showPrices && <span role="columnheader">Pagamento</span>}
            <span />
          </div>
          {flat ? (
            flat.map(o => <OrderRow key={o.id} order={o} showStage {...rowProps} />)
          ) : (
            grouped.stages.filter(st => st.orders.length > 0).map(st => {
              const single = activeTab.id === st.id
              const collapsible = st.collapsedByDefault && !single && terms.length === 0
              const open = !collapsible || doneOpen
              return (
                <div key={st.id} role="rowgroup">
                  {!single && (
                    <div
                      className={`ob-group${collapsible ? ' toggle' : ''}`}
                      style={{ '--stage': STAGE_VAR[st.id] }}
                      onClick={collapsible ? () => setDoneOpen(v => !v) : undefined}
                      role={collapsible ? 'button' : undefined}
                      aria-expanded={collapsible ? open : undefined}
                    >
                      <i className="ob-dot" />
                      <strong>{st.label}</strong>
                      <span className="ob-group-n">{st.orders.length}</span>
                      <span className="ob-group-hint">{st.hint}</span>
                      <span className="ob-group-meta">
                        {plural(st.pieces, 'peça', 'peças')}
                        {showPrices && st.id !== 'draft' && st.remainingUsd > 0.5 && <> · falta {usd(st.remainingUsd)}</>}
                        {collapsible && <span className="ob-group-toggle">{open ? 'Recolher' : 'Mostrar'}</span>}
                      </span>
                    </div>
                  )}
                  {open && st.orders.map(o => <OrderRow key={o.id} order={o} {...rowProps} />)}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

function OrderRow({ order: o, productsById, showPrices, rate, leadTimeByFactory, flagged, showStage = false, onOpen, onArrivalSave, onMarkArrived }) {
  const thumbs = []
  for (const it of (o.items || [])) {
    const p = productsById.get(it.product_id)
    const url = p?.card_image_url || (p?.photos || [])[0] || null
    if (url && !thumbs.includes(url)) thumbs.push(url)
  }
  const nModels = (o.items || []).length
  const pieces = piecesOf(o)
  const nColors = colorsOf(o)
  const stageId = o.status === 'cancelled' ? 'completed' : o.status
  const stage = ORDER_STAGES.find(s => s.id === stageId)
  const flag = flagged.get(o.id)
  const date = o.order_date || o.created_at

  return (
    <div
      className={`ob-row${flag ? ` flag-${flag}` : ''}`}
      role="row"
      tabIndex={0}
      onClick={() => onOpen && onOpen(o)}
      onKeyDown={(e) => { if (e.key === 'Enter' && onOpen) onOpen(o) }}
    >
      <div className="ob-order" role="cell">
        <div className="ob-thumbs" aria-hidden>
          {thumbs.slice(0, 3).map((u, i) => <img key={i} src={u} alt="" loading="lazy" />)}
          {thumbs.length === 0 && <span className="ob-thumb-empty" />}
        </div>
        <div className="ob-name">
          <strong>{o.order_name || <>{o.factory} <em>· sem nome</em></>}</strong>
          <span>
            {showStage && stage && <span className="ob-stage-tag" style={{ '--stage': STAGE_VAR[stageId] }}>{stage.label}</span>}
            {o.factory}
            {date && <> · {formatDate(date, 'full')}</>}
            {' · '}{plural(nModels, 'modelo', 'modelos')}
          </span>
        </div>
      </div>

      <div className="ob-pieces num" role="cell">
        <strong>{pieces.toLocaleString('pt-BR')}</strong>
        <span>{plural(nColors, 'cor', 'cores')}</span>
      </div>

      <div className="ob-progress-cell" role="cell" onClick={(e) => e.stopPropagation()}>
        <Timing order={o} leadTimeByFactory={leadTimeByFactory} onArrivalSave={onArrivalSave} onMarkArrived={onMarkArrived} />
      </div>

      {showPrices && <div className="ob-pay" role="cell"><Payment order={o} rate={rate} /></div>}

      <svg className="ob-chev" viewBox="0 0 20 20" width="16" height="16" aria-hidden><path fill="currentColor" d="M7.47 4.97a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06L11.44 10 7.47 6.03a.75.75 0 0 1 0-1.06Z" /></svg>
    </div>
  )
}

// Coluna "Andamento": o que importa muda conforme a etapa
function Timing({ order: o, leadTimeByFactory, onArrivalSave, onMarkArrived }) {
  const arrivalMs = parseDateLocal(o.expected_arrival)?.getTime() ?? null
  const daysToArrival = arrivalMs != null ? Math.round((arrivalMs - today()) / DAY) : null
  const editor = onArrivalSave && (o.status === 'manufacturing' || o.status === 'in_transit')
    ? <ArrivalEditor value={o.expected_arrival || ''} overdue={daysToArrival != null && daysToArrival < 0} onSave={(d) => onArrivalSave(o, d)} />
    : null

  if (o.status === 'draft') return <span className="ob-muted">Ainda não foi pra fábrica</span>

  if (o.status === 'sent') {
    const h = [...(o.status_history || [])].reverse().find(x => x?.status === 'sent')
    const since = h?.at ? new Date(h.at).getTime() : (parseDateLocal(o.created_at)?.getTime() ?? null)
    const d = since ? Math.floor((Date.now() - since) / DAY) : null
    return (
      <span className={d >= 30 ? 'ob-warn' : 'ob-text'}>
        {d != null ? `Esperando confirmação há ${d} ${d === 1 ? 'dia' : 'dias'}` : 'Esperando confirmação'}
      </span>
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
        <span className={d.isLate ? 'ob-bad' : 'ob-text'}>
          {d.isLate ? `Atrasado ${d.daysLate} dias` : `Dia ${d.daysElapsed} de ${d.deadlineDays}`}
        </span>
        <div className="ob-meter" title={`${d.daysElapsed} de ${d.deadlineDays} dias de prazo`}>
          <i style={{ width: `${pct}%`, background: d.isLate ? 'var(--bad)' : 'var(--st-mfg)' }} />
        </div>
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
            <button type="button" className="ob-btn good" onClick={() => onMarkArrived(o)}>Chegou</button>
          )}
        </div>
      </>
    )
  }

  const done = [...(o.status_history || [])].reverse().find(x => x?.status === 'completed')
  return <span className="ob-muted">{done ? `Chegou em ${formatDate(done.at, 'full')}` : (o.status === 'cancelled' ? 'Cancelado' : 'Concluído')}</span>
}

// Coluna "Pagamento": quanto falta em destaque; barra só quando já pagou algo
function Payment({ order: o, rate }) {
  const b = computeOrderBalance(o, rate)
  if (b.isManuallySettled || (b.isSettled && b.total > 0)) return <span className="ob-pill good">Quitado</span>
  if (!(b.total > 0)) return <span className="ob-muted">Sem preço ainda</span>
  const pct = Math.max(0, Math.min(100, Math.round(b.percentPaid)))
  return (
    <>
      <span className="ob-text">
        <strong>falta {usd(b.remainingUsd)}</strong>
        {b.remainingBrl > 0 && <span className="ob-muted"> ≈ {brl(b.remainingBrl)}</span>}
      </span>
      {pct > 0 && <div className="ob-meter pay" title={`${pct}% pago`}><i style={{ width: `${pct}%` }} /></div>}
      <span className="ob-muted">
        {pct > 0 ? `${pct}% pago de ${usd(b.total)}` : `nada pago de ${usd(b.total)}`}
        {!b.isFullyConfirmed && <span className="ob-tag" title="Total calculado pelo FOB × fator — a trading ainda não lançou os valores finais">estimado</span>}
      </span>
      {b.unpricedQty > 0 && <span className="ob-tag warn">{plural(b.unpricedQty, 'peça', 'peças')} sem preço</span>}
    </>
  )
}
