// src/pages/Colors.jsx
// v13.28 — Extraído de SimplePages.jsx
// Inclui ColorsPage + CategoryEditModal + ColorEditModal + ColorProductsModal

import { useEffect, useMemo, useState } from 'react'
import { Modal, MH, MB, MF, useConfirm, useToast, SkeletonList } from '../components/ui'
import { getContrastColor } from '../components/ColorSwatch'
import {
  listColors, upsertColor, deleteColor,
  listColorCategories, upsertColorCategory, deleteColorCategory,
  listFactories,
  addLog as writeLog,
} from '../lib/data/misc'
import { uploadProductPhoto, deletePhoto } from '../lib/storage'
import { toastError } from '../lib/errors'
import { UC, formatDate } from '../lib/utils'

export function ColorsPage({ user, perm }) {
  const [colors, setColors] = useState([])
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [factories, setFactories] = useState([])
  const [loading, setLoading] = useState(true)
  const [newCode, setNewCode] = useState('')
  const [search, setSearch] = useState('')  // #8 buscador
  // v13.60 — cores sem foto eram invisíveis até estragarem uma planilha da fábrica
  const [noPhotoOnly, setNoPhotoOnly] = useState(false)
  const [activeCategoryIds, setActiveCategoryIds] = useState([])  // #9 filtro multi categoria
  const [showCategoriesPanel, setShowCategoriesPanel] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)  // categoria sendo editada
  const [viewing, setViewing] = useState(null)
  const [editing, setEditing] = useState(null)
  const confirm = useConfirm()
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const [cs, cats, ps, fs] = await Promise.all([
        listColors(),
        listColorCategories().catch(() => []),
        import('../lib/data/products').then(m => m.listProducts()),
        listFactories().catch(() => []),
      ])
      setColors(cs)
      setCategories(cats)
      setProducts(ps)
      setFactories(fs)
    } catch (e) { toastError(toast, e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Índice: code → produtos que usam essa cor
  const productsByColor = useMemo(() => {
    const m = new Map()
    for (const p of products) {
      for (const cv of (p.color_variants || [])) {
        const key = cv.code
        if (!key) continue
        if (!m.has(key)) m.set(key, [])
        m.get(key).push({ product: p, variant: cv })
      }
    }
    return m
  }, [products])

  // #7 Adiciona uma ou várias cores separadas por vírgula
  // Ex: "1B, 613, K16" → adiciona 3 em batch (paralelo)
  const add = async () => {
    const raw = newCode.trim()
    if (!raw) return
    
    const candidates = raw.split(',')
      .map(s => UC(s).trim())
      .filter(Boolean)
    
    if (candidates.length === 0) return
    
    const existing = new Set(colors.map(c => c.code.toLowerCase()))
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
      toast.push(`Todas as ${candidates.length} cor(es) já existem`, { kind: 'warning' })
      return
    }
    
    try {
      await Promise.all(novos.map(code => upsertColor({ code })))
      writeLog({ userId: user.id, userName: user.name, action: 'adicionou cor(es)', target: novos.join(', ') })
      setNewCode('')
      await load()
      
      const msg = []
      if (novos.length === 1) msg.push(`Cor "${novos[0]}" adicionada`)
      else msg.push(`✓ ${novos.length} cores adicionadas`)
      if (duplicados.length > 0) msg.push(`(${duplicados.length} já existiam)`)
      toast.push(msg.join(' '), { kind: 'success', duration: 4000 })
    } catch (e) { toastError(toast, e) }
  }

  const remove = async (c) => {
    const inUse = productsByColor.get(c.code)?.length || 0
    if (inUse > 0) {
      toast.push(`"${c.code}" está em ${inUse} produto(s). Remova das variantes primeiro.`, { kind: 'warning', duration: 5000 })
      return
    }
    const ok = await confirm({ title: 'Remover cor?', message: `Código "${c.code}" será removido.`, danger: true, confirmLabel: 'Remover' })
    if (!ok) return
    try {
      if (c.photo_url) await deletePhoto(c.photo_url)
      await deleteColor(c.id)
      await load()
    } catch (e) { toastError(toast, e) }
  }

  // #20 Salva edição completa (foto + nome PT + hex + fábricas + notas)
  const saveEdit = async (updated) => {
    try {
      // Hex normalization: # opcional
      let hex = (updated.hex || '').trim()
      if (hex && !hex.startsWith('#')) hex = '#' + hex
      if (hex && !/^#[0-9A-Fa-f]{3,8}$/.test(hex)) {
        toast.push('Hex inválido. Use formato #RGB ou #RRGGBB', { kind: 'error' })
        return
      }
      const payload = {
        ...updated,
        hex: hex || null,
        name_pt: (updated.name_pt || '').trim() || null,
        notes: (updated.notes || '').trim() || null,
        factories: updated.factories || [],
        category_ids: updated.category_ids || [],
      }
      await upsertColor(payload)
      writeLog({ userId: user.id, userName: user.name, action: 'editou cor', target: payload.code })
      setEditing(null)
      await load()
      toast.push('Cor atualizada', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }
  
  // v13.23 Handlers de categoria
  const saveCategory = async (cat) => {
    try {
      // Hex normalization
      let hex = (cat.hex || '').trim()
      if (hex && !hex.startsWith('#')) hex = '#' + hex
      if (hex && !/^#[0-9A-Fa-f]{3,8}$/.test(hex)) {
        toast.push('Hex inválido. Use formato #RGB ou #RRGGBB', { kind: 'error' })
        return
      }
      // Verifica nome duplicado (case insensitive, exceto se editando ela mesma)
      const dup = categories.find(c => c.name.toLowerCase() === (cat.name || '').trim().toLowerCase() && c.id !== cat.id)
      if (dup) {
        toast.push(`Já existe categoria "${dup.name}"`, { kind: 'warning' })
        return
      }
      await upsertColorCategory({ ...cat, hex: hex || null })
      writeLog({ userId: user.id, userName: user.name, action: cat.id ? 'editou categoria de cor' : 'criou categoria de cor', target: cat.name })
      setEditingCategory(null)
      await load()
      toast.push('Categoria salva', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }
  
  const removeCategory = async (cat) => {
    const inUse = cat.color_count || 0
    const ok = await confirm({
      title: 'Remover categoria?',
      message: `"${cat.name}" será removida.`,
      details: inUse > 0
        ? `${inUse} cor(es) tinham essa categoria — vão ficar sem. Os dados das cores não são afetados.`
        : 'Nenhuma cor está usando essa categoria.',
      confirmLabel: 'Remover',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteColorCategory(cat.id)
      writeLog({ userId: user.id, userName: user.name, action: 'removeu categoria de cor', target: cat.name })
      await load()
      toast.push('Categoria removida', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }
  
  const toggleCategoryFilter = (catId) => {
    setActiveCategoryIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    )
  }
  
  const uploadPhotoFor = async (c, file) => {
    try {
      const { url } = await uploadProductPhoto(file, 'colors')
      if (c.photo_url) await deletePhoto(c.photo_url)
      const updated = { ...c, photo_url: url }
      await upsertColor(updated)
      writeLog({ userId: user.id, userName: user.name, action: 'atualizou foto cor', target: c.code })
      // Se estava editando, refletir no estado
      if (editing && editing.id === c.id) setEditing(updated)
      await load()
    } catch (e) { toastError(toast, e) }
  }

  const removePhotoFor = async (c) => {
    if (!c.photo_url) return
    const ok = await confirm({ title: 'Remover foto?', message: `A cor "${c.code}" ficará sem foto.`, confirmLabel: 'Remover' })
    if (!ok) return
    try {
      await deletePhoto(c.photo_url)
      const updated = { ...c, photo_url: null }
      await upsertColor(updated)
      writeLog({ userId: user.id, userName: user.name, action: 'removeu foto cor', target: c.code })
      if (editing && editing.id === c.id) setEditing(updated)
      await load()
    } catch (e) { toastError(toast, e) }
  }

  return <div>
    {perm.colors && <div className="card mb-md">
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="field"
          style={{ flex: 1 }}
          value={newCode}
          onChange={e => setNewCode(e.target.value)}
          placeholder="Código da cor (ex: 27, T1B/613) — separe várias por vírgula"
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button className="btn btn-primary" onClick={add}>+ Adicionar</button>
      </div>
      <div className="text-muted text-xs" style={{ marginTop: 6 }}>
        💡 Adicione 1 código ou vários separados por vírgula. Clique no card depois pra editar nome em pt, hex, foto e fábricas.
      </div>
    </div>}
    
    {/* #9 Painel de gerenciamento de categorias (colapsável) */}
    {perm.colors && (
      <div className="card mb-md" style={{ padding: 10 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowCategoriesPanel(prev => !prev)}
        >
          <strong style={{ fontSize: 13 }}>
            🏷 Categorias ({categories.length})
          </strong>
          <span className="text-muted text-xs">
            {showCategoriesPanel ? '▲ recolher' : '▼ expandir'}
          </span>
        </div>
        {showCategoriesPanel && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              {categories.map(cat => (
                <span
                  key={cat.id}
                  onClick={() => setEditingCategory(cat)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 12, cursor: 'pointer',
                    background: cat.hex || '#E5E7EB',
                    color: cat.hex ? getContrastColor(cat.hex) : '#374151',
                    fontSize: 12, fontWeight: 500,
                    border: '1px solid rgba(0,0,0,0.1)',
                  }}
                  title="Clique pra editar"
                >
                  {cat.icon && <span>{cat.icon}</span>}
                  <span>{cat.name}</span>
                  <span style={{ opacity: 0.7, fontSize: 10 }}>· {cat.color_count}</span>
                </span>
              ))}
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setEditingCategory({ name: '', hex: '', icon: '' })}
                style={{ fontSize: 11 }}
              >+ Nova categoria</button>
            </div>
            {categories.length > 0 && (
              <div className="text-muted text-xs">
                💡 Clique numa categoria pra editar. Ao editar uma cor, atribua categorias na seção dedicada.
              </div>
            )}
          </div>
        )}
      </div>
    )}
    
    {/* #9 Chips de filtro por categoria (sempre visível se há categorias) */}
    {categories.length > 0 && (
      <div className="mb-md" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        <span className="text-muted text-xs" style={{ marginRight: 4 }}>Filtrar:</span>
        {categories.map(cat => {
          const active = activeCategoryIds.includes(cat.id)
          return (
            <button
              key={cat.id}
              onClick={() => toggleCategoryFilter(cat.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 12,
                background: active ? (cat.hex || '#7c3aed') : 'transparent',
                color: active ? (cat.hex ? getContrastColor(cat.hex) : '#fff') : '#374151',
                fontSize: 11, fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
              }}
            >
              {cat.icon && <span>{cat.icon}</span>}
              <span>{cat.name}</span>
              {active && <span>✓</span>}
            </button>
          )
        })}
        {activeCategoryIds.length > 0 && (
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setActiveCategoryIds([])}
            style={{ fontSize: 11, marginLeft: 4 }}
          >Limpar filtros</button>
        )}
      </div>
    )}
    
    {/* #8 Buscador */}
    {colors.length > 6 && (
      <div className="mb-md" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="field"
          style={{ flex: 1 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Buscar por código ou nome em PT…"
        />
        {search && (
          <button className="btn btn-outline btn-sm" onClick={() => setSearch('')}>Limpar</button>
        )}
        {(() => {
          const n = colors.filter(c => !c.photo_url).length
          if (n === 0) return null
          return (
            <button
              className={`chip-filter${noPhotoOnly ? ' on' : ''}`}
              onClick={() => setNoPhotoOnly(v => !v)}
              title="Cores sem foto saem como quadrado de cor sólida na planilha da fábrica — suba as fotos delas aqui"
            >📷 Sem foto ({n})</button>
          )
        })()}
      </div>
    )}
    
    {(() => {
      // Aplica busca + filtro de categorias (multi-select OR: cor passa se tiver pelo menos uma das categorias)
      let filteredColors = colors
      if (search.trim()) {
        const q = search.toLowerCase()
        filteredColors = filteredColors.filter(c =>
          (c.code || '').toLowerCase().includes(q)
          || (c.name_pt || '').toLowerCase().includes(q)
          || (c.notes || '').toLowerCase().includes(q)
        )
      }
      if (activeCategoryIds.length > 0) {
        filteredColors = filteredColors.filter(c =>
          (c.category_ids || []).some(cid => activeCategoryIds.includes(cid))
        )
      }
      if (noPhotoOnly) {
        filteredColors = filteredColors.filter(c => !c.photo_url)
      }
      const isFiltered = !!search.trim() || activeCategoryIds.length > 0 || noPhotoOnly
      
      if (loading) return <SkeletonList rows={4} />
      if (filteredColors.length === 0 && isFiltered) {
        return (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <p>Nenhuma cor encontrada com esse filtro.</p>
            <p className="text-muted text-sm">Tente outros termos ou desmarque categorias.</p>
          </div>
        )
      }
      
      return (
        <>
          {isFiltered && filteredColors.length > 0 && (
            <div className="text-muted text-xs mb-md">
              {filteredColors.length} de {colors.length} cor(es)
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {filteredColors.map(c => {
          const usedIn = productsByColor.get(c.code)?.length || 0
          const hasFactories = (c.factories || []).length > 0
          return (
            <div key={c.id} className="card" style={{ padding: 10, cursor: 'pointer' }}
              onClick={() => perm.colors ? setEditing(c) : (usedIn > 0 && setViewing(c))}>
              <div style={{
                aspectRatio: '1',
                background: c.hex || '#f5f5f5',
                borderRadius: 6, overflow: 'hidden', marginBottom: 6, position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {c.photo_url ? (
                  <img src={c.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : c.hex ? (
                  null  // só mostra o hex de fundo
                ) : (
                  <div style={{ fontSize: 24, opacity: .3 }}>🎨</div>
                )}
                {usedIn > 0 && (
                  <span style={{ position: 'absolute', top: 4, right: 4, background: 'var(--primary)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10 }}>
                    {usedIn}
                  </span>
                )}
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, textAlign: 'center', marginBottom: 2 }}>{c.code}</div>
              {c.name_pt && (
                <div className="text-muted text-xs" style={{ textAlign: 'center', fontStyle: 'italic', marginBottom: 4 }}>
                  {c.name_pt}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap', fontSize: 10 }}>
                {usedIn > 0 && <span className="text-muted">📦 {usedIn}</span>}
                {hasFactories && <span className="text-muted">🏭 {(c.factories || []).length}</span>}
              </div>
              {/* v13.23 Categorias atribuídas (até 3, +N se mais) */}
              {(c.category_ids || []).length > 0 && (
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  {(c.category_ids || []).slice(0, 3).map(cid => {
                    const cat = categories.find(x => x.id === cid)
                    if (!cat) return null
                    return (
                      <span
                        key={cid}
                        style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 8,
                          background: cat.hex || '#E5E7EB',
                          color: cat.hex ? getContrastColor(cat.hex) : '#374151',
                          fontWeight: 500,
                        }}
                        title={cat.name}
                      >
                        {cat.icon || ''}{cat.name.slice(0, 8)}
                      </span>
                    )
                  })}
                  {(c.category_ids || []).length > 3 && (
                    <span className="text-muted" style={{ fontSize: 9 }}>+{(c.category_ids || []).length - 3}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
          </div>
        </>
      )
    })()}

    {viewing && (
      <ColorProductsModal color={viewing} products={productsByColor.get(viewing.code) || []} onClose={() => setViewing(null)} />
    )}
    {editing && (
      <ColorEditModal
        color={editing}
        factories={factories}
        categories={categories}
        usedInProductsCount={productsByColor.get(editing.code)?.length || 0}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
        onDelete={() => { setEditing(null); remove(editing) }}
        onUploadPhoto={(file) => uploadPhotoFor(editing, file)}
        onRemovePhoto={() => removePhotoFor(editing)}
        onViewProducts={() => { setViewing(editing); setEditing(null) }}
      />
    )}
    {editingCategory && (
      <CategoryEditModal
        category={editingCategory}
        onClose={() => setEditingCategory(null)}
        onSave={saveCategory}
        onDelete={editingCategory.id ? () => { removeCategory(editingCategory); setEditingCategory(null) } : null}
      />
    )}
  </div>
}

// #20 Modal completo de edição de cor: foto + nome PT + hex + fábricas + notas
// v13.23 Modal de edição de categoria de cor (criar ou editar)
// Campos: nome (obrigatório), hex (opcional + color picker), icon (emoji opcional)
function CategoryEditModal({ category, onClose, onSave, onDelete }) {
  const [f, setF] = useState({
    id: category.id,
    name: category.name || '',
    hex: category.hex || '',
    icon: category.icon || '',
  })
  const isNew = !category.id
  
  return (
    <Modal onClose={onClose} width={460} allowOutsideClose>
      <MH title={isNew ? '🏷 Nova categoria' : `🏷 Editar "${category.name}"`} onClose={onClose} />
      <MB>
        {/* Preview ao vivo */}
        <div style={{ marginBottom: 14, textAlign: 'center' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 14px', borderRadius: 14,
            background: f.hex || '#E5E7EB',
            color: f.hex ? getContrastColor(f.hex) : '#374151',
            fontSize: 14, fontWeight: 600,
            border: '1px solid rgba(0,0,0,0.1)',
          }}>
            {f.icon && <span>{f.icon}</span>}
            <span>{f.name || 'Preview'}</span>
          </span>
        </div>
        
        <div className="form-group">
          <label className="field-label">Nome *</label>
          <input
            className="field"
            value={f.name}
            onChange={e => setF({ ...f, name: e.target.value })}
            placeholder="Ex: Escuras, Loiras, Ruivas, Festa"
            autoFocus
            maxLength={50}
          />
        </div>
        
        <div className="form-group">
          <label className="field-label">Cor visual (hex, opcional)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="field"
              style={{ flex: 1 }}
              value={f.hex}
              onChange={e => setF({ ...f, hex: e.target.value })}
              placeholder="#7c3aed ou deixe vazio"
            />
            <input
              type="color"
              value={f.hex && /^#[0-9A-Fa-f]{6}$/.test(f.hex) ? f.hex : '#888888'}
              onChange={e => setF({ ...f, hex: e.target.value })}
              style={{ width: 40, height: 36, border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', padding: 0 }}
            />
          </div>
        </div>
        
        <div className="form-group">
          <label className="field-label">Ícone (1 emoji, opcional)</label>
          <input
            className="field"
            value={f.icon}
            onChange={e => {
              // Limita a aproximadamente 1 caractere visível (emojis podem ter múltiplos code points)
              const v = e.target.value
              setF({ ...f, icon: [...v].slice(0, 2).join('') })
            }}
            placeholder="🌑 ✨ 🔥 💎 ..."
            maxLength={4}
          />
          <div className="text-muted text-xs" style={{ marginTop: 4 }}>
            💡 Sugestões: 🌑 escuras · ✨ loiras · 🔥 ruivas · 🌈 fantasia · 💎 festa
          </div>
        </div>
      </MB>
      <MF>
        {!isNew && onDelete && (
          <button className="btn-icon text-danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
            🗑 Excluir
          </button>
        )}
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button
          className="btn btn-primary"
          onClick={() => onSave(f)}
          disabled={!f.name.trim()}
        >
          ✓ Salvar
        </button>
      </MF>
    </Modal>
  )
}

function ColorEditModal({ color, factories, categories = [], usedInProductsCount, onClose, onSave, onDelete, onUploadPhoto, onRemovePhoto, onViewProducts }) {
  const [f, setF] = useState({
    id: color.id,
    code: color.code,
    name_pt: color.name_pt || '',
    hex: color.hex || '',
    photo_url: color.photo_url || '',
    factories: color.factories || [],
    category_ids: color.category_ids || [],
    notes: color.notes || '',
  })
  
  // Se foto mudar (upload externo), refletir no preview
  useEffect(() => {
    setF(prev => ({ ...prev, photo_url: color.photo_url || '' }))
  }, [color.photo_url])
  
  const toggleFactory = (name) => {
    setF(prev => {
      const cur = prev.factories || []
      return {
        ...prev,
        factories: cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name],
      }
    })
  }
  
  // v13.23 Toggle categoria
  const toggleCategory = (catId) => {
    setF(prev => {
      const cur = prev.category_ids || []
      return {
        ...prev,
        category_ids: cur.includes(catId) ? cur.filter(x => x !== catId) : [...cur, catId],
      }
    })
  }
  
  return (
    <Modal onClose={onClose} width={560} allowOutsideClose>
      <MH title={`🎨 Editar cor "${color.code}"`} onClose={onClose} />
      <MB>
        <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
          {/* Preview swatch */}
          <div style={{
            width: 100, height: 100,
            background: f.hex || '#F3F4F6',
            border: '1px solid #D1D5DB',
            borderRadius: 8, overflow: 'hidden', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {f.photo_url ? (
              <img src={f.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : !f.hex && (
              <div style={{ fontSize: 30, opacity: .3 }}>🎨</div>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="btn btn-outline btn-sm" style={{ cursor: 'pointer', textAlign: 'center' }}>
              📷 {f.photo_url ? 'Trocar foto' : 'Adicionar foto'}
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => e.target.files?.[0] && onUploadPhoto(e.target.files[0])} />
            </label>
            {f.photo_url && (
              <button className="btn btn-outline btn-sm" onClick={onRemovePhoto}>❌ Remover foto</button>
            )}
            {usedInProductsCount > 0 && (
              <button className="btn btn-outline btn-sm" onClick={onViewProducts}>
                📦 Ver {usedInProductsCount} produto(s)
              </button>
            )}
          </div>
        </div>
        
        <div className="form-group">
          <label className="field-label">Nome em português (opcional)</label>
          <input
            className="field"
            value={f.name_pt}
            onChange={e => setF({ ...f, name_pt: e.target.value })}
            placeholder="Ex: preto natural, loiro 613"
          />
          <div className="text-muted text-xs" style={{ marginTop: 4 }}>
            💡 Aparece no preview ao lado do código pra evitar erros de comunicação.
          </div>
        </div>
        
        <div className="form-group">
          <label className="field-label">Cor em hex (opcional)</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="field"
              style={{ flex: 1 }}
              value={f.hex}
              onChange={e => setF({ ...f, hex: e.target.value })}
              placeholder="#000000 ou #1B0F0A"
            />
            <input
              type="color"
              value={f.hex && /^#[0-9A-Fa-f]{6}$/.test(f.hex) ? f.hex : '#888888'}
              onChange={e => setF({ ...f, hex: e.target.value })}
              style={{ width: 40, height: 36, border: '1px solid #D1D5DB', borderRadius: 6, cursor: 'pointer', padding: 0 }}
              title="Pegar cor do seletor"
            />
          </div>
          <div className="text-muted text-xs" style={{ marginTop: 4 }}>
            💡 Usado como placeholder visual quando não há foto.
          </div>
        </div>
        
        <div className="form-group">
          <label className="field-label">Fábricas que fazem esta cor bem ({(f.factories || []).length})</label>
          {factories.length === 0 ? (
            <div className="text-muted text-xs" style={{ padding: 8 }}>Cadastre fábricas em "Fábricas" primeiro.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {factories.map(fac => {
                const active = (f.factories || []).includes(fac.name)
                return (
                  <button
                    key={fac.id}
                    type="button"
                    className={`chip-filter${active ? ' on' : ''}`}
                    onClick={() => toggleFactory(fac.name)}
                  >
                    {active ? '✓ ' : ''}{fac.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        
        {/* v13.23 Categorias */}
        <div className="form-group">
          <label className="field-label">🏷 Categorias ({(f.category_ids || []).length})</label>
          {categories.length === 0 ? (
            <div className="text-muted text-xs" style={{ padding: 8 }}>
              Crie categorias no painel "🏷 Categorias" no topo do Banco de Cores.
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {categories.map(cat => {
                const active = (f.category_ids || []).includes(cat.id)
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 12,
                      background: active ? (cat.hex || '#7c3aed') : 'transparent',
                      color: active ? (cat.hex ? getContrastColor(cat.hex) : '#fff') : '#374151',
                      fontSize: 11, fontWeight: 500, cursor: 'pointer',
                      border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
                    }}
                  >
                    {cat.icon && <span>{cat.icon}</span>}
                    <span>{cat.name}</span>
                    {active && <span>✓</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        
        <div className="form-group">
          <label className="field-label">Observações (opcional)</label>
          <textarea
            className="field"
            value={f.notes}
            onChange={e => setF({ ...f, notes: e.target.value })}
            placeholder="Ex: Hairchuan faz com nuance mais quente. Pedir foto antes de fechar."
            rows={3}
          />
        </div>
      </MB>
      <MF>
        {usedInProductsCount === 0 && (
          <button className="btn-icon text-danger" onClick={onDelete} style={{ marginRight: 'auto' }}>
            🗑 Excluir cor
          </button>
        )}
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => onSave(f)}>✓ Salvar</button>
      </MF>
    </Modal>
  )
}

function ColorProductsModal({ color, products, onClose }) {
  return (
    <Modal onClose={onClose} width={720} allowOutsideClose>
      <MH title={`🎨 Cor ${color.code}${color.name_pt ? ` · ${color.name_pt}` : ''}`} onClose={onClose} />
      <MB>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <div style={{
            width: 60, height: 60,
            background: color.hex || '#f5f5f5',
            borderRadius: 8, overflow: 'hidden', flexShrink: 0,
          }}>
            {color.photo_url && <img src={color.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Fraunces',serif", color: 'var(--primary)' }}>{color.code}</div>
            {color.name_pt && <div style={{ fontSize: 13, color: '#6B7280', fontStyle: 'italic' }}>{color.name_pt}</div>}
            <div className="text-muted text-sm" style={{ marginTop: 2 }}>{products.length} produto{products.length !== 1 ? 's' : ''} usando esta cor</div>
            {(color.factories || []).length > 0 && (
              <div className="text-muted text-xs" style={{ marginTop: 2 }}>
                🏭 Fábricas que fazem bem: {(color.factories || []).join(', ')}
              </div>
            )}
          </div>
        </div>
        {color.notes && (
          <div style={{
            padding: '8px 12px', marginBottom: 16,
            background: '#FEF3C7', border: '1px solid #FCD34D',
            borderRadius: 6, fontSize: 12, color: '#92400E',
          }}>
            📝 {color.notes}
          </div>
        )}
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {products.map(({ product: p, variant }, i) => {
            const img = p.card_image_url || (p.photos || [])[0]
            return (
              <div key={p.id || `prod-${i}`} style={{ background: 'var(--surface)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
                <div style={{ aspectRatio: '3/4', background: '#f5f5f5', overflow: 'hidden', position: 'relative' }}>
                  {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 30, opacity: .3 }}>👑</div>}
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 700, fontSize: 14, color: 'var(--primary)', lineHeight: 1.2 }}>
                    {UC(p.name)}
                  </div>
                  {p.factory && (
                    <div className="text-muted text-xs" style={{ marginTop: 3 }}>
                      🏭 {p.factory}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </MB>
    </Modal>
  )
}

