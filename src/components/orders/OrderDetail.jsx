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
import { addPayment, updatePayment, deletePayment, updateOrder } from '../../lib/data/orders'
import { computeOrderBalance } from '../../lib/financial'
import { TradingValuesModal } from './TradingValuesModal'
import { ReservesSection } from './ReservesSection'
import { uploadReceipt, getReceiptSignedUrl, deleteReceipt } from '../../lib/storage'
import { generateOrderPDF } from '../../lib/pdf'
import { generateFactorySheet } from '../../lib/factorySheet'
import { trackAction } from '../../lib/analytics'
import { addLog as writeLog } from '../../lib/data/misc'
import { ORDER_ST } from '../../lib/constants'
import { UC, formatDate, parseDateLocal } from '../../lib/utils'
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
  // v13.67 — a dívida é o VALOR FINAL da trading (FOB + impostos + frete),
  // não o FOB. `bal` traz total final, confirmado vs estimado, pago e falta.
  const bal = computeOrderBalance(o, rate)
  const totalPaidUsd = bal.paidUsd
  const remainUsd = bal.remainingUsd
  const totalPaidBrl = bal.paidBrl
  const avgRate = bal.avgRate || (parseFloat(rate) || 0)
  const remainBrl = bal.remainingBrl || 0
  const [tradingModal, setTradingModal] = useState(false)

  const saveTradingValues = async (items) => {
    try {
      await updateOrder(o.id, { items })
      setTradingModal(false)
      await onRefresh()
      toast.push('Valores da trading salvos', { kind: 'success' })
    } catch (e) { toastError(toast, e, 'Não foi possível salvar os valores') }
  }

  // v13.68 — caixinhas (dinheiro já guardado pra este pedido)
  const saveReserves = async (reserves) => {
    try {
      await updateOrder(o.id, { reserves })
      await onRefresh()
    } catch (e) { toastError(toast, e, 'Não foi possível salvar a caixinha') }
  }

  // v13.69 — quitar/reabrir: pedidos antigos foram pagos fora do sistema
  const toggleSettled = async () => {
    if (bal.isManuallySettled) {
      const ok = await confirm({
        title: 'Reabrir cobrança deste pedido?',
        message: 'Ele volta a contar como saldo em aberto no financeiro. Os pagamentos registrados continuam intactos.',
        confirmLabel: 'Reabrir',
      })
      if (!ok) return
      try {
        await updateOrder(o.id, { settled_at: null, settled_note: null })
        writeLog({ userId: user.id, userName: user.name, action: 'reabriu cobrança do pedido', target: o.order_name || o.factory, entityType: 'order', entityId: o.id })
        await onRefresh()
        toast.push('Pedido voltou pra em aberto', { kind: 'success' })
      } catch (e) { toastError(toast, e) }
      return
    }
    const falta = remainUsd > 0.01 ? `Ainda faltam $ ${remainUsd.toFixed(2)} pelos pagamentos registrados.` : 'Os pagamentos registrados já cobrem o total.'
    const ok = await confirm({
      title: 'Marcar como PAGO integralmente?',
      message: `${falta}\n\nUse quando o pedido já foi pago (inclusive fora do sistema) e você não quer lançar os pagamentos antigos um por um.`,
      details: 'O pedido sai do saldo em aberto do financeiro. Nada é apagado e dá pra reabrir depois.',
      confirmLabel: '✓ Marcar como pago',
    })
    if (!ok) return
    try {
      await updateOrder(o.id, {
        settled_at: new Date().toISOString(),
        settled_note: `Quitado manualmente por ${user.name || 'admin'}`,
      })
      writeLog({ userId: user.id, userName: user.name, action: 'marcou pedido como pago integralmente', target: o.order_name || o.factory, details: falta, entityType: 'order', entityId: o.id })
      await onRefresh()
      toast.push('✓ Pedido marcado como pago', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }
  
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
      {tradingModal && (
        <TradingValuesModal
          order={o}
          products={products}
          colors={colors}
          rate={rate}
          onSave={saveTradingValues}
          onClose={() => setTradingModal(false)}
        />
      )}
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
            {/* v13.67 — lançar os valores finais que a trading mandou */}
            {perm.prices && !readOnly && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setTradingModal(true)}
                title="Lançar o valor final por peça que a importadora passou (é o que define quanto você deve)"
              >💵 Valores da trading{!bal.isFullyConfirmed && bal.total > 0 ? ' ⚠' : ''}</button>
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
              const start = parseDateLocal(o.order_date || o.manufacturing_started_at)
              if (!start) return null
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 6, flexWrap: 'wrap' }}>
                <div className="card-title" style={{ margin: 0, color: '#92400E' }}>💰 Pagamentos ({(o.payments || []).length})</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {/* v13.69 — quitar pedidos antigos pagos fora do sistema */}
                  {bal.total > 0 && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={toggleSettled}
                      title={bal.isManuallySettled
                        ? 'Este pedido está marcado como pago integralmente — clique pra reabrir a cobrança'
                        : 'Marcar como pago integralmente (pra pedidos antigos já pagos fora do sistema)'}
                    >{bal.isManuallySettled ? '↩ Reabrir cobrança' : '✓ Marcar como pago'}</button>
                  )}
                  <button className="btn btn-outline btn-sm" onClick={addPay}>+ Pagamento</button>
                </div>
              </div>

              {/* Selo de quitado manualmente */}
              {bal.isManuallySettled && (
                <div style={{ marginBottom: 10, padding: '8px 12px', background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8, fontSize: 12, color: '#065F46' }}>
                  ✓ <strong>Pago integralmente</strong> — marcado em {formatDate(bal.settledAt, 'full')}.
                  {(o.payments || []).length === 0
                    ? ' Os pagamentos foram feitos fora do sistema.'
                    : ` Registrados aqui: $ ${totalPaidUsd.toFixed(2)} de $ ${bal.total.toFixed(2)}.`}
                  <span className="text-muted" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                    Este pedido não entra mais no saldo em aberto do financeiro.
                  </span>
                </div>
              )}
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

              {/* v13.67 — painel medido contra o VALOR FINAL da trading */}
              {bal.total > 0 && (
                <div style={{ marginTop: 12 }}>
                  {/* Barra de quitação */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#92400E', marginBottom: 4 }}>
                      <span>
                        {Math.round(bal.percentPaid)}% pago
                        {bal.isFullyConfirmed
                          ? <span style={{ color: '#166534', fontWeight: 700 }}> · valores confirmados pela trading</span>
                          : <span style={{ fontWeight: 700 }}> · ⚠ {bal.linesConfirmed}/{bal.linesTotal} linhas confirmadas (resto é estimativa)</span>}
                      </span>
                      {avgRate > 0 && totalPaidUsd > 0 && <span>💱 câmbio médio R$ {avgRate.toFixed(4)}</span>}
                    </div>
                    <div style={{ height: 8, borderRadius: 5, background: '#FDE68A', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 5,
                        width: `${Math.min(100, Math.max(0, bal.percentPaid))}%`,
                        background: bal.isSettled ? '#059669' : (bal.percentPaid > 50 ? '#F59E0B' : '#DC2626'),
                        transition: 'width .4s',
                      }} />
                    </div>
                  </div>

                  {/* 4 blocos: FOB (fábrica) · TOTAL DA COMPRA (final) · PAGO · FALTA */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8, border: '1px solid #FDE68A' }}>
                      <div className="text-muted text-xs">FOB (FÁBRICA)</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>$ {bal.fobTotal.toFixed(2)}</div>
                      {bal.multiplier && (
                        <div style={{ fontSize: 11, color: '#92400E', marginTop: 2 }}>fator ×{bal.multiplier.toFixed(3)}</div>
                      )}
                    </div>
                    <div style={{ background: '#F0FDF4', padding: 10, borderRadius: 8, border: '1px solid #86EFAC' }}>
                      <div className="text-xs" style={{ color: '#166534', fontWeight: 700 }}>TOTAL DA COMPRA</div>
                      <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2, color: '#166534' }}>$ {bal.total.toFixed(2)}</div>
                      {bal.projRate > 0 && (
                        <div style={{ fontSize: 11, color: '#166534', marginTop: 2 }}>
                          ≈ R$ {(bal.total * bal.projRate).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                        </div>
                      )}
                    </div>
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8, border: '1px solid #FDE68A' }}>
                      <div className="text-muted text-xs">PAGO</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>$ {totalPaidUsd.toFixed(2)}</div>
                      <div style={{ fontSize: 11, color: '#92400E', marginTop: 2 }}>
                        R$ {totalPaidBrl.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                    <div style={{
                      background: bal.isSettled ? '#ECFDF5' : '#FEF2F2',
                      padding: 10, borderRadius: 8,
                      border: `1px solid ${bal.isSettled ? '#A7F3D0' : '#FCA5A5'}`,
                    }}>
                      <div className="text-xs" style={{ color: bal.isSettled ? '#059669' : '#991B1B', fontWeight: 700 }}>
                        {bal.isSettled ? 'QUITADO' : 'FALTA PAGAR'}
                      </div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: bal.isSettled ? '#059669' : '#DC2626', marginTop: 2 }}>
                        $ {Math.max(0, remainUsd).toFixed(2)}
                      </div>
                      {!bal.isSettled && remainBrl > 0 && (
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', marginTop: 2 }}>
                          R$ {remainBrl.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                        </div>
                      )}
                    </div>
                  </div>

                  {!bal.isFullyConfirmed && (
                    <div style={{ marginTop: 8, padding: '7px 10px', background: '#FFFBEB', border: '1px dashed #FBBF24', borderRadius: 6, fontSize: 11, color: '#92400E' }}>
                      ⚠️ Parte do total é <strong>estimativa</strong> (FOB × fator {(parseFloat(o.conversion_factor) || 1.65)}). Lance os valores em <strong>💵 Valores da trading</strong> pra ter o número exato.
                    </div>
                  )}

                  {/* v13.68 — caixinhas: quanto do que falta já está guardado */}
                  {!readOnly && (
                    <ReservesSection
                      reserves={o.reserves || []}
                      balance={bal}
                      onSave={saveReserves}
                    />
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
