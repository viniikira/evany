// src/pages/Analytics.jsx
// v13.31 — Tela de métricas de uso (admin only)
// 3 abas: Pageviews · Ações · Funil

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SkeletonList, useToast } from '../components/ui'
import { toastError } from '../lib/errors'
import { formatDate } from '../lib/utils'

export default function AnalyticsPage({ perm }) {
  const [tab, setTab] = useState('pages')
  
  if (!perm.admin) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Sem permissão (admin only).</p></div>
  
  return <div>
    <div className="chip-bar" style={{ marginBottom: 20 }}>
      <button className={`chip-filter${tab === 'pages' ? ' on' : ''}`} onClick={() => setTab('pages')}>
        📊 Páginas
      </button>
      <button className={`chip-filter${tab === 'actions' ? ' on' : ''}`} onClick={() => setTab('actions')}>
        ⚡ Ações
      </button>
      <button className={`chip-filter${tab === 'funnel' ? ' on' : ''}`} onClick={() => setTab('funnel')}>
        🎯 Funil
      </button>
    </div>
    
    {tab === 'pages' && <PagesTab />}
    {tab === 'actions' && <ActionsTab />}
    {tab === 'funnel' && <FunnelTab />}
  </div>
}

// ═══════════════════════════════════════════════════════════════════
// Pageviews — quais telas mais usadas, tempo médio
// ═══════════════════════════════════════════════════════════════════
function PagesTab() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('v_analytics_pages').select('*')
        if (error) throw error
        setData(data || [])
      } catch (e) { toastError(toast, e) }
      setLoading(false)
    })()
  }, [])
  
  if (loading) return <SkeletonList rows={5} />
  if (data.length === 0) return <EmptyState text="Sem dados de pageview ainda. Use o sistema por uns dias." />
  
  const maxViews = Math.max(...data.map(d => d.views_count))
  
  return <div className="card">
    <div className="card-title">📊 Páginas mais usadas (últimos 30 dias)</div>
    <table className="data-table">
      <thead>
        <tr>
          <th>Página</th>
          <th>Visualizações</th>
          <th>Usuários únicos</th>
          <th>Tempo médio</th>
          <th>Última visita</th>
        </tr>
      </thead>
      <tbody>
        {data.map(row => (
          <tr key={row.page}>
            <td><strong>{row.page}</strong></td>
            <td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: `${(row.views_count / maxViews) * 100}%`,
                  height: 8, background: 'var(--primary)',
                  borderRadius: 4, minWidth: 20,
                }} />
                <span>{row.views_count}</span>
              </div>
            </td>
            <td>{row.unique_users}</td>
            <td>{row.avg_seconds ? `${row.avg_seconds}s` : '—'}</td>
            <td className="text-muted text-sm">{formatDate(row.last_view, 'with-time')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
}

// ═══════════════════════════════════════════════════════════════════
// Actions — quais features mais usadas
// ═══════════════════════════════════════════════════════════════════
function ActionsTab() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('v_analytics_actions').select('*')
        if (error) throw error
        setData(data || [])
      } catch (e) { toastError(toast, e) }
      setLoading(false)
    })()
  }, [])
  
  if (loading) return <SkeletonList rows={5} />
  if (data.length === 0) return <EmptyState text="Sem ações registradas ainda." />
  
  return <div className="card">
    <div className="card-title">⚡ Ações mais executadas (últimos 30 dias)</div>
    <table className="data-table">
      <thead>
        <tr>
          <th>Ação</th>
          <th>Execuções</th>
          <th>Usuários únicos</th>
          <th>Última execução</th>
        </tr>
      </thead>
      <tbody>
        {data.map(row => (
          <tr key={row.event_name}>
            <td><code>{row.event_name}</code></td>
            <td><strong>{row.executions}</strong></td>
            <td>{row.unique_users}</td>
            <td className="text-muted text-sm">{formatDate(row.last_execution, 'with-time')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
}

// ═══════════════════════════════════════════════════════════════════
// Funnel — ideia → produto → pedido → completed
// ═══════════════════════════════════════════════════════════════════
function FunnelTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.from('v_analytics_funnel').select('*').single()
        if (error) throw error
        setData(data)
      } catch (e) { toastError(toast, e) }
      setLoading(false)
    })()
  }, [])
  
  if (loading) return <SkeletonList rows={4} />
  if (!data) return <EmptyState text="Sem dados de funil." />
  
  const stages = [
    { label: '💡 Ideias ativas', value: data.ideias_ativas, color: '#8B5CF6' },
    { label: '🔄 Convertidas em produto', value: data.ideias_convertidas, color: '#3B82F6', pct: data.pct_ideia_to_produto, fromPrev: 'das ideias' },
    { label: '📦 Com pelo menos 1 pedido', value: data.produtos_pedidos, color: '#F59E0B', pct: data.pct_produto_to_pedido, fromPrev: 'dos convertidos' },
    { label: '✅ Com pedido concluído', value: data.produtos_completados, color: '#10B981', pct: data.pct_pedido_to_completed, fromPrev: 'dos com pedido' },
  ]
  const max = stages[0].value || 1
  
  return <div className="card">
    <div className="card-title">🎯 Funil ideia → produto → pedido</div>
    <p className="text-muted text-sm mb-md">Mostra quantas ideias chegam até virar venda. Use pra entender onde está o gargalo.</p>
    
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {stages.map((s, i) => (
        <div key={s.label || `stage-${i}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <strong style={{ color: s.color }}>{s.label}</strong>
            <span>
              <strong style={{ fontSize: 18 }}>{s.value}</strong>
              {s.pct != null && (
                <span className="text-muted text-sm" style={{ marginLeft: 8 }}>
                  ({s.pct}% {s.fromPrev})
                </span>
              )}
            </span>
          </div>
          <div style={{
            width: `${(s.value / max) * 100}%`,
            height: 24, background: s.color, borderRadius: 4, minWidth: 4,
            transition: 'width .3s',
          }} />
        </div>
      ))}
    </div>
    
    <div style={{ marginTop: 20, padding: 12, background: '#EFF6FF', borderRadius: 6, fontSize: 12, color: '#1E40AF' }}>
      <strong>Como ler:</strong> Cada barra é menor que a anterior — isso é normal e mostra "afunilamento". O gargalo está entre 2 estágios consecutivos onde a queda é maior. Métrica saudável: pelo menos 30% sobrevive cada estágio.
    </div>
  </div>
}

function EmptyState({ text }) {
  return <div className="empty-state">
    <div className="empty-icon">📊</div>
    <p>{text}</p>
  </div>
}
