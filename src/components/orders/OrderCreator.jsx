// src/components/orders/OrderCreator.jsx
// v13.48 — Criador visual de pedidos (Fase 2 da "mesa de criação").
//
// Tela cheia em 3 etapas: Fábrica → Modelos e cores → Revisão.
// A criação é por COMBINAÇÃO visual: escolhe o modelo vendo a foto grande,
// toca nas cores da galeria (foto real do banco de cores) e cada toque vira
// uma linha modelo+cor lado a lado com quantidade. Totais (peças, FOB e BRL
// no câmbio de hoje) sempre visíveis no rodapé.
//
// Produz EXATAMENTE o mesmo payload do OrderModal clássico e salva pelo
// mesmo onSave (conversão de ideias, snapshots, inteligência de fábrica —
// tudo continua em Orders.jsx).
// v13.54 — também EDITA pedidos existentes (prop `order`): inicializa a mesa
// com os itens reais e abre direto na etapa 2. O modal clássico saiu de cena.

import { useState, useMemo, useRef, useEffect } from 'react'
import { ColorSwatch } from '../ColorSwatch'
import { SaveButton, useConfirm, useToast } from '../ui'
import { generateFactorySheet } from '../../lib/factorySheet'
import { suggestQuantity, suggestColorsForModel, inFlightForModel, priceSignalForModel } from '../../lib/orderIntelligence'
import { proposeOrderName } from '../../lib/orderNaming'
import { buildRestockView, restockForColor, DEFAULT_TARGET_COVER_DAYS } from '../../lib/restock'
import { ORDER_ST } from '../../lib/constants'
import { uid, UC, formatDate, parseDateLocal } from '../../lib/utils'

// v13.75 — como cada situação do radar aparece
const RADAR_TONE = {
  ruptura:   { icon: '🔴', label: 'zerado na loja', bg: '#FEE2E2', fg: '#991B1B' },
  critico:   { icon: '🟠', label: 'acabando',       bg: '#FFEDD5', fg: '#9A3412' },
  ok:        { icon: '🟢', label: 'saudável',       bg: '#DCFCE7', fg: '#166534' },
  excesso:   { icon: '🔵', label: 'estoque de sobra', bg: '#DBEAFE', fg: '#1E40AF' },
  parado:    { icon: '⚪', label: 'sem venda no período', bg: '#F3F4F6', fg: '#4B5563' },
  sem_dados: { icon: '⚪', label: 'sem dados da loja', bg: '#F3F4F6', fg: '#4B5563' },
}

const DEFAULT_QTY = 10
const QTY_STEP = 5
// Fator de conversão típico da importação (1,50–1,80): FOB × fator × dólar ≈ custo no Brasil
const DEFAULT_FACTOR = 1.65

const lsNum = (k) => {
  try {
    const v = parseFloat(localStorage.getItem(k))
    return v > 0 ? v : null
  } catch { return null }
}

// Copia os itens de um pedido existente pra um rascunho novo — usado tanto
// pelo "reaproveitar" da etapa 1 quanto pelo "Duplicar" do detalhe (v13.60,
// unificados: nada é criado no banco até salvar).
const itemsFromOrder = (src) => (src?.items || []).map(it => ({
  id: 'tmp-' + uid(),
  product_id: it.product_id || '',
  idea_id: null,
  idea_name_snapshot: null,
  price_usd: it.price_usd_snapshot ?? it.price_usd ?? '',
  requirements: it.requirements || '',
  colors: (it.colors || []).filter(c => c && c.code).map(c => ({
    code: c.code,
    qty: Number(c.qty) || 0,
    price_usd: c.price_usd ?? null,
    _fromProduct: true,
  })),
}))

