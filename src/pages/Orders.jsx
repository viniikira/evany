// src/pages/Orders.jsx
import { useState, useEffect, useMemo, useRef } from 'react'
import { Modal, useConfirm, useToast, SkeletonList, ClearFiltersButton } from '../components/ui'
import { LeadTimePromptModal } from '../components/orders/LeadTimePromptModal'
import { CompletionSummaryModal } from '../components/orders/CompletionSummaryModal'
import { PayRow } from '../components/orders/PayRow'
import { OrderDetail } from '../components/orders/OrderDetail'
import { OrderModal } from '../components/orders/OrderModal'
import { OrderCreator } from '../components/orders/OrderCreator'
import {
  listOrders, createOrder, updateOrder, deleteOrder, updateOrderStatus,
  addPayment, updatePayment, deletePayment,
  listDeletedOrders, restoreOrder, purgeOrderPermanently,
  duplicateOrder,
} from '../lib/data/orders'
import { listProducts, bulkUpdateColorStatus, updateProductStatus } from '../lib/data/products'
import { listFactories, listColors, addLog as writeLog } from '../lib/data/misc'
import { trackAction } from '../lib/analytics'
import { ORDER_ST } from '../lib/constants'
import { useStickyFilter, clearStickyFilters } from '../lib/hooks'
import { computeFactoryLeadTime, computeOrderDelay } from '../lib/pendencias'
import { uid, formatDate, UC } from '../lib/utils'
import { toastError } from '../lib/errors'
import { log } from '../lib/logger'

// uid importado de lib/utils (crypto.randomUUID)
// UC importado de lib/utils (era duplicado aqui)

