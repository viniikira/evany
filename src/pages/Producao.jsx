// src/pages/Producao.jsx
// v13.43 — Catálogo denso.
//
// Mudanças vs v13.42:
//   - Header compacto (48px vs 400px) — título + stats inline
//   - Grid 2 colunas pros cards de produto (não list full-width)
//   - Foto clicável (bug da v13.42 corrigido)
//   - Todas as informações organizadas: fábrica, coleção, cores, status
//   - Agrupamento por fábrica mantido
//   - Tipografia Fraunces/DM Mono mantida mas hierarquia menor
//   - Toolbar sticky, filtros + ordenação
//   - Stagger on-scroll mantido
//   - Dark mode
//
// Dados:
//   - Tab "Em Produção": color_variants onde status === 'production'
//   - Tab "Em Trânsito": pedidos com status === 'in_transit'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Lightbox, ClearFiltersButton } from '../components/ui'
import { listFactories, listCollections } from '../lib/data/misc'
import { formatDate } from '../lib/utils'

export default function ProducaoPage({
  products = [],
  orders = [],
  colors = [],
  factories: factoriesProp,
  collections: collectionsProp,
}) {
  const [tab, setTab] = useState('production')
  const [search, setSearch] = useState('')
  const [factoryFilter, setFactoryFilter] = useState('')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [showOnlyStuck, setShowOnlyStuck] = useState(false)
  const [sortBy, setSortBy] = useState('urgency')
  const [lb, setLb] = useState(null)

  const [factories, setFactories] = useState(factoriesProp || [])
  const [collections, setCollections] = useState(collectionsProp || [])

  useEffect(() => {
    if (!factoriesProp) listFactories().then(setFactories).catch(() => setFactories([]))
    if (!collectionsProp) listCollections().then(setCollections).catch(() => setCollections([]))
  }, [factoriesProp, collectionsProp])

  // ═════════ INDEX: cor → pedidos ativos ═════════
  const colorOrderIndex = useMemo(() => {
    const idx = new Map()
    for (const o of orders) {
      if (o.status !== 'sent' && o.status !== 'manufacturing') continue
      for (const it of (o.items || [])) {
        for (const c of (it.colors || [])) {
          if (!c.code || !it.product_id) continue
          const key = `${it.product_id}|${c.code}`
          const cur = idx.get(key) || { count: 0, hasOrder: false }
          cur.count++
          cur.hasOrder = true
          idx.set(key, cur)
        }
      }
    }
    return idx
  }, [orders])

  // ═════════ PRODUCTION: agrupa por produto ═════════
  const productionGroups = useMemo(() => {
    const groups = new Map()
    for (const p of products) {
      for (const cv of (p.color_variants || [])) {
        if (cv.status !== 'production') continue
        if (!groups.has(p.id)) groups.set(p.id, { product: p, cores: [] })
        const info = colorOrderIndex.get(`${p.id}|${cv.code}`)
        groups.get(p.id).cores.push({
          code: cv.code,
          sku: cv.sku,
          colorData: colors.find(c => c.code === cv.code),
          orderCount: info?.count || 0,
          hasOrder: !!info?.hasOrder,
        })
      }
    }
    return [...groups.values()]
  }, [products, colors, colorOrderIndex])

  // ═════════ TRANSIT ═════════
  const transitByOrder = useMemo(() => {
    const list = []
    for (const o of orders) {
      if (o.status !== 'in_transit') continue
      const byProduct = new Map()
      for (const it of (o.items || [])) {
        const prod = products.find(p => p.id === it.product_id)
        const key = it.product_id || `manual-${it.name_manual || 'sem-nome'}`
        const prodObj = prod || { id: key, name: it.name_manual || it.product_name_snapshot || 'Sem nome', factory: o.factory }
        if (!byProduct.has(key)) byProduct.set(key, { product: prodObj, cores: [] })
        for (const cl of (it.colors || [])) {
          if (!cl.code) continue
          byProduct.get(key).cores.push({
            code: cl.code,
            qty: Number(cl.qty) || 0,
            colorData: colors.find(c => c.code === cl.code),
            sku: prod?.color_variants?.find(cv => cv.code === cl.code)?.sku,
          })
        }
      }
      list.push({
        order: o,
        orderDate: o.order_date || o.created_at,
        expectedArrival: o.expected_arrival,
        products: [...byProduct.values()].sort((a, b) => (a.product.name || '').localeCompare(b.product.name || '')),
      })
    }
    return list.sort((a, b) => new Date(b.orderDate || 0) - new Date(a.orderDate || 0))
  }, [orders, products, colors])

  // ═════════ FILTROS + ORDENAÇÃO ═════════
  const productionByFactory = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = productionGroups
      .map(g => ({
        ...g,
        cores: g.cores.filter(c => {
          if (showOnlyStuck && c.hasOrder) return false
          if (q) {
            const hit = (c.code || '').toLowerCase().includes(q) ||
                        (g.product.name || '').toLowerCase().includes(q) ||
                        (c.colorData?.name_pt || '').toLowerCase().includes(q)
            if (!hit) return false
          }
          return true
        }),
      }))
      .filter(g => g.cores.length > 0)
      .filter(g => {
        if (factoryFilter && g.product.factory !== factoryFilter) return false
        if (collectionFilter && g.product.collection !== collectionFilter) return false
        return true
      })

    const sortFn = {
      urgency: (a, b) => {
        const aStuck = a.cores.filter(c => !c.hasOrder).length
        const bStuck = b.cores.filter(c => !c.hasOrder).length
        if (aStuck !== bStuck) return bStuck - aStuck
        return (a.product.name || '').localeCompare(b.product.name || '')
      },
      alpha: (a, b) => (a.product.name || '').localeCompare(b.product.name || ''),
      count: (a, b) => b.cores.length - a.cores.length,
      recent: (a, b) => new Date(b.product.updated_at || 0) - new Date(a.product.updated_at || 0),
    }[sortBy] || (() => 0)
    filtered.sort(sortFn)

    const byFactory = new Map()
    for (const g of filtered) {
      const f = g.product.factory || '— sem fábrica —'
      if (!byFactory.has(f)) byFactory.set(f, [])
      byFactory.get(f).push(g)
    }
    return [...byFactory.entries()].map(([factoryName, groups]) => ({
      factoryName,
      groups,
      totalCores: groups.reduce((s, g) => s + g.cores.length, 0),
      stuckCores: groups.reduce((s, g) => s + g.cores.filter(c => !c.hasOrder).length, 0),
    }))
  }, [productionGroups, search, factoryFilter, collectionFilter, showOnlyStuck, sortBy])

  const filteredTransitByOrder = useMemo(() => {
    const q = search.trim().toLowerCase()
    return transitByOrder
      .map(t => ({
        ...t,
        products: t.products.map(p => ({
          ...p,
          cores: p.cores.filter(c => {
            if (!q) return true
            return (c.code || '').toLowerCase().includes(q) ||
                   (p.product.name || '').toLowerCase().includes(q) ||
                   (t.order.order_name || '').toLowerCase().includes(q) ||
                   (c.colorData?.name_pt || '').toLowerCase().includes(q)
          }),
        })).filter(p => p.cores.length > 0),
      }))
      .filter(t => t.products.length > 0)
      .filter(t => !factoryFilter || t.order.factory === factoryFilter)
  }, [transitByOrder, search, factoryFilter])

  // ═════════ STATS ═════════
  const totalCoresProduction = productionGroups.reduce((s, g) => s + g.cores.length, 0)
  const totalStuck = productionGroups.reduce((s, g) => s + g.cores.filter(c => !c.hasOrder).length, 0)
  const transitTotal = transitByOrder.reduce((s, t) => s + t.products.reduce((s2, p) => s2 + p.cores.length, 0), 0)

  const hasFilters = !!(search || factoryFilter || collectionFilter || showOnlyStuck)
  const clearFilters = () => {
    setSearch(''); setFactoryFilter(''); setCollectionFilter(''); setShowOnlyStuck(false)
  }

  return (
    <div className="producao-page">
      <style>{PRODUCAO_STYLES}</style>
      {lb && <Lightbox src={lb} onClose={() => setLb(null)} />}

      {/* ═════════ HEADER COMPACTO ═════════ */}
      <div className="prd-header-compact">
        <div className="prd-header-left">
          <h1 className="prd-title-compact">Produç<em>ão</em></h1>
          {tab === 'production' && totalStuck > 0 && (
            <div className="prd-alert-inline">
              <span className="prd-alert-dot"></span>
              <strong>{totalStuck}</strong> sem pedido
            </div>
          )}
        </div>
      </div>

      {/* ═════════ TOOLBAR STICKY ═════════ */}
      <div className="prd-toolbar-wrap">
        <div className="prd-toolbar">
          <div className="prd-tabs">
            <button
              className={`prd-tab ${tab === 'production' ? 'active' : ''}`}
              onClick={() => setTab('production')}
            >
              🏭 Em produção <span className="prd-tab-count">{totalCoresProduction}</span>
            </button>
            <button
              className={`prd-tab ${tab === 'in_transit' ? 'active' : ''}`}
              onClick={() => setTab('in_transit')}
            >
              ✈ Em trânsito <span className="prd-tab-count">{transitTotal}</span>
            </button>
          </div>
          <div className="prd-search">
            <span className="prd-search-icon">🔍</span>
            <input
              placeholder="Buscar produto, cor..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="prd-sel"
            value={factoryFilter}
            onChange={e => setFactoryFilter(e.target.value)}
          >
            <option value="">Todas as fábricas</option>
            {(factories || []).map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
          </select>
          {tab === 'production' && (
            <>
              <select
                className="prd-sel"
                value={collectionFilter}
                onChange={e => setCollectionFilter(e.target.value)}
              >
                <option value="">Todas as coleções</option>
                {(collections || []).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <select
                className="prd-sel"
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
              >
                <option value="urgency">Urgência</option>
                <option value="alpha">A–Z</option>
                <option value="count">Mais cores</option>
                <option value="recent">Recente</option>
              </select>
              <label className={`prd-toggle ${showOnlyStuck ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={showOnlyStuck}
                  onChange={e => setShowOnlyStuck(e.target.checked)}
                />
                <span>◦ só sem pedido</span>
              </label>
            </>
          )}
          <ClearFiltersButton visible={hasFilters} onClear={clearFilters} />
        </div>
      </div>

      {/* ═════════ CONTEÚDO ═════════ */}
      <div className="prd-content">
        {tab === 'production' ? (
          <ProductionContent
            byFactory={productionByFactory}
            hasFilters={hasFilters}
            onPhotoClick={setLb}
          />
        ) : (
          <TransitContent
            byOrder={filteredTransitByOrder}
            hasFilters={hasFilters}
            onPhotoClick={setLb}
          />
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═════════════════════════════════════════════════════════════

function ProductionContent({ byFactory, hasFilters, onPhotoClick }) {
  if (byFactory.length === 0) {
    return (
      <EmptyState
        icon="🏭"
        title={hasFilters ? 'Nenhum resultado' : 'Nada em produção'}
        desc={hasFilters
          ? 'Limpe os filtros ou ajuste os critérios.'
          : 'Quando uma cor entrar em produção, ela aparece aqui agrupada por fábrica.'}
      />
    )
  }
  return (
    <>
      {byFactory.map(({ factoryName, groups, totalCores, stuckCores }, idx) => (
        <FactoryGroup
          key={factoryName}
          index={idx}
          factoryName={factoryName}
          groups={groups}
          totalCores={totalCores}
          stuckCores={stuckCores}
          onPhotoClick={onPhotoClick}
        />
      ))}
    </>
  )
}

function FactoryGroup({ factoryName, groups, totalCores, stuckCores, onPhotoClick }) {
  return (
    <div className="prd-factory-group">
      <div className="prd-factory-sep">
        <div className="prd-factory-name">
          <em>{factoryName}</em>
        </div>
        <div className="prd-factory-meta">
          {groups.length} produto{groups.length !== 1 ? 's' : ''} · {totalCores} cor{totalCores !== 1 ? 'es' : ''}
          {stuckCores > 0 && <span className="stuck-inline"> · {stuckCores} sem pedido</span>}
        </div>
      </div>
      <div className="prd-card-grid">
        {groups.map((g, i) => (
          <ProductCard
            key={g.product.id}
            group={g}
            staggerDelay={i * 0.05}
            onPhotoClick={onPhotoClick}
          />
        ))}
      </div>
    </div>
  )
}

function ProductCard({ group, staggerDelay, onPhotoClick }) {
  const { product, cores } = group
  const photoUrl = product.card_image_url || (product.photos || [])[0]
  const stuckCount = cores.filter(c => !c.hasOrder).length
  const cardRef = useRef(null)
  const photoWrapRef = useRef(null)
  const swapImgRef = useRef(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!cardRef.current) return
    const el = cardRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true)
            observer.unobserve(el)
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleSwatchHover = (url) => {
    if (!url || !swapImgRef.current || !photoWrapRef.current) return
    const swapImg = swapImgRef.current
    const wrap = photoWrapRef.current
    swapImg.src = url
    const apply = () => wrap.classList.add('swapped')
    if (swapImg.complete) apply()
    else swapImg.onload = apply
  }
  const handleSwatchLeave = () => {
    if (photoWrapRef.current) photoWrapRef.current.classList.remove('swapped')
  }

  return (
    <article
      ref={cardRef}
      className={`prd-product-card ${revealed ? 'revealed' : ''}`}
      style={{ transitionDelay: `${staggerDelay}s` }}
    >
      <div
        ref={photoWrapRef}
        className="prd-photo-wrap"
        onClick={() => photoUrl && onPhotoClick(photoUrl)}
        title={photoUrl ? 'Clique para ampliar' : ''}
      >
        {photoUrl ? (
          <>
            <img className="primary" src={photoUrl} alt={product.name} loading="lazy" />
            <img ref={swapImgRef} className="swap-in" src="" alt="" />
            <div className="prd-photo-zoom-hint">⊕</div>
          </>
        ) : (
          <div className="prd-photo-placeholder"><span>👑</span></div>
        )}
        {stuckCount > 0 && (
          <div className="prd-photo-badge" title={`${stuckCount} sem pedido`}>
            <span className="prd-badge-dot"></span>
            {stuckCount}
          </div>
        )}
      </div>

      <div className="prd-info">
        <h2 className="prd-prod-name">{product.name || 'Sem nome'}</h2>
        <div className="prd-prod-meta">
          {product.collection && <span className="prd-collection">{product.collection}</span>}
        </div>
        <div className="prd-swatches-label">
          <span>{cores.length} cor{cores.length !== 1 ? 'es' : ''}</span>
          {stuckCount > 0 && (
            <span className="prd-stuck-count">· {stuckCount} sem pedido</span>
          )}
        </div>
        <div className="prd-swatches-row">
          {cores.map((c, idx) => (
            <Swatch
              key={`${c.code}-${idx}`}
              cor={c}
              onHover={handleSwatchHover}
              onLeave={handleSwatchLeave}
              onPhotoClick={onPhotoClick}
            />
          ))}
        </div>
      </div>
    </article>
  )
}

function Swatch({ cor, onHover, onLeave, onPhotoClick }) {
  const { code, colorData, hasOrder, orderCount } = cor
  const photoUrl = colorData?.photo_url
  const tip = hasOrder
    ? `em ${orderCount} pedido${orderCount !== 1 ? 's' : ''}`
    : 'sem pedido'
  return (
    <div
      className={`prd-swatch ${!hasOrder ? 'stuck' : ''}`}
      onMouseEnter={() => onHover(photoUrl)}
      onMouseLeave={onLeave}
      onClick={(e) => {
        e.stopPropagation()
        if (photoUrl) onPhotoClick(photoUrl)
      }}
    >
      <div
        className="prd-swatch-circle"
        style={{ background: colorData?.hex || 'var(--border-light)' }}
      >
        {photoUrl && <img src={photoUrl} alt={code} loading="lazy" />}
      </div>
      <div className="prd-swatch-code">{code}</div>
      <div className="prd-swatch-tip">{tip}</div>
    </div>
  )
}

function TransitContent({ byOrder, hasFilters, onPhotoClick }) {
  if (byOrder.length === 0) {
    return (
      <EmptyState
        icon="✈"
        title={hasFilters ? 'Nenhum resultado' : 'Nenhum pedido em trânsito'}
        desc={hasFilters
          ? 'Limpe os filtros ou ajuste os critérios.'
          : 'Pedidos aparecem aqui quando saem da fábrica e estão a caminho do Brasil.'}
      />
    )
  }
  return (
    <>
      {byOrder.map((t, idx) => (
        <TransitCard key={t.order.id} transit={t} index={idx} onPhotoClick={onPhotoClick} />
      ))}
    </>
  )
}

function TransitCard({ transit, index, onPhotoClick }) {
  const { order, orderDate, expectedArrival, products } = transit
  const totalPieces = products.reduce((s, p) =>
    s + p.cores.reduce((s2, c) => s2 + (c.qty || 0), 0), 0)
  const cardRef = useRef(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!cardRef.current) return
    const el = cardRef.current
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true)
            observer.unobserve(el)
          }
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <article
      ref={cardRef}
      className={`prd-transit-card ${revealed ? 'revealed' : ''}`}
      style={{ transitionDelay: `${index * 0.08}s` }}
    >
      <div className="prd-transit-header">
        <div className="prd-transit-name">
          <span className="prd-transit-eyebrow">pedido</span>
          <h3>{order.order_name || order.factory}</h3>
        </div>
        <div className="prd-transit-meta">
          <span>🏭 {order.factory}</span>
          <span className="prd-meta-sep">·</span>
          <span>🗓 {formatDate(orderDate, 'full')}</span>
          {expectedArrival && (
            <>
              <span className="prd-meta-sep">·</span>
              <span>📅 chega {formatDate(expectedArrival, 'full')}</span>
            </>
          )}
          <span className="prd-meta-sep">·</span>
          <span>{totalPieces} peça{totalPieces !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="prd-transit-products">
        {products.map(p => (
          <TransitProductRow
            key={p.product.id}
            product={p.product}
            cores={p.cores}
            onPhotoClick={onPhotoClick}
          />
        ))}
      </div>
    </article>
  )
}

function TransitProductRow({ product, cores, onPhotoClick }) {
  const photoUrl = product.card_image_url || (product.photos || [])[0]
  const totalQty = cores.reduce((s, c) => s + (c.qty || 0), 0)
  return (
    <div className="prd-transit-row">
      <div
        className="prd-transit-row-photo"
        onClick={() => photoUrl && onPhotoClick(photoUrl)}
        title={photoUrl ? 'Clique para ampliar' : ''}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="" loading="lazy" />
        ) : (
          <div className="prd-photo-placeholder-sm"><span>👑</span></div>
        )}
      </div>
      <div className="prd-transit-row-info">
        <div className="prd-transit-row-name">
          {product.name} <span className="prd-transit-row-qty">{totalQty} peça{totalQty !== 1 ? 's' : ''}</span>
        </div>
        <div className="prd-transit-pills">
          {cores.map((c, idx) => (
            <div
              key={`${c.code}-${idx}`}
              className="prd-transit-pill"
              onClick={(e) => {
                e.stopPropagation()
                if (c.colorData?.photo_url) onPhotoClick(c.colorData.photo_url)
              }}
            >
              <span
                className="prd-transit-pill-dot"
                style={{ background: c.colorData?.hex || 'var(--border-light)' }}
              >
                {c.colorData?.photo_url && (
                  <img src={c.colorData.photo_url} alt="" loading="lazy" />
                )}
              </span>
              <span className="prd-transit-pill-code">{c.code}</span>
              <span className="prd-transit-pill-qty">{c.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ icon, title, desc }) {
  return (
    <div className="prd-empty">
      <div className="prd-empty-icon">{icon}</div>
      <div className="prd-empty-title">{title}</div>
      <div className="prd-empty-desc">{desc}</div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// ESTILOS
// ═════════════════════════════════════════════════════════════
const PRODUCAO_STYLES = `
.producao-page { position: relative; }

/* ═══ HEADER COMPACTO (56px vs 400px antes) ═══ */
.prd-header-compact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0 16px;
  border-bottom: 1px solid var(--border-light);
  flex-wrap: wrap;
  gap: 16px;
}
.prd-header-left {
  display: flex;
  align-items: baseline;
  gap: 20px;
  flex-wrap: wrap;
}
.prd-title-compact {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 400;
  font-size: 34px;
  line-height: 1;
  letter-spacing: -0.025em;
  color: var(--text);
  margin: 0;
}
.prd-title-compact em {
  font-style: italic;
  color: var(--accent);
  font-weight: 400;
}
.prd-alert-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  background: rgba(198,168,108,.1);
  padding: 5px 12px;
  border-radius: 14px;
  border: 1px solid var(--accent-light);
}
.prd-alert-inline strong {
  color: var(--accent);
  font-weight: 600;
  font-size: 12px;
}
.prd-alert-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: prdDotPulse 2.5s ease-in-out infinite;
}
@keyframes prdDotPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}

/* ═══ TOOLBAR ═══ */
.prd-toolbar-wrap {
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(245, 242, 239, .92);
  backdrop-filter: blur(10px) saturate(1.2);
  -webkit-backdrop-filter: blur(10px) saturate(1.2);
  border-bottom: 1px solid var(--border);
  margin: 0 -24px;
  padding: 12px 24px;
  transition: background .3s;
}
[data-theme="dark"] .prd-toolbar-wrap {
  background: rgba(26, 22, 20, .88);
}
.prd-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.prd-tabs {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--surface);
  border-radius: 22px;
  border: 1px solid var(--border);
}
.prd-tab {
  padding: 7px 14px;
  background: transparent;
  border: none;
  border-radius: 18px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  transition: all .25s cubic-bezier(.2,.9,.3,1);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.prd-tab.active {
  background: var(--text);
  color: var(--bg);
  box-shadow: 0 2px 8px rgba(0,0,0,.1);
}
.prd-tab:hover:not(.active) { color: var(--text); }
.prd-tab-count {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
  opacity: .75;
}
.prd-search {
  flex: 1;
  min-width: 180px;
  max-width: 260px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  transition: all .2s;
}
.prd-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
.prd-search input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  outline: none;
  font-family: inherit;
  min-width: 0;
}
.prd-search input::placeholder { color: var(--text-muted); opacity: .65; }
.prd-search-icon { opacity: .4; font-size: 13px; flex-shrink: 0; }
.prd-sel {
  padding: 7px 26px 7px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  font-family: inherit;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  outline: none;
  appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M1 1l4 4 4-4' stroke='%23A69BA0' stroke-width='1.5' stroke-linecap='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: border-color .2s;
  max-width: 180px;
}
.prd-sel:hover { border-color: var(--accent); }
.prd-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: all .2s;
  user-select: none;
  white-space: nowrap;
}
.prd-toggle.active {
  background: var(--accent-light);
  color: var(--text);
  border-color: var(--accent);
}
.prd-toggle input { display: none; }

