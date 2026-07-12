// src/pages/Financeiro.jsx
// Tela Financeira completa (substitui FinancialModal) — 5 sub-abas.
// Toda lógica de cálculo está em lib/financial.js (testável e reusada).
//
// Sub-abas:
//   visao-geral  — resumo executivo, métricas top, atalhos
//   pagamentos   — lista filtrada de TODOS os pagamentos
//   cambio       — análise de eficiência cambial
//   analise      — top fábricas, atrasados, comprovantes
//   projecoes    — cashflow futuro (30/60/90+ dias)

import { useEffect, useState, useMemo } from 'react'
import { listOrders } from '../lib/data/orders'
import { SkeletonList } from '../components/ui'
import { ExchangeRateAlert } from '../components/ExchangeRateAlert'
import { formatDate } from '../lib/utils'
import { log } from '../lib/logger'
import {
  flattenPayments, filterPaymentsByPeriod, computeAvgRate, computeTotals,
  computeRateComparison, topFactoriesByGasto, computeUnpaidOrders,
  computeMissingReceipts, computeMonthlyTrend, computeCashflowProjection, sumRemaining,
} from '../lib/financial'

const TABS = [
  { id: 'visao-geral', label: 'Visão Geral', icon: '📊' },
  { id: 'pagamentos',  label: 'Pagamentos',  icon: '💸' },
  { id: 'cambio',      label: 'Câmbio',      icon: '💱' },
  { id: 'analise',     label: 'Análise',     icon: '🔍' },
  { id: 'projecoes',   label: 'Projeções',   icon: '🔮' },
]

const PERIODS = [
  { id: '7d', label: '7 dias', days: 7 },
  { id: '30d', label: '30 dias', days: 30 },
  { id: '90d', label: '90 dias', days: 90 },
  { id: '1y', label: '1 ano', days: 365 },
  { id: 'all', label: 'Tudo', days: null },
]

