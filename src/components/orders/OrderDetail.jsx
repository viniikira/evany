// src/components/orders/OrderDetail.jsx
// v13.36 — Extraído de Orders.jsx no refator.
//
// Modal de visualização/edição de pedido com timeline, pagamentos e status.
// Usado tanto em Orders.jsx quanto em Products.jsx (via import).

import { useState } from 'react'
import { Modal, MH, MB, MF, Lightbox, useConfirm, useToast } from '../ui'
import { ColorSwatch } from '../ColorSwatch'
import { OrderTimeline } from '../OrderTimeline'
import { PayRow } from './PayRow'
import { addPayment, updatePayment, deletePayment } from '../../lib/data/orders'
import { uploadReceipt, getReceiptSignedUrl, deleteReceipt } from '../../lib/storage'
import { generateOrderPDF } from '../../lib/pdf'
import { generateFactorySheet } from '../../lib/factorySheet'
import { trackAction } from '../../lib/analytics'
import { addLog as writeLog } from '../../lib/data/misc'
import { ORDER_ST } from '../../lib/constants'
import { UC, formatDate } from '../../lib/utils'
import { toastError } from '../../lib/errors'
import { log } from '../../lib/logger'

export function OrderDetail({ order: o, products, colors = [], perm, rate, user, onClose, onEdit, onDelete, onStatus, onRefresh, onRecalcFOB, onDuplicate, zIndex, readOnly = false }) {
  const st = ORDER_ST.find(s => s.id === o.status)
  const [lb, setLb] = useState(null)
  const toast = useToast()
  const confirm = useConfirm()

  const totalQty = (o.items || []).reduce((a, it) => {
    const cls = it.colors || []
    return a + cls.reduce((b, c) => b + Number(c.qty || 0), 0) + (cls.length === 0 ? Number(it.quantity || 0) : 0)
  }, 0)
  const budgetTotal = (o.items || []).reduce((a, it) => {
    const cls = it.colors || []
    const pu = parseFloat(it.price_usd) || 0
    // FOB respeita preço próprio de cada cor (#2 v13.13)
    const fromColors = cls.reduce((b, c) => {
      const qty = Number(c.qty || 0)
      const cprice = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : pu
      return b + qty * (cprice || 0)
    }, 0)
    return a + fromColors + (cls.length === 0 ? pu * Number(it.quantity || 0) : 0)
  }, 0)
  const totalPaidUsd = (o.payments || []).reduce((a, p) => a + parseFloat(p.amount_usd || 0), 0)
  const remainUsd = budgetTotal - totalPaidUsd
  
  // #3 Cálculos em BRL — câmbio médio ponderado pelo USD pago em cada pagamento.
  // Mostra realidade financeira em reais (saída do banco) além do valor em USD.
  const totalPaidBrl = (o.payments || []).reduce((a, p) => a + parseFloat(p.amount_brl || 0), 0)
  // Câmbio médio efetivo: BRL pago / USD pago. Se ainda não pagou nada, usa rate do app (prop)
  const avgRate = totalPaidUsd > 0 ? totalPaidBrl / totalPaidUsd : (parseFloat(rate) || 0)
  // Orçamento e restante em BRL projetados pelo câmbio médio efetivo (ou rate atual)
  const budgetBrl = avgRate > 0 ? budgetTotal * avgRate : 0
  const remainBrl = avgRate > 0 ? remainUsd * avgRate : 0
  
  const isM = o.status === 'manufacturing' || o.status === 'in_transit' || o.status === 'completed'

  // Adicionar pagamento (só admin)
  const [addingPay, setAddingPay] = useState(false)

  // v13.47 — Exporta a planilha da fábrica (.xlsx com fotos, formato do Google Sheets manual)
  const [exportingSheet, setExportingSheet] = useState(false)
  const exportFactorySheet = async () => {
    if (exportingSheet) return
    setExportingSheet(true)
    try {
      trackAction('export_factory_sheet', { orderId: o.id, factory: o.factory })
      const { models, colors: nColors } = await generateFactorySheet(o, products, colors, { rate })
      toast.push(`Planilha da fábrica gerada: ${models} modelo${models !== 1 ? 's' : ''}, ${nColors} cor${nColors !== 1 ? 'es' : ''}.`, { kind: 'success' })
    } catch (e) {
      log.error('[KIRA] Erro ao gerar planilha da fábrica:', e)
      toastError(toast, e, 'Não foi possível gerar a planilha')
    } finally {
      setExportingSheet(false)
    }
  }

  const addPay = async () => {
    try {
      await addPayment(o.id, {
        payment_date: null, amount_usd: null, rate_paid: null, amount_brl: null, bank: null,
      })
      await onRefresh()
      toast.push('Pagamento adicionado. Preencha os dados.', { kind: 'success' })
    } catch (e) {
      // Loga erro completo no console pra debug
      log.error('[KIRA] Erro ao adicionar pagamento:', e)
      toastError(toast, e, 'Não foi possível adicionar pagamento')
    }
  }

  const savePay = async (payId, patch) => {
    try {
      const isUsdChange = Object.prototype.hasOwnProperty.call(patch, 'amount_usd')
      const isRateChange = Object.prototype.hasOwnProperty.call(patch, 'rate_paid')
      const isBrlChange = Object.prototype.hasOwnProperty.call(patch, 'amount_brl')
      
      const current = (o.payments || []).find(p => p.id === payId) || {}
      const num = (v) => {
        if (v == null || v === '') return null
        const n = parseFloat(v)
        return isNaN(n) ? null : n
      }
      
      // Bi-direcional inteligente (Opção A: último editado manda):
      //   - Edita USD + tem câmbio → calcula BRL
      //   - Edita BRL + tem câmbio → calcula USD
      //   - Edita só câmbio → recalcula o lado MENOS preenchido recentemente
      //     (heurística: se BRL tem valor, recalcula USD; senão recalcula BRL)
      
      if (isUsdChange && !isBrlChange) {
        // Editou USD: se tem câmbio (novo ou existente), calcula BRL
        const usd = num(patch.amount_usd)
        const rate = num(isRateChange ? patch.rate_paid : current.rate_paid)
        if (usd != null && rate != null) {
          patch.amount_brl = +(usd * rate).toFixed(2)
        }
      } else if (isBrlChange && !isUsdChange) {
        // Editou BRL: se tem câmbio, calcula USD
        const brl = num(patch.amount_brl)
        const rate = num(isRateChange ? patch.rate_paid : current.rate_paid)
        if (brl != null && rate != null && rate > 0) {
          patch.amount_usd = +(brl / rate).toFixed(2)
        }
      } else if (isRateChange && !isUsdChange && !isBrlChange) {
        // Editou só câmbio: recalcula o lado oposto do último que estava preenchido.
        // Heurística: se BRL tem valor, recalcula USD a partir dele (cenário comum:
        // "paguei R$ tantos no banco, qual é o USD efetivo?"). Senão recalcula BRL.
        const rate = num(patch.rate_paid)
        const brl = num(current.amount_brl)
        const usd = num(current.amount_usd)
        if (rate != null && rate > 0) {
          if (brl != null && brl > 0) {
            patch.amount_usd = +(brl / rate).toFixed(2)
          } else if (usd != null && usd > 0) {
            patch.amount_brl = +(usd * rate).toFixed(2)
          }
        }
      }
      
      await updatePayment(payId, patch)
      await onRefresh()
    } catch (e) { toastError(toast, e) }
  }

  const rmPay = async (pay) => {
    const ok = await confirm({
      title: 'Remover pagamento?',
      message: pay.amount_usd ? `Pagamento de US$ ${pay.amount_usd} será removido.` : 'Este pagamento será removido.',
      danger: true,
      confirmLabel: 'Remover',
    })
    if (!ok) return
    try {
      if (pay.receipt_url) await deleteReceipt(pay.receipt_url).catch(() => {})
      await deletePayment(pay.id)
      await onRefresh()
      toast.push('Pagamento removido', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  const uploadPayReceipt = async (payId, file) => {
    // #FIX-2 Não permite upload sem data preenchida
    const pay = (o.payments || []).find(p => p.id === payId)
    if (!pay?.payment_date) {
      toast.push('Preencha a data do pagamento antes de enviar o comprovante', { kind: 'error', duration: 6000 })
      return
    }
    try {
      const { path } = await uploadReceipt(file, o.id)
      await savePay(payId, { receipt_url: path })
      toast.push('Comprovante salvo', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }

  const viewReceipt = async (path) => {
    try {
      const url = await getReceiptSignedUrl(path)
      window.open(url, '_blank')
    } catch (e) { toastError(toast, e) }
  }

  return (
    <>
      <Lightbox src={lb} onClose={() => setLb(null)} />
      <Modal onClose={onClose} width={750} allowOutsideClose zIndex={zIndex}>
        <MH title={o.order_name || `Pedido · ${o.factory}`} onClose={onClose} actions={
          <>
            {/* #FIX-1 Recalcular FOB com preços atuais — só em rascunho (snapshot é sagrado depois) */}
            {perm.orders && !readOnly && o.status === 'draft' && onRecalcFOB && (
              <button
                className="btn btn-outline btn-sm"
                onClick={onRecalcFOB}
                title="Atualiza preços do pedido com base nos valores atuais do catálogo"
              >🔄 Recalcular FOB</button>
            )}
            {/* v13.60 — Duplicar unificado: abre a mesa de criação pré-carregada */}
            {perm.orders && !readOnly && onDuplicate && (
              <button
                className="btn btn-outline btn-sm"
                onClick={onDuplicate}
                title="Abre a mesa de criação pré-carregada com estes itens — nada é criado até você salvar"
              >📋 Duplicar</button>
            )}
            {/* v13.47 Planilha da fábrica — contém FOB, só pra quem vê preços */}
            {perm.prices && (
              <button
                className="btn btn-outline btn-sm"
                onClick={exportFactorySheet}
                disabled={exportingSheet}
                title="Gera o Excel com fotos no formato enviado à fábrica (modelos, cores, quantidades, FOB e seção COLORS)"
              >{exportingSheet ? '⏳ Gerando...' : '📊 Planilha Fábrica'}</button>
            )}
            <button className="btn btn-outline btn-sm" onClick={() => { trackAction('export_pdf', { orderId: o.id, factory: o.factory }); generateOrderPDF(o, products) }} title="Documento interno de conferência (não é o que vai pra fábrica)">📄 PDF interno</button>
            {perm.orders && !readOnly ? <button className="btn btn-primary btn-sm" onClick={onEdit}>✏️ Editar</button> : null}
          </>
        } />
        <MB>
          {readOnly && (
            <div style={{
              padding: '8px 12px', marginBottom: 10,
              background: '#EEF2FF', border: '1px solid #C7D2FE',
              borderRadius: 6, fontSize: 12, color: '#3730A3',
            }}>
              👁️ <strong>Modo visualização.</strong> Pra editar, vá em <strong>Pedidos</strong>.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="chip" style={{ background: st?.color, color: '#fff' }}>{st?.icon} {st?.label}</span>
            {/* v13.40 — Mostra order_date (data real) se preenchido, com tooltip de created_at */}
            <span
              className="text-muted text-sm"
              title={o.order_date ? `Registrado no sistema em: ${formatDate(o.created_at, 'full')}` : undefined}
            >
              {o.factory} · {formatDate(o.order_date || o.created_at, 'full')}
              {o.order_date && <span style={{ marginLeft: 4, fontSize: 10, opacity: .6 }} title="Data do pedido (retroativa)">📅</span>}
            </span>
            {o.expected_arrival && <span className="chip" style={{ background: '#DBEAFE', color: '#1D4ED8' }}>📅 Chegada: {formatDate(o.expected_arrival, 'full')}</span>}
            {/* #3 Prazo prometido + indicador de atraso (apenas em fabricação)
                v13.41 — prefere order_date (retroativa) → fallback manufacturing_started_at */}
            {o.status === 'manufacturing' && o.promised_lead_days && (o.order_date || o.manufacturing_started_at) && (() => {
              const start = new Date(o.order_date || o.manufacturing_started_at)
              if (isNaN(start.getTime())) return null
              const daysElapsed = Math.floor((new Date() - start) / 86400000)
              if (daysElapsed < 0) return null
              const isLate = daysElapsed > o.promised_lead_days
              const daysLate = isLate ? daysElapsed - o.promised_lead_days : 0
              const remaining = o.promised_lead_days - daysElapsed
              return (
                <span className="chip" style={{
                  background: isLate ? '#FEE2E2' : (remaining <= 7 ? '#FEF3C7' : '#ECFDF5'),
                  color: isLate ? '#991B1B' : (remaining <= 7 ? '#92400E' : '#065F46'),
                  fontWeight: 600,
                }}>
                  {isLate
                    ? `⚠️ Atrasado ${daysLate} dia${daysLate !== 1 ? 's' : ''}`
                    : `⏱️ ${daysElapsed}/${o.promised_lead_days} dias`}
                </span>
              )
            })()}
            {/* Indicador pra pedidos legados sem nenhuma data de início */}
            {o.status === 'manufacturing' && o.promised_lead_days && !o.order_date && !o.manufacturing_started_at && (
              <span className="chip" style={{ background: '#F3F4F6', color: '#6B7280', fontSize: 11 }}>
                ⏱️ Prazo: {o.promised_lead_days} dias (sem data de início registrada)
              </span>
            )}
          </div>

          {/* #21 Timeline visual do pedido — v13.39 colapsável pra ocupar menos espaço em pedidos antigos */}
          <details
            open={(o.timeline || []).length < 6}
            style={{
              marginBottom: 12,
              border: '1px solid var(--border-light)',
              borderRadius: 8,
              padding: '8px 10px',
              background: 'var(--surface)',
            }}
          >
            <summary style={{
              cursor: 'pointer', fontWeight: 600, fontSize: 12,
              padding: '2px 0', userSelect: 'none',
              color: 'var(--text)',
            }}>
              📅 Histórico de Status
              <span className="text-muted text-xs" style={{ marginLeft: 6, fontWeight: 400 }}>
                · {(o.timeline || []).length} evento{(o.timeline || []).length !== 1 ? 's' : ''}
              </span>
            </summary>
            <div style={{ marginTop: 8 }}>
              <OrderTimeline order={o} />
            </div>
          </details>

          <div className="order-table-wrap">
            <table className="order-table">
              <thead><tr><th>PRODUTO</th><th>COR</th><th>QTD</th>{isM && perm.prices && <th>USD</th>}</tr></thead>
              <tbody>
                {(o.items || []).map(it => {
                  const prod = products.find(p => p.id === it.product_id)
                  const name = it.name_manual || UC(prod?.name || it.product_name_snapshot || '—')
                  const cls = it.colors || []
                  const itemPrice = parseFloat(it.price_usd || 0)
                  if (cls.length > 0) {
                    return cls.map((cl, ci) => {
                      // Preço efetivo: cor tem próprio? usa ele. Senão herda do item.
                      const colorPrice = cl.price_usd != null && cl.price_usd !== '' ? parseFloat(cl.price_usd) : null
                      const effective = colorPrice != null ? colorPrice : itemPrice
                      const hasCustom = colorPrice != null && colorPrice !== itemPrice
                      return (
                        <tr key={it.id + '-' + ci}>
                          <td><strong>{name}</strong></td>
                          <td>
                            {cl.code ? (
                              <ColorSwatch code={cl.code} colors={colors} size="sm" showLabel />
                            ) : '—'}
                          </td>
                          <td style={{ textAlign: 'center' }}>{cl.qty || 0}</td>
                          {isM && perm.prices && (
                            <td title={hasCustom ? `Preço próprio desta cor (item é $${itemPrice.toFixed(2)})` : undefined}>
                              {effective > 0 ? '$' + effective.toFixed(2) : '—'}
                              {hasCustom && <span style={{ color: '#F59E0B', marginLeft: 3, fontWeight: 700 }} title="Preço customizado">*</span>}
                            </td>
                          )}
                        </tr>
                      )
                    })
                  }
                  return (
                    <tr key={it.id}>
                      <td><strong>{name}</strong></td>
                      <td>—</td>
                      <td style={{ textAlign: 'center' }}>{it.quantity || 0}</td>
                      {isM && perm.prices && <td>{itemPrice > 0 ? '$' + itemPrice.toFixed(2) : '—'}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, padding: '8px 14px', background: 'var(--bg)', borderRadius: 6, marginTop: 4 }}>
            <strong style={{ color: 'var(--primary)' }}>Total: {totalQty} peças</strong>
            {isM && perm.prices && budgetTotal > 0 && <strong style={{ color: '#F59E0B' }}>FOB: $ {budgetTotal.toFixed(2)}</strong>}
          </div>

          {o.notes && <div style={{ padding: 10, background: '#f9fafb', borderRadius: 6, fontSize: 13, marginTop: 8 }}>{o.notes}</div>}

          {/* Pagamentos - só admin */}
          {isM && perm.payments && (
            <div style={{ marginTop: 14, padding: 14, background: 'linear-gradient(135deg,#FFFBEB,#FEF9F0)', borderRadius: 10, border: '1px solid #FDE68A' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div className="card-title" style={{ margin: 0, color: '#92400E' }}>💰 Pagamentos ({(o.payments || []).length})</div>
                <button className="btn btn-outline btn-sm" onClick={addPay}>+ Pagamento</button>
              </div>
              {(o.payments || []).map((p, i) => (
                <PayRow
                  key={p.id}
                  payment={p}
                  index={i}
                  onSave={(patch) => savePay(p.id, patch)}
                  onRemove={() => rmPay(p)}
                  onUploadReceipt={(file) => uploadPayReceipt(p.id, file)}
                  onViewReceipt={() => viewReceipt(p.receipt_url)}
                />
              ))}
              {(o.payments || []).length === 0 && <p className="text-muted text-sm" style={{ textAlign: 'center' }}>Nenhum pagamento.</p>}

              {budgetTotal > 0 && (
                <div style={{ marginTop: 12 }}>
                  {/* Câmbio médio efetivo (se já houve pagamento) */}
                  {avgRate > 0 && totalPaidUsd > 0 && (
                    <div style={{ textAlign: 'center', marginBottom: 8, fontSize: 12 }}>
                      <span className="text-muted">💱 Câmbio médio efetivo: </span>
                      <strong style={{ color: 'var(--primary)' }}>R$ {avgRate.toFixed(4)}</strong>
                    </div>
                  )}
                  
                  {/* 3 cards: Orçamento, Pago, Restante — cada um em USD e BRL */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8, border: '1px solid #FDE68A' }}>
                      <div className="text-muted text-xs">ORÇAMENTO</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>$ {budgetTotal.toFixed(2)}</div>
                      {avgRate > 0 && (
                        <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>
                          R$ {budgetBrl.toFixed(2)}
                        </div>
                      )}
                    </div>
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8, border: '1px solid #FDE68A' }}>
                      <div className="text-muted text-xs">PAGO</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>$ {totalPaidUsd.toFixed(2)}</div>
                      <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>
                        R$ {totalPaidBrl.toFixed(2)}
                      </div>
                    </div>
                    <div style={{
                      background: remainUsd <= 0 ? '#ECFDF5' : '#fff',
                      padding: 10, borderRadius: 8,
                      border: `1px solid ${remainUsd <= 0 ? '#A7F3D0' : '#FDE68A'}`,
                    }}>
                      <div className="text-muted text-xs">RESTANTE</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: remainUsd <= 0 ? '#059669' : '#EF4444', marginTop: 2 }}>
                        $ {remainUsd.toFixed(2)}
                      </div>
                      {avgRate > 0 && (
                        <div style={{ fontSize: 12, color: remainUsd <= 0 ? '#059669' : '#92400E', marginTop: 2 }}>
                          R$ {remainBrl.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {avgRate === 0 && (
                    <div className="text-muted text-xs" style={{ textAlign: 'center', marginTop: 8 }}>
                      💡 Adicione pagamentos com câmbio para ver valores em BRL
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Status */}
          {perm.orders && !readOnly && (
            <div style={{ marginTop: 14 }}>
              <div className="field-label">Status</div>
              <div className="chip-bar">
                {ORDER_ST.map(s => (
                  <button key={s.id}
                    className={`chip-filter${o.status === s.id ? ' on' : ''}`}
                    style={o.status === s.id ? { background: s.color, borderColor: s.color, color: '#fff' } : {}}
                    onClick={() => onStatus(s.id)}>
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </MB>
        {perm.orders && !readOnly && (
          <MF>
            <button className="btn-icon text-danger" onClick={onDelete} style={{ marginRight: 'auto' }}>🗑 Mover pra Lixeira</button>
          </MF>
        )}
      </Modal>
    </>
  )
}
