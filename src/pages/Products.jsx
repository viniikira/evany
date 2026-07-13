// src/pages/Products.jsx
import { useState, useEffect, useMemo, useRef } from 'react'
import { Modal, MH, MB, MF, Lightbox, useConfirm, useToast, SkeletonProductGrid, SkeletonList, CopyChip, SaveButton, ClearFiltersButton } from '../components/ui'
import { ColorSwatch } from '../components/ColorSwatch'
import { ColorChip } from '../components/ColorChip'
import { PriceHistoryChart } from '../components/PriceHistoryChart'
import { NameAutocomplete } from '../components/NameAutocomplete'
import { proposeSku, buildShopifyIndex, suggestShopifyLinks, findShopifyBySku } from '../lib/creationAssist'
import { matchesEntity, slugifyName, hashForEntity, hashForPage, pageForHash } from '../lib/router'
import { FavoriteStar } from '../components/FavoriteStar'
import { listProducts, createProduct, updateProduct, deleteProduct,
  bulkUpdateColorStatus, updateProductStatus,
} from '../lib/data/products'
import { listOrders, updateOrder } from '../lib/data/orders'
import { listCollections, listColors, listFactories, listNames, listLogsForEntity, addLog as writeLog } from '../lib/data/misc'
import { uploadProductPhoto, deletePhoto } from '../lib/storage'
import { toastError } from '../lib/errors'
import { OrderDetail } from '../components/orders/OrderDetail'
import { useStickyFilter, clearStickyFilters } from '../lib/hooks'
import { uid, formatDate, UC } from '../lib/utils'
import { trackAction } from '../lib/analytics'
import { log } from '../lib/logger'
import {
  FINISH, REP_TYPES, REP_SIZES, REP_ACAB, HTYPES, HLENS, MATERIALS,
  PROD_ST, COLOR_STATUSES, PROD_SORT_ORDER, normSearch, ORDER_ST,
} from '../lib/constants'

// uid e UC importados de lib/utils

