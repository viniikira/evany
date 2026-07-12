// src/lib/pendencias.js
// Sistema de awareness: calcula pendências automáticas a partir do estado atual.
// Não tem feature nova — só agrega dados existentes em "coisas pra fazer".

const DAYS = (a, b = new Date()) => Math.floor((b - new Date(a)) / 86400000)

/**
 * Calcula pendências do sistema a partir das coleções carregadas.
 * @param {object} ctx - { products, orders, ideas, payments }
 * @returns {Array} pendências ordenadas por prioridade
 */
export function computePendencias({ products = [], orders = [], ideas = [] }) {
  const out = []
  
  // 1. Pedidos em "Em Fabricação" — usa prazo manual (promised_lead_days) se disponível,
  // senão cai pra média histórica + tolerância de 15 dias (computeOrderDelay).
  // Pedido "atrasado" = ultrapassou o prazo. Quanto mais atrasado, maior a prioridade.
  const factoryLeadTime = computeFactoryLeadTime(orders)
  for (const o of orders) {
    if (o.status !== 'manufacturing') continue
    const delay = computeOrderDelay(o, factoryLeadTime)
    if (!delay || !delay.isLate) continue
    
    const ehPromessaManual = delay.source === 'promised'
    const labelPrazo = ehPromessaManual
      ? `prazo prometido era ${delay.deadlineDays} dia(s)`
      : `média da fábrica é ${delay.deadlineDays - 15} dia(s) (+15 de tolerância)`
    
    if (delay.daysLate >= 30 || (ehPromessaManual && delay.daysLate >= 15)) {
      // Atraso crítico: 30+ dias atrasado, ou 15+ se foi prazo manual
      out.push({
        id: `order-late-${o.id}`,
        priority: 1,
        kind: 'order_late',
        icon: '🚨',
        title: `Pedido ${o.order_name || o.factory} atrasado ${delay.daysLate} dia(s)`,
        description: `${labelPrazo}. Cobre status urgente com ${o.factory}.`,
        target: { type: 'order', id: o.id },
      })
    } else {
      out.push({
        id: `order-late-${o.id}`,
        priority: 2,
        kind: 'order_late',
        icon: '⏰',
        title: `Pedido ${o.order_name || o.factory} atrasado ${delay.daysLate} dia(s)`,
        description: `${labelPrazo}. Considere acompanhar com ${o.factory}.`,
        target: { type: 'order', id: o.id },
      })
    }
  }
  
  // 2. Ideias paradas há muito tempo
  for (const i of ideas) {
    if (i.status === 'discarded') continue
    const daysSince = DAYS(i.updated_at || i.created_at)
    if (daysSince >= 90) {
      out.push({
        id: `idea-old-${i.id}`,
        priority: 3,  // baixa
        kind: 'idea_old',
        icon: '💡',
        title: `Ideia "${i.name}" parada há ${daysSince} dias`,
        description: `Promova para produto ou descarte para limpar a lista.`,
        target: { type: 'idea', id: i.id },
      })
    }
  }
  
  // 3. Produtos rascunho (developing) sem atividade
  for (const p of products) {
    if (p.status !== 'developing') continue
    const daysSince = DAYS(p.updated_at || p.created_at)
    if (daysSince >= 60) {
      // Verifica se tem pedido recente
      const hasRecentOrder = orders.some(o =>
        (o.items || []).some(it => it.product_id === p.id) &&
        DAYS(o.created_at) < 60
      )
      if (!hasRecentOrder) {
        out.push({
          id: `product-stale-${p.id}`,
          priority: 3,
          kind: 'product_stale',
          icon: '🔬',
          title: `Produto "${p.name}" em desenvolvimento há ${daysSince} dias sem pedido`,
          description: `Considere encomendar ou marcar como descontinuado.`,
          target: { type: 'product', id: p.id },
        })
      }
    }
  }
  
  // 4. Pagamentos sem comprovante (em pedidos em fabricação ou concluídos)
  for (const o of orders) {
    if (o.status !== 'manufacturing' && o.status !== 'completed') continue
    const sem = (o.payments || []).filter(p => !p.receipt_url && p.amount_usd)
    if (sem.length > 0) {
      out.push({
        id: `payment-noreceipt-${o.id}`,
        priority: 2,
        kind: 'payment_noreceipt',
        icon: '📎',
        title: `${sem.length} pagamento(s) sem comprovante em "${o.order_name || o.factory}"`,
        description: `Anexe os comprovantes para auditoria.`,
        target: { type: 'order', id: o.id },
      })
    }
  }
  
  // #FIX-2 Pagamentos sem data preenchida — crítico pra auditoria fiscal
  for (const o of orders) {
    const semData = (o.payments || []).filter(p => p.amount_usd && !p.payment_date)
    if (semData.length > 0) {
      out.push({
        id: `payment-nodate-${o.id}`,
        priority: 1,  // alta — afeta auditoria tributária
        kind: 'payment_nodate',
        icon: '📅',
        title: `${semData.length} pagamento(s) sem data em "${o.order_name || o.factory}"`,
        description: `Preencha a data real do banco/Wise. Crítico pra auditoria fiscal.`,
        target: { type: 'order', id: o.id },
      })
    }
  }
  
  // 4b. Pedido CONCLUÍDO mas pagamento incompleto — alta prioridade
  // (recebi a mercadoria mas ainda devo dinheiro pra fábrica)
  for (const o of orders) {
    if (o.status !== 'completed') continue
    
    const fobTotal = (o.items || []).reduce((sum, it) => {
      const cls = it.colors || []
      const itemPrice = parseFloat(it.price_usd_snapshot || it.price_usd || 0)
      const fromColors = cls.reduce((b, c) => {
        const qty = Number(c.qty || 0)
        const cprice = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : itemPrice
        return b + qty * (cprice || 0)
      }, 0)
      return sum + fromColors + (cls.length === 0 ? itemPrice * Number(it.quantity || 0) : 0)
    }, 0)
    
    if (fobTotal <= 0) continue
    
    const paidUsd = (o.payments || []).reduce((a, p) => a + (parseFloat(p.amount_usd) || 0), 0)
    const remaining = fobTotal - paidUsd
    if (remaining > 0.01) {
      const percentPaid = (paidUsd / fobTotal) * 100
      out.push({
        id: `order-completed-unpaid-${o.id}`,
        priority: 1,  // urgente
        kind: 'order_completed_unpaid',
        icon: '💸',
        title: `Pedido "${o.order_name || o.factory}" concluído com pagamento incompleto`,
        description: `Pago apenas ${percentPaid.toFixed(0)}% ($ ${paidUsd.toFixed(2)} de $ ${fobTotal.toFixed(2)}). Restam $ ${remaining.toFixed(2)} pra pagar.`,
        target: { type: 'order', id: o.id },
      })
    }
  }
  
  // 5. Produto sem foto principal mas com galeria
  for (const p of products) {
    if (p.status === 'discontinued') continue
    if (!p.card_image_url && (p.photos || []).length > 0) {
      out.push({
        id: `product-noprimary-${p.id}`,
        priority: 3,
        kind: 'product_noprimary',
        icon: '📷',
        title: `"${p.name}" sem foto principal`,
        description: `Tem ${p.photos.length} fotos na galeria. Defina uma como principal.`,
        target: { type: 'product', id: p.id },
      })
    }
  }
  
  // 6. Produto em catálogo sem cores (inconsistência)
  for (const p of products) {
    if (p.status !== 'catalog') continue
    if ((p.color_variants || []).length === 0) {
      out.push({
        id: `product-nocolors-${p.id}`,
        priority: 2,
        kind: 'product_nocolors',
        icon: '🎨',
        title: `Produto "${p.name}" em catálogo sem cores cadastradas`,
        description: `Catálogo sem cores não vai aparecer corretamente em pedidos novos.`,
        target: { type: 'product', id: p.id },
      })
    }
  }
  
  // Ordena por prioridade (1 alta, 3 baixa) e por título
  return out.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title))
}

