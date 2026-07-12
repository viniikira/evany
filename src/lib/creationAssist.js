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
