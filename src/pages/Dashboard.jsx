// src/pages/Dashboard.jsx
// v13.26 — Dashboard redesenhado:
//   1) Cabeçalho contextual: saudação + data + câmbio Wise + contador de atenções
//   2) ATENÇÕES (zona acionável): pedidos atrasados, cores presas, comprovantes faltando
//   3) Stats originais (mantidas — opção B): 7 cards em 2 linhas
//      - "Cores em Produção" agora fica VERMELHO + ⚠️ se há cores presas (sem pedido ativo)
//   4) OPERACIONAL: 3 colunas (Pedidos por status / Pipeline produtos / Catálogo)
//   5) Atividades recentes
//   6) Ações Rápidas
//
// Sem valores monetários (decisão da usuária). Câmbio Wise no topo (decisão da usuária).

import { useMemo, useState } from 'react'
import { PROD_ST, ORDER_ST, IDEA_ST } from '../lib/constants'
import { Modal, MH, MB } from '../components/ui'
import { ColorGridCard } from '../components/ColorGridCard'
import { useFavorites } from '../hooks/useFavorites'
import { ExchangeRateAlert } from '../components/ExchangeRateAlert'
import { formatDate } from '../lib/utils'
import { computeAttentions, findStuckColors } from '../lib/dashboardInsights'

