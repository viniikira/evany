// src/pages/Shopify.jsx
import { useState, useEffect, useMemo } from 'react'
import { listProducts } from '../lib/data/products'
import { listColors, getShopifyCache, setShopifyCache, addLog as writeLog } from '../lib/data/misc'
import { useToast } from '../components/ui'
import { ProgressBar } from '../components/ProgressBar'
import { toastError } from '../lib/errors'
import { UC } from '../lib/utils'
import { SUPABASE_PUBLIC_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import { log } from '../lib/logger'

// v13.45 — URL e chave vêm do módulo central (não mais duplicadas).
const SUPABASE_FN_URL = `${SUPABASE_PUBLIC_URL}/functions/v1/shopify-proxy`

// v13.35 — Proxy Shopify com suporte a paginação cursor-based.
// Lida com 2 formatos de resposta da edge function:
//   - NOVO (v13.35+): { data: <body>, next_page_info: "ABC" | null }
//   - ANTIGO (compat): apenas o body direto (sem next_page_info → assume sem mais páginas)
async function shopifyProxy(endpoint) {
  try {
    const res = await fetch(SUPABASE_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ endpoint }),
    })
    if (!res.ok) return null
    const json = await res.json()
    
    // Detecta formato NOVO vs ANTIGO
    if (json && typeof json === 'object' && 'data' in json && ('next_page_info' in json || 'data' in json)) {
      return { body: json.data, nextPageInfo: json.next_page_info || null }
    }
    // Formato antigo: retorna como se não tivesse próxima página (paginação não funciona)
    return { body: json, nextPageInfo: null }
  } catch { return null }
}

// v13.35 — Busca TODAS as páginas de um endpoint Shopify (cursor pagination).
// Limites: máx 50 páginas (12.500 itens) e delay 200ms entre chamadas pra respeitar rate limit.
//
// @param baseEndpoint - ex: "orders.json?status=any&created_at_min=...&limit=250&fields=..."
// @param itemKey - chave do array no body, ex: "orders" ou "products"
// @param onProgress - callback(page, totalSoFar) pra atualizar UI
// @returns { items, pages, truncated } — truncated=true se atingiu o limite de páginas
async function fetchAllPages(baseEndpoint, itemKey, onProgress) {
  const MAX_PAGES = 50  // Hard limit pra não rodar pra sempre
  const DELAY_MS = 200  // Delay entre chamadas (respeita rate limit Shopify)
  
  const allItems = []
  let pageInfo = null
  let pageNum = 0
  let truncated = false
  
  while (true) {
    pageNum++
    
    // Quando passa page_info, NÃO mandar outros filtros (Shopify rejeita)
    // Apenas limit e page_info
    const url = pageInfo
      ? `${baseEndpoint.split('?')[0]}?limit=250&page_info=${encodeURIComponent(pageInfo)}`
      : baseEndpoint
    
    const result = await shopifyProxy(url)
    if (!result || !result.body) break
    
    const items = result.body[itemKey] || []
    allItems.push(...items)
    
    onProgress?.(pageNum, allItems.length)
    
    pageInfo = result.nextPageInfo
    if (!pageInfo) break
    
    if (pageNum >= MAX_PAGES) {
      truncated = true
      log.warn(`[shopify] Atingiu limite de ${MAX_PAGES} páginas. Resultados truncados.`)
      break
    }
    
    // Delay pra respeitar rate limit
    await new Promise(r => setTimeout(r, DELAY_MS))
  }
  
  return { items: allItems, pages: pageNum, truncated }
}

