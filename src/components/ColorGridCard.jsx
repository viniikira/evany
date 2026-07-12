// src/components/ColorGridCard.jsx
// v13.35 — Card visual pra grid de cores (usado em Dashboard, etc.)
//
// Melhorias vs. versão inline anterior em Dashboard.jsx:
// - aspectRatio 3/4 (vertical) combina com fotos de peruca
// - Swatch da cor em overlay grande no canto da foto → cor em destaque
// - Hierarquia tipográfica: código GRANDE, produto+fábrica em legenda

import { useState } from 'react'

export function ColorGridCard({
  photo,           // URL foto do produto
  colorPhoto,      // URL foto da cor (swatch/mecha)
  colorHex,        // cor de fallback (se não tiver foto da cor)
  code,            // código (ex: "1B")
  product,         // nome do produto
  factory,         // fábrica
  factoryVisible = true,
  isStuck = false, // destaque vermelho pra cor sem pedido ativo
  stuckLabel = '⚠ SEM PEDIDO',
  onClick,
}) {
  const [hovered, setHovered] = useState(false)
  
  return (
    <div
      style={{
        background: 'var(--surface)',
        borderRadius: 10,
        border: isStuck ? '2px solid #DC2626' : '1px solid var(--border)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform .15s, box-shadow .15s',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        transform: hovered ? 'translateY(-2px)' : '',
        boxShadow: hovered ? '0 6px 16px rgba(0,0,0,.08)' : '',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {/* Badge "sem pedido" */}
      {isStuck && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 2,
          background: '#DC2626', color: '#fff',
          fontSize: 9, fontWeight: 700, padding: '3px 7px',
          borderRadius: 4,
          boxShadow: '0 2px 4px rgba(0,0,0,.2)',
        }}>
          {stuckLabel}
        </div>
      )}
      
      {/* Foto com proporção 3:4 (retrato) + swatch overlay */}
      <div style={{
        aspectRatio: '3/4',
        overflow: 'hidden',
        background: '#f5f2ef',
        position: 'relative',
      }}>
        {photo ? (
          <img
            src={photo}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', fontSize: 36, opacity: 0.2,
          }}>
            💇
          </div>
        )}
        
        {/* Overlay com swatch da cor no canto superior direito */}
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 1,
          width: 52, height: 52, borderRadius: 8,
          background: colorPhoto ? 'transparent' : (colorHex || '#f5f5f5'),
          overflow: 'hidden',
          border: '3px solid white',
          boxShadow: '0 2px 8px rgba(0,0,0,.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {colorPhoto
            ? <img src={colorPhoto} alt={code} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : !colorHex && <span style={{ fontSize: 18, opacity: 0.4 }}>🎨</span>}
        </div>
      </div>
      
      {/* Footer compacto: código em destaque + info legenda */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{
          fontSize: 20, fontWeight: 700,
          color: 'var(--primary)',
          lineHeight: 1,
          letterSpacing: 0.3,
        }}>
          {code}
        </div>
        <div style={{
          fontFamily: "'Fraunces',serif",
          fontSize: 13, fontWeight: 600,
          color: 'var(--text)',
          marginTop: 5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {product}
        </div>
        {factory && factoryVisible && (
          <div className="text-muted" style={{ fontSize: 10, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            🏭 {factory}
          </div>
        )}
      </div>
    </div>
  )
}
