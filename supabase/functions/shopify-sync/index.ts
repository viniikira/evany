// supabase/functions/shopify-sync/index.ts
// v13.69 — Sincronização AUTOMÁTICA da Shopify (roda toda noite via pg_cron).
//
// Por que existe: tudo que o sistema tem de inteligente lê o cache da Shopify
// — sugerir/puxar SKU real, estoque no panorama da Produção, reposição por
// vendas. Antes o cache só era atualizado com clique manual e ficou 3 meses
// parado (dados de abril usados em julho).
//
// ARQUITETURA (aprendida na prática):
//   • PRODUTOS: sempre completos. São 737 na loja (3 páginas, ~10s) e é o que
//     alimenta estoque e SKU. Salvos primeiro, de forma independente.
//   • PEDIDOS: INCREMENTAL. Buscar os 4.500+ pedidos de 6 meses estoura o
//     limite de 150s da edge function, então cada execução pega só os criados
//     desde a última sincronização (com 2 dias de margem) e faz merge com o
//     que já está no cache, descartando o que saiu da janela de 6 meses.
//     O merge não precisa de dedupe por id: os antigos preservados são
//     estritamente os de fora do período re-buscado.
//   • O primeiro carregamento completo (ou uma reconstrução) é melhor pelo
//     navegador, na aba Shopify — lá não existe limite de 150s.
//
// Segurança: service_role só server-side; token da loja em secret.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SHOPIFY_STORE = Deno.env.get('SHOPIFY_STORE') || 'kiraperucas.myshopify.com'
const SHOPIFY_TOKEN = Deno.env.get('SHOPIFY_TOKEN') || ''
const API_VERSION = '2024-01'

const ORDERS_WINDOW_DAYS = 180   // janela que o sistema usa (vendas 6m)
const INCREMENTAL_MARGIN_DAYS = 2 // margem pra não perder pedido na virada
const MAX_PRODUCT_PAGES = 20      // 5.000 produtos de teto
const MAX_ORDER_PAGES = 8         // teto por execução (2.000 pedidos novos)
const DELAY_MS = 250              // ~4 req/s, dentro do bucket REST da Shopify

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function nextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  for (const part of linkHeader.split(',')) {
    if (part.includes('rel="next"')) {
      const m = part.match(/[?&]page_info=([^&>]+)/)
      if (m) return decodeURIComponent(m[1])
    }
  }
  return null
}

// Chamada à Shopify com retry no rate limit (429 respeita Retry-After)
async function shopifyGet(path: string, attempt = 0): Promise<Response> {
  const res = await fetch(`https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/${path}`, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' },
  })
  if (res.status === 429 && attempt < 5) {
    const wait = Number(res.headers.get('Retry-After') || '2') * 1000
    await sleep(wait)
    return shopifyGet(path, attempt + 1)
  }
  return res
}