/* ═══ CONTENT ═══ */
.prd-content {
  padding: 24px 0 60px;
}

/* ═══ FACTORY GROUP ═══ */
.prd-factory-group {
  margin-bottom: 40px;
  opacity: 0;
  animation: prdFactoryIn .5s cubic-bezier(.2,.9,.3,1) forwards;
}
.prd-factory-group:nth-child(1) { animation-delay: 0s; }
.prd-factory-group:nth-child(2) { animation-delay: .08s; }
.prd-factory-group:nth-child(3) { animation-delay: .16s; }
.prd-factory-group:nth-child(4) { animation-delay: .24s; }
.prd-factory-group:nth-child(5) { animation-delay: .32s; }
@keyframes prdFactoryIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
.prd-factory-sep {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 16px;
  padding-bottom: 10px;
  position: relative;
  flex-wrap: wrap;
}
.prd-factory-sep::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0;
  width: 100%;
  height: 1px;
  background: var(--border);
  transform: scaleX(0);
  transform-origin: left;
  animation: prdLineIn .7s cubic-bezier(.2,.9,.3,1) .2s forwards;
}
@keyframes prdLineIn { to { transform: scaleX(1); } }
.prd-factory-name {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 22px;
  letter-spacing: -0.01em;
  color: var(--text);
}
.prd-factory-name em {
  font-style: italic;
  color: var(--accent);
  font-weight: 500;
}
.prd-factory-meta {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.stuck-inline { color: var(--accent); font-weight: 600; }

/* ═══ CARD GRID — 2 colunas ═══ */
.prd-card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}
@media (max-width: 1100px) {
  .prd-card-grid { grid-template-columns: 1fr; }
}

