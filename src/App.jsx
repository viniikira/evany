// src/App.jsx
import { useState, useEffect, useCallback } from 'react'
import { getProfile, signOut, onAuthChange, permsFor } from './lib/auth'
import { hashForPage, pageForHash, isPageAllowed, entitySegmentForHash } from './lib/router'
import { useUsdRate, useSessionTimeout, useTabLock } from './lib/hooks'
import { listProducts } from './lib/data/products'
import { listIdeas, listCollections, listColors, listFactories, listNames, listLogs, getShopifyCache, cleanOldLogs } from './lib/data/misc'
import { purgeOldTrash } from './lib/data/orders'
import { ConfirmProvider, ToastProvider, PendenciasDrawer, AtividadeDrawer } from './components/ui'
import { ThemeToggle, applyInitialTheme } from './components/ThemeToggle'
import { GlobalSearch } from './components/GlobalSearch'
import { FinanceiroPage } from './pages/Financeiro'
import { KIRA_LOGO, EVANY_LOGO, SESSION_TIMEOUT_MINUTES, APP_VERSION } from './lib/constants'
import { computePendencias } from './lib/pendencias'
import { runOncePerDay } from './lib/utils'
import { runDailyBackup } from './lib/backup'
import { initAnalytics, stopAnalytics, trackPageview } from './lib/analytics'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ProductsPage from './pages/Products'
import OrdersPage from './pages/Orders'
import ShopifyPage from './pages/Shopify'
import BackupPage from './pages/Backup'
import ProducaoPage from './pages/Producao'
import { IdeasPage } from './pages/Ideas'
import { NamesPage } from './pages/Names'
import { CollectionsPage } from './pages/Collections'
import { FactoriesPage } from './pages/Factories'
import { ColorsPage } from './pages/Colors'
import { UsersPage } from './pages/Users'
import { LogsPage } from './pages/Logs'
import { CalculatorPage } from './pages/Calculator'
import AnalyticsPage from './pages/Analytics'

import './styles/main.css'
import { log } from './lib/logger'

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppCore />
      </ConfirmProvider>
    </ToastProvider>
  )
}

