// src/lib/dashboardInsights.js
// Detecta "atenções urgentes" pra exibir no Dashboard.
// Tudo client-side com dados já em memória.
//
// Cada atenção tem formato:
//   { id, type, severity, title, description, target: { page, id } }
// severity: 'critical' (vermelho) | 'warning' (laranja) | 'info' (azul)

import { computeFactoryLeadTime, computeOrderDelay } from './pendencias'

const MAX_ATTENTIONS = 6  // limita pra não inundar a UI

// Reusável: detecta cores em production sem pedido ativo correspondente.
// Retorna array de { product, colorVariant }.
// Pedido ativo = sent + manufacturing + in_transit com a cor presente nos items.
export function findStuckColors(orders = [], products = []) {
  const activeColorCodes = new Set()
  for (const o of orders) {
    if (o.status !== 'sent' && o.status !== 'manufacturing' && o.status !== 'in_transit') continue
    for (const it of (o.items || [])) {
      for (const c of (it.colors || [])) {
        if (c.code) activeColorCodes.add(`${it.product_id || ''}|${c.code}`)
      }
    }
  }
  
  const stuck = []
  for (const p of products) {
    for (const cv of (p.color_variants || [])) {
      if (cv.status !== 'production') continue
      const key = `${p.id}|${cv.code}`
      if (activeColorCodes.has(key)) continue
      stuck.push({ product: p, colorVariant: cv })
    }
  }
  return stuck
}

export function computeAttentions(orders = [], products = []) {
  const attentions = []
  const leadTimeMap = computeFactoryLeadTime(orders)
  
  // 1) Pedidos em fabricação atrasados
  for (const o of orders) {
    if (o.status !== 'manufacturing') continue
    const delay = computeOrderDelay(o, leadTimeMap)
    if (delay?.isLate) {
      attentions.push({
        id: `late-${o.id}`,
        type: 'order-late',
        severity: delay.daysLate >= 14 ? 'critical' : 'warning',
        title: o.order_name || o.factory,
        description: `${delay.daysLate} dia${delay.daysLate !== 1 ? 's' : ''} atrasado · ${o.factory}`,
        icon: '⏱',
        target: { page: 'orders', id: o.id },
      })
    }
  }
  
  // 2) Pagamentos sem comprovante (em pedidos manufacturing/completed)
  // Agrupa por pedido pra não gerar 1 atenção por pgto
  const ordersWithMissingReceipts = new Map()  // orderId → count
  for (const o of orders) {
    if (o.status !== 'manufacturing' && o.status !== 'in_transit' && o.status !== 'completed') continue
    let count = 0
    for (const p of (o.payments || [])) {
      if (!p.receipt_url && parseFloat(p.amount_usd) > 0) count++
    }
    if (count > 0) ordersWithMissingReceipts.set(o.id, { count, order: o })
  }
  for (const [orderId, { count, order }] of ordersWithMissingReceipts) {
    attentions.push({
      id: `noreceipt-${orderId}`,
      type: 'missing-receipt',
      severity: 'warning',
      title: order.order_name || order.factory,
      description: `${count} pagamento${count !== 1 ? 's' : ''} sem comprovante`,
      icon: '📎',
      target: { page: 'orders', id: orderId },
    })
  }
  
  // 3) Cores travadas em produção SEM pedido ativo vinculado
  // (pedido foi excluído ou cor ficou presa após mudança manual de status)
  const stuckColors = findStuckColors(orders, products)
  for (const { product: p, colorVariant: cv } of stuckColors) {
    attentions.push({
      id: `stuck-${p.id}-${cv.code}`,
      type: 'color-stuck',
      severity: 'info',
      title: `${(p.name || '').toUpperCase()} · ${cv.code}`,
      description: 'Cor em produção sem pedido ativo',
      icon: '🎨',
      target: { page: 'products', id: p.id },
    })
  }
  
  // v13.40 — Consolida atenções repetidas (mesmo type + produto) em 1 card agregado.
  // Evita poluir dashboard com 11 cards idênticos de ADELA.
  // Regra: quando há 3+ do mesmo type/produto, agrega; <=2 mantém individuais.
  const consolidated = consolidateByGroup(attentions)
  
  // Ordena por severity (critical → warning → info), depois alfabético
  const sevOrder = { critical: 0, warning: 1, info: 2 }
  consolidated.sort((a, b) => {
    const s = (sevOrder[a.severity] ?? 99) - (sevOrder[b.severity] ?? 99)
    if (s !== 0) return s
    return a.title.localeCompare(b.title)
  })
  
  return {
    all: consolidated,
    visible: consolidated.slice(0, MAX_ATTENTIONS),
    hiddenCount: Math.max(0, consolidated.length - MAX_ATTENTIONS),
  }
}

// Agrupa atenções do mesmo tipo + mesmo produto base.
// Se 3+ no mesmo grupo → 1 card agregado com lista dos códigos. Se <3 → mantém.
function consolidateByGroup(attentions) {
  // key = type + nome do produto (extrai do title, que vem como "PRODUTO · CÓDIGO")
  const buckets = new Map()
  const singles = []
  
  for (const a of attentions) {
    // Só consolida cores travadas (tipo 'color-stuck') — outros tipos são únicos por si
    if (a.type !== 'color-stuck') {
      singles.push(a)
      continue
    }
    // Title formato "PRODUTO · CÓDIGO" — extrai nome do produto
    const parts = (a.title || '').split('·').map(s => s.trim())
    const prodName = parts[0] || a.title
    const code = parts[1] || ''
    const key = `${a.type}|${prodName}|${a.target?.id || ''}`
    if (!buckets.has(key)) buckets.set(key, { prodName, target: a.target, icon: a.icon, severity: a.severity, type: a.type, codes: [] })
    buckets.get(key).codes.push(code)
  }
  
  const result = [...singles]
  for (const [key, b] of buckets) {
    if (b.codes.length >= 3) {
      // Agrega
      const firstCodes = b.codes.slice(0, 3).join(' · ')
      const more = b.codes.length - 3
      result.push({
        id: `group-${key}`,
        type: b.type,
        severity: b.severity,
        title: `${b.prodName} · ${b.codes.length} cores`,
        description: `Em produção sem pedido ativo: ${firstCodes}${more > 0 ? ` +${more}` : ''}`,
        icon: b.icon,
        target: b.target,
        grouped: true,
        groupCount: b.codes.length,
        groupCodes: b.codes,
      })
    } else {
      // <3: mantém como atenções individuais (reconstrói)
      for (const code of b.codes) {
        result.push({
          id: `stuck-${b.target?.id}-${code}`,
          type: b.type,
          severity: b.severity,
          title: `${b.prodName} · ${code}`,
          description: 'Cor em produção sem pedido ativo',
          icon: b.icon,
          target: b.target,
        })
      }
    }
  }
  
  return result
}
