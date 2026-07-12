// supabase/functions/shopify-proxy/index.ts
// v13.35 — Proxy Shopify com suporte a paginação
//
// MUDANÇA IMPORTANTE vs versão anterior:
// Agora retorna { data, next_page_info } em vez do body direto.
// Frontend extrai next_page_info pra fazer paginação cursor-based.
//
// O frontend novo (v13.35+) lida com ambos os formatos pra retrocompatibilidade,
// mas pra paginação funcionar VOCÊ PRECISA DEPLOYAR esta nova versão.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// Configuração — substitua pelos seus valores ou use Supabase secrets
// Recomendado: setar via `supabase secrets set SHOPIFY_STORE=... SHOPIFY_TOKEN=...`
const SHOPIFY_STORE = Deno.env.get('SHOPIFY_STORE') || ''   // ex: "minha-loja.myshopify.com"
const SHOPIFY_TOKEN = Deno.env.get('SHOPIFY_TOKEN') || ''   // Admin API access token
const SHOPIFY_API_VERSION = '2024-01'                       // versão da API Shopify

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * Extrai next_page_info do header Link da Shopify.
 * Formato: <https://store.myshopify.com/admin/api/2024-01/orders.json?limit=250&page_info=ABC>; rel="next"
 * Retorna o valor de page_info ou null.
 */
function extractNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  
  // Pode ter múltiplas referências separadas por vírgula (next, previous)
  const parts = linkHeader.split(',')
  for (const part of parts) {
    if (part.includes('rel="next"')) {
      // Extrai o page_info da URL
      const match = part.match(/[?&]page_info=([^&>]+)/)
      if (match) return decodeURIComponent(match[1])
    }
  }
  return null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }
  
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
  
  if (!SHOPIFY_STORE || !SHOPIFY_TOKEN) {
    return new Response(JSON.stringify({
      error: 'Edge function não configurada. Defina SHOPIFY_STORE e SHOPIFY_TOKEN via `supabase secrets set`.'
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
  
  try {
    const { endpoint } = await req.json()
    
    if (!endpoint || typeof endpoint !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing endpoint param' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    
    // Whitelist de endpoints permitidos (segurança — não deixa chamar coisa arbitrária)
    const allowed = ['products.json', 'orders.json', 'inventory_levels.json', 'shop.json']
    const baseEndpoint = endpoint.split('?')[0]
    if (!allowed.some(a => baseEndpoint.endsWith(a))) {
      return new Response(JSON.stringify({ error: `Endpoint not allowed: ${baseEndpoint}` }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    
    const url = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`
    
    const shopifyResponse = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_TOKEN,
        'Content-Type': 'application/json',
      },
    })
    
    if (!shopifyResponse.ok) {
      const errText = await shopifyResponse.text()
      return new Response(JSON.stringify({
        error: `Shopify API error: ${shopifyResponse.status} ${shopifyResponse.statusText}`,
        details: errText.slice(0, 500),
      }), {
        status: shopifyResponse.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
    
    const body = await shopifyResponse.json()
    const linkHeader = shopifyResponse.headers.get('Link') || shopifyResponse.headers.get('link')
    const nextPageInfo = extractNextPageInfo(linkHeader)
    
    // FORMATO NOVO (v13.35+):
    //   { data: <body>, next_page_info: "ABC123" | null }
    return new Response(JSON.stringify({
      data: body,
      next_page_info: nextPageInfo,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({
      error: 'Internal error',
      message: e.message || String(e),
    }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
