// src/components/ColorSwatch.jsx
// Preview visual de cor: foto > hex > placeholder com código.
// Usado em pedidos, products, banco de cores.
//
// Props:
//   color  — objeto completo {code, name_pt, hex, photo_url, ...}
//   code   — alternativa: passa só o código + colors array
//   colors — array de cores do banco (necessário se passar code)
//   size   — 'xs' (16px) | 'sm' (24px) | 'md' (40px) | 'lg' (64px)
//   showLabel — true: mostra "1B (preto natural)" ao lado
//   onClick — callback opcional

const SIZES = { xs: 16, sm: 24, md: 40, lg: 64 }

export function ColorSwatch({ color, code, colors = [], size = 'sm', showLabel = false, onClick }) {
  // Resolve cor: se passou objeto direto usa ele; senão procura no array
  const c = color || (code ? colors.find(x => x.code === code) : null)
  const px = SIZES[size] || SIZES.sm
  const codeLabel = c?.code || code || '?'
  const nameLabel = c?.name_pt
  
  const swatchStyle = {
    width: px,
    height: px,
    borderRadius: size === 'xs' ? 3 : 4,
    border: '1px solid #D1D5DB',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    fontSize: Math.floor(px * 0.32),
    fontWeight: 600,
    color: '#374151',
    background: c?.hex || '#F3F4F6',
    cursor: onClick ? 'pointer' : undefined,
    position: 'relative',
  }
  
  const swatch = (
    <div style={swatchStyle} title={nameLabel ? `${codeLabel} · ${nameLabel}` : codeLabel} onClick={onClick}>
      {c?.photo_url ? (
        <img
          src={c.photo_url}
          alt={codeLabel}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
        />
      ) : (
        // Placeholder com texto, contraste auto baseado em hex
        size !== 'xs' && (
          <span style={{ color: c?.hex ? getContrastColor(c.hex) : '#374151' }}>
            {codeLabel.slice(0, 3)}
          </span>
        )
      )}
    </div>
  )
  
  if (!showLabel) return swatch
  
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {swatch}
      <span style={{ fontSize: 12 }}>
        <strong>{codeLabel}</strong>
        {nameLabel && <span className="text-muted" style={{ marginLeft: 4 }}>· {nameLabel}</span>}
      </span>
    </div>
  )
}

// Calcula contraste (preto ou branco) pra um background hex
export function getContrastColor(hex) {
  if (!hex || hex.length < 4) return '#374151'
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length !== 6) return '#374151'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luma > 0.55 ? '#1F2937' : '#FFFFFF'
}
