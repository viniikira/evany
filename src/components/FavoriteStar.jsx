// src/components/FavoriteStar.jsx
// v13.44 — Estrela de favoritar, reutilizável em qualquer entidade.
//
// Uso:
//   <FavoriteStar entityType="product" entityId={p.id} />
//   <FavoriteStar entityType="idea" entityId={i.id} size="sm" />
//
// Controlada internamente pelo useFavorites (singleton state).
// Optimistic update: click vira imediato, erro reverte.

import { useFavorites } from '../hooks/useFavorites'
import { log } from '../lib/logger'

const SIZES = {
  sm: { box: 22, icon: 13 },
  md: { box: 28, icon: 16 },
  lg: { box: 34, icon: 20 },
}

export function FavoriteStar({
  entityType,
  entityId,
  size = 'md',
  title,
  stopPropagation = true,
}) {
  const { isFav, toggle, ready } = useFavorites()
  const active = isFav(entityType, entityId)
  const dims = SIZES[size] || SIZES.md

  const handleClick = async (e) => {
    if (stopPropagation) { e.stopPropagation(); e.preventDefault() }
    if (!ready) return
    try {
      await toggle(entityType, entityId)
    } catch (err) {
      log.error('[FavoriteStar] toggle falhou:', err)
    }
  }

  return (
    <button
      type="button"
      className="fav-star-btn"
      onClick={handleClick}
      title={title || (active ? 'Remover dos favoritos' : 'Adicionar aos favoritos')}
      aria-pressed={active}
      aria-label={active ? 'Favoritado' : 'Não favoritado'}
      style={{
        width: dims.box,
        height: dims.box,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        transition: 'transform .15s, background .15s',
        opacity: ready ? 1 : 0.4,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(198,168,108,.12)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <span
        style={{
          fontSize: dims.icon,
          lineHeight: 1,
          color: active ? 'var(--accent)' : 'var(--text-muted)',
          filter: active ? 'drop-shadow(0 0 6px rgba(198,168,108,.5))' : 'none',
          transform: active ? 'scale(1.1)' : 'scale(1)',
          transition: 'all .2s cubic-bezier(.2,1.6,.3,1)',
        }}
      >
        {active ? '★' : '☆'}
      </span>
    </button>
  )
}
