// src/components/FactoriesComparator.jsx
// Compara fábricas lado-a-lado em métricas relevantes pra decisão.
// Tabela: fábricas como colunas, métricas como linhas.
// Destaca a melhor fábrica em cada métrica (verde) e a pior (vermelho).

import { useState, useMemo } from 'react'
import { Modal, MH, MB } from './ui'
import { computeFactoryLeadTime, computeOrderDelay } from '../lib/pendencias'

const PERIODS = [
  { id: '3m', label: '3 meses', days: 90 },
  { id: '6m', label: '6 meses', days: 180 },
  { id: '1y', label: '1 ano', days: 365 },
  { id: 'all', label: 'Tudo', days: null },
]

export function FactoriesComparator({ factories = [], orders = [], onClose }) {
  const [period, setPeriod] = useState('1y')
  
  const data = useMemo(() => {
    return computeComparison(factories, orders, period)
  }, [factories, orders, period])
  
  return (
    <Modal onClose={onClose} width={1000} allowOutsideClose>
      <MH title="📊 Comparador de Fábricas" onClose={onClose} />
      <MB>
        {/* Filtro período */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
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
        
        {data.factories.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏭</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhuma fábrica com dados no período</div>
            <div className="text-muted" style={{ fontSize: 12 }}>Tente ampliar o período ou cadastre fábricas em "Fábricas".</div>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', minWidth: 160, fontWeight: 700 }}>MÉTRICA</th>
                    {data.factories.map(f => (
                      <th key={f.name} style={{ padding: '10px 12px', textAlign: 'center', minWidth: 130, fontWeight: 700 }}>
                        {f.name}
                        <div className="text-muted" style={{ fontSize: 10, fontWeight: 400, marginTop: 2 }}>
                          {f.totalOrders} pedido(s)
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map(metric => (
                    <ComparisonRow key={metric.key} metric={metric} factories={data.factories} />
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Legenda */}
            <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap', fontSize: 11 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, background: '#D1FAE5', borderRadius: 3 }} /> Melhor
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, background: '#FEE2E2', borderRadius: 3 }} /> Pior
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#9CA3AF' }}>—</span> Sem dados
              </span>
            </div>
            
            <div className="text-muted text-xs" style={{ marginTop: 12, textAlign: 'center' }}>
              💡 Pedidos cancelados e na lixeira não contam. "Melhor" considera contexto: prazo menor é melhor, % atraso menor é melhor, % comprovantes maior é melhor.
            </div>
          </>
        )}
      </MB>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Configuração das métricas comparadas
// ═══════════════════════════════════════════════════════════════════
const METRICS = [
  {
    key: 'totalSpent',
    label: '💰 Gasto USD',
    format: (v) => v > 0 ? `$ ${v.toFixed(2)}` : '—',
    // gasto não tem "melhor/pior" universal — não destacar
    highlight: false,
  },
  {
    key: 'avgLeadDays',
    label: '⏱ Prazo médio',
    format: (v) => v > 0 ? `${v} dias` : '—',
    highlight: 'lower-is-better',
  },
  {
    key: 'latePercent',
    label: '⚠️ % atraso',
    format: (v) => v != null ? `${v.toFixed(0)}%` : '—',
    highlight: 'lower-is-better',
  },
  {
    key: 'avgPriceUsd',
    label: '💵 Preço médio',
    format: (v) => v > 0 ? `$ ${v.toFixed(2)}` : '—',
    highlight: 'lower-is-better',
  },
  {
    key: 'completedCount',
    label: '✅ Concluídos',
    format: (v) => String(v),
    highlight: false,
  },
  {
    key: 'activeCount',
    label: '📋 Ativos agora',
    format: (v) => String(v),
    highlight: false,
  },
  {
    key: 'receiptsPercent',
    label: '📎 % comprovantes',
    format: (v) => v != null ? `${v.toFixed(0)}%` : '—',
    highlight: 'higher-is-better',
  },
]

function ComparisonRow({ metric, factories }) {
  // Determina melhor/pior pra esta métrica (entre fábricas com dado válido)
  let bestName = null, worstName = null
  if (metric.highlight) {
    const valid = factories.filter(f => f[metric.key] != null && f[metric.key] !== 0)
    if (valid.length >= 2) {  // só destaca se há comparação
      const sorted = [...valid].sort((a, b) => a[metric.key] - b[metric.key])
      if (metric.highlight === 'lower-is-better') {
        bestName = sorted[0].name
        worstName = sorted[sorted.length - 1].name
      } else {
        bestName = sorted[sorted.length - 1].name
        worstName = sorted[0].name
      }
    }
  }
  
  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{ padding: '10px 12px', fontWeight: 600, background: '#FAFAFA' }}>{metric.label}</td>
      {factories.map(f => {
        const v = f[metric.key]
        const isBest = bestName === f.name
        const isWorst = worstName === f.name
        return (
          <td key={f.name} style={{
            padding: '10px 12px',
            textAlign: 'center',
            fontWeight: isBest || isWorst ? 700 : 400,
            background: isBest ? '#D1FAE5' : (isWorst ? '#FEE2E2' : 'transparent'),
            color: v == null || v === 0 ? '#9CA3AF' : (isBest ? '#065F46' : (isWorst ? '#991B1B' : 'inherit')),
          }}>
            {metric.format(v)}
          </td>
        )
      })}
    </tr>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CÁLCULOS
// ═══════════════════════════════════════════════════════════════════
function computeComparison(factories, orders, period) {
  const periodConfig = PERIODS.find(p => p.id === period)
  const cutoff = periodConfig?.days ? new Date(Date.now() - periodConfig.days * 86400000) : null
  
  const inPeriod = (date) => {
    if (!cutoff) return true
    if (!date) return false
    const d = new Date(date)
    return !isNaN(d.getTime()) && d >= cutoff
  }
  
  // Filtra pedidos do período (e ignora cancelados)
  const filteredOrders = orders.filter(o =>
    o.status !== 'cancelled' && inPeriod(o.created_at)
  )
  
  // Lead time global (usa todo histórico, não só período — média mais estável)
  const leadTimeMap = computeFactoryLeadTime(orders)
  
  const results = []
  for (const factory of factories) {
    const factoryOrders = filteredOrders.filter(o => o.factory === factory.name)
    if (factoryOrders.length === 0) {
      // Fábrica sem pedidos no período — pula (não inclui no comparativo)
      continue
    }
    
    // Gasto total (soma USD de todos os pagamentos no período)
    let totalSpent = 0
    let priceSum = 0
    let priceCount = 0
    
    for (const o of factoryOrders) {
      for (const p of (o.payments || [])) {
        totalSpent += parseFloat(p.amount_usd) || 0
      }
      // Preço médio: média dos snapshots de items
      for (const it of (o.items || [])) {
        const sn = parseFloat(it.price_usd_snapshot || it.price_usd || 0)
        if (sn > 0) {
          priceSum += sn
          priceCount++
        }
      }
    }
    
    // Prazo médio (do mapa global)
    const lead = leadTimeMap.get(factory.name)
    
    // % de atraso (entre concluídos do período + ativos atrasados)
    const completedInPeriod = factoryOrders.filter(o => o.status === 'completed')
    let lateCount = 0
    for (const o of factoryOrders) {
      if (o.status === 'manufacturing') {
        const delay = computeOrderDelay(o, leadTimeMap)
        if (delay?.isLate) lateCount++
      }
      // Pra concluídos: comparar quanto demorou vs prazo prometido
      // v13.41 — prefere order_date (retroativa) → fallback manufacturing_started_at
      if (o.status === 'completed' && (o.order_date || o.manufacturing_started_at) && o.promised_lead_days) {
        const start = new Date(o.order_date || o.manufacturing_started_at)
        // Última entrada no histórico com status completed = data de conclusão
        const history = Array.isArray(o.status_history) ? o.status_history : []
        const compEntry = history.filter(h => h.status === 'completed').sort((a, b) => new Date(b.at) - new Date(a.at))[0]
        const completedAt = compEntry ? new Date(compEntry.at) : new Date(o.updated_at || o.created_at)
        const days = Math.floor((completedAt - start) / 86400000)
        if (days > o.promised_lead_days) lateCount++
      }
    }
    const totalConsiderableForLate = factoryOrders.filter(o => o.status === 'manufacturing' || o.status === 'completed').length
    const latePercent = totalConsiderableForLate > 0 ? (lateCount / totalConsiderableForLate) * 100 : null
    
    // % comprovantes (pagamentos com receipt_url / total de pagamentos com USD)
    let totalPayments = 0, withReceipt = 0
    for (const o of factoryOrders) {
      for (const p of (o.payments || [])) {
        if (parseFloat(p.amount_usd) > 0) {
          totalPayments++
          if (p.receipt_url) withReceipt++
        }
      }
    }
    const receiptsPercent = totalPayments > 0 ? (withReceipt / totalPayments) * 100 : null
    
    // Ativos — incluindo pedidos que já saíram da fábrica mas ainda não chegaram (in_transit)
    const activeCount = factoryOrders.filter(o =>
      o.status === 'draft' || o.status === 'sent' || o.status === 'manufacturing' || o.status === 'in_transit'
    ).length
    
    results.push({
      name: factory.name,
      totalOrders: factoryOrders.length,
      totalSpent,
      avgLeadDays: lead?.avgDays || 0,
      avgPriceUsd: priceCount > 0 ? priceSum / priceCount : 0,
      latePercent,
      completedCount: completedInPeriod.length,
      activeCount,
      receiptsPercent,
    })
  }
  
  // Ordena por gasto total (maior primeiro) — mais relevante no topo
  results.sort((a, b) => b.totalSpent - a.totalSpent)
  
  return { factories: results }
}
