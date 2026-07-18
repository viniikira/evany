// src/pages/Producao.jsx
// v13.43 — Catálogo denso (Fraunces/DM Mono, agrupado por fábrica).
// v13.61 — MEGA revisão (auditoria de UX): a página virou ESTRATÉGICA:
//   - PEÇAS em primeiro lugar: total por produto, por cor (pill ×qtd) e por
//     fábrica — antes não dava pra saber quantas peças estavam em produção
//   - Pedidos vinculados visíveis em cada produto (chip clicável → abre o
//     pedido), com chegada prevista e badge de atraso
//   - KPIs no topo: peças em produção · produtos · cores · peças em trânsito
//     · próxima chegada
//   - Cards densos (foto 96px, não mais 160px de arte de marketing)
//
// Dados:
//   - Tab "Em Produção": color_variants status 'production' + quantidades dos
//     pedidos ativos (sent/manufacturing), matching case-insensitive
//   - Tab "Em Trânsito": pedidos status 'in_transit'

import { useState, useMemo, useEffect, useRef } from 'react'
import { Lightbox, ClearFiltersButton, Modal, MH, MB } from '../components/ui'
import { listFactories, listCollections } from '../lib/data/misc'
import { computeFactoryLeadTime, computeOrderDelay } from '../lib/pendencias'
import { priceSignalForModel, suggestColorsForModel } from '../lib/orderIntelligence'
import { formatDate, UC } from '../lib/utils'

