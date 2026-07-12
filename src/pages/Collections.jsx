// src/pages/Collections.jsx
// v13.28 — Extraído de SimplePages.jsx

import { useEffect, useMemo, useState } from 'react'
import { Modal, MH, MB, MF, useConfirm, useToast, SkeletonList } from '../components/ui'
import { listCollections, upsertCollection, deleteCollection, addLog as writeLog } from '../lib/data/misc'
import { toastError } from '../lib/errors'
import { PROD_ST } from '../lib/constants'
import { UC, formatDate } from '../lib/utils'

export function CollectionsPage({ user, perm }) {
  const [collections, setCollections] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [viewing, setViewing] = useState(null)  // coleção clicada — mostra produtos
  const confirm = useConfirm()
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const [cs, ps] = await Promise.all([
        listCollections(),
        import('../lib/data/products').then(m => m.listProducts()),
      ])
      setCollections(cs)
      setProducts(ps)
    } catch (e) { toastError(toast, e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Indexa produtos por coleção pra mostrar contadores
  const productsByCollection = useMemo(() => {
    const m = new Map()
    for (const p of products) {
      const key = p.collection || '__sem_colecao__'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(p)
    }
    return m
  }, [products])

  const save = async (c) => {
    try {
      await upsertCollection(c)
      writeLog({ userId: user.id, userName: user.name, action: c.id ? 'editou coleção' : 'criou coleção', target: c.name })
      setModal(null)
      await load()
      toast.push('Coleção salva', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  const remove = async (c) => {
    const ok = await confirm({ title: 'Remover coleção?', message: `"${c.name}" será removida.`, danger: true, confirmLabel: 'Remover' })
    if (!ok) return
    try {
      await deleteCollection(c.id)
      writeLog({ userId: user.id, userName: user.name, action: 'removeu coleção', target: c.name })
      await load()
      toast.push('Coleção removida', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  return <div>
    <div className="toolbar"><div /><button className="btn btn-primary" onClick={() => setModal({})}>+ Nova Coleção</button></div>
    {loading ? <SkeletonList rows={4} />
    : <div className="grid-2">{collections.map(c => {
      const prodCount = (productsByCollection.get(c.name) || []).length
      return (
        <div key={c.id} className="card card-hover" style={{ opacity: c.active ? 1 : .55, cursor: prodCount > 0 ? 'pointer' : 'default' }}
          onClick={() => prodCount > 0 && setViewing(c)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {c.logo_url && <img src={c.logo_url} alt="" style={{ height: 32, borderRadius: 4 }} />}
              <div>
                <div className="card-title" style={{ margin: 0 }}>{c.name}</div>
                <p className="text-muted text-sm">{c.description || '—'}</p>
              </div>
            </div>
            {perm.collections && <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
              <button className="btn-icon" onClick={() => setModal(c)} aria-label="Editar coleção">✏️</button>
              <button className="btn-icon text-danger" onClick={() => remove(c)} aria-label="Remover coleção">🗑</button>
            </div>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="chip" style={{ background: c.active ? '#D1FAE5' : '#F3F4F6', color: c.active ? '#059669' : '#9CA3AF' }}>
              {c.active ? 'Ativa' : 'Inativa'}
            </span>
            {prodCount > 0 && <span className="chip" style={{ background: '#EEF2FF', color: '#4338CA' }}>👑 {prodCount} produto{prodCount > 1 ? 's' : ''}</span>}
          </div>
        </div>
      )
    })}</div>}
    {modal && <CollectionModal c={modal} onSave={save} onClose={() => setModal(null)} />}
    {viewing && <CollectionProductsModal collection={viewing} products={productsByCollection.get(viewing.name) || []} onClose={() => setViewing(null)} />}
  </div>
}

function CollectionProductsModal({ collection, products, onClose }) {
  return (
    <Modal onClose={onClose} width={720} allowOutsideClose>
      <MH title={`🏷️ ${collection.name}`} onClose={onClose} />
      <MB>
        {collection.description && <p className="text-muted" style={{ marginBottom: 14 }}>{collection.description}</p>}
        <div className="text-muted text-sm" style={{ marginBottom: 10 }}>
          {products.length} produto{products.length !== 1 ? 's' : ''} nesta coleção
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {products.map(p => {
            const img = p.card_image_url || (p.photos || [])[0]
            const st = PROD_ST.find(s => s.id === p.status)
            return (
              <div key={p.id} style={{ background: 'var(--surface)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
                <div style={{ aspectRatio: '3/4', background: '#f5f5f5', overflow: 'hidden', position: 'relative' }}>
                  {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 30, opacity: .3 }}>👑</div>}
                  <span className="pcard-badge" style={{ background: st?.color }}>{st?.icon}</span>
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>{UC(p.name)}</div>
                  <div className="text-muted text-xs" style={{ marginTop: 2 }}>{p.finish_type || '—'}</div>
                  {(p.color_variants || []).length > 0 && <div className="text-muted text-xs" style={{ marginTop: 2 }}>{p.color_variants.length} cor{p.color_variants.length > 1 ? 'es' : ''}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </MB>
    </Modal>
  )
}

function CollectionModal({ c, onSave, onClose }) {
  const [f, setF] = useState({ name: c.name || '', description: c.description || '', active: c.active ?? true, logo_url: c.logo_url || '', id: c.id })
  const [dirty, setDirty] = useState(false)
  const s = (k, v) => { setF(p => ({ ...p, [k]: v })); setDirty(true) }
  return <Modal onClose={onClose} width={480} isDirty={dirty}>
    <MH title={c.id ? 'Editar Coleção' : 'Nova Coleção'} onClose={onClose} />
    <MB>
      <div className="form-group"><label className="field-label">Nome *</label><input className="field" value={f.name} onChange={e => s('name', e.target.value)} autoFocus /></div>
      <div className="form-group"><label className="field-label">Descrição</label><textarea className="field" value={f.description} onChange={e => s('description', e.target.value)} /></div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={f.active} onChange={e => s('active', e.target.checked)} /> Ativa</label>
    </MB>
    <MF>
      <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => onSave(f)} disabled={!f.name}>Salvar</button>
    </MF>
  </Modal>
}