export default function Dashboard({
  ideas, products, orders, names, colors, logs, shopifyCache, perm, setPage,
  onOpenTarget, rate, userName,
}) {
  const [colorModal, setColorModal] = useState(null)
  // v13.44 — Modo Foco: persiste em localStorage pra manter preferência entre sessões
  const [focusMode, setFocusMode] = useState(() => {
    try { return localStorage.getItem('kira.dashboard.focusMode') === '1' }
    catch { return false }
  })
  const toggleFocus = () => {
    setFocusMode(v => {
      const next = !v
      try { localStorage.setItem('kira.dashboard.focusMode', next ? '1' : '0') } catch {}
      return next
    })
  }
  // v13.44 — Favoritos (hook carrega em background)
  const favs = useFavorites()
  
  // Memoização: indexação colors por code
  const colorsByCode = useMemo(() => {
    const m = new Map()
    for (const c of colors) m.set(c.code, c)
    return m
  }, [colors])
  
  // Stats originais (mantidas) + novas detecções
  const stats = useMemo(() => {
    const act = ideas.filter(i => i.status !== 'discarded').length
    const pendOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length
    const avail = names.length
    
    // Cores por status (mantém estrutura original pra não quebrar o modal)
    const colorsByStatus = { production: [], idea: [], catalog: [] }
    for (const p of products) {
      for (const cv of (p.color_variants || [])) {
        const s = cv.status || 'catalog'
        if (!colorsByStatus[s]) continue
        const colorData = colorsByCode.get(cv.code)
        colorsByStatus[s].push({
          product: (p.name || '').toUpperCase(),
          productId: p.id,
          code: cv.code,
          sku: cv.sku,
          photo: p.card_image_url || (p.photos || [])[0],
          colorPhoto: colorData?.photo_url,
          colorHex: colorData?.hex,
          factory: p.factory,
          collection: p.collection,
        })
      }
    }
    for (const arr of Object.values(colorsByStatus)) {
      arr.sort((a, b) => a.product.localeCompare(b.product) || a.code.localeCompare(b.code))
    }
    
    const totalPiecesOrdered = orders
      .filter(o => o.status !== 'completed' && o.status !== 'cancelled')
      .reduce((a, o) => a + (o.items || []).reduce((b, it) => {
        const cls = it.colors || []
        return b + cls.reduce((c, cl) => c + Number(cl.qty || 0), 0)
             + (cls.length === 0 ? Number(it.quantity || 0) : 0)
      }, 0), 0)
    
    // Cores travadas (pra deixar card laranja → vermelho)
    const stuck = findStuckColors(orders, products)
    
    // Pedidos por status (zona Operacional)
    const ordersByStatus = {}
    for (const o of orders) {
      if (o.status === 'cancelled') continue
      ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1
    }
    
    // Concluídos este mês
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    const completedThisMonth = orders.filter(o => {
      if (o.status !== 'completed') return false
      const d = new Date(o.updated_at || o.created_at)
      return !isNaN(d.getTime()) && d >= startOfMonth
    }).length
    
    // Pipeline de produtos
    const productsByStatus = {}
    for (const p of products) {
      productsByStatus[p.status] = (productsByStatus[p.status] || 0) + 1
    }
    
    // Pipeline de ideias
    const ideasByStatus = {}
    for (const i of ideas) {
      if (i.status === 'discarded') continue
      ideasByStatus[i.status] = (ideasByStatus[i.status] || 0) + 1
    }
    
    return {
      act, pendOrders, avail, colorsByStatus, totalPiecesOrdered,
      stuck,
      ordersByStatus,
      completedThisMonth,
      productsByStatus,
      ideasByStatus,
    }
  }, [ideas, products, orders, names, colorsByCode])
  
  // Atenções urgentes (zona HOJE)
  const attentions = useMemo(() => computeAttentions(orders, products), [orders, products])

  // v13.44 — Lista de favoritos resolvidos (produtos + ideias)
  // Busca nos arrays já carregados; rápido e sem query extra.
  const favoriteItems = useMemo(() => {
    if (!favs.ready) return []
    const items = []
    for (const p of products) {
      if (favs.isFav('product', p.id)) {
        items.push({
          kind: 'product', id: p.id, name: p.name,
          factory: p.factory,
          photo: p.card_image_url || (p.photos || [])[0],
          goTo: 'products',
        })
      }
    }
    for (const i of ideas) {
      if (favs.isFav('idea', i.id)) {
        items.push({
          kind: 'idea', id: i.id, name: i.name,
          factory: null,
          photo: i.card_image_url || (i.photos || [])[0],
          goTo: 'ideas',
        })
      }
    }
    return items.slice(0, 8)  // limita a 8 no atalho do dashboard
  }, [favs, products, ideas])
  
  // Saudação contextual
  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'Bom dia'
    if (h < 18) return 'Boa tarde'
    return 'Boa noite'
  }, [])
  
  const todayLabel = useMemo(() => {
    return new Date().toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
  }, [])
  
  const stuckCount = stats.stuck.length
  const productionHasIssue = stuckCount > 0
  
  return (
    <div>
      {/* ════════════════════════════════════════════════════════════
          ZONA 1 — CABEÇALHO CONTEXTUAL
          ════════════════════════════════════════════════════════════ */}
      <div style={{
        background: 'linear-gradient(135deg, #faf8f6, #fff)',
        border: '1px solid var(--border-light)',
        borderRadius: 12,
        padding: '14px 18px',
        marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{
            fontFamily: "'Fraunces', serif",
            fontSize: 20, fontWeight: 600, color: 'var(--primary)',
            lineHeight: 1.1,
          }}>
            {greeting}{userName ? `, ${userName.split(' ')[0]}` : ''} 👋
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4, textTransform: 'capitalize' }}>
            {todayLabel}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {rate > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div className="text-muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>💱 CÂMBIO WISE</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0891B2' }}>R$ {rate.toFixed(4)}</div>
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div className="text-muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>⚡ ATENÇÕES</div>
            <div style={{
              fontSize: 16, fontWeight: 700,
              color: attentions.all.length === 0 ? '#059669' : (attentions.all.some(a => a.severity === 'critical') ? '#DC2626' : '#F59E0B'),
            }}>
              {attentions.all.length === 0 ? '✓ tudo ok' : `${attentions.all.length} item${attentions.all.length !== 1 ? 's' : ''}`}
            </div>
          </div>
          {/* v13.44 — Botão Modo Foco */}
          <button
            onClick={toggleFocus}
            title={focusMode ? 'Sair do Modo Foco' : 'Ativar Modo Foco — mostra só as atenções urgentes'}
            style={{
              border: '1px solid var(--border)',
              background: focusMode ? 'var(--accent)' : 'var(--surface)',
              color: focusMode ? '#fff' : 'var(--text-secondary)',
              padding: '8px 14px',
              borderRadius: 20,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all .2s',
              letterSpacing: 0.02,
            }}
          >
            <span style={{ fontSize: 14 }}>{focusMode ? '◉' : '◎'}</span>
            {focusMode ? 'Sair do Foco' : 'Modo Foco'}
          </button>
        </div>
      </div>

      {/* v13.44 — Alerta de anomalia de câmbio (some se câmbio estiver normal) */}
      <div style={{ marginBottom: 10 }}>
        <ExchangeRateAlert />
      </div>
      
      {/* ════════════════════════════════════════════════════════════
          ZONA 2 — HOJE (atenções urgentes)
          ════════════════════════════════════════════════════════════ */}
      {attentions.all.length === 0 ? (
        <div style={{
          background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 12,
          padding: 16, marginBottom: 14, textAlign: 'center',
        }}>
          <div style={{ fontSize: 24, marginBottom: 4 }}>✨</div>
          <div style={{ fontWeight: 600, color: '#065F46' }}>Tudo em ordem hoje!</div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
            Sem pedidos atrasados, sem cores presas, sem comprovantes faltando.
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🚨 Atenções pra hoje ({attentions.all.length})</span>
            {attentions.hiddenCount > 0 && (
              <span className="text-muted text-xs">+{attentions.hiddenCount} não exibida{attentions.hiddenCount !== 1 ? 's' : ''}</span>
            )}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10,
          }}>
            {attentions.visible.map(a => <AttentionCard key={a.id} attention={a} setPage={setPage} onOpenTarget={onOpenTarget} />)}
          </div>
        </div>
      )}

      {/* v13.44 — SEÇÃO FAVORITOS (some em Modo Foco) */}
      {!focusMode && favoriteItems.length > 0 && (
        <FavoritesStrip items={favoriteItems} setPage={setPage} />
      )}

      {/* v13.44 — TUDO abaixo das atenções some em Modo Foco */}
      {!focusMode && (<>
      {/* ════════════════════════════════════════════════════════════
          ZONA 3 — STATS ORIGINAIS (mantidas — opção B)
          ════════════════════════════════════════════════════════════ */}
      <div className="stats-grid">
        {perm.ideas ? (
          <div className="stat-card clickable" onClick={() => setPage('ideas')}>
            <div className="stat-val" style={{ color: '#8B5CF6' }}>{stats.act}</div>
            <div className="stat-lbl">Ideias Ativas</div>
          </div>
        ) : null}
        <div className="stat-card clickable" onClick={() => setPage('products')}>
          <div className="stat-val">{products.length}</div>
          <div className="stat-lbl">Produtos</div>
        </div>
        {perm.orders ? (
          <div className="stat-card clickable" onClick={() => setPage('orders')}>
            <div className="stat-val" style={{ color: '#F59E0B' }}>{stats.pendOrders}</div>
            <div className="stat-lbl">Pedidos Abertos</div>
          </div>
        ) : null}
        {perm.names ? (
          <div className="stat-card clickable" onClick={() => setPage('names')}>
            <div className="stat-val" style={{ color: stats.avail < 10 ? '#EF4444' : undefined }}>
              {stats.avail}
            </div>
            <div className="stat-lbl">Nomes Livres</div>
          </div>
        ) : null}
      </div>
      
      <div className="stats-grid" style={{ gridTemplateColumns: perm.orders ? 'repeat(3,1fr)' : 'repeat(2,1fr)' }}>
        {/* CARD COR EM PRODUÇÃO — v13.40 click vai direto pra página Produção dedicada */}
        <div
          className="stat-card clickable"
          onClick={() => stats.colorsByStatus.production.length > 0 && setPage('producao')}
          style={{
            border: productionHasIssue
              ? '2px solid #DC2626'
              : (stats.colorsByStatus.production.length > 0 ? '2px solid #F59E0B' : undefined),
            background: productionHasIssue ? '#FEF2F2' : undefined,
            position: 'relative',
          }}
          title={productionHasIssue ? `${stuckCount} cor(es) presa(s) sem pedido ativo — abre página Produção` : 'Abre página Produção'}
        >
          {productionHasIssue && (
            <span style={{
              position: 'absolute', top: 6, right: 8, fontSize: 16,
            }}>⚠️</span>
          )}
          <div className="stat-val" style={{
            color: productionHasIssue ? '#DC2626' : '#F59E0B',
            fontSize: 28,
          }}>
            {stats.colorsByStatus.production.length}
          </div>
          <div className="stat-lbl">
            Cores em Produção
            {productionHasIssue && (
              <div style={{ fontSize: 10, color: '#DC2626', fontWeight: 600, marginTop: 2 }}>
                {stuckCount} presa{stuckCount !== 1 ? 's' : ''} sem pedido
              </div>
            )}
          </div>
        </div>
        <div
          className="stat-card clickable"
          onClick={() => stats.colorsByStatus.idea.length > 0 && setColorModal({ title: '💡 Cores em Ideia', list: stats.colorsByStatus.idea, stuckIds: new Set() })}
          style={{ border: stats.colorsByStatus.idea.length > 0 ? '2px solid #8B5CF6' : undefined }}
        >
          <div className="stat-val" style={{ color: '#8B5CF6', fontSize: 28 }}>{stats.colorsByStatus.idea.length}</div>
          <div className="stat-lbl">Cores em Ideia</div>
        </div>
        {perm.orders ? (
          <div className="stat-card">
            <div className="stat-val" style={{ fontSize: 28 }}>{stats.totalPiecesOrdered}</div>
            <div className="stat-lbl">Peças em Pedidos</div>
          </div>
        ) : null}
      </div>
      
      {/* ════════════════════════════════════════════════════════════
          ZONA 4 — OPERACIONAL (3 colunas)
          ════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 12,
        marginBottom: 14,
      }}>
        {/* Pedidos por status */}
        {perm.orders && (
          <div className="card">
            <div className="card-title">📋 Pedidos por status</div>
            {ORDER_ST.filter(s => s.id !== 'cancelled').map(s => {
              const c = stats.ordersByStatus[s.id] || 0
              return (
                <div key={s.id} className="pipe-row" style={{ cursor: c > 0 ? 'pointer' : 'default' }}
                  onClick={() => c > 0 && setPage('orders')}>
                  <span className="pipe-icon">{s.icon}</span>
                  <span className="pipe-lbl" style={{ fontSize: 12 }}>{s.label}</span>
                  <span className="pipe-val" style={{ color: s.color, fontWeight: 700, marginLeft: 'auto' }}>{c}</span>
                </div>
              )
            })}
            {stats.completedThisMonth > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-light)' }}>
                <div className="text-muted" style={{ fontSize: 11, textAlign: 'center' }}>
                  ✓ <strong>{stats.completedThisMonth}</strong> concluído{stats.completedThisMonth !== 1 ? 's' : ''} este mês
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Pipeline de produtos */}
        <div className="card">
          <div className="card-title">👑 Pipeline de produtos</div>
          {PROD_ST.map(s => {
            const c = stats.productsByStatus[s.id] || 0
            return c > 0 ? (
              <div key={s.id} className="pipe-row" style={{ cursor: 'pointer' }}
                onClick={() => setPage('products')}>
                <span className="pipe-icon">{s.icon}</span>
                <span className="pipe-lbl" style={{ fontSize: 12 }}>{s.label}</span>
                <div className="pipe-track">
                  <div className="pipe-fill" style={{ width: `${Math.min(c / Math.max(products.length, 1) * 100, 100)}%`, background: s.color }} />
                </div>
                <span className="pipe-val" style={{ color: s.color }}>{c}</span>
              </div>
            ) : null
          })}
          {products.length === 0 && <p className="text-muted text-sm">Nenhum produto.</p>}
        </div>
        
        {/* Ideias por estágio */}
        {perm.ideas && (
          <div className="card">
            <div className="card-title">💡 Ideias por estágio</div>
            {IDEA_ST.filter(s => s.id !== 'discarded').map(s => {
              const c = stats.ideasByStatus[s.id] || 0
              return c > 0 ? (
                <div key={s.id} className="pipe-row" style={{ cursor: 'pointer' }}
                  onClick={() => setPage('ideas')}>
                  <span className="pipe-icon">{s.icon}</span>
                  <span className="pipe-lbl" style={{ fontSize: 12 }}>{s.label}</span>
                  <span className="pipe-val" style={{ color: s.color, fontWeight: 700, marginLeft: 'auto' }}>{c}</span>
                </div>
              ) : null
            })}
            {stats.act === 0 && <p className="text-muted text-sm">Nenhuma ideia ativa.</p>}
          </div>
        )}
      </div>
      
      {/* Banner Shopify (se conectado) */}
      {perm.shopify && shopifyCache?.last_sync && (
        <div className="card mb-md" style={{ background: 'linear-gradient(135deg,#f0fdf4,#ecfdf5)', border: '1px solid #86efac' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="card-title" style={{ color: '#166534', margin: 0 }}>🛒 Shopify</div>
              <div className="text-muted text-sm">
                Sync: {new Date(shopifyCache.last_sync).toLocaleString('pt-BR')}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#166534' }}>
                {(shopifyCache.products || []).length}
              </div>
              <div className="text-muted text-xs">na loja</div>
            </div>
          </div>
        </div>
      )}
      
      {/* ════════════════════════════════════════════════════════════
          ZONA 5 — ATIVIDADE RECENTE
          ════════════════════════════════════════════════════════════ */}
      {perm.logs && (
        <div className="card mb-md">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>🕒 Atividade recente</span>
            <button className="btn btn-outline btn-sm" onClick={() => setPage('logs')}>Ver tudo</button>
          </div>
          {logs.length === 0 ? (
            <p className="text-muted text-sm">Nenhuma atividade registrada.</p>
          ) : (
            logs.slice(0, 5).map(l => (
              <div key={l.id} className="activity-row">
                <div className="act-dot" style={{ background: '#C6A86C' }} />
                <div style={{ flex: 1 }}>
                  <div className="text-sm">
                    <strong>{l.user_name_snapshot}</strong> {l.action}{' '}
                    <span className="text-muted">{l.target}</span>
                  </div>
                </div>
                <span className="text-muted text-xs">
                  {new Date(l.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          )}
        </div>
      )}
      
      {/* ════════════════════════════════════════════════════════════
          ZONA 6 — AÇÕES RÁPIDAS
          ════════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 8,
        marginBottom: 14,
      }}>
        {perm.orders && (
          <button className="btn btn-primary" onClick={() => setPage('orders')}>
            + Novo Pedido
          </button>
        )}
        {perm.ideas && (
          <button className="btn btn-outline" onClick={() => setPage('ideas')}>
            💡 + Nova Ideia
          </button>
        )}
        {perm.products && (
          <button className="btn btn-outline" onClick={() => setPage('products')}>
            👑 Produtos
          </button>
        )}
        {perm.colors && (
          <button className="btn btn-outline" onClick={() => setPage('colors')}>
            🎨 Banco de Cores
          </button>
        )}
      </div>
      </>)}
      
      {/* ════════════════════════════════════════════════════════════
          MODAL DE CORES (mantido)
          ════════════════════════════════════════════════════════════ */}
      {colorModal && (
        <Modal onClose={() => setColorModal(null)} width={680} allowOutsideClose>
          <MH title={colorModal.title} onClose={() => setColorModal(null)} />
          <MB>
            <div className="text-muted text-sm mb-md">
              {colorModal.list.length} cor{colorModal.list.length !== 1 ? 'es' : ''} no total
              {colorModal.list.length > 0 && ` · ${new Set(colorModal.list.map(c => c.productId)).size} produto${new Set(colorModal.list.map(c => c.productId)).size > 1 ? 's' : ''}`}
              {colorModal.stuckIds?.size > 0 && (
                <span style={{ color: '#DC2626', fontWeight: 600, marginLeft: 6 }}>
                  · ⚠️ {colorModal.stuckIds.size} sem pedido ativo
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {colorModal.list.map((c, i) => {
                const isStuck = colorModal.stuckIds?.has(`${c.productId}|${c.code}`)
                return (
                  <ColorGridCard
                    key={`${c.productId}|${c.code}|${i}`}
                    photo={c.photo}
                    colorPhoto={c.colorPhoto}
                    colorHex={c.colorHex}
                    code={c.code}
                    product={c.product}
                    factory={c.factory}
                    factoryVisible={perm.factoryInfo}
                    isStuck={isStuck}
                    onClick={() => { setColorModal(null); setPage('products') }}
                  />
                )
              })}
            </div>
          </MB>
        </Modal>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// v13.44 — SEÇÃO FAVORITOS (strip horizontal compacta no Dashboard)
// ═══════════════════════════════════════════════════════════════════
function FavoritesStrip({ items, setPage }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="card-title" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--accent)', fontSize: 16 }}>★</span>
        <span>Favoritos</span>
        <span className="text-muted text-xs" style={{ fontWeight: 400 }}>
          · {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div style={{
        display: 'flex',
        gap: 10,
        overflowX: 'auto',
        paddingBottom: 4,
        scrollbarWidth: 'thin',
      }}>
        {items.map(item => (
          <button
            key={`${item.kind}-${item.id}`}
            onClick={() => setPage(item.goTo)}
            title={`Abrir ${item.kind === 'product' ? 'Produtos' : 'Ideias'}`}
            style={{
              flexShrink: 0,
              width: 140,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 8,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all .2s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--accent)'
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(74,25,66,.08)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.transform = ''
              e.currentTarget.style.boxShadow = ''
            }}
          >
            <div style={{
              aspectRatio: '3/4',
              background: 'var(--border-light)',
              borderRadius: 6,
              overflow: 'hidden',
              marginBottom: 6,
              position: 'relative',
            }}>
              {item.photo ? (
                <img src={item.photo} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 28, opacity: .3 }}>
                  {item.kind === 'product' ? '👑' : '💡'}
                </div>
              )}
              <div style={{
                position: 'absolute', top: 4, right: 4,
                background: 'var(--accent)', color: '#fff',
                fontSize: 9, fontWeight: 700, padding: '2px 6px',
                borderRadius: 8, letterSpacing: .4, textTransform: 'uppercase',
              }}>
                {item.kind === 'product' ? 'produto' : 'ideia'}
              </div>
            </div>
            <div style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text)',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {item.name || '—'}
            </div>
            {item.factory && (
              <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>
                {item.factory}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// CARD DE ATENÇÃO (zona HOJE)
// ═══════════════════════════════════════════════════════════════════
function AttentionCard({ attention: a, setPage, onOpenTarget }) {
  const sevColors = {
    critical: { border: '#DC2626', bg: '#FEF2F2', text: '#991B1B', accent: '#DC2626' },
    warning:  { border: '#F59E0B', bg: '#FFFBEB', text: '#78350F', accent: '#F59E0B' },
    info:     { border: '#0891B2', bg: '#F0F9FF', text: '#0C4A6E', accent: '#0891B2' },
  }
  const c = sevColors[a.severity] || sevColors.info
  // v13.40 — Cards agregados têm visual mais informativo (mostra chips das cores)
  const isGrouped = a.grouped && Array.isArray(a.groupCodes)
  
  return (
    <div
      onClick={() => {
        // v13.40 — Cores em produção sem pedido ativo → abre página Produção (mais útil que Produtos)
        if (a.type === 'color-stuck') {
          setPage('producao')
          return
        }
        // v13.60 — abre o ITEM direto (pedido/produto), não só a página
        if (a.target?.page) {
          if (onOpenTarget) onOpenTarget(a.target)
          else setPage(a.target.page)
        }
      }}
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderLeft: `4px solid ${c.accent}`,
        borderRadius: 8,
        padding: 12,
        cursor: a.target?.page || a.type === 'color-stuck' ? 'pointer' : 'default',
        transition: 'transform .15s, box-shadow .15s',
      }}
      onMouseEnter={e => { if (a.target?.page || a.type === 'color-stuck') { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,.08)' } }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{a.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: c.text,
            display: 'flex', alignItems: 'center', gap: 6,
            flexWrap: 'wrap',
          }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isGrouped ? a.title.split(' · ')[0] : a.title}
            </span>
            {isGrouped && (
              <span style={{
                background: c.accent, color: '#fff',
                fontSize: 10, fontWeight: 700,
                padding: '2px 7px', borderRadius: 10,
                lineHeight: 1.4,
              }}>
                {a.groupCount} cores
              </span>
            )}
          </div>
          {isGrouped ? (
            <div style={{ marginTop: 6, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {a.groupCodes.slice(0, 6).map(code => (
                <span key={code} style={{
                  display: 'inline-block',
                  padding: '2px 6px',
                  background: 'rgba(255,255,255,.7)',
                  border: `1px solid ${c.border}`,
                  borderRadius: 4, fontSize: 10, fontWeight: 600, color: c.text,
                }}>
                  {code}
                </span>
              ))}
              {a.groupCodes.length > 6 && (
                <span style={{ fontSize: 10, color: c.text, alignSelf: 'center', opacity: .7 }}>
                  +{a.groupCodes.length - 6}
                </span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: c.text, marginTop: 2 }}>
              {a.description}
            </div>
          )}
        </div>
        <span style={{ color: c.accent, fontSize: 16 }}>›</span>
      </div>
    </div>
  )
}
