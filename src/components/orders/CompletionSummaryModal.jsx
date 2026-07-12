// src/components/orders/CompletionSummaryModal.jsx
// v13.36 — Extraído de Orders.jsx no refator.
// Modal pós-conclusão de pedido: mostra tudo que o sistema fez automaticamente
// quando pedido virou Concluído. Substitui toast efêmero que sumia sem registro.

import { Modal, MH, MB, MF } from '../ui'

export function CompletionSummaryModal({ summary, onClose, onViewOrder }) {
  const totalUpdated = (summary.coloresUpdated || []).reduce((a, c) => a + c.cores.length, 0)
  const totalAdded = (summary.coloresAdded || []).reduce((a, c) => a + c.cores.length, 0)
  
  return (
    <Modal onClose={onClose} width={560} allowOutsideClose>
      <MH title="✅ Pedido Concluído" onClose={onClose} />
      <MB>
        <div style={{
          padding: 14, marginBottom: 14,
          background: '#ECFDF5', borderRadius: 8,
          border: '1px solid #A7F3D0',
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#065F46', marginBottom: 4 }}>
            🎉 "{summary.orderName}" finalizado
          </div>
          <div style={{ fontSize: 13, color: '#065F46' }}>
            O sistema atualizou automaticamente os produtos relacionados:
          </div>
        </div>
        
        {summary.coloresUpdated.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="field-label" style={{ marginBottom: 6 }}>
              🛍️ {totalUpdated} cor(es) movida(s) para Catálogo
            </div>
            <div style={{ background: '#F9FAFB', padding: 10, borderRadius: 6, fontSize: 13 }}>
              {summary.coloresUpdated.map((u, i) => (
                <div key={u.produto || `upd-${i}`} style={{ marginBottom: i < summary.coloresUpdated.length - 1 ? 6 : 0 }}>
                  <strong>{u.produto}</strong>:{' '}
                  {u.cores.map(c => (
                    <span key={c} style={{
                      display: 'inline-block', padding: '2px 6px',
                      background: 'var(--surface)', border: '1px solid #E5E7EB',
                      borderRadius: 4, fontSize: 11, marginRight: 4,
                    }}>{c}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
        
        {summary.coloresAdded.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="field-label" style={{ marginBottom: 6 }}>
              ➕ {totalAdded} cor(es) nova(s) adicionada(s) ao catálogo
            </div>
            <div style={{ background: '#FEF3C7', padding: 10, borderRadius: 6, fontSize: 13 }}>
              {summary.coloresAdded.map((u, i) => (
                <div key={u.produto || `add-${i}`} style={{ marginBottom: i < summary.coloresAdded.length - 1 ? 6 : 0 }}>
                  <strong>{u.produto}</strong>:{' '}
                  {u.cores.map(c => (
                    <span key={c} style={{
                      display: 'inline-block', padding: '2px 6px',
                      background: 'var(--surface)', border: '1px solid #FDE68A',
                      borderRadius: 4, fontSize: 11, marginRight: 4,
                    }}>{c}</span>
                  ))}
                </div>
              ))}
            </div>
            <div className="text-muted text-xs" style={{ marginTop: 4 }}>
              💡 Essas cores agora fazem parte permanente do catálogo dos produtos.
            </div>
          </div>
        )}
        
        {summary.coloresUpdated.length === 0 && summary.coloresAdded.length === 0 && (
          <div className="text-muted text-sm" style={{ textAlign: 'center', padding: 20 }}>
            Nenhuma mudança automática foi necessária.
          </div>
        )}
      </MB>
      <MF>
        <button className="btn btn-outline" onClick={onClose}>Fechar</button>
        <button className="btn btn-primary" onClick={onViewOrder}>📋 Ver Pedido</button>
      </MF>
    </Modal>
  )
}
