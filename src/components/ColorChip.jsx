// src/components/ColorChip.jsx
// v13.38 — Chip compacto com swatch + código + status pra grid de cores.
// Usado em ProductDetail (substitui tabela crua).

import { ColorSwatch } from './ColorSwatch'

export function ColorChip({
  code,
  status,              // { id, label, icon, color } — objeto de COLOR_STATUSES
  colorData,           // objeto do banco de cores (se encontrado por code)
  colors,              // lista completa pra ColorSwatch resolver
  sku,
  factories = [],      // nomes de fábricas que têm essa cor
  showFactories = false,
  showSku = false,
  onPhotoClick,        // click no swatch abre lightbox
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      gap: 10,
      padding: '8px 12px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      transition: 'box-shadow .15s',
    }}
    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.06)'}
    onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
    >
      {/* Swatch grande à esquerda */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <ColorSwatch
          color={colorData}
          code={code}
          colors={colors}
          size="lg"
          onClick={onPhotoClick}
        />
      </div>
      
      {/* Info central */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
        {/* Linha 1: Código + nome_pt */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 15, color: 'var(--text)' }}>{code}</strong>
          {colorData?.name_pt && (
            <span className="text-muted text-xs" style={{ fontStyle: 'italic' }}>
              {colorData.name_pt}
            </span>
          )}
        </div>
        
        {/* Linha 2: status pill */}
        {status && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 10,
            background: (status.color || '#999') + '22',
            color: status.color || '#666',
            fontSize: 10, fontWeight: 700,
            alignSelf: 'flex-start',
            whiteSpace: 'nowrap',
          }}>
            {status.icon} {status.label}
          </span>
        )}
        
        {/* SKU se aplicável */}
        {showSku && (
          <div style={{
            fontFamily: 'monospace',
            fontSize: 10,
            color: sku ? 'var(--text)' : 'var(--text-muted)',
          }}>
            SKU: {sku || '—'}
          </div>
        )}
        
        {/* Fábricas se aplicável */}
        {showFactories && factories.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {factories.map((f, i) => (
              <span key={`${f}-${i}`} style={{
                display: 'inline-block',
                padding: '1px 6px',
                background: '#DBEAFE', color: '#1D4ED8',
                borderRadius: 4, fontSize: 9, fontWeight: 600,
              }}>
                🏭 {f}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
