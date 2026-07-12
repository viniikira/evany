// src/lib/migrate.js
// Migra dados do kv_store antigo (JSON único) para as tabelas relacionais novas.
// PODE RODAR VÁRIAS VEZES — é idempotente via UPSERT quando possível.
// Mas é MUITO MELHOR rodar com dry_run=true primeiro, ver o log, e só depois real.
//
// Uso (na aba Backup, só admin):
//   await migrateFromKvStore({ dryRun: true })   // testa
//   await migrateFromKvStore({ dryRun: false })  // executa de verdade

import { supabase } from './supabase'

const LEGACY_KEYS = {
  products: 'k5-products',
  ideas: 'k5-ideas',
  orders: 'k5-orders',
  collections: 'k5-collections',
  factories: 'k5-factories',
  colors: 'k5-colors',
  names: 'k5-names',
  logs: 'k5-logs',
  shopifyCache: 'k5-shopify-cache',
}

async function readLegacy(key) {
  const { data, error } = await supabase.from('kv_store').select('value').eq('key', key)
  if (error) throw new Error(`Erro lendo ${key}: ${error.message}`)
  return data?.[0]?.value ?? null
}

function log(msgs, msg) { msgs.push(msg); console.log('[MIGRATE]', msg) }

export async function migrateFromKvStore({ dryRun = true } = {}) {
  const messages = []
  const counts = { inserted: {}, skipped: {}, errors: [] }
  log(messages, `=== MIGRAÇÃO ${dryRun ? '(DRY RUN)' : '(REAL)'} ===`)

  try {
    // 1) COLEÇÕES, FÁBRICAS, CORES — cadastros sem dependência
    const collections = (await readLegacy(LEGACY_KEYS.collections)) || []
    log(messages, `${collections.length} coleções legacy`)
    if (!dryRun) {
      for (const c of collections) {
        try {
          const { error } = await supabase.from('collections').upsert({
            name: c.name,
            description: c.description || null,
            active: c.active ?? true,
            logo_url: typeof c.logo === 'string' && c.logo.startsWith('http') ? c.logo : null,
          }, { onConflict: 'name' })
          if (error) { counts.errors.push(`coleção ${c.name}: ${error.message}`); continue }
          counts.inserted.collections = (counts.inserted.collections || 0) + 1
        } catch (e) { counts.errors.push(`coleção ${c.name}: ${e.message}`) }
      }
    }

    const factories = (await readLegacy(LEGACY_KEYS.factories)) || []
    log(messages, `${factories.length} fábricas legacy`)
    if (!dryRun) {
      for (const f of factories) {
        try {
          const { error } = await supabase.from('factories').upsert({
            name: f.name,
            country: f.country || 'China',
            contact: f.contact || null,
            notes: f.notes || null,
            wechats: f.wechats || [],
          }, { onConflict: 'name' })
          if (error) { counts.errors.push(`fábrica ${f.name}: ${error.message}`); continue }
          counts.inserted.factories = (counts.inserted.factories || 0) + 1
        } catch (e) { counts.errors.push(`fábrica ${f.name}: ${e.message}`) }
      }
    }

    const colors = (await readLegacy(LEGACY_KEYS.colors)) || []
    log(messages, `${colors.length} cores legacy`)
    if (!dryRun) {
      for (const c of colors) {
        try {
          const photoUrl = typeof c.photo === 'string' && c.photo.startsWith('http') ? c.photo : null
          const { error } = await supabase.from('colors').upsert({
            code: c.code,
            photo_url: photoUrl,
          }, { onConflict: 'code' })
          if (error) { counts.errors.push(`cor ${c.code}: ${error.message}`); continue }
          counts.inserted.colors = (counts.inserted.colors || 0) + 1
        } catch (e) { counts.errors.push(`cor ${c.code}: ${e.message}`) }
      }
    }

    // Nomes: só os livres (os usados serão inferidos automaticamente dos produtos)
    const names = (await readLegacy(LEGACY_KEYS.names)) || []
    const freeNames = names.filter(n => !n.used).map(n => n.name).filter(Boolean)
    log(messages, `${freeNames.length} nomes livres`)
    if (!dryRun) {
      for (const nm of freeNames) {
        try {
          const { error } = await supabase.from('names').upsert({ name: nm }, { onConflict: 'name' })
          if (error && !error.message.includes('duplicate')) {
            counts.errors.push(`nome ${nm}: ${error.message}`)
            continue
          }
          counts.inserted.names = (counts.inserted.names || 0) + 1
        } catch (e) { counts.errors.push(`nome ${nm}: ${e.message}`) }
      }
    }

    // 2) PRODUTOS + COLOR_VARIANTS + SUPPLIERS
    const products = (await readLegacy(LEGACY_KEYS.products)) || []
    log(messages, `${products.length} produtos legacy`)
    if (!dryRun) {
      // Pré-busca produtos existentes pra detectar duplicatas e pular
      const { data: existingProds } = await supabase.from('products').select('id, name')
      const existingByName = new Map()
      for (const ep of existingProds || []) existingByName.set(ep.name.toLowerCase(), ep.id)

      for (const p of products) {
        try {
          const nameKey = (p.name || '').toLowerCase()
          // Se já existe, pula (idempotente — re-rodar não duplica)
          if (existingByName.has(nameKey)) {
            counts.skipped.products = (counts.skipped.products || 0) + 1
            continue
          }
          
          const mapped = mapProductPayload(p)
          const { data: inserted, error } = await supabase
            .from('products').insert(mapped).select().single()
          if (error) { counts.errors.push(`produto ${p.name}: ${error.message}`); continue }
          existingByName.set(nameKey, inserted.id)

          if (p.colorVariants?.length) {
            // Deduplica color_variants por código
            const seen = new Set()
            const cvs = p.colorVariants
              .filter(cv => cv.code && !seen.has(cv.code.toLowerCase()) && (seen.add(cv.code.toLowerCase()) || true))
              .map(cv => ({
                product_id: inserted.id,
                code: cv.code,
                status: cv.status || 'idea',
                sku: cv.sku || null,
              }))
            if (cvs.length > 0) {
              const { error: e2 } = await supabase.from('color_variants').insert(cvs)
              if (e2) counts.errors.push(`color_variants ${p.name}: ${e2.message}`)
            }
          }

          if (p.suppliers?.length) {
            const supps = p.suppliers.map(s => ({
              product_id: inserted.id,
              factory: s.factory,
              factory_code: s.factoryCode || null,
              price_usd: s.priceUsd ? parseFloat(s.priceUsd) : null,
            }))
            const { error: e3 } = await supabase.from('suppliers').insert(supps)
            if (e3) counts.errors.push(`suppliers ${p.name}: ${e3.message}`)
          }

          counts.inserted.products = (counts.inserted.products || 0) + 1
        } catch (e) { counts.errors.push(`produto ${p.name}: ${e.message}`) }
      }
    }

    // 3) IDEAS
    const ideas = (await readLegacy(LEGACY_KEYS.ideas)) || []
    log(messages, `${ideas.length} ideias legacy`)
    if (!dryRun) {
      for (const i of ideas) {
        try {
          const mapped = mapIdeaPayload(i)
          const { error } = await supabase.from('ideas').insert(mapped)
          if (error) { counts.errors.push(`ideia ${i.name}: ${error.message}`); continue }
          counts.inserted.ideas = (counts.inserted.ideas || 0) + 1
        } catch (e) { counts.errors.push(`ideia ${i.name}: ${e.message}`) }
      }
    }

    // 4) ORDERS + ORDER_ITEMS + PAYMENTS
    // Importante: precisamos do product_id MAPEADO (do id antigo pro uuid novo)
    // Vamos buscar todos os produtos novos e mapear por nome
    const { data: newProducts } = await supabase.from('products').select('id, name')
    const productIdByName = new Map()
    for (const np of newProducts || []) productIdByName.set(np.name.toLowerCase(), np.id)

    const orders = (await readLegacy(LEGACY_KEYS.orders)) || []
    log(messages, `${orders.length} pedidos legacy`)
    if (!dryRun) {
      for (const o of orders) {
        try {
          const mapped = mapOrderPayload(o)
          const { data: insertedOrder, error } = await supabase
            .from('orders').insert(mapped).select().single()
          if (error) { counts.errors.push(`pedido ${o.orderName || o.factory}: ${error.message}`); continue }

          if (o.items?.length) {
            const items = o.items.map(it => {
              const pid = it.productId
                ? productIdByName.get((products.find(p => p.id === it.productId)?.name || '').toLowerCase())
                : null
              return {
                order_id: insertedOrder.id,
                product_id: pid || null,
                product_name_snapshot: it.nameManual || null,
                product_code_snapshot: it.codeManual || null,
                product_cap_snapshot: it.capManual || null,
                selected_photo_url: typeof it.selectedPhoto === 'string' && it.selectedPhoto.startsWith('http') ? it.selectedPhoto : null,
                name_manual: it.nameManual || null,
                code_manual: it.codeManual || null,
                cap_manual: it.capManual || null,
                quantity: Number(it.quantity) || 0,
                price_usd: it.priceUsd ? parseFloat(it.priceUsd) : null,
                colors: it.colors || [],
              }
            })
            const { error: e2 } = await supabase.from('order_items').insert(items)
            if (e2) counts.errors.push(`order_items ${o.orderName}: ${e2.message}`)
          }

          if (o.payments?.length) {
            const pays = o.payments.map(p => ({
              order_id: insertedOrder.id,
              payment_date: p.date || null,
              amount_usd: p.amountUsd ? parseFloat(p.amountUsd) : null,
              rate_paid: p.ratePaid ? parseFloat(p.ratePaid) : null,
              amount_brl: p.amountBrl ? parseFloat(p.amountBrl) : null,
              bank: p.bank || null,
              // receipt fica como null — a foto base64 NÃO migra automaticamente.
              // Ela continua salva no kv_store como backup, mas não aparece na UI nova.
              // Usuário reanexa manualmente se precisar.
              receipt_url: null,
            }))
            const { error: e3 } = await supabase.from('payments').insert(pays)
            if (e3) counts.errors.push(`payments ${o.orderName}: ${e3.message}`)
          }

          counts.inserted.orders = (counts.inserted.orders || 0) + 1
        } catch (e) { counts.errors.push(`pedido ${o.orderName}: ${e.message}`) }
      }
    }

    // 5) SHOPIFY CACHE
    const shopifyCache = (await readLegacy(LEGACY_KEYS.shopifyCache))
    if (shopifyCache && !dryRun) {
      await supabase.from('shopify_cache').update({
        products: shopifyCache.products || [],
        orders: shopifyCache.orders || [],
        last_sync: shopifyCache.lastSync || null,
      }).eq('id', 1)
      log(messages, `Shopify cache migrado (${(shopifyCache.products || []).length} produtos, ${(shopifyCache.orders || []).length} pedidos)`)
    }

    log(messages, `=== FIM ===`)
    return { messages, counts, ok: true }
  } catch (e) {
    log(messages, `ERRO FATAL: ${e.message}`)
    return { messages, counts, ok: false, error: e.message }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Mappers de payload (converte estrutura antiga → nova)
// Base64 em fotos: se começar com http, migra. Se for data: url, ignora
// (usuário vai precisar reanexar quando for para o Storage).
// ═══════════════════════════════════════════════════════════════════

function validPhotoUrl(v) {
  if (typeof v !== 'string') return null
  if (v.startsWith('http://') || v.startsWith('https://')) return v
  return null
}

function validPhotos(arr) {
  if (!Array.isArray(arr)) return []
  return arr.map(validPhotoUrl).filter(Boolean)
}

function mapProductPayload(p) {
  return {
    name: p.name,
    status: p.status || 'developing',
    collection: p.collection || null,
    factory: p.factory || null,
    factory_code: p.factoryCode || null,
    finish_type: p.finishType || null,
    reparticao: p.reparticao || null,
    reparticao_size: p.reparticaoSize || null,
    reparticao_acabamento: p.reparticaoAcabamento || null,
    hair_type: p.hairType || null,
    length: p.length || null,
    material: p.material || null,
    notes: p.notes || null,
    card_image_url: validPhotoUrl(p.cardImage),
    photos: validPhotos(p.photos),
    sku: p.sku || null,
    pre_plucked: p.prePlucked || false,
    price_usd: p.priceUsd ? parseFloat(p.priceUsd) : null,
    internal_notes: p.internalNotes || [],
    timeline: p.timeline || [],
  }
}

function mapIdeaPayload(i) {
  return {
    name: i.name,
    status: i.status || 'possibility',
    collection: i.collection || null,
    factory: i.factory || null,
    factory_code: i.factoryCode || null,
    finish_type: i.finishType || null,
    reparticao: i.reparticao || null,
    reparticao_size: i.reparticaoSize || null,
    reparticao_acabamento: i.reparticaoAcabamento || null,
    hair_type: i.hairType || null,
    length: i.length || null,
    material: i.material || null,
    notes: i.notes || null,
    card_image_url: validPhotoUrl(i.cardImage),
    photos: validPhotos(i.photos),
    price_usd: i.priceUsd ? parseFloat(i.priceUsd) : null,
    timeline: i.timeline || [],
  }
}

function mapOrderPayload(o) {
  return {
    order_name: o.orderName || null,
    factory: o.factory,
    status: o.status || 'draft',
    dispatch_code: o.dispatchCode || null,
    conversion_factor: o.conversionFactor ? parseFloat(o.conversionFactor) : 1.5,
    budget_rate: o.budgetRate ? parseFloat(o.budgetRate) : null,
    real_cost_brl: o.realCostBrl ? parseFloat(o.realCostBrl) : null,
    notes: o.notes || null,
    expected_arrival: o.expectedArrival || null,
  }
}
