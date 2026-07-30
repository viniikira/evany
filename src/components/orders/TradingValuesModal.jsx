// src/components/orders/TradingValuesModal.jsx
// v13.67 — Lançamento dos VALORES FINAIS da trading.
//
// Fluxo real da dona: o pedido nasce com o FOB (o que a fábrica cobra). Depois
// da revisão, a trading devolve o valor FINAL de cada linha (FOB + impostos +
// frete + tudo), com multiplicador ~1,5–1,8 que varia por produto E por cor.
// O que ela paga é o FINAL — daí essa tela.
//
// Cada linha mostra FOB → [final] e o multiplicador ao vivo. Atalho opcional:
// aplicar um fator nas linhas vazias (pra quando o padrão se repete) — mas a
// digitação linha por linha é o caminho principal, como a planilha da trading.

import { useState, useMemo } from 'react'
import { Modal, MH, MB, MF, SaveButton } from '../ui'
import { ColorSwatch } from '../ColorSwatch'
import { computeOrderLines, DEFAULT_TRADING_FACTOR } from '../../lib/financial'
import { UC } from '../../lib/utils'

const fmt$ = (n) => '$' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtR$ = (n) => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR')

export function TradingValuesModal({ order, products = [], colors = [], rate, onSave, onClose }) {
  // Espelho editável dos itens (só o que esta tela mexe: final do item e das cores)
  const [items, setItems] = useState(() => (order.items || []).map(it => ({
    ...it,
    colors: (it.colors || []).map(c => ({ ...c })),
  })))
  const [bulkFactor, setBulkFactor] = useState('')
  const [dirty, setDirty] = useState(false)

  const setItemFinal = (itemId, val) => {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, final_price_usd: val } : it))
    setDirty(true)
  }
  const setColorFinal = (itemId, idx, val) => {
    setItems(prev => prev.map(it => {
      if (it.id !== itemId) return it
      const cls = [...(it.colors || [])]
      cls[idx] = { ...cls[idx], final_price_usd: val }
      return { ...it, colors: cls }
    }))
    setDirty(true)
  }

  // v13.70 — o FOB também é editável aqui: pedidos antigos foram criados sem
  // preço, e sem FOB não há fator nem custo de fábrica. Grava no snapshot
  // (que é o valor congelado usado por todo o financeiro) e no price_usd.
  const setItemFob = (itemId, val) => {
    setItems(prev => prev.map(it => it.id === itemId
      ? { ...it, price_usd: val, price_usd_snapshot: val }
      : it))
    setDirty(true)
  }
  const setColorFob = (itemId, idx, val) => {
    setItems(prev => prev.map(it => {
      if (it.id !== itemId) return it
      const cls = [...(it.colors || [])]
      cls[idx] = { ...cls[idx], price_usd: val }
      return { ...it, colors: cls }
    }))
    setDirty(true)
  }

  // Aplica um fator nas linhas AINDA VAZIAS (atalho — não sobrescreve nada)
  const applyBulkFactor = () => {
    const f = parseFloat(bulkFactor)
    if (!(f > 0)) return
    setItems(prev => prev.map(it => {
      const fobItem = parseFloat(it.price_usd_snapshot ?? it.price_usd) || 0
      const cls = (it.colors || []).map(c => {
        const hasOwn = c.final_price_usd != null && c.final_price_usd !== ''
        if (hasOwn) return c
        const fob = parseFloat(c.price_usd) || fobItem
        if (!(fob > 0)) return c
        return { ...c, final_price_usd: (fob * f).toFixed(2) }
      })
      const itemHas = it.final_price_usd != null && it.final_price_usd !== ''
      return {
        ...it,
        colors: cls,
        final_price_usd: itemHas || !(fobItem > 0) ? it.final_price_usd : (fobItem * f).toFixed(2),
      }
    }))
    setDirty(true)
  }

  const clearAll = () => {
    setItems(prev => prev.map(it => ({
      ...it,
      final_price_usd: null,
      colors: (it.colors || []).map(c => ({ ...c, final_price_usd: null })),
    })))
    setDirty(true)
  }

  // Totais ao vivo (usa a MESMA lógica do resto do sistema)
  const totals = useMemo(() => {
    const lines = computeOrderLines({ ...order, items })
    const withQty = lines.filter(l => l.qty > 0)
    return {
      fob: withQty.reduce((s, l) => s + l.fobTotal, 0),
      final: withQty.reduce((s, l) => s + l.finalTotal, 0),
      qty: withQty.reduce((s, l) => s + l.qty, 0),
      confirmed: withQty.filter(l => l.isConfirmed).length,
      lines: withQty.length,
    }
  }, [order, items])

  const effMult = totals.fob > 0 ? totals.final / totals.fob : null
  const fx = parseFloat(order.budget_rate) || parseFloat(rate) || 0

  const modelInfo = (it) => {
    const prod = products.find(p => p.id === it.product_id)
    return {
      name: it.name_manual || prod?.name || it.product_name_snapshot || '?',
      photo: prod?.card_image_url || (prod?.photos || [])[0] || it.selected_photo_url || null,
    }
  }

  return (
    <Modal onClose={onClose} width={820} isDirty={dirty} zIndex={960}>
      <MH title="💵 Valores do pedido — FOB e final da trading" onClose={onClose} />
      <MB>
        <div style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)', marginBottom: 12, lineHeight: 1.5 }}>
          <strong>FOB</strong> = o que a fábrica cobra (custo de fábrica, editável aqui).
          <strong>Final</strong> = o valor por peça que a importadora passou, já com impostos e frete — é esse que o sistema
          usa como <strong>o que você deve</strong>. Linhas de final em branco ficam como <em>estimativa</em> (FOB × fator do pedido).
        </div>

        {/* Atalho: aplicar fator nas vazias */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 10px', background: 'var(--bg)', borderRadius: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)' }}>Atalho — aplicar fator nas linhas vazias:</span>
          <input
            className="field field-sm"
            type="number" step="0.01" min="1"
            placeholder={String(DEFAULT_TRADING_FACTOR)}
            value={bulkFactor}
            onChange={e => setBulkFactor(e.target.value)}
            style={{ width: 80 }}
            aria-label="Fator pra aplicar nas linhas vazias"
          />
          <button className="btn btn-outline btn-sm" onClick={applyBulkFactor} disabled={!(parseFloat(bulkFactor) > 0)}>
            Aplicar nas vazias
          </button>
          <button className="btn btn-outline btn-sm" onClick={clearAll} style={{ marginLeft: 'auto' }} title="Apaga todos os valores finais deste pedido">
            Limpar tudo
          </button>
        </div>

        {/* Linhas */}
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 10, padding: '6px 12px', background: 'var(--bg)', fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted, #6b7280)' }}>
            <div style={{ flex: 1 }}>Produto · cor</div>
            <div style={{ width: 60, textAlign: 'center' }}>qtd</div>
            <div style={{ width: 74, textAlign: 'center' }}>FOB/un</div>
            <div style={{ width: 112, textAlign: 'center' }}>final/un</div>
            <div style={{ width: 52, textAlign: 'center' }}>fator</div>
            <div style={{ width: 92, textAlign: 'right' }}>total final</div>
          </div>

          {items.map(it => {
            const info = modelInfo(it)
            const fobItem = parseFloat(it.price_usd_snapshot ?? it.price_usd) || 0
            const cls = it.colors || []
            const rows = cls.length > 0
              ? cls.map((c, idx) => ({ kind: 'color', c, idx }))
              : [{ kind: 'item' }]

            // Cabeçalho do produto com o "final base" — as cores herdam dele
            // (mesma mecânica do FOB: preço do item + override por cor). Evita
            // digitar o mesmo valor 6 vezes quando a trading repete o número.
            const itemFinalNum = parseFloat(it.final_price_usd) || 0
            const itemMult = fobItem > 0 && itemFinalNum > 0 ? itemFinalNum / fobItem : null
            const header = cls.length > 0 ? (
              <div
                key={`${it.id}-head`}
                style={{
                  display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px',
                  borderTop: '1px solid var(--border)', background: 'var(--bg)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {info.photo
                    ? <img src={info.photo} alt="" style={{ width: 26, height: 34, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                    : <span style={{ width: 26, flexShrink: 0 }} />}
                  <strong style={{ fontSize: 12.5 }}>{UC(info.name)}</strong>
                  <span style={{ fontSize: 10, color: 'var(--text-muted, #6b7280)' }}>
                    valor base — as cores herdam (dá pra sobrescrever abaixo)
                  </span>
                </div>
                <div style={{ width: 60 }} />
                {/* FOB base do produto — editável (v13.70) */}
                <div style={{ width: 74, display: 'flex', alignItems: 'center', gap: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '0 6px', height: 30, background: 'var(--surface)' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted, #6b7280)' }}>$</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={it.price_usd_snapshot ?? it.price_usd ?? ''}
                    onChange={e => setItemFob(it.id, e.target.value)}
                    aria-label={`FOB base de ${info.name}`}
                    placeholder="—"
                    style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontSize: 12, color: 'var(--text)' }}
                  />
                </div>
                <div style={{ width: 112, display: 'flex', alignItems: 'center', gap: 2, border: `1px solid ${itemFinalNum > 0 ? '#059669' : 'var(--border)'}`, borderRadius: 8, padding: '0 8px', height: 30, background: itemFinalNum > 0 ? '#F0FDF4' : 'var(--surface)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)' }}>$</span>
                  <input
                    type="number" step="0.01" min="0"
                    value={it.final_price_usd ?? ''}
                    onChange={e => setItemFinal(it.id, e.target.value)}
                    aria-label={`Valor final base de ${info.name}`}
                    placeholder="—"
                    style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontSize: 13, fontWeight: itemFinalNum > 0 ? 700 : 400, color: 'var(--text)' }}
                  />
                </div>
                <div style={{ width: 52, textAlign: 'center', fontSize: 11, fontWeight: 700, color: itemMult ? (itemMult > 2 ? '#B45309' : '#059669') : 'var(--text-muted, #6b7280)' }}>
                  {itemMult ? '×' + itemMult.toFixed(2) : '—'}
                </div>
                <div style={{ width: 92 }} />
              </div>
            ) : null

            return [header, ...rows.map((row, ri) => {
              const isColor = row.kind === 'color'
              const qty = isColor ? Number(row.c.qty || 0) : Number(it.quantity || 0)
              const fob = isColor ? (parseFloat(row.c.price_usd) || fobItem) : fobItem
              const rawFinal = isColor
                ? (row.c.final_price_usd ?? (it.final_price_usd ?? ''))
                : (it.final_price_usd ?? '')
              const ownFinal = isColor ? row.c.final_price_usd : it.final_price_usd
              const hasOwn = ownFinal != null && ownFinal !== ''
              const inherited = !hasOwn && it.final_price_usd != null && it.final_price_usd !== '' && isColor
              const finalNum = parseFloat(rawFinal) || 0
              const mult = fob > 0 && finalNum > 0 ? finalNum / fob : null
              const totalLine = finalNum * qty

              return (
                <div
                  key={`${it.id}-${isColor ? row.idx : 'item'}`}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', padding: '7px 12px',
                    borderTop: '1px solid var(--border-light, var(--border))',
                    background: qty === 0 ? 'var(--bg)' : undefined, opacity: qty === 0 ? .55 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: isColor ? 34 : 0 }}>
                    {!isColor && (info.photo
                      ? <img src={info.photo} alt="" style={{ width: 26, height: 34, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                      : <span style={{ width: 26, flexShrink: 0 }} />)}
                    {isColor && <ColorSwatch code={row.c.code} colors={colors} size="sm" />}
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isColor
                        ? <strong>{row.c.code}</strong>
                        : <strong>{UC(info.name)}</strong>}
                    </span>
                  </div>
                  <div style={{ width: 60, textAlign: 'center', fontSize: 12, fontWeight: 600 }}>{qty}</div>
                  {/* FOB da linha — editável; vazio herda o do produto (v13.70) */}
                  <div style={{ width: 74, display: 'flex', alignItems: 'center', gap: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '0 6px', height: 30, background: 'var(--surface)' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted, #6b7280)' }}>$</span>
                    <input
                      type="number" step="0.01" min="0"
                      value={isColor ? (row.c.price_usd ?? '') : (it.price_usd_snapshot ?? it.price_usd ?? '')}
                      placeholder={isColor && fobItem > 0 ? fobItem.toFixed(2) : '—'}
                      onChange={e => isColor ? setColorFob(it.id, row.idx, e.target.value) : setItemFob(it.id, e.target.value)}
                      aria-label={`FOB ${isColor ? 'da cor ' + row.c.code : 'do item'} ${info.name}`}
                      title={isColor ? 'Vazio herda o FOB do produto' : undefined}
                      style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontSize: 12, color: 'var(--text)' }}
                    />
                  </div>
                  <div style={{ width: 112, display: 'flex', alignItems: 'center', gap: 2, border: `1px solid ${hasOwn ? '#059669' : 'var(--border)'}`, borderRadius: 8, padding: '0 8px', height: 30, background: hasOwn ? '#F0FDF4' : 'var(--surface)' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)' }}>$</span>
                    <input
                      type="number" step="0.01" min="0"
                      value={hasOwn ? ownFinal : ''}
                      placeholder={inherited ? parseFloat(it.final_price_usd).toFixed(2) : '—'}
                      onChange={e => isColor
                        ? setColorFinal(it.id, row.idx, e.target.value)
                        : setItemFinal(it.id, e.target.value)}
                      aria-label={`Valor final ${isColor ? 'da cor ' + row.c.code : 'do item'} ${info.name}`}
                      title={inherited ? `Herdando ${fmt$(parseFloat(it.final_price_usd))} do item — digite pra sobrescrever` : undefined}
                      style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontSize: 13, fontWeight: hasOwn ? 700 : 400, color: 'var(--text)' }}
                    />
                  </div>
                  <div style={{ width: 52, textAlign: 'center', fontSize: 11, fontWeight: 700, color: mult ? (mult > 2 ? '#B45309' : '#059669') : 'var(--text-muted, #6b7280)' }}>
                    {mult ? '×' + mult.toFixed(2) : '—'}
                  </div>
                  <div style={{ width: 92, textAlign: 'right', fontSize: 12, fontWeight: 700 }}>
                    {totalLine > 0 ? fmt$(totalLine) : ''}
                  </div>
                </div>
              )
            })]
          })}
        </div>

        {/* Totais */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
          <div style={{ flex: 1, minWidth: 130, padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted, #6b7280)' }}>FOB (fábrica)</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{fmt$(totals.fob)}</div>
          </div>
          <div style={{ flex: 1, minWidth: 130, padding: 12, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 8 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: '#166534' }}>Total da compra (final)</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2, color: '#166534' }}>{fmt$(totals.final)}</div>
            {fx > 0 && <div style={{ fontSize: 11, color: '#166534', opacity: .8 }}>≈ {fmtR$(totals.final * fx)} a {fx.toFixed(2)}</div>}
          </div>
          <div style={{ flex: 1, minWidth: 130, padding: 12, background: 'var(--bg)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted, #6b7280)' }}>Multiplicador médio</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{effMult ? '×' + effMult.toFixed(3) : '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)' }}>{totals.qty} peças</div>
          </div>
          <div style={{ flex: 1, minWidth: 130, padding: 12, background: totals.confirmed === totals.lines ? '#F0FDF4' : '#FFFBEB', border: `1px solid ${totals.confirmed === totals.lines ? '#86EFAC' : '#FDE68A'}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: totals.confirmed === totals.lines ? '#166534' : '#92400E' }}>Linhas confirmadas</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: totals.confirmed === totals.lines ? '#166534' : '#92400E' }}>
              {totals.confirmed}/{totals.lines}
            </div>
            {totals.confirmed < totals.lines && (
              <div style={{ fontSize: 10, color: '#92400E' }}>o resto é estimativa</div>
            )}
          </div>
        </div>
      </MB>
      <MF>
        <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <SaveButton onSave={() => onSave(items)}>Salvar valores</SaveButton>
      </MF>
    </Modal>
  )
}
