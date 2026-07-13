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

// ═══ v13.56 — Deep-links de item: #/pedidos/novembro-2025, #/produtos/lara ═══

/** Segundo segmento do hash ('#/pedidos/abc' → 'abc'), ou null. */
export function entitySegmentForHash(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('?')[0].split('/')
  const seg = (parts[1] || '').trim()
  if (!seg) return null
  try { return decodeURIComponent(seg).toLowerCase() } catch { return seg.toLowerCase() }
}

/** Hash de um item dentro de uma página: ('orders','novembro-2025') → '#/pedidos/novembro-2025'. */
export function hashForEntity(page, segment) {
  const slug = PAGE_SLUGS[page]
  if (!slug || !segment) return hashForPage(page)
  return `#/${slug}/${encodeURIComponent(segment)}`
}

/** Slug de nome: 'Ana Beatriz' → 'ana-beatriz' (minúsculas, sem acento). */
export function slugifyName(name) {
  return (name || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * O segmento da URL aponta pra este item? Aceita: id completo, prefixo de id
 * (≥8 chars — suficiente pra UUID sem colisão nesta escala) ou slug do nome.
 */
export function matchesEntity(segment, { id, name } = {}) {
  if (!segment) return false
  const seg = segment.toLowerCase()
  if (id) {
    const idLow = id.toLowerCase()
    if (idLow === seg || (seg.length >= 8 && idLow.startsWith(seg))) return true
  }
  if (name && slugifyName(name) === seg) return true
  return false
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