export default function OrdersPage({ user, perm, rate, initialData = [], initialIdeas = [], onMutate, initialDetailId, onDetailOpened }) {
  const [orders, setOrders] = useState(initialData)
  const [trashOrders, setTrashOrders] = useState([])
  const [trashLoaded, setTrashLoaded] = useState(false)
  const [products, setProducts] = useState([])
  const [ideas, setIdeas] = useState(initialIdeas)
  const [factories, setFactories] = useState([])
  const [colors, setColors] = useState([])
  const [loading, setLoading] = useState(initialData.length === 0)
  const [filter, setFilter] = useStickyFilter('orders.filter', 'all')
  const [modal, setModal] = useState(null)
  // v13.48 — Criador visual (tela cheia) pra pedidos novos; edição fica no modal clássico
  const [creator, setCreator] = useState(false)
  const [detail, setDetail] = useState(null)
  // #B Modal pós-conclusão: aparece quando pedido vira "Concluído"
  // mostrando resumo do que o sistema fez automaticamente
  const [completionSummary, setCompletionSummary] = useState(null)
  // #3 Modal pra perguntar prazo prometido ao mudar pra "Em Fabricação"
  const [leadTimePrompt, setLeadTimePrompt] = useState(null)
  const confirm = useConfirm()
  const toast = useToast()

  const load = async () => {
    if (orders.length === 0) setLoading(true)
    try {
      const [o, p, f, c] = await Promise.all([listOrders(), listProducts(), listFactories().catch(() => []), listColors()])
      setOrders(o); setProducts(p); setFactories(f); setColors(c)
      // BUG FIX: se detail estiver aberto, ressincroniza com a versão recarregada.
      // Sem isso, novo pagamento só aparecia depois de fechar+reabrir o modal.
      setDetail(prev => prev ? (o.find(x => x.id === prev.id) || prev) : prev)
    } catch (e) { toastError(toast, e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setIdeas(initialIdeas || []) }, [initialIdeas])
  
  // Carrega lixeira sob demanda quando filter='trash' for selecionado
  // (evita carregar dados desnecessários no carregamento inicial)
  useEffect(() => {
    if (filter !== 'trash' || trashLoaded) return
    loadTrash()
  }, [filter])
  
  const loadTrash = async () => {
    try {
      const list = await listDeletedOrders()
      setTrashOrders(list)
      setTrashLoaded(true)
    } catch (e) { toastError(toast, e) }
  }
  
  // Abre o detalhe de um pedido específico quando vem de outra tela
  // (ex: Visão Financeira clica em pedido atrasado → navega + abre detalhe)
  useEffect(() => {
    if (!initialDetailId || orders.length === 0) return
    const target = orders.find(o => o.id === initialDetailId)
    if (target) {
      setDetail(target)
      onDetailOpened?.()
    }
  }, [initialDetailId, orders])

  // v13.41 — Hook DEVE vir antes de qualquer early return (rules of hooks).
  // Prazo médio por fábrica (calculado dos pedidos concluídos) — usado no OrderModal
  const leadTimeByFactory = useMemo(() => computeFactoryLeadTime(orders), [orders])

  if (!perm.orders) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Sem permissão.</p></div>

  // Suporta filter especial 'trash' que mostra pedidos da lixeira em vez dos ativos
  const filtered = filter === 'trash'
    ? trashOrders
    : (filter === 'all' ? orders : orders.filter(o => o.status === filter))
  const isViewingTrash = filter === 'trash'

  const save = async (order) => {
    try {
      // Campo vazio = sem estimativa (vai null pro banco)
      if (order.expected_arrival === '' || order.expected_arrival === '_none') {
        order.expected_arrival = null
      }
      
      // v13.40 — Pedido retroativo já em fabricação: usa order_date como início.
      // Sem isso, cálculo de atraso (que exige manufacturing_started_at) falharia.
      if (order.status === 'manufacturing' && !order.manufacturing_started_at && order.order_date) {
        order.manufacturing_started_at = order.order_date + 'T12:00:00Z'
      }
      
      // #5 — Validação: pedido precisa de pelo menos 1 item com qty > 0
      // (cores com qty=0 são pré-listadas que usuário ainda não preencheu)
      const validItems = (order.items || []).filter(it => {
        if (!it.product_id && !it.idea_id) return false
        const totalQty = (it.colors || []).reduce((a, c) => a + Number(c.qty || 0), 0) + Number(it.quantity || 0)
        return totalQty > 0
      })
      if (validItems.length === 0) {
        toast.push('Adicione ao menos 1 item com quantidade maior que zero antes de salvar', { kind: 'error', duration: 6000 })
        return false
      }
      
      // #3 — CONVERSÃO AUTOMÁTICA DE IDEIAS EM PRODUTOS (com dry-run de validação)
      // Items marcados com idea_id viram produto real aqui (antes do createOrder).
      //
      // Estratégia anti-corrupção: VALIDA todas as ideias primeiro (dry-run).
      // Se alguma vai falhar (ex: nome conflitante com produto existente), aborta antes
      // de tocar no banco. Só executa as criações depois que TODAS estão validadas.
      //
      // Ainda há risco residual de falha de rede no meio das criações (ideia 1 já criada,
      // ideia 2 falha de rede). Nesse caso, o produto criado fica solto mas a 2ª ideia
      // permanece intacta. Documentamos no toast.
      const itemsWithIdeas = (order.items || []).filter(it => it.idea_id)
      if (itemsWithIdeas.length > 0) {
        const { createProduct } = await import('../lib/data/products')
        const { deleteIdea } = await import('../lib/data/misc')
        
        // ── DRY RUN: valida todas antes de criar nada ──
        const validations = []
        const productNames = new Set(products.map(p => (p.name || '').toLowerCase().trim()))
        
        for (const it of itemsWithIdeas) {
          const idea = ideas.find(i => i.id === it.idea_id)
          if (!idea) {
            validations.push({ it, error: 'Ideia não encontrada (pode ter sido deletada por outra aba)' })
            continue
          }
          if (productNames.has((idea.name || '').toLowerCase().trim())) {
            validations.push({ it, idea, error: `Já existe um produto com o nome "${idea.name}"` })
            continue
          }
          validations.push({ it, idea, error: null })
        }
        
        const errors = validations.filter(v => v.error)
        if (errors.length > 0) {
          const msg = errors.map(e => `• ${e.idea?.name || 'Ideia'}: ${e.error}`).join('\n')
          toast.push(`Não foi possível salvar — ideias com problema:\n${msg}`, { kind: 'error', duration: 8000 })
          return false  // aborta sem tocar no banco
        }
        
        // ── EXECUÇÃO: validações passaram, executa as criações ──
        const successfulConversions = []
        try {
          for (const { it, idea } of validations) {
            const createdProduct = await createProduct({
              name: idea.name,
              factory: idea.factory || order.factory,
              factory_code: idea.factory_code || null,
              collection: idea.collection || null,
              card_image_url: idea.card_image_url || null,
              photos: idea.photos || [],
              color_variants: idea.color_variants || [],
              suppliers: idea.suppliers || [],
              finish_type: idea.finish_type || null,
              reparticao: idea.reparticao || null,
              reparticao_size: idea.reparticao_size || null,
              reparticao_acabamento: idea.reparticao_acabamento || null,
              pre_plucked: idea.pre_plucked || false,
              hair_type: idea.hair_type || null,
              hair_length: idea.hair_length || null,
              material: idea.material || null,
              price_usd: idea.price_usd || null,
              status: 'developing',
              timeline: [{ status: 'developing', date: new Date().toISOString(), note: `Criado via conversão de ideia no pedido ${order.order_name || order.factory}` }],
              created_by: user.id,
              from_idea_id: idea.id || null,  // v13.32 — vínculo explícito pra funil
            })
            
            await deleteIdea(idea.id)
            
            writeLog({
              userId: user.id, userName: user.name,
              action: 'sistema converteu ideia em produto',
              target: idea.name,
              details: `Via pedido ${order.order_name || order.factory}`,
              entityType: 'product', entityId: createdProduct.id,
            })
            
            // Imutável: cria item novo no order.items, em vez de mutar
            const itemIndex = order.items.findIndex(i => i === it)
            if (itemIndex >= 0) {
              order.items[itemIndex] = {
                ...it,
                product_id: createdProduct.id,
                idea_id: null,
                idea_name_snapshot: null,
              }
            }
            successfulConversions.push({ idea: idea.name, productId: createdProduct.id })
          }
          
          if (successfulConversions.length > 0) {
            toast.push(`💡 ${successfulConversions.length} ideia(s) convertida(s) em produto(s)`, { kind: 'success', duration: 5000 })
          }
        } catch (e) {
          // Se falhou no meio: avisa o usuário do que sobrou solto
          if (successfulConversions.length > 0) {
            const lista = successfulConversions.map(s => `"${s.idea}"`).join(', ')
            toast.push(
              `⚠️ Erro ao salvar pedido. As seguintes ideias já foram convertidas em produto e estão no Catálogo: ${lista}. Você pode tentar criar o pedido novamente referenciando esses produtos.`,
              { kind: 'error', duration: 12000 }
            )
          } else {
            toastError(toast, e, 'Erro ao converter ideia')
          }
          throw e
        }
      }
      
      // Snapshot + limpeza de cores (qty=0 são pré-listadas que usuário não pediu)
      order.items = (order.items || []).map(it => {
        const cleanColors = (it.colors || [])
          .filter(c => c && c.code && Number(c.qty || 0) > 0)
          .map(({ _fromProduct, ...rest }) => rest)
        
        const item = { ...it, colors: cleanColors }
        
        if (item.price_usd != null && item.price_usd !== '') {
          item.price_usd_snapshot = parseFloat(item.price_usd) || null
        }
        
        if (item.product_name_snapshot) return item
        const prod = products.find(p => p.id === item.product_id)
        if (!prod) return item
        return {
          ...item,
          product_name_snapshot: prod.name || null,
          product_code_snapshot: prod.factory_code || null,
          product_cap_snapshot: prod.reparticao === 'Repartição Livre' ? prod.reparticao_size : prod.finish_type,
          selected_photo_url: item.selected_photo_url || prod.card_image_url || (prod.photos || [])[0] || null,
        }
      })
      
      // INTELIGÊNCIA: ao salvar pedido, atualiza fábrica nos produtos:
      //   - Produto SEM fábrica e usado neste pedido → fábrica vira a do pedido (principal)
      //   - Produto COM outra fábrica e usado neste pedido → adiciona como supplier (secundária)
      // Isso resolve o "deadlock" de produtos em desenvolvimento que precisam virar produtos reais.
      const productsToUpdate = []
      for (const it of (order.items || [])) {
        if (!it.product_id) continue
        const prod = products.find(p => p.id === it.product_id)
        if (!prod) continue
        
        if (!prod.factory) {
          productsToUpdate.push({ id: prod.id, action: 'set_factory', factory: order.factory })
        } else if (prod.factory !== order.factory) {
          const hasSupp = Array.isArray(prod.suppliers) && prod.suppliers.some(s => s?.factory === order.factory)
          if (!hasSupp) {
            productsToUpdate.push({ id: prod.id, action: 'add_supplier', factory: order.factory, currentSuppliers: prod.suppliers || [] })
          }
        }
      }
      
      const isNew = !order.id
      if (isNew) {
        const created = await createOrder({ ...order, created_by: user.id })
        writeLog({ userId: user.id, userName: user.name, action: 'criou pedido', target: order.order_name || order.factory, entityType: 'order', entityId: created.id })
        trackAction('create_order', { factory: order.factory, items_count: (order.items || []).length })
      } else {
        await updateOrder(order.id, order)
        writeLog({ userId: user.id, userName: user.name, action: 'editou pedido', target: order.order_name || order.factory, entityType: 'order', entityId: order.id })
        trackAction('update_order', { factory: order.factory })
      }
      
      // Aplicar updates de fábrica nos produtos (após o pedido salvar)
      if (productsToUpdate.length > 0) {
        const { updateProduct } = await import('../lib/data/products')
        for (const upd of productsToUpdate) {
          try {
            const prod = products.find(pp => pp.id === upd.id)
            const prodName = prod?.name || 'produto'
            if (upd.action === 'set_factory') {
              await updateProduct(upd.id, { factory: upd.factory })
              toast.push(`Fábrica do produto definida: ${upd.factory}`, { kind: 'success', duration: 4000 })
              // #1 Log estruturado
              writeLog({
                userId: user.id, userName: user.name,
                action: 'sistema definiu fábrica',
                target: prodName,
                details: `fábrica principal definida como ${upd.factory} (via pedido ${order.order_name || order.factory})`,
                entityType: 'product', entityId: upd.id,
              })
            } else if (upd.action === 'add_supplier') {
              const newSuppliers = [...upd.currentSuppliers, { factory: upd.factory, factory_code: null, price_usd: null }]
              await updateProduct(upd.id, { suppliers: newSuppliers })
              toast.push(`${upd.factory} adicionada como fornecedor secundário`, { kind: 'success', duration: 4000 })
              // #1 Log estruturado
              writeLog({
                userId: user.id, userName: user.name,
                action: 'sistema adicionou fornecedor',
                target: prodName,
                details: `${upd.factory} adicionada como fornecedor secundário (via pedido ${order.order_name || order.factory})`,
                entityType: 'product', entityId: upd.id,
              })
            }
          } catch (e) {
            log.warn('[KIRA] Falha ao atualizar fábrica do produto:', e)
          }
        }
      }
      
      setModal(null)
      await load(); onMutate?.()
      toast.push('Pedido salvo', { kind: 'success' })
      // v13.48 — retorno de sucesso: OrderCreator só fecha quando true
      return true
    } catch (e) { toastError(toast, e); return false }
  }

  const remove = async (o) => {
    const ok = await confirm({
      title: 'Mover pra Lixeira?',
      message: `"${o.order_name || o.factory}" vai pra lixeira e fica recuperável por 30 dias.`,
      details: 'Após 30 dias, o pedido (e seus comprovantes) é apagado permanentemente.',
      confirmLabel: '🗑 Mover pra Lixeira',
    })
    if (!ok) return
    try {
      // Soft delete: NÃO limpa comprovantes do Storage
      // (vai limpar só quando purge permanente acontecer ou usuário excluir definitivo)
      await deleteOrder(o.id)
      writeLog({ userId: user.id, userName: user.name, action: 'moveu pedido pra lixeira', target: o.order_name || o.factory, entityType: 'order', entityId: o.id })
      setDetail(null)
      // Recarrega tanto pedidos ativos quanto trash (caso usuário esteja vendo ela)
      await load()
      if (trashLoaded) await loadTrash()
      onMutate?.()
      // v13.39 — Undo pattern: toast com botão "Desfazer" por 8 segundos.
      // restoreOrder zera deleted_at — pedido volta pra lista ativa.
      toast.push('Pedido movido pra lixeira', {
        kind: 'success',
        duration: 8000,
        action: {
          label: '↩ Desfazer',
          onClick: async () => {
            try {
              await restoreOrder(o.id)
              writeLog({ userId: user.id, userName: user.name, action: 'restaurou pedido (undo)', target: o.order_name || o.factory, entityType: 'order', entityId: o.id })
              await load()
              if (trashLoaded) await loadTrash()
              onMutate?.()
              toast.push('Pedido restaurado', { kind: 'success', duration: 2500 })
            } catch (e) { toastError(toast, e) }
          },
        },
      })
    } catch (e) { toastError(toast, e) }
  }

  // v13.23 Duplica pedido — cria rascunho com items copiados (sem payments/timeline)
  const handleDuplicate = async (o) => {
    const defaultName = `${o.order_name || o.factory} (cópia)`
    const newName = prompt('Nome do novo pedido:', defaultName)
    if (newName === null) return  // cancelou
    const trimmed = newName.trim() || defaultName
    
    try {
      const created = await duplicateOrder(o, trimmed)
      writeLog({
        userId: user.id, userName: user.name,
        action: 'duplicou pedido',
        target: trimmed,
        details: `Origem: ${o.order_name || o.factory}`,
        entityType: 'order', entityId: created.id,
      })
      setDetail(null)
      await load()
      onMutate?.()
      // Abre o novo pedido em modo edição direto (UX: usuário acabou de duplicar, quer revisar)
      const newOrder = (await listOrders()).find(x => x.id === created.id)
      if (newOrder) setDetail(newOrder)
      toast.push(`✓ Pedido duplicado como "${trimmed}" (rascunho)`, { kind: 'success', duration: 5000 })
    } catch (e) { toastError(toast, e) }
  }

  // #18 Restaurar pedido da lixeira (volta pra lista ativa)
  const handleRestore = async (o) => {
    const ok = await confirm({
      title: 'Restaurar pedido?',
      message: `"${o.order_name || o.factory}" voltará pra lista de pedidos normais.`,
      confirmLabel: '↩ Restaurar',
    })
    if (!ok) return
    try {
      await restoreOrder(o.id)
      writeLog({
        userId: user.id, userName: user.name,
        action: 'restaurou pedido da lixeira',
        target: o.order_name || o.factory,
        entityType: 'order', entityId: o.id,
      })
      // Recarrega ambos
      await Promise.all([load(), loadTrash()])
      onMutate?.()
      toast.push('Pedido restaurado', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  // v13.22 Excluir definitivamente agora é SOFT (preserva tudo pra auditoria fiscal).
  // Não limpa Storage. Pedido some da UI mas continua no banco com purged_at setado.
  const handlePurge = async (o) => {
    const ok = await confirm({
      title: '⚠ Excluir definitivamente?',
      message: `"${o.order_name || o.factory}" será removido da lixeira e não aparecerá mais em nenhuma tela.`,
      details: 'Os dados continuam preservados no banco pra auditoria fiscal (não são apagados de verdade). Pra recuperar futuramente, é necessário acesso ao banco via SQL.',
      confirmLabel: 'Sim, excluir',
      danger: true,
    })
    if (!ok) return
    try {
      // NÃO limpa Storage — comprovantes ficam preservados
      await purgeOrderPermanently(o.id)
      writeLog({
        userId: user.id, userName: user.name,
        action: 'arquivou pedido (purge)',
        target: o.order_name || o.factory,
      })
      await loadTrash()
      onMutate?.()
      toast.push('Pedido arquivado (preservado pra auditoria)', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  // #FIX-1 Recalcular FOB com preços atuais do catálogo.
  // Só faz sentido em RASCUNHO — em outros status, o snapshot é a "verdade do contrato"
  // e mudar retroativamente quebra auditoria. Mostra preview antes de salvar.
  const handleRecalcFOB = async (o) => {
    if (o.status !== 'draft') {
      toast.push('Recálculo só é permitido em pedidos rascunho', { kind: 'warning' })
      return
    }
    
    // Calcula mudanças
    const changes = []  // [{ itemIdx, productName, oldPrice, newPrice, colorChanges: [...] }]
    const newItems = (o.items || []).map((it, idx) => {
      const prod = products.find(p => p.id === it.product_id)
      if (!prod) return it  // sem produto vinculado (manual), não mexe
      
      const oldItemPrice = parseFloat(it.price_usd_snapshot || it.price_usd || 0)
      const newItemPrice = parseFloat(prod.price_usd || 0)
      
      const colorChanges = []
      const newColors = (it.colors || []).map(c => {
        if (!c.code) return c
        const variant = (prod.color_variants || []).find(cv => cv.code === c.code)
        if (!variant) return c  // cor sumiu do catálogo, mantém snapshot
        const oldCPrice = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : oldItemPrice
        const newCPrice = variant.price_usd != null && variant.price_usd !== '' ? parseFloat(variant.price_usd) : newItemPrice
        if (newCPrice > 0 && Math.abs(newCPrice - oldCPrice) > 0.001) {
          colorChanges.push({ code: c.code, oldPrice: oldCPrice, newPrice: newCPrice })
          return { ...c, price_usd: variant.price_usd ? String(variant.price_usd) : null }
        }
        return c
      })
      
      const itemChanged = newItemPrice > 0 && Math.abs(newItemPrice - oldItemPrice) > 0.001
      if (itemChanged || colorChanges.length > 0) {
        changes.push({
          itemIdx: idx,
          productName: prod.name,
          oldPrice: oldItemPrice,
          newPrice: newItemPrice,
          itemChanged,
          colorChanges,
        })
      }
      
      return {
        ...it,
        price_usd_snapshot: newItemPrice > 0 ? String(newItemPrice) : it.price_usd_snapshot,
        price_usd: newItemPrice > 0 ? String(newItemPrice) : it.price_usd,
        colors: newColors,
      }
    })
    
    if (changes.length === 0) {
      toast.push('Tudo já está com preços atuais ✓', { kind: 'info' })
      return
    }
    
    // Preview
    const lines = changes.map(c => {
      const itemLine = c.itemChanged
        ? `• ${c.productName}: $ ${c.oldPrice.toFixed(2)} → $ ${c.newPrice.toFixed(2)}`
        : `• ${c.productName}:`
      const colorLines = c.colorChanges.map(cc => `   ${cc.code}: $ ${cc.oldPrice.toFixed(2)} → $ ${cc.newPrice.toFixed(2)}`)
      return [itemLine, ...colorLines].join('\n')
    }).join('\n\n')
    
    const ok = await confirm({
      title: '🔄 Recalcular FOB com preços atuais?',
      message: `${changes.length} item(s) com mudanças no catálogo:`,
      details: lines,
      confirmLabel: '✓ Aplicar mudanças',
      cancelLabel: 'Cancelar',
    })
    if (!ok) return
    
    try {
      await updateOrder(o.id, { items: newItems })
      writeLog({
        userId: user.id, userName: user.name,
        action: 'recalculou FOB do pedido',
        target: o.order_name || o.factory,
        details: `${changes.length} item(s) atualizados`,
        entityType: 'order', entityId: o.id,
      })
      // Atualiza estado local
      const refreshed = { ...o, items: newItems }
      setDetail(refreshed)
      await load()
      onMutate?.()
      toast.push('FOB recalculado ✓', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  // Mudança de status com diálogo de cores
  const changeStatus = async (o, newStatus, extraData = {}) => {
    const oldStatus = o.status
    if (oldStatus === newStatus) return
    
    // #3 Se está virando "Em Fabricação" pela primeira vez (sem promised_lead_days ainda),
    // abrir modal pra perguntar prazo prometido pelo fornecedor.
    // Se já tem promised_lead_days, ou se o usuário já passou pelo modal (extraData._promptShown), não pergunta.
    if (newStatus === 'manufacturing' && oldStatus !== 'manufacturing' && !o.promised_lead_days && !extraData._promptShown) {
      setLeadTimePrompt({ order: o, newStatus })
      return  // Para aqui — o fluxo continua quando user submete o modal
    }
    
    const labelNovo = ORDER_ST.find(s => s.id === newStatus)?.label
    const orderName = o.order_name || o.factory

    // Lista cores afetadas: [{ productId, productName, code }]
    // v13.34 — case-insensitive na comparação (corrige bug onde cor "1B" no pedido
    // não batia com "1b" cadastrado no produto e silenciosamente não virava production)
    const coresAfetadas = () => {
      const out = []
      for (const it of (o.items || [])) {
        if (!it.product_id) continue
        const prod = products.find(p => p.id === it.product_id)
        if (!prod) continue
        for (const c of (it.colors || [])) {
          if (c.code) {
            const codeNorm = (c.code || '').toString().toUpperCase().trim()
            const existingVariant = (prod.color_variants || []).find(
              cv => (cv.code || '').toString().toUpperCase().trim() === codeNorm
            )
            out.push({
              productId: prod.id,
              productName: UC(prod.name),
              code: codeNorm,  // sempre normalizado
              existingStatus: existingVariant?.status || null,
              exists: !!existingVariant,
            })
          }
        }
      }
      return out
    }

    const avancando = newStatus === 'manufacturing' || newStatus === 'completed'
    const revertendo = (oldStatus === 'completed' && newStatus !== 'completed') || (oldStatus === 'manufacturing' && (newStatus === 'sent' || newStatus === 'draft'))

    const cores = coresAfetadas()
    
    // #7 Pergunta antes de adicionar cores NOVAS (não cadastradas) ao catálogo do produto
    // ao concluir o pedido. Cores que JÁ existem só mudam de status (não pergunta).
    let addNewColorsToCatalog = true
    if (newStatus === 'completed') {
      const newColors = cores.filter(c => !c.exists)
      if (newColors.length > 0) {
        // Agrupa por produto pra mensagem mais clara
        const byProd = {}
        for (const c of newColors) {
          if (!byProd[c.productName]) byProd[c.productName] = []
          byProd[c.productName].push(c.code)
        }
        const lines = Object.entries(byProd).map(([prod, codes]) =>
          `• ${prod}: ${codes.join(', ')}`
        ).join('\n')
        
        addNewColorsToCatalog = await confirm({
          title: '🎨 Adicionar cores novas ao catálogo?',
          message: `Este pedido tem ${newColors.length} cor(es) nova(s) que ainda não estão no catálogo do(s) produto(s):`,
          details: lines + '\n\nQuer que o sistema adicione essas cores ao catálogo?',
          confirmLabel: '✓ Sim, adicionar',
          cancelLabel: 'Não, manter como está',
        })
        // Se cancelar, marcamos pra não adicionar (mas o pedido continua sendo concluído normalmente)
      }
    }
    
    // #B Coleta resumo do que aconteceu pra mostrar modal pós-conclusão
    const summary = {
      orderName,
      newStatus,
      labelNovo,
      coloresUpdated: [],   // [{ produto, cores: [], to: 'production'|'catalog' }]
      coloresAdded: [],     // [{ produto, cores: [] }]
      coloresReverted: [],  // [{ produto, cores: [], from: 'catalog'|'production', to: 'production'|'idea' }]
    }

    try {
      // #3 Quando vai pra "Em Fabricação", grava prazo prometido + data de início.
      // Esses dados ficam fixos no pedido e são usados pra calcular "atrasado".
      const updateExtras = {}
      if (newStatus === 'manufacturing' && extraData.promised_lead_days) {
        updateExtras.promised_lead_days = parseInt(extraData.promised_lead_days, 10) || null
        updateExtras.manufacturing_started_at = new Date().toISOString()
      }
      await updateOrderStatus(o.id, newStatus, { ...updateExtras, _user_name: user?.name || null })
      trackAction('change_order_status', { from: o.status, to: newStatus, factory: o.factory })

      if (avancando && cores.length > 0) {
        const colorTarget = newStatus === 'manufacturing' ? 'production' : 'catalog'
        const colorLabel = newStatus === 'manufacturing' ? 'Em Produção' : 'Em Catálogo'
        
        let updated = 0
        let added = 0
        
        const byProduct = new Map()
        for (const c of cores) {
          if (!byProduct.has(c.productId)) byProduct.set(c.productId, [])
          byProduct.get(c.productId).push(c)
        }
        
        const { updateProduct } = await import('../lib/data/products')
        
        for (const [pid, colorList] of byProduct) {
          const prod = products.find(p => p.id === pid)
          if (!prod) continue
          
          const toUpdate = colorList
            .filter(c => c.exists && c.existingStatus !== 'discontinued')
            .map(c => c.code)
          if (toUpdate.length > 0) {
            await bulkUpdateColorStatus(pid, toUpdate, colorTarget)
            updated += toUpdate.length
            summary.coloresUpdated.push({ produto: prod.name, cores: toUpdate, to: colorLabel })
            writeLog({
              userId: user.id, userName: user.name,
              action: 'sistema atualizou cores',
              target: prod.name,
              details: `${toUpdate.length} cor(es) → "${colorLabel}" (via pedido ${orderName})`,
              entityType: 'product', entityId: pid,
            })
          }
          
          // v13.34 — Cores NOVAS (não cadastradas no produto) também são criadas
          // ao avançar pra manufacturing/completed (antes só funcionava se completed
          // E addNewColorsToCatalog=true; cor digitada manualmente ficava perdida).
          // Comportamento:
          //   - manufacturing: cria com status='production' (já vai pra produção)
          //   - completed (auto, sem perguntar): cria com status='catalog'
          // Pra completed, mantém também o comportamento antigo (pergunta + adiciona).
          const toAddInferred = colorList.filter(c => !c.exists)
          if (toAddInferred.length > 0) {
            const shouldAutoAdd = newStatus === 'manufacturing'
              || (newStatus === 'completed' && addNewColorsToCatalog)
            if (shouldAutoAdd) {
              const existing = prod.color_variants || []
              const targetStatus = newStatus === 'manufacturing' ? 'production' : 'catalog'
              const newVariants = [
                ...existing,
                ...toAddInferred.map(c => ({ code: c.code, status: targetStatus, sku: null })),
              ]
              await updateProduct(pid, { color_variants: newVariants })
              added += toAddInferred.length
              summary.coloresAdded.push({ produto: prod.name, cores: toAddInferred.map(c => c.code) })
              writeLog({
                userId: user.id, userName: user.name,
                action: 'sistema adicionou cores',
                target: prod.name,
                details: `cor(es) ${toAddInferred.map(c => c.code).join(', ')} criada(s) com status "${targetStatus}" (via pedido ${orderName})`,
                entityType: 'product', entityId: pid,
              })
            }
          }
          
          // (bloco antigo de addNewColorsToCatalog removido — agora unificado acima)
        }
        
        if (updated > 0 || added > 0) {
          const msg = []
          if (updated > 0) msg.push(`${updated} cor(es) atualizada(s) para "${colorLabel}"`)
          if (added > 0) msg.push(`${added} cor(es) novas adicionada(s) ao catálogo`)
          toast.push(msg.join(' · '), { kind: 'success', duration: 5000 })
        }
      } else if (revertendo && cores.length > 0) {
        const colorRev = oldStatus === 'completed' ? 'production' : 'idea'
        const colorRevLabel = oldStatus === 'completed' ? 'Em Produção' : 'Ideia'
        const colorFrom = oldStatus === 'completed' ? 'catalog' : 'production'
        const colorFromLabel = oldStatus === 'completed' ? 'Catálogo' : 'Em Produção'
        
        const byProduct = new Map()
        for (const c of cores) {
          if (!byProduct.has(c.productId)) byProduct.set(c.productId, [])
          byProduct.get(c.productId).push(c)
        }
        
        let reverted = 0
        for (const [pid, colorList] of byProduct) {
          const prod = products.find(p => p.id === pid)
          const toRevert = colorList
            .filter(c => c.exists && c.existingStatus === colorFrom)
            .map(c => c.code)
          if (toRevert.length > 0) {
            await bulkUpdateColorStatus(pid, toRevert, colorRev)
            reverted += toRevert.length
            if (prod) summary.coloresReverted.push({ produto: prod.name, cores: toRevert, from: colorFromLabel, to: colorRevLabel })
          }
        }
        if (reverted > 0) {
          toast.push(`${reverted} cor(es) revertida(s) de status`, { kind: 'success', duration: 4000 })
        }
      }

      writeLog({ userId: user.id, userName: user.name, action: 'alterou pedido', target: orderName, details: `Status → ${labelNovo}`, entityType: 'order', entityId: o.id })
      await load(); onMutate?.()
      if (detail?.id === o.id) setDetail(d => ({ ...d, status: newStatus, ...updateExtras }))
      
      // #B Dispara modal pós-conclusão SE virou "Concluído" e teve mudanças
      if (newStatus === 'completed' && (summary.coloresUpdated.length > 0 || summary.coloresAdded.length > 0)) {
        setCompletionSummary({ ...summary, orderId: o.id })
      } else {
        toast.push(`Pedido: ${labelNovo}`, { kind: 'success' })
      }
    } catch (e) { toastError(toast, e) }
  }

  if (loading) return <SkeletonList rows={5} />

  return <div>
    <div className="toolbar">
      <div className="chip-bar" style={{ margin: 0, flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <button className={`chip-filter${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>Todos ({orders.length})</button>
        {ORDER_ST.map(s => <button key={s.id} className={`chip-filter${filter === s.id ? ' on' : ''}`} onClick={() => setFilter(s.id)}>{s.icon} {s.label}</button>)}
        {/* Separador visual antes da Lixeira (estilo Gmail Inbox/Lixeira) */}
        <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} aria-hidden />
        <button
          className={`chip-filter${filter === 'trash' ? ' on' : ''}`}
          onClick={() => setFilter('trash')}
          title="Pedidos movidos pra lixeira (recuperáveis por 30 dias)"
        >
          🗑️ Lixeira{trashLoaded ? ` (${trashOrders.length})` : ''}
        </button>
        <ClearFiltersButton
          visible={filter !== 'all'}
          onClear={() => clearStickyFilters('orders')}
        />
      </div>
      {!isViewingTrash && <button className="btn btn-primary" onClick={() => setCreator(true)}>+ Novo Pedido</button>}
    </div>

    {/* Banner informativo quando vendo lixeira */}
    {isViewingTrash && (
      <div style={{
        padding: '10px 14px', marginBottom: 12,
        background: '#FEF3C7', border: '1px solid #FCD34D',
        borderRadius: 8, fontSize: 13, color: '#92400E',
      }}>
        🗑️ <strong>Lixeira:</strong> pedidos aqui são apagados automaticamente após 30 dias. Clique pra restaurar ou excluir definitivamente.
      </div>
    )}

    {filtered.length === 0 ? (
      isViewingTrash ? (
        <div className="empty-state">
          <div className="empty-icon">🗑️</div>
          <p>Lixeira vazia.</p>
          <p className="text-muted text-sm">Pedidos excluídos aparecem aqui e podem ser restaurados em até 30 dias.</p>
        </div>
      ) : (
        <div className="empty-state"><div className="empty-icon">📋</div><p>Nenhum pedido.</p></div>
      )
    )
    : isViewingTrash ? (
      // Render especial pra cards de pedidos da lixeira (com restore/purge)
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(o => {
          const st = ORDER_ST.find(s => s.id === o.status)
          const totalQty = (o.items || []).reduce((a, it) => {
            const cls = it.colors || []
            return a + cls.reduce((b, c) => b + Number(c.qty || 0), 0)
          }, 0)
          const elapsedSinceDelete = o.deleted_at ? Math.floor((new Date() - new Date(o.deleted_at)) / 86400000) : 0
          const remaining = 30 - elapsedSinceDelete
          const isCloseToPurge = remaining <= 7
          
          return (
            <div key={o.id} style={{
              padding: 14,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderLeft: isCloseToPurge ? '4px solid #DC2626' : '4px solid #9CA3AF',
              borderRadius: 8,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{o.order_name || o.factory}</div>
                  <div className="text-muted text-sm">
                    {o.factory} · criado {formatDate(o.created_at, 'full')}
                    {totalQty > 0 && ` · ${totalQty} pç(s)`}
                  </div>
                </div>
                {st && <span className="chip" style={{ background: st.color + '20', color: st.color, whiteSpace: 'nowrap' }}>{st.icon} {st.label}</span>}
              </div>
              
              <div style={{ fontSize: 12, marginBottom: 10 }}>
                <span style={{ color: '#6B7280' }}>Movido pra lixeira:</span>{' '}
                <strong>{formatDate(o.deleted_at, 'with-time')}</strong>
                <span style={{ marginLeft: 8, color: isCloseToPurge ? '#DC2626' : '#6B7280', fontWeight: isCloseToPurge ? 600 : 400 }}>
                  · {remaining > 0 ? `${remaining} dia(s) até exclusão automática` : 'será excluído em breve'}
                </span>
              </div>
              
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={() => handleRestore(o)}>
                  ↩ Restaurar
                </button>
                <button
                  className="btn-icon text-danger"
                  onClick={() => handlePurge(o)}
                  style={{ marginLeft: 'auto' }}
                >
                  🗑 Excluir definitivamente
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
    : <div className="grid-2">{filtered.map(o => {
      const st = ORDER_ST.find(s => s.id === o.status)
      const totalQty = (o.items || []).reduce((a, it) => {
        const cls = it.colors || []
        return a + cls.reduce((b, c) => b + Number(c.qty || 0), 0) + (cls.length === 0 ? Number(it.quantity || 0) : 0)
      }, 0)
      // #3 Calcula atraso pra mostrar badge no card
      const delay = computeOrderDelay(o, leadTimeByFactory)
      return (
        <div key={o.id} className="card card-hover" onClick={() => setDetail(o)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="card-title" style={{ margin: 0 }}>{o.order_name || o.factory}</div>
              <div className="text-muted text-sm" title={o.order_date ? `Registrado no sistema em: ${formatDate(o.created_at, 'full')}` : undefined}>
                {o.factory} · {formatDate(o.order_date || o.created_at, 'full')}{o.order_date ? ' 📅' : ''} · {totalQty} peças
                {o.expected_arrival && ` · chegada ${formatDate(o.expected_arrival, 'full')}`}
              </div>
              {/* #3 Indicador de prazo/atraso pra pedidos em fabricação */}
              {delay && delay.deadlineDays != null && (
                <div style={{
                  marginTop: 6, fontSize: 11, fontWeight: 600,
                  color: delay.isLate ? '#DC2626' : (delay.daysElapsed > delay.deadlineDays * 0.8 ? '#D97706' : '#059669'),
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}>
                  {delay.isLate
                    ? <>⚠️ Atrasado {delay.daysLate} dia{delay.daysLate !== 1 ? 's' : ''}</>
                    : <>⏱️ {delay.daysElapsed}/{delay.deadlineDays} dias</>}
                  {delay.source === 'avg_with_tolerance' && (
                    <span className="text-muted" style={{ fontWeight: 400, fontSize: 10 }}>(estimado)</span>
                  )}
                </div>
              )}
            </div>
            <span className="chip" style={{ background: st?.color + '20', color: st?.color, whiteSpace: 'nowrap' }}>{st?.icon} {st?.label}</span>
          </div>
        </div>
      )
    })}</div>}

    {creator && (
      <OrderCreator
        factories={factories}
        products={products}
        ideas={ideas}
        colors={colors}
        orders={orders}
        perm={perm}
        rate={rate}
        leadTimeByFactory={leadTimeByFactory}
        onSave={save}
        onClose={() => setCreator(false)}
      />
    )}
    {modal && (
      <OrderModal
        order={modal === 'new' ? null : modal}
        factories={factories}
        products={products}
        ideas={ideas}
        colors={colors}
        perm={perm}
        leadTimeByFactory={leadTimeByFactory}
        onSave={save}
        onClose={() => setModal(null)}
      />
    )}
    {detail && (
      <OrderDetail
        order={detail}
        products={products}
        colors={colors}
        perm={perm}
        rate={rate}
        user={user}
        onClose={() => setDetail(null)}
        onEdit={() => { setModal(detail); setDetail(null) }}
        onDelete={() => remove(detail)}
        onStatus={s => changeStatus(detail, s)}
        onRefresh={load}
        onRecalcFOB={() => handleRecalcFOB(detail)}
        onDuplicate={() => handleDuplicate(detail)}
      />
    )}
    {completionSummary && (
      <CompletionSummaryModal
        summary={completionSummary}
        onClose={() => setCompletionSummary(null)}
        onViewOrder={() => {
          const ord = orders.find(o => o.id === completionSummary.orderId)
          if (ord) setDetail(ord)
          setCompletionSummary(null)
        }}
      />
    )}
    {leadTimePrompt && (
      <LeadTimePromptModal
        order={leadTimePrompt.order}
        suggestedDays={leadTimeByFactory.get(leadTimePrompt.order.factory)?.avgDays}
        onClose={() => {
          // Cancelar (Esc / X / overlay) = mudança de status NÃO acontece
          // Avisa o usuário pra ele não pensar que mudou.
          setLeadTimePrompt(null)
          toast.push('Mudança de status cancelada — pedido continua em ' + (ORDER_ST.find(s => s.id === leadTimePrompt.order.status)?.label || leadTimePrompt.order.status), { kind: 'info', duration: 4000 })
        }}
        onConfirm={async (days) => {
          const { order, newStatus } = leadTimePrompt
          setLeadTimePrompt(null)
          await changeStatus(order, newStatus, { promised_lead_days: days, _promptShown: true })
        }}
        onSkip={async () => {
          const { order, newStatus } = leadTimePrompt
          setLeadTimePrompt(null)
          await changeStatus(order, newStatus, { _promptShown: true })
        }}
      />
    )}
  </div>
}


// OrderModal extraído pra src/components/orders/OrderModal.jsx (v13.36)

// OrderDetail extraído pra src/components/orders/OrderDetail.jsx (v13.36)

// PayRow extraído pra src/components/orders/PayRow.jsx (v13.36)

// CompletionSummaryModal extraído pra src/components/orders/CompletionSummaryModal.jsx (v13.36)

// LeadTimePromptModal extraído pra src/components/orders/LeadTimePromptModal.jsx (v13.36)
