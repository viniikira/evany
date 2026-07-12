// src/components/ExchangeRateAlert.jsx
// v13.44 — Widget discreto que mostra alerta de câmbio contextualmente.
//
// Renderiza APENAS se há anomalia (low/high). Em 'normal' retorna null — sem barulho.
// Pode ser colocado em qualquer tela; é autônomo.

import { useExchangeRateAnomaly } from '../hooks/useExchangeRateAnomaly'
import { useUsdRate } from '../lib/hooks'

export function ExchangeRateAlert({ compact = false }) {
  const rate = useUsdRate()
  const anomaly = useExchangeRateAnomaly(rate)

  if (anomaly.status !== 'low' && anomaly.status !== 'high') return null

  const isLow = anomaly.status === 'low'
  const bg = isLow ? '#ECFDF5' : '#FFFBEB'
  const border = isLow ? '#A7F3D0' : '#FDE68A'
  const color = isLow ? '#065F46' : '#78350F'
  const icon = isLow ? '💚' : '⚠️'

  if (compact) {
    return (
      <div
        title={anomaly.recommendation}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          background: bg,
          border: `1px solid ${border}`,
          color,
          borderRadius: 12,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        <span>{icon}</span>
        <span>{anomaly.message}</span>
      </div>
    )
  }

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: '12px 16px',
        marginBottom: 14,
        display: 'flex',
        gap: 14,
        alignItems: 'center',
      }}
    >
      <div style={{ fontSize: 24 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color, fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
          {anomaly.message}
        </div>
        <div style={{ color, opacity: .85, fontSize: 12 }}>
          {anomaly.recommendation} · Média 30d: R$ {anomaly.avgRate?.toFixed(4)}
        </div>
      </div>
      {anomaly.history.length >= 5 && (
        <Sparkline data={anomaly.history} color={color} currentRate={anomaly.currentRate} />
      )}
    </div>
  )
}

// Mini sparkline SVG — sem libs
function Sparkline({ data, color, currentRate }) {
  const w = 80, h = 28
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  // Último ponto destacado
  const lastX = w
  const lastY = h - ((currentRate - min) / range) * h
  return (
    <svg width={w} height={h} style={{ flexShrink: 0, opacity: .8 }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  )
}