/**
 * Calcula prazo médio em dias por fábrica baseado nos pedidos concluídos.
 * Usa: data de criação → data de conclusão (updated_at do pedido em status completed).
 * @param {Array} orders 
 * @returns {Map<string, {avgDays, sampleSize}>}
 */
export function computeFactoryLeadTime(orders = []) {
  const byFactory = new Map()
  for (const o of orders) {
    if (o.status !== 'completed') continue
    if (!o.factory || !o.created_at || !o.updated_at) continue
    const days = Math.floor((new Date(o.updated_at) - new Date(o.created_at)) / 86400000)
    if (days <= 0 || days > 365) continue  // Filtra outliers (pedido criado e concluído no mesmo dia ou >1 ano)
    if (!byFactory.has(o.factory)) byFactory.set(o.factory, [])
    byFactory.get(o.factory).push(days)
  }
  
  const result = new Map()
  for (const [factory, daysList] of byFactory) {
    const avg = Math.round(daysList.reduce((a, d) => a + d, 0) / daysList.length)
    result.set(factory, { avgDays: avg, sampleSize: daysList.length })
  }
  return result
}

/**
 * Calcula informação de atraso pra um pedido em "manufacturing".
 * Prefere prazo prometido (manual). Se não tem, usa média da fábrica como fallback.
 *
 * v13.41 — Nova lógica de "início" (ordem de preferência):
 *   1. order_date (data real do pedido, preenchida manualmente, pode ser retroativa)
 *   2. manufacturing_started_at (setado automaticamente quando vira manufacturing)
 *   3. Pedido legado sem nenhum dos dois → não calcula (retorna legacy_no_start_date)
 *
 * Motivo: quando usuário cria pedido retroativo com order_date antigo, queremos
 * contar dias desde aí (e não desde a data de inserção no sistema).
 *
 * @param {object} order - pedido com status, manufacturing_started_at, order_date, promised_lead_days
 * @param {Map} leadTimeByFactory - resultado de computeFactoryLeadTime (fallback)
 * @returns {object|null} { daysElapsed, deadlineDays, isLate, daysLate, source }
 */