export function OrderCreator({ order = null, prefill = null, factories, products, ideas = [], colors = [], orders = [], perm = {}, rate, leadTimeByFactory = new Map(), shopifyCache = null, onSave, onClose }) {
  const confirm = useConfirm()
  const toast = useToast()
  const isEdit = !!(order && order.id)
  // Editando ou duplicando, a fábrica já existe — abre direto na mesa de criação
  const [step, setStep] = useState(isEdit || prefill ? 2 : 1)

  // v13.62 — HIDE MODE: esconde TODOS os valores da tela (pra criar pedido
  // com uma funcionária olhando sem expor custos). Persiste entre sessões.
  const [hidePrices, setHidePrices] = useState(() => {
    try { return localStorage.getItem('kira.hide_prices') === '1' } catch { return false }
  })
  const toggleHidePrices = () => setHidePrices(v => {
    const nv = !v
    try { localStorage.setItem('kira.hide_prices', nv ? '1' : '0') } catch { /* sem localStorage */ }
    return nv
  })
  const showPrices = perm.prices && !hidePrices
  const [exportingSheet, setExportingSheet] = useState(false)
  const [f, setF] = useState(() => {
    if (!isEdit) {
      return {
        order_name: '',
        // v13.60 — duplicando: parte da fábrica/itens do pedido de origem
        factory: prefill?.factory || '',
        status: 'draft',
        notes: prefill?.notes || '',
        expected_arrival: null,
        order_date: null,
        promised_lead_days: null,
        // v13.62 — fator/dólar do cálculo "quanto custa chegando no Brasil";
        // lembra os últimos usados e salva no pedido (colunas já existiam)
        conversion_factor: prefill?.conversion_factor ?? lsNum('kira.conv_factor') ?? DEFAULT_FACTOR,
        budget_rate: prefill?.budget_rate ?? lsNum('kira.budget_rate') ?? '',
        items: prefill ? itemsFromOrder(prefill) : [],
      }
    }
    // Edição: parte do pedido real. O spread preserva campos que o form não
    // mostra (id, pagamentos, histórico, câmbio orçado...) — mesmo contrato
    // do OrderModal antigo. Cores cadastradas no produto ganham _fromProduct.
    const items = (order.items || []).map(it => {
      const prod = (products || []).find(p => p.id === it.product_id)
      const productColorCodes = new Set((prod?.color_variants || []).map(cv => (cv.code || '').toLowerCase()))
      return {
        ...it,
        colors: (it.colors || []).map(c => ({
          ...c,
          _fromProduct: productColorCodes.has((c.code || '').toLowerCase()),
        })),
      }
    })
    return {
      ...order,
      order_name: order.order_name || '',
      factory: order.factory || '',
      status: order.status || 'draft',
      notes: order.notes || '',
      expected_arrival: order.expected_arrival || null,
      order_date: order.order_date || null,
      promised_lead_days: order.promised_lead_days || null,
      items,
    }
  })
  const [modelSearch, setModelSearch] = useState('')
  // v13.53 — UI da galeria de cores POR MODELO: busca própria e expandir/recolher.
  // (antes a busca era compartilhada: digitar num card filtrava todos)
  const [galleryUI, setGalleryUI] = useState({})
  const setGallery = (itemId, patch) => setGalleryUI(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), ...patch } }))
  // v13.63 — cores que só certas fábricas fazem: por padrão a galeria mostra
  // as cores da fábrica do pedido (+ as sem restrição); toggle traz todas.
  const [onlyFactoryColors, setOnlyFactoryColors] = useState(true)
  const anyColorRestricted = useMemo(() => (colors || []).some(c => (c.factories || []).length > 0), [colors])
  const colorMatchesFactory = (c) => {
    const fs = Array.isArray(c.factories) ? c.factories : []
    return fs.length === 0 || fs.includes(f.factory)  // sem restrição = disponível em todas
  }
  const s = (k, v) => setF(p => ({ ...p, [k]: v }))

  // ── Nome sugerido (v13.72) ──
  // Ela nunca sabia o que escrever ("(sem nome)" em vários pedidos). Sugestão =
  // MÊS/ANO · FÁBRICA, que é como ela já pensa + o que diferencia dois pedidos do
  // mesmo mês. Enquanto ela não digitar nada, o campo acompanha fábrica/data;
  // depois de digitar, nunca sobrescreve.
  const nameTouched = useRef(!!f.order_name)
  const suggestedName = useMemo(
    () => proposeOrderName({ id: order?.id, factory: f.factory, order_date: f.order_date }, orders || []),
    [f.factory, f.order_date, orders, order?.id]
  )
  useEffect(() => {
    if (nameTouched.current || !suggestedName) return
    setF(p => (p.order_name === suggestedName ? p : { ...p, order_name: suggestedName }))
  }, [suggestedName])

  // ── Reaproveitar pedido anterior (reorder rápido) ──
  // Copia itens/cores/preços de um pedido existente pra um rascunho novo.
  // Central pro negócio: a Kira reencomenda os mesmos modelos/cores toda vez.
  const reuseCandidates = useMemo(() => (
    [...(orders || [])]
      .filter(o => (o.items || []).length > 0)
      .sort((a, b) => new Date(b.order_date || b.created_at) - new Date(a.order_date || a.created_at))
      .slice(0, 6)
  ), [orders])
  const reuseOrder = (src) => {
    setF(prev => ({
      ...prev,
      factory: src.factory || prev.factory,
      items: itemsFromOrder(src),
    }))
    setStep(2)
  }

  // ── Agrupamento de modelos por fábrica (mesma regra do OrderModal) ──
  const modelGroups = useMemo(() => {
    const all = products || []
    const productNames = new Set(all.map(p => (p.name || '').toLowerCase().trim()))
    const activeIdeas = (ideas || [])
      .filter(i => i.status !== 'discarded')
      .filter(i => i.name && !productNames.has(i.name.toLowerCase().trim()))

    const q = modelSearch.trim().toLowerCase()
    const match = (x) => !q ||
      (x.name || '').toLowerCase().includes(q) ||
      (x.factory_code || '').toLowerCase().includes(q)

    if (!f.factory) return { matching: all.filter(match), undefined_factory: [], other_factory: [], ideas: activeIdeas.filter(match) }
    const matching = [], undefined_factory = [], other_factory = []
    for (const p of all) {
      if (!p || !match(p)) continue
      const hasSupplier = Array.isArray(p.suppliers) && p.suppliers.some(su => su && su.factory === f.factory)
      if (p.factory === f.factory || hasSupplier) matching.push(p)
      else if (!p.factory) undefined_factory.push(p)
      else other_factory.push(p)
    }
    return { matching, undefined_factory, other_factory, ideas: activeIdeas.filter(match) }
  }, [products, ideas, f.factory, modelSearch])

  // ── Itens (combinações) ──
  const addModel = (source, isIdea = false) => {
    const already = (f.items || []).some(it => isIdea ? it.idea_id === source.id : it.product_id === source.id)
    if (already) return
    setF(prev => ({
      ...prev,
      items: [...(prev.items || []), {
        id: 'tmp-' + uid(),
        product_id: isIdea ? '' : source.id,
        idea_id: isIdea ? source.id : null,
        idea_name_snapshot: isIdea ? source.name : null,
        // v13.53 — sem preço cadastrado? parte da última FOB do histórico
        // (o sistema sabia o preço e deixava 0.00 — agora usa; segue editável)
        price_usd: (source.price_usd != null && source.price_usd !== '')
          ? source.price_usd
          : (!isIdea && intelByProduct.get(source.id)?.price?.lastPrice != null
              ? intelByProduct.get(source.id).price.lastPrice
              : ''),
        requirements: '',  // v13.58 — texto pra fábrica na planilha (por modelo)
        colors: [],
      }],
    }))
  }
  const rmItem = (id) => setF(prev => ({ ...prev, items: (prev.items || []).filter(it => it.id !== id) }))
  const updItem = (id, key, val) => setF(prev => ({
    ...prev, items: (prev.items || []).map(it => it.id === id ? { ...it, [key]: val } : it),
  }))

  // ── Inteligência: índice por modelo, calculado 1x do histórico ──
  // Preço (tendência/alerta), pedidos a caminho e cores que o modelo costuma levar.
  const intelByProduct = useMemo(() => {
    const ids = new Set()
    for (const o of (orders || [])) for (const it of (o.items || [])) if (it.product_id) ids.add(it.product_id)
    const m = new Map()
    for (const id of ids) {
      m.set(id, {
        price: priceSignalForModel(id, orders),
        // Editando, o próprio pedido não conta como "já vindo"
        inFlight: inFlightForModel(id, orders, { excludeOrderId: order?.id }),
        suggestedColors: suggestColorsForModel(id, orders),
      })
    }
    return m
  }, [orders, order?.id])

  // ── RADAR DA LOJA (v13.75) ──
  // A sugestão antiga vinha só da média do que ela já pediu — repetia o passado.
  // Agora cruza VENDE (Shopify) · TEM (estoque) · VEM (pedidos ativos): ver
  // src/lib/restock.js. Tudo recalculado quando a fábrica muda, porque o prazo
  // da fábrica entra na conta de quanto pedir.
  const [coverTarget, setCoverTarget] = useState(DEFAULT_TARGET_COVER_DAYS)
  const radar = useMemo(() => buildRestockView({
    products, orders, shopifyCache, leadTimeByFactory,
    factory: f.factory || null, targetCoverDays: coverTarget, excludeOrderId: order?.id,
  }), [products, orders, shopifyCache, leadTimeByFactory, f.factory, coverTarget, order?.id])

  const leadDaysNow = leadTimeByFactory.get(f.factory)?.avgDays || 120
  const [radarExpanded, setRadarExpanded] = useState(false)
  // Com a fábrica escolhida, mostra só os modelos dela (+ os sem fábrica)
  const radarUrgent = useMemo(() => (
    f.factory
      ? radar.urgent.filter(r => !r.product.factory || r.product.factory === f.factory)
      : radar.urgent
  ), [radar, f.factory])

  // "+ adicionar" do radar: entra com as cores que VENDEM, já com a quantidade
  // sugerida por cor; sem SKU ligado, distribui a sugestão nas cores usuais.
  const addFromRadar = (row) => {
    const prod = row.product
    if ((f.items || []).some(it => it.product_id === prod.id)) return
    const byColor = []
    for (const cv of (prod.color_variants || [])) {
      if (cv.status === 'discontinued') continue
      const cr = colorRadar(prod.id, cv.code)
      if (cr && cr.suggestedQty > 0) byColor.push({ code: cv.code, qty: cr.suggestedQty, _fromProduct: true })
    }
    if (byColor.length === 0) {
      // Sem SKU ligado: as cores que ela costuma pedir; sem histórico, as cores
      // cadastradas do modelo. A sugestão do modelo é dividida entre elas.
      const usual = suggestColorsForModel(prod.id, orders).slice(0, 2).map(u => u.code)
      const fallback = usual.length > 0
        ? usual
        : (prod.color_variants || []).filter(cv => cv.status !== 'discontinued' && cv.code).slice(0, 3).map(cv => cv.code)
      const total = row.suggestedQty || DEFAULT_QTY
      if (fallback.length > 0) {
        const each = Math.max(5, Math.ceil(total / fallback.length / 5) * 5)
        for (const code of fallback) byColor.push({ code, qty: each, _fromProduct: true })
      }
    }
    setF(prev => ({
      ...prev,
      items: [...(prev.items || []), {
        id: 'tmp-' + uid(),
        product_id: prod.id,
        idea_id: null,
        idea_name_snapshot: null,
        price_usd: (prod.price_usd != null && prod.price_usd !== '')
          ? prod.price_usd
          : (intelByProduct.get(prod.id)?.price?.lastPrice ?? ''),
        requirements: '',
        colors: byColor,
      }],
    }))
    setStep(2)
  }

  // Sinal da loja pra uma cor (só quando a cor tem SKU ligado)
  const colorRadar = (productId, code) => {
    const prod = (products || []).find(p => p.id === productId)
    if (!prod || !shopifyCache) return null
    return restockForColor(prod, code, {
      storeIndex: radar.storeIndex, orders, leadDays: leadDaysNow,
      targetCoverDays: coverTarget, excludeOrderId: order?.id,
    })
  }

  const toggleColor = (itemId, code, fromProduct) => {
    setF(prev => ({
      ...prev,
      items: (prev.items || []).map(it => {
        if (it.id !== itemId) return it
        const cls = it.colors || []
        const idx = cls.findIndex(c => (c.code || '').toLowerCase() === code.toLowerCase())
        if (idx >= 0) return { ...it, colors: cls.filter((_, i) => i !== idx) }
        // Quantidade inicial: primeiro o que a LOJA pede (venda − estoque − o
        // que já vem); sem sinal de venda, cai na média histórica (v13.75).
        const store = it.product_id ? colorRadar(it.product_id, code) : null
        const sug = it.product_id ? suggestQuantity(it.product_id, code, orders) : null
        // Com sinal de venda, a loja manda — inclusive quando ela diz "não
        // precisa" (0): melhor entrar zerado do que repetir 400 peças de um
        // modelo que já tem 800 a caminho.
        const initial = (store && store.perDay > 0) ? store.suggestedQty : (sug?.avg || DEFAULT_QTY)
        return { ...it, colors: [...cls, { code, qty: initial, _fromProduct: fromProduct }] }
      }),
    }))
  }
  const updColor = (itemId, idx, key, val) => setF(prev => ({
    ...prev,
    items: (prev.items || []).map(it => {
      if (it.id !== itemId) return it
      const cls = [...(it.colors || [])]
      cls[idx] = { ...cls[idx], [key]: val }
      return { ...it, colors: cls }
    }),
  }))
  const bumpQty = (itemId, idx, delta) => setF(prev => ({
    ...prev,
    items: (prev.items || []).map(it => {
      if (it.id !== itemId) return it
      const cls = [...(it.colors || [])]
      const next = Math.max(0, Number(cls[idx]?.qty || 0) + delta)
      cls[idx] = { ...cls[idx], qty: next }
      return { ...it, colors: cls }
    }),
  }))

  // v13.62 — parâmetros do custo estimado no Brasil (FOB × fator × dólar).
  // Dólar sugerido: cotação ao vivo arredondada PRA CIMA no próximo 0,10
  // (margem de segurança — editável).
  const suggestedRate = (() => { const n = parseFloat(rate); return n > 0 ? Math.ceil(n * 10) / 10 : 0 })()
  const effFactor = parseFloat(f.conversion_factor) > 0 ? parseFloat(f.conversion_factor) : DEFAULT_FACTOR
  const effRate = parseFloat(f.budget_rate) > 0 ? parseFloat(f.budget_rate) : suggestedRate
  const setCostParam = (key, lsKey, val) => {
    s(key, val)
    try { if (val !== '' && parseFloat(val) > 0) localStorage.setItem(lsKey, String(val)) } catch { /* sem localStorage */ }
  }

  // ── Totais ao vivo (mesma regra de FOB do resto do sistema: preço por cor) ──
  const totals = useMemo(() => {
    let qty = 0, fob = 0
    for (const it of (f.items || [])) {
      const pu = parseFloat(it.price_usd) || 0
      for (const c of (it.colors || [])) {
        const q = Number(c.qty || 0)
        const cp = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : pu
        qty += q
        fob += q * (cp || 0)
      }
    }
    return { qty, fob, landed: effRate > 0 ? fob * effFactor * effRate : null }
  }, [f.items, effFactor, effRate])

  const modelInfo = (it) => {
    if (it.idea_id) {
      const idea = (ideas || []).find(i => i.id === it.idea_id)
      return {
        name: idea?.name || it.idea_name_snapshot || '?',
        code: idea?.factory_code || '',
        photo: idea?.card_image_url || (idea?.photos || [])[0] || null,
        registeredColors: (idea?.color_variants || []).map(cv => cv.code).filter(Boolean),
        isIdea: true,
      }
    }
    const prod = (products || []).find(p => p.id === it.product_id)
    // Fallback pros snapshots do item: pedidos antigos podem ter itens cujo
    // produto foi deletado/convertido (product_id nulo) ou itens manuais.
    return {
      name: it.name_manual || prod?.name || it.product_name_snapshot || '?',
      code: it.code_manual || prod?.factory_code || it.product_code_snapshot || '',
      photo: prod?.card_image_url || (prod?.photos || [])[0] || it.selected_photo_url || null,
      registeredColors: (prod?.color_variants || []).map(cv => cv.code).filter(Boolean),
      isIdea: false,
    }
  }

  // Exporta a planilha da fábrica a partir do rascunho (antes de salvar).
  // Enriquece itens de ideia (que ainda não têm snapshot) com nome/código/foto
  // pra planilha renderizar certo; produtos resolvem via lookup no factorySheet.
  const buildDraftOrder = () => ({
    ...f,
    items: (f.items || []).map(it => {
      const cleanColors = (it.colors || []).filter(c => c.code && Number(c.qty || 0) > 0)
      if (it.idea_id) {
        const info = modelInfo(it)
        return { ...it, name_manual: info.name, code_manual: info.code || null, selected_photo_url: info.photo || null, colors: cleanColors }
      }
      return { ...it, colors: cleanColors }
    }).filter(it => (it.colors || []).length > 0),
  })
  const exportDraftSheet = async () => {
    if (exportingSheet) return
    const draft = buildDraftOrder()
    if (!draft.items.length) {
      toast.push('Adicione ao menos 1 cor com quantidade antes de exportar', { kind: 'error', duration: 5000 })
      return
    }
    setExportingSheet(true)
    try {
      await generateFactorySheet(draft, products, colors, { rate })
      toast.push('Planilha da fábrica gerada', { kind: 'success' })
    } catch (e) {
      toast.push('Não foi possível gerar a planilha: ' + (e?.message || e), { kind: 'error', duration: 6000 })
    } finally {
      setExportingSheet(false)
    }
  }

  const handleClose = async () => {
    if ((f.items || []).length > 0) {
      const ok = await confirm({
        title: isEdit ? 'Sair sem salvar?' : 'Descartar pedido?',
        message: isEdit
          ? 'Alterações não salvas serão perdidas. O pedido continua como estava.'
          : 'As combinações montadas serão perdidas.',
        danger: true,
        confirmLabel: isEdit ? 'Sair sem salvar' : 'Descartar',
      })
      if (!ok) return
    }
    onClose()
  }

  const doSave = async () => {
    const ok = await onSave({ ...f })
    if (ok) onClose()
  }

  // v13.53 — ESC fecha o criador (com a mesma proteção de descarte do ✕)
  const closeRef = useRef(handleClose)
  closeRef.current = handleClose
  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [])

  const canAdvance = step === 1 ? !!f.factory : (f.items || []).some(it => (it.colors || []).some(c => Number(c.qty || 0) > 0))
  const fmt$ = (n) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtR$ = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      background: 'var(--bg)', display: 'flex', flexDirection: 'column',
    }}>
      {/* ── Cabeçalho com etapas ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 17, fontWeight: 700 }}>
            {isEdit ? `✏️ ${f.order_name || 'Editar pedido'}` : '🎨 Novo pedido'}
          </span>
          {f.factory && <span className="chip" style={{ background: 'var(--primary)', color: '#fff' }}>🏭 {f.factory}</span>}
          {isEdit && (() => {
            const st = ORDER_ST.find(x => x.id === f.status)
            return st ? <span className="chip" style={{ background: st.color + '22', color: st.color }}>{st.icon} {st.label}</span> : null
          })()}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          {[
            { n: 1, label: 'Fábrica' },
            { n: 2, label: 'Modelos e cores' },
            { n: 3, label: 'Revisão' },
          ].map(x => (
            <button
              key={x.n}
              onClick={() => { if (x.n < step || (x.n === 2 && f.factory)) setStep(x.n) }}
              style={{
                padding: '4px 12px', borderRadius: 99, fontSize: 12, cursor: 'pointer',
                border: '1px solid ' + (step === x.n ? 'var(--primary)' : 'var(--border)'),
                background: step === x.n ? 'var(--primary)' : 'transparent',
                color: step === x.n ? '#fff' : 'var(--text-muted, #6b7280)',
                fontWeight: step === x.n ? 600 : 400,
              }}
            >{x.n}. {x.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* v13.62 — fator × dólar do custo estimado no Brasil (salvos no pedido) */}
          {showPrices && step > 1 && (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}
              title={`Custo estimado no Brasil = FOB × fator × dólar.\nFator (~1,50–1,80) cobre frete/impostos; dólar você trava no valor que preferir (sugestão: cotação arredondada pra cima).\nOs dois ficam salvos no pedido.`}
            >
              <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)' }}>fator ×</span>
              <input
                type="number" step="0.05" min="1"
                value={f.conversion_factor ?? ''}
                onChange={e => setCostParam('conversion_factor', 'kira.conv_factor', e.target.value)}
                aria-label="Fator de conversão da importação"
                style={{ width: 52, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted, #6b7280)' }}>· US$</span>
              <input
                type="number" step="0.05" min="0"
                placeholder={suggestedRate ? suggestedRate.toFixed(2) : '0.00'}
                value={f.budget_rate ?? ''}
                onChange={e => setCostParam('budget_rate', 'kira.budget_rate', e.target.value)}
                aria-label="Dólar usado no cálculo"
                style={{ width: 58, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}
              />
            </div>
          )}
          {/* v13.62 — HIDE MODE: criar pedido com alguém olhando sem expor custos.
              Gate é perm.prices (NÃO showPrices): o botão precisa existir pra DESocultar. */}
          {perm.prices && (
            <button
              onClick={toggleHidePrices}
              aria-label={hidePrices ? 'Mostrar valores' : 'Ocultar valores'}
              title={hidePrices
                ? 'Modo discrição ATIVO — nenhum valor aparece na tela. Clique pra voltar a mostrar.'
                : 'Ocultar todos os valores (modo discrição — útil com alguém olhando a tela)'}
              style={hidePrices
                ? { background: '#FEF3C7', border: '1px solid #FBBF24', color: '#92400E', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
                : { background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 14, cursor: 'pointer', color: 'var(--text)' }}
            >
              {hidePrices ? '🙈 valores ocultos' : '🙈'}
            </button>
          )}
          <button className="btn-icon" onClick={handleClose} aria-label="Fechar criador de pedido" style={{ fontSize: 18 }}>✕</button>
        </div>
      </div>

      {/* ── Conteúdo ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>

        {/* ETAPA 1 — Fábrica e nome */}
        {step === 1 && (
          <div style={{ maxWidth: 560, margin: '4vh auto 0' }}>
            {/* v13.72 — fábrica ANTES do nome: é ela que define o nome sugerido */}
            <label className="field-label">Pra qual fábrica?</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginTop: 6 }}>
              {(factories || []).map(fa => {
                const active = f.factory === fa.name
                const lead = leadTimeByFactory.get(fa.name)
                const nProds = (products || []).filter(p => p.factory === fa.name || (p.suppliers || []).some(su => su?.factory === fa.name)).length
                return (
                  <button
                    key={fa.id}
                    onClick={() => s('factory', fa.name)}
                    style={{
                      padding: '16px 14px', borderRadius: 12, textAlign: 'left', cursor: 'pointer',
                      border: `2px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                      background: active ? 'var(--primary)' : 'var(--surface)',
                      color: active ? '#fff' : 'var(--text)',
                      transition: 'all .15s',
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 700 }}>🏭 {fa.name}</div>
                    <div style={{ fontSize: 11, marginTop: 4, opacity: .8 }}>
                      {nProds} modelo{nProds !== 1 ? 's' : ''}
                      {lead ? ` · ~${lead.avgDays} dias (${lead.sampleSize} pedido${lead.sampleSize !== 1 ? 's' : ''})` : ''}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Nome: já vem preenchido com MÊS/ANO · FÁBRICA (ela nunca sabia o
                que escrever e vários pedidos ficaram "sem nome"). Enquanto ela
                não digitar nada próprio, a sugestão acompanha a fábrica escolhida. */}
            <div className="form-group" style={{ marginTop: 20 }}>
              <label className="field-label">Nome do pedido</label>
              <input
                className="field"
                value={f.order_name}
                onChange={e => { nameTouched.current = true; s('order_name', e.target.value) }}
                placeholder={suggestedName || 'Escolha a fábrica acima e o nome vem pronto'}
              />
              <div className="text-muted" style={{ fontSize: 11.5, marginTop: 5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {suggestedName && f.order_name !== suggestedName ? (
                  <>
                    <span>Sugestão: <strong>{suggestedName}</strong></span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => { nameTouched.current = false; s('order_name', suggestedName) }}
                    >
                      ✨ usar
                    </button>
                  </>
                ) : (
                  <span>Mês/ano + fábrica — é o que diferencia dois pedidos do mesmo mês. Pode trocar por qualquer coisa.</span>
                )}
              </div>
            </div>

            {/* v13.75 — RADAR: por onde começar o pedido. Modelos que vendem,
                estão acabando e não têm reposição suficiente a caminho. */}
            {!isEdit && radarUrgent.length > 0 && (
              <div style={{ marginTop: 26, border: '1px solid #FCA5A5', borderRadius: 12, background: '#FFF7F7', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <strong style={{ fontSize: 14 }}>📡 Repor primeiro</strong>
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    vende na loja, está acabando e o que vem não cobre — base: {radar.coverageDays} dias de venda
                  </span>
                  <label className="text-muted" style={{ fontSize: 11, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                    cobrir
                    <select
                      className="field field-sm"
                      value={coverTarget}
                      onChange={e => setCoverTarget(Number(e.target.value))}
                      style={{ width: 'auto', padding: '2px 6px' }}
                      aria-label="Quantos dias de venda este pedido deve cobrir"
                    >
                      <option value={60}>60 dias</option>
                      <option value={90}>90 dias</option>
                      <option value={120}>120 dias</option>
                      <option value={180}>180 dias</option>
                    </select>
                    de estoque
                  </label>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {radarUrgent.slice(0, radarExpanded ? 12 : 5).map(r => {
                    const already = (f.items || []).some(it => it.product_id === r.product.id)
                    const photo = r.product.card_image_url || (r.product.photos || [])[0]
                    const tone = RADAR_TONE[r.status] || RADAR_TONE.ok
                    return (
                      <div key={r.product.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
                        <div style={{ width: 34, height: 44, borderRadius: 6, overflow: 'hidden', background: 'var(--bg)', flexShrink: 0 }}>
                          {photo && <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>
                            {UC(r.product.name)}
                            <span style={{ marginLeft: 6, fontSize: 10, background: tone.bg, color: tone.fg, borderRadius: 5, padding: '1px 6px' }}>
                              {tone.icon} {tone.label}
                            </span>
                            {r.product.factory && r.product.factory !== f.factory && (
                              <span className="text-muted" style={{ marginLeft: 6, fontSize: 10 }}>🏭 {r.product.factory}</span>
                            )}
                          </div>
                          <div className="text-muted" style={{ fontSize: 11 }}>
                            vende {r.perDay >= 1 ? r.perDay.toFixed(1) : r.perDay.toFixed(2)}/dia · estoque {r.stock}
                            {r.coverDays != null && ` (${r.coverDays} dias)`}
                            {r.inFlightQty > 0 ? ` · ${r.inFlightQty} vindo` : ' · nada vindo'}
                          </div>
                        </div>
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={already}
                          onClick={() => addFromRadar(r)}
                          title={already ? 'Já está neste pedido' : `Adiciona o modelo com ~${r.suggestedQty} peças distribuídas nas cores que vendem`}
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {already ? '✓ no pedido' : `+ ${r.suggestedQty} pç`}
                        </button>
                      </div>
                    )
                  })}
                </div>
                {radarUrgent.length > 5 && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => setRadarExpanded(v => !v)}
                    style={{ marginTop: 8 }}
                  >
                    {radarExpanded ? 'mostrar menos' : `ver os outros ${radarUrgent.length - 5}`}
                  </button>
                )}
              </div>
            )}

            {!isEdit && reuseCandidates.length > 0 && (
              <div style={{ marginTop: 26 }}>
                <label className="field-label">Ou reaproveite um pedido recente <span className="text-muted text-xs" style={{ fontWeight: 400 }}>— copia modelos, cores e quantidades pra um rascunho novo</span></label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {reuseCandidates.map(o => {
                    const pcs = (o.items || []).reduce((a, it) => a + (it.colors || []).reduce((b, c) => b + Number(c.qty || 0), 0), 0)
                    const nModels = (o.items || []).length
                    return (
                      <button
                        key={o.id}
                        onClick={() => reuseOrder(o)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                          padding: '10px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                          border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)',
                        }}
                      >
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ fontSize: 14 }}>{o.order_name || o.factory}</strong>
                          <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>
                            🏭 {o.factory} · {nModels} modelo{nModels !== 1 ? 's' : ''} · {pcs} pç · {formatDate(o.order_date || o.created_at, 'full')}
                          </span>
                        </span>
                        <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>↻ reaproveitar</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ETAPA 2 — Mesa de criação */}
        {step === 2 && (
          <div style={{ display: 'grid', gridTemplateColumns: '270px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>

            {/* Galeria de modelos */}
            <div style={{ position: 'sticky', top: 0 }}>
              <input
                className="field field-sm"
                placeholder="🔍 Buscar modelo..."
                value={modelSearch}
                onChange={e => setModelSearch(e.target.value)}
                style={{ marginBottom: 8, width: '100%' }}
              />
              <div style={{ maxHeight: 'calc(100vh - 210px)', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
                {[
                  { label: `✓ Em ${f.factory}`, list: modelGroups.matching, isIdea: false },
                  { label: '🔬 Em pesquisa (sem fábrica)', list: modelGroups.undefined_factory, isIdea: false },
                  { label: '↔ De outras fábricas', list: modelGroups.other_factory, isIdea: false },
                  { label: '💡 Ideias (viram produto ao salvar)', list: modelGroups.ideas, isIdea: true },
                ].filter(g => g.list.length > 0).map(g => (
                  <div key={g.label}>
                    <div className="text-muted" style={{ fontSize: 11, fontWeight: 600, margin: '4px 0 6px', textTransform: 'uppercase', letterSpacing: .5 }}>{g.label} ({g.list.length})</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {g.list.map(m => {
                        const selected = (f.items || []).some(it => g.isIdea ? it.idea_id === m.id : it.product_id === m.id)
                        const photo = m.card_image_url || (m.photos || [])[0]
                        return (
                          <button
                            key={m.id}
                            onClick={() => selected ? rmItem((f.items.find(it => g.isIdea ? it.idea_id === m.id : it.product_id === m.id) || {}).id) : addModel(m, g.isIdea)}
                            title={selected ? 'Remover do pedido' : 'Adicionar ao pedido'}
                            style={{
                              padding: 0, borderRadius: 10, overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
                              border: `2px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
                              background: 'var(--surface)', position: 'relative',
                            }}
                          >
                            <div style={{ width: '100%', aspectRatio: '3/4', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {photo
                                ? <img src={photo} alt={m.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <span style={{ fontSize: 26, opacity: .3 }}>{g.isIdea ? '💡' : '👑'}</span>}
                            </div>
                            {selected && (
                              <span style={{
                                position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: '50%',
                                background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center',
                                justifyContent: 'center', fontSize: 13, fontWeight: 700,
                              }}>✓</span>
                            )}
                            <div style={{ padding: '6px 8px' }}>
                              <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{UC(m.name)}</div>
                              {m.factory_code && <div className="text-muted" style={{ fontSize: 10, fontFamily: 'monospace' }}>{m.factory_code}</div>}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {modelGroups.matching.length + modelGroups.undefined_factory.length + modelGroups.other_factory.length + modelGroups.ideas.length === 0 && (
                  <p className="text-muted text-sm" style={{ textAlign: 'center', marginTop: 20 }}>Nenhum modelo encontrado.</p>
                )}
              </div>
            </div>

            {/* Mesa: modelos selecionados + combinações */}
            <div>
              {(f.items || []).length === 0 && (
                <div className="empty-state" style={{ marginTop: '8vh' }}>
                  <div className="empty-icon">🎨</div>
                  <p>Toque num modelo à esquerda pra começar a criar.</p>
                  <p className="text-muted text-sm">Depois toque nas cores pra montar as combinações — cada toque vira uma linha do pedido.</p>
                </div>
              )}

              {(f.items || []).map(it => {
                const info = modelInfo(it)
                const intel = it.product_id ? intelByProduct.get(it.product_id) : null
                const registered = new Set(info.registeredColors.map(c => c.toLowerCase()))
                const selectedCodes = new Set((it.colors || []).map(c => (c.code || '').toLowerCase()))
                const gUI = galleryUI[it.id] || {}
                const q = (gUI.search || '').trim().toLowerCase()
                // v13.63 — filtro por fábrica do pedido (cores selecionadas nunca somem)
                const bankBase = (onlyFactoryColors && f.factory && anyColorRestricted)
                  ? (colors || []).filter(c => colorMatchesFactory(c) || selectedCodes.has((c.code || '').toLowerCase()))
                  : (colors || [])
                const bank = bankBase.filter(c =>
                  !q || (c.code || '').toLowerCase().includes(q) || (c.name_pt || '').toLowerCase().includes(q)
                )
                // v13.53 — galeria enxuta por padrão: cores do modelo + usuais + já
                // selecionadas. As 60+ do banco só aparecem expandindo ou buscando.
                const suggestedSet = new Set(((intel && intel.suggestedColors) || []).map(sc => (sc.code || '').toLowerCase()))
                const inShortlist = (c) => {
                  const k = (c.code || '').toLowerCase()
                  return registered.has(k) || suggestedSet.has(k) || selectedCodes.has(k)
                }
                const shortlist = bank.filter(inShortlist)
                const showAll = !!gUI.expanded || q.length > 0 || shortlist.length === 0
                const galleryBase = showAll ? bank : shortlist
                const hiddenCount = bank.length - shortlist.length
                // Cores do modelo primeiro, depois o resto
                const gallery = [
                  ...galleryBase.filter(c => registered.has((c.code || '').toLowerCase())),
                  ...galleryBase.filter(c => !registered.has((c.code || '').toLowerCase())),
                ]
                const pu = parseFloat(it.price_usd) || 0
                const itemQty = (it.colors || []).reduce((a, c) => a + Number(c.qty || 0), 0)
                const itemFob = (it.colors || []).reduce((a, c) => {
                  const cp = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : pu
                  return a + Number(c.qty || 0) * (cp || 0)
                }, 0)

                return (
                  <div key={it.id} style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', marginBottom: 16, overflow: 'hidden' }}>
                    {/* Cabeçalho do modelo */}
                    <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 56, height: 74, borderRadius: 8, overflow: 'hidden', background: 'var(--bg)', flexShrink: 0 }}>
                        {info.photo && <img src={info.photo} alt={info.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>
                          {UC(info.name)}
                          {info.isIdea && <span className="chip" style={{ marginLeft: 6, background: '#FEF3C7', color: '#92400E', fontSize: 10 }}>💡 ideia → vira produto</span>}
                        </div>
                        {info.code && <div className="text-muted" style={{ fontSize: 11, fontFamily: 'monospace' }}>{info.code}</div>}
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {itemQty} pç{itemQty !== 1 ? 's' : ''}{showPrices && itemFob > 0 ? ` · FOB ${fmt$(itemFob)}` : ''}
                        </div>
                        {/* v13.75 — RADAR: vende / tem / vem, a informação que decide a quantidade */}
                        {(() => {
                          const r = it.product_id ? radar.byProduct.get(it.product_id) : null
                          if (!r || (r.perDay <= 0 && r.stock <= 0 && r.inFlightQty <= 0)) return null
                          const tone = RADAR_TONE[r.status] || RADAR_TONE.ok
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4, fontSize: 11 }}>
                              <span style={{ background: tone.bg, color: tone.fg, borderRadius: 6, padding: '2px 7px', fontWeight: 700 }}>
                                {tone.icon} {tone.label}
                              </span>
                              {r.perDay > 0 && (
                                <span className="text-muted" title={`${r.sold} vendidas nos últimos ${radar.coverageDays} dias na loja${r.matchedBy === 'title' ? ' (ligado pelo nome do modelo)' : ''}`}>
                                  vende <strong>{r.perDay >= 1 ? r.perDay.toFixed(1) : r.perDay.toFixed(2)}</strong>/dia
                                </span>
                              )}
                              <span className="text-muted">·</span>
                              <span className="text-muted" title="Estoque atual na loja">
                                estoque <strong>{r.stock}</strong>{r.coverDays != null ? ` (${r.coverDays}d)` : ''}
                              </span>
                              {r.inFlightQty > 0 && (
                                <>
                                  <span className="text-muted">·</span>
                                  <span className="text-muted" title={r.inFlightOrders.map(o => `${o.name}: ${o.qty} pç`).join(' · ')}>
                                    <strong>{r.inFlightQty}</strong> vindo
                                    {r.daysToNextArrival != null ? ` (chega em ${r.daysToNextArrival}d)` : ''}
                                  </span>
                                </>
                              )}
                              {r.suggestedQty != null && (
                                <span
                                  title={r.explanation}
                                  style={{ marginLeft: 2, color: r.suggestedQty > 0 ? 'var(--primary)' : 'var(--text-muted, #6b7280)', fontWeight: 700 }}
                                >
                                  → pedir ~{r.suggestedQty}
                                </span>
                              )}
                            </div>
                          )
                        })()}
                        {/* Sinais do histórico: alerta de preço + pedido a caminho */}
                        {intel && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5 }}>
                            {showPrices && intel.price && intel.price.lastPrice != null && (() => {
                              const canApply = pu === 0
                              const Tag = canApply ? 'button' : 'span'
                              return (
                                <Tag
                                  className="chip"
                                  onClick={canApply ? () => updItem(it.id, 'price_usd', intel.price.lastPrice) : undefined}
                                  style={{
                                    fontSize: 10, border: 'none',
                                    cursor: canApply ? 'pointer' : 'default',
                                    background: intel.price.hasIncreaseAlert ? '#FEE2E2' : '#EEF2F7',
                                    color: intel.price.hasIncreaseAlert ? '#991B1B' : '#475569',
                                  }}
                                  title={`Última FOB registrada: $${intel.price.lastPrice.toFixed(2)} · ${intel.price.count} pedido(s) no histórico${canApply ? ' — clique pra usar' : ''}`}
                                >
                                  {intel.price.trend === 'up' ? '📈' : intel.price.trend === 'down' ? '📉' : '💲'} última FOB ${intel.price.lastPrice.toFixed(2)}
                                  {intel.price.hasIncreaseAlert && intel.price.lastIncreasePct != null ? ` · subiu ${Math.round(intel.price.lastIncreasePct)}%` : ''}
                                  {canApply ? ' · usar' : ''}
                                </Tag>
                              )
                            })()}
                            {(intel.inFlight || []).map(fl => (
                              <span
                                key={fl.orderId}
                                className="chip"
                                style={{ fontSize: 10, background: '#FEF3C7', color: '#92400E' }}
                                title={fl.colors.map(c => `${c.code} ×${c.qty}`).join(', ')}
                              >
                                ⏳ já vindo: {fl.orderName}{fl.expectedArrival ? ` · chega ${formatDate(fl.expectedArrival, 'full')}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {showPrices && (
                        <div style={{ width: 110 }}>
                          <label className="text-muted" style={{ fontSize: 9, display: 'block', marginBottom: 2 }}>💲 PREÇO USD BASE</label>
                          <input className="field field-sm" type="number" step="0.01" placeholder="0.00" value={it.price_usd ?? ''} onChange={e => updItem(it.id, 'price_usd', e.target.value)} />
                        </div>
                      )}
                      <button className="btn-icon text-danger" onClick={() => rmItem(it.id)} title="Remover modelo do pedido" aria-label="Remover modelo do pedido">✕</button>
                    </div>

                    {/* v13.58 — Requeriments pra fábrica (vai na planilha, por modelo) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted, #6b7280)', whiteSpace: 'nowrap' }}>📝 Requeriments</span>
                      <input
                        className="field field-sm"
                        style={{ flex: 1, fontSize: 12 }}
                        placeholder="pra fábrica — ex: hd lace, same hairline, no baby hair, elastic band"
                        value={it.requirements || ''}
                        onChange={e => updItem(it.id, 'requirements', e.target.value)}
                        title="Instruções deste modelo — sai na coluna Requeriments da planilha da fábrica"
                      />
                    </div>

                    {/* Galeria de cores */}
                    <div style={{ padding: 12, borderBottom: (it.colors || []).length > 0 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10 }}>
                        <span className="text-muted" style={{ fontSize: 11 }}>
                          Toque numa cor pra adicionar {info.registeredColors.length > 0 ? '· ⭐ = cores do modelo' : ''}
                        </span>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          {/* v13.63 — toggle: só cores desta fábrica ⇄ todas */}
                          {anyColorRestricted && f.factory && (
                            <button
                              onClick={() => setOnlyFactoryColors(v => !v)}
                              title={onlyFactoryColors
                                ? `Mostrando as cores de ${f.factory} + as sem restrição de fábrica. Clique pra ver TODAS.`
                                : 'Mostrando todas as cores do banco. Clique pra filtrar pelas da fábrica deste pedido.'}
                              style={{
                                fontSize: 11, padding: '4px 10px', borderRadius: 12, cursor: 'pointer',
                                border: `1px solid ${onlyFactoryColors ? 'var(--primary)' : 'var(--border)'}`,
                                background: onlyFactoryColors ? 'var(--primary)' : 'transparent',
                                color: onlyFactoryColors ? '#fff' : 'var(--text-muted, #6b7280)',
                                fontWeight: 600, whiteSpace: 'nowrap',
                              }}
                            >
                              {onlyFactoryColors ? `🏭 cores de ${f.factory}` : '🌐 todas as cores'}
                            </button>
                          )}
                          <input className="field field-sm" placeholder="🔍 Buscar cor..." value={gUI.search || ''} onChange={e => setGallery(it.id, { search: e.target.value })} style={{ width: 160 }} />
                        </div>
                      </div>
                      {/* Cores que este modelo costuma levar (do histórico) — 1 toque adiciona já com a quantidade média */}
                      {(() => {
                        const sugg = ((intel && intel.suggestedColors) || []).filter(sc => !selectedCodes.has((sc.code || '').toLowerCase()))
                        if (sugg.length === 0) return null
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
                            <span className="text-muted" style={{ fontSize: 11 }}>↻ Costuma pedir:</span>
                            {sugg.slice(0, 6).map(sc => (
                              <button
                                key={sc.code}
                                onClick={() => toggleColor(it.id, sc.code, registered.has((sc.code || '').toLowerCase()))}
                                className="chip"
                                style={{ cursor: 'pointer', fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                                title={`Adicionar ${sc.code} — média ${sc.avgQty}un em ${sc.count} pedido(s)`}
                              >
                                + {sc.code} <span className="text-muted">~{sc.avgQty}</span>
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {gallery.map(c => {
                          const isSel = selectedCodes.has((c.code || '').toLowerCase())
                          const isReg = registered.has((c.code || '').toLowerCase())
                          return (
                            <button
                              key={c.id}
                              onClick={() => toggleColor(it.id, c.code, isReg)}
                              title={`${c.code}${c.name_pt ? ' · ' + c.name_pt : ''}${isSel ? ' (remover)' : ''}`}
                              style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                                background: 'none', border: 'none', cursor: 'pointer', padding: 2, width: 62,
                              }}
                            >
                              <div style={{ position: 'relative', borderRadius: '50%', padding: 2, border: `2px solid ${isSel ? 'var(--primary)' : 'transparent'}` }}>
                                <div style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', border: '1px solid var(--border)', background: c.hex || 'var(--bg)' }}>
                                  {c.photo_url && <img src={c.photo_url} alt={c.code} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                </div>
                                {isReg && <span style={{ position: 'absolute', top: -4, right: -4, fontSize: 11 }}>⭐</span>}
                                {isSel && (
                                  <span style={{
                                    position: 'absolute', bottom: -2, right: -2, width: 17, height: 17, borderRadius: '50%',
                                    background: 'var(--primary)', color: '#fff', fontSize: 10, fontWeight: 700,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}>✓</span>
                                )}
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text)', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.code}</span>
                            </button>
                          )
                        })}
                        {gallery.length === 0 && <span className="text-muted text-sm">Nenhuma cor encontrada no banco.</span>}
                        {/* Expandir/recolher o resto do banco de cores */}
                        {!q && shortlist.length > 0 && hiddenCount > 0 && (
                          <button
                            onClick={() => setGallery(it.id, { expanded: !gUI.expanded })}
                            title={showAll ? 'Mostrar só as cores do modelo e as usuais' : `Mostrar as outras ${hiddenCount} cores do banco`}
                            style={{
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                              background: 'none', border: 'none', cursor: 'pointer', padding: 2, width: 62,
                            }}
                          >
                            <div style={{
                              width: 48, height: 48, borderRadius: '50%', margin: 2,
                              border: '1px dashed var(--border-strong, var(--border))',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 13, fontWeight: 700, color: 'var(--text-muted, #6b7280)',
                            }}>
                              {showAll ? '−' : `+${hiddenCount}`}
                            </div>
                            <span style={{ fontSize: 10, color: 'var(--text-muted, #6b7280)' }}>{showAll ? 'menos' : 'todas'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Cabeçalho das colunas — orienta o que é preço, quantidade e total */}
                    {(it.colors || []).length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: .5, color: 'var(--text-muted, #6b7280)', background: 'var(--bg)' }}>
                        <div style={{ flex: 1 }}>Combinação</div>
                        {showPrices && <div style={{ width: 108, textAlign: 'center' }}>preço/un</div>}
                        <div style={{ width: 118, textAlign: 'center' }}>quantidade</div>
                        {showPrices && <div style={{ width: 82, textAlign: 'right' }}>total</div>}
                        <div style={{ width: 26 }} />
                      </div>
                    )}
                    {/* Combinações modelo+cor */}
                    {(it.colors || []).map((cl, idx) => {
                      const bankColor = (colors || []).find(c => (c.code || '').toLowerCase() === (cl.code || '').toLowerCase())
                      const colorPrice = cl.price_usd != null && cl.price_usd !== '' ? parseFloat(cl.price_usd) : null
                      const effective = colorPrice != null ? colorPrice : pu
                      const hasCustom = colorPrice != null && colorPrice !== pu
                      const lineTotal = Number(cl.qty || 0) * (effective || 0)
                      const sug = it.product_id ? suggestQuantity(it.product_id, cl.code, orders) : null
                      const cr = it.product_id ? colorRadar(it.product_id, cl.code) : null
                      return (
                        <div key={cl.code || idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderBottom: '1px solid var(--border-light, var(--border))' }}>
                          {/* Lado a lado: foto do modelo + foto da cor — o "como fica?" */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <div style={{ width: 34, height: 44, borderRadius: 6, overflow: 'hidden', background: 'var(--bg)' }}>
                              {info.photo && <img src={info.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            </div>
                            <span className="text-muted" style={{ fontSize: 10 }}>+</span>
                            <ColorSwatch color={bankColor} code={cl.code} colors={colors} size="md" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{UC(info.name)} · {cl.code}</div>
                            <div className="text-muted" style={{ fontSize: 11 }}>
                              {bankColor?.name_pt || ''}
                              {hasCustom && <span style={{ color: '#B45309' }}>{bankColor?.name_pt ? ' · ' : ''}preço próprio</span>}
                              {/* v13.62 — quanto ESTA peça custa chegando no Brasil */}
                              {showPrices && effective > 0 && effRate > 0 && (
                                <span title={`${fmt$(effective)} × ${effFactor} × ${effRate.toFixed(2)} — custo estimado por peça no Brasil`}>
                                  {(bankColor?.name_pt || hasCustom) ? ' · ' : ''}≈ {fmtR$(effective * effFactor * effRate)}/un
                                </span>
                              )}
                            </div>
                            {/* v13.75 — esta COR na loja: estoque, venda e o que já vem */}
                            {cr && (
                              <div style={{ fontSize: 10, color: cr.stock === 0 && cr.perDay > 0 ? '#DC2626' : 'var(--text-muted, #6b7280)', marginTop: 2 }}>
                                🏬 estoque {cr.stock}
                                {cr.perDay > 0 && ` · vende ${cr.perDay >= 1 ? cr.perDay.toFixed(1) : cr.perDay.toFixed(2)}/dia`}
                                {cr.coverDays != null && ` · dura ${cr.coverDays}d`}
                                {cr.inFlightQty > 0 && ` · ${cr.inFlightQty} vindo`}
                              </div>
                            )}
                            {/* Entrou zerada porque a loja não pede reposição: explica o porquê */}
                            {cr && cr.suggestedQty === 0 && Number(cl.qty || 0) === 0 && (
                              <div style={{ fontSize: 10, color: '#166534', marginTop: 2 }}>
                                ✓ não precisa repor agora{cr.inFlightQty > 0 ? ` — ${cr.inFlightQty} já vindo` : ` — estoque cobre ${cr.coverDays}d`}
                              </div>
                            )}
                            {/* Sugestão: a da loja manda; sem venda registrada, a do histórico */}
                            {cr && cr.suggestedQty != null && cr.suggestedQty !== Number(cl.qty || 0) ? (
                              <button
                                onClick={() => updColor(it.id, idx, 'qty', cr.suggestedQty)}
                                style={{ background: 'none', border: 'none', padding: 0, marginTop: 2, cursor: 'pointer', fontSize: 10, color: 'var(--primary)', fontWeight: 700 }}
                                title={`Venda ${cr.perDay.toFixed(2)}/dia × (${leadDaysNow}d de fábrica + ${coverTarget}d de estoque) − ${cr.stock} em estoque${cr.inFlightQty ? ` − ${cr.inFlightQty} já vindo` : ''}`}
                              >
                                ↩ usar sugerido pela loja: {cr.suggestedQty}
                              </button>
                            ) : (!cr && sug && sug.avg !== Number(cl.qty || 0) && (
                              <button
                                onClick={() => updColor(it.id, idx, 'qty', sug.avg)}
                                style={{ background: 'none', border: 'none', padding: 0, marginTop: 2, cursor: 'pointer', fontSize: 10, color: 'var(--primary)' }}
                                title={`Média de ${sug.count} pedido(s) anteriores desta combinação`}
                              >
                                ↩ usar sugerido: {sug.avg} (média do que você já pediu)
                              </button>
                            ))}
                          </div>
                          {/* Preço com cara de dinheiro: $ …… /un (herda do modelo se vazio) */}
                          {showPrices && (
                            <div
                              title={hasCustom ? `Preço próprio desta cor (modelo é ${fmt$(pu)})` : 'Deixe vazio pra herdar o preço do modelo'}
                              style={{
                                display: 'flex', alignItems: 'center', width: 108, flexShrink: 0,
                                border: `1px solid ${hasCustom ? '#F59E0B' : 'var(--border)'}`,
                                borderRadius: 8, background: hasCustom ? '#FFFBEB' : 'var(--surface)',
                                padding: '0 8px', height: 32,
                              }}
                            >
                              <span style={{ fontSize: 12, color: 'var(--text-muted, #6b7280)' }}>$</span>
                              <input
                                type="number" step="0.01" min="0"
                                placeholder={pu > 0 ? pu.toFixed(2) : '0.00'}
                                value={cl.price_usd ?? ''}
                                onChange={e => updColor(it.id, idx, 'price_usd', e.target.value)}
                                aria-label={`Preço da cor ${cl.code} (vazio herda do modelo)`}
                                style={{
                                  width: '100%', border: 'none', outline: 'none', background: 'transparent',
                                  fontSize: 13, fontWeight: hasCustom ? 700 : 400, textAlign: 'right',
                                  color: 'var(--text)', padding: '0 3px',
                                }}
                              />
                              <span style={{ fontSize: 10, color: 'var(--text-muted, #6b7280)', whiteSpace: 'nowrap' }}>/un</span>
                            </div>
                          )}
                          {/* Quantidade: stepper único [− | 25 | +] (passo de 5) */}
                          <div style={{
                            display: 'flex', alignItems: 'stretch', width: 118, flexShrink: 0, height: 32,
                            border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)',
                          }}>
                            <button
                              onClick={() => bumpQty(it.id, idx, -QTY_STEP)}
                              aria-label={`Diminuir ${QTY_STEP} da cor ${cl.code}`}
                              title={`−${QTY_STEP}`}
                              style={{ width: 32, border: 'none', borderRight: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 15, color: 'var(--text)' }}
                            >−</button>
                            <input
                              type="number" min="0"
                              value={cl.qty ?? ''}
                              onChange={e => updColor(it.id, idx, 'qty', e.target.value)}
                              aria-label={`Quantidade da cor ${cl.code}`}
                              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', textAlign: 'center', fontWeight: 700, fontSize: 14, background: 'transparent', color: 'var(--text)' }}
                            />
                            <button
                              onClick={() => bumpQty(it.id, idx, QTY_STEP)}
                              aria-label={`Aumentar ${QTY_STEP} na cor ${cl.code}`}
                              title={`+${QTY_STEP}`}
                              style={{ width: 32, border: 'none', borderLeft: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', fontSize: 15, color: 'var(--text)' }}
                            >+</button>
                          </div>
                          {/* Total só quando existe (nada de "—" solto parecendo sinal de menos) */}
                          {showPrices && (
                            <div style={{ width: 82, textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#F59E0B', flexShrink: 0 }}>
                              {lineTotal > 0 ? '= ' + fmt$(lineTotal) : ''}
                            </div>
                          )}
                          <button className="btn-icon text-danger" style={{ width: 26, flexShrink: 0 }} onClick={() => toggleColor(it.id, cl.code, false)} title="Remover combinação" aria-label={`Remover cor ${cl.code}`}>✕</button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ETAPA 3 — Revisão */}
        {step === 3 && (
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div className="form-group">
              <label className="field-label">Nome do pedido</label>
              <input
                className="field"
                value={f.order_name}
                onChange={e => { nameTouched.current = true; s('order_name', e.target.value) }}
                placeholder={suggestedName || 'Ex: AGO/26 · HAIRCHUAN'}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="field-label">{isEdit ? 'Status' : 'Status inicial'}</label>
                <select className="field" value={f.status} onChange={e => s('status', e.target.value)}>
                  {/* v13.60 — ícones vêm do ORDER_ST (o 📨 hardcoded divergia do resto do app) */}
                  {(isEdit ? ORDER_ST : ORDER_ST.filter(x => x.id === 'draft' || x.id === 'sent'))
                    .map(x => <option key={x.id} value={x.id}>{x.icon} {x.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="field-label">Previsão de chegada <span className="text-muted text-xs">— opcional</span></label>
                <input className="field" type="date" value={f.expected_arrival || ''} onChange={e => s('expected_arrival', e.target.value || null)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="field-label">📅 Data do pedido <span className="text-muted text-xs">— vazio = hoje</span></label>
                <input className="field" type="date" value={f.order_date || ''} onChange={e => s('order_date', e.target.value || null)} />
              </div>
              <div className="form-group">
                <label className="field-label">⏱️ Prazo prometido <span className="text-muted text-xs">— dias, opcional</span></label>
                <input
                  className="field" type="number" min="1" max="365"
                  value={f.promised_lead_days || ''}
                  onChange={e => s('promised_lead_days', e.target.value ? parseInt(e.target.value, 10) : null)}
                  placeholder={leadTimeByFactory.get(f.factory) ? `sugestão: ${leadTimeByFactory.get(f.factory).avgDays}` : 'ex: 90'}
                />
              </div>
            </div>

            {/* v13.75 — o que este pedido significa: quando chega e quanto dura */}
            {(() => {
              const start = parseDateLocal(f.order_date) || new Date()
              const eta = new Date(start.getTime() + leadDaysNow * 86400000)
              const etaIso = `${eta.getFullYear()}-${String(eta.getMonth() + 1).padStart(2, '0')}-${String(eta.getDate()).padStart(2, '0')}`
              // Cobertura: peças deste pedido ÷ venda/dia dos modelos com sinal de loja
              let qtyWithSignal = 0, perDaySum = 0
              for (const it of (f.items || [])) {
                const r = it.product_id ? radar.byProduct.get(it.product_id) : null
                if (!r || r.perDay <= 0) continue
                const q = (it.colors || []).reduce((a2, c) => a2 + Number(c.qty || 0), 0)
                if (q <= 0) continue   // modelo sem peça não entra na conta
                qtyWithSignal += q
                perDaySum += r.perDay
              }
              const coverDays = perDaySum > 0 ? Math.round(qtyWithSignal / perDaySum) : null
              return (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', background: 'var(--bg)', borderRadius: 10, marginTop: 6, fontSize: 12 }}>
                  <span title={`Prazo médio da ${f.factory || 'fábrica'}: ${leadDaysNow} dias`}>
                    ⏳ Se a fábrica levar ~{leadDaysNow} dias, chega por volta de <strong>{formatDate(etaIso, 'full')}</strong>
                  </span>
                  {f.expected_arrival !== etaIso && (
                    <button className="btn btn-outline btn-sm" onClick={() => s('expected_arrival', etaIso)}>
                      usar como previsão
                    </button>
                  )}
                  {coverDays != null && (
                    <span style={{ marginLeft: 'auto' }} title="Peças deste pedido ÷ venda por dia dos modelos que a loja registra">
                      📦 cobre ~<strong>{coverDays} dias</strong> de venda
                    </span>
                  )}
                </div>
              )
            })()}

            {/* Resumo tipo planilha da fábrica */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginTop: 6 }}>
              {(f.items || []).map(it => {
                const info = modelInfo(it)
                const pu = parseFloat(it.price_usd) || 0
                const withQty = (it.colors || []).filter(c => Number(c.qty || 0) > 0)
                if (withQty.length === 0) return null
                return (
                  <div key={it.id} style={{ display: 'flex', gap: 12, padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                    <div style={{ width: 64, height: 84, borderRadius: 8, overflow: 'hidden', background: 'var(--bg)', flexShrink: 0 }}>
                      {info.photo && <img src={info.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{UC(info.name)} {info.code && <span className="text-muted" style={{ fontSize: 11, fontFamily: 'monospace' }}>· {info.code}</span>}</div>
                      <table style={{ width: '100%', fontSize: 12, marginTop: 6, borderCollapse: 'collapse' }}>
                        <tbody>
                          {withQty.map((c, i) => {
                            const cp = c.price_usd != null && c.price_usd !== '' ? parseFloat(c.price_usd) : pu
                            return (
                              <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border-light, var(--border))' : 'none' }}>
                                <td style={{ padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <ColorSwatch code={c.code} colors={colors} size="xs" /> {c.code}
                                </td>
                                <td style={{ textAlign: 'center', width: 60 }}>{c.qty}</td>
                                {showPrices && <td style={{ textAlign: 'right', width: 70 }}>{cp > 0 ? fmt$(cp) : '—'}</td>}
                                {showPrices && <td style={{ textAlign: 'right', width: 80, fontWeight: 600 }}>{cp > 0 ? fmt$(cp * Number(c.qty || 0)) : '—'}</td>}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="field-label">
                Aviso geral do pedido
                <span className="text-muted text-xs" style={{ marginLeft: 6, fontWeight: 400 }}>— sai como banner amarelo no topo da planilha da fábrica</span>
              </label>
              <textarea className="field" value={f.notes} onChange={e => s('notes', e.target.value)} placeholder="Ex: Our products fiber cant SHINE! All products should have the combs in the cap" />
            </div>
          </div>
        )}
      </div>

      {/* ── Rodapé: totais ao vivo + navegação ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'baseline', fontSize: 13, flexWrap: 'wrap' }}>
          <span><strong style={{ fontSize: 16 }}>{totals.qty}</strong> <span className="text-muted">peças</span></span>
          {showPrices && totals.fob > 0 && (
            <span style={{ color: '#F59E0B', fontWeight: 700, fontSize: 15 }}>FOB {fmt$(totals.fob)}</span>
          )}
          {showPrices && totals.landed != null && totals.fob > 0 && (
            <span
              className="text-muted"
              title={`FOB ${fmt$(totals.fob)} × fator ${effFactor} × US$ ${effRate.toFixed(2)} — estimativa de quanto essas peças custam chegando no Brasil (ajuste fator/dólar no topo)`}
            >≈ <strong style={{ color: 'var(--text)' }}>{fmtR$(totals.landed)}</strong> no Brasil</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 1 && <button className="btn btn-outline" onClick={() => setStep(step - 1)}>← Voltar</button>}
          {step < 3 && (
            <button className="btn btn-primary" disabled={!canAdvance} onClick={() => setStep(step + 1)}>
              {step === 1 ? 'Escolher modelos →' : 'Revisar pedido →'}
            </button>
          )}
          {/* Planilha da fábrica não tem preços (v13.58) — disponível mesmo no hide mode */}
          {step === 3 && perm.prices && (
            <button className="btn btn-outline" disabled={exportingSheet} onClick={exportDraftSheet} title="Gera o Excel com fotos no formato enviado à fábrica (sem valores)">
              {exportingSheet ? '⏳ Gerando...' : '📊 Planilha da fábrica'}
            </button>
          )}
          {step === 3 && <SaveButton onSave={doSave}>{isEdit ? 'Salvar alterações' : 'Salvar pedido'}</SaveButton>}
        </div>
      </div>
    </div>
  )
}