export default function ShopifyPage({ user, perm }) {
  const [products, setProducts] = useState([])
  const [colors, setColors] = useState([])
  const [cache, setCache] = useState({ products: [], orders: [], last_sync: null })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const [p, c, cache] = await Promise.all([listProducts(), listColors(), getShopifyCache()])
      setProducts(p); setColors(c); setCache(cache)
    } catch (e) { toastError(toast, e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (!perm.shopify) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Sem permissão.</p></div>

  const syncAll = async () => {
    setSyncing(true); setSyncMsg('Buscando produtos Shopify (página 1)...')
    try {
      // Fetch produtos paginados
      const productsResult = await fetchAllPages(
        'products.json?limit=250&fields=id,title,variants,images,status,product_type,tags,created_at,updated_at',
        'products',
        (page, total) => setSyncMsg(`Buscando produtos: ${total} encontrados (página ${page})...`)
      )
      const prods = productsResult.items
      
      if (productsResult.truncated) {
        toast.push(`⚠️ Limite de ${productsResult.pages} páginas atingido para produtos. Pode haver mais.`, { kind: 'warning', duration: 8000 })
      }
      
      // Fetch pedidos paginados (últimos 6 meses)
      setSyncMsg(`${prods.length} produtos OK (${productsResult.pages} págs). Buscando pedidos (6 meses)...`)
      const since = new Date(Date.now() - 180 * 86400000).toISOString()
      const ordersResult = await fetchAllPages(
        `orders.json?status=any&created_at_min=${since}&limit=250&fields=id,name,created_at,total_price,line_items,financial_status,fulfillment_status`,
        'orders',
        (page, total) => setSyncMsg(`Buscando pedidos: ${total} encontrados (página ${page})...`)
      )
      const ords = ordersResult.items
      
      if (ordersResult.truncated) {
        toast.push(`⚠️ Limite de ${ordersResult.pages} páginas atingido para pedidos. Pode haver mais nos últimos 6 meses.`, { kind: 'warning', duration: 8000 })
      }
      
      await setShopifyCache(prods, ords)
      writeLog({
        userId: user.id, userName: user.name,
        action: 'sincronizou Shopify',
        details: `${prods.length} produtos (${productsResult.pages} págs), ${ords.length} pedidos (${ordersResult.pages} págs, 6m)`,
      })
      await load()
      setSyncMsg(`✓ Sincronizado! ${prods.length} produtos · ${ords.length} pedidos`)
    } catch (e) { setSyncMsg('Erro: ' + (e.message || String(e))) }
    setSyncing(false)
  }

  // Índice SKU → sales / stock (OTIMIZADO O(n))
  const { salesBySku, stockBySku } = useMemo(() => {
    const sales = new Map(), stocks = new Map()
    for (const o of (cache.orders || [])) {
      for (const li of (o.line_items || [])) {
        if (!li.sku) continue
        const cur = sales.get(li.sku) || { qty: 0, revenue: 0, orderCount: 0, lastSaleDate: null, weekQty: 0 }
        cur.qty += li.quantity
        cur.revenue += parseFloat(li.price) * li.quantity
        cur.orderCount++
        const d = new Date(o.created_at)
        if (!cur.lastSaleDate || d > cur.lastSaleDate) cur.lastSaleDate = d
        if (d > new Date(Date.now() - 7 * 86400000)) cur.weekQty += li.quantity
        sales.set(li.sku, cur)
      }
    }
    for (const p of (cache.products || [])) {
      for (const v of (p.variants || [])) {
        if (!v.sku) continue
        stocks.set(v.sku, { stock: v.inventory_quantity || 0, title: p.title })
      }
    }
    return { salesBySku: sales, stockBySku: stocks }
  }, [cache])

  const systemSkus = useMemo(() => {
    const out = []
    for (const p of products) {
      for (const cv of (p.color_variants || [])) {
        if (cv.sku) out.push({
          sku: cv.sku,
          product: UC(p.name),
          productId: p.id,
          colorCode: cv.code,
          colorStatus: cv.status || 'catalog',
          photo: p.card_image_url || (p.photos || [])[0],
          colorPhoto: colors.find(c => c.code === cv.code)?.photo_url,
          factory: p.factory,
          collection: p.collection,
        })
      }
    }
    out.sort((a, b) => a.product.localeCompare(b.product) || a.colorCode.localeCompare(b.colorCode))
    return out
  }, [products, colors])

  const skuData = useMemo(() => {
    return systemSkus.map(s => {
      const sales = salesBySku.get(s.sku) || { qty: 0, revenue: 0, orderCount: 0, lastSaleDate: null, weekQty: 0 }
      const stock = stockBySku.get(s.sku)
      const dailyRate = sales.qty / 180
      const daysLeft = dailyRate > 0 && stock?.stock != null ? Math.round(stock.stock / dailyRate) : null
      return { ...s, ...sales, stock: stock?.stock ?? null, shopifyTitle: stock?.title, dailyRate, daysLeft }
    })
  }, [systemSkus, salesBySku, stockBySku])

  const linked = skuData.filter(s => s.stock !== null || s.qty > 0)
  const needsRestock = linked.filter(s => s.daysLeft !== null && s.daysLeft < 21 && s.daysLeft >= 0)
    .sort((a, b) => (a.daysLeft || 0) - (b.daysLeft || 0))
  const topPerformers = [...linked].sort((a, b) => b.qty - a.qty).slice(0, 10)
  const totalRevenue = linked.reduce((a, s) => a + s.revenue, 0)
  const totalQty = linked.reduce((a, s) => a + s.qty, 0)

  if (loading) return <p className="text-muted">Carregando...</p>

  return <div>
    <div className="toolbar">
      <div><div className="text-muted text-sm">{systemSkus.length} SKUs no sistema · {linked.length} vinculados</div></div>
      <button className="btn btn-primary" onClick={syncAll} disabled={syncing}>{syncing ? '⏳ Sincronizando...' : '🔄 Sync Shopify'}</button>
    </div>
    {/* v13.38 — Feedback visual melhorado:
        - Syncing: ProgressBar indeterminado + label de progresso
        - Sucesso: alerta verde com check
        - Erro: alerta vermelho */}
    {syncing && syncMsg && (
      <div style={{
        padding: 12,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        marginBottom: 14,
      }}>
        <ProgressBar value={null} label={syncMsg} />
      </div>
    )}
    {!syncing && syncMsg && syncMsg.startsWith('✓') && (
      <div className="alert" style={{ background: '#F0FDF4', border: '1px solid #86EFAC', color: '#166534' }}>
        {syncMsg}
      </div>
    )}
    {!syncing && syncMsg && syncMsg.startsWith('Erro') && (
      <div className="alert" style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B' }}>
        ⚠️ {syncMsg}
      </div>
    )}
    {systemSkus.length === 0 ? (
      <div className="empty-state">
        <div className="empty-icon">🔗</div>
        <p>Adicione SKUs nas cores dos seus produtos para vincular com a Shopify.</p>
      </div>
    ) : (
      <>
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <div className="stat-card"><div className="stat-val" style={{ color: '#8B5CF6', fontSize: 24 }}>{linked.length}/{systemSkus.length}</div><div className="stat-lbl">Vinculados</div></div>
          <div className="stat-card"><div className="stat-val" style={{ color: '#10B981', fontSize: 20 }}>R$ {totalRevenue.toFixed(0)}</div><div className="stat-lbl">Receita 6m</div></div>
          <div className="stat-card"><div className="stat-val" style={{ fontSize: 24 }}>{totalQty}</div><div className="stat-lbl">Vendidas</div></div>
          <div className="stat-card"><div className="stat-val" style={{ color: needsRestock.length > 0 ? '#EF4444' : '#10B981', fontSize: 24 }}>{needsRestock.length}</div><div className="stat-lbl">Repor</div></div>
        </div>

        {needsRestock.length > 0 && (
          <div className="card mb-md" style={{ border: '2px solid #F59E0B', background: 'linear-gradient(135deg,#FFFBEB,#FEF3C7)' }}>
            <div className="card-title" style={{ color: '#92400E' }}>⚠️ Reposição Urgente</div>
            {needsRestock.map(s => (
              <div key={s.sku} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #FDE68A' }}>
                {s.colorPhoto && <img src={s.colorPhoto} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} />}
                <div style={{ flex: 1 }}>
                  <strong>{s.product}</strong> · <span style={{ color: 'var(--primary)' }}>{s.colorCode}</span>
                  <div className="text-muted text-xs">SKU: {s.sku} · Vende ~{s.dailyRate.toFixed(1)}/dia</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: s.daysLeft < 7 ? '#EF4444' : '#F59E0B' }}>{s.stock} estoque</div>
                  <div className="text-xs" style={{ color: s.daysLeft < 7 ? '#EF4444' : '#F59E0B' }}>{s.daysLeft} dias</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {topPerformers.length > 0 && (
          <div className="card">
            <div className="card-title">Top 10 mais vendidos (6m)</div>
            <table className="data-table">
              <thead><tr><th>Produto</th><th>Cor</th><th>Vendidos</th><th>Receita</th><th>Estoque</th></tr></thead>
              <tbody>{topPerformers.map(s => (
                <tr key={s.sku}>
                  <td><strong>{s.product}</strong></td>
                  <td>{s.colorCode}</td>
                  <td>{s.qty}</td>
                  <td>R$ {s.revenue.toFixed(0)}</td>
                  <td>{s.stock ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </>
    )}
  </div>
}
