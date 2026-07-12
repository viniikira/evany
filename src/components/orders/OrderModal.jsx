// src/components/orders/OrderModal.jsx
// v13.36 — Extraído de Orders.jsx no refator.
//
// Modal de criação/edição de pedido. Componente grande (~535 linhas)
// com muita lógica de seleção de produto/ideia, cores, quantidades, preços.

import { useState, useMemo } from 'react'
import { Modal, MH, MB, MF, SaveButton } from '../ui'
import { ColorPicker } from '../ColorPicker'
import { ORDER_ST } from '../../lib/constants'
import { uid, UC } from '../../lib/utils'

export function OrderModal({ order, factories, products, ideas = [], colors, onSave, onClose, perm = {}, leadTimeByFactory = new Map() }) {
  const [f, setF] = useState(() => {
    const base = order || {}
    // Quando edita pedido existente, infere _fromProduct: cor cadastrada no produto = true
    const items = (base.items || []).map(it => {
      const prod = (products || []).find(p => p.id === it.product_id)
      const productColorCodes = new Set((prod?.color_variants || []).map(cv => cv.code))
      return {
        ...it,
        colors: (it.colors || []).map(c => ({
          ...c,
          _fromProduct: productColorCodes.has(c.code),
        })),
      }
    })
    return {
      ...base,
      order_name: base.order_name || '',
      factory: base.factory || '',
      status: base.status || 'draft',
      notes: base.notes || '',
      expected_arrival: base.expected_arrival || '',
      // v13.40 — novos campos opcionais
      order_date: base.order_date || null,
      promised_lead_days: base.promised_lead_days || null,
      items,
    }
  })
  const [dirty, setDirty] = useState(false)
  const s = (k, v) => { setF(p => ({ ...p, [k]: v })); setDirty(true) }

  // IMPORTANTE: todas as mutações de items/cores usam callback form no setState
  // pra não depender de closure stale. O bug "+ Cor não funciona" era disso.
  const addItem = () => {
    setF(prev => ({
      ...prev,
      items: [...(prev.items || []), { id: 'tmp-' + uid(), product_id: '', colors: [] }]
    }))
    setDirty(true)
  }
  const updItem = (id, key, val) => {
    setF(prev => ({
      ...prev,
      items: (prev.items || []).map(it => it.id === id ? { ...it, [key]: val } : it)
    }))
    setDirty(true)
  }
  const rmItem = (id) => {
    setF(prev => ({ ...prev, items: (prev.items || []).filter(it => it.id !== id) }))
    setDirty(true)
  }

  // addColor com flag _fromProduct=false: cor que o usuário quer pedir mas não está
  // cadastrada no produto. Aparece como input livre (datalist com sugestões do banco).
  const addColor = (itemId, fromProduct = false) => {
    setF(prev => ({
      ...prev,
      items: (prev.items || []).map(it =>
        it.id === itemId ? { ...it, colors: [...(it.colors || []), { code: '', qty: 0, _fromProduct: fromProduct }] } : it
      )
    }))
    setDirty(true)
  }
  const updColor = (itemId, idx, key, val) => {
    setF(prev => ({
      ...prev,
      items: (prev.items || []).map(it => {
        if (it.id !== itemId) return it
        const cls = [...(it.colors || [])]
        cls[idx] = { ...cls[idx], [key]: val }
        return { ...it, colors: cls }
      })
    }))
    setDirty(true)
  }
  const rmColor = (itemId, idx) => {
    setF(prev => ({
      ...prev,
      items: (prev.items || []).map(it =>
        it.id === itemId ? { ...it, colors: (it.colors || []).filter((_, i) => i !== idx) } : it
      )
    }))
    setDirty(true)
  }

  // Filtro inteligente de produtos por fábrica do pedido.
  // 3 grupos, exibidos em ordem de relevância no dropdown:
  //   1. Produtos JÁ CADASTRADOS nessa fábrica (principal ou secundária)
  //   2. Produtos EM DESENVOLVIMENTO sem fábrica definida (ainda em pesquisa)
  //   3. Produtos de OUTRAS fábricas (testar/comparar)
  //
  // Bug anterior: filtrava SÓ pelo grupo 1, então rascunhos novos
  // ficavam invisíveis e era impossível encomendar pra definir fábrica.
  const productsByGroup = useMemo(() => {
    const all = products || []
    // Nome de produtos existentes (pra filtrar ideias que conflitariam)
    const productNames = new Set(all.map(p => (p.name || '').toLowerCase().trim()))
    
    // Ideias ativas (não descartadas) e sem conflito de nome com produtos existentes
    const activeIdeas = (ideas || [])
      .filter(i => i.status !== 'discarded')
      .filter(i => i.name && !productNames.has(i.name.toLowerCase().trim()))
    
    if (!f.factory) {
      return { matching: all, undefined_factory: [], other_factory: [], ideas: activeIdeas }
    }
    const matching = []
    const undefined_factory = []
    const other_factory = []
    for (const p of all) {
      if (!p) continue
      const pFactory = p.factory
      const hasSupplier = Array.isArray(p.suppliers) && p.suppliers.some(s => s && s.factory === f.factory)
      
      if (pFactory === f.factory || hasSupplier) {
        matching.push(p)
      } else if (!pFactory || pFactory === '') {
        undefined_factory.push(p)
      } else {
        other_factory.push(p)
      }
    }
    
    // Ideias: priorizar as que já têm alguma afinidade com a fábrica do pedido
    // Mas mostrar todas — ideia ainda pode não ter fábrica mesmo
    return { matching, undefined_factory, other_factory, ideas: activeIdeas }
  }, [products, ideas, f.factory])

  // Lista achatada pra usar em algumas operações (validações, etc.)
  const productsFiltered = [
    ...productsByGroup.matching,
    ...productsByGroup.undefined_factory,
    ...productsByGroup.other_factory,
  ]

  // #6 Ao selecionar produto, puxar cores que ele tem cadastradas
  // Guards: productId pode ser vazio, colors pode ser undefined
  const colorsForProduct = (productId) => {
    if (!productId) return colors || []  // item novo sem produto: mostra catálogo geral
    const prod = (products || []).find(p => p && p.id === productId)
    if (!prod || !Array.isArray(prod.color_variants) || prod.color_variants.length === 0) {
      return colors || []
    }
    return prod.color_variants
      .filter(cv => cv && cv.code)  // filtra cv inválidos
      .map(cv => ({ id: cv.id, code: cv.code }))
  }

  return (
    <Modal onClose={onClose} width={700} isDirty={dirty}>
      <MH title={order?.id ? 'Editar Pedido' : 'Novo Pedido'} onClose={onClose} />
      <MB>
        <div className="form-row">
          <div className="form-group">
            <label className="field-label">Nome do Pedido</label>
            <input className="field" value={f.order_name || ''} onChange={e => s('order_name', e.target.value)} placeholder="Ex: Maio 2026" />
          </div>
          <div className="form-group">
            <label className="field-label">Fábrica *</label>
            {(() => {
              const pickFactory = (val) => {
                s('factory', val)
                // Ao trocar fábrica, remove produtos incompatíveis dos items
                if (f.items && f.items.length > 0 && val) {
                  const compat = products.filter(p =>
                    p.factory === val ||
                    (p.suppliers || []).some(su => su.factory === val)
                  ).map(p => p.id)
                  const filteredItems = f.items.filter(it => !it.product_id || compat.includes(it.product_id))
                  if (filteredItems.length !== f.items.length) {
                    s('items', filteredItems)
                  }
                }
              }
              // Se poucas fábricas, botões (mais rápido e visual).
              // Se muitas, volta pro select (evita sobrecarga visual).
              if ((factories || []).length <= 8) {
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {factories.map(fa => {
                      const active = f.factory === fa.name
                      return (
                        <button
                          key={fa.id}
                          type="button"
                          onClick={() => pickFactory(fa.name)}
                          style={{
                            padding: '8px 14px',
                            borderRadius: 8,
                            border: `2px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                            background: active ? 'var(--primary)' : '#fff',
                            color: active ? '#fff' : 'var(--text)',
                            fontWeight: 600, fontSize: 13,
                            cursor: 'pointer',
                            transition: 'all .15s',
                          }}
                        >
                          🏭 {fa.name}
                        </button>
                      )
                    })}
                  </div>
                )
              }
              return (
                <select className="field" value={f.factory} onChange={e => pickFactory(e.target.value)}>
                  <option value="">—</option>
                  {factories.map(fa => <option key={fa.id} value={fa.name}>{fa.name}</option>)}
                </select>
              )
            })()}
            {/* #2 Prazo médio da fábrica (baseado em pedidos concluídos) */}
            {f.factory && leadTimeByFactory.get(f.factory) && (
              <div style={{
                marginTop: 6, padding: '6px 10px',
                background: '#F0F9FF', borderRadius: 4,
                fontSize: 12, color: '#0C4A6E',
                border: '1px solid #BAE6FD',
              }}>
                ⏱️ Prazo médio: <strong>~{leadTimeByFactory.get(f.factory).avgDays} dias</strong>
                <span className="text-muted" style={{ marginLeft: 6, fontSize: 10 }}>
                  (baseado em {leadTimeByFactory.get(f.factory).sampleSize} pedido{leadTimeByFactory.get(f.factory).sampleSize > 1 ? 's' : ''} concluído{leadTimeByFactory.get(f.factory).sampleSize > 1 ? 's' : ''})
                </span>
              </div>
            )}
            {f.factory && !leadTimeByFactory.get(f.factory) && (
              <div style={{
                marginTop: 6, padding: '6px 10px',
                background: '#F9FAFB', borderRadius: 4,
                fontSize: 11, color: '#6B7280',
              }}>
                ⏱️ Sem histórico de prazo nesta fábrica ainda
              </div>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="field-label">Status</label>
            <select className="field" value={f.status} onChange={e => s('status', e.target.value)}>
              {ORDER_ST.map(x => <option key={x.id} value={x.id}>{x.icon} {x.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="field-label">
              Previsão de Chegada
              <span className="text-muted text-xs" style={{ marginLeft: 6, fontWeight: 400 }}>
                — opcional, deixe em branco se não souber
              </span>
            </label>
            <input
              className="field"
              type="date"
              value={f.expected_arrival || ''}
              onChange={e => s('expected_arrival', e.target.value || null)}
            />
          </div>
        </div>
        
        {/* v13.40 — Campos pra registrar pedidos retroativos (antigos) com data e prazo reais */}
        <div className="form-row">
          <div className="form-group">
            <label className="field-label">
              📅 Data do pedido
              <span className="text-muted text-xs" style={{ marginLeft: 6, fontWeight: 400 }}>
                — opcional, deixe vazio pra usar data de hoje
              </span>
            </label>
            <input
              className="field"
              type="date"
              value={f.order_date || ''}
              onChange={e => s('order_date', e.target.value || null)}
              title="Use pra registrar pedidos feitos em datas passadas (pedidos retroativos)"
            />
          </div>
          <div className="form-group">
            <label className="field-label">
              ⏱️ Prazo prometido
              <span className="text-muted text-xs" style={{ marginLeft: 6, fontWeight: 400 }}>
                — dias, opcional
              </span>
            </label>
            <input
              className="field"
              type="number"
              min="1"
              max="365"
              value={f.promised_lead_days || ''}
              onChange={e => s('promised_lead_days', e.target.value ? parseInt(e.target.value, 10) : null)}
              placeholder={f.factory && leadTimeByFactory.get(f.factory) ? `sugestão: ${leadTimeByFactory.get(f.factory).avgDays}` : 'ex: 90'}
              title="Quantos dias a fábrica prometeu pra entregar. Sistema avisa se passar disso."
            />
          </div>
        </div>

        {!f.factory && (
          <div className="alert alert-warn" style={{ margin: '0 0 10px 0' }}>
            ⚠️ Selecione a fábrica primeiro — os produtos disponíveis serão filtrados por ela.
          </div>
        )}

        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label className="field-label" style={{ margin: 0 }}>
              Itens do Pedido ({(f.items || []).length})
              {f.factory && (
                <span className="text-muted text-xs" style={{ marginLeft: 6 }}>
                  · {productsByGroup.matching.length} cadastrado{productsByGroup.matching.length !== 1 ? 's' : ''} em {f.factory}
                  {productsByGroup.undefined_factory.length > 0 && ` · ${productsByGroup.undefined_factory.length} em pesquisa`}
                </span>
              )}
            </label>
            <button className="btn btn-outline btn-sm" onClick={addItem} disabled={!f.factory}>+ Item</button>
          </div>
          {(f.items || []).map(it => {
            const prod = products.find(p => p.id === it.product_id)
            const availableColors = colorsForProduct(it.product_id)
            return (
              <div key={it.id} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
                  <select className="field field-sm" style={{ flex: 1 }} value={it.idea_id ? `idea:${it.idea_id}` : (it.product_id || '')} onChange={e => {
                    const val = e.target.value
                    
                    // Seleção de IDEIA (será convertida no save)
                    if (val.startsWith('idea:')) {
                      const ideaId = val.slice(5)
                      const idea = ideas.find(i => i.id === ideaId)
                      
                      // Pré-popular cores da ideia (se tiver)
                      let newColors = []
                      if (idea && Array.isArray(idea.color_variants) && idea.color_variants.length > 0) {
                        newColors = idea.color_variants
                          .filter(cv => cv && cv.code)
                          .map(cv => ({ code: cv.code, qty: 0, _fromProduct: true }))
                      }
                      
                      setF(prev => ({
                        ...prev,
                        items: (prev.items || []).map(item =>
                          item.id === it.id ? {
                            ...item,
                            product_id: '',       // limpa produto
                            idea_id: ideaId,      // marca como ideia
                            idea_name_snapshot: idea?.name,
                            colors: newColors,
                            price_usd: (item.price_usd != null && item.price_usd !== '') ? item.price_usd : (idea?.price_usd ?? ''),
                          } : item
                        )
                      }))
                      setDirty(true)
                      return
                    }
                    
                    // Seleção de PRODUTO (fluxo normal)
                    const newProdId = val
                    const newProd = products.find(p => p.id === newProdId)
                    
                    let newColors = []
                    if (newProd && Array.isArray(newProd.color_variants) && newProd.color_variants.length > 0) {
                      newColors = newProd.color_variants
                        .filter(cv => cv && cv.code)
                        .map(cv => ({ code: cv.code, qty: 0, _fromProduct: true }))
                    }
                    
                    setF(prev => ({
                      ...prev,
                      items: (prev.items || []).map(item =>
                        item.id === it.id ? {
                          ...item,
                          product_id: newProdId,
                          idea_id: null,        // limpa marcador de ideia
                          idea_name_snapshot: null,
                          colors: newColors,
                          price_usd: (item.price_usd != null && item.price_usd !== '') ? item.price_usd : (newProd?.price_usd ?? ''),
                        } : item
                      )
                    }))
                    setDirty(true)
                  }}>
                    <option value="">Selecionar produto ou ideia...</option>
                    {productsByGroup.matching.length > 0 && (
                      <optgroup label={`✓ Já cadastrados em ${f.factory || 'qualquer fábrica'} (${productsByGroup.matching.length})`}>
                        {productsByGroup.matching.map(p => <option key={p.id} value={p.id}>{UC(p.name)}</option>)}
                      </optgroup>
                    )}
                    {productsByGroup.undefined_factory.length > 0 && (
                      <optgroup label={`🔬 Em desenvolvimento — sem fábrica definida (${productsByGroup.undefined_factory.length})`}>
                        {productsByGroup.undefined_factory.map(p => <option key={p.id} value={p.id}>{UC(p.name)}</option>)}
                      </optgroup>
                    )}
                    {productsByGroup.other_factory.length > 0 && (
                      <optgroup label={`↔ De outras fábricas (${productsByGroup.other_factory.length})`}>
                        {productsByGroup.other_factory.map(p => <option key={p.id} value={p.id}>{UC(p.name)} ({p.factory})</option>)}
                      </optgroup>
                    )}
                    {productsByGroup.ideas.length > 0 && (
                      <optgroup label={`💡 Ideias — viram produto ao salvar (${productsByGroup.ideas.length})`}>
                        {productsByGroup.ideas.map(i => <option key={`idea:${i.id}`} value={`idea:${i.id}`}>{UC(i.name)}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <button className="btn-icon text-danger" onClick={() => rmItem(it.id)} title="Remover item" aria-label="Remover item">✕</button>
                </div>

                {/* Preço USD com label claro — só aparece se produto selecionado */}
                {it.product_id && perm.prices && (() => {
                  const totalPieces = (it.colors || []).reduce((a, c) => a + Number(c.qty || 0), 0)
                  const pu = parseFloat(it.price_usd) || 0
                  // FOB respeita preço próprio de cada cor (#2)
                  const itemTotal = (it.colors || []).reduce((a, c) => {
                    const qty = Number(c.qty || 0)
                    const cprice = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : pu
                    return a + qty * (cprice || 0)
                  }, 0)
                  return (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-end' }}>
                      <div style={{ flex: 1 }}>
                        <label className="text-muted" style={{ fontSize: 10, display: 'block', marginBottom: 2 }}>💲 PREÇO USD UNITÁRIO</label>
                        <input
                          className="field field-sm"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={it.price_usd ?? ''}
                          onChange={e => updItem(it.id, 'price_usd', e.target.value)}
                        />
                      </div>
                      {totalPieces > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', paddingBottom: 8, whiteSpace: 'nowrap' }}>
                          {totalPieces} pç{totalPieces !== 1 ? 's' : ''}
                          {itemTotal > 0 && <span style={{ marginLeft: 8, color: '#F59E0B', fontWeight: 600 }}>FOB $ {itemTotal.toFixed(2)}</span>}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Aviso: item é uma IDEIA que vai ser convertida no save */}
                {it.idea_id && (
                  <div style={{
                    padding: '8px 10px',
                    background: '#FEF3C7',
                    border: '1px solid #FCD34D',
                    borderRadius: 6,
                    fontSize: 12,
                    color: '#92400E',
                    marginTop: 6,
                  }}>
                    💡 <strong>"{UC(it.idea_name_snapshot || '')}"</strong> é uma ideia. Ao salvar este pedido, ela será <strong>convertida automaticamente em produto</strong> e adicionada ao catálogo.
                  </div>
                )}

                {/* Avisos sobre status fábrica/produto */}
                {prod && f.factory && (() => {
                  const isMatching = prod.factory === f.factory || (Array.isArray(prod.suppliers) && prod.suppliers.some(s => s?.factory === f.factory))
                  const noFactory = !prod.factory
                  const isOther = !isMatching && prod.factory && prod.factory !== f.factory
                  if (noFactory) {
                    return (
                      <div style={{ padding: '6px 10px', background: '#EEF6FF', border: '1px solid #BAE0FE', borderRadius: 4, fontSize: 12, marginBottom: 6, color: '#0C4A6E' }}>
                        🔬 Produto em desenvolvimento sem fábrica definida. Ao salvar este pedido, <strong>{f.factory}</strong> vira fábrica principal do produto.
                      </div>
                    )
                  }
                  if (isOther) {
                    return (
                      <div style={{ padding: '6px 10px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 4, fontSize: 12, marginBottom: 6, color: '#92400E' }}>
                        ↔ Este produto é de <strong>{prod.factory}</strong>. Ao salvar, <strong>{f.factory}</strong> será adicionada como fábrica secundária para comparação.
                      </div>
                    )
                  }
                  return null
                })()}

                {/* Cores cadastradas do produto pré-listadas (qty=0 default).
                    Usuário só preenche as quantidades. Pra remover uma do pedido,
                    deixa qty=0 (será filtrada no save). */}
                {(it.colors || []).length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    {(it.colors || []).map((cl, idx) => {
                      const itemPrice = parseFloat(it.price_usd) || 0
                      const colorPrice = cl.price_usd != null && cl.price_usd !== '' ? parseFloat(cl.price_usd) : null
                      const effectivePrice = colorPrice != null ? colorPrice : itemPrice
                      const hasCustomPrice = colorPrice != null && colorPrice !== itemPrice
                      // v13.34 — productColors pra highlight no dropdown ⭐
                      const prodOfItem = products.find(p => p.id === it.product_id)
                      const productColorCodes = (prodOfItem?.color_variants || []).map(cv => cv.code)
                      return (
                        <div key={cl.id || idx} style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 70px 90px auto',
                          gap: 4, marginBottom: 4, alignItems: 'center',
                        }}>
                          {/* v13.34 — ColorPicker unificado: clicável (sempre editável),
                              busca por código/nome, mostra swatch, destaca cores do produto */}
                          <ColorPicker
                            value={cl.code}
                            allColors={colors}
                            productColors={productColorCodes}
                            onChange={code => updColor(it.id, idx, 'code', code)}
                            onAllowFreeEntry={() => {}}
                            placeholder="Selecionar cor…"
                            autoOpen={!cl.code}
                          />
                          <input
                            className="field field-sm"
                            type="number"
                            placeholder="Qtd"
                            value={cl.qty || ''}
                            onChange={e => updColor(it.id, idx, 'qty', e.target.value)}
                          />
                          {/* #2 Preço opcional por cor — null herda do item */}
                          {perm.prices && (
                            <input
                              className="field field-sm"
                              type="number"
                              step="0.01"
                              placeholder={itemPrice > 0 ? `$${itemPrice.toFixed(2)}` : '$ próprio'}
                              value={cl.price_usd ?? ''}
                              onChange={e => updColor(it.id, idx, 'price_usd', e.target.value)}
                              title={hasCustomPrice ? `Preço próprio: $ ${colorPrice.toFixed(2)} (sobrescreve $${itemPrice.toFixed(2)} do item)` : 'Deixe vazio para herdar do item, ou digite preço próprio desta cor'}
                              style={hasCustomPrice ? { background: '#FEF3C7', fontWeight: 600 } : undefined}
                            />
                          )}
                          <button className="btn-icon text-danger" onClick={() => rmColor(it.id, idx)} title="Remover linha" aria-label="Remover linha de cor">✕</button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => addColor(it.id, false)}
                    disabled={!it.product_id}
                    title="Adiciona linha vazia. No dropdown você pode escolher cor existente ou digitar nova."
                  >
                    + Cor
                  </button>
                  {it.product_id && (it.colors || []).every(c => c._fromProduct) && (it.colors || []).length > 0 && (
                    <span className="text-muted text-xs" style={{ alignSelf: 'center' }}>
                      Preencha as quantidades das cores que vai pedir (deixe 0 nas que não)
                    </span>
                  )}
                </div>

                {/* Se produto selecionado e ainda não tem cores no item — orienta uso do botão "+ Cor" */}
                {it.product_id && (it.colors || []).length === 0 && (
                  <div style={{
                    padding: '10px 12px', background: '#EEF6FF', borderRadius: 6,
                    fontSize: 12, color: '#0C4A6E', marginTop: 6,
                    border: '1px dashed #BAE0FE',
                  }}>
                    💡 Este produto ainda não tem cores cadastradas. Use <strong>"+ Cor"</strong> abaixo para adicionar — você pode escolher do banco de cores ou digitar uma nova. Cores novas serão adicionadas ao catálogo do produto quando o pedido for concluído ou enviado pra fábrica.
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="form-group">
          <label className="field-label">Observações</label>
          <textarea className="field" value={f.notes || ''} onChange={e => s('notes', e.target.value)} />
        </div>
        
        {/* v13.40 — Botão flutuante "+ Item" sempre visível durante scroll do modal.
            Útil em pedidos grandes onde você não quer voltar ao topo pra adicionar item. */}
        {f.factory && (
          <div style={{
            position: 'sticky', bottom: 12, marginTop: 10,
            display: 'flex', justifyContent: 'flex-end',
            pointerEvents: 'none',
            zIndex: 5,
          }}>
            <button
              onClick={addItem}
              title="Adicionar novo item ao pedido"
              style={{
                pointerEvents: 'auto',
                width: 56, height: 56,
                borderRadius: '50%',
                background: 'var(--primary, #8B5CF6)',
                color: '#fff',
                fontSize: 28, lineHeight: 1,
                border: 'none', cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,0,0,.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'transform .15s, box-shadow .15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.08)'
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,.3)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = ''
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,.25)'
              }}
            >
              +
            </button>
          </div>
        )}
      </MB>
      <MF>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <SaveButton onSave={() => onSave(f)} disabled={!f.factory}>Salvar</SaveButton>
      </MF>
    </Modal>
  )
}