/* ═══ PRODUCT CARD (denso, 2-col) ═══ */
.prd-product-card {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 18px;
  padding: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  position: relative;
  transition: all .35s cubic-bezier(.2,.9,.3,1);
  opacity: 0;
  transform: translateY(14px);
  overflow: hidden;
}
.prd-product-card.revealed {
  opacity: 1;
  transform: none;
}
.prd-product-card::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--accent);
  transform: scaleY(0);
  transform-origin: top;
  transition: transform .35s cubic-bezier(.2,.9,.3,1);
}
.prd-product-card:hover {
  border-color: var(--accent-light);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(74,25,66,.08);
}
.prd-product-card:hover::before { transform: scaleY(1); }

/* Photo */
.prd-photo-wrap {
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: var(--border-light);
  position: relative;
  cursor: zoom-in;
  border-radius: 4px;
  align-self: start;
}
.prd-photo-wrap img {
  width: 100%; height: 100%;
  object-fit: cover;
  transition: transform .6s cubic-bezier(.2,.9,.3,1), opacity .35s;
}
.prd-product-card:hover .prd-photo-wrap img.primary {
  transform: scale(1.05);
}
.prd-photo-wrap img.swap-in {
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: scale(1.08);
}
.prd-photo-wrap.swapped img.primary {
  opacity: 0;
  transform: scale(1.08);
}
.prd-photo-wrap.swapped img.swap-in {
  opacity: 1;
  transform: scale(1);
}
.prd-photo-placeholder {
  width: 100%; height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  opacity: .3;
}
.prd-photo-zoom-hint {
  position: absolute;
  top: 6px; right: 6px;
  width: 24px; height: 24px;
  background: rgba(0,0,0,.5);
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  opacity: 0;
  transition: opacity .2s;
  backdrop-filter: blur(4px);
  pointer-events: none;
}
.prd-photo-wrap:hover .prd-photo-zoom-hint { opacity: 1; }