export default function ProducaoPage({
  products = [],
  orders = [],
  colors = [],
  factories: factoriesProp,
  collections: collectionsProp,
  perm = {},
  shopifyCache = null,
  onOpenOrder,
}) {
  const [tab, setTab] = useState('production')
  const [search, setSearch] = useState('')
  const [factoryFilter, setFactoryFilter] = useState('')
  const [collectionFilter, setCollectionFilter] = useState('')
  const [showOnlyStuck, setShowOnlyStuck] = useState(false)
  const [sortBy, setSortBy] = useState('pieces')
  const [lb, setLb] = useState(null)
  // v13.64 — panorama inteligente do produto (clique no card)
  const [panoramaId, setPanoramaId] = useState(null)

  const [factories, setFactories] = useState(factoriesProp || [])
  const [collections, setCollections] = useState(collectionsProp || [])

  useEffect(() => {
    if (!factoriesProp) listFactories().then(setFactories).catch(() => setFactories([]))
    if (!collectionsProp) listCollections().then(setCollections).catch(() => setCollections([]))
  }, [factoriesProp, collectionsProp])

  // ═════════ INDEX: (produto, cor) → PEÇAS + pedidos ativos ═════════
  // v13.61 — antes contava "quantos itens de pedido", agora soma QUANTIDADES
  // e guarda os pedidos (com chegada/atraso) pra vincular na tela.
  const colorOrderIndex = useMemo(() => {
    const lead = computeFactoryLeadTime(orders)
    const idx = new Map()
    for (const o of orders) {
      if (o.status !== 'sent' && o.status !== 'manufacturing') continue
      if (o.deleted_at || o.purged_at) continue
      const delay = computeOrderDelay(o, lead)
      const orderInfo = {
        id: o.id,
        name: o.order_name || o.factory,
        status: o.status,
        expectedArrival: o.expected_arrival || null,
        isLate: !!delay?.isLate,
        daysLate: delay?.daysLate || 0,
      }
      for (const it of (o.items || [])) {
        if (!it.product_id) continue
        for (const c of (it.colors || [])) {
          if (!c.code) continue
          const key = `${it.product_id}|${c.code.trim().toLowerCase()}`
          const cur = idx.get(key) || { qty: 0, orders: new Map() }
          cur.qty += Number(c.qty) || 0
          if (!cur.orders.has(o.id)) cur.orders.set(o.id, orderInfo)
          idx.set(key, cur)
        }
      }
    }
    return idx
  }, [orders])

  // ═════════ PRODUCTION: agrupa por produto (com peças e pedidos) ═════════
  const productionGroups = useMemo(() => {
    const groups = new Map()
    for (const p of products) {
      for (const cv of (p.color_variants || [])) {
        if (cv.status !== 'production') continue
        if (!groups.has(p.id)) groups.set(p.id, { product: p, cores: [] })
        const info = colorOrderIndex.get(`${p.id}|${(cv.code || '').trim().toLowerCase()}`)
        groups.get(p.id).cores.push({
          code: cv.code,
          sku: cv.sku,
          colorData: colors.find(c => c.code === cv.code),
          qty: info?.qty || 0,
          hasOrder: !!info,
          orders: info ? [...info.orders.values()] : [],
        })
      }
    }
    // Totais e pedidos distintos por produto
    return [...groups.values()].map(g => {
      const orderMap = new Map()
      for (const c of g.cores) for (const o of c.orders) if (!orderMap.has(o.id)) orderMap.set(o.id, o)
      return {
        ...g,
        totalQty: g.cores.reduce((s, c) => s + c.qty, 0),
        orders: [...orderMap.values()],
      }
    })
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
      .map(g => ({ ...g, totalQty: g.cores.reduce((s, c) => s + c.qty, 0) }))

    const sortFn = {
      pieces: (a, b) => b.totalQty - a.totalQty || (a.product.name || '').localeCompare(b.product.name || ''),
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
      totalQty: groups.reduce((s, g) => s + g.totalQty, 0),
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

  // ═════════ KPIs ═════════
  const totalPiecesProduction = productionGroups.reduce((s, g) => s + g.totalQty, 0)
  const totalCoresProduction = productionGroups.reduce((s, g) => s + g.cores.length, 0)
  const totalStuck = productionGroups.reduce((s, g) => s + g.cores.filter(c => !c.hasOrder).length, 0)
  const transitPieces = transitByOrder.reduce((s, t) =>
    s + t.products.reduce((s2, p) => s2 + p.cores.reduce((s3, c) => s3 + (c.qty || 0), 0), 0), 0)
  const nextArrival = transitByOrder
    .map(t => t.expectedArrival)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0] || null

  const hasFilters = !!(search || factoryFilter || collectionFilter || showOnlyStuck)
  const clearFilters = () => {
    setSearch(''); setFactoryFilter(''); setCollectionFilter(''); setShowOnlyStuck(false)
  }

  return (
    <div className="producao-page">
      <style>{PRODUCAO_STYLES}</style>
      {lb && <Lightbox src={lb} onClose={() => setLb(null)} />}

      {/* ═════════ HEADER + KPIs ═════════ */}
      <div className="prd-header-compact">
        <div className="prd-header-left">
          <h1 className="prd-title-compact">Produç<em>ão</em></h1>
        </div>
        <div className="prd-kpis">
          <div className="prd-kpi">
            <div className="prd-kpi-val">{totalPiecesProduction.toLocaleString('pt-BR')}</div>
            <div className="prd-kpi-lbl">peças em produção</div>
          </div>
          <div className="prd-kpi">
            <div className="prd-kpi-val">{productionGroups.length}</div>
            <div className="prd-kpi-lbl">produtos</div>
          </div>
          <div className="prd-kpi">
            <div className="prd-kpi-val">{totalCoresProduction}{totalStuck > 0 && <span className="prd-kpi-warn" title="Cores em produção sem nenhum pedido ativo"> · {totalStuck}⚠</span>}</div>
            <div className="prd-kpi-lbl">cores{totalStuck > 0 ? ' · sem pedido' : ''}</div>
          </div>
          <div className="prd-kpi">
            <div className="prd-kpi-val">{transitPieces.toLocaleString('pt-BR')}</div>
            <div className="prd-kpi-lbl">peças em trânsito</div>
          </div>
          {nextArrival && (
            <div className="prd-kpi">
              <div className="prd-kpi-val">{formatDate(nextArrival, 'full')}</div>
              <div className="prd-kpi-lbl">próxima chegada</div>
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
              🏭 Em produção <span className="prd-tab-count">{totalPiecesProduction.toLocaleString('pt-BR')} pç</span>
            </button>
            <button
              className={`prd-tab ${tab === 'in_transit' ? 'active' : ''}`}
              onClick={() => setTab('in_transit')}
            >
              ✈ Em trânsito <span className="prd-tab-count">{transitPieces.toLocaleString('pt-BR')} pç</span>
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
                <option value="pieces">Mais peças</option>
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
            onOpenOrder={onOpenOrder}
            onOpenPanorama={setPanoramaId}
          />
        ) : (
          <TransitContent
            byOrder={filteredTransitByOrder}
            hasFilters={hasFilters}
            onPhotoClick={setLb}
            onOpenOrder={onOpenOrder}
          />
        )}
      </div>

      {/* v13.64 — Panorama inteligente do produto */}
      {panoramaId && (() => {
        const g = productionGroups.find(x => x.product.id === panoramaId)
        if (!g) return null
        return (
          <ProductPanorama
            group={g}
            orders={orders}
            colors={colors}
            perm={perm}
            shopifyCache={shopifyCache}
            onOpenOrder={onOpenOrder}
            onPhotoClick={setLb}
            onClose={() => setPanoramaId(null)}
          />
        )
      })()}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═════════════════════════════════════════════════════════════

function ProductionContent({ byFactory, hasFilters, onPhotoClick, onOpenOrder, onOpenPanorama }) {
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
      {byFactory.map(({ factoryName, groups, totalCores, totalQty, stuckCores }, idx) => (
        <div className="prd-factory-group" key={factoryName} style={{ animationDelay: `${idx * 0.08}s` }}>
          <div className="prd-factory-sep">
            <div className="prd-factory-name">
              <em>{factoryName}</em>
            </div>
            <div className="prd-factory-meta">
              <span className="prd-factory-qty">{totalQty.toLocaleString('pt-BR')} peças</span>
              {' '}· {groups.length} produto{groups.length !== 1 ? 's' : ''} · {totalCores} cor{totalCores !== 1 ? 'es' : ''}
              {stuckCores > 0 && <span className="stuck-inline"> · {stuckCores} sem pedido</span>}
            </div>
          </div>
          <div className="prd-card-grid">
            {groups.map((g, i) => (
              <ProductCard
                key={g.product.id}
                group={g}
                staggerDelay={i * 0.04}
                onPhotoClick={onPhotoClick}
                onOpenOrder={onOpenOrder}
                onOpenPanorama={onOpenPanorama}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function ProductCard({ group, staggerDelay, onPhotoClick, onOpenOrder, onOpenPanorama }) {
  const { product, cores, totalQty, orders = [] } = group
  const photoUrl = product.card_image_url || (product.photos || [])[0]
  const stuckCount = cores.filter(c => !c.hasOrder).length
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
      { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <article
      ref={cardRef}
      className={`prd-product-card clickable ${revealed ? 'revealed' : ''}`}
      style={{ transitionDelay: `${staggerDelay}s` }}
      onClick={() => onOpenPanorama && onOpenPanorama(product.id)}
      title="Clique pra ver o panorama completo deste produto"
    >
      <div
        className="prd-photo-wrap"
        onClick={(e) => { e.stopPropagation(); if (photoUrl) onPhotoClick(photoUrl) }}
        title={photoUrl ? 'Clique para ampliar a foto' : ''}
      >
        {photoUrl ? (
          <img className="primary" src={photoUrl} alt={product.name} loading="lazy" />
        ) : (
          <div className="prd-photo-placeholder"><span>👑</span></div>
        )}
      </div>

      <div className="prd-info">
        {/* Nome + TOTAL DE PEÇAS (a pergunta nº1: quantas peças deste produto?) */}
        <div className="prd-prod-head">
          <h2 className="prd-prod-name">{product.name || 'Sem nome'}</h2>
          <div className={`prd-prod-total ${totalQty === 0 ? 'zero' : ''}`} title={totalQty === 0 ? 'Nenhuma peça em pedido ativo' : 'Peças somadas dos pedidos ativos'}>
            {totalQty > 0 ? <>{totalQty.toLocaleString('pt-BR')}<small> pç</small></> : '0 pç'}
          </div>
        </div>
        {product.collection && <div className="prd-prod-meta"><span className="prd-collection">{product.collection}</span></div>}

        {/* v13.64 — Cores como SWATCHES grandes (os pontinhos de 20px eram ilegíveis) */}
        <div className="prd-sw-grid">
          {cores.map((c, idx) => (
            <div
              key={`${c.code}-${idx}`}
              className={`prd-sw ${!c.hasOrder ? 'stuck' : ''}`}
              onClick={(e) => { e.stopPropagation(); if (c.colorData?.photo_url) onPhotoClick(c.colorData.photo_url) }}
              title={c.hasOrder
                ? `${c.code}${c.colorData?.name_pt ? ' · ' + c.colorData.name_pt : ''} — ${c.qty} peça${c.qty !== 1 ? 's' : ''} em pedido ativo`
                : `${c.code}${c.colorData?.name_pt ? ' · ' + c.colorData.name_pt : ''} — em produção SEM pedido ativo`}
            >
              <div className="prd-sw-img" style={{ background: c.colorData?.hex || 'var(--border-light)' }}>
                {c.colorData?.photo_url && <img src={c.colorData.photo_url} alt={c.code} loading="lazy" />}
                {c.hasOrder
                  ? <span className="prd-sw-qty">×{c.qty}</span>
                  : <span className="prd-sw-alert" title="Sem pedido ativo">!</span>}
              </div>
              <div className="prd-sw-code">{c.code}</div>
            </div>
          ))}
        </div>

        {/* Pedidos vinculados (clicáveis) com chegada/atraso */}
        {(orders.length > 0 || stuckCount > 0) && (
          <div className="prd-order-chips">
            {orders.map(o => (
              <button
                key={o.id}
                className={`prd-order-chip ${o.isLate ? 'late' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (onOpenOrder) onOpenOrder(o.id) }}
                title={onOpenOrder ? 'Abrir o pedido' : undefined}
              >
                📋 {o.name}
                {o.isLate
                  ? <span className="prd-chip-late">atrasado {o.daysLate}d</span>
                  : (o.expectedArrival ? <span className="prd-chip-eta">chega {formatDate(o.expectedArrival, 'full')}</span> : null)}
              </button>
            ))}
            {stuckCount > 0 && orders.length === 0 && (
              <span className="prd-order-chip none">⚠ nenhum pedido ativo — considere encomendar ou tirar de produção</span>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function TransitContent({ byOrder, hasFilters, onPhotoClick, onOpenOrder }) {
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
        <TransitCard key={t.order.id} transit={t} index={idx} onPhotoClick={onPhotoClick} onOpenOrder={onOpenOrder} />
      ))}
    </>
  )
}

function TransitCard({ transit, index, onPhotoClick, onOpenOrder }) {
  const { order, orderDate, expectedArrival, products } = transit
  const totalPieces = products.reduce((s, p) =>
    s + p.cores.reduce((s2, c) => s2 + (c.qty || 0), 0), 0)
  const cardRef = useRef(null)
  const [revealed, setRevealed] = useState(false)

  // Dias até a chegada (ou desde a data prevista, se passou)
  const etaDays = expectedArrival
    ? Math.ceil((new Date(expectedArrival) - Date.now()) / 86400000)
    : null

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
          <h3
            className={onOpenOrder ? 'clickable' : ''}
            onClick={() => onOpenOrder && onOpenOrder(order.id)}
            title={onOpenOrder ? 'Abrir o pedido' : undefined}
          >{order.order_name || order.factory}</h3>
          {etaDays != null && (
            <span className={`prd-eta-badge ${etaDays < 0 ? 'late' : (etaDays <= 7 ? 'soon' : '')}`}>
              {etaDays < 0
                ? `previsto há ${Math.abs(etaDays)}d`
                : etaDays === 0 ? 'chega hoje' : `chega em ${etaDays}d`}
            </span>
          )}
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
          <span><strong>{totalPieces}</strong> peça{totalPieces !== 1 ? 's' : ''}</span>
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
        <div className="prd-pills">
          {cores.map((c, idx) => (
            <div
              key={`${c.code}-${idx}`}
              className="prd-pill"
              onClick={(e) => {
                e.stopPropagation()
                if (c.colorData?.photo_url) onPhotoClick(c.colorData.photo_url)
              }}
              title={c.colorData?.name_pt || c.code}
            >
              <span className="prd-pill-dot" style={{ background: c.colorData?.hex || 'var(--border-light)' }}>
                {c.colorData?.photo_url && <img src={c.colorData.photo_url} alt="" loading="lazy" />}
              </span>
              <span className="prd-pill-code">{c.code}</span>
              <span className="prd-pill-qty">×{c.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// v13.64 — PANORAMA DO PRODUTO: tudo que a dona quer saber num clique:
// quantas peças, de quais cores, em qual pedido, há quanto tempo, atrasado?,
// quando chega, quanto custa chegando, histórico do modelo e loja (se vinculado).
// ═════════════════════════════════════════════════════════════
function ProductPanorama({ group, orders, colors, perm, shopifyCache, onOpenOrder, onPhotoClick, onClose }) {
  const { product, cores, totalQty } = group
  const photoUrl = product.card_image_url || (product.photos || [])[0]

  const data = useMemo(() => {
    const lead = computeFactoryLeadTime(orders)
    const active = []
    let histQty = 0, histOrders = 0, lastDate = null
    for (const o of orders) {
      if (o.deleted_at || o.purged_at) continue
      const item = (o.items || []).find(it => it.product_id === product.id)
      if (!item) continue
      const qty = (item.colors || []).reduce((s, c) => s + (Number(c.qty) || 0), 0)
        + (((item.colors || []).length === 0) ? Number(item.quantity || 0) : 0)
      if (['sent', 'manufacturing', 'in_transit', 'completed'].includes(o.status)) {
        histQty += qty; histOrders++
        const t = o.order_date || o.created_at
        if (t && (!lastDate || new Date(t) > new Date(lastDate))) lastDate = t
      }
      if (o.status === 'sent' || o.status === 'manufacturing') {
        const delay = computeOrderDelay(o, lead)
        const start = o.order_date || o.manufacturing_started_at || o.created_at
        const elapsed = start ? Math.max(0, Math.floor((Date.now() - new Date(start)) / 86400000)) : null
        const deadline = o.promised_lead_days || delay?.deadlineDays || null
        const pu = parseFloat(item.price_usd_snapshot ?? item.price_usd) || 0
        const fob = (item.colors || []).reduce((s, c) => {
          const cp = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : pu
          return s + (Number(c.qty) || 0) * (cp || 0)
        }, 0)
        const factor = parseFloat(o.conversion_factor) || 1.65
        const fx = parseFloat(o.budget_rate) || 0
        active.push({
          id: o.id,
          name: o.order_name || o.factory,
          status: o.status,
          statusLabel: o.status === 'sent' ? 'em revisão' : 'em fabricação',
          expectedArrival: o.expected_arrival || null,
          elapsed, deadline,
          isLate: !!delay?.isLate,
          daysLate: delay?.daysLate || 0,
          qty, fob,
          landed: fx > 0 && fob > 0 ? fob * factor * fx : null,
        })
      }
    }
    return {
      active,
      histQty, histOrders, lastDate,
      price: priceSignalForModel(product.id, orders),
      usual: suggestColorsForModel(product.id, orders).slice(0, 6),
    }
  }, [orders, product.id])

  // Loja (se algum SKU das cores está vinculado ao cache da Shopify)
  const shop = useMemo(() => {
    const skus = (product.color_variants || []).map(cv => (cv.sku || '').trim()).filter(Boolean)
    if (skus.length === 0 || !shopifyCache?.products) return null
    const set = new Set(skus.map(s => s.toUpperCase()))
    let stock = 0, matched = 0, sold = 0
    for (const p of shopifyCache.products) {
      for (const v of (p.variants || [])) {
        if (v?.sku && set.has(String(v.sku).toUpperCase())) { matched++; stock += v.inventory_quantity || 0 }
      }
    }
    for (const so of (shopifyCache.orders || [])) {
      for (const li of (so.line_items || [])) {
        if (li?.sku && set.has(String(li.sku).toUpperCase())) sold += li.quantity || 0
      }
    }
    if (matched === 0 && sold === 0) return null
    const ageDays = shopifyCache.last_sync ? Math.floor((Date.now() - new Date(shopifyCache.last_sync)) / 86400000) : null
    return { stock, sold, ageDays }
  }, [product.color_variants, shopifyCache])

  const fmtR$ = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')

  return (
    <Modal onClose={onClose} width={780} allowOutsideClose zIndex={950}>
      <MH title={`📊 ${UC(product.name || '')} — panorama`} onClose={onClose} />
      <MB>
        {/* Cabeçalho: foto + identidade + totais */}
        <div className="prd-pan-head">
          <div className="prd-pan-photo" onClick={() => photoUrl && onPhotoClick(photoUrl)} title={photoUrl ? 'Ampliar' : ''}>
            {photoUrl ? <img src={photoUrl} alt="" /> : <span style={{ fontSize: 34, opacity: .3 }}>👑</span>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="prd-pan-meta">
              {product.factory_code && <span className="mono">{product.factory_code}</span>}
              {product.factory && <span>🏭 {product.factory}</span>}
              {product.collection && <span style={{ fontStyle: 'italic' }}>{product.collection}</span>}
            </div>
            <div className="prd-pan-total">
              {totalQty.toLocaleString('pt-BR')}<small> peças em produção agora</small>
            </div>
            <div className="prd-pan-hist">
              {data.histOrders > 0
                ? <>Histórico: <strong>{data.histQty.toLocaleString('pt-BR')} peças</strong> em {data.histOrders} pedido{data.histOrders !== 1 ? 's' : ''}{data.lastDate ? ` · último em ${formatDate(data.lastDate, 'full')}` : ''}</>
                : 'Primeiro pedido deste modelo.'}
              {perm.prices && data.price?.lastPrice != null && (
                <span className={`prd-pan-price ${data.price.hasIncreaseAlert ? 'alert' : ''}`}
                  title={`${data.price.count} registro(s) de preço no histórico`}>
                  {data.price.trend === 'up' ? '📈' : data.price.trend === 'down' ? '📉' : '💲'} última FOB ${data.price.lastPrice.toFixed(2)}
                  {data.price.hasIncreaseAlert && data.price.lastIncreasePct != null ? ` · subiu ${Math.round(data.price.lastIncreasePct)}%` : ''}
                </span>
              )}
            </div>
            {shop && (
              <div className="prd-pan-shop" title="Somado dos SKUs vinculados das cores deste produto">
                🛒 Na loja: <strong>{shop.stock}</strong> em estoque · <strong>{shop.sold}</strong> vendidas (6m)
                {shop.ageDays != null && shop.ageDays > 7 && (
                  <span className="prd-pan-shop-age"> ⚠ dados de {shop.ageDays}d atrás — sincronize na aba Shopify</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Pedidos ativos com barra de prazo */}
        <div className="prd-pan-sec">Pedidos ativos com este modelo</div>
        {data.active.length === 0 && (
          <div className="prd-pan-none">⚠ Nenhum pedido ativo — as cores abaixo estão em produção sem encomenda. Considere encomendar ou tirar de produção.</div>
        )}
        {data.active.map(o => {
          const pct = o.deadline && o.elapsed != null ? Math.min(130, Math.round(o.elapsed / o.deadline * 100)) : null
          return (
            <div key={o.id} className="prd-pan-order">
              <div className="prd-pan-order-top">
                <button className="prd-pan-order-name" onClick={() => onOpenOrder && onOpenOrder(o.id)} title="Abrir o pedido">
                  📋 {o.name}
                </button>
                <span className="prd-pan-order-status">{o.statusLabel}</span>
                <span className="prd-pan-order-qty">{o.qty} pç deste modelo</span>
                {perm.prices && o.fob > 0 && (
                  <span className="prd-pan-order-fob" title={o.landed ? 'FOB deste modelo neste pedido · custo estimado chegando (fator × dólar do pedido)' : 'FOB deste modelo neste pedido'}>
                    FOB ${o.fob.toFixed(2)}{o.landed ? ` · ≈ ${fmtR$(o.landed)} chegando` : ''}
                  </span>
                )}
              </div>
              <div className="prd-pan-order-sub">
                {o.elapsed != null && <span>{o.elapsed} dia{o.elapsed !== 1 ? 's' : ''} corridos</span>}
                {o.deadline && <span> · prazo {o.deadline}d</span>}
                {o.isLate && <span className="late"> · atrasado {o.daysLate}d</span>}
                {o.expectedArrival && <span> · 📅 chega {formatDate(o.expectedArrival, 'full')}</span>}
              </div>
              {pct != null && (
                <div className="prd-pan-bar" title={`${pct}% do prazo decorrido`}>
                  <div className={`prd-pan-bar-fill ${pct > 100 ? 'late' : pct > 80 ? 'soon' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              )}
            </div>
          )
        })}

        {/* Cores desta produção — swatches GRANDES */}
        <div className="prd-pan-sec">Cores em produção</div>
        <div className="prd-sw-grid lg">
          {cores.map((c, idx) => (
            <div
              key={`${c.code}-${idx}`}
              className={`prd-sw lg ${!c.hasOrder ? 'stuck' : ''}`}
              onClick={() => c.colorData?.photo_url && onPhotoClick(c.colorData.photo_url)}
              title={c.colorData?.name_pt || c.code}
            >
              <div className="prd-sw-img" style={{ background: c.colorData?.hex || 'var(--border-light)' }}>
                {c.colorData?.photo_url && <img src={c.colorData.photo_url} alt={c.code} loading="lazy" />}
                {c.hasOrder
                  ? <span className="prd-sw-qty">×{c.qty}</span>
                  : <span className="prd-sw-alert">!</span>}
              </div>
              <div className="prd-sw-code">{c.code}</div>
              {c.colorData?.name_pt && <div className="prd-sw-name">{c.colorData.name_pt}</div>}
            </div>
          ))}
        </div>

        {/* Cores usuais do modelo (histórico) */}
        {data.usual.length > 0 && (
          <div className="prd-pan-usual">
            ↻ Costuma pedir: {data.usual.map(u => `${u.code} (~${u.avgQty})`).join(' · ')}
          </div>
        )}
      </MB>
    </Modal>
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

/* ═══ HEADER + KPIs ═══ */
.prd-header-compact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 0 14px;
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
.prd-kpis {
  display: flex;
  gap: 26px;
  flex-wrap: wrap;
  align-items: flex-end;
}
.prd-kpi { text-align: right; }
.prd-kpi-val {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 24px;
  font-weight: 500;
  line-height: 1.05;
  color: var(--text);
  letter-spacing: -0.02em;
}
.prd-kpi-warn { color: var(--accent); font-size: 15px; font-weight: 600; }
.prd-kpi-lbl {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-top: 3px;
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
  margin-bottom: 36px;
  opacity: 0;
  animation: prdFactoryIn .5s cubic-bezier(.2,.9,.3,1) forwards;
}
@keyframes prdFactoryIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
.prd-factory-sep {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 14px;
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
}
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
.prd-factory-qty { color: var(--text); font-weight: 600; font-size: 11px; }
.stuck-inline { color: var(--accent); font-weight: 600; }

/* ═══ CARD GRID — 2 colunas ═══ */
.prd-card-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
@media (max-width: 1100px) {
  .prd-card-grid { grid-template-columns: 1fr; }
}

/* ═══ PRODUCT CARD (denso: foto 96px, peças em destaque) ═══ */
.prd-product-card {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 14px;
  padding: 14px;
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
  transition: transform .6s cubic-bezier(.2,.9,.3,1);
}
.prd-product-card:hover .prd-photo-wrap img { transform: scale(1.05); }
.prd-photo-placeholder {
  width: 100%; height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  opacity: .3;
}

/* Info col */
.prd-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 8px;
}
.prd-prod-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.prd-prod-name {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 500;
  font-size: 19px;
  line-height: 1.1;
  letter-spacing: -0.015em;
  color: var(--text);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prd-prod-total {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 17px;
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
  flex-shrink: 0;
}
.prd-prod-total small {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: .75;
}
.prd-prod-total.zero { color: var(--text-muted); font-weight: 400; }
.prd-prod-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: -4px;
}
.prd-collection {
  color: var(--text-secondary);
  font-style: italic;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 12px;
}

/* ═══ PILLS de cor com quantidade (produção + trânsito) ═══ */
.prd-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.prd-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  cursor: zoom-in;
  transition: transform .15s, border-color .15s;
}
.prd-pill:hover {
  transform: scale(1.04);
  border-color: var(--accent);
}
.prd-pill-dot {
  width: 20px; height: 20px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid rgba(0,0,0,.06);
  display: inline-flex;
}
[data-theme="dark"] .prd-pill-dot { border-color: rgba(255,255,255,.08); }
.prd-pill-dot img {
  width: 100%; height: 100%;
  object-fit: cover;
}
.prd-pill-code {
  font-family: 'DM Mono', ui-monospace, monospace;
  letter-spacing: 0.02em;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prd-pill-qty {
  background: var(--text);
  color: var(--bg);
  padding: 1px 7px;
  border-radius: 8px;
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
}
.prd-pill.stuck {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  animation: prdStuckPulse 3s ease-in-out infinite;
}
.prd-pill-warn {
  color: var(--accent);
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
@keyframes prdStuckPulse {
  0%, 100% { box-shadow: 0 0 0 1px var(--accent); }
  50% { box-shadow: 0 0 0 1px var(--accent), 0 0 0 5px rgba(198,168,108,.14); }
}

/* ═══ v13.64 — SWATCHES grandes de cor (card + panorama) ═══ */
.prd-sw-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.prd-sw {
  width: 52px;
  cursor: zoom-in;
  text-align: center;
}
.prd-sw.lg { width: 74px; }
.prd-sw-img {
  position: relative;
  width: 52px; height: 52px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(0,0,0,.08);
  transition: transform .2s cubic-bezier(.2,.9,.3,1), box-shadow .2s;
}
.prd-sw.lg .prd-sw-img { width: 74px; height: 74px; border-radius: 12px; }
[data-theme="dark"] .prd-sw-img { border-color: rgba(255,255,255,.1); }
.prd-sw-img img {
  width: 100%; height: 100%;
  object-fit: cover;
}
.prd-sw:hover .prd-sw-img {
  transform: translateY(-2px) scale(1.06);
  box-shadow: 0 8px 18px rgba(74,25,66,.18);
}
.prd-sw-qty {
  position: absolute;
  bottom: 3px; right: 3px;
  background: rgba(20,14,18,.82);
  color: #fff;
  padding: 1px 6px;
  border-radius: 8px;
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  backdrop-filter: blur(2px);
}
.prd-sw.lg .prd-sw-qty { font-size: 12px; padding: 2px 8px; }
.prd-sw-alert {
  position: absolute;
  top: 3px; right: 3px;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
.prd-sw.stuck .prd-sw-img {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent);
}
.prd-sw-code {
  margin-top: 4px;
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prd-sw.lg .prd-sw-code { font-size: 10px; font-weight: 600; }
.prd-sw-name {
  font-size: 9px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prd-product-card.clickable { cursor: pointer; }

/* ═══ v13.64 — PANORAMA do produto ═══ */
.prd-pan-head {
  display: flex;
  gap: 16px;
  margin-bottom: 6px;
}
.prd-pan-photo {
  width: 108px; height: 142px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--border-light);
  flex-shrink: 0;
  cursor: zoom-in;
  display: flex; align-items: center; justify-content: center;
}
.prd-pan-photo img { width: 100%; height: 100%; object-fit: cover; }
.prd-pan-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.prd-pan-meta .mono { font-family: 'DM Mono', ui-monospace, monospace; font-size: 11px; }
.prd-pan-total {
  font-family: 'Fraunces', Georgia, serif;
  font-size: 34px;
  font-weight: 500;
  color: var(--accent);
  line-height: 1;
  letter-spacing: -0.02em;
}
.prd-pan-total small {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-left: 8px;
}
.prd-pan-hist {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.prd-pan-price {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 10px;
  background: #EEF2F7;
  color: #475569;
  font-family: 'DM Mono', ui-monospace, monospace;
}
.prd-pan-price.alert { background: #FEE2E2; color: #991B1B; }
.prd-pan-shop {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.prd-pan-shop-age { color: #B45309; font-size: 11px; }
.prd-pan-sec {
  margin: 16px 0 8px;
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-light);
  padding-bottom: 4px;
}
.prd-pan-none {
  padding: 10px 14px;
  background: rgba(198,168,108,.1);
  border: 1px dashed var(--accent);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text);
}
.prd-pan-order {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 8px;
  background: var(--surface);
}
.prd-pan-order-top {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.prd-pan-order-name {
  background: none;
  border: none;
  padding: 0;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.prd-pan-order-name:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.prd-pan-order-status {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 8px;
}
.prd-pan-order-qty {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
}
.prd-pan-order-fob {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: auto;
}
.prd-pan-order-sub {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}
.prd-pan-order-sub .late { color: #DC2626; font-weight: 700; }
.prd-pan-bar {
  margin-top: 7px;
  height: 6px;
  border-radius: 4px;
  background: var(--border-light);
  overflow: hidden;
}
.prd-pan-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: #059669;
  transition: width .4s cubic-bezier(.2,.9,.3,1);
}
.prd-pan-bar-fill.soon { background: #F59E0B; }
.prd-pan-bar-fill.late { background: #DC2626; }
.prd-pan-usual {
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: 'DM Mono', ui-monospace, monospace;
}

/* ═══ CHIPS de pedido vinculado ═══ */
.prd-order-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
}
.prd-order-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: 12px;
  font-size: 10.5px;
  font-family: inherit;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all .15s;
}
.prd-order-chip:hover {
  border-style: solid;
  border-color: var(--accent);
  color: var(--text);
}
.prd-order-chip.late { border-color: #DC2626; }
.prd-order-chip.none {
  cursor: default;
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.prd-chip-eta {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.prd-chip-late {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  color: #DC2626;
  letter-spacing: 0.04em;
  text-transform: uppercase;
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
.prd-transit-name h3.clickable { cursor: pointer; }
.prd-transit-name h3.clickable:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.prd-eta-badge {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 3px 10px;
  border-radius: 10px;
  background: var(--accent-light);
  color: var(--text);
}
.prd-eta-badge.soon { background: #FEF3C7; color: #92400E; }
.prd-eta-badge.late { background: #FEE2E2; color: #991B1B; }
.prd-transit-meta {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}
.prd-transit-meta strong { color: var(--text); }
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
    grid-template-columns: 80px 1fr;
    padding: 12px;
    gap: 12px;
  }
  .prd-prod-name { font-size: 16px; }
  .prd-title-compact { font-size: 26px; }
  .prd-kpis { gap: 16px; }
  .prd-kpi-val { font-size: 19px; }
}
`
