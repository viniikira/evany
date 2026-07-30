// src/components/orders/OrderCard.jsx
// v13.70 — Card da lista de Pedidos, redesenhado.
//
// A lista antiga mostrava só nome/fábrica/data/peças — nada do que a dona
// precisa pra decidir batendo o olho: o que tem dentro (o sistema é visual e
// ela reconhece os pedidos pelos modelos), onde está no prazo, e sobretudo
// quanto custa e quanto ainda deve (financeiro das v13.67–69).

import { ORDER_ST } from '../../lib/constants'
import { computeOrderDelay } from '../../lib/pendencias'
import { computeOrderBalance } from '../../lib/financial'
import { formatDate, UC } from '../../lib/utils'

const fmt$ = (n) => '$ ' + (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtR$ = (n) => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR')

export function OrderCard({ order: o, products = [], perm = {}, rate, leadTimeByFactory, reasons, onClick }) {
  const st = ORDER_ST.find(s => s.id === o.status)
  const delay = computeOrderDelay(o, leadTimeByFactory)
  const bal = computeOrderBalance(o, rate)

  const totalQty = (o.items || []).reduce((a, it) => {
    const cls = it.colors || []
    return a + cls.reduce((b, c) => b + Number(c.qty || 0), 0) + (cls.length === 0 ? Number(it.quantity || 0) : 0)
  }, 0)
  const nColors = (o.items || []).reduce((a, it) => a + (it.colors || []).filter(c => Number(c.qty || 0) > 0).length, 0)

  // Miniaturas dos modelos do pedido
  const thumbs = (o.items || []).map(it => {
    const prod = products.find(p => p.id === it.product_id)
    return {
      url: prod?.card_image_url || (prod?.photos || [])[0] || it.selected_photo_url || null,
      name: it.name_manual || prod?.name || it.product_name_snapshot || '',
    }
  })
  const shown = thumbs.slice(0, 5)
  const restThumbs = thumbs.length - shown.length

  const showMoney = perm.prices && bal.total > 0
  const isOpenDebt = showMoney && !bal.isSettled && bal.remainingUsd > 0.01

  return (
    <div
      className="card card-hover"
      onClick={onClick}
      style={{ cursor: 'pointer', borderLeft: reasons?.length ? '3px solid #DC2626' : undefined }}
    >
      {/* Nome + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {o.order_name || <span>{o.factory} <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}>(sem nome)</span></span>}
            {bal.isManuallySettled && (
              <span className="chip" style={{ background: '#ECFDF5', color: '#059669', fontSize: 10 }}>✓ pago</span>
            )}
          </div>
          <div className="text-muted text-sm" title={o.order_date ? `Registrado no sistema em: ${formatDate(o.created_at, 'full')}` : undefined}>
            🏭 {o.factory} · {formatDate(o.order_date || o.created_at, 'full')}
            {' · '}<strong>{totalQty}</strong> peças
            {nColors > 0 && ` · ${nColors} cor${nColors !== 1 ? 'es' : ''}`}
          </div>
        </div>
        <span className="chip" style={{ background: st?.color + '20', color: st?.color, whiteSpace: 'nowrap' }}>{st?.icon} {st?.label}</span>
      </div>

      {/* Modelos do pedido, visualmente */}
      {shown.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 10, alignItems: 'center' }}>
          {shown.map((t, i) => (
            <div
              key={i}
              title={t.name ? UC(t.name) : undefined}
              style={{
                width: 38, height: 48, borderRadius: 5, overflow: 'hidden',
                background: 'var(--border-light, #eee)', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {t.url
                ? <img src={t.url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 15, opacity: .35 }}>👑</span>}
            </div>
          ))}
          {restThumbs > 0 && <span className="text-muted" style={{ fontSize: 11, marginLeft: 2 }}>+{restThumbs}</span>}
        </div>
      )}

      {/* Motivos que o card ainda não mostra por conta própria (atraso sai na
          linha de prazo, saldo em aberto sai no bloco financeiro) */}
      {(reasons || []).filter(r => r.id !== 'late' && r.id !== 'open_debt_completed').map(r => (
        <div key={r.id} style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', marginTop: 8 }}>⚠️ {r.label}</div>
      ))}

      {/* Prazo / chegada */}
      {(delay?.deadlineDays != null || o.expected_arrival) && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          {delay && delay.deadlineDays != null && (
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: delay.isLate ? '#DC2626' : (delay.daysElapsed > delay.deadlineDays * 0.8 ? '#D97706' : '#059669'),
            }}>
              {delay.isLate
                ? `⚠️ Atrasado ${delay.daysLate} dia${delay.daysLate !== 1 ? 's' : ''}`
                : `⏱️ ${delay.daysElapsed}/${delay.deadlineDays} dias`}
              {delay.source === 'avg_with_tolerance' && (
                <span className="text-muted" style={{ fontWeight: 400, fontSize: 10 }}> (estimado)</span>
              )}
            </span>
          )}
          {o.expected_arrival && (
            <span className="text-muted" style={{ fontSize: 11 }}>📅 chega {formatDate(o.expected_arrival, 'full')}</span>
          )}
        </div>
      )}

      {/* Financeiro: total, pago, falta, caixinha */}
      {showMoney && (
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--border-light, var(--border))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
            <span className="text-muted">
              total <strong style={{ color: 'var(--text)' }}>{fmt$(bal.total)}</strong>
              {!bal.isFullyConfirmed && <span title="Parte do total é estimativa — lance os valores da trading"> ⚠</span>}
              {' · '}pago <strong style={{ color: 'var(--text)' }}>{Math.round(bal.percentPaid)}%</strong>
            </span>
            {bal.isSettled
              ? <span style={{ color: '#059669', fontWeight: 700 }}>✓ quitado</span>
              : <span style={{ color: '#DC2626', fontWeight: 700 }}>
                  falta {fmt$(bal.remainingUsd)}{bal.remainingBrl > 0 ? ` · ${fmtR$(bal.remainingBrl)}` : ''}
                </span>}
          </div>
          {/* Barra: pago (verde) + coberto por caixinha (azul) */}
          <div style={{ height: 5, borderRadius: 3, background: 'var(--border-light, #eee)', overflow: 'hidden', marginTop: 6, display: 'flex' }}>
            <div style={{ width: `${Math.min(100, bal.percentPaid)}%`, background: '#059669' }} />
            {isOpenDebt && bal.coveragePercent > 0 && (
              <div
                title={`${fmtR$(bal.reservedBrl)} guardado em caixinha`}
                style={{ width: `${Math.min(100 - Math.min(100, bal.percentPaid), (100 - bal.percentPaid) * (bal.coveragePercent / 100))}%`, background: '#7DD3FC' }}
              />
            )}
          </div>
          {isOpenDebt && bal.reservedBrl > 0 && (
            <div style={{ fontSize: 10.5, color: '#0891B2', marginTop: 4 }}>
              🏦 {fmtR$(bal.reservedBrl)} guardado{bal.isCovered ? ' (cobre tudo ✓)' : ` · faltam captar ${fmtR$(bal.toRaiseBrl)}`}
            </div>
          )}
          {o.status === 'completed' && isOpenDebt && (
            <div style={{ fontSize: 10.5, color: '#991B1B', fontWeight: 700, marginTop: 4 }}>
              🚨 concluído com saldo em aberto
            </div>
          )}
        </div>
      )}
    </div>
  )
}
