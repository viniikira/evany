// src/components/ProgressBar.jsx
// v13.38 — Barra de progresso pra operações longas (sync Shopify, backup, etc)
//
// Modos:
//   1. Determinate: você sabe o % (ex: página 3 de 10 = 30%)
//   2. Indeterminate: não sabe o total (animação contínua)

export function ProgressBar({
  value,            // número 0-100 (ou null pra indeterminate)
  label,            // texto principal (ex: "Buscando produtos")
  sub,              // subtexto menor (ex: "página 3, 750 encontrados")
  color = 'var(--primary)',
  compact = false,  // menor, pra embutir em outras telas
}) {
  const isIndeterminate = value == null || isNaN(value)
  const pct = isIndeterminate ? 0 : Math.max(0, Math.min(100, value))
  
  return (
    <div style={{ width: '100%' }}>
      {(label || sub) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginBottom: compact ? 4 : 6,
        }}>
          {label && (
            <div style={{
              fontSize: compact ? 12 : 13,
              fontWeight: 600,
              color: 'var(--text)',
            }}>
              {label}
            </div>
          )}
          <div style={{
            fontSize: compact ? 10 : 11,
            color: 'var(--text-muted)',
            fontFamily: 'monospace',
          }}>
            {isIndeterminate ? '...' : `${pct.toFixed(0)}%`}
            {sub && <span style={{ marginLeft: 6 }}>· {sub}</span>}
          </div>
        </div>
      )}
      
      <div style={{
        width: '100%',
        height: compact ? 4 : 6,
        background: 'var(--border-light)',
        borderRadius: 100,
        overflow: 'hidden',
        position: 'relative',
      }}>
        {isIndeterminate ? (
          <div style={{
            position: 'absolute',
            height: '100%', width: '30%',
            background: color,
            borderRadius: 100,
            animation: 'progressSlide 1.4s ease-in-out infinite',
          }} />
        ) : (
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: 100,
            transition: 'width 0.3s ease',
          }} />
        )}
      </div>
      
      {/* Keyframe injetado uma única vez */}
      <style>{`
        @keyframes progressSlide {
          0%   { left: -30%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  )
}