export function computeOrderDelay(order, leadTimeByFactory = new Map()) {
  if (!order || order.status !== 'manufacturing') return null
  
  // v13.41 — Prefere order_date (data real); fallback pra manufacturing_started_at
  const startSource = order.order_date || order.manufacturing_started_at
  
  // Pedido legado (sem nenhuma data de início) → não calcula.
  // updated_at não é confiável porque muda em qualquer edição do pedido.
  if (!startSource) {
    return { daysElapsed: 0, deadlineDays: null, isLate: false, daysLate: 0, source: 'legacy_no_start_date' }
  }
  
  const now = new Date()
  const start = new Date(startSource)
  if (isNaN(start.getTime())) return null  // data corrompida
  
  const daysElapsed = Math.floor((now - start) / 86400000)
  if (daysElapsed < 0) return null  // pedido futuro? proteção
  
  // Determina prazo: prefere promised_lead_days (manual), fallback pra média da fábrica
  let deadlineDays = order.promised_lead_days || null
  let source = 'promised'
  
  if (!deadlineDays) {
    const avg = leadTimeByFactory.get(order.factory)
    if (avg && avg.avgDays) {
      deadlineDays = avg.avgDays + 15  // tolerância de 15 dias quando usa média
      source = 'avg_with_tolerance'
    } else {
      return { daysElapsed, deadlineDays: null, isLate: false, daysLate: 0, source: 'no_data' }
    }
  }
  
  const isLate = daysElapsed > deadlineDays
  const daysLate = isLate ? daysElapsed - deadlineDays : 0
  
  return { daysElapsed, deadlineDays, isLate, daysLate, source }
}
