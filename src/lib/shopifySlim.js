// src/lib/shopifySlim.js
// v13.66 — Emagrece os dados da Shopify ANTES de salvar no cache.
//
// Contexto do bug: com a paginação corrigida, o sync passou a trazer o volume
// real da loja (4.500+ pedidos em 6 meses). Cada pedido/variante da API vem
// com dezenas de campos que o sistema nunca lê — o payload de vários MB
// estourava a gravação no Supabase ("TypeError: Failed to fetch") e o sync
// morria no fim, perdendo TUDO.
//
// O que o sistema realmente usa do cache (auditoria dos consumidores):
//   products → title, variants[].sku, variants[].inventory_quantity, variants[].price
//   orders   → created_at, line_items[].sku, line_items[].quantity, line_items[].price
// (Shopify.jsx, Products.jsx, Producao.jsx panorama, creationAssist)

export function slimShopifyProducts(products) {
  return (products || []).map(p => ({
    title: p?.title || '',
    variants: (p?.variants || []).filter(Boolean).map(v => ({
      sku: v.sku || null,
      inventory_quantity: v.inventory_quantity ?? null,
      price: v.price ?? null,
    })),
  }))
}

export function slimShopifyOrders(orders) {
  return (orders || []).map(o => ({
    created_at: o?.created_at || null,
    line_items: (o?.line_items || []).filter(Boolean).map(li => ({
      sku: li.sku || null,
      quantity: li.quantity || 0,
      price: li.price ?? null,
    })),
  }))
}