export function FinanceiroPage({ perm, onOrderClick }) {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  // Tab vem da URL via search param (?tab=...) pra preservar ao recarregar
  const initialTab = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('tab') || 'visao-geral')
    : 'visao-geral'
  const [tab, setTab] = useState(TABS.find(t => t.id === initialTab) ? initialTab : 'visao-geral')
  const [period, setPeriod] = useState('30d')
  
  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const os = await listOrders()
        setOrders(os || [])
      } catch (e) { log.error(e) }
      setLoading(false)
    })()
  }, [])
  
  // Sincroniza tab → URL (history replace, sem recarregar)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', tab)
    window.history.replaceState({}, '', url.toString())
  }, [tab])
  
  // Pagamentos achatados (mesma lista pra todas as abas)
  // IMPORTANTE: hooks (useMemo) devem vir ANTES de qualquer early return,
  // senão o número de hooks chamados muda entre renders e quebra o React.
  const allPayments = useMemo(() => flattenPayments(orders), [orders])
  // Pagamentos do período selecionado
  const periodCfg = PERIODS.find(p => p.id === period)
  const periodPayments = useMemo(
    () => filterPaymentsByPeriod(allPayments, periodCfg?.days),
    [allPayments, periodCfg]
  )
  
  if (!perm.prices) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🔒</div>
        <p>Sem permissão pra ver dados financeiros.</p>
      </div>
    )
  }
  
  if (loading) {
    return <div><SkeletonList rows={6} /></div>
  }
  
  return (
    <div>
      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 14, borderBottom: '2px solid var(--border)',
        overflowX: 'auto', paddingBottom: 0,
      }}>
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: `3px solid ${active ? 'var(--primary)' : 'transparent'}`,
                color: active ? 'var(--primary)' : '#6B7280',
                fontWeight: active ? 700 : 500,
                fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                marginBottom: -2,
              }}
            >
              {t.icon} {t.label}
            </button>
          )
        })}
      </div>
      
      {/* Filtro de período (visível em todas as abas exceto Pagamentos que tem o seu) */}
      {tab !== 'pagamentos' && tab !== 'projecoes' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="text-muted text-xs" style={{ marginRight: 4 }}>Período:</span>
          {PERIODS.map(p => (
            <button
              key={p.id}
              className={`chip-filter${period === p.id ? ' on' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      
      {tab === 'visao-geral' && <TabVisaoGeral orders={orders} payments={periodPayments} period={periodCfg} setTab={setTab} onOrderClick={onOrderClick} />}
      {tab === 'pagamentos' && <TabPagamentos allPayments={allPayments} orders={orders} onOrderClick={onOrderClick} />}
      {tab === 'cambio' && <TabCambio allPayments={allPayments} payments={periodPayments} period={periodCfg} />}
      {tab === 'analise' && <TabAnalise orders={orders} payments={periodPayments} onOrderClick={onOrderClick} />}
      {tab === 'projecoes' && <TabProjecoes orders={orders} onOrderClick={onOrderClick} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ABA VISÃO GERAL — métricas top + atalhos
// ═══════════════════════════════════════════════════════════════════
function TabVisaoGeral({ orders, payments, period, setTab, onOrderClick }) {
  const totals = computeTotals(payments)
  const avgRate = computeAvgRate(payments)
  const unpaid = computeUnpaidOrders(orders)
  const missing = computeMissingReceipts(orders)
  const totalUnpaidUsd = sumRemaining(unpaid)
  const criticalCount = unpaid.filter(u => u.isCritical).length
  
  if (payments.length === 0 && period.days !== null) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>💸</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Sem pagamentos no período selecionado</div>
        <div className="text-muted" style={{ fontSize: 12 }}>Tente ampliar o período pra ver dados anteriores.</div>
      </div>
    )
  }
  
  return (
    <div>
      {/* v13.44 — Alerta contextual de câmbio (só aparece se anômalo) */}
      <ExchangeRateAlert />
      {/* Cards de métrica */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 18 }}>
        <Metric label="GASTO USD" value={`$ ${totals.usd.toFixed(2)}`} sub={`${payments.length} pagamento(s)`} color="#059669" />
        <Metric label="GASTO BRL" value={`R$ ${totals.brl.toFixed(2)}`} sub={avgRate > 0 ? `câmbio médio R$ ${avgRate.toFixed(4)}` : 'sem câmbio registrado'} color="#7c3aed" />
        <Metric
          label="SALDO ABERTO"
          value={`$ ${totalUnpaidUsd.toFixed(2)}`}
          sub={`${unpaid.length} pedido(s)${criticalCount > 0 ? ` · ${criticalCount} crítico(s)` : ''}`}
          color={criticalCount > 0 ? '#DC2626' : '#0891B2'}
        />
        <Metric
          label="COMPROVANTES"
          value={missing.paymentsCount > 0 ? `${missing.paymentsCount} faltam` : 'OK'}
          sub={missing.paymentsCount > 0 ? `em ${missing.ordersCount} pedido(s)` : 'todos os pagamentos têm comprovante'}
          color={missing.paymentsCount > 0 ? '#F59E0B' : '#059669'}
        />
      </div>
      
      {/* Atalhos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 18 }}>
        <Shortcut icon="💸" title="Ver todos pagamentos" desc="Lista filtrada com ordenação" onClick={() => setTab('pagamentos')} />
        <Shortcut icon="💱" title="Análise de câmbio" desc="Comparativos e tendências" onClick={() => setTab('cambio')} />
        <Shortcut icon="🔍" title="Onde tenho pendências" desc="Atrasados e comprovantes faltando" onClick={() => setTab('analise')} />
        <Shortcut icon="🔮" title="O que preciso pagar" desc="Próximos 30/60/90 dias" onClick={() => setTab('projecoes')} />
      </div>
      
      {/* Top 3 pendências críticas (resumo) */}
      {criticalCount > 0 && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 8,
          padding: 14, marginBottom: 14,
        }}>
          <strong style={{ color: '#991B1B', display: 'block', marginBottom: 6 }}>
            🚨 {criticalCount} pedido(s) concluído(s) com pagamento incompleto
          </strong>
          <div style={{ fontSize: 12, color: '#991B1B' }}>
            Você já recebeu a mercadoria mas ainda deve à fábrica. Veja em "Análise" ou "Projeções".
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ABA PAGAMENTOS — lista de TODOS os pagamentos com filtros
// ═══════════════════════════════════════════════════════════════════
function TabPagamentos({ allPayments, orders, onOrderClick }) {
  const [search, setSearch] = useState('')
  const [factoryFilter, setFactoryFilter] = useState('all')
  const [bankFilter, setBankFilter] = useState('all')
  const [receiptFilter, setReceiptFilter] = useState('all')  // all/com/sem
  const [periodFilter, setPeriodFilter] = useState('all')
  const [sortBy, setSortBy] = useState('date-desc')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 30
  
  // Lista de fábricas e bancos pra dropdowns
  const factories = useMemo(() => {
    const set = new Set()
    for (const p of allPayments) if (p._factory) set.add(p._factory)
    return Array.from(set).sort()
  }, [allPayments])
  
  const banks = useMemo(() => {
    const set = new Set()
    for (const p of allPayments) if (p.bank) set.add(p.bank)
    return Array.from(set).sort()
  }, [allPayments])
  
  // Aplica filtros + busca
  const filtered = useMemo(() => {
    let result = allPayments
    
    // Período
    const periodCfg = PERIODS.find(p => p.id === periodFilter)
    if (periodCfg?.days) {
      result = filterPaymentsByPeriod(result, periodCfg.days)
    }
    
    // Fábrica
    if (factoryFilter !== 'all') {
      result = result.filter(p => p._factory === factoryFilter)
    }
    
    // Banco
    if (bankFilter !== 'all') {
      result = result.filter(p => p.bank === bankFilter)
    }
    
    // Comprovante
    if (receiptFilter === 'com') result = result.filter(p => p.receipt_url)
    if (receiptFilter === 'sem') result = result.filter(p => !p.receipt_url)
    
    // Busca livre (nome do pedido / fábrica / banco)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(p =>
        (p._orderName || '').toLowerCase().includes(q)
        || (p._factory || '').toLowerCase().includes(q)
        || (p.bank || '').toLowerCase().includes(q)
      )
    }
    
    // Ordenação
    const sorted = [...result]
    if (sortBy === 'date-desc') sorted.sort((a, b) => new Date(b.payment_date || b.created_at) - new Date(a.payment_date || a.created_at))
    if (sortBy === 'date-asc') sorted.sort((a, b) => new Date(a.payment_date || a.created_at) - new Date(b.payment_date || b.created_at))
    if (sortBy === 'usd-desc') sorted.sort((a, b) => (parseFloat(b.amount_usd) || 0) - (parseFloat(a.amount_usd) || 0))
    if (sortBy === 'usd-asc') sorted.sort((a, b) => (parseFloat(a.amount_usd) || 0) - (parseFloat(b.amount_usd) || 0))
    if (sortBy === 'factory') sorted.sort((a, b) => (a._factory || '').localeCompare(b._factory || ''))
    
    return sorted
  }, [allPayments, search, factoryFilter, bankFilter, receiptFilter, periodFilter, sortBy])
  
  // Reset página ao mudar filtro
  useEffect(() => { setPage(1) }, [search, factoryFilter, bankFilter, receiptFilter, periodFilter, sortBy])
  
  // Paginação
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  
  const totals = computeTotals(filtered)
  
  const handleClick = (p) => {
    const order = orders.find(o => o.id === p._orderId)
    if (order) onOrderClick?.(order)
  }
  
  return (
    <div>
      {/* Filtros */}
      <div style={{
        background: '#F8FAFC', border: '1px solid var(--border-light)', borderRadius: 8,
        padding: 12, marginBottom: 12,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8,
      }}>
        <input
          className="field field-sm"
          placeholder="🔍 Buscar..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="field field-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}>
          <option value="all">Todo o tempo</option>
          {PERIODS.filter(p => p.id !== 'all').map(p => (
            <option key={p.id} value={p.id}>Últimos {p.label}</option>
          ))}
        </select>
        <select className="field field-sm" value={factoryFilter} onChange={e => setFactoryFilter(e.target.value)}>
          <option value="all">Todas fábricas</option>
          {factories.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="field field-sm" value={bankFilter} onChange={e => setBankFilter(e.target.value)}>
          <option value="all">Todos bancos</option>
          {banks.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className="field field-sm" value={receiptFilter} onChange={e => setReceiptFilter(e.target.value)}>
          <option value="all">Com ou sem comprovante</option>
          <option value="com">Apenas com comprovante</option>
          <option value="sem">Apenas SEM comprovante</option>
        </select>
        <select className="field field-sm" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="date-desc">Mais recente primeiro</option>
          <option value="date-asc">Mais antigo primeiro</option>
          <option value="usd-desc">Maior USD primeiro</option>
          <option value="usd-asc">Menor USD primeiro</option>
          <option value="factory">Por fábrica (A-Z)</option>
        </select>
      </div>
      
      {/* Resumo do filtro atual */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10, flexWrap: 'wrap', gap: 8, fontSize: 12,
      }}>
        <span><strong>{filtered.length}</strong> de {allPayments.length} pagamento(s)</span>
        <span>
          Total: <strong style={{ color: '#059669' }}>$ {totals.usd.toFixed(2)}</strong>
          {totals.brl > 0 && <> · <strong style={{ color: '#7c3aed' }}>R$ {totals.brl.toFixed(2)}</strong></>}
        </span>
      </div>
      
      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <p>Nenhum pagamento com esse filtro.</p>
        </div>
      ) : (
        <>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {pageItems.map(p => (
              <PaymentRow key={p.id} payment={p} onClick={() => handleClick(p)} />
            ))}
          </div>
          
          {/* Paginação */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <button className="btn btn-outline btn-sm" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>← Anterior</button>
              <span className="text-muted text-sm">Página {page} de {totalPages}</span>
              <button className="btn btn-outline btn-sm" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Próxima →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PaymentRow({ payment: p, onClick }) {
  const usd = parseFloat(p.amount_usd) || 0
  const brl = parseFloat(p.amount_brl) || 0
  const rate = brl > 0 && usd > 0 ? brl / usd : 0
  
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-light)',
        display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
        cursor: 'pointer',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {p._orderName || p._factory}
          {!p.receipt_url && (
            <span style={{ marginLeft: 6, fontSize: 10, color: '#F59E0B', fontWeight: 500 }}>
              📎 sem comprovante
            </span>
          )}
        </div>
        <div className="text-muted" style={{ fontSize: 11 }}>
          {p._factory && p._orderName !== p._factory && `${p._factory} · `}
          {formatDate(p.payment_date || p.created_at, 'short')}
          {p.bank && ` · ${p.bank}`}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#059669' }}>$ {usd.toFixed(2)}</div>
        {brl > 0 && (
          <div className="text-muted" style={{ fontSize: 10 }}>
            R$ {brl.toFixed(2)}{rate > 0 && ` · R$ ${rate.toFixed(4)}/$`}
          </div>
        )}
      </div>
      <div style={{ color: '#9CA3AF', fontSize: 14 }}>›</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ABA CÂMBIO — análise cambial
// ═══════════════════════════════════════════════════════════════════
function TabCambio({ allPayments, payments, period }) {
  const avgPeriod = computeAvgRate(payments)
  const avgAll = computeAvgRate(allPayments)
  const comparison = computeRateComparison(allPayments, period?.days)
  const trend = computeMonthlyTrend(allPayments, 12)
  
  // Gráfico simples SVG: câmbio médio por mês
  const chart = useMemo(() => {
    if (trend.length < 2) return null
    const rates = trend.map(t => t.usd > 0 ? t.brl / t.usd : 0).filter(r => r > 0)
    if (rates.length === 0) return null
    const validTrend = trend.filter(t => t.usd > 0 && t.brl > 0).map(t => ({ ...t, rate: t.brl / t.usd }))
    if (validTrend.length < 2) return null
    return validTrend
  }, [trend])
  
  return (
    <div>
      {/* Cards comparativos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Metric
          label={`CÂMBIO MÉDIO (${period?.label || 'período'})`}
          value={avgPeriod > 0 ? `R$ ${avgPeriod.toFixed(4)}` : '—'}
          sub={`${payments.length} pagamento(s)`}
          color="#7c3aed"
        />
        <Metric
          label="CÂMBIO MÉDIO HISTÓRICO"
          value={avgAll > 0 ? `R$ ${avgAll.toFixed(4)}` : '—'}
          sub={`${allPayments.length} pagamento(s) totais`}
          color="#0891B2"
        />
      </div>
      
      {/* Comparação */}
      {comparison && (
        <div style={{
          background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 8,
          padding: 14, marginBottom: 16, fontSize: 13,
        }}>
          <strong>💱 Variação vs período anterior</strong>
          <div style={{ marginTop: 6 }}>
            Atual: <strong>R$ {comparison.current.toFixed(4)}</strong>
            {' · Anterior: '}
            <strong>R$ {comparison.previous.toFixed(4)}</strong>
            {' · '}
            <strong style={{ color: comparison.variation > 0 ? '#DC2626' : '#059669' }}>
              {comparison.variation > 0 ? '↑' : '↓'} {Math.abs(comparison.variation).toFixed(1)}%
            </strong>
          </div>
          {comparison.variation > 5 && (
            <div style={{ marginTop: 6, color: '#991B1B' }}>
              ⚠️ Real desvalorizou. Considere revisar precificação dos produtos.
            </div>
          )}
          {comparison.variation < -5 && (
            <div style={{ marginTop: 6, color: '#065F46' }}>
              ✨ Real valorizou. Bom momento pra quitar pedidos atrasados.
            </div>
          )}
        </div>
      )}
      
      {/* Gráfico de evolução */}
      {chart && chart.length >= 2 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <strong style={{ display: 'block', marginBottom: 10, fontSize: 13 }}>📈 Evolução do câmbio médio mensal</strong>
          <RateChart data={chart} />
          <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
            Cada ponto = média ponderada do mês (BRL pago / USD pago)
          </div>
        </div>
      )}
      
      {(!chart || chart.length < 2) && allPayments.length > 0 && (
        <div className="text-muted" style={{ fontSize: 12, padding: 10 }}>
          📊 Gráfico de evolução requer pelo menos 2 meses com pagamentos completos (USD + BRL).
        </div>
      )}
    </div>
  )
}

// Mini gráfico SVG do câmbio
function RateChart({ data }) {
  const W = 600
  const H = 160
  const PAD = 30
  const rates = data.map(d => d.rate)
  const min = Math.min(...rates) * 0.98
  const max = Math.max(...rates) * 1.02
  const range = max - min || 1
  
  const x = (i) => PAD + (i / Math.max(1, data.length - 1)) * (W - 2 * PAD)
  const y = (rate) => H - PAD - ((rate - min) / range) * (H - 2 * PAD)
  
  const points = data.map((d, i) => `${x(i)},${y(d.rate)}`).join(' ')
  
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, height: 'auto' }}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#E5E7EB" />
        <polyline points={points} fill="none" stroke="#7c3aed" strokeWidth="2" />
        {data.map((d, i) => (
          <g key={d.month}>
            <circle cx={x(i)} cy={y(d.rate)} r="4" fill="#7c3aed" />
            <title>{d.month}: R$ {d.rate.toFixed(4)} ({d.count} pgto)</title>
          </g>
        ))}
        <text x={PAD} y={H - 5} fontSize="10" fill="#6B7280">{data[0].month}</text>
        <text x={W - PAD} y={H - 5} fontSize="10" fill="#6B7280" textAnchor="end">{data[data.length - 1].month}</text>
        <text x={5} y={y(max) + 4} fontSize="10" fill="#6B7280">R$ {max.toFixed(2)}</text>
        <text x={5} y={y(min) + 4} fontSize="10" fill="#6B7280">R$ {min.toFixed(2)}</text>
      </svg>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ABA ANÁLISE — top fábricas, atrasados, comprovantes
// ═══════════════════════════════════════════════════════════════════
function TabAnalise({ orders, payments, onOrderClick }) {
  const top = topFactoriesByGasto(payments, 5)
  const unpaid = computeUnpaidOrders(orders)
  const missing = computeMissingReceipts(orders)
  
  return (
    <div>
      {/* Top fábricas */}
      <Section title={`🏆 Top 5 fábricas por gasto USD (${payments.length} pagamento(s))`}>
        {top.length === 0 ? (
          <div className="text-muted text-sm" style={{ padding: 10 }}>Sem pagamentos no período.</div>
        ) : (
          <div style={{ background: '#FAF8F6', borderRadius: 6, padding: 8 }}>
            {top.map((f, i) => (
              <FactoryRow key={f.factory} factory={f} maxValue={top[0].totalUsd} rank={i + 1} />
            ))}
          </div>
        )}
      </Section>
      
      {/* Pedidos não pagos */}
      <Section title={`⚠️ Pedidos com pagamento incompleto (${unpaid.length})`}>
        {unpaid.length === 0 ? (
          <div className="text-muted text-sm" style={{ padding: 10 }}>✓ Tudo em dia!</div>
        ) : (
          <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6 }}>
            {unpaid.slice(0, 10).map(u => (
              <UnpaidOrderRow key={u.id} order={u} onClick={() => {
                const fullOrder = orders.find(o => o.id === u.id)
                if (fullOrder) onOrderClick?.(fullOrder)
              }} />
            ))}
            {unpaid.length > 10 && (
              <div className="text-muted" style={{ padding: 8, fontSize: 11, textAlign: 'center' }}>
                +{unpaid.length - 10} pedido(s). Veja todos em "Projeções".
              </div>
            )}
          </div>
        )}
      </Section>
      
      {/* Comprovantes faltando */}
      {missing.paymentsCount > 0 && (
        <Section title="📎 Comprovantes faltando">
          <div style={{
            background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6,
            padding: 12, fontSize: 13, color: '#78350F',
          }}>
            <strong>{missing.paymentsCount} pagamento(s)</strong> em <strong>{missing.ordersCount} pedido(s)</strong> sem comprovante anexado.
            <div style={{ marginTop: 6, fontSize: 11 }}>
              💡 Use o filtro "Apenas SEM comprovante" na aba Pagamentos pra ver e corrigir.
            </div>
          </div>
        </Section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ABA PROJEÇÕES — cashflow futuro
// ═══════════════════════════════════════════════════════════════════
function TabProjecoes({ orders, onOrderClick }) {
  const buckets = useMemo(() => computeCashflowProjection(orders), [orders])
  
  const renderBucket = (title, items, accent) => {
    if (items.length === 0) return null
    const totalUsd = sumRemaining(items)
    return (
      <Section title={`${title} · ${items.length} pedido(s) · $ ${totalUsd.toFixed(2)}`}>
        <div style={{ background: 'var(--surface)', border: `1px solid ${accent}40`, borderLeft: `4px solid ${accent}`, borderRadius: 6 }}>
          {items.map(u => (
            <UnpaidOrderRow key={u.id} order={u} onClick={() => {
              const fullOrder = orders.find(o => o.id === u.id)
              if (fullOrder) onOrderClick?.(fullOrder)
            }} />
          ))}
        </div>
      </Section>
    )
  }
  
  const total = sumRemaining([...buckets.next30d, ...buckets.next60d, ...buckets.next90d, ...buckets.beyond, ...buckets.noDate])
  
  if (total === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✨</div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhum saldo aberto</div>
        <div className="text-muted" style={{ fontSize: 12 }}>Todos os pedidos ativos estão totalmente pagos.</div>
      </div>
    )
  }
  
  return (
    <div>
      <div style={{
        background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8,
        padding: 14, marginBottom: 16, fontSize: 13,
      }}>
        <strong>💼 Total a pagar:</strong> $ {total.toFixed(2)} em {buckets.next30d.length + buckets.next60d.length + buckets.next90d.length + buckets.beyond.length + buckets.noDate.length} pedido(s)
        <div style={{ marginTop: 4, fontSize: 11, color: '#1E40AF' }}>
          💡 Pedidos concluídos sem pagar e sem data de chegada vão pra "próximos 30 dias" / "sem data" respectivamente.
        </div>
      </div>
      
      {renderBucket('🔥 Próximos 30 dias', buckets.next30d, '#DC2626')}
      {renderBucket('⏱ Próximos 60 dias', buckets.next60d, '#F59E0B')}
      {renderBucket('📅 Próximos 90 dias', buckets.next90d, '#0891B2')}
      {renderBucket('🌅 Mais de 90 dias', buckets.beyond, '#6B7280')}
      {renderBucket('❓ Sem data de chegada', buckets.noDate, '#9CA3AF')}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SUBCOMPONENTES COMPARTILHADOS
// ═══════════════════════════════════════════════════════════════════
function Metric({ label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: `2px solid ${color}30`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 8,
      padding: 12,
    }}>
      <div className="text-muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Shortcut({ icon, title, desc, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
        padding: 12, cursor: 'pointer', transition: 'all .2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = '' }}
    >
      <div style={{ fontSize: 24, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{desc}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="field-label" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

function FactoryRow({ factory, maxValue, rank }) {
  const widthPercent = maxValue > 0 ? (factory.totalUsd / maxValue) * 100 : 0
  return (
    <div style={{ padding: '8px 4px', borderBottom: '1px solid #E5E7EB' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>#{rank} {factory.factory}</strong>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>$ {factory.totalUsd.toFixed(2)}</span>
      </div>
      <div style={{ height: 6, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
        <div style={{ height: '100%', width: `${widthPercent}%`, background: '#7c3aed', transition: 'width .3s' }} />
      </div>
      <div className="text-muted" style={{ fontSize: 10 }}>
        {factory.totalBrl > 0 && `R$ ${factory.totalBrl.toFixed(2)} · `}
        {factory.paymentsCount} pagamento(s)
      </div>
    </div>
  )
}

function UnpaidOrderRow({ order, onClick }) {
  const bgColor = order.isCritical ? '#FEE2E2' : 'transparent'
  const textColor = order.isCritical ? '#991B1B' : '#92400E'
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 10px',
        borderBottom: '1px solid #FDE68A',
        background: bgColor,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: textColor }}>
          {order.isCritical && '🚨 '}{order.order_name}
          {order.isCritical && <span style={{ fontSize: 10, marginLeft: 6, fontWeight: 400 }}>(CONCLUÍDO mas pgto incompleto)</span>}
        </div>
        <div className="text-muted" style={{ fontSize: 11 }}>
          {order.factory} · {formatDate(order.created_at, 'short')} · {order.percentPaid.toFixed(0)}% pago
          {order.expected_arrival && ` · chegada: ${formatDate(order.expected_arrival, 'short')}`}
        </div>
      </div>
      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: textColor }}>$ {order.remaining.toFixed(2)}</div>
        <div className="text-muted" style={{ fontSize: 10 }}>de $ {order.fobTotal.toFixed(2)}</div>
      </div>
    </div>
  )
}
