// src/components/orders/NextStepBar.jsx
// v13.80 — "O que fazer agora com este pedido", no topo do pedido.
//
// Fazendo um pedido de ponta a ponta (revisão de usabilidade de 14/10/2026),
// o passo seguinte — mandar pra fábrica, fábrica confirmou, saiu da fábrica,
// chegou — ficava em botões de status no FIM do pedido, embaixo da lista de
// itens. Agora o próximo passo aparece em destaque logo no topo, com uma
// frase dizendo onde o pedido está. Os botões de status completos continuam
// lá embaixo pra corrigir/voltar.

import '../../styles/order-review.css'

const STEPS = {
  draft: {
    where: 'Rascunho — ainda não foi pra fábrica.',
    action: 'Enviei pra fábrica', to: 'sent',
    hint: 'Gere a planilha da fábrica, mande pra ela e marque aqui.',
  },
  sent: {
    where: 'Em revisão — esperando a fábrica/trading confirmar.',
    action: 'Fábrica confirmou — começou a fabricar', to: 'manufacturing',
  },
  manufacturing: {
    where: 'Em fabricação.',
    action: 'Saiu da fábrica — está a caminho', to: 'in_transit',
  },
  in_transit: {
    where: 'Em trânsito — a caminho do Brasil.',
    action: 'Chegou', to: 'completed',
  },
}

export function NextStepBar({ order, onStatus, onSheet, onPrices, needsPrices = false, extra = null }) {
  const step = STEPS[order?.status]
  if (!step || !onStatus) return null
  return (
    <div className="nsb">
      <div className="nsb-text">
        <strong>{step.where}</strong>
        {extra && <span>{extra}</span>}
        {!extra && step.hint && <span>{step.hint}</span>}
      </div>
      <div className="nsb-actions">
        {order.status === 'draft' && onSheet && (
          <button type="button" className="btn btn-outline btn-sm" onClick={onSheet}>📊 Planilha da fábrica</button>
        )}
        {needsPrices && onPrices && (order.status === 'sent' || order.status === 'manufacturing') && (
          <button type="button" className="btn btn-outline btn-sm" onClick={onPrices}>💵 Lançar valores da trading</button>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onStatus(step.to)}>
          {step.action} →
        </button>
      </div>
    </div>
  )
}