async function fetchAll(baseEndpoint: string, key: 'products' | 'orders', maxPages: number) {
  const items: any[] = []
  let pageInfo: string | null = null
  let pages = 0
  let truncated = false

  while (true) {
    pages++
    // Com page_info a Shopify rejeita outros filtros — só limit + cursor
    const path = pageInfo
      ? `${baseEndpoint.split('?')[0]}?limit=250&page_info=${encodeURIComponent(pageInfo)}`
      : baseEndpoint

    const res = await shopifyGet(path)
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Shopify ${res.status} em ${key}: ${body.slice(0, 200)}`)
    }
    const json = await res.json()
    items.push(...(json[key] || []))

    pageInfo = nextPageInfo(res.headers.get('Link') || res.headers.get('link'))
    if (!pageInfo) break
    if (pages >= maxPages) { truncated = true; break }
    await sleep(DELAY_MS)
  }
  return { items, pages, truncated }
}

// ── Slim: espelha src/lib/shopifySlim.js (só o que o sistema lê) ──
const slimProducts = (products: any[]) => (products || []).map(p => ({
  title: p?.title || '',
  variants: (p?.variants || []).filter(Boolean).map((v: any) => ({
    sku: v.sku || null,
    inventory_quantity: v.inventory_quantity ?? null,
    price: v.price ?? null,
  })),
}))

const slimOrders = (orders: any[]) => (orders || []).map(o => ({
  created_at: o?.created_at || null,
  line_items: (o?.line_items || []).filter(Boolean).map((li: any) => ({
    sku: li.sku || null,
    quantity: li.quantity || 0,
    price: li.price ?? null,
  })),
}))

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const startedAt = Date.now()
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  let source = 'cron'
  let skipOrders = false
  try {
    const body = await req.json()
    if (body?.source) source = String(body.source)
    if (body?.skipOrders) skipOrders = true
  } catch { /* sem body = cron */ }

  const result: Record<string, unknown> = { source, ok: false }

  const fail = async (message: string) => {
    await supa.from('shopify_cache').update({
      last_sync_source: source,
      last_sync_ok: false,
      last_sync_error: message.slice(0, 500),
      last_sync_ms: Date.now() - startedAt,
    }).eq('id', 1)
    return new Response(JSON.stringify({ ...result, error: message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  if (!SHOPIFY_TOKEN) return await fail('SHOPIFY_TOKEN não configurado nos secrets')

  try {
    // Estado atual do cache (pra saber de onde continuar e o que preservar)
    const { data: cache } = await supa
      .from('shopify_cache')
      .select('orders, last_sync')
      .eq('id', 1)
      .single()

    // ── 1) PRODUTOS: completos, salvos de imediato ──
    const prods = await fetchAll(
      'products.json?limit=250&fields=id,title,variants,status',
      'products',
      MAX_PRODUCT_PAGES,
    )
    result.products = prods.items.length
    result.productPages = prods.pages

    const { error: pErr } = await supa.from('shopify_cache').update({
      products: slimProducts(prods.items),
      last_sync: new Date().toISOString(),
      last_sync_source: source,
      products_count: prods.items.length,
    }).eq('id', 1)
    if (pErr) throw new Error(`Falha ao salvar produtos: ${pErr.message}`)

    if (skipOrders) {
      await supa.from('shopify_cache').update({
        last_sync_ok: true, last_sync_error: null, last_sync_ms: Date.now() - startedAt,
      }).eq('id', 1)
      return new Response(JSON.stringify({ ...result, ok: true, ordersSkipped: true, ms: Date.now() - startedAt }), {
        status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // ── 2) PEDIDOS: incremental desde a última sincronização ──
    const cutoff = Date.now() - ORDERS_WINDOW_DAYS * 86400000
    const prevOrders: any[] = Array.isArray(cache?.orders) ? cache!.orders : []
    const lastSyncMs = cache?.last_sync ? new Date(cache.last_sync).getTime() : NaN

    // Sem histórico → pega uma fatia recente (o full completo é pelo navegador)
    const sinceMs = isNaN(lastSyncMs)
      ? Date.now() - 30 * 86400000
      : Math.max(cutoff, lastSyncMs - INCREMENTAL_MARGIN_DAYS * 86400000)
    const sinceIso = new Date(sinceMs).toISOString()

    const ords = await fetchAll(
      `orders.json?status=any&created_at_min=${sinceIso}&limit=250&fields=id,created_at,line_items`,
      'orders',
      MAX_ORDER_PAGES,
    )

    // Preserva os pedidos de FORA do período re-buscado que ainda estão na
    // janela de 6 meses — assim não há duplicata nem perda de histórico.
    const preserved = prevOrders.filter(o => {
      const t = o?.created_at ? new Date(o.created_at).getTime() : NaN
      return !isNaN(t) && t >= cutoff && t < sinceMs
    })
    const merged = [...preserved, ...slimOrders(ords.items)]

    result.ordersNew = ords.items.length
    result.ordersPreserved = preserved.length
    result.ordersTotal = merged.length
    result.orderPages = ords.pages
    result.incrementalSince = sinceIso
    result.truncated = prods.truncated || ords.truncated

    const { error: oErr } = await supa.from('shopify_cache').update({
      orders: merged,
      last_sync: new Date().toISOString(),
      last_sync_source: source,
      last_sync_ok: true,
      last_sync_error: null,
      orders_count: merged.length,
      last_sync_ms: Date.now() - startedAt,
    }).eq('id', 1)
    if (oErr) throw new Error(`Falha ao salvar pedidos: ${oErr.message}`)

    result.ok = true
    result.ms = Date.now() - startedAt
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return await fail((e as Error)?.message || String(e))
  }
})
