// src/components/PriceHistoryChart.jsx
// v13.33 — Gráfico SVG inline de histórico de preço (sem lib externa)

import { useMemo, useState } from 'react'
import { buildProductPriceHistory, computePriceStats, computePriceTrend } from '../lib/priceHistory'
import { formatDate } from '../lib/utils'

export function PriceHistoryChart({ productId, orders }) {
  const [hoverIdx, setHoverIdx] = useState(null)
  
  const history = useMemo(
    () => buildProductPriceHistory(productId, orders),
    [productId, orders]
  )
  const stats = useMemo(() => computePriceStats(history), [history])
  const trend = useMemo(() => computePriceTrend(history), [history])
  
  if (history.length === 0) {
    return (
      <div className="card mb-md" style={{ background: 'var(--surface)' }}>
        <div className="card-title">📈 Histórico de preço</div>
        <p className="text-muted text-sm">
          Sem dados de preço ainda. Histórico aparece após primeiro pedido com este produto.
        </p>
      </div>
    )
  }
  
  // Layout SVG
  const W = 600  // viewBox width (responsive via CSS)
  const H = 200
  const PAD = { top: 20, right: 20, bottom: 30, left: 50 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  
  const minP = Math.min(...history.map(p => p.priceUsd))
  const maxP = Math.max(...history.map(p => p.priceUsd))
  // Padding visual no eixo Y (10% acima e abaixo)
  const yMin = minP - (maxP - minP) * 0.1 || minP - 1
  const yMax = maxP + (maxP - minP) * 0.1 || maxP + 1
  const yRange = yMax - yMin || 1
  
  // Pontos calculados
  const pts = history.map((p, i) => {
    const x = PAD.left + (history.length === 1 ? innerW / 2 : (i / (history.length - 1)) * innerW)
    const y = PAD.top + innerH - ((p.priceUsd - yMin) / yRange) * innerH
    return { ...p, x, y, idx: i }
  })
  
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  
  // Cores
  const trendColor = trend === 'up' ? '#EF4444' : trend === 'down' ? '#10B981' : '#6B7280'
  const trendIcon = trend === 'up' ? '↗️' : trend === 'down' ? '↘️' : '→'
  const trendLabel = trend === 'up' ? 'subindo' : trend === 'down' ? 'descendo' : trend === 'stable' ? 'estável' : 'sem dados'
  
  const hoverPoint = hoverIdx != null ? pts[hoverIdx] : null
  
  return (
    <div className="card mb-md">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📈 Histórico de preço</span>
        <span style={{ fontSize: 12, color: trendColor, fontWeight: 600 }}>
          {trendIcon} {trendLabel}
        </span>
      </div>
      
      {/* Resumo de stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: 8, marginBottom: 14,
      }}>
        <StatBox label="ATUAL" value={`$${stats.last.priceUsd.toFixed(2)}`} highlight={trendColor} />
        <StatBox label="MÉDIO" value={`$${stats.avg.toFixed(2)}`} />
        <StatBox label="MÍN" value={`$${stats.min.toFixed(2)}`} />
        <StatBox label="MÁX" value={`$${stats.max.toFixed(2)}`} />
        {stats.changePct != null && stats.count > 1 && (
          <StatBox
            label={`${stats.count} PEDIDOS`}
            value={`${stats.changePct >= 0 ? '+' : ''}${stats.changePct.toFixed(1)}%`}
            highlight={stats.changePct > 0 ? '#EF4444' : '#10B981'}
            sub="período total"
          />
        )}
      </div>
      
      {/* Alerta de aumento recente */}
      {stats.hasIncreaseAlert && (
        <div style={{
          padding: 10, marginBottom: 12,
          background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6,
          fontSize: 12, color: '#991B1B',
        }}>
          ⚠️ <strong>Alerta:</strong> último pedido subiu <strong>+{stats.lastIncreasePct.toFixed(1)}%</strong> vs o anterior.
          Cobre fábrica ou negocie antes de fazer próximo pedido.
        </div>
      )}
      
      {/* Gráfico SVG */}
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', maxHeight: 260 }}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Eixo Y — 5 linhas horizontais */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
            const y = PAD.top + innerH * (1 - t)
            const v = yMin + yRange * t
            return (
              <g key={i}>
                <line
                  x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                  stroke="var(--border)" strokeWidth="1" strokeDasharray="2,2"
                />
                <text
                  x={PAD.left - 6} y={y + 4}
                  fontSize="10" textAnchor="end" fill="var(--text-muted)"
                  fontFamily="monospace"
                >
                  ${v.toFixed(0)}
                </text>
              </g>
            )
          })}
          
          {/* Linha de tendência */}
          <path d={linePath} stroke={trendColor} strokeWidth="2" fill="none" />
          
          {/* Área sob a linha (fill suave) */}
          <path
            d={`${linePath} L ${pts[pts.length - 1].x} ${PAD.top + innerH} L ${pts[0].x} ${PAD.top + innerH} Z`}
            fill={trendColor} opacity="0.08"
          />
          
          {/* Pontos */}
          {pts.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x} cy={p.y} r={hoverIdx === i ? 6 : 4}
                fill={trendColor} stroke="var(--surface)" strokeWidth="1.5"
                style={{ cursor: 'pointer', transition: 'r 0.1s' }}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            </g>
          ))}
          
          {/* Datas no eixo X — primeiro e último apenas (evita poluir) */}
          {pts.length > 0 && (
            <>
              <text
                x={pts[0].x} y={H - 8}
                fontSize="10" textAnchor="start" fill="var(--text-muted)"
              >
                {formatDate(pts[0].date, 'short')}
              </text>
              {pts.length > 1 && (
                <text
                  x={pts[pts.length - 1].x} y={H - 8}
                  fontSize="10" textAnchor="end" fill="var(--text-muted)"
                >
                  {formatDate(pts[pts.length - 1].date, 'short')}
                </text>
              )}
            </>
          )}
        </svg>
        
        {/* Tooltip flutuante */}
        {hoverPoint && (
          <div style={{
            position: 'absolute',
            top: 0, left: `${(hoverPoint.x / W) * 100}%`,
            transform: 'translate(-50%, -100%)',
            background: 'var(--text)', color: 'var(--surface)',
            padding: '6px 10px', borderRadius: 6, fontSize: 11,
            pointerEvents: 'none', whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,.2)',
          }}>
            <div style={{ fontWeight: 700 }}>${hoverPoint.priceUsd.toFixed(2)}</div>
            <div style={{ opacity: .8 }}>{formatDate(hoverPoint.date, 'short')}</div>
            <div style={{ opacity: .7, fontSize: 10 }}>
              {hoverPoint.orderName}
              {hoverPoint.colorCode && ` · ${hoverPoint.colorCode}`}
            </div>
          </div>
        )}
      </div>
      
      <div className="text-muted text-xs" style={{ marginTop: 8, textAlign: 'center' }}>
        Dados extraídos dos snapshots de preço dos pedidos
      </div>
    </div>
  )
}

function StatBox({ label, value, highlight, sub }) {
  return (
    <div style={{
      padding: 8, background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 6,
      textAlign: 'center',
    }}>
      <div className="text-muted" style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: highlight || 'var(--text)', marginTop: 2 }}>{value}</div>
      {sub && <div className="text-muted" style={{ fontSize: 9, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