function AppCore() {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // v13.55 — página inicial vem da URL (#/pedidos abre em Pedidos, mesmo após login)
  const [page, setPage] = useState(() => pageForHash(window.location.hash) || 'dashboard')
  const [sideOpen, setSideOpen] = useState(false)
  const [pendDrawerOpen, setPendDrawerOpen] = useState(false)
  const [atvDrawerOpen, setAtvDrawerOpen] = useState(false)
  // v13.37 — Busca global (Ctrl+K / Cmd+K)
  const [searchOpen, setSearchOpen] = useState(false)
  // Quando user clica num pedido vindo de outra tela (ex: Visão Financeira),
  // navega pra Pedidos e abre o detalhe daquele pedido específico.
  const [pendingOpenOrderId, setPendingOpenOrderId] = useState(() => (
    // v13.56 — deep-link: #/pedidos/novembro-2025 já abre com o detalhe pendente
    pageForHash(window.location.hash) === 'orders' ? entitySegmentForHash(window.location.hash) : null
  ))
  // v13.56 — mesmo mecanismo pra produtos: #/produtos/lara
  const [pendingOpenProductId, setPendingOpenProductId] = useState(() => (
    pageForHash(window.location.hash) === 'products' ? entitySegmentForHash(window.location.hash) : null
  ))

  // Dados globais do dashboard (carregados uma vez na entrada)
  const [dashData, setDashData] = useState({
    products: [], ideas: [], orders: [], names: [], colors: [], logs: [], shopifyCache: null,
  })
  const [dashLoading, setDashLoading] = useState(false)
  
  // Pendências calculadas em tempo real a partir do estado atual
  const pendencias = computePendencias({
    products: dashData.products,
    orders: dashData.orders,
    ideas: dashData.ideas,
  })

  const rate = useUsdRate()
  const { otherTabActive, claimActive } = useTabLock()

  // Check auth ao montar + listener de mudança
  useEffect(() => {
    getProfile().then(p => { setProfile(p); setLoading(false) })
    const { data } = onAuthChange(async () => {
      const p = await getProfile()
      setProfile(p)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // ═══ v13.55 — Rotas por hash: URL ↔ página, nos dois sentidos ═══
  // Navegou no menu → URL vira #/pedidos (dá pra favoritar/compartilhar/F5).
  // v13.56 — se o hash já aponta pra esta página (ex.: #/pedidos/novembro-2025),
  // preserva o segmento do item; só reescreve quando a PÁGINA muda de fato.
  useEffect(() => {
    if (pageForHash(window.location.hash) === page) return
    window.location.hash = hashForPage(page)
  }, [page])
  // Mudou a URL (voltar/avançar do navegador, link colado) → troca a página.
  // v13.56 — se o hash aponta pra um item (#/pedidos/xyz), marca pra abrir o detalhe.
  useEffect(() => {
    const onHash = () => {
      const p = pageForHash(window.location.hash)
      if (!p) return
      const seg = entitySegmentForHash(window.location.hash)
      if (seg && p === 'orders') setPendingOpenOrderId(seg)
      if (seg && p === 'products') setPendingOpenProductId(seg)
      setPage(prev => (p === prev ? prev : p))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // Link direto pra tela sem permissão (ex.: equipe abrindo #/financeiro) → dashboard.
  useEffect(() => {
    if (!profile) return
    if (!isPageAllowed(page, permsFor(profile.role))) setPage('dashboard')
  }, [profile, page])

  // v13.37 — Atalho Ctrl+K / Cmd+K pra abrir busca global.
  // v13.39 — Mais atalhos: "/" abre busca, sem exigir Ctrl.
  // Só funciona se usuário está logado (não faz sentido sem perfil).
  // Regra crítica: NÃO dispara se usuário está digitando em input/textarea.
  useEffect(() => {
    if (!profile) return
    const handler = (e) => {
      // Ignora se está digitando em qualquer campo de texto
      const t = e.target
      const isTyping = t && (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      )
      
      // Ctrl+K / Cmd+K — sempre funciona (até digitando)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      
      // Atalhos que só funcionam FORA de inputs
      if (isTyping) return
      
      // "/" — alternativa pra busca (estilo vim/gmail)
      if (e.key === '/') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [profile])

  // Carrega dados globais (usados por Dashboard, Names, e cache entre páginas).
  // Roda assim que o usuário loga, não só quando vai pra dashboard.
  // Isso resolve #4 (NamesPage acessada direto sem dados) e #19 (cache entre navegações).
  const loadGlobalData = useCallback(async () => {
    if (!profile) return
    setDashLoading(true)
    try {
      const perm = permsFor(profile.role)
      const results = await Promise.all([
        listProducts(),
        perm.ideas ? listIdeas() : Promise.resolve([]),
        perm.orders ? import('./lib/data/orders').then(m => m.listOrders()) : Promise.resolve([]),
        perm.names ? listNames() : Promise.resolve([]),
        listColors(),
        perm.logs ? listLogs(50) : Promise.resolve([]),
        perm.shopify ? getShopifyCache() : Promise.resolve(null),
      ])
      setDashData({
        products: results[0], ideas: results[1], orders: results[2],
        names: results[3], colors: results[4], logs: results[5],
        shopifyCache: results[6],
      })
    } catch (e) {
      log.error('[KIRA] Erro carregando dados globais:', e)
    }
    setDashLoading(false)
  }, [profile])

  // Carrega assim que profile aparece (login completo)
  useEffect(() => { if (profile) loadGlobalData() }, [profile, loadGlobalData])

  // #1 Backup automático + #6 Limpeza de logs antigos + #18 Purge de lixeira — uma vez por dia, em background.
  // Roda quando o app é aberto. Funciona se o usuário entra pelo menos 1x por dia.
  useEffect(() => {
    if (!profile) return
    runOncePerDay('daily-backup', () => runDailyBackup())
    runOncePerDay('logs-cleanup', () => cleanOldLogs(90))
    runOncePerDay('trash-purge', () => purgeOldTrash(30))
  }, [profile])
  
  // v13.31 — Analytics: inicializa após login, para no logout
  useEffect(() => {
    if (!profile) return
    initAnalytics({ id: profile.id, name: profile.name })
    trackPageview(page)  // primeira página
    return () => stopAnalytics()
  }, [profile])
  
  // v13.31 — Track mudança de página
  useEffect(() => {
    if (profile) trackPageview(page)
  }, [page])

  // Auto-logout por inatividade
  useSessionTimeout(SESSION_TIMEOUT_MINUTES, () => {
    signOut()
    setProfile(null)
  })

  // Loading inicial
  if (loading) {
    return (
      <div className="loader">
        <img src={KIRA_LOGO} alt="" className="loader-logo" />
        <div className="loader-text">Carregando...</div>
      </div>
    )
  }

  // Não logado
  if (!profile) {
    return <Login onSuccess={async () => {
      const p = await getProfile()
      setProfile(p)
    }} />
  }

  const perm = permsFor(profile.role)

  // v13.39 — Badges inteligentes no menu (só onde é acionável):
  // - Ideias: quantas criadas nos últimos 7 dias (novidades)
  // - Pedidos: quantas pendências com target de tipo order (atrasos, faltando pagamento, etc)
  const now = Date.now()
  const SEVEN_DAYS = 7 * 86400000
  const ideasNewCount = (dashData.ideas || []).filter(i => {
    if (!i.created_at) return false
    return (now - new Date(i.created_at).getTime()) < SEVEN_DAYS
  }).length
  const ordersPendingCount = (pendencias || []).filter(p => p.target?.type === 'order').length
  
  // v13.40 — Contagem pro badge de "Produção" = cores em produção + cores em trânsito
  // Cálculo inline (barato) — não usar useMemo aqui pq este bloco roda após early returns,
  // o que quebraria a "rules of hooks" do React.
  let productionColorsCount = 0
  for (const p of (dashData.products || [])) {
    for (const cv of (p.color_variants || [])) {
      if (cv.status === 'production') productionColorsCount++
    }
  }
  for (const o of (dashData.orders || [])) {
    if (o.status !== 'in_transit') continue
    for (const it of (o.items || [])) {
      productionColorsCount += (it.colors || []).length
    }
  }

  // v13.60 — menu agrupado em seções (16 itens planos viravam sopa)
  const nav = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', show: true },
    { id: 'ideas', label: 'Ideias', icon: '💡', show: perm.ideas, badge: ideasNewCount, badgeColor: '#0891B2', badgeTitle: 'Ideias novas nos últimos 7 dias', section: 'Operação' },
    { id: 'products', label: 'Produtos', icon: '👑', show: perm.products, section: 'Operação' },
    { id: 'producao', label: 'Produção', icon: '🏭', show: perm.products, badge: productionColorsCount, badgeColor: '#F59E0B', badgeTitle: 'Cores em produção + em trânsito', section: 'Operação' },
    { id: 'orders', label: 'Pedidos', icon: '📋', show: perm.orders, badge: ordersPendingCount, badgeColor: '#F59E0B', badgeTitle: 'Pedidos precisando de atenção', section: 'Operação' },
    { id: 'financial', label: 'Financeiro', icon: '💰', show: perm.prices, section: 'Operação' },
    { id: 'shopify', label: 'Shopify', icon: '🛒', show: perm.shopify, section: 'Operação' },
    { id: 'calculator', label: 'Calculadoras', icon: '🧮', show: perm.prices, section: 'Operação' },
    { id: 'colors', label: 'Cores', icon: '🎨', show: perm.colors, section: 'Cadastros' },
    { id: 'names', label: 'Nomes', icon: '✨', show: perm.names, section: 'Cadastros' },
    { id: 'collections', label: 'Coleções', icon: '🏷️', show: perm.collections, section: 'Cadastros' },
    { id: 'factories', label: 'Fábricas', icon: '🏭', show: perm.factories, section: 'Cadastros' },
    { id: 'logs', label: 'Atividades', icon: '📜', show: perm.logs, section: 'Administração' },
    { id: 'analytics', label: 'Métricas', icon: '📈', show: perm.admin, section: 'Administração' },
    { id: 'backup', label: 'Backup', icon: '🛡️', show: perm.backup, section: 'Administração' },
    { id: 'users', label: 'Usuários', icon: '👤', show: perm.users, section: 'Administração' },
  ].filter(n => n.show)

  const titles = {
    dashboard: 'Dashboard', ideas: 'Ideias', products: 'Produtos', producao: 'Produção', orders: 'Pedidos',
    shopify: 'Shopify Intelligence', calculator: 'Calculadoras',
    names: 'Banco de Nomes', collections: 'Coleções', factories: 'Fábricas',
    colors: 'Banco de Cores', logs: 'Atividades', analytics: 'Métricas',
    backup: 'Backup', users: 'Usuários', financial: 'Financeiro',
  }

  const handleLogout = async () => {
    await signOut()
    setProfile(null)
  }

  return (
    <div className="app">
      <button className="mob-toggle" onClick={() => setSideOpen(!sideOpen)}>☰</button>
      <aside className={`side${sideOpen ? ' open' : ''}`}>
        <div className="side-hd" style={{ position: 'relative' }}>
          <img src={KIRA_LOGO} alt="" className="side-kira" />
          <div className="side-ev">
            <img src={EVANY_LOGO} alt="" className="side-evany" />
            <span className="side-tag">GESTÃO {APP_VERSION}</span>
          </div>
          {/* Sino de pendências + atividade */}
          <div style={{
            position: 'absolute', top: 8, right: 8,
            display: 'flex', gap: 4, alignItems: 'center',
          }}>
            <button
              onClick={() => setSearchOpen(true)}
              title="Buscar em tudo (Ctrl+K)"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 16, padding: 4,
                color: '#6B7280',
              }}
            >
              🔍
            </button>
            <button
              onClick={() => setAtvDrawerOpen(true)}
              title="Centro de Atividade — o que aconteceu no sistema"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 16, padding: 4,
                color: '#6B7280',
              }}
            >
              📊
            </button>
            <button
              onClick={() => setPendDrawerOpen(true)}
              title={pendencias.length === 0 ? 'Nenhuma pendência' : `${pendencias.length} pendência(s)`}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 18, padding: 4, position: 'relative',
                color: pendencias.length === 0 ? '#9CA3AF' : '#F59E0B',
              }}
            >
              🔔
              {pendencias.length > 0 && (
                <span style={{
                  position: 'absolute', top: 0, right: 0,
                  background: pendencias.some(p => p.priority === 1) ? '#DC2626' : '#F59E0B',
                  color: '#fff',
                  fontSize: 9, fontWeight: 700,
                  minWidth: 16, height: 16, borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px',
                  lineHeight: 1,
                }}>
                  {pendencias.length > 9 ? '9+' : pendencias.length}
                </span>
              )}
            </button>
          </div>
        </div>
        <nav className="side-nav">
          {nav.map((it, idx) => (
            <span key={it.id} style={{ display: 'contents' }}>
            {it.section && nav[idx - 1]?.section !== it.section && (
              <div style={{
                padding: '10px 14px 4px', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: 1,
                color: 'var(--text-muted, #9CA3AF)', opacity: .8,
              }}>{it.section}</div>
            )}
            <button
              className={`nav-btn${page === it.id ? ' active' : ''}`}
              onClick={() => {
                setPage(it.id)
                setSideOpen(false)
              }}
              title={it.badge > 0 ? it.badgeTitle : undefined}
            >
              <span className="nav-icon">{it.icon}</span>
              <span className="nav-label">{it.label}</span>
              {it.badge > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  background: it.badgeColor || '#6B7280',
                  color: '#fff',
                  fontSize: 10, fontWeight: 700,
                  minWidth: 18, height: 18, borderRadius: 10,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 6px',
                  lineHeight: 1,
                }}>
                  {it.badge > 99 ? '99+' : it.badge}
                </span>
              )}
            </button>
            </span>
          ))}
        </nav>
        <div className="side-ft">
          {rate && (
            <div className="usd-widget">
              <span className="usd-label">USD/BRL (+0,10)</span>
              <span className="usd-val">R$ {rate.toFixed(2)}</span>
            </div>
          )}
          <div style={{ marginBottom: 8 }}>
            <ThemeToggle />
          </div>
          <div className="side-user-row">
            <span className="side-user">{profile.name}</span>
            <button className="btn-link" onClick={handleLogout}>Sair</button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1 className="page-title">{titles[page]}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {otherTabActive && (
              <button
                className="chip"
                style={{ background: '#FEF3C7', color: '#92400E', cursor: 'pointer', border: '1px solid #FBBF24', padding: '4px 10px', fontSize: 11 }}
                onClick={claimActive}
                title="Outra aba do sistema também está aberta — tudo bem pra navegar/consultar; só evite EDITAR o mesmo item nas duas. Clique pra tornar esta a aba principal."
              >
                ⚠️ Outra aba ativa — clique pra usar esta
              </button>
            )}
            {rate && <div className="topbar-usd">USD <strong>R$ {rate.toFixed(2)}</strong></div>}
          </div>
        </header>

        <div className="content">
          {page === 'dashboard' && (
            <Dashboard
              {...dashData}
              perm={perm}
              setPage={setPage}
              onOpenTarget={(t) => {
                // v13.60 — cards de atenção abrem o ITEM, não só a página
                if (t?.page === 'orders' && t.id) setPendingOpenOrderId(t.id)
                if (t?.page === 'products' && t.id) setPendingOpenProductId(t.id)
                if (t?.page) setPage(t.page)
              }}
              rate={rate}
              userName={profile?.name}
            />
          )}
          {page === 'ideas' && <IdeasPage user={profile} perm={perm} initialData={dashData.ideas} onMutate={loadGlobalData} />}
          {page === 'products' && <ProductsPage user={profile} perm={perm} shopifyCache={dashData.shopifyCache} initialData={dashData.products} initialColors={dashData.colors} onMutate={loadGlobalData} initialDetailId={pendingOpenProductId} onDetailOpened={() => setPendingOpenProductId(null)} />}
          {page === 'producao' && <ProducaoPage products={dashData.products} orders={dashData.orders} colors={dashData.colors} perm={perm} shopifyCache={dashData.shopifyCache} onOpenOrder={(id) => { setPendingOpenOrderId(id); setPage('orders') }} />}
          {page === 'orders' && <OrdersPage user={profile} perm={perm} rate={rate} initialData={dashData.orders} initialIdeas={dashData.ideas} onMutate={loadGlobalData} initialDetailId={pendingOpenOrderId} onDetailOpened={() => setPendingOpenOrderId(null)} />}
          {page === 'shopify' && <ShopifyPage user={profile} perm={perm} />}
          {page === 'calculator' && <CalculatorPage rate={rate} perm={perm} />}
          {page === 'names' && (
            <NamesPage
              products={dashData.products}
              ideas={dashData.ideas}
              user={profile} perm={perm} setPage={setPage}
            />
          )}
          {page === 'collections' && <CollectionsPage user={profile} perm={perm} />}
          {page === 'factories' && <FactoriesPage user={profile} perm={perm} />}
          {page === 'colors' && <ColorsPage user={profile} perm={perm} />}
          {page === 'financial' && (
            <FinanceiroPage
              perm={perm}
              onOrderClick={(o) => {
                setPendingOpenOrderId(o.id)
                setPage('orders')
              }}
            />
          )}
          {page === 'logs' && <LogsPage perm={perm} />}
          {page === 'analytics' && <AnalyticsPage perm={perm} />}
          {page === 'backup' && <BackupPage user={profile} perm={perm} />}
          {page === 'users' && <UsersPage perm={perm} user={profile} />}
        </div>
      </main>
      <PendenciasDrawer
        open={pendDrawerOpen}
        pendencias={pendencias}
        onClose={() => setPendDrawerOpen(false)}
        onPendenciaClick={(p) => {
          // v13.60 — o aviso agora LEVA no item: abre o detalhe direto,
          // não só a página (mesmo caminho do deep-link/busca global)
          if (p.target?.type === 'order') {
            if (p.target.id) setPendingOpenOrderId(p.target.id)
            setPage('orders')
          } else if (p.target?.type === 'product') {
            if (p.target.id) setPendingOpenProductId(p.target.id)
            setPage('products')
          } else if (p.target?.type === 'idea') setPage('ideas')
          setPendDrawerOpen(false)
        }}
      />
      <AtividadeDrawer
        open={atvDrawerOpen}
        logs={dashData.logs || []}
        onClose={() => setAtvDrawerOpen(false)}
      />
      {/* v13.37 — Busca global (Ctrl+K / Cmd+K) */}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        products={dashData.products || []}
        ideas={dashData.ideas || []}
        orders={dashData.orders || []}
        colors={dashData.colors || []}
        onNavigate={(item) => {
          if (item.type === 'product') {
            // v13.56 — busca global abre o produto direto (mesmo caminho do deep-link)
            setPendingOpenProductId(item.id)
            setPage('products')
          }
          else if (item.type === 'idea') setPage('ideas')
          else if (item.type === 'order') {
            setPendingOpenOrderId(item.id)
            setPage('orders')
          }
          else if (item.type === 'color') setPage('colors')
        }}
      />
    </div>
  )
}
