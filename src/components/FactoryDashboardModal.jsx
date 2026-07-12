// src/components/FactoryDashboardModal.jsx
// Mini-dashboard ao clicar numa fábrica.
// Reúne métricas que estão espalhadas pelo sistema num único lugar
// pra apoiar decisão de "mando o próximo pedido pra qual fábrica?".
//
// Tudo client-side com dados já em memória — sem RPC nova.

import { useMemo } from 'react'
import { Modal, MH, MB } from './ui'
import { formatDate } from '../lib/utils'
import { ORDER_ST } from '../lib/constants'
import { computeFactoryLeadTime, computeOrderDelay } from '../lib/pendencias'

export function FactoryDashboardModal({ factory, orders = [], products = [], perm, onClose, onOrderClick }) {
  const data = useMemo(() => computeFactoryData(factory, orders, products), [factory, orders, products])
  
  return (
    <Modal onClose={onClose} width={900} allowOutsideClose>
      <MH title={`🏭 ${factory.name}`} onClose={onClose} />
      <MB>
        {/* Info de contato (se tiver) */}
        {(factory.contact || factory.notes) && (
          <div style={{
            padding: '8px 12px', marginBottom: 14,
            background: '#F8FAFC', border: '1px solid #E2E8F0',
            borderRadius: 6, fontSize: 12,
          }}>
            {factory.contact && <div><strong>Contato:</strong> {factory.contact}</div>}
            {factory.notes && <div className="text-muted" style={{ marginTop: 4 }}>{factory.notes}</div>}
          </div>
        )}
        
        {data.totalOrders === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏭</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Nenhum pedido com esta fábrica</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Comece criando seu primeiro pedido pra ver métricas aqui.
            </div>
          </div>
        ) : (
          <>
            {/* 4 cards de métrica */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
              <Metric
                label="PEDIDOS ATIVOS"
                value={String(data.activeOrders.length)}
                sub={`${data.totalOrders} no total`}
                color="#7c3aed"
              />
              {perm?.prices && (
                <Metric
                  label="GASTO TOTAL USD"
                  value={`$ ${data.totalSpentUsd.toFixed(2)}`}
                  sub={data.totalSpentBrl > 0 ? `R$ ${data.totalSpentBrl.toFixed(2)}` : 'Sem câmbio'}
                  color="#059669"
                />
              )}
              <Metric
                label="PRAZO MÉDIO"
                value={data.avgLeadDays > 0 ? `${data.avgLeadDays}d` : '—'}
                sub={data.avgLeadDays > 0 ? `${data.completedCount} concluído(s)` : 'Sem dados'}
                color="#0891B2"
              />
              <Metric
                label="ATRASOS"
                value={data.activeLateCount > 0 ? String(data.activeLateCount) : '0'}
                sub={data.activeLateCount > 0 ? 'pedido(s) atrasado(s)' : 'tudo no prazo'}
                color={data.activeLateCount > 0 ? '#DC2626' : '#9CA3AF'}
              />
            </div>
            
            {/* Top produtos */}
            {data.topProducts.length > 0 && (
              <Section title={`👑 Top produtos (qtd peças pedidas)`}>
                <div style={{ background: '#FAF8F6', borderRadius: 6, padding: 8 }}>
                  {data.topProducts.map((tp, i) => (
                    <ProductRow key={tp.productId} item={tp} maxQty={data.topProducts[0].qty} rank={i + 1} />
                  ))}
                </div>
              </Section>
            )}
            
            {/* Pedidos ativos */}
            {data.activeOrders.length > 0 && (
              <Section title={`📋 Pedidos ativos (${data.activeOrders.length})`}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {data.activeOrders.map(o => (
                    <OrderRow key={o.id} order={o} delay={data.delaysByOrder.get(o.id)} onClick={() => onOrderClick?.(o)} />
                  ))}
                </div>
              </Section>
            )}
            
            {/* Últimos concluídos */}
            {data.lastCompleted.length > 0 && (
              <Section title={`✓ Últimos pedidos concluídos`}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border-light)', borderRadius: 6 }}>
                  {data.lastCompleted.map(o => (
                    <OrderRow key={o.id} order={o} onClick={() => onOrderClick?.(o)} />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
        
        <div className="text-muted text-xs" style={{ marginTop: 16, textAlign: 'center' }}>
          💡 Dados baseados no histórico desta fábrica. Pedidos cancelados e na lixeira não contam.
        </div>
      </MB>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CÁLCULOS — função pura, testável
// ═══════════════════════════════════════════════════════════════════
function computeFactoryData(factory, orders, products) {
  const factoryName = factory.name
  // Filtra pedidos desta fábrica (campo factory é texto). Cancelados ignorados.
  const factoryOrders = orders.filter(o => o.factory === factoryName && o.status !== 'cancelled')
  const totalOrders = factoryOrders.length
  
  // Pedidos ativos = draft, sent, manufacturing
  const activeStatuses = ['draft', 'sent', 'manufacturing', 'in_transit']
  const activeOrders = factoryOrders
    .filter(o => activeStatuses.includes(o.status))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  
  // Concluídos = completed
  const completedOrders = factoryOrders.filter(o => o.status === 'completed')
  const lastCompleted = [...completedOrders]
    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    .slice(0, 5)
  
  // Gasto total (todos os pagamentos de todos os pedidos desta fábrica)
  let totalSpentUsd = 0
  let totalSpentBrl = 0
  for (const o of factoryOrders) {
    for (const p of (o.payments || [])) {
      totalSpentUsd += parseFloat(p.amount_usd) || 0
      totalSpentBrl += parseFloat(p.amount_brl) || 0
    }
  }
  
  // Prazo médio — reusa lógica existente
  // computeFactoryLeadTime espera array de orders e retorna Map<factory, {avgDays, count}>
  const leadTimeMap = computeFactoryLeadTime(orders)  // global, não só desta fábrica
  const factoryLead = leadTimeMap.get(factoryName)
  const avgLeadDays = factoryLead?.avgDays || 0
  const completedCount = factoryLead?.count || 0
  
  // Atrasos atuais — pedidos em manufacturing com delay
  const delaysByOrder = new Map()
  let activeLateCount = 0
  for (const o of activeOrders) {
    const delay = computeOrderDelay(o, leadTimeMap)
    if (delay) {
      delaysByOrder.set(o.id, delay)
      if (delay.isLate) activeLateCount++
    }
  }
  
  // Top produtos: agrega quantidade por product_id em todos os pedidos desta fábrica
  const productQty = new Map()  // product_id → qty acumulado
  for (const o of factoryOrders) {
    for (const it of (o.items || [])) {
      if (!it.product_id) continue
      const qty = (it.colors || []).reduce((a, c) => a + Number(c.qty || 0), 0)
                + ((it.colors || []).length === 0 ? Number(it.quantity || 0) : 0)
      productQty.set(it.product_id, (productQty.get(it.product_id) || 0) + qty)
    }
  }
  const topProducts = Array.from(productQty.entries())
    .map(([productId, qty]) => {
      const product = products.find(p => p.id === productId)
      return { productId, qty, productName: product?.name || '(produto excluído)' }
    })
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)
  
  return {
    totalOrders,
    activeOrders,
    completedCount,
    lastCompleted,
    totalSpentUsd,
    totalSpentBrl,
    avgLeadDays,
    activeLateCount,
    delaysByOrder,
    topProducts,
  }
}

// ═══════════════════════════════════════════════════════════════════
// SUBCOMPONENTES
// ═══════════════════════════════════════════════════════════════════
function Metric({ label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: `2px solid ${color}30`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 8,
      padding: 12,
    }}>
      <div className="text-muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="field-label" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

function ProductRow({ item, maxQty, rank }) {
  const widthPercent = maxQty > 0 ? (item.qty / maxQty) * 100 : 0
  return (
    <div style={{ padding: '8px 4px', borderBottom: '1px solid #E5E7EB' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>#{rank} {item.productName}</strong>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#7c3aed' }}>{item.qty} pç(s)</span>
      </div>
      <div style={{ height: 5, background: '#E5E7EB', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${widthPercent}%`, background: '#7c3aed', transition: 'width .3s' }} />
      </div>
    </div>
  )
}

function OrderRow({ order, delay, onClick }) {
  const st = ORDER_ST.find(s => s.id === order.status)
  const totalQty = (order.items || []).reduce((a, it) => {
    const cls = it.colors || []
    return a + cls.reduce((b, c) => b + Number(c.qty || 0), 0)
  }, 0)
  
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-light)',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <span className="chip" style={{
        background: (st?.color || '#999') + '20',
        color: st?.color || '#666',
        fontSize: 10, padding: '2px 8px', borderRadius: 10,
        fontWeight: 600, whiteSpace: 'nowrap',
      }}>
        {st?.icon} {st?.label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{order.order_name || `Pedido ${formatDate(order.created_at, 'short')}`}</div>
        <div className="text-muted" style={{ fontSize: 11 }}>
          {formatDate(order.created_at, 'short')} · {totalQty} pç(s)
          {delay && delay.isLate && (
            <span style={{ color: '#DC2626', fontWeight: 600, marginLeft: 6 }}>
              · ⚠️ {delay.daysLate}d atrasado
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