/* Badge de "sem pedido" no canto da foto */
.prd-photo-badge {
  position: absolute;
  top: 6px; left: 6px;
  background: var(--accent);
  color: #fff;
  padding: 3px 8px 3px 6px;
  border-radius: 10px;
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-shadow: 0 2px 6px rgba(198,168,108,.35);
}
.prd-badge-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #fff;
  animation: prdDotPulse 2.5s ease-in-out infinite;
}

/* Info col */
.prd-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.prd-prod-name {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 22px;
  line-height: 1.1;
  letter-spacing: -0.015em;
  color: var(--text);
  margin: 0 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.prd-prod-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 14px;
  letter-spacing: 0.01em;
  min-height: 16px;
}
.prd-collection {
  color: var(--text-secondary);
  font-style: italic;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 12px;
}
.prd-swatches-label {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.prd-stuck-count {
  color: var(--accent);
  font-weight: 600;
}

/* Swatches */
.prd-swatches-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.prd-swatch {
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  cursor: zoom-in;
  position: relative;
}
.prd-swatch-circle {
  width: 42px; height: 42px;
  border-radius: 50%;
  overflow: hidden;
  border: 1px solid rgba(0,0,0,.06);
  position: relative;
  transition: transform .3s cubic-bezier(.2,.9,.3,1), box-shadow .3s;
  background: var(--border-light);
}
[data-theme="dark"] .prd-swatch-circle {
  border-color: rgba(255,255,255,.08);
}
.prd-swatch-circle img {
  width: 100%; height: 100%;
  object-fit: cover;
  transition: transform .5s ease;
}
.prd-swatch:hover .prd-swatch-circle {
  transform: translateY(-3px) scale(1.12);
  box-shadow: 0 8px 18px rgba(74,25,66,.16);
}
.prd-swatch:hover .prd-swatch-circle img {
  transform: scale(1.1);
}
.prd-swatch.stuck .prd-swatch-circle {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px var(--accent);
  animation: prdSwatchPulse 3s ease-in-out infinite;
}
.prd-swatch.stuck:hover .prd-swatch-circle {
  animation: none;
  box-shadow: 0 8px 18px rgba(198,168,108,.3), 0 0 0 2px var(--surface), 0 0 0 3px var(--accent);
  transform: translateY(-3px) scale(1.12);
}
@keyframes prdSwatchPulse {
  0%, 100% { box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px var(--accent); }
  50% { box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px var(--accent), 0 0 0 6px rgba(198,168,108,.18); }
}
.prd-swatch-code {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  color: var(--text);
  letter-spacing: 0.02em;
  text-align: center;
  max-width: 52px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color .2s;
}
.prd-swatch:hover .prd-swatch-code { color: var(--accent); }

/* Tooltip */
.prd-swatch-tip {
  position: absolute;
  bottom: -28px;
  left: 50%;
  transform: translateX(-50%) translateY(6px) scale(.8);
  background: var(--text);
  color: var(--bg);
  padding: 3px 9px;
  border-radius: 10px;
  font-size: 9px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s, transform .3s cubic-bezier(.2,1.6,.3,1);
  z-index: 10;
  font-family: 'DM Mono', ui-monospace, monospace;
  letter-spacing: 0.02em;
  box-shadow: 0 4px 12px rgba(0,0,0,.15);
}
.prd-swatch:hover .prd-swatch-tip {
  opacity: 1;
  transform: translateX(-50%) translateY(0) scale(1);
}
.prd-swatch-tip::before {
  content: '';
  position: absolute;
  top: -3px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 6px; height: 6px;
  background: var(--text);
}

/* ═══ TRANSIT CARD ═══ */
.prd-transit-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  margin-bottom: 12px;
  overflow: hidden;
  opacity: 0;
  transform: translateY(14px);
  transition: opacity .5s, transform .5s cubic-bezier(.2,.9,.3,1);
}
.prd-transit-card.revealed {
  opacity: 1;
  transform: none;
}
.prd-transit-header {
  padding: 16px 22px 12px;
  border-bottom: 1px solid var(--border-light);
  background: linear-gradient(90deg, rgba(198,168,108,.04), transparent);
}
.prd-transit-name {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.prd-transit-eyebrow {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.prd-transit-name h3 {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 20px;
  letter-spacing: -0.01em;
  color: var(--text);
  margin: 0;
}
.prd-transit-meta {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}
.prd-meta-sep {
  color: var(--text-muted);
  opacity: .5;
  margin: 0 6px;
}
.prd-transit-products {
  padding: 12px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.prd-transit-row {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--border-light);
}
.prd-transit-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.prd-transit-row-photo {
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: var(--border-light);
  border-radius: 3px;
  cursor: zoom-in;
}
.prd-transit-row-photo img {
  width: 100%; height: 100%;
  object-fit: cover;
  transition: transform .4s;
}
.prd-transit-row-photo:hover img { transform: scale(1.05); }
.prd-photo-placeholder-sm {
  width: 100%; height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  opacity: .3;
}
.prd-transit-row-info { min-width: 0; }
.prd-transit-row-name {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 6px;
  letter-spacing: -0.01em;
}
.prd-transit-row-qty {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  font-weight: 400;
  margin-left: 6px;
}
.prd-transit-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.prd-transit-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  cursor: zoom-in;
  transition: transform .15s, border-color .15s;
}
.prd-transit-pill:hover {
  transform: scale(1.03);
  border-color: var(--accent);
}
.prd-transit-pill-dot {
  width: 18px; height: 18px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid rgba(0,0,0,.06);
  display: inline-flex;
}
.prd-transit-pill-dot img {
  width: 100%; height: 100%;
  object-fit: cover;
}
.prd-transit-pill-code {
  font-family: 'DM Mono', ui-monospace, monospace;
  letter-spacing: 0.02em;
}
.prd-transit-pill-qty {
  background: var(--accent);
  color: #fff;
  padding: 1px 6px;
  border-radius: 7px;
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 600;
}

/* Empty state */
.prd-empty {
  padding: 60px 20px;
  text-align: center;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.prd-empty-icon {
  font-size: 48px;
  opacity: .25;
  margin-bottom: 12px;
}
.prd-empty-title {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 20px;
  color: var(--text);
  margin-bottom: 6px;
}
.prd-empty-desc {
  font-size: 12px;
  color: var(--text-muted);
  max-width: 380px;
  margin: 0 auto;
  line-height: 1.5;
}

/* Responsivo pequeno */
@media (max-width: 640px) {
  .prd-product-card {
    grid-template-columns: 110px 1fr;
    padding: 14px;
    gap: 14px;
  }
  .prd-prod-name { font-size: 18px; }
  .prd-title-compact { font-size: 26px; }
}
`
