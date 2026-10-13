// src/pages/Producao.jsx
// v13.76 — Produção redesenhada (pedido da dona: "fontes feias, cores feias,
// não está inteligente — faça com calma e mais profissional").
//
// O que a página responde, de cima pra baixo:
//   1. Quanto está sendo fabricado, quanto vem no navio, quando chega o próximo
//      lote e QUANTOS MODELOS VÃO FALTAR NA LOJA antes do lote chegar.
//   2. Por fábrica: cada modelo com as cores (foto + código inteiro + peças),
//      os pedidos dele e a situação na loja — estoque, venda/dia e se o estoque
//      acaba antes de chegar ("a loja fica ~46 dias sem").
//
// Dados: peças vêm dos PEDIDOS (lib/production.js, v13.73); loja vem do cache
// da Shopify (lib/restock.js, v13.75). Visual: Inter, fundo neutro, uma cor por
// situação, vermelho só pra risco real. Estilos em styles/producao.css (pd-).
// O panorama do modelo (clique no card) continua com os estilos prd- abaixo.

import { useState, useMemo, useEffect } from 'react'
import { Lightbox, Modal, MH, MB } from '../components/ui'
import { listFactories } from '../lib/data/misc'
import { computeFactoryLeadTime, computeOrderDelay } from '../lib/pendencias'
import { priceSignalForModel, suggestColorsForModel } from '../lib/orderIntelligence'
import { formatDate, UC, parseDateLocal } from '../lib/utils'
import { buildProductionView, soonestEta } from '../lib/production'
import { buildStoreIndex, storeSignalForProduct } from '../lib/restock'
import { shopifyCoverageDays, coverageLabel } from '../lib/shopifySlim'
import '../styles/producao.css'

const DAY = 86400000
const nf = (n) => Math.round(n || 0).toLocaleString('pt-BR')
const perDayFmt = (v) => (v >= 1 ? v.toFixed(1) : v.toFixed(2)).replace('.', ',')
// Código de cor quebra só depois da barra ("NTPN4/16A/613"), nunca no meio da palavra
const Code = ({ code }) => String(code).split('/').map((part, i, arr) => (
  <span key={i}>{part}{i < arr.length - 1 && <>/<wbr /></>}</span>
))
// Estoque que acaba logo e lote sem previsão de chegada: vale um aviso
const SOON_DAYS = 45

const SORTS = [
  { id: 'risk', label: 'Risco de faltar na loja' },
  { id: 'pieces', label: 'Mais peças' },
  { id: 'arrival', label: 'Chega primeiro' },
  { id: 'alpha', label: 'A–Z' },
]

// Situação na loja de um modelo, comparada com quando o lote chega
function storeOutlook(store, eta) {
  if (!store || store.matchedBy == null) return null
  const coverDays = store.perDay > 0 ? Math.floor(store.stock / store.perDay) : null
  let gapDays = null
  if (coverDays != null && eta?.etaDays != null) {
    const g = eta.etaDays - coverDays
    gapDays = g > 0 ? g : 0
  }
  return { ...store, coverDays, gapDays }
}

