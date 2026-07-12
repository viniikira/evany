// src/pages/Names.jsx
// v13.28 — Extraído de SimplePages.jsx

import { useEffect, useMemo, useState } from 'react'
import { useConfirm, useToast, SkeletonList, ClearFiltersButton } from '../components/ui'
import { listNames, addName, deleteName, addLog as writeLog } from '../lib/data/misc'
import { toastError } from '../lib/errors'
import { useStickyFilter, clearStickyFilters } from '../lib/hooks'
import { normSearch } from '../lib/constants'
import { UC, formatDate } from '../lib/utils'

export function NamesPage({ products, ideas, user, perm, setPage }) {
  const [names, setNames] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useStickyFilter('names.search', '')
  const [newName, setNewName] = useState('')
  const [filter, setFilter] = useStickyFilter('names.filter', 'all')
  const confirm = useConfirm()
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try { setNames(await listNames()) } catch (e) { toastError(toast, e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Cruza nomes disponíveis com produtos/ideias pra mostrar os "em uso".
  // 3 categorias: 'free' (só no banco), 'product' (vinculado a produto), 'idea' (vinculado a ideia)
  const enriched = useMemo(() => {
    const productNames = new Map()
    for (const p of products) productNames.set((p.name || '').toLowerCase(), p)
    const ideaNames = new Map()
    for (const i of ideas) ideaNames.set((i.name || '').toLowerCase(), i)

    const out = []
    const seenLower = new Set()

    // Nomes no banco — classifica se está em produto, ideia ou livre
    for (const n of names) {
      const lower = (n.name || '').toLowerCase()
      seenLower.add(lower)
      const prod = productNames.get(lower)
      const idea = ideaNames.get(lower)
      out.push({
        ...n,
        kind: prod ? 'product' : idea ? 'idea' : 'free',
        factory: prod?.factory || idea?.factory || null,
        item: prod || idea || null,
      })
    }

    // Nomes que estão em produtos/ideias mas não no banco (inferidos)
    for (const p of products) {
      const lower = (p.name || '').toLowerCase()
      if (!lower || seenLower.has(lower)) continue
      seenLower.add(lower)
      out.push({
        id: 'used-prod-' + p.id,
        name: UC(p.name),
        kind: 'product',
        factory: p.factory || null,
        item: p,
      })
    }
    for (const i of ideas) {
      const lower = (i.name || '').toLowerCase()
      if (!lower || seenLower.has(lower)) continue
      seenLower.add(lower)
      out.push({
        id: 'used-idea-' + i.id,
        name: UC(i.name),
        kind: 'idea',
        factory: i.factory || null,
        item: i,
      })
    }
    return out
  }, [names, products, ideas])

  const byKind = {
    free: enriched.filter(n => n.kind === 'free').length,
    product: enriched.filter(n => n.kind === 'product').length,
    idea: enriched.filter(n => n.kind === 'idea').length,
  }

  const filtered = enriched.filter(n => {
    const matchSearch = !search || normSearch(n.name).includes(normSearch(search))
    if (filter === 'free') return matchSearch && n.kind === 'free'
    if (filter === 'product') return matchSearch && n.kind === 'product'
    if (filter === 'idea') return matchSearch && n.kind === 'idea'
    return matchSearch
  })

  const add = async (nm) => {
    const raw = (nm || newName || '').trim()
    if (!raw) return
    
    // Suporta múltiplos nomes separados por vírgula (#10)
    // Ex: "ANNA, BIANCA, CLARA" → adiciona 3 nomes em batch
    const candidates = raw.split(',')
      .map(s => UC(s).trim())
      .filter(Boolean)
    
    if (candidates.length === 0) return
    
    const existing = new Set(enriched.map(n => n.name.toLowerCase()))
    const novos = []
    const duplicados = []
    
    for (const c of candidates) {
      if (existing.has(c.toLowerCase())) {
        duplicados.push(c)
      } else {
        novos.push(c)
        existing.add(c.toLowerCase())  // evita duplicar dentro do mesmo input
      }
    }
    
    if (novos.length === 0) {
      toast.push(`Todos os ${candidates.length} nomes já existem`, { kind: 'warning' })
      return
    }
    
    try {
      // Adiciona em paralelo
      await Promise.all(novos.map(n => addName(n)))
      writeLog({ userId: user.id, userName: user.name, action: 'adicionou nome(s)', target: novos.join(', ') })
      if (!nm) setNewName('')
      await load()
      
      const msg = []
      if (novos.length === 1) msg.push(`Nome "${novos[0]}" adicionado`)
      else msg.push(`✓ ${novos.length} nomes adicionados`)
      if (duplicados.length > 0) msg.push(`(${duplicados.length} já existiam)`)
      toast.push(msg.join(' '), { kind: 'success', duration: 4000 })
    } catch (e) { toastError(toast, e) }
  }

  const remove = async (n) => {
    if (n.used) {
      toast.push(`"${n.name}" está em uso pelo produto. Exclua/renomeie o produto primeiro.`, { kind: 'warning', duration: 5000 })
      return
    }
    const ok = await confirm({ title: 'Remover nome?', message: `Remover "${n.name}" do banco?`, confirmLabel: 'Remover', danger: true })
    if (!ok) return
    try {
      await deleteName(n.id)
      writeLog({ userId: user.id, userName: user.name, action: 'removeu nome', target: n.name })
      await load()
      toast.push('Nome removido', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  if (!perm.names) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Sem permissão.</p></div>

  // Estilos por tipo — consumidos (product/idea) com opacidade reduzida pra diferenciar visualmente
  const pillStyle = (kind) => {
    if (kind === 'product') return {
      background: '#FFF7ED', color: '#9A3412', borderColor: '#FDBA74',
      opacity: 0.7, borderStyle: 'dashed',
    }
    if (kind === 'idea') return {
      background: '#F3E8FF', color: '#6B21A8', borderColor: '#D8B4FE',
      opacity: 0.7, borderStyle: 'dashed',
    }
    // Livre — 100% visível, borda sólida, destaque visual
    return {
      background: '#ECFDF5', color: '#065F46', borderColor: '#A7F3D0',
      opacity: 1, borderStyle: 'solid',
    }
  }
  const pillIcon = (kind) => kind === 'product' ? '👑' : kind === 'idea' ? '💡' : '✓'
  const pillTitle = (n) => {
    if (n.kind === 'product') return `Consumido: este nome já está sendo usado no produto "${n.name}" (${n.factory || 'sem fábrica'}). Clique para ir ao produto.`
    if (n.kind === 'idea') return `Consumido: este nome já está sendo usado na ideia "${n.name}". Clique para ir à ideia.`
    return 'Nome disponível para usar em um novo produto ou ideia.'
  }

  return <div>
    <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
      <div className="stat-card"><div className="stat-val">{enriched.length}</div><div className="stat-lbl">Total</div></div>
      <div className="stat-card"><div className="stat-val" style={{ color: '#10B981' }}>{byKind.free}</div><div className="stat-lbl">Livres para Usar</div></div>
      <div className="stat-card"><div className="stat-val" style={{ color: '#9A3412' }}>{byKind.product}</div><div className="stat-lbl">Em Produtos (consumidos)</div></div>
      <div className="stat-card"><div className="stat-val" style={{ color: '#6B21A8' }}>{byKind.idea}</div><div className="stat-lbl">Em Ideias (consumidos)</div></div>
    </div>
    <div className="card mb-md">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="field" style={{ flex: 1, textTransform: 'uppercase' }} value={newName}
          onChange={e => setNewName(e.target.value)} placeholder="Adicionar nome (ou vários separados por vírgula)"
          onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="btn btn-primary" onClick={() => add()}>+ Adicionar</button>
      </div>
      <div className="text-muted text-xs" style={{ marginTop: 4 }}>
        💡 Dica: digite vários nomes separados por vírgula (ex: <code>ANNA, BIANCA, CLARA</code>) para adicionar todos de uma vez.
      </div>
    </div>
    <div className="chip-bar">
      <div className="search-box" style={{ width: 200 }}><span>🔍</span>
        <input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <button className={`chip-filter${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>Todos ({enriched.length})</button>
      <button className={`chip-filter${filter === 'free' ? ' on' : ''}`} onClick={() => setFilter('free')}>✓ Livres ({byKind.free})</button>
      <button className={`chip-filter${filter === 'product' ? ' on' : ''}`} onClick={() => setFilter('product')}>👑 Produtos ({byKind.product})</button>
      <button className={`chip-filter${filter === 'idea' ? ' on' : ''}`} onClick={() => setFilter('idea')}>💡 Ideias ({byKind.idea})</button>
    </div>
    {loading ? <SkeletonList rows={4} />
    : <div className="card names-cloud">
        {filtered.length === 0 ? <span className="text-muted">—</span>
        : filtered.map(n => (
          <span key={n.id} className="name-pill"
            style={{ ...pillStyle(n.kind), cursor: n.kind !== 'free' ? 'pointer' : 'default', border: '1px solid' }}
            onClick={() => n.kind === 'product' && setPage('products') || n.kind === 'idea' && setPage('ideas')}
            title={pillTitle(n)}>
            <span style={{ fontSize: 10, marginRight: 2 }}>{pillIcon(n.kind)}</span>
            {n.name}
            {n.factory && <span className="name-factory">({n.factory})</span>}
            {n.kind === 'free' && (
              <button className="pill-x" onClick={e => { e.stopPropagation(); remove(n) }} aria-label="Remover nome">✕</button>
            )}
          </span>
        ))}
      </div>}
  </div>
}

