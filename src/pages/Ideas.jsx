// src/pages/Ideas.jsx
// v13.28 — Extraído de SimplePages.jsx
// Inclui IdeasPage + IdeaModal (a página mais complexa fora de Orders/Products)

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, MH, MB, MF, Lightbox, useConfirm, useToast, SkeletonList, ClearFiltersButton } from '../components/ui'
import { NameAutocomplete } from '../components/NameAutocomplete'
import { FavoriteStar } from '../components/FavoriteStar'
import {
  listIdeas, createIdea, updateIdea, deleteIdea,
  listCollections, listColors, listFactories, listNames,
  addLog as writeLog,
} from '../lib/data/misc'
import { uploadProductPhoto, deletePhoto } from '../lib/storage'
import { IDEA_ST, FINISH, MATERIALS, HTYPES, HLENS, REP_TYPES, REP_SIZES, REP_ACAB } from '../lib/constants'
import { toastError } from '../lib/errors'
import { useStickyFilter, clearStickyFilters } from '../lib/hooks'
import { uid, UC, formatDate } from '../lib/utils'
import { trackAction } from '../lib/analytics'

export function IdeasPage({ user, perm, initialData = [], onMutate }) {
  const [ideas, setIdeas] = useState(initialData)
  const [loading, setLoading] = useState(initialData.length === 0)
  const [filter, setFilter] = useStickyFilter('ideas.filter', 'active')
  const [modal, setModal] = useState(null)
  const [collections, setCollections] = useState([])
  const [factories, setFactories] = useState([])
  const [colors, setColors] = useState([])
  const [names, setNames] = useState([])
  const [existingProducts, setExistingProducts] = useState([])
  const confirm = useConfirm()
  const toast = useToast()

  const load = async () => {
    if (ideas.length === 0) setLoading(true)
    try {
      const { listProducts } = await import('../lib/data/products')
      const [i, c, f, col, n, p] = await Promise.all([
        listIdeas(), listCollections(), listFactories().catch(() => []), listColors(),
        listNames().catch(() => []), listProducts().catch(() => []),
      ])
      setIdeas(i); setCollections(c); setFactories(f); setColors(col)
      setNames(n); setExistingProducts(p)
    } catch (e) { toastError(toast, e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const active = ideas.filter(i => i.status !== 'discarded')
  const trash = ideas.filter(i => i.status === 'discarded')
  const shown = filter === 'active' ? active : trash

  // Note que agora a ideia tem color_variants que persiste junto com a ideia.
  // Campo não é coluna própria, vai pro JSONB timeline (reaproveitando o campo)
  // ou melhor, adicionamos como campo livre. Por simplicidade guardamos no
  // campo `timeline` um entry tipo {type:'color_ideas', data:[...]} ou
  // usamos uma coluna nova. Pra não mexer em schema, salvo inline no notes
  // via convenção — mas o jeito mais correto seria coluna própria.
  // Decisão pragmática: guardo em internal_notes usando chave.
  // ATUALIZAÇÃO: a tabela ideas já tem `timeline` (jsonb). Uso isso sem criar coluna.

  const save = async (ideaForm) => {
    try {
      const { color_variants, ...rest } = ideaForm
      rest.name = UC(rest.name)
      // Armazena color_variants dentro do timeline (JSONB, já existe na tabela).
      // Estratégia: ultimo elemento do timeline com type='color_ideas' guarda estado.
      const tl = Array.isArray(rest.timeline) ? rest.timeline.filter(t => t.type !== 'color_ideas') : []
      if (color_variants && color_variants.length) {
        tl.push({ type: 'color_ideas', data: color_variants.map(cv => ({ code: cv.code, status: cv.status || 'idea' })) })
      }
      rest.timeline = tl

      if (rest.id) {
        await updateIdea(rest.id, rest)
        writeLog({ userId: user.id, userName: user.name, action: 'editou ideia', target: rest.name, entityType: 'idea', entityId: rest.id })
      } else {
        const created = await createIdea({ ...rest, created_by: user.id })
        writeLog({ userId: user.id, userName: user.name, action: 'criou ideia', target: rest.name, entityType: 'idea', entityId: created.id })
        trackAction('create_idea', { name: rest.name })
      }
      setModal(null)
      await load(); onMutate?.()
      toast.push('Ideia salva', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  // Função: converter ideia em produto (bug #2 parte do pedido da v9)
  const convertToProduct = async (ideaForm) => {
    const ok = await confirm({
      title: 'Tornar produto?',
      message: `A ideia "${ideaForm.name}" vira um produto em Desenvolvimento com TODOS os dados preenchidos (foto, cores, fábrica, etc.). A ideia some daqui — você pode voltar depois com "📉 Tornar Ideia" no produto.`,
      confirmLabel: 'Sim, criar produto',
    })
    if (!ok) return
    try {
      const { createProduct } = await import('../lib/data/products')
      const colorVariants = (ideaForm.color_variants || []).map(cv => ({
        code: cv.code,
        status: 'idea',  // produto novo é 'developing', cores viram 'idea' (coerência)
        sku: cv.sku || null,
      }))
      const newProd = await createProduct({
        name: UC(ideaForm.name),
        status: 'developing',
        collection: ideaForm.collection || null,
        factory: ideaForm.factory || null,
        factory_code: ideaForm.factory_code || null,
        finish_type: ideaForm.finish_type || null,
        reparticao: ideaForm.reparticao || null,
        reparticao_size: ideaForm.reparticao_size || null,
        reparticao_acabamento: ideaForm.reparticao_acabamento || null,
        pre_plucked: !!ideaForm.pre_plucked,
        hair_type: ideaForm.hair_type || null,
        length: ideaForm.length || null,
        material: ideaForm.material || null,
        notes: ideaForm.notes || null,
        card_image_url: ideaForm.card_image_url || null,
        photos: ideaForm.photos || [],
        price_usd: ideaForm.price_usd || null,
        color_variants: colorVariants,
        timeline: [{ status: 'developing', date: new Date().toISOString(), note: `Convertido da ideia` }],
        created_by: user.id,
        from_idea_id: ideaForm.id || null,  // v13.32 — vínculo explícito pra funil
      })
      // Deleta a ideia (sem virar discarded — ideia E produto não podem coexistir
      // com mesmo nome por causa de UNIQUE constraints, e isso evita confusão visual)
      if (ideaForm.id) {
        await deleteIdea(ideaForm.id)
      }
      writeLog({ userId: user.id, userName: user.name, action: 'converteu ideia em produto', target: ideaForm.name, entityType: 'product', entityId: newProd.id })
      setModal(null)
      await load(); onMutate?.()
      toast.push('Ideia convertida em produto', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  const remove = async (i) => {
    const ok = await confirm({
      title: 'Excluir ideia?', message: `"${i.name}" será removida permanentemente.`,
      confirmLabel: 'Excluir', danger: true,
    })
    if (!ok) return
    try {
      await deleteIdea(i.id)
      writeLog({ userId: user.id, userName: user.name, action: 'excluiu ideia', target: i.name, entityType: 'idea' })
      await load(); onMutate?.()
      toast.push('Ideia excluída', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  if (!perm.ideas) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Você não tem permissão para ver ideias.</p></div>

  return <div>
    <div className="toolbar">
      <div className="chip-bar" style={{ margin: 0, alignItems: 'center', gap: 6 }}>
        <button className={`chip-filter${filter === 'active' ? ' on' : ''}`} onClick={() => setFilter('active')}>Ativas ({active.length})</button>
        <button className={`chip-filter${filter === 'discarded' ? ' on' : ''}`} onClick={() => setFilter('discarded')}>Descartadas ({trash.length})</button>
        <ClearFiltersButton
          visible={filter !== 'active'}
          onClear={() => clearStickyFilters('ideas')}
        />
      </div>
      <button className="btn btn-primary" onClick={() => setModal({})}>+ Nova Ideia</button>
    </div>
    {loading ? <SkeletonList rows={4} />
    : shown.length === 0 ? <div className="empty-state"><div className="empty-icon">💡</div><p>Nenhuma ideia.</p></div>
    : <div className="product-grid">{shown.map(i => {
        const st = IDEA_ST.find(s => s.id === i.status)
        const img = i.card_image_url || (i.photos || [])[0]
        // Extrai color_variants do timeline pra preview
        const tlColorEntry = (i.timeline || []).find(t => t?.type === 'color_ideas')
        const cvCount = tlColorEntry?.data?.length || 0
        return (
          <div key={i.id} className="pcard" onClick={() => {
            // Ao abrir pra editar, "desenrola" as cores do timeline
            const colorVariants = tlColorEntry?.data?.map((c, idx) => ({ ...c, id: 'tmp-' + idx })) || []
            setModal({ ...i, color_variants: colorVariants })
          }}>
            <div className="pcard-img">
              {img ? <img src={img} alt={i.name} /> : <div className="pcard-ph">💡</div>}
              <span className="pcard-badge" style={{ background: st?.color }}>{st?.icon}</span>
              {/* v13.44 — Favoritar ideia */}
              <div style={{ position: 'absolute', bottom: 6, right: 6, zIndex: 2, background: 'rgba(255,255,255,.88)', borderRadius: 4, backdropFilter: 'blur(4px)' }}>
                <FavoriteStar entityType="idea" entityId={i.id} size="sm" />
              </div>
            </div>
            <div className="pcard-info">
              <div className="pcard-name">{UC(i.name)}</div>
              <div className="text-muted text-sm">{[i.collection, i.finish_type].filter(Boolean).join(' · ') || '—'}</div>
              <div className="tag-row">
                {i.material && <span className="tag">{i.material}</span>}
                {cvCount > 0 && <span className="tag">{cvCount} cor{cvCount > 1 ? 'es' : ''}</span>}
              </div>
            </div>
          </div>
        )
      })}</div>}
    {modal && (
      <IdeaModal
        idea={modal}
        onSave={save}
        onConvertToProduct={convertToProduct}
        onDelete={modal.id ? () => { setModal(null); remove(modal) } : null}
        onClose={() => setModal(null)}
        collections={collections}
        factories={factories}
        colors={colors}
        names={names}
        existingProducts={existingProducts}
        existingIdeas={ideas}
        perm={perm}
      />
    )}
  </div>
}

function IdeaModal({ idea, onSave, onDelete, onClose, onConvertToProduct, collections, factories, colors, names = [], existingProducts = [], existingIdeas = [], perm }) {
  const [f, setF] = useState(() => {
    const base = idea || {}
    return {
      ...base,
      name: base.name || '',
      status: base.status || 'possibility',
      collection: base.collection || '',
      factory: base.factory || '',
      factory_code: base.factory_code || '',
      finish_type: base.finish_type || '',
      reparticao: base.reparticao || '',
      reparticao_size: base.reparticao_size || '',
      reparticao_acabamento: base.reparticao_acabamento || '',
      pre_plucked: !!base.pre_plucked,
      hair_type: base.hair_type || '',
      length: base.length || '',
      material: base.material || '',
      notes: base.notes || '',
      card_image_url: base.card_image_url || '',
      photos: base.photos || [],
      price_usd: base.price_usd || '',
      color_variants: base.color_variants || [],  // ideias de cor (mesmo formato que produtos)
    }
  })
  const [dirty, setDirty] = useState(false)
  const [uploading, setUploading] = useState(false)
  // v13.40 — Lightbox pra expandir foto da ideia (igual Products)
  const [lb, setLb] = useState(null)
  const toast = useToast()
  const s = (k, v) => { setF(p => ({ ...p, [k]: v })); setDirty(true) }
  
  const uploadCardImage = async (file) => {
    setUploading(true)
    try {
      const { url } = await uploadProductPhoto(file, 'ideas/card')
      if (f.card_image_url) await deletePhoto(f.card_image_url).catch(() => {})
      s('card_image_url', url)
    } catch (e) { toastError(toast, e) }
    setUploading(false)
  }
  const uploadGallery = async (files) => {
    setUploading(true)
    try {
      const results = await Promise.allSettled(
        files.map(file => uploadProductPhoto(file, 'ideas/gallery'))
      )
      const urls = results.filter(r => r.status === 'fulfilled').map(r => r.value.url)
      if (urls.length) s('photos', [...(f.photos || []), ...urls])
    } catch (e) { toastError(toast, e) }
    setUploading(false)
  }
  const removePhoto = async (url) => {
    await deletePhoto(url).catch(() => {})
    s('photos', (f.photos || []).filter(p => p !== url))
  }

  const addCV = () => { setF(prev => ({ ...prev, color_variants: [...(prev.color_variants || []), { id: 'tmp-' + uid(), code: '', status: 'idea' }] })); setDirty(true) }
  const updCV = (id, key, val) => { setF(prev => ({ ...prev, color_variants: (prev.color_variants || []).map(c => c.id === id ? { ...c, [key]: val } : c) })); setDirty(true) }
  const rmCV = (id) => { setF(prev => ({ ...prev, color_variants: (prev.color_variants || []).filter(c => c.id !== id) })); setDirty(true) }

  const showRep = f.finish_type && (f.finish_type.includes('Lace') || f.finish_type.includes('Closure') || f.finish_type === 'HD Lace' || f.finish_type === 'Transparent Lace')

  return <>
    {lb && <Lightbox src={typeof lb === 'string' ? lb : undefined} sources={typeof lb === 'object' ? lb.sources : undefined} initialIndex={typeof lb === 'object' ? lb.index : undefined} onClose={() => setLb(null)} />}
    <Modal onClose={onClose} width={700} isDirty={dirty}>
    <MH title={idea.id ? 'Editar Ideia' : 'Nova Ideia'} onClose={onClose} actions={
      idea.id && onConvertToProduct && perm?.products ? (
        <button className="btn btn-accent btn-sm" onClick={() => onConvertToProduct(f)}>➡️ Tornar Produto</button>
      ) : null
    } />
    <MB>
      {/* v13.35 — Layout reorganizado:
          1) Foto + Nome+Status (essencial)
          2) Cores (subiram do fim pro topo — fluxo comum)
          3) Coleção + Fábrica (comum)
          4-6) Seções expansíveis pra campos menos usados
      */}
      
      {/* SEÇÃO 1: Foto + Nome + Status */}
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 14, marginBottom: 14 }}>
        <div>
          <div style={{ aspectRatio: '3/4', background: '#f5f5f5', borderRadius: 8, overflow: 'hidden', position: 'relative', border: '1px dashed var(--border)' }}>
            {f.card_image_url
              ? <img
                  src={f.card_image_url}
                  alt=""
                  onClick={() => setLb(f.card_image_url)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }}
                  title="Clique pra ampliar"
                />
              : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>💡 Foto</div>}
            {uploading && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>Enviando...</div>}
          </div>
          <label className="btn btn-outline btn-sm" style={{ display: 'flex', cursor: 'pointer', justifyContent: 'center', marginTop: 6 }}>
            📷 {f.card_image_url ? 'Trocar' : 'Adicionar'}
            <input type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && uploadCardImage(e.target.files[0])} />
          </label>
          {f.card_image_url && (
            <button
              className="btn btn-outline btn-sm"
              style={{ width: '100%', marginTop: 4, color: '#DC2626' }}
              onClick={async () => {
                await deletePhoto(f.card_image_url).catch(() => {})
                s('card_image_url', '')
              }}
            >
              ❌ Remover foto
            </button>
          )}
        </div>
        <div>
          <div className="form-group">
            <label className="field-label">
              Nome *
              {(names || []).length > 0 && <span className="text-muted text-xs" style={{ marginLeft: 6, fontWeight: 400 }}>— sugestões do banco de nomes</span>}
            </label>
            <NameAutocomplete
              value={f.name}
              onChange={val => s('name', val)}
              suggestions={names || []}
              excludeNames={[
                ...(existingProducts || []).map(p => p.name),
                ...(existingIdeas || []).map(i => i.name),
              ]}
              autoFocus
              placeholder="Nome da ideia"
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="field-label">Status</label>
            <select className="field" value={f.status} onChange={e => s('status', e.target.value)}>
              {IDEA_ST.map(x => <option key={x.id} value={x.id}>{x.icon} {x.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* SEÇÃO 2: Ideias de Cor (SUBIU — fluxo comum ao criar ideia) */}
      <div className="form-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label className="field-label" style={{ margin: 0 }}>🎨 Ideias de Cor ({(f.color_variants || []).length})</label>
          <button className="btn btn-outline btn-sm" onClick={addCV}>+ Cor</button>
        </div>
        {(f.color_variants || []).length === 0 ? (
          <div className="text-muted text-xs" style={{ padding: '6px 0' }}>
            Ainda sem cores. Adicione as cores que pretende produzir.
          </div>
        ) : (
          (f.color_variants || []).map(cv => (
            <div key={cv.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, marginBottom: 6 }}>
              <select className="field field-sm" value={cv.code} onChange={e => updCV(cv.id, 'code', e.target.value)}>
                <option value="">Cor</option>
                {(colors || []).map(c => <option key={c.id} value={c.code}>{c.code}</option>)}
              </select>
              <button className="btn-icon text-danger" onClick={() => rmCV(cv.id)} aria-label="Remover cor">✕</button>
            </div>
          ))
        )}
      </div>

      {/* SEÇÃO 3: Coleção + Fábrica */}
      <div className="form-row">
        <div className="form-group">
          <label className="field-label">Coleção</label>
          <select className="field" value={f.collection || ''} onChange={e => s('collection', e.target.value)}>
            <option value="">—</option>
            {(collections || []).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
        {perm?.factoryInfo && (
          <div className="form-group">
            <label className="field-label">Fábrica (sugerida)</label>
            <select className="field" value={f.factory || ''} onChange={e => s('factory', e.target.value)}>
              <option value="">—</option>
              {(factories || []).map(fa => <option key={fa.id} value={fa.name}>{fa.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* SEÇÃO 4 (expansível): Características técnicas
          — acabamento, material, tipo de fio, comprimento
          Abre automaticamente se EDITANDO ideia com campos preenchidos,
          caso contrário inicia fechado pra não poluir o modal. */}
      <details
        open={!!(f.finish_type || f.material || f.hair_type || f.length)}
        style={{
          border: '1px solid var(--border-light)',
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 12,
          background: 'var(--surface)',
        }}
      >
        <summary style={{
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 13,
          padding: '2px 0',
          userSelect: 'none',
          color: 'var(--text)',
        }}>
          ⚙️ Características técnicas
          {(f.finish_type || f.material || f.hair_type || f.length) && (
            <span className="text-muted text-xs" style={{ marginLeft: 8, fontWeight: 400 }}>
              · {[f.finish_type, f.material, f.hair_type, f.length].filter(Boolean).length} preenchido(s)
            </span>
          )}
        </summary>
        <div style={{ marginTop: 12 }}>
          <div className="form-row">
            <div className="form-group">
              <label className="field-label">Acabamento</label>
              {(() => {
                const COMMON = ['Wig (sem lace)', 'Lace Front']
                const isCommon = COMMON.includes(f.finish_type)
                const setFinish = (val) => {
                  s('finish_type', val)
                  s('reparticao', '')
                  s('reparticao_size', '')
                  s('reparticao_acabamento', '')
                }
                return (
                  <div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      {COMMON.map(opt => {
                        const active = f.finish_type === opt
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => setFinish(opt)}
                            style={{
                              flex: 1,
                              padding: '10px 12px',
                              borderRadius: 8,
                              border: `2px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                              background: active ? 'var(--primary)' : '#fff',
                              color: active ? '#fff' : 'var(--text)',
                              fontWeight: 600,
                              fontSize: 13,
                              cursor: 'pointer',
                              transition: 'all .15s',
                            }}
                          >
                            {opt === 'Wig (sem lace)' ? '👱 Wig' : '✨ Lace Front'}
                          </button>
                        )
                      })}
                    </div>
                    <select
                      className="field field-sm"
                      value={isCommon || !f.finish_type ? '' : f.finish_type}
                      onChange={e => setFinish(e.target.value)}
                      style={{ fontSize: 12 }}
                    >
                      <option value="">Outros acabamentos (raro)</option>
                      {FINISH.filter(x => !COMMON.includes(x)).map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </div>
                )
              })()}
            </div>
            <div className="form-group">
              <label className="field-label">Material</label>
              <select className="field" value={f.material || ''} onChange={e => s('material', e.target.value)}>
                <option value="">—</option>
                {MATERIALS.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          </div>
          
          {/* Repartição (só se tiver lace) */}
          {f.finish_type && f.finish_type !== 'Wig (sem lace)' && (
            <div className="form-row">
              <div className="form-group">
                <label className="field-label">Tipo de repartição</label>
                <select className="field" value={f.reparticao || ''} onChange={e => s('reparticao', e.target.value)}>
                  <option value="">—</option>
                  {REP_TYPES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="field-label">Tamanho (se aplicável)</label>
                <select className="field" value={f.reparticao_size || ''} onChange={e => s('reparticao_size', e.target.value)}>
                  <option value="">—</option>
                  {REP_SIZES.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="field-label">Acabamento da repart.</label>
                <select className="field" value={f.reparticao_acabamento || ''} onChange={e => s('reparticao_acabamento', e.target.value)}>
                  <option value="">—</option>
                  {REP_ACAB.map(x => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
            </div>
          )}
          
          <div className="form-row" style={{ marginBottom: 0 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="field-label">Tipo de Fio</label>
              <select className="field" value={f.hair_type || ''} onChange={e => s('hair_type', e.target.value)}>
                <option value="">—</option>
                {HTYPES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="field-label">Comprimento</label>
              <select className="field" value={f.length || ''} onChange={e => s('length', e.target.value)}>
                <option value="">—</option>
                {HLENS.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0, display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!f.pre_plucked}
                  onChange={e => s('pre_plucked', e.target.checked)}
                />
                Pré-plucked
              </label>
            </div>
          </div>
        </div>
      </details>

      {/* SEÇÃO 5 (expansível, só admin): Preço + código fábrica */}
      {perm?.prices && (
        <details
          open={!!(f.price_usd || f.factory_code)}
          style={{
            border: '1px solid var(--border-light)',
            borderRadius: 8,
            padding: '8px 12px',
            marginBottom: 12,
            background: 'var(--surface)',
          }}
        >
          <summary style={{
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
            padding: '2px 0',
            userSelect: 'none',
            color: 'var(--text)',
          }}>
            💲 Preço estimado
          </summary>
          <div style={{ marginTop: 12 }}>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="field-label">Código Fábrica</label>
                <input className="field" value={f.factory_code || ''} onChange={e => s('factory_code', e.target.value)} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="field-label">Preço USD estimado</label>
                <input className="field" type="number" step="0.01" value={f.price_usd || ''} onChange={e => s('price_usd', e.target.value)} />
              </div>
            </div>
          </div>
        </details>
      )}

      {/* SEÇÃO 6 (expansível): Referências visuais + Observações */}
      <details
        open={!!(f.photos && f.photos.length > 0) || !!f.notes}
        style={{
          border: '1px solid var(--border-light)',
          borderRadius: 8,
          padding: '8px 12px',
          marginBottom: 0,
          background: 'var(--surface)',
        }}
      >
        <summary style={{
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 13,
          padding: '2px 0',
          userSelect: 'none',
          color: 'var(--text)',
        }}>
          📎 Referências visuais e observações
          {((f.photos && f.photos.length > 0) || f.notes) && (
            <span className="text-muted text-xs" style={{ marginLeft: 8, fontWeight: 400 }}>
              · {(f.photos?.length || 0)} foto(s){f.notes ? ' · com observação' : ''}
            </span>
          )}
        </summary>
        <div style={{ marginTop: 12 }}>
          <div className="form-group">
            <label className="field-label">Fotos de referência ({(f.photos || []).length})</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(f.photos || []).map((url, idx) => (
                <div key={url} style={{ width: 60, height: 60, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                  <img
                    src={url}
                    alt=""
                    onClick={() => setLb({ sources: f.photos, index: idx })}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }}
                    title="Clique pra ampliar"
                  />
                  <button onClick={() => removePhoto(url)} aria-label="Remover foto" style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,0,0,.8)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer' }}>✕</button>
                </div>
              ))}
              <label style={{ width: 60, height: 60, borderRadius: 6, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                +<input type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={e => e.target.files?.length && uploadGallery([...e.target.files])} />
              </label>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="field-label">Observações</label>
            <textarea className="field" value={f.notes || ''} onChange={e => s('notes', e.target.value)} rows={2} />
          </div>
        </div>
      </details>
    </MB>
    <MF>
      {onDelete && <button className="btn-icon text-danger" onClick={onDelete} aria-label="Excluir ideia" style={{ marginRight: 'auto' }}>🗑</button>}
      <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" onClick={() => onSave(f)} disabled={!f.name || uploading}>
        {uploading ? 'Enviando...' : 'Salvar'}
      </button>
    </MF>
  </Modal>
  </>
}