export default function ProducaoPage({
  products = [],
  orders = [],
  colors = [],
  factories: factoriesProp,
  perm = {},
  shopifyCache = null,
  onOpenOrder,
}) {
  const [tab, setTab] = useState('production')
  const [search, setSearch] = useState('')
  const [factoryFilter, setFactoryFilter] = useState('')
  const [sortBy, setSortBy] = useState('risk')
  const [lb, setLb] = useState(null)
  const [panoramaId, setPanoramaId] = useState(null)
  const [factories, setFactories] = useState(factoriesProp || [])

  useEffect(() => {
    if (!factoriesProp) listFactories().then(setFactories).catch(() => setFactories([]))
  }, [factoriesProp])

  // ═════════ DADOS ═════════
  const view = useMemo(() => buildProductionView({ products, orders, colors }), [products, orders, colors])
  const storeIndex = useMemo(() => buildStoreIndex(shopifyCache), [shopifyCache])
  const hasStore = !!shopifyCache && storeIndex.coverageDays > 0

  // Cada card (fábrica × modelo) com a chegada mais próxima e a situação na loja
  const groups = useMemo(() => view.groups.map(g => {
    const eta = soonestEta(g.orders)
    const outlook = hasStore ? storeOutlook(storeSignalForProduct(g.product, storeIndex, products), eta) : null
    return { ...g, eta, outlook, outlookChecked: hasStore }
  }), [view, storeIndex, products, hasStore])

  // Modelos que vão faltar na loja antes do lote chegar (por modelo, não por card)
  const atRisk = useMemo(() => {
    const ids = new Set()
    for (const g of groups) if (g.outlook?.gapDays > 0) ids.add(g.product.id)
    return ids
  }, [groups])

  const transit = useMemo(() => orders
    .filter(o => !o.deleted_at && o.status === 'in_transit')
    .map(o => {
      const t = parseDateLocal(o.expected_arrival)?.getTime()
      const days = t != null ? Math.round((t - new Date(new Date().toDateString()).getTime()) / DAY) : null
      const models = (o.items || []).map(it => {
        const p = products.find(x => x.id === it.product_id)
        return {
          key: it.id || it.product_id,
          product: p || { name: it.product_name_snapshot || it.name_manual || 'Sem nome' },
          cores: (it.colors || []).filter(c => c.code && Number(c.qty) > 0).map(c => ({
            code: c.code, qty: Number(c.qty) || 0,
            colorData: colors.find(x => (x.code || '').toLowerCase() === c.code.toLowerCase()),
          })),
        }
      }).filter(m => m.cores.length > 0)
      const pieces = models.reduce((a, m) => a + m.cores.reduce((b, c) => b + c.qty, 0), 0)
      return { order: o, days, models, pieces }
    })
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)), [orders, products, colors])
  const transitPieces = transit.reduce((a, t) => a + t.pieces, 0)

  // ═════════ FILTRO + ORDEM ═════════
  const byFactory = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = groups
      .filter(g => !factoryFilter || g.factoryName === factoryFilter)
      .filter(g => !q
        || (g.product.name || '').toLowerCase().includes(q)
        || g.cores.some(c => (c.code || '').toLowerCase().includes(q))
        || g.orders.some(o => (o.name || '').toLowerCase().includes(q)))
    const sorters = {
      risk: (a, b) => (b.outlook?.gapDays || 0) - (a.outlook?.gapDays || 0) || b.totalQty - a.totalQty,
      pieces: (a, b) => b.totalQty - a.totalQty,
      arrival: (a, b) => (a.eta?.etaDays ?? 1e9) - (b.eta?.etaDays ?? 1e9) || b.totalQty - a.totalQty,
      alpha: (a, b) => (a.product.name || '').localeCompare(b.product.name || ''),
    }
    list.sort(sorters[sortBy] || sorters.risk)
    const m = new Map()
    for (const g of list) {
      if (!m.has(g.factoryName)) m.set(g.factoryName, [])
      m.get(g.factoryName).push(g)
    }
    return [...m.entries()].map(([name, gs]) => ({
      name,
      groups: gs,
      pieces: gs.reduce((a, g) => a + g.totalQty, 0),
      review: gs.reduce((a, g) => a + (g.reviewQty || 0), 0),
      risk: gs.filter(g => g.outlook?.gapDays > 0).length,
      eta: soonestEta(gs.flatMap(g => g.orders)),
    })).sort((a, b) => b.pieces - a.pieces)
  }, [groups, search, factoryFilter, sortBy])

  const transitShown = transit.filter(t => {
    if (factoryFilter && t.order.factory !== factoryFilter) return false
    const q = search.trim().toLowerCase()
    return !q || (t.order.order_name || '').toLowerCase().includes(q)
      || t.models.some(m => (m.product.name || '').toLowerCase().includes(q))
  })

  const k = view.kpis
  const overdue = view.overdueArrivals[0]
  const next = view.nextArrival

  return (
    <div className="pd">
      <style>{PRODUCAO_STYLES}</style>
      {lb && <Lightbox src={lb} onClose={() => setLb(null)} />}

      {/* ═════════ 1. Números que importam ═════════ */}
      <div className="pd-kpis">
        <div className="pd-kpi">
          <span className="pd-kpi-label">Sendo fabricado</span>
          <span className="pd-kpi-value">{nf(k.manufacturingQty)} <small>peças</small></span>
          <span className="pd-kpi-sub">{k.reviewQty > 0 ? `+ ${nf(k.reviewQty)} em revisão` : `${k.products} modelos`}</span>
        </div>
        <button type="button" className="pd-kpi clickable" onClick={() => setTab('in_transit')}>
          <span className="pd-kpi-label">A caminho</span>
          <span className="pd-kpi-value">{nf(transitPieces)} <small>peças</small></span>
          <span className="pd-kpi-sub">{transit.length} pedido{transit.length !== 1 ? 's' : ''} em trânsito</span>
        </button>
        {overdue ? (
          <button type="button" className="pd-kpi clickable bad" onClick={() => onOpenOrder && onOpenOrder(overdue.id)}>
            <span className="pd-kpi-label">Chegada vencida</span>
            <span className="pd-kpi-value">{overdue.daysOverdue} <small>dias</small></span>
            <span className="pd-kpi-sub">{overdue.name} — já chegou?</span>
          </button>
        ) : (
          <div className="pd-kpi">
            <span className="pd-kpi-label">Próxima chegada</span>
            <span className="pd-kpi-value">{next ? formatDate(next.expectedArrival, 'full') : '—'}</span>
            <span className="pd-kpi-sub">{next ? next.name : 'nenhuma previsão cadastrada'}</span>
          </div>
        )}
        <div className={`pd-kpi${atRisk.size > 0 ? ' bad' : ''}`}>
          <span className="pd-kpi-label">Vão faltar na loja</span>
          <span className="pd-kpi-value">{hasStore ? atRisk.size : '—'} <small>{hasStore ? `modelo${atRisk.size !== 1 ? 's' : ''}` : ''}</small></span>
          <span className="pd-kpi-sub">{hasStore ? 'estoque acaba antes do lote chegar' : 'sincronize a Shopify'}</span>
        </div>
      </div>

      {/* ═════════ 2. Controles ═════════ */}
      <div className="pd-toolbar">
        <div className="pd-seg" role="tablist">
          <button role="tab" aria-selected={tab === 'production'} className={tab === 'production' ? 'on' : ''} onClick={() => setTab('production')}>
            Em produção <span>{nf(k.totalQty)}</span>
          </button>
          <button role="tab" aria-selected={tab === 'in_transit'} className={tab === 'in_transit' ? 'on' : ''} onClick={() => setTab('in_transit')}>
            Em trânsito <span>{nf(transitPieces)}</span>
          </button>
        </div>
        <input
          className="pd-input pd-search"
          placeholder="Buscar modelo, cor ou pedido"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Buscar"
        />
        <select className="pd-input" value={factoryFilter} onChange={e => setFactoryFilter(e.target.value)} aria-label="Fábrica">
          <option value="">Todas as fábricas</option>
          {(factories || []).map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
        </select>
        {tab === 'production' && (
          <select className="pd-input" value={sortBy} onChange={e => setSortBy(e.target.value)} aria-label="Ordenar">
            {SORTS.filter(s => hasStore || s.id !== 'risk').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>

      {tab === 'production' && k.orphanCount > 0 && (
        <div className="pd-note">
          {k.orphanCount} cor{k.orphanCount !== 1 ? 'es estão marcadas' : ' está marcada'} “em produção” no cadastro sem estar em nenhum pedido.
          Elas aparecem nos cards com borda tracejada.
        </div>
      )}

      {/* ═════════ 3. Conteúdo ═════════ */}
      {tab === 'production' ? (
        byFactory.length === 0 ? (
          <div className="pd-empty">{search || factoryFilter ? 'Nada encontrado com esse filtro.' : 'Nenhum pedido em produção agora.'}</div>
        ) : byFactory.map(f => (
          <section key={f.name} className="pd-factory">
            <header className="pd-factory-head">
              <h3>{f.name}</h3>
              <span className="pd-factory-meta">
                {nf(f.pieces)} peças · {f.groups.length} modelo{f.groups.length !== 1 ? 's' : ''}
                {f.review > 0 && <> · {nf(f.review)} em revisão</>}
                {f.eta && <> · próxima chegada {f.eta.etaEstimated ? '~' : ''}{f.eta.etaDays} dias</>}
              </span>
              {f.risk > 0 && <span className="pd-pill bad">{f.risk} vão faltar na loja</span>}
            </header>
            <div className="pd-grid">
              {f.groups.map(g => (
                <ModelCard
                  key={g.key}
                  group={g}
                  coverageDays={storeIndex.coverageDays}
                  onPhoto={setLb}
                  onOpenOrder={onOpenOrder}
                  onOpen={() => setPanoramaId(g.product.id)}
                />
              ))}
            </div>
          </section>
        ))
      ) : (
        transitShown.length === 0 ? (
          <div className="pd-empty">Nenhum pedido em trânsito.</div>
        ) : transitShown.map(t => <TransitCard key={t.order.id} transit={t} onPhoto={setLb} onOpenOrder={onOpenOrder} />)
      )}

      {/* Panorama do modelo (clique no card) */}
      {panoramaId && (() => {
        const g = view.byProduct.get(panoramaId)
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
// Card de um modelo em produção numa fábrica
// ═════════════════════════════════════════════════════════════
function ModelCard({ group: g, coverageDays, onPhoto, onOpenOrder, onOpen }) {
  const photo = g.product.card_image_url || (g.product.photos || [])[0]
  const otherFactory = g.registeredFactory && g.registeredFactory !== g.factoryName
  const o = g.outlook
  const risk = o?.gapDays > 0

  return (
    <article className={`pd-card${risk ? ' risk' : ''}`} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }} title="Ver o panorama completo do modelo">
      <div className="pd-card-top">
        <button
          type="button"
          className="pd-photo"
          onClick={(e) => { e.stopPropagation(); if (photo) onPhoto(photo) }}
          aria-label={photo ? 'Ampliar foto' : undefined}
        >
          {photo ? <img src={photo} alt="" loading="lazy" /> : <span>{(g.product.name || '?').slice(0, 1)}</span>}
        </button>
        <div className="pd-card-title">
          <h4>{UC(g.product.name || 'Sem nome')}</h4>
          {otherFactory && <span className="pd-card-sub">modelo cadastrado na {g.registeredFactory}</span>}
          <div className="pd-orders">
            {g.orders.map(ord => (
              <button
                key={ord.id}
                type="button"
                className={`pd-order${ord.isLate ? ' late' : ''}`}
                onClick={(e) => { e.stopPropagation(); onOpenOrder && onOpenOrder(ord.id) }}
                title="Abrir o pedido"
              >
                {ord.name}
                <em>
                  {ord.status === 'sent' ? 'em revisão'
                    : ord.isLate ? `atrasado ${ord.daysLate} dias`
                    : ord.etaDays != null ? `${ord.etaEstimated ? '~' : ''}${ord.etaDays} dias` : 'sem previsão'}
                </em>
              </button>
            ))}
          </div>
        </div>
        <div className="pd-card-qty">
          <strong>{nf(g.totalQty)}</strong>
          <span>peças</span>
        </div>
      </div>

      <div className="pd-colors">
        {g.cores.map(c => (
          <div
            key={c.code}
            className={`pd-color${c.hasOrder ? '' : ' orphan'}`}
            title={c.hasOrder
              ? `${c.code}${c.colorData?.name_pt ? ' · ' + c.colorData.name_pt : ''}: ${c.qty} peças${c.qtyReview ? ` (${c.qtyReview} em revisão)` : ''}`
              : `${c.code}: marcada "em produção" no cadastro, mas não está em nenhum pedido`}
          >
            <span className="pd-swatch" style={{ background: c.colorData?.hex || 'var(--line)' }}>
              {c.colorData?.photo_url && <img src={c.colorData.photo_url} alt="" loading="lazy" />}
            </span>
            <span className="pd-color-code"><Code code={c.code} /></span>
            <span className="pd-color-qty">{c.hasOrder ? nf(c.qty) : 'sem pedido'}</span>
          </div>
        ))}
      </div>

      {!o && g.outlookChecked && (
        <div className="pd-store">
          <span className="pd-store-label">Loja</span>
          <span>ainda não está à venda (ou o SKU não está ligado)</span>
        </div>
      )}
      {o && (
        <div className={`pd-store${risk ? ' risk' : ''}`}>
          <span className="pd-store-label">Loja</span>
          <span>
            {o.stock === 0 ? <strong>sem estoque</strong> : <><strong>{nf(o.stock)}</strong> em estoque</>}
            {o.perDay > 0
              ? <> · vende {perDayFmt(o.perDay)}/dia{o.stock > 0 && o.coverDays != null && <> · dura ~{o.coverDays} dias</>}</>
              : <> · sem vendas nos últimos {coverageLabel(coverageDays)}</>}
          </span>
          {risk && (
            <span className="pd-store-risk">
              O lote chega em {g.eta.etaEstimated ? '~' : ''}{g.eta.etaDays} dias: a loja fica <strong>~{o.gapDays} dias sem</strong>.
            </span>
          )}
          {!risk && !g.eta && o.perDay > 0 && o.coverDays != null && o.coverDays <= SOON_DAYS && (
            <span className="pd-store-warn">
              O estoque dura ~{o.coverDays} dias e este lote ainda não tem previsão de chegada.
            </span>
          )}
        </div>
      )}
    </article>
  )
}

// ═════════════════════════════════════════════════════════════
// Pedido em trânsito
// ═════════════════════════════════════════════════════════════
function TransitCard({ transit: t, onPhoto, onOpenOrder }) {
  const o = t.order
  const overdue = t.days != null && t.days < 0
  return (
    <section className="pd-transit">
      <header className="pd-transit-head">
        <div>
          <button type="button" className="pd-transit-name" onClick={() => onOpenOrder && onOpenOrder(o.id)}>
            {o.order_name || `${o.factory} (sem nome)`}
          </button>
          <span className="pd-transit-meta">
            {o.factory} · {nf(t.pieces)} peças · {t.models.length} modelo{t.models.length !== 1 ? 's' : ''}
            {(o.order_date || o.created_at) && <> · pedido {formatDate(o.order_date || o.created_at, 'full')}</>}
          </span>
        </div>
        <span className={`pd-pill${overdue ? ' bad' : ''}`}>
          {t.days == null ? 'sem previsão de chegada'
            : overdue ? `previsão venceu há ${-t.days} dias`
            : t.days === 0 ? 'chega hoje'
            : `chega em ${t.days} dias · ${formatDate(o.expected_arrival, 'full')}`}
        </span>
      </header>
      <div className="pd-transit-models">
        {t.models.map(m => {
          const photo = m.product.card_image_url || (m.product.photos || [])[0]
          const total = m.cores.reduce((a, c) => a + c.qty, 0)
          return (
            <div key={m.key} className="pd-transit-row">
              <button type="button" className="pd-photo sm" onClick={() => photo && onPhoto(photo)} aria-label={photo ? 'Ampliar foto' : undefined}>
                {photo ? <img src={photo} alt="" loading="lazy" /> : <span>{(m.product.name || '?').slice(0, 1)}</span>}
              </button>
              <div className="pd-transit-model">
                <strong>{UC(m.product.name || '')}</strong>
                <span>{nf(total)} peças</span>
              </div>
              <div className="pd-chips">
                {m.cores.map(c => (
                  <span key={c.code} className="pd-chip" title={c.colorData?.name_pt || c.code}>
                    <i style={{ background: c.colorData?.hex || 'var(--line)' }}>
                      {c.colorData?.photo_url && <img src={c.colorData.photo_url} alt="" loading="lazy" />}
                    </i>
                    {c.code}<b>{c.qty}</b>
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
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
        const elapsed = start ? Math.max(0, Math.floor((Date.now() - parseDateLocal(start)) / 86400000)) : null
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
    return { stock, sold, ageDays, period: coverageLabel(shopifyCoverageDays(shopifyCache.orders)) }
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
            {/* v13.73 — o mesmo modelo pode estar sendo feito em mais de uma fábrica */}
            {(group.factories || []).filter(f => f.qty > 0).length > 1 && (
              <div className="prd-pan-hist">
                Sendo feito em: {group.factories.filter(f => f.qty > 0).map(f => `${f.name} ${f.qty.toLocaleString('pt-BR')} pç`).join(' · ')}
              </div>
            )}
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
                🛒 Na loja: <strong>{shop.stock}</strong> em estoque · <strong>{shop.sold}</strong> vendidas ({shop.period})
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
          <div className="prd-pan-none">⚠ Nenhum pedido ativo — as cores abaixo estão marcadas "em produção" no cadastro, mas não estão em nenhum pedido (nem a caminho). Encomende ou tire a etiqueta.</div>
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
  font-family: var(--font-ui);
  font-weight: 400;
  font-size: 34px;
  line-height: 1;
  letter-spacing: -0.025em;
  color: var(--text);
  margin: 0;
}
.prd-title-compact em {
  color: var(--text);
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
  font-family: var(--font-ui);
  font-size: 24px;
  font-weight: 500;
  line-height: 1.05;
  color: var(--text);
  letter-spacing: -0.02em;
}
.prd-kpi-warn { color: var(--text); font-size: 15px; font-weight: 600; }
/* v13.73 — chegada vencida no lugar da "próxima chegada" que estava no passado */
.prd-kpi-alert {
  background: none; border: 0; padding: 0; cursor: pointer; font: inherit;
}
.prd-kpi-alert .prd-kpi-val, .prd-kpi-alert .prd-kpi-lbl { color: #DC2626; }
.prd-kpi-alert:hover .prd-kpi-lbl { text-decoration: underline; }
.prd-kpi-lbl {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 9px;
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
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
  border-color: var(--text);
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
.prd-sel:hover { border-color: var(--text); }
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
  border-color: var(--text);
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
  font-family: var(--font-ui);
  font-weight: 500;
  font-size: 22px;
  letter-spacing: -0.01em;
  color: var(--text);
}
.prd-factory-name em {
  color: var(--text);
  font-weight: 500;
}
.prd-factory-meta {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 10px;
  color: var(--text-muted);
}
.prd-factory-qty { color: var(--text); font-weight: 600; font-size: 11px; }
.stuck-inline { color: var(--text); font-weight: 600; }

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
  font-family: var(--font-ui);
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  flex-shrink: 0;
}
.prd-prod-total small {
  font-size: 10px;
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
  font-family: var(--font-ui);
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
  border-color: var(--text);
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 10px;
  font-weight: 600;
}
.prd-pill.stuck {
  border-color: var(--text);
  box-shadow: 0 0 0 1px var(--accent);
  animation: prdStuckPulse 3s ease-in-out infinite;
}
.prd-pill-warn {
  color: var(--text);
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 9px;
  font-weight: 700;
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
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
.prd-pan-meta .mono { font-family: var(--font-ui); font-variant-numeric: tabular-nums; font-size: 11px; }
.prd-pan-total {
  font-family: var(--font-ui);
  font-size: 34px;
  font-weight: 500;
  color: var(--text);
  line-height: 1;
  letter-spacing: -0.02em;
}
.prd-pan-total small {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 10px;
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 10px;
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
  font-family: var(--font-ui);
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.prd-pan-order-name:hover { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
.prd-pan-order-status {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 9px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 8px;
}
.prd-pan-order-qty {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
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
  border-color: var(--text);
  color: var(--text);
}
.prd-order-chip.late { border-color: #DC2626; }
.prd-order-chip.none {
  cursor: default;
  border-color: var(--text);
  color: var(--text);
  font-weight: 600;
}
.prd-chip-eta {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 9px;
  color: var(--text-muted);
}
.prd-chip-late {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 9px;
  font-weight: 700;
  color: #DC2626;
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
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 9px;
  color: var(--text-muted);
}
.prd-transit-name h3 {
  font-family: var(--font-ui);
  font-weight: 500;
  font-size: 20px;
  letter-spacing: -0.01em;
  color: var(--text);
  margin: 0;
}
.prd-transit-name h3.clickable { cursor: pointer; }
.prd-transit-name h3.clickable:hover { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
.prd-eta-badge {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 10px;
  font-weight: 600;
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
  font-family: var(--font-ui);
  font-size: 15px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 6px;
  letter-spacing: -0.01em;
}
.prd-transit-row-qty {
  font-family: var(--font-ui); font-variant-numeric: tabular-nums;
  font-size: 10px;
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
  font-family: var(--font-ui);
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
