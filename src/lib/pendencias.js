import { parseDateLocal } from './utils'
import { computeOrderBalance } from './financial'

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
      // v13.74 — pedido ATIVO também conta: ANA MARIA/CICERA/VÂNIA/VIRGINIA
      // estavam em fabricação e o sino dizia "sem pedido" (o pedido tinha
      // sido digitado há mais de 60 dias)
      const hasRecentOrder = orders.some(o =>
        !o.deleted_at &&
        (o.items || []).some(it => it.product_id === p.id) &&
        (['sent', 'manufacturing', 'in_transit'].includes(o.status) || DAYS(o.created_at) < 60)
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
  // v13.74 — usa computeOrderBalance: antes media contra o FOB (a dívida real
  // é o valor final da trading) e ignorava "Marcar como pago" — o Outubro 2025,
  // quitado à mão, aparecia como "pago apenas 0%".
  for (const o of orders) {
    if (o.status !== 'completed' || o.deleted_at) continue
    const bal = computeOrderBalance(o)
    if (bal.isSettled || !(bal.total > 0) || bal.remainingUsd <= 0.01) continue
    out.push({
      id: `order-completed-unpaid-${o.id}`,
      priority: 1,  // urgente
      kind: 'order_completed_unpaid',
      icon: '💸',
      title: `Pedido "${o.order_name || o.factory}" concluído com pagamento incompleto`,
      description: `Pago ${bal.percentPaid.toFixed(0)}% ($ ${bal.paidUsd.toFixed(2)} de $ ${bal.total.toFixed(2)}${bal.isFullyConfirmed ? '' : ', parte estimada'}). Faltam $ ${bal.remainingUsd.toFixed(2)} — ou marque como pago se já quitou fora do sistema.`,
      target: { type: 'order', id: o.id },
    })
  }

  // v13.74 — PEDIDOS QUE O SISTEMA NÃO CONSEGUIA VER COMO PROBLEMA
  const todayMs = new Date(new Date().toDateString()).getTime()
  for (const o of orders) {
    if (o.deleted_at) continue
    const name = o.order_name || o.factory

    // Em trânsito com a chegada prevista vencida (NOVEMBRO 2025: 121 dias)
    if (o.status === 'in_transit' && o.expected_arrival) {
      const t = parseDateLocal(o.expected_arrival)?.getTime()
      if (t != null && t < todayMs) {
        const d = Math.floor((todayMs - t) / 86400000)
        out.push({
          id: `transit-overdue-${o.id}`,
          priority: d >= 30 ? 1 : 2,
          kind: 'transit_overdue',
          icon: '🚢',
          title: `"${name}": chegada prevista passou há ${d} dia(s)`,
          description: `Já chegou? Marque como concluído. Se não, atualize a previsão de chegada.`,
          target: { type: 'order', id: o.id },
        })
      }
    }

    // Em revisão há muito tempo (a fábrica/trading não devolveu?)
    if (o.status === 'sent') {
      const sentAt = [...(o.status_history || [])].reverse().find(h => h?.status === 'sent')?.at || o.created_at
      const d = sentAt ? DAYS(sentAt) : 0
      if (d >= 30) {
        out.push({
          id: `sent-stale-${o.id}`,
          priority: 2,
          kind: 'sent_stale',
          icon: '🔍',
          title: `"${name}" em revisão há ${d} dias`,
          description: `Cobre a revisão com ${o.factory} — ou avance o status se ele já está em fabricação.`,
          target: { type: 'order', id: o.id },
        })
      }
    }

    // Em fabricação sem data de início: o atraso nunca é calculado
    if (o.status === 'manufacturing' && !o.order_date && !o.manufacturing_started_at) {
      out.push({
        id: `mfg-nostart-${o.id}`,
        priority: 2,
        kind: 'mfg_no_start',
        icon: '📅',
        title: `"${name}" em fabricação sem data do pedido`,
        description: `Sem data de início o sistema não consegue avisar atraso. Preencha a data do pedido.`,
        target: { type: 'order', id: o.id },
      })
    }

    // Peças sem preço nenhum: o total do pedido fica menor do que é
    if (o.status !== 'draft' && !o.settled_at) {
      const bal = computeOrderBalance(o)
      if (bal.unpricedQty > 0) {
        out.push({
          id: `unpriced-${o.id}`,
          priority: 2,
          kind: 'order_unpriced',
          icon: '🏷️',
          title: `"${name}": ${bal.unpricedQty} peça(s) sem preço`,
          description: `Sem FOB nem valor final, elas entram como $0 — o total e o "falta pagar" estão menores do que são.`,
          target: { type: 'order', id: o.id },
        })
      }
    }

    // Pagamento lançado totalmente vazio (sem valor e sem data)
    const empty = (o.payments || []).filter(p => !p.amount_usd && !p.amount_brl && !p.payment_date)
    if (empty.length > 0) {
      out.push({
        id: `payment-empty-${o.id}`,
        priority: 3,
        kind: 'payment_empty',
        icon: '🧾',
        title: `${empty.length} pagamento(s) vazio(s) em "${name}"`,
        description: `Sem valor e sem data — apague ou preencha.`,
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
 * Prazo médio de FABRICAÇÃO por fábrica, dos pedidos que já saíram da fábrica.
 *
 * v13.74 — antes usava created_at → updated_at: created_at é quando o pedido
 * foi DIGITADO (pedidos antigos foram cadastrados de uma vez em abril/2026) e
 * updated_at muda em qualquer edição. Resultado real: "HAIRCHUAN ~2 dias"
 * (MAIO 2025 digitado e concluído em 2 dias) e "EPF ~100 dias" (dias entre
 * cadastrar e marcar como pago). Esse número aparecia no criador de pedido e
 * era sugerido como prazo prometido.
 *
 * Agora: início = order_date (ou manufacturing_started_at) → fim = primeira vez
 * que o pedido saiu da fábrica no histórico (em trânsito ou concluído). Sem
 * uma das duas pontas, o pedido não entra na média.
 * @param {Array} orders
 * @returns {Map<string, {avgDays, sampleSize}>}
 */
export function computeFactoryLeadTime(orders = []) {
  const byFactory = new Map()
  for (const o of orders) {
    if (!o || o.deleted_at || !o.factory) continue
    if (o.status !== 'in_transit' && o.status !== 'completed') continue
    const start = parseDateLocal(o.order_date || o.manufacturing_started_at)
    if (!start) continue
    const left = (o.status_history || [])
      .filter(h => h && (h.status === 'in_transit' || h.status === 'completed') && h.at)
      .map(h => new Date(h.at).getTime())
      .filter(t => !isNaN(t))
      .sort((a, b) => a - b)[0]
    if (left == null) continue
    const days = Math.floor((left - start.getTime()) / 86400000)
    if (days <= 0 || days > 365) continue  // outliers / datas inconsistentes
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
// `now` é opcional: quem precisa de resultado reprodutível (testes, ordenação
// com um "agora" fixo) passa o seu; o padrão continua sendo o relógio real.
export function computeOrderDelay(order, leadTimeByFactory = new Map(), now = Date.now()) {
  if (!order || order.status !== 'manufacturing') return null
  
  // v13.41 — Prefere order_date (data real); fallback pra manufacturing_started_at
  const startSource = order.order_date || order.manufacturing_started_at
  
  // Pedido legado (sem nenhuma data de início) → não calcula.
  // updated_at não é confiável porque muda em qualquer edição do pedido.
  if (!startSource) {
    return { daysElapsed: 0, deadlineDays: null, isLate: false, daysLate: 0, source: 'legacy_no_start_date' }
  }
  
  const start = parseDateLocal(startSource)
  if (!start) return null  // data corrompida
  
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
