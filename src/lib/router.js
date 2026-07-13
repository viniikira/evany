// src/lib/router.js
// v13.55 — Rotas por hash: cada tela ganha uma URL (#/pedidos, #/financeiro...).
//
// Por que hash e não history API: o app é servido estático no Railway; URLs
// "limpas" (/pedidos) exigiriam fallback de servidor pro index.html. O hash
// entrega deep-link, F5 no lugar certo e voltar/avançar sem tocar no servidor.
//
// O App.jsx sincroniza o estado `page` ↔ location.hash nos dois sentidos.

export const PAGE_SLUGS = {
  dashboard: 'inicio',
  ideas: 'ideias',
  products: 'produtos',
  producao: 'producao',
  orders: 'pedidos',
  financial: 'financeiro',
  shopify: 'shopify',
  calculator: 'calculadoras',
  names: 'nomes',
  collections: 'colecoes',
  factories: 'fabricas',
  colors: 'cores',
  logs: 'atividades',
  analytics: 'metricas',
  backup: 'backup',
  users: 'usuarios',
}

const SLUG_TO_PAGE = Object.fromEntries(Object.entries(PAGE_SLUGS).map(([p, s]) => [s, p]))

/** Hash canônico de uma página: 'orders' → '#/pedidos'. */
export function hashForPage(page) {
  const slug = PAGE_SLUGS[page]
  return slug ? `#/${slug}` : '#/'
}

/**
 * Página a partir de um hash: '#/pedidos' → 'orders'.
 * Tolerante a variações ('#pedidos', barra final, segmentos extras, query).
 * @returns {string|null} id da página, ou null se não reconhecido
 */
export function pageForHash(hash) {
  const slug = (hash || '')
    .replace(/^#\/?/, '')
    .split('/')[0]
    .split('?')[0]
    .trim()
    .toLowerCase()
  if (!slug) return null
  return SLUG_TO_PAGE[slug] || null
}

/**
 * A página é visível pro papel do usuário? Espelha o `show` do menu (App.jsx).
 * Links diretos pra telas sem permissão caem no dashboard.
 */
export function isPageAllowed(page, perm) {
  if (!perm) return page === 'dashboard'
  const rules = {
    dashboard: true,
    ideas: perm.ideas,
    products: perm.products,
    producao: perm.products,
    orders: perm.orders,
    financial: perm.prices,
    shopify: perm.shopify,
    calculator: perm.prices,
    names: perm.names,
    collections: perm.collections,
    factories: perm.factories,
    colors: perm.colors,
    logs: perm.logs,
    analytics: perm.admin,
    backup: perm.backup,
    users: perm.users,
  }
  return !!rules[page]
}
