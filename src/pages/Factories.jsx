// src/pages/Factories.jsx
// v13.28 — Extraído de SimplePages.jsx
// Inclui FactoriesPage + FactoryDetailModal + FactoryModal

import { useEffect, useMemo, useState } from 'react'
import { Modal, MH, MB, MF, useConfirm, useToast, SkeletonList } from '../components/ui'
import { FactoryDashboardModal } from '../components/FactoryDashboardModal'
import { FactoriesComparator } from '../components/FactoriesComparator'
import {
  listFactories, upsertFactory, deleteFactory,
  listColors, addLog as writeLog,
} from '../lib/data/misc'
import { toastError } from '../lib/errors'
import { PROD_ST, ORDER_ST } from '../lib/constants'
import { uid, formatDate, UC } from '../lib/utils'

export function FactoriesPage({ user, perm }) {
  const [factories, setFactories] = useState([])
  const [products, setProducts] = useState([])
  const [orders, setOrders] = useState([])
  const [colors, setColors] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [dashboardFor, setDashboardFor] = useState(null)  // #20 fábrica c/ dashboard aberto
  const [comparatorOpen, setComparatorOpen] = useState(false)  // #21 comparador de fábricas
  const confirm = useConfirm()
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const [fs, ps, os, cs] = await Promise.all([
        listFactories(),
        import('../lib/data/products').then(m => m.listProducts()),
        import('../lib/data/orders').then(m => m.listOrders()).catch(() => []),
        listColors(),
      ])
      setFactories(fs); setProducts(ps); setOrders(os); setColors(cs)
    } catch (e) { toastError(toast, e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (!perm.factories) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Sem permissão.</p></div>

  // Indexa: produtos e pedidos por fábrica
  const countsByFactory = useMemo(() => {
    const m = new Map()
    for (const p of products) {
      const names = [p.factory, ...(p.suppliers || []).map(s => s.factory)].filter(Boolean)
      for (const n of new Set(names)) {
        if (!m.has(n)) m.set(n, { products: [], orders: [] })
        m.get(n).products.push(p)
      }
    }
    for (const o of orders) {
      if (!o.factory) continue
      if (!m.has(o.factory)) m.set(o.factory, { products: [], orders: [] })
      m.get(o.factory).orders.push(o)
    }
    return m
  }, [products, orders])

  const save = async (f) => {
    try {
      await upsertFactory(f)
      writeLog({ userId: user.id, userName: user.name, action: f.id ? 'editou fábrica' : 'criou fábrica', target: f.name })
      setModal(null)
      await load()
      toast.push('Fábrica salva', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  const remove = async (f) => {
    const ok = await confirm({ title: 'Remover fábrica?', message: `"${f.name}" será removida.`, danger: true, confirmLabel: 'Remover' })
    if (!ok) return
    try {
      await deleteFactory(f.id)
      writeLog({ userId: user.id, userName: user.name, action: 'removeu fábrica', target: f.name })
      await load()
    } catch (e) { toastError(toast, e) }
  }

  return <div>
    <div className="toolbar">
      <div>
        {factories.length >= 2 && (
          <button
            className="btn btn-outline"
            onClick={() => setComparatorOpen(true)}
            title="Comparar todas as fábricas lado-a-lado"
          >📊 Comparar fábricas</button>
        )}
      </div>
      <button className="btn btn-primary" onClick={() => setModal({})}>+ Nova Fábrica</button>
    </div>
    {loading ? <SkeletonList rows={4} />
    : <div className="grid-2">{factories.map(f => {
      const counts = countsByFactory.get(f.name) || { products: [], orders: [] }
      const contactCount = Array.isArray(f.wechats) ? f.wechats.length : (f.contact ? 1 : 0)
      return (
        <div key={f.id} className="card card-hover" style={{ cursor: (counts.products.length > 0 || counts.orders.length > 0) ? 'pointer' : 'default' }}
          onClick={() => (counts.products.length > 0 || counts.orders.length > 0) && setViewing(f)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div>
              <div className="card-title" style={{ margin: 0 }}>{f.name}</div>
              <p className="text-muted text-sm">{f.country}</p>
              {contactCount > 0 && <p className="text-sm" style={{ marginTop: 4 }}>💬 {contactCount} contato{contactCount > 1 ? 's' : ''}</p>}
              {f.notes && <p className="text-muted text-xs" style={{ marginTop: 4 }}>{f.notes}</p>}
            </div>
            <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
              {counts.orders.length > 0 && (
                <button
                  className="btn-icon"
                  onClick={() => setDashboardFor(f)}
                  title="Ver dashboard com métricas desta fábrica"
                >📊</button>
              )}
              <button className="btn-icon" onClick={() => setModal(f)} aria-label="Editar fábrica">✏️</button>
              <button className="btn-icon text-danger" onClick={() => remove(f)} aria-label="Remover fábrica">🗑</button>
            </div>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {counts.products.length > 0 && <span className="chip" style={{ background: '#EEF2FF', color: '#4338CA' }}>👑 {counts.products.length} produto{counts.products.length > 1 ? 's' : ''}</span>}
            {counts.orders.length > 0 && <span className="chip" style={{ background: '#FFFBEB', color: '#92400E' }}>📋 {counts.orders.length} pedido{counts.orders.length > 1 ? 's' : ''}</span>}
          </div>
        </div>
      )
    })}</div>}
    {modal && <FactoryModal f={modal} onSave={save} onClose={() => setModal(null)} />}
    {viewing && <FactoryDetailModal factory={viewing} products={countsByFactory.get(viewing.name)?.products || []} orders={countsByFactory.get(viewing.name)?.orders || []} onClose={() => setViewing(null)} />}
    {dashboardFor && (
      <FactoryDashboardModal
        factory={dashboardFor}
        orders={orders}
        products={products}
        perm={perm}
        onClose={() => setDashboardFor(null)}
      />
    )}
    {comparatorOpen && (
      <FactoriesComparator
        factories={factories}
        orders={orders}
        onClose={() => setComparatorOpen(false)}
      />
    )}
  </div>
}

function FactoryDetailModal({ factory, products, orders, onClose }) {
  const [tab, setTab] = useState('products')
  const contacts = Array.isArray(factory.wechats) ? factory.wechats : []
  const TYPE_ICONS = { wechat: '💬', whatsapp: '📱', email: '📧', phone: '☎️' }

  return (
    <Modal onClose={onClose} width={750} allowOutsideClose>
      <MH title={`🏭 ${factory.name}`} onClose={onClose} />
      <MB>
        <div className="text-muted text-sm" style={{ marginBottom: 10 }}>{factory.country}</div>

        {/* Contatos */}
        {contacts.length > 0 && (
          <div style={{ background: '#F5F2EF', padding: 12, borderRadius: 8, marginBottom: 14 }}>
            <div className="field-label">💬 Contatos</div>
            {contacts.map((c, i) => {
              const val = typeof c === 'string' ? c : c.value
              const type = typeof c === 'string' ? 'wechat' : c.type
              const label = typeof c === 'object' ? c.label : ''
              return (
                <div key={`${type}-${val || 'x'}-${i}`} style={{ fontSize: 13, padding: '3px 0' }}>
                  <span>{TYPE_ICONS[type] || '📱'}</span>
                  <strong style={{ marginLeft: 6 }}>{val}</strong>
                  {label && <span className="text-muted" style={{ marginLeft: 6, fontSize: 12 }}>— {label}</span>}
                </div>
              )
            })}
          </div>
        )}

        {factory.notes && (
          <div style={{ padding: 10, background: '#f9fafb', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>
            {factory.notes}
          </div>
        )}

        <div className="chip-bar" style={{ marginBottom: 14 }}>
          <button className={`chip-filter${tab === 'products' ? ' on' : ''}`} onClick={() => setTab('products')}>
            👑 Produtos ({products.length})
          </button>
          <button className={`chip-filter${tab === 'orders' ? ' on' : ''}`} onClick={() => setTab('orders')}>
            📋 Pedidos ({orders.length})
          </button>
        </div>

        {tab === 'products' && (
          products.length === 0 ? <div className="text-muted text-sm" style={{ textAlign: 'center', padding: 20 }}>Nenhum produto cadastrado com essa fábrica.</div>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {products.map(p => {
                const img = p.card_image_url || (p.photos || [])[0]
                const st = PROD_ST.find(s => s.id === p.status)
                const isMain = p.factory === factory.name
                return (
                  <div key={p.id} style={{ background: 'var(--surface)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
                    <div style={{ aspectRatio: '3/4', background: '#f5f5f5', overflow: 'hidden', position: 'relative' }}>
                      {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 30, opacity: .3 }}>👑</div>}
                      <span className="pcard-badge" style={{ background: st?.color }}>{st?.icon}</span>
                    </div>
                    <div style={{ padding: '10px 12px' }}>
                      <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>{UC(p.name)}</div>
                      <div className="text-muted text-xs">{p.collection || '—'}</div>
                      <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {isMain ? <span className="tag" style={{ background: '#EEF2FF', color: '#4338CA' }}>Principal</span>
                               : <span className="tag">Secundária</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
        )}

        {tab === 'orders' && (
          orders.length === 0 ? <div className="text-muted text-sm" style={{ textAlign: 'center', padding: 20 }}>Nenhum pedido feito para essa fábrica.</div>
          : <div>
              {orders.map(o => {
                const oSt = ORDER_ST.find(s => s.id === o.status)
                const totalQty = (o.items || []).reduce((a, it) => {
                  const cls = it.colors || []
                  return a + cls.reduce((b, c) => b + Number(c.qty || 0), 0) + (cls.length === 0 ? Number(it.quantity || 0) : 0)
                }, 0)
                return (
                  <div key={o.id} style={{ padding: 10, background: 'var(--surface)', borderRadius: 6, marginBottom: 6, border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="chip" style={{ background: oSt?.color + '20', color: oSt?.color }}>{oSt?.icon}</span>
                    <div style={{ flex: 1 }}>
                      <strong>{o.order_name || `Pedido ${o.id.slice(0, 6)}`}</strong>
                      <div className="text-muted text-xs">
                        {formatDate(o.created_at, 'full')} · {(o.items || []).length} item{(o.items || []).length > 1 ? 's' : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ color: 'var(--primary)' }}>{totalQty} pçs</strong>
                    </div>
                  </div>
                )
              })}
            </div>
        )}
      </MB>
    </Modal>
  )
}

function FactoryModal({ f, onSave, onClose }) {
  // Contatos guardados na coluna JSONB `wechats` (já existe).
  // Cada contato: { type: 'wechat'|'whatsapp'|'email'|'phone', label?, value }
  const [form, setForm] = useState({
    name: f.name || '',
    country: f.country || 'China',
    notes: f.notes || '',
    id: f.id,
    contacts: Array.isArray(f.wechats) && f.wechats.length
      ? f.wechats.map(w => typeof w === 'string' ? { type: 'wechat', value: w } : w)
      : (f.contact ? [{ type: 'phone', value: f.contact }] : []),
  })
  const [dirty, setDirty] = useState(false)
  const s = (k, v) => { setForm(p => ({ ...p, [k]: v })); setDirty(true) }

  const addContact = (type = 'wechat') => {
    setForm(prev => ({ ...prev, contacts: [...prev.contacts, { type, value: '', label: '' }] }))
    setDirty(true)
  }
  const updContact = (i, key, val) => {
    setForm(prev => {
      const arr = [...prev.contacts]
      arr[i] = { ...arr[i], [key]: val }
      return { ...prev, contacts: arr }
    })
    setDirty(true)
  }
  const rmContact = (i) => {
    setForm(prev => ({ ...prev, contacts: prev.contacts.filter((_, idx) => idx !== i) }))
    setDirty(true)
  }

  const handleSave = () => {
    // Deduplica e remove vazios antes de salvar
    const cleaned = form.contacts.filter(c => c.value && c.value.trim())
    onSave({ ...form, wechats: cleaned, contact: cleaned[0]?.value || '' })
  }

  const TYPES = [
    { id: 'wechat', icon: '💬', label: 'WeChat' },
    { id: 'whatsapp', icon: '📱', label: 'WhatsApp' },
    { id: 'email', icon: '📧', label: 'Email' },
    { id: 'phone', icon: '☎️', label: 'Telefone' },
  ]

  return <Modal onClose={onClose} width={560} isDirty={dirty}>
    <MH title={f.id ? 'Editar Fábrica' : 'Nova Fábrica'} onClose={onClose} />
    <MB>
      <div className="form-row">
        <div className="form-group"><label className="field-label">Nome *</label><input className="field" value={form.name} onChange={e => s('name', e.target.value)} autoFocus /></div>
        <div className="form-group"><label className="field-label">País</label><input className="field" value={form.country} onChange={e => s('country', e.target.value)} /></div>
      </div>

      <div className="form-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label className="field-label" style={{ margin: 0 }}>Contatos ({form.contacts.length})</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {TYPES.map(t => (
              <button key={t.id} className="btn btn-outline btn-sm" onClick={() => addContact(t.id)} title={`Adicionar ${t.label}`}>
                + {t.icon}
              </button>
            ))}
          </div>
        </div>
        {form.contacts.length === 0 && <div className="text-muted text-sm" style={{ padding: 10, textAlign: 'center', background: '#f9fafb', borderRadius: 6 }}>Nenhum contato. Use os botões acima.</div>}
        {form.contacts.map((c, i) => {
          const typeInfo = TYPES.find(t => t.id === c.type) || TYPES[0]
          // Key: combinação de tipo + valor + índice.
          // Inclui índice pra suportar dois contatos iguais durante edição.
          return (
            <div key={`${c.type}-${c.value || ''}-${i}`} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
              <select className="field field-sm" value={c.type} onChange={e => updContact(i, 'type', e.target.value)}>
                {TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
              </select>
              <input className="field field-sm" placeholder="Valor (ID/número/email)" value={c.value || ''} onChange={e => updContact(i, 'value', e.target.value)} />
              <input className="field field-sm" placeholder="Rótulo (ex: Sr. Wang)" value={c.label || ''} onChange={e => updContact(i, 'label', e.target.value)} />
              <button className="btn-icon text-danger" onClick={() => rmContact(i)} aria-label="Remover contato">✕</button>
            </div>
          )
        })}
      </div>

      <div className="form-group"><label className="field-label">Observações</label><textarea className="field" value={form.notes} onChange={e => s('notes', e.target.value)} /></div>
    </MB>
    <MF>
      <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" onClick={handleSave} disabled={!form.name}>Salvar</button>
    </MF>
  </Modal>
}