export default function ProductsPage({ user, perm, shopifyCache, initialData = [], initialColors = [], onMutate, initialDetailId, onDetailOpened }) {
  // Cache inicial vindo do App: products já carregados na entrada do sistema.
  // Loading só fica true se NÃO temos cache.
  const [products, setProducts] = useState(initialData)
  const [loading, setLoading] = useState(initialData.length === 0)
  const [collections, setCollections] = useState([])
  const [colors, setColors] = useState(initialColors)
  const [factories, setFactories] = useState([])
  const [names, setNames] = useState([])

  // #D Filtros pegajosos: persistem na sessão (sumem ao fechar aba)
  const [search, setSearch] = useStickyFilter('products.search', '')
  const [fSt, setFSt] = useStickyFilter('products.status', 'all')
  const [fFin, setFFin] = useStickyFilter('products.finish', 'all')
  const [fFac, setFFac] = useStickyFilter('products.factory', 'all')
  const [modal, setModal] = useState(null)
  const [detail, setDetail] = useState(null)
  const confirm = useConfirm()
  const toast = useToast()

  // v13.56 — deep-link: #/produtos/lara abre o detalhe direto (id, prefixo ou slug do nome)
  useEffect(() => {
    if (!initialDetailId || products.length === 0) return
    const target = products.find(p => matchesEntity(initialDetailId, { id: p.id, name: p.name }))
    if (target) setDetail(target)
    onDetailOpened?.()
  }, [initialDetailId, products])

  // v13.56 — URL reflete o produto aberto (#/produtos/lara).
  // O ref evita resetar a URL no mount (apagaria o deep-link antes de carregar).
  const hadDetailRef = useRef(false)
  useEffect(() => {
    if (detail) {
      hadDetailRef.current = true
      const slug = slugifyName(detail.name)
      const unique = slug && products.filter(p => slugifyName(p.name) === slug).length === 1
      window.location.hash = hashForEntity('products', unique ? slug : detail.id.slice(0, 8))
    } else if (hadDetailRef.current) {
      hadDetailRef.current = false
      if (pageForHash(window.location.hash) === 'products') window.location.hash = hashForPage('products')
    }
  }, [detail])

  const [orders, setOrders] = useState([])

  const load = async () => {
    // Se não tem cache, mostra loading. Se tem, refresca em background sem skeleton.
    if (products.length === 0) setLoading(true)
    try {
      // Carrega orders condicionalmente — só faz sentido pra admin/gerente.
      // Se usuário não tiver perm.orders, retorna []
      const ordersPromise = perm.orders
        ? import('../lib/data/orders').then(m => m.listOrders())
        : Promise.resolve([])
      const [prods, colls, cols, facs, nms, ords] = await Promise.all([
        listProducts(), listCollections(), listColors(), listFactories().catch(() => []), listNames(), ordersPromise,
      ])
      setProducts(prods)
      setCollections(colls)
      setColors(cols)
      setFactories(facs)
      setNames(nms)
      setOrders(ords)
    } catch (e) { toastError(toast, e) }
    setLoading(false)
  }

  // Carrega cadastros auxiliares (collections, factories, names) que NÃO vêm no cache.
  // Refresca products também pra ter dados atualizados (cache pode estar stale).
  useEffect(() => { load() }, [])

  // Ordenação e filtragem memoizadas
  const filtered = useMemo(() => {
    const sorted = [...products].sort((a, b) => {
      const sa = PROD_SORT_ORDER[a.status] ?? 99
      const sb = PROD_SORT_ORDER[b.status] ?? 99
      if (sa !== sb) return sa - sb
      const ha = (a.card_image_url || (a.photos || [])[0]) ? 0 : 1
      const hb = (b.card_image_url || (b.photos || [])[0]) ? 0 : 1
      return ha - hb
    })
    return sorted.filter(p => {
      const ms = fSt === 'all' || p.status === fSt
      const mf = fFin === 'all' || p.finish_type === fFin
      const mfa = fFac === 'all' || p.factory === fFac || (p.suppliers || []).some(s => s.factory === fFac)
      // Busca inteligente em múltiplos campos — caixa única que procura em "qualquer coisa relevante":
      // nome, coleção, código fábrica principal, códigos dos fornecedores secundários,
      // códigos de cor e SKUs das variantes, nome da fábrica principal/secundária.
      let mq = !search
      if (search) {
        const needle = normSearch(search)
        const haystack = [
          p.name,
          p.collection,
          p.factory,
          p.factory_code,
          ...(p.suppliers || []).flatMap(s => [s.factory, s.factory_code]),
          ...(p.color_variants || []).flatMap(cv => [cv.code, cv.sku]),
        ]
          .filter(Boolean)
          .map(s => normSearch(s))
          .join(' | ')
        mq = haystack.includes(needle)
      }
      return ms && mf && mfa && mq
    })
  }, [products, search, fSt, fFin, fFac])

  const hasFilters = fSt !== 'all' || fFin !== 'all' || fFac !== 'all' || search
  const clearFilters = () => { setFSt('all'); setFFin('all'); setFFac('all'); setSearch('') }

  const usedFin = useMemo(() => [...new Set(products.map(p => p.finish_type).filter(Boolean))], [products])
  const allFactoryNames = useMemo(() => [...new Set([...products.map(p => p.factory), ...products.flatMap(p => (p.suppliers || []).map(s => s.factory))].filter(Boolean))], [products])

  // SKU → sales/stock indexado (otimização O(n²) → O(n))
  const salesByIndex = useMemo(() => {
    const salesBySku = new Map()
    const stockBySku = new Map()
    const so = shopifyCache?.orders || []
    const sp = shopifyCache?.products || []
    for (const o of so) {
      for (const li of (o.line_items || [])) {
        if (!li.sku) continue
        const cur = salesBySku.get(li.sku) || { qty: 0, rev: 0 }
        cur.qty += li.quantity
        cur.rev += parseFloat(li.price) * li.quantity
        salesBySku.set(li.sku, cur)
      }
    }
    for (const p of sp) {
      for (const v of (p.variants || [])) {
        if (!v.sku) continue
        stockBySku.set(v.sku, (stockBySku.get(v.sku) || 0) + (v.inventory_quantity || 0))
      }
    }
    return { salesBySku, stockBySku }
  }, [shopifyCache])

  // #11 — Log inteligente: registra só os campos que MUDARAM na edição.
  // Ex: "preço USD: $15 → $18 · fábrica: Hairchuan → EPF · cor 1B adicionada".
  const diffProduct = (oldP, newP) => {
    if (!oldP) return null
    const changes = []
    const labels = {
      name: 'nome', status: 'status', collection: 'coleção',
      factory: 'fábrica', factory_code: 'código fábrica',
      finish_type: 'acabamento', material: 'material',
      hair_type: 'fio', length: 'comprimento',
      price_usd: 'preço USD', notes: 'notas',
      sku: 'SKU',
    }
    for (const k of Object.keys(labels)) {
      const oldV = oldP[k] ?? ''
      const newV = newP[k] ?? ''
      if (String(oldV).trim() !== String(newV).trim()) {
        const from = oldV ? String(oldV) : '∅'
        const to = newV ? String(newV) : '∅'
        changes.push(`${labels[k]}: ${from} → ${to}`)
      }
    }
    // Cores adicionadas/removidas (comparação por code)
    const oldCodes = new Set((oldP.color_variants || []).map(c => c.code))
    const newCodes = new Set((newP.color_variants || []).map(c => c.code))
    const added = [...newCodes].filter(c => !oldCodes.has(c))
    const removed = [...oldCodes].filter(c => !newCodes.has(c))
    if (added.length > 0) changes.push(`cor(es) adicionada(s): ${added.join(', ')}`)
    if (removed.length > 0) changes.push(`cor(es) removida(s): ${removed.join(', ')}`)
    // Fábricas secundárias
    const oldSupp = new Set((oldP.suppliers || []).map(s => s.factory).filter(Boolean))
    const newSupp = new Set((newP.suppliers || []).map(s => s.factory).filter(Boolean))
    const addedSupp = [...newSupp].filter(s => !oldSupp.has(s))
    const removedSupp = [...oldSupp].filter(s => !newSupp.has(s))
    if (addedSupp.length > 0) changes.push(`fornecedor(es) adicionado(s): ${addedSupp.join(', ')}`)
    if (removedSupp.length > 0) changes.push(`fornecedor(es) removido(s): ${removedSupp.join(', ')}`)
    return changes.length > 0 ? changes.join(' · ') : null
  }

  const save = async (prod) => {
    try {
      prod.name = UC(prod.name)
      let priceChanged = false
      let oldPrice = null
      let newPrice = null
      
      if (prod.id) {
        const oldProd = products.find(p => p.id === prod.id)
        const diff = diffProduct(oldProd, prod)
        oldPrice = parseFloat(oldProd?.price_usd || 0) || 0
        newPrice = parseFloat(prod.price_usd || 0) || 0
        priceChanged = perm.prices && oldPrice > 0 && newPrice > 0 && Math.abs(oldPrice - newPrice) > 0.001
        
        await updateProduct(prod.id, prod)
        writeLog({
          userId: user.id, userName: user.name,
          action: 'editou produto',
          target: prod.name,
          details: diff || 'sem mudanças relevantes',
          entityType: 'product', entityId: prod.id
        })
        
        // #FIX-3 Se mudou preço, escaneia pedidos ativos pra propagar (com confirmação)
        if (priceChanged) {
          await handlePricePropagation(prod, oldPrice, newPrice)
        }
      } else {
        const created = await createProduct({
          ...prod,
          timeline: [{ status: prod.status || 'developing', date: new Date().toISOString(), note: 'Produto criado' }],
          created_by: user.id,
        })
        writeLog({ userId: user.id, userName: user.name, action: 'criou produto', target: prod.name, entityType: 'product', entityId: created.id })
        trackAction('create_product', { name: prod.name, factory: prod.factory })
      }
      setModal(null)
      await load(); onMutate?.()
      toast.push('Produto salvo', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }
  
  // #FIX-3 Quando preço muda, escanear pedidos ativos com este produto.
  // Rascunhos: atualiza silenciosamente (snapshot ainda não é "verdade do contrato").
  // Sent/manufacturing: pergunta ao usuário se quer atualizar snapshots.
  // Completed: NUNCA toca (auditoria sagrada).
  const handlePricePropagation = async (prod, oldPrice, newPrice) => {
    let allOrders
    try {
      allOrders = await listOrders()
    } catch (e) {
      log.warn('[KIRA] Falha ao escanear pedidos pra propagação de preço:', e)
      return
    }
    
    const drafts = []      // rascunhos — atualiza silenciosamente
    const actives = []     // sent/manufacturing — pergunta
    
    for (const o of allOrders) {
      // Apenas se contém o produto
      const hasProduct = (o.items || []).some(it => it.product_id === prod.id)
      if (!hasProduct) continue
      
      if (o.status === 'draft') drafts.push(o)
      else if (o.status === 'sent' || o.status === 'manufacturing') actives.push(o)
      // completed/cancelled: ignora (snapshot é histórico)
    }
    
    // Atualizar rascunhos sem perguntar
    if (drafts.length > 0) {
      for (const o of drafts) {
        const newItems = (o.items || []).map(it => {
          if (it.product_id !== prod.id) return it
          return {
            ...it,
            price_usd: String(newPrice),
            price_usd_snapshot: String(newPrice),
          }
        })
        try {
          await updateOrder(o.id, { items: newItems })
        } catch (e) {
          log.warn(`[KIRA] Falha ao atualizar rascunho ${o.order_name}:`, e)
        }
      }
      toast.push(`${drafts.length} rascunho(s) atualizado(s) com novo preço`, { kind: 'info', duration: 4000 })
    }
    
    // Perguntar pra ativos
    if (actives.length > 0) {
      const lines = actives.map(o => {
        const st = ORDER_ST.find(s => s.id === o.status)
        return `• ${o.order_name || o.factory} (${st?.label || o.status})`
      }).join('\n')
      
      const ok = await confirm({
        title: '💰 Atualizar preço em pedidos ativos?',
        message: `Você mudou o preço de "${prod.name}" de $ ${oldPrice.toFixed(2)} para $ ${newPrice.toFixed(2)}. ${actives.length} pedido(s) ativo(s) usam este produto:`,
        details: lines + '\n\nQuer atualizar o preço nesses pedidos também?\n\n⚠️ Isto altera retroativamente os snapshots — útil pra correção de erro de digitação, mas evite se o preço antigo era o realmente combinado.',
        confirmLabel: 'Sim, atualizar pedidos',
        cancelLabel: 'Não, manter pedidos como estão',
      })
      
      if (ok) {
        let updated = 0
        for (const o of actives) {
          const newItems = (o.items || []).map(it => {
            if (it.product_id !== prod.id) return it
            return {
              ...it,
              price_usd: String(newPrice),
              price_usd_snapshot: String(newPrice),
            }
          })
          try {
            await updateOrder(o.id, { items: newItems })
            writeLog({
              userId: user.id, userName: user.name,
              action: 'propagou novo preço pra pedido ativo',
              target: o.order_name || o.factory,
              details: `${prod.name}: $ ${oldPrice.toFixed(2)} → $ ${newPrice.toFixed(2)}`,
              entityType: 'order', entityId: o.id,
            })
            updated++
          } catch (e) {
            log.warn(`[KIRA] Falha ao atualizar pedido ${o.order_name}:`, e)
          }
        }
        if (updated > 0) toast.push(`✓ ${updated} pedido(s) atualizado(s)`, { kind: 'success', duration: 4000 })
      }
    }
  }

  const remove = async (p) => {
    const ok = await confirm({
      title: 'Excluir produto?',
      message: `"${p.name}" será removido permanentemente.`,
      details: `${(p.color_variants || []).length} cor(es) e ${(p.photos || []).length + (p.card_image_url ? 1 : 0)} foto(s) também serão removidas.`,
      confirmLabel: 'Excluir', danger: true,
    })
    if (!ok) return
    try {
      // Limpa fotos do Storage
      if (p.card_image_url) await deletePhoto(p.card_image_url).catch(() => {})
      for (const ph of (p.photos || [])) await deletePhoto(ph).catch(() => {})

      await deleteProduct(p.id)
      writeLog({ userId: user.id, userName: user.name, action: 'excluiu produto', target: p.name, entityType: 'product' })
      setDetail(null)
      await load(); onMutate?.()
      toast.push('Produto excluído', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  const changeStatus = async (id, newStatus) => {
    const p = products.find(x => x.id === id)
    if (!p) return
    try {
      await updateProductStatus(id, newStatus)
      writeLog({ userId: user.id, userName: user.name, action: 'mudou status', target: p.name, details: PROD_ST.find(s => s.id === newStatus)?.label, entityType: 'product', entityId: id })
      setDetail(prev => prev && prev.id === id ? { ...prev, status: newStatus } : prev)
      
      // Coerência opcional: cores podem ter status próprio (ex: cor "idea" pra teste
      // num produto que já está em catálogo é OK). Apenas oferece atualizar em massa.
      const PROD_TO_COLOR = { developing: 'idea', in_production: 'production', catalog: 'catalog', discontinued: 'discontinued' }
      const targetColorStatus = PROD_TO_COLOR[newStatus]
      const inconsistent = (p.color_variants || []).filter(cv => cv.status !== targetColorStatus)
      
      if (inconsistent.length > 0 && targetColorStatus) {
        const shouldUpdate = await confirm({
          title: 'Atualizar status das cores?',
          message: `${inconsistent.length} cor(es) deste produto têm status diferente. Deseja marcar todas como "${targetColorStatus}"? Cores podem ter status próprio (ex: cor "idea" pra teste num produto em catálogo).`,
          confirmLabel: 'Atualizar todas',
          cancelLabel: 'Manter status individuais',
        })
        if (shouldUpdate) {
          await bulkUpdateColorStatus(id, inconsistent.map(cv => cv.code), targetColorStatus)
        }
      }
      
      await load(); onMutate?.()
      toast.push('Status atualizado', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  // Converte produto de volta em ideia. AVISO: perde pedidos ligados ao produto.
  // (na prática pedidos antigos mantêm snapshot do nome/foto, mas product_id vira NULL)
  const convertToIdea = async (p) => {
    // Verifica se tem pedidos
    const ordersWithProduct = (orders || []).filter(o => (o.items || []).some(it => it.product_id === p.id))
    
    const ok = await confirm({
      title: 'Tornar ideia?',
      message: ordersWithProduct.length > 0
        ? `O produto "${p.name}" está em ${ordersWithProduct.length} pedido(s). Ao tornar ideia, os pedidos mantêm o snapshot (nome/foto congelados) mas perdem o vínculo. O produto é removido do catálogo. Continuar?`
        : `O produto "${p.name}" será transformado em ideia (status "em pesquisa") e removido do catálogo. Todas as fotos e cores vão junto. Continuar?`,
      confirmLabel: 'Sim, tornar ideia',
      danger: true,
    })
    if (!ok) return
    try {
      const { createIdea } = await import('../lib/data/misc')
      // Guarda cores no timeline (formato do IdeaModal)
      const colorIdeas = (p.color_variants || []).map(cv => ({ code: cv.code, status: 'idea' }))
      const tl = (Array.isArray(p.timeline) ? p.timeline : []).filter(t => t?.type !== 'color_ideas')
      tl.push({ status: 'researching', date: new Date().toISOString(), note: `Convertido do produto "${p.name}"` })
      if (colorIdeas.length) tl.push({ type: 'color_ideas', data: colorIdeas })

      await createIdea({
        name: p.name,
        status: 'researching',
        collection: p.collection,
        factory: p.factory,
        factory_code: p.factory_code,
        finish_type: p.finish_type,
        reparticao: p.reparticao,
        reparticao_size: p.reparticao_size,
        reparticao_acabamento: p.reparticao_acabamento,
        pre_plucked: !!p.pre_plucked,
        hair_type: p.hair_type,
        length: p.length,
        material: p.material,
        notes: p.notes,
        card_image_url: p.card_image_url,
        photos: p.photos || [],
        price_usd: p.price_usd,
        timeline: tl,
        created_by: user.id,
      })
      // Deleta o produto (cores e suppliers vão em cascata via FK)
      await deleteProduct(p.id)
      writeLog({ userId: user.id, userName: user.name, action: 'converteu produto em ideia', target: p.name, entityType: 'product' })
      setDetail(null)
      await load(); onMutate?.()
      toast.push('Produto convertido em ideia', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  // Duplicar: abre modal de novo produto pré-preenchido com TUDO menos nome (que fica "- CÓPIA").
  // Não salva direto — usuário pode ajustar nome/fábrica/etc antes.
  // Não duplica fotos (evita upload duplicado) nem SKUs (precisam ser únicos).
  const duplicate = (p) => {
    const prefilled = {
      // Sem id = será tratado como novo
      name: UC(p.name) + ' - CÓPIA',
      status: 'developing',  // duplicata sempre começa em desenvolvimento
      collection: p.collection || '',
      factory: p.factory || '',
      factory_code: p.factory_code || '',
      finish_type: p.finish_type || '',
      reparticao: p.reparticao || '',
      reparticao_size: p.reparticao_size || '',
      reparticao_acabamento: p.reparticao_acabamento || '',
      hair_type: p.hair_type || '',
      length: p.length || '',
      material: p.material || '',
      notes: p.notes || '',
      price_usd: p.price_usd || '',
      pre_plucked: p.pre_plucked || false,
      card_image_url: '',  // foto precisa ser reupload (evita refs duplicadas no Storage)
      photos: [],
      sku: '',  // SKU precisa ser diferente
      // Duplica variantes de cor mas sem SKUs
      color_variants: (p.color_variants || []).map(cv => ({
        id: 'tmp-' + uid(),
        code: cv.code,
        status: 'idea',
        sku: '',
      })),
      // Duplica suppliers (são só cadastros, não têm unique)
      suppliers: (p.suppliers || []).map(s => ({
        id: 'tmp-' + uid(),
        factory: s.factory,
        factory_code: s.factory_code || '',
        price_usd: s.price_usd || '',
      })),
    }
    setDetail(null)
    setModal(prefilled)
    toast.push('Duplicado! Ajuste o nome e salve.', { kind: 'success', duration: 3000 })
  }

  if (loading) return <SkeletonProductGrid count={8} />

  return <div>
    <div className="toolbar">
      <div className="search-box"><span>🔍</span>
        <input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {perm.products ? <button className="btn btn-primary" onClick={() => setModal('new')}>+ Novo Produto</button> : null}
    </div>
    <div className="chip-bar">
      <button className={`chip-filter${fSt === 'all' ? ' on' : ''}`} onClick={() => setFSt('all')}>Todos</button>
      {PROD_ST.map(s => <button key={s.id} className={`chip-filter${fSt === s.id ? ' on' : ''}`} onClick={() => setFSt(s.id)}>{s.icon} {s.label}</button>)}
    </div>
    <div className="chip-bar" style={{ marginTop: -4 }}>
      <span className="text-muted text-sm">Filtros:</span>
      <select className="select-chip" value={fFin} onChange={e => setFFin(e.target.value)}>
        <option value="all">Acabamento</option>
        {usedFin.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
      {perm.factoryInfo && (
        <select className="select-chip" value={fFac} onChange={e => setFFac(e.target.value)}>
          <option value="all">Fábrica</option>
          {allFactoryNames.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      )}
      {hasFilters && <ClearFiltersButton visible={true} onClear={() => { clearFilters(); clearStickyFilters('products') }} />}
    </div>

    {filtered.length === 0 ? <div className="empty-state"><div className="empty-icon">👑</div><p>Nenhum produto</p></div>
    : <div className="product-grid">{filtered.map(p => {
      const st = PROD_ST.find(s => s.id === p.status)
      const img = p.card_image_url || (p.photos || [])[0]
      const suppCount = (p.suppliers || []).length
      const colorsInProd = (p.color_variants || []).filter(cv => cv.status === 'production' || cv.status === 'idea').length
      const skus = (p.color_variants || []).map(cv => cv.sku).filter(Boolean)
      let totalSales = 0, totalStock = 0
      for (const sku of skus) {
        totalSales += (salesByIndex.salesBySku.get(sku)?.qty || 0)
        totalStock += (salesByIndex.stockBySku.get(sku) || 0)
      }
      return (
        <div key={p.id} className={`pcard${p.status === 'discontinued' ? ' faded' : ''}`} onClick={() => setDetail(p)}>
          <div className="pcard-img">
            {img ? <img src={img} alt={p.name} /> : <div className="pcard-ph">👑</div>}
            <span className="pcard-badge" style={{ background: st?.color }}>{st?.icon}</span>
            {colorsInProd > 0 && <span className="pcard-badge" style={{ background: '#F59E0B', left: 8, right: 'auto', top: 8 }}>{colorsInProd} 🏭</span>}
            {/* v13.44 — Favoritar produto */}
            <div style={{ position: 'absolute', bottom: 6, right: 6, zIndex: 2, background: 'rgba(255,255,255,.88)', borderRadius: 4, backdropFilter: 'blur(4px)' }}>
              <FavoriteStar entityType="product" entityId={p.id} size="sm" />
            </div>
          </div>
          <div className="pcard-info">
            <div className="pcard-name">{UC(p.name)}</div>
            {/* Subtítulo: só fábrica (se permissão). Coleção vira tag pequena abaixo. */}
            {perm.factoryInfo && p.factory && (
              <div className="text-muted text-sm">🏭 {p.factory}</div>
            )}
            <div className="tag-row">
              {p.collection && <span className="tag" style={{ fontSize: 9, opacity: 0.7 }}>{p.collection}</span>}
              {p.finish_type && <span className="tag">{p.finish_type}</span>}
              {p.material && <span className="tag">{p.material}</span>}
              {(p.color_variants || []).length > 0 && <span className="tag">{p.color_variants.length} cor{p.color_variants.length > 1 ? 'es' : ''}</span>}
              {perm.factoryInfo && suppCount > 1 && <span className="tag" style={{ background: '#DBEAFE', color: '#1D4ED8' }}>{suppCount} fábricas</span>}
              {perm.shopify && totalSales > 0 && <span className="tag" style={{ background: '#D1FAE5', color: '#059669' }}>📦 {totalSales}</span>}
              {perm.shopify && totalSales === 0 && totalStock > 0 && <span className="tag" style={{ background: '#FEF3C7', color: '#92400E' }}>{totalStock} estoque</span>}
            </div>
          </div>
        </div>
      )
    })}</div>}

    {modal && (
      <ProductModal
        product={modal === 'new' ? null : modal}
        collections={collections}
        factories={factories}
        colors={colors}
        names={names}
        existingProducts={products}
        orders={orders}
        shopifyCache={shopifyCache}
        onSave={save}
        onClose={() => setModal(null)}
        perm={perm}
      />
    )}
    {detail && (
      <ProductDetail
        product={detail}
        perm={perm}
        user={user}
        orders={orders}
        shopifyCache={shopifyCache}
        colors={colors}
        onClose={() => setDetail(null)}
        onEdit={() => { setModal(detail); setDetail(null) }}
        onDelete={() => remove(detail)}
        onStatus={s => changeStatus(detail.id, s)}
        onConvertToIdea={convertToIdea}
        onDuplicate={duplicate}
      />
    )}
  </div>
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT MODAL — ordem otimizada: foto/nome no topo
// ═══════════════════════════════════════════════════════════════════
function ProductModal({ product, collections, factories, colors, names, existingProducts = [], orders = [], shopifyCache = null, onSave, onClose, perm }) {
  const [f, setF] = useState(() => {
    const base = product || {}
    return {
      ...base,
      // Defaults garantem que campos null do banco virem string vazia
      name: base.name || '',
      status: base.status || 'developing',
      collection: base.collection || '',
      factory: base.factory || '',
      factory_code: base.factory_code || '',
      // Default "Wig" pra produto novo — 99% dos produtos são Wig (pode trocar com 1 clique)
      finish_type: base.finish_type || (product ? '' : 'Wig (sem lace)'),
      reparticao: base.reparticao || '',
      reparticao_size: base.reparticao_size || '',
      reparticao_acabamento: base.reparticao_acabamento || '',
      hair_type: base.hair_type || '',
      length: base.length || '',
      material: base.material || '',
      notes: base.notes || '',
      card_image_url: base.card_image_url || '',
      photos: base.photos || [],
      sku: base.sku || '',
      pre_plucked: !!base.pre_plucked,
      price_usd: base.price_usd || '',
      color_variants: base.color_variants || [],
      suppliers: base.suppliers || [],
    }
  })
  const [dirty, setDirty] = useState(false)
  const [uploading, setUploading] = useState(false)
  const isEdit = !!product?.id
  const toast = useToast()
  const cardInputRef = useRef()
  const galleryInputRef = useRef()
  const coresRef = useRef()

  const s = (k, v) => { setF(p => ({ ...p, [k]: v })); setDirty(true) }

  // Bug fix: o "banco de nomes" é justamente onde nomes ficam guardados PRA USAR.
  // Antes a checagem era contra `names`, o que impedia usar um nome livre.
  // O correto é checar se já existe outro PRODUTO com mesmo nome (igualdade case-insensitive).
  const existingProductNames = useMemo(
    () => new Set((existingProducts || []).filter(p => p.id !== product?.id).map(p => (p.name || '').toLowerCase())),
    [existingProducts, product]
  )
  const dupName = f.name && existingProductNames.has(f.name.toLowerCase().trim())
  
  // Sugestão visual: nome bate com algum nome do banco de nomes? → bom, está reservado
  const isFromNameBank = useMemo(
    () => f.name && (names || []).some(n => n.name.toLowerCase() === f.name.toLowerCase().trim()),
    [names, f.name]
  )
  
  // #A — Aviso de impacto: ao editar produto, mostrar quais pedidos abertos
  // referenciam ele. Não bloqueia, só informa que mudanças aqui podem afetar pedidos vivos.
  const impactedOrders = useMemo(() => {
    if (!product?.id) return { drafts: [], inProgress: [] }
    const all = (orders || []).filter(o => (o.items || []).some(it => it.product_id === product.id))
    return {
      drafts: all.filter(o => o.status === 'draft' || o.status === 'sent'),
      inProgress: all.filter(o => o.status === 'manufacturing' || o.status === 'completed'),
    }
  }, [product?.id, orders])

  const uploadCardImage = async (file) => {
    setUploading(true)
    try {
      const { url } = await uploadProductPhoto(file, 'products/card')
      if (f.card_image_url) await deletePhoto(f.card_image_url).catch(() => {})
      s('card_image_url', url)
    } catch (e) { toastError(toast, e) }
    setUploading(false)
  }

  const uploadGallery = async (files) => {
    setUploading(true)
    try {
      // Upload em paralelo: 5 fotos sobem em ~tempo de 1 (depende da banda).
      // Bug #20 corrigido: era for-of sequencial.
      const results = await Promise.allSettled(
        files.map(file => uploadProductPhoto(file, 'products/gallery'))
      )
      const urls = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value.url)
      const failed = results.filter(r => r.status === 'rejected').length
      if (urls.length) s('photos', [...(f.photos || []), ...urls])
      if (failed) {
        toast.push(`${failed} foto(s) falharam no upload`, { kind: 'warning' })
      }
    } catch (e) { toastError(toast, e) }
    setUploading(false)
  }

  const removePhoto = async (url) => {
    await deletePhoto(url).catch(() => {})
    s('photos', (f.photos || []).filter(p => p !== url))
  }

  const removeCardImage = async () => {
    if (f.card_image_url) await deletePhoto(f.card_image_url).catch(() => {})
    s('card_image_url', '')
  }

  // Color variants — status manual só permite 'idea', 'catalog', 'discontinued' (production vem via pedido)
  // v13.22 #5 — Antes filtrava 'production' do dropdown manual (era setado só automaticamente
  // ao mudar pedido pra fabricação). Mas se o pedido era excluído, a cor ficava presa em
  // production sem como sair. Agora libera todos — você decide manualmente quando precisar.
  const MANUAL_CV_ST = COLOR_STATUSES
  // Callback form em todas mutações de arrays (evita state stale)
  // v13.57 — índice do cache da Shopify: sugere SKUs REAIS e valida os digitados
  const shopifyIndex = useMemo(() => buildShopifyIndex(shopifyCache), [shopifyCache])

  const addCV = () => {
    // Nova cor herda o status do produto (developing→idea, in_production→production, etc).
    // Coerência entre produto e suas variantes.
    const PROD_TO_COLOR = { developing: 'idea', in_production: 'production', catalog: 'catalog', discontinued: 'discontinued' }
    const defaultColorStatus = PROD_TO_COLOR[f.status] || 'idea'
    setF(prev => ({ ...prev, color_variants: [...(prev.color_variants || []), { id: 'tmp-' + uid(), code: '', status: defaultColorStatus, sku: '' }] }))
    setDirty(true)
  }
  const updCV = (id, key, val) => {
    setF(prev => ({ ...prev, color_variants: (prev.color_variants || []).map(c => c.id === id ? { ...c, [key]: val } : c) }))
    setDirty(true)
  }
  // v13.52 — Ao escolher a cor, auto-propõe o SKU pela convenção (só se ainda vazio).
  // Preenche os SKUs naturalmente — é o que vincula produto↔Shopify (vendas/estoque).
  const setCVCode = (id, code) => {
    setF(prev => ({
      ...prev,
      color_variants: (prev.color_variants || []).map(c => {
        if (c.id !== id) return c
        const next = { ...c, code }
        if (!c.sku && code && prev.name) next.sku = proposeSku(prev.name, code)
        return next
      }),
    }))
    setDirty(true)
  }
  const rmCV = (id) => {
    setF(prev => ({ ...prev, color_variants: (prev.color_variants || []).filter(c => c.id !== id) }))
    setDirty(true)
  }

  // Suppliers
  const addSupp = () => {
    setF(prev => ({ ...prev, suppliers: [...(prev.suppliers || []), { id: 'tmp-' + uid(), factory: '', factory_code: '', price_usd: '' }] }))
    setDirty(true)
  }
  const updSupp = (id, key, val) => {
    setF(prev => ({ ...prev, suppliers: (prev.suppliers || []).map(x => x.id === id ? { ...x, [key]: val } : x) }))
    setDirty(true)
  }
  const rmSupp = (id) => {
    setF(prev => ({ ...prev, suppliers: (prev.suppliers || []).filter(x => x.id !== id) }))
    setDirty(true)
  }

  const showRep = f.finish_type && (f.finish_type.includes('Lace') || f.finish_type.includes('Closure') || f.finish_type === 'HD Lace' || f.finish_type === 'Transparent Lace')

  return (
    <Modal onClose={onClose} width={700} isDirty={dirty}>
      <MH title={isEdit ? 'Editar Produto' : 'Novo Produto'} onClose={onClose} />
      <MB>
        {dupName && <div className="alert alert-warn" style={{ marginBottom: 10 }}>⚠️ Já existe outro produto com esse nome.</div>}
        {!dupName && isFromNameBank && !isEdit && (
          <div style={{ padding: '6px 10px', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 4, fontSize: 12, marginBottom: 10, color: '#065F46' }}>
            ✓ Nome reservado no banco de nomes.
          </div>
        )}
        
        {/* #A — Aviso de impacto: pedidos abertos referenciam este produto */}
        {isEdit && (impactedOrders.drafts.length > 0 || impactedOrders.inProgress.length > 0) && (
          <div style={{
            padding: '10px 12px',
            background: '#FEF3C7',
            border: '1px solid #FCD34D',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 12,
            color: '#92400E',
          }}>
            <strong>⚠️ Atenção ao editar:</strong>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
              {impactedOrders.drafts.length > 0 && (
                <li>
                  <strong>{impactedOrders.drafts.length}</strong> pedido(s) em rascunho/enviado vão refletir as mudanças.
                </li>
              )}
              {impactedOrders.inProgress.length > 0 && (
                <li>
                  <strong>{impactedOrders.inProgress.length}</strong> pedido(s) em fabricação/concluídos mantêm os dados antigos via snapshot.
                </li>
              )}
            </ul>
          </div>
        )}

        {/* === FOTO E NOME NO TOPO === */}
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 14, marginBottom: 16 }}>
          <div>
            <div style={{ aspectRatio: '3/4', background: '#f5f5f5', borderRadius: 8, overflow: 'hidden', position: 'relative', border: '1px dashed var(--border)' }}>
              {f.card_image_url
                ? <img src={f.card_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>Foto principal</div>}
              {uploading && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>Enviando...</div>}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <label className="btn btn-outline btn-sm" style={{ flex: 1, cursor: 'pointer', justifyContent: 'center' }}>
                📷 {f.card_image_url ? 'Trocar' : 'Adicionar'}
                <input ref={cardInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => e.target.files?.[0] && uploadCardImage(e.target.files[0])} />
              </label>
              {f.card_image_url && <button className="btn-icon text-danger" onClick={removeCardImage} aria-label="Remover imagem principal">🗑</button>}
            </div>
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
                excludeNames={(existingProducts || []).map(p => p.name)}
                autoFocus
                placeholder="Nome do produto"
              />
            </div>
            <div className="form-group">
              <label className="field-label">Status</label>
              <select className="field" value={f.status} onChange={e => s('status', e.target.value)}>
                {PROD_ST.map(x => <option key={x.id} value={x.id}>{x.icon} {x.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* === GALERIA DE FOTOS === */}
        <div className="form-group">
          <label className="field-label">Galeria ({(f.photos || []).length})</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(f.photos || []).map(url => (
              <div key={url} style={{ width: 60, height: 60, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
                <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button onClick={() => removePhoto(url)} aria-label="Remover foto" style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(255,0,0,.8)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, fontSize: 10, cursor: 'pointer' }}>✕</button>
              </div>
            ))}
            <label style={{ width: 60, height: 60, borderRadius: 6, border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              +<input ref={galleryInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={e => e.target.files?.length && uploadGallery([...e.target.files])} />
            </label>
          </div>
        </div>

        {/* === VARIANTES DE COR (posição no topo pra acesso rápido) === */}
        <div className="form-group" ref={coresRef}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label className="field-label" style={{ margin: 0 }}>🎨 Variantes de Cor ({(f.color_variants || []).length})</label>
            <button className="btn btn-outline btn-sm" onClick={addCV}>+ Cor</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
            {(f.color_variants || []).map(cv => {
              const colorData = colors.find(c => c.code === cv.code)
              return (
                <div key={cv.id} style={{
                  display: 'flex', gap: 6, padding: 6,
                  background: '#FAFAFA', borderRadius: 6,
                  border: '1px solid var(--border)',
                  alignItems: 'center',
                }}>
                  {/* #20 Swatch unificado */}
                  <ColorSwatch color={colorData} code={cv.code} colors={colors} size="md" />
                  <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <select className="field field-sm" style={{ fontSize: 11, padding: '3px 4px' }} value={cv.code} onChange={e => setCVCode(cv.id, e.target.value)}>
                      <option value="">Código</option>
                      {colors.map(c => <option key={c.id} value={c.code}>{c.code}{c.name_pt ? ` · ${c.name_pt}` : ''}</option>)}
                    </select>
                    <select className="field field-sm" style={{ fontSize: 11, padding: '3px 4px' }} value={cv.status} onChange={e => updCV(cv.id, 'status', e.target.value)}>
                      {MANUAL_CV_ST.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
                    </select>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        className="field field-sm"
                        style={{ flex: 1, fontSize: 11, padding: '3px 6px' }}
                        placeholder="SKU (vincula com a Shopify)"
                        value={cv.sku || ''}
                        onChange={e => updCV(cv.id, 'sku', e.target.value)}
                        title="SKU pra vincular a variante com a Shopify (vendas/estoque)"
                      />
                      {cv.code && f.name && !cv.sku && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '2px 6px', fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0 }}
                          onClick={() => updCV(cv.id, 'sku', proposeSku(f.name, cv.code))}
                          title={`Sugerir SKU pela convenção: ${proposeSku(f.name, cv.code)}`}
                        >✨ {proposeSku(f.name, cv.code)}</button>
                      )}
                    </div>
                    {/* v13.57 — vínculo real com a Shopify: valida SKU digitado / sugere o verdadeiro */}
                    {(() => {
                      if (shopifyIndex.length === 0) return null
                      if (cv.sku) {
                        const linked = findShopifyBySku(cv.sku, shopifyIndex)
                        return (
                          <div style={{ gridColumn: '1 / -1', fontSize: 10, color: linked ? '#047857' : '#B45309' }}>
                            {linked
                              ? <span title={linked.title}>🛒 vinculado: {linked.title.length > 36 ? linked.title.slice(0, 36) + '…' : linked.title} · {linked.stock ?? '?'} un</span>
                              : <span title="Nenhum produto da Shopify tem esse SKU (na última sincronização). Confira ou use uma sugestão.">⚠️ SKU não encontrado na Shopify</span>}
                          </div>
                        )
                      }
                      const sug = suggestShopifyLinks(f.name, cv.code, shopifyIndex, 2)
                      if (sug.length === 0) return null
                      return (
                        <div style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                          <span className="text-muted" style={{ fontSize: 9 }}>🛒 na Shopify:</span>
                          {sug.map(sg => (
                            <button
                              key={sg.sku}
                              type="button"
                              className="btn btn-outline btn-sm"
                              style={{ padding: '1px 6px', fontSize: 10 }}
                              onClick={() => updCV(cv.id, 'sku', sg.sku)}
                              title={`${sg.title} · ${sg.stock ?? '?'} em estoque — clique pra usar este SKU real`}
                            >{sg.sku}</button>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                  <button className="btn-icon text-danger" style={{ flexShrink: 0, padding: 2 }} onClick={() => rmCV(cv.id)} title="Remover" aria-label="Remover cor">✕</button>
                </div>
              )
            })}
          </div>
        </div>

        {/* === INFORMAÇÕES BÁSICAS === */}
        <div className="form-row">
          <div className="form-group">
            <label className="field-label">Coleção</label>
            <select className="field" value={f.collection || ''} onChange={e => s('collection', e.target.value)}>
              <option value="">—</option>
              {collections.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          {perm.factoryInfo && (
            <div className="form-group">
              <label className="field-label">Fábrica</label>
              <select className="field" value={f.factory || ''} onChange={e => s('factory', e.target.value)}>
                <option value="">—</option>
                {factories.map(fa => <option key={fa.id} value={fa.name}>{fa.name}</option>)}
              </select>
            </div>
          )}
        </div>

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
                  {/* 2 botões grandes — 99% dos produtos caem aqui */}
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
                  {/* Dropdown pra casos raros (outros acabamentos) */}
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

        {showRep && (
          <div className="form-row">
            <div className="form-group">
              <label className="field-label">Repartição</label>
              <select className="field" value={f.reparticao || ''} onChange={e => s('reparticao', e.target.value)}>
                <option value="">—</option>
                {REP_TYPES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="field-label">Tamanho</label>
              <select className="field" value={f.reparticao_size || ''} onChange={e => s('reparticao_size', e.target.value)}>
                <option value="">—</option>
                {REP_SIZES.map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="field-label">Tipo de Fio</label>
            <select className="field" value={f.hair_type || ''} onChange={e => s('hair_type', e.target.value)}>
              <option value="">—</option>
              {HTYPES.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="field-label">Comprimento</label>
            <select className="field" value={f.length || ''} onChange={e => s('length', e.target.value)}>
              <option value="">—</option>
              {HLENS.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
        </div>

        {perm.factoryInfo && (
          <div className="form-row">
            <div className="form-group">
              <label className="field-label">Código Fábrica</label>
              <input className="field" value={f.factory_code || ''} onChange={e => s('factory_code', e.target.value)} />
            </div>
            {perm.prices && (
              <div className="form-group">
                <label className="field-label">Preço USD</label>
                <input className="field" type="number" step="0.01" value={f.price_usd || ''} onChange={e => s('price_usd', e.target.value)} />
              </div>
            )}
          </div>
        )}

        {/* === MÚLTIPLAS FÁBRICAS (só admin) === */}
        {perm.factoryInfo && perm.prices && (
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className="field-label" style={{ margin: 0 }}>Múltiplas Fábricas ({(f.suppliers || []).length})</label>
              <button className="btn btn-outline btn-sm" onClick={addSupp}>+ Fábrica</button>
            </div>
            {(f.suppliers || []).map(sp => (
              <div key={sp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
                <select className="field field-sm" value={sp.factory} onChange={e => updSupp(sp.id, 'factory', e.target.value)}>
                  <option value="">Fábrica</option>
                  {factories.map(fa => <option key={fa.id} value={fa.name}>{fa.name}</option>)}
                </select>
                <input className="field field-sm" placeholder="Código" value={sp.factory_code || ''} onChange={e => updSupp(sp.id, 'factory_code', e.target.value)} />
                <input className="field field-sm" type="number" step="0.01" placeholder="USD" value={sp.price_usd || ''} onChange={e => updSupp(sp.id, 'price_usd', e.target.value)} />
                <button className="btn-icon text-danger" onClick={() => rmSupp(sp.id)} aria-label="Remover fornecedor">✕</button>
              </div>
            ))}
          </div>
        )}

        <div className="form-group">
          <label className="field-label">Observações</label>
          <textarea className="field" value={f.notes || ''} onChange={e => s('notes', e.target.value)} />
        </div>
      </MB>
      <MF>
        {/* Atalho rápido pras cores (botão que faz scroll + ação) */}
        <div style={{ marginRight: 'auto', display: 'flex', gap: 6 }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              coresRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
            title="Ir para a seção de cores"
          >
            🎨 Cores ({(f.color_variants || []).length})
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              addCV()
              // Scroll depois que a cor nova foi adicionada
              setTimeout(() => coresRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
            }}
            title="Adicionar cor e rolar até lá"
          >
            + Cor
          </button>
        </div>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <SaveButton onSave={() => onSave(f)} disabled={!f.name || uploading}>
          {uploading ? 'Enviando fotos...' : 'Salvar'}
        </SaveButton>
      </MF>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT DETAIL — visualização read-only com ações
// ═══════════════════════════════════════════════════════════════════
function ProductDetail({ product: p, onClose, onEdit, onDelete, onStatus, onConvertToIdea, onDuplicate, perm, orders = [], shopifyCache, colors = [], user, rate }) {
  const [lb, setLb] = useState(null)
  const [logs, setLogs] = useState([])
  const [orderModal, setOrderModal] = useState(null)  // pedido aberto sobre o produto
  const [historyPeriod, setHistoryPeriod] = useState('all')  // #20 filtro de período no histórico
  const st = PROD_ST.find(s => s.id === p.status)
  const allPhotos = [p.card_image_url, ...(p.photos || [])].filter(Boolean)

  // #11 — Carrega últimas 15 mudanças no produto
  useEffect(() => {
    let cancelled = false
    listLogsForEntity('product', p.id, 15).then(data => {
      if (!cancelled) setLogs(data)
    })
    return () => { cancelled = true }
  }, [p.id, p.updated_at])  // recarrega ao editar (updated_at muda)

  // Lincagem: pedidos que contém este produto
  const relatedOrders = useMemo(() => {
    return (orders || [])
      .filter(o => (o.items || []).some(it => it.product_id === p.id))
      .map(o => {
        const itemsOfProduct = (o.items || []).filter(it => it.product_id === p.id)
        const qty = itemsOfProduct.reduce((a, it) => {
          const cls = it.colors || []
          return a + cls.reduce((b, c) => b + Number(c.qty || 0), 0)
               + (cls.length === 0 ? Number(it.quantity || 0) : 0)
        }, 0)
        const colorsInOrder = [...new Set(itemsOfProduct.flatMap(it => (it.colors || []).map(c => c.code)).filter(Boolean))]
        return { order: o, qty, colorsInOrder }
      })
      .sort((a, b) => new Date(b.order.created_at) - new Date(a.order.created_at))
  }, [orders, p.id])

  const totalOrderedQty = relatedOrders.reduce((a, r) => a + r.qty, 0)
  
  // #20 Histórico filtrado por período (client-side, sem re-request)
  const filteredRelatedOrders = useMemo(() => {
    if (historyPeriod === 'all') return relatedOrders
    const days = { '30d': 30, '90d': 90, '1y': 365 }[historyPeriod]
    if (!days) return relatedOrders
    const cutoff = Date.now() - days * 86400000
    return relatedOrders.filter(r => new Date(r.order.created_at).getTime() >= cutoff)
  }, [relatedOrders, historyPeriod])
  
  const filteredQty = filteredRelatedOrders.reduce((a, r) => a + r.qty, 0)

  // Lincagem: vendas Shopify pelo SKU das variantes
  const salesSummary = useMemo(() => {
    if (!shopifyCache) return null
    const skus = (p.color_variants || []).map(cv => cv.sku).filter(Boolean)
    if (skus.length === 0 && !p.sku) return null
    const allSkus = p.sku ? [...skus, p.sku] : skus
    const so = shopifyCache.orders || []
    let qty = 0, revenue = 0
    for (const o of so) {
      for (const li of (o.line_items || [])) {
        if (allSkus.includes(li.sku)) {
          qty += li.quantity
          revenue += parseFloat(li.price) * li.quantity
        }
      }
    }
    return { qty, revenue }
  }, [shopifyCache, p])

  const colorStatusCount = useMemo(() => {
    const counts = { catalog: 0, production: 0, idea: 0, discontinued: 0 }
    for (const cv of (p.color_variants || [])) {
      counts[cv.status || 'idea'] = (counts[cv.status || 'idea'] || 0) + 1
    }
    return counts
  }, [p.color_variants])

  return (
    <>
      <Lightbox
        src={typeof lb === 'string' ? lb : null}
        sources={lb && typeof lb === 'object' ? lb.sources : null}
        initialIndex={lb && typeof lb === 'object' ? lb.index : 0}
        onClose={() => setLb(null)}
      />
      {/* Modal sobreposto: ao clicar num pedido do histórico, abre detalhe sem perder contexto */}
      {orderModal && (
        <OrderDetail
          order={orderModal}
          products={[p]}
          perm={perm}
          rate={rate}
          user={user}
          zIndex={200}
          readOnly={true}
          onClose={() => setOrderModal(null)}
          onEdit={() => {}}
          onDelete={() => {}}
          onStatus={() => {}}
          onRefresh={() => Promise.resolve()}
        />
      )}
      <Modal onClose={onClose} width={680} allowOutsideClose>
        <MH title={UC(p.name)} onClose={onClose} actions={
          perm.products ? (
            <>
              {onDuplicate && <button className="btn btn-outline btn-sm" onClick={() => onDuplicate(p)} title="Criar produto novo com os mesmos dados">📋 Duplicar</button>}
              {onConvertToIdea && <button className="btn btn-outline btn-sm" onClick={() => onConvertToIdea(p)} title="Voltar esse produto para ser uma ideia">📉 Tornar Ideia</button>}
              <button className="btn btn-primary btn-sm" onClick={onEdit}>✏️ Editar</button>
            </>
          ) : null
        } />
        <MB>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="chip" style={{ background: st?.color, color: '#fff' }}>{st?.icon} {st?.label}</span>
            {p.collection && <span className="chip" style={{ background: '#f3f4f6' }}>{p.collection}</span>}
            {perm.factoryInfo && p.factory && <span className="chip" style={{ background: '#DBEAFE', color: '#1D4ED8' }}>🏭 {p.factory}</span>}
            {(p.suppliers || []).length > 1 && perm.factoryInfo && (
              <span className="chip" style={{ background: '#EEF2FF', color: '#4338CA' }}>
                +{p.suppliers.length - 1} fábrica{p.suppliers.length > 2 ? 's' : ''}
              </span>
            )}
          </div>

          {allPhotos.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
              {allPhotos.map((url, i) => (
                <img key={i} src={url} alt="" onClick={() => setLb({ sources: allPhotos, index: i })}
                  style={{ width: 100, height: 130, objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in', flexShrink: 0 }} />
              ))}
            </div>
          )}

          {/* Stats quick-look — a rede de conexões do produto */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
            <div style={{ background: '#F5F2EF', padding: 10, borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>{(p.color_variants || []).length}</div>
              <div className="text-muted text-xs">CORES</div>
            </div>
            {perm.orders && (
              <div style={{ background: '#FFFBEB', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#92400E' }}>{relatedOrders.length}</div>
                <div className="text-muted text-xs">PEDIDOS ({totalOrderedQty} pçs)</div>
              </div>
            )}
            {perm.shopify && salesSummary && (
              <div style={{ background: '#F0FDF4', padding: 10, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#166534' }}>{salesSummary.qty}</div>
                <div className="text-muted text-xs">VENDIDOS (6m)</div>
              </div>
            )}
          </div>

          {/* Tabela de Cores — logo após stats, formato tabela */}
          {(p.color_variants || []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="field-label">🎨 Cores do Produto ({p.color_variants.length})</div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 8,
              }}>
                {p.color_variants.map(cv => {
                  const cvSt = COLOR_STATUSES.find(c => c.id === cv.status)
                  const colorData = colors.find(c => c.code === cv.code)
                  // Fábricas que têm essa cor: produto principal + suppliers com factory definida
                  const factoriesWithColor = [
                    p.factory,
                    ...((p.suppliers || []).map(s => s.factory).filter(Boolean))
                  ].filter(Boolean)
                  return (
                    <ColorChip
                      key={cv.id}
                      code={cv.code}
                      status={cvSt}
                      colorData={colorData}
                      colors={colors}
                      sku={cv.sku}
                      factories={factoriesWithColor}
                      showSku={true}
                      showFactories={perm.factoryInfo}
                      onPhotoClick={() => colorData?.photo_url && setLb(colorData.photo_url)}
                    />
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            {p.finish_type && <Info label="Acabamento" value={p.finish_type} />}
            {p.material && <Info label="Material" value={p.material} />}
            {p.hair_type && <Info label="Fio" value={p.hair_type} />}
            {p.length && <Info label="Comprimento" value={p.length} />}
            {perm.factoryInfo && p.factory_code && <Info label="Cód. Fábrica" value={p.factory_code} copy />}
            {perm.prices && p.price_usd && <Info label="Preço USD" value={`$ ${parseFloat(p.price_usd).toFixed(2)}`} />}
          </div>

          {/* v13.33 — Histórico de preço refatorado em componente próprio
              (priceHistory.js + PriceHistoryChart.jsx). Mais rico que a versão antiga:
              tooltip melhor, alerta de aumento >15%, 4 stat boxes, tendência colorida. */}
          {perm.prices && perm.orders && (
            <PriceHistoryChart productId={p.id} orders={orders} />
          )}

          {/* LINCAGEM — histórico de pedidos com este produto */}
          {perm.orders && relatedOrders.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="field-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span>📋 Histórico em Pedidos ({filteredRelatedOrders.length}{historyPeriod !== 'all' ? ` de ${relatedOrders.length}` : ''}) · {filteredQty} pç(s)</span>
                {/* #20 Chips de filtro por período */}
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { id: 'all', label: 'Tudo' },
                    { id: '1y', label: '1 ano' },
                    { id: '90d', label: '90d' },
                    { id: '30d', label: '30d' },
                  ].map(p => (
                    <button
                      key={p.id}
                      className={`chip-filter${historyPeriod === p.id ? ' on' : ''}`}
                      onClick={() => setHistoryPeriod(p.id)}
                      style={{ fontSize: 10, padding: '2px 8px' }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {filteredRelatedOrders.length === 0 ? (
                <div style={{ padding: '20px 12px', textAlign: 'center', border: '1px solid var(--border-light)', borderRadius: 6 }}>
                  <span className="text-muted text-sm">
                    Nenhum pedido nos últimos {historyPeriod === '30d' ? '30 dias' : historyPeriod === '90d' ? '90 dias' : '12 meses'}.
                  </span>
                </div>
              ) : (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: 6 }}>
                  {filteredRelatedOrders.map(({ order, qty, colorsInOrder }) => {
                    const oSt = ORDER_ST.find(s => s.id === order.status)
                    return (
                      <div
                        key={order.id}
                        style={{
                          padding: '10px 12px', borderBottom: '1px solid var(--border-light)',
                          display: 'flex', alignItems: 'center', gap: 10,
                          cursor: 'pointer', transition: 'background .15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#FAF8F6'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                        onClick={() => setOrderModal(order)}
                        title="Abrir detalhe do pedido"
                      >
                        <span style={{
                          background: (oSt?.color || '#999') + '20',
                          color: oSt?.color || '#666',
                          fontSize: 11, padding: '3px 8px', borderRadius: 10,
                          fontWeight: 600, whiteSpace: 'nowrap',
                        }}>
                          {oSt?.icon} {oSt?.label}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>
                            {order.order_name || order.factory}
                          </div>
                          <div className="text-muted" style={{ fontSize: 10 }}>
                            {formatDate(order.created_at, 'full')} · {order.factory}
                            {colorsInOrder.length > 0 && ` · cores: ${colorsInOrder.join(', ')}`}
                          </div>
                        </div>
                        <strong style={{ fontSize: 13, color: 'var(--primary)', whiteSpace: 'nowrap' }}>{qty} pçs</strong>
                        <span style={{ color: '#9CA3AF', fontSize: 14 }}>›</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* #11 — Mudanças Recentes (activity log do produto) */}
          {logs.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="field-label">📜 Mudanças Recentes ({logs.length})</div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border-light, #f3f4f6)', borderRadius: 6 }}>
                {logs.map(log => {
                  const when = new Date(log.created_at)
                  const dateStr = formatDate(when, 'with-time')
                  return (
                    <div key={log.id} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-light, #f3f4f6)', fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <strong style={{ color: 'var(--primary)' }}>{log.user_name_snapshot || 'Sistema'}</strong>
                        <span className="text-muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>{dateStr}</span>
                      </div>
                      <div style={{ marginTop: 2 }}>
                        <span style={{ color: '#6B7280', fontStyle: 'italic' }}>{log.action}</span>
                        {log.details && <span style={{ color: 'var(--text)' }}> — {log.details}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {p.notes && (
            <div style={{ background: '#f9fafb', padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
              <div className="field-label">Observações</div>
              {p.notes}
            </div>
          )}

          {perm.products && (
            <div>
              <div className="field-label">Mudar status</div>
              <div className="chip-bar">
                {PROD_ST.map(s => (
                  <button key={s.id}
                    className={`chip-filter${p.status === s.id ? ' on' : ''}`}
                    style={p.status === s.id ? { background: s.color, borderColor: s.color, color: '#fff' } : {}}
                    onClick={() => onStatus(s.id)}>
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </MB>
        {perm.products && (
          <MF>
            <button className="btn-icon text-danger" onClick={onDelete} style={{ marginRight: 'auto' }}>🗑 Excluir</button>
          </MF>
        )}
      </Modal>
    </>
  )
}

function Info({ label, value, copy }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div>
        {copy ? <CopyChip text={value} label={label} /> : value}
      </div>
    </div>
  )
}
