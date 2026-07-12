// src/components/OrderTimeline.jsx
// Timeline visual do pedido: linha do tempo horizontal com marcos.
// Marcos: Criado, Enviado, Em Fabricação, Concluído, Cancelado.
//
// Fontes de data, em ordem de preferência:
//   1. status_history (v13.21+) — histórico completo gravado a cada mudança
//   2. created_at (sempre) → Criado
//   3. manufacturing_started_at (v13.16+) → Em Fabricação
//   4. Pra outros marcos sem dado: mostra ícone cinza com "data não registrada"

import { ORDER_ST } from '../lib/constants'
import { formatDate } from '../lib/utils'

// Ordem dos marcos pra renderizar (cancelado fica fora do fluxo normal)
const FLOW = ['draft', 'sent', 'manufacturing', 'in_transit', 'completed']

export function OrderTimeline({ order }) {
  if (!order) return null
  
  const history = Array.isArray(order.status_history) ? order.status_history : []
  
  // Helper: data do primeiro registro deste status no histórico (mais antigo)
  // Se não tem no histórico, usa fallbacks específicos
  const dateForStatus = (status) => {
    const fromHistory = history
      .filter(h => h.status === status)
      .sort((a, b) => new Date(a.at) - new Date(b.at))[0]
    if (fromHistory) return { date: fromHistory.at, source: 'history' }
    
    // Fallbacks pra pedidos legados
    if (status === 'draft') return { date: order.created_at, source: 'created_at' }
    if (status === 'manufacturing' && order.manufacturing_started_at) {
      return { date: order.manufacturing_started_at, source: 'manufacturing_started_at' }
    }
    return { date: null, source: 'unknown' }
  }
  
  // Determina o índice do status atual no fluxo
  const currentIndex = FLOW.indexOf(order.status)
  const isCancelled = order.status === 'cancelled'
  
  // Pra cada marco do fluxo, monta info pra renderizar
  const milestones = FLOW.map((status, idx) => {
    const st = ORDER_ST.find(s => s.id === status)
    const { date, source } = dateForStatus(status)
    // Se cancelado: marcos com data registrada (passou por eles antes de cancelar) ficam past;
    // Sem data: futuro/desconhecido
    const isPast = isCancelled
      ? !!date  // teve data? passou por aqui
      : idx < currentIndex
    const isCurrent = !isCancelled && idx === currentIndex
    const isFuture = isCancelled ? !date : idx > currentIndex
    
    return {
      status,
      label: st?.label || status,
      icon: st?.icon || '•',
      color: st?.color || '#9CA3AF',
      date,
      source,
      isPast,
      isCurrent,
      isFuture,
    }
  })
  
  return (
    <div style={{
      padding: '12px 14px',
      background: '#FAFAFA',
      border: '1px solid var(--border-light)',
      borderRadius: 8,
      marginBottom: 14,
    }}>
      <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, marginBottom: 10, letterSpacing: 0.5 }}>
        ⏱ TIMELINE DO PEDIDO
        {history.length === 0 && (
          <span style={{ marginLeft: 8, fontWeight: 400, fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>
            (pedido legado · datas inferidas)
          </span>
        )}
      </div>
      
      {/* Linha principal: marcos horizontais */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${milestones.length}, 1fr)`,
        position: 'relative',
        marginTop: 8,
      }}>
        {/* Linha conectora */}
        <div style={{
          position: 'absolute',
          top: 14,
          left: '12.5%',
          right: '12.5%',
          height: 2,
          background: 'linear-gradient(to right, var(--primary) 0%, var(--primary) ' +
            (isCancelled ? '0%' : `${(currentIndex / (FLOW.length - 1)) * 100}%`) + ', #E5E7EB ' +
            (isCancelled ? '0%' : `${(currentIndex / (FLOW.length - 1)) * 100}%`) + ', #E5E7EB 100%)',
          zIndex: 0,
        }} />
        
        {milestones.map(m => (
          <div key={m.status} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            position: 'relative', zIndex: 1,
          }}>
            {/* Bolinha */}
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: m.isPast || m.isCurrent ? m.color : '#fff',
              border: `2px solid ${m.isPast || m.isCurrent ? m.color : '#D1D5DB'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13,
              boxShadow: m.isCurrent ? `0 0 0 4px ${m.color}30` : 'none',
              animation: m.isCurrent ? 'pulse-timeline 2s infinite' : 'none',
              color: m.isPast || m.isCurrent ? '#fff' : '#9CA3AF',
              fontWeight: 700,
            }}>
              {m.isPast ? '✓' : m.icon}
            </div>
            
            {/* Label */}
            <div style={{
              marginTop: 6, fontSize: 11, fontWeight: m.isCurrent ? 700 : 500,
              color: m.isPast || m.isCurrent ? m.color : '#9CA3AF',
              textAlign: 'center', lineHeight: 1.2,
            }}>
              {m.label}
            </div>
            
            {/* Data */}
            <div style={{ fontSize: 10, color: '#6B7280', textAlign: 'center', marginTop: 2 }}>
              {m.date ? (
                formatDate(m.date, 'short')
              ) : m.isPast || m.isCurrent ? (
                <span style={{ fontStyle: 'italic' }}>data não registrada</span>
              ) : (
                '—'
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Banner especial pra cancelado */}
      {isCancelled && (
        <div style={{
          marginTop: 10, padding: '8px 12px',
          background: '#FEE2E2', border: '1px solid #FCA5A5',
          borderRadius: 6, fontSize: 12, color: '#991B1B',
          textAlign: 'center', fontWeight: 600,
        }}>
          ✕ Pedido cancelado
          {(() => {
            const cancelEntry = history.filter(h => h.status === 'cancelled').sort((a, b) => new Date(b.at) - new Date(a.at))[0]
            return cancelEntry ? ` em ${formatDate(cancelEntry.at, 'with-time')}` : ''
          })()}
        </div>
      )}
      
      <style>{`
        @keyframes pulse-timeline {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  )
}
