// src/lib/storage.js
// Upload de imagens para Supabase Storage.
// Bucket product-photos é público (URL visível). 
// Bucket payment-receipts é privado (só admin).

import { supabase } from './supabase'
import { log } from './logger'

const BUCKET_PHOTOS = 'product-photos'
const BUCKET_RECEIPTS = 'payment-receipts'

// Comprime imagem antes de fazer upload.
// Mantém qualidade razoável pra fotos de produto (800px, q=0.82).
// Para comprovantes de pagamento NÃO comprime tanto — precisa ficar legível.
export async function compressForUpload(file, opts = {}) {
  const { maxW = 800, quality = 0.82, preserveQuality = false } = opts
  const effectiveMaxW = preserveQuality ? 1600 : maxW
  const effectiveQuality = preserveQuality ? 0.92 : quality

  // Se não for imagem (ex: PDF), retorna direto
  if (!file.type.startsWith('image/')) return file

  const dataUrl = await fileToDataUrl(file)
  const compressed = await compressDataUrl(dataUrl, effectiveMaxW, effectiveQuality)
  const blob = await dataUrlToBlob(compressed)
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('Erro ao ler arquivo'))
    r.readAsDataURL(file)
  })
}

function compressDataUrl(dataUrl, maxW, quality) {
  return new Promise((resolve) => {
    if (!dataUrl || !dataUrl.startsWith('data:image')) { resolve(dataUrl); return }
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      let w = img.width, h = img.height
      if (w > maxW) { h = h * (maxW / w); w = maxW }
      c.width = w; c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl)
  return await res.blob()
}

function generatePath(prefix, filename) {
  const ts = Date.now()
  // crypto.randomUUID garante unicidade — Math.random pode colidir e sobrescrever fotos
  const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 8)
  const ext = (filename.split('.').pop() || 'jpg').toLowerCase()
  return `${prefix}/${ts}-${rand}.${ext}`
}

// ═══════════════════════════════════════════════════════════════════
// Upload de foto de produto/cor/coleção (bucket público)
// Retorna URL pública. Detecta HEIC e avisa.
// ═══════════════════════════════════════════════════════════════════
export async function uploadProductPhoto(file, prefix = 'products') {
  // Detecta HEIC por extensão/mime (navegadores não processam HEIC nativo)
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.heic') || name.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif') {
    throw new Error('Formato HEIC não suportado. Compartilhe a foto como JPG/PNG.')
  }

  const compressed = await compressForUpload(file)
  const path = generatePath(prefix, compressed.name)

  const { error } = await supabase.storage
    .from(BUCKET_PHOTOS)
    .upload(path, compressed, { cacheControl: '3600', upsert: false })
  if (error) throw new Error(`Upload falhou: ${error.message}`)

  const { data } = supabase.storage.from(BUCKET_PHOTOS).getPublicUrl(path)
  return { url: data.publicUrl, path }
}

// ═══════════════════════════════════════════════════════════════════
// Upload de comprovante (bucket privado)
// ═══════════════════════════════════════════════════════════════════
export async function uploadReceipt(file, orderId) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.heic') || name.endsWith('.heif')) {
    throw new Error('Formato HEIC não suportado. Compartilhe como JPG/PNG/PDF.')
  }

  // Comprovante preserva qualidade (não usar max=400px do sistema antigo)
  const processed = file.type.startsWith('image/') 
    ? await compressForUpload(file, { preserveQuality: true })
    : file

  const path = generatePath(`order-${orderId}`, processed.name)
  const { error } = await supabase.storage
    .from(BUCKET_RECEIPTS)
    .upload(path, processed, { cacheControl: '3600', upsert: false })
  if (error) throw new Error(`Upload falhou: ${error.message}`)

  return { path, bucket: BUCKET_RECEIPTS }
}

// Gera URL temporária assinada pra ver comprovante (1h)
export async function getReceiptSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from(BUCKET_RECEIPTS)
    .createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

// Deleta foto antiga do bucket público quando o usuário troca/remove.
// Aceita URL pública completa OU path direto. Falhas silenciosas são OK
// (foto órfã não quebra nada — só ocupa espaço).
export async function deletePhoto(urlOrPath) {
  if (!urlOrPath) return
  let path = urlOrPath
  // Se é URL pública, extrai o path
  if (urlOrPath.startsWith('http')) {
    try {
      const u = new URL(urlOrPath)
      const marker = `/${BUCKET_PHOTOS}/`
      const idx = u.pathname.indexOf(marker)
      if (idx === -1) {
        // URL não é desse bucket, não tenta deletar
        log.warn('[KIRA] deletePhoto: URL não é do bucket', urlOrPath)
        return
      }
      path = decodeURIComponent(u.pathname.slice(idx + marker.length))
    } catch {
      return
    }
  }
  await supabase.storage.from(BUCKET_PHOTOS).remove([path]).catch(err => {
    log.warn('[KIRA] deletePhoto falhou (ignorado):', err.message)
  })
}

export async function deleteReceipt(pathOrUrl) {
  if (!pathOrUrl) return
  let path = pathOrUrl
  // Receipts geralmente são salvos como path puro, mas tratamos URL também
  if (pathOrUrl.startsWith('http')) {
    try {
      const u = new URL(pathOrUrl)
      const marker = `/${BUCKET_RECEIPTS}/`
      const idx = u.pathname.indexOf(marker)
      if (idx === -1) return
      path = decodeURIComponent(u.pathname.slice(idx + marker.length))
    } catch {
      return
    }
  }
  await supabase.storage.from(BUCKET_RECEIPTS).remove([path]).catch(err => {
    log.warn('[KIRA] deleteReceipt falhou (ignorado):', err.message)
  })
}
