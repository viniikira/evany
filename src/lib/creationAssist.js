// src/lib/creationAssist.js
// v13.51 — Assistente de criação de ideias/produtos (Fase 3).
//
// Funções puras que apoiam a criação de peças novas:
//   - sugerir um nome ainda livre do banco de nomes
//   - avisar quando o nome já existe (produto ou ideia)
//   - copiar a "receita técnica" de um modelo parecido pra outro
// Só leitura/transformação — não toca no banco.

const norm = (s) => (s || '').toString().trim().toLowerCase()

/**
 * Nomes do banco ainda livres (não usados por nenhum produto nem ideia).
 * @returns {Array<{id?, name}>}
 */
export function freeNames(names = [], existingProducts = [], existingIdeas = []) {
  const used = new Set([...(existingProducts || []), ...(existingIdeas || [])].map(x => norm(x?.name)))
  return (names || []).filter(n => n && n.name && !used.has(norm(n.name)))
}

/**
 * Conflito de nome: já existe produto/ideia com esse nome (ignora o próprio em edição).
 * @returns {{type:'product'|'idea', name}|null}
 */
export function findNameConflict(name, existingProducts = [], existingIdeas = [], currentId = null) {
  const k = norm(name)
  if (!k) return null
  const p = (existingProducts || []).find(x => x && norm(x.name) === k && x.id !== currentId)
  if (p) return { type: 'product', name: p.name }
  const i = (existingIdeas || []).find(x => x && norm(x.name) === k && x.id !== currentId)
  if (i) return { type: 'idea', name: i.name }
  return null
}

// Campos técnicos ("receita") que fazem sentido copiar de um modelo pra outro.
// Nunca inclui nome, foto, cores nem status — só as características.
export const SPEC_FIELDS = [
  'finish_type', 'reparticao', 'reparticao_size', 'reparticao_acabamento',
  'pre_plucked', 'hair_type', 'length', 'material',
  'collection', 'factory', 'factory_code',
]

/**
 * Propõe um SKU pela convenção da Kira: NOME DO PRODUTO + CÓDIGO DA COR,
 * tudo em maiúsculas e sem caracteres especiais (ex.: Valentina + 1B → VALENTINA1B).
 * Serve pra vincular a variante com a Shopify sem digitar na mão.
 * @returns {string} SKU proposto (vazio se faltar nome ou código)
 */
export function proposeSku(productName, colorCode) {
  const slug = (s) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const n = slug(productName)
  const c = slug(colorCode)
  if (!n || !c) return ''
  return n + c
}

// ═══ v13.57 — Vínculo com a Shopify: sugerir SKUs REAIS e validar os digitados ═══
// A convenção NOME+COR nem sempre bate com a loja (ex.: Afro Puff = CHEREY6).
// Estas funções usam o cache da Shopify pra sugerir o SKU verdadeiro e mostrar
// os dados (título/estoque) quando o vínculo existe.

const normTxt = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Achata o cache da Shopify em [{sku, title, stock}]. */
export function buildShopifyIndex(shopifyCache) {
  const out = []
  for (const p of (shopifyCache?.products || [])) {
    for (const v of (p.variants || [])) {
      if (!v || !v.sku || !String(v.sku).trim()) continue
      out.push({ sku: String(v.sku).trim(), title: p.title || '', stock: v.inventory_quantity ?? null })
    }
  }
  return out
}

/**
 * SKUs da Shopify que provavelmente correspondem a este produto+cor:
 * filtra por nome no título e ranqueia pela afinidade com a cor
 * (sufixo do SKU e menções no título).
 */
export function suggestShopifyLinks(productName, colorCode, index, limit = 3) {
  const name = normTxt(productName).trim()
  if (!name || !Array.isArray(index) || index.length === 0) return []
  const nameMatches = index.filter(e => normTxt(e.title).includes(name))
  if (nameMatches.length === 0) return []

  const colorTokens = normTxt(colorCode).split(/[^a-z0-9]+/).filter(Boolean)
  const skuSlug = (colorCode || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return nameMatches
    .map(e => {
      let score = 0
      const t = normTxt(e.title)
      const sk = (e.sku || '').toUpperCase()
      if (skuSlug && sk.endsWith(skuSlug)) score += 5
      for (const tok of colorTokens) if (t.includes(tok)) score += 1
      return { ...e, score }
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
}

/** O SKU digitado existe na Shopify? Retorna {sku,title,stock} ou null. */
export function findShopifyBySku(sku, index) {
  const k = (sku || '').toString().trim().toUpperCase()
  if (!k) return null
  return (index || []).find(e => (e.sku || '').toUpperCase() === k) || null
}

/**
 * Extrai a receita técnica de um produto/ideia (só campos preenchidos).
 * @returns {Object} patch pra aplicar no form
 */
export function specTemplateFrom(source) {
  if (!source) return {}
  const out = {}
  for (const k of SPEC_FIELDS) {
    const v = source[k]
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  return out
}
