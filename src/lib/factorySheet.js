// src/lib/factorySheet.js
// v13.47 — Exporta a "planilha da fábrica": Excel (.xlsx) com fotos embutidas.
// v13.58 — Formato alinhado com a planilha real (sem valores; requeriments
//          por modelo; aviso geral; COLORS por modelo).
// v13.59 — Layout reconstruído após teste real da usuária:
//   • Grade de 16 colunas UNIFORMES + mesclagens (como a planilha original é
//     feita) — células não estouram com nomes grandes
//   • Fotos em TAMANHO FIXO proporcional (tl+ext) — nunca esticam/espremem,
//     inclusive no Google Sheets (o anchor de célula distorcia lá)
//   • Cabeçalho repetido em cada modelo + FAIXA ROSA separando os blocos
//
// ExcelJS é pesado (~940KB) — carregado via import() dinâmico só quando o
// usuário clica em exportar, pra não inflar o bundle principal.

import { UC } from './utils'
import { log } from './logger'

// ═══════════════════════════════════════════════════════════════════
// Camada pura (testável): transforma pedido → estrutura da planilha
// ═══════════════════════════════════════════════════════════════════

export function buildFactorySheetData(order, products = [], colors = []) {
  const models = (order?.items || []).map(it => {
    const prod = products.find(p => p.id === it.product_id)
    const name = it.name_manual || prod?.name || it.product_name_snapshot || ''
    const code = it.code_manual || prod?.factory_code || it.product_code_snapshot || ''
    const cap = it.cap_manual || it.product_cap_snapshot || ''

    // Até 2 fotos do modelo (principal + uma da galeria), como na planilha real
    const main = it.selected_photo_url || prod?.card_image_url || (prod?.photos || [])[0] || null
    const extra = (prod?.photos || []).find(u => u && u !== main) || null
    const photoUrls = [main, extra].filter(Boolean)

    const cls = it.colors || []
    const colorRows = cls.length > 0
      ? cls.filter(c => c && c.code).map(c => ({ colorCode: c.code, qty: Number(c.qty || 0) }))
      : [{ colorCode: '', qty: Number(it.quantity || 0) }]

    // Cores deste modelo com foto/hex do banco (case-insensitive)
    const usedColors = colorRows
      .filter(r => r.colorCode)
      .map(r => {
        const bank = colors.find(c => (c.code || '').trim().toLowerCase() === r.colorCode.trim().toLowerCase())
        return {
          code: r.colorCode,
          photoUrl: bank?.photo_url || null,
          hex: bank?.hex || null,
        }
      })

    return {
      name: UC(name),
      code,
      cap,
      photoUrls,
      requirements: it.requirements || '',
      colorRows,
      usedColors,
      modelQty: colorRows.reduce((a, r) => a + r.qty, 0),
    }
  })

  return {
    factory: order?.factory || '',
    orderName: order?.order_name || '',
    generalNote: (order?.notes || '').trim(),
    models,
    grandQty: models.reduce((a, m) => a + m.modelQty, 0),
  }
}

// ═══════════════════════════════════════════════════════════════════
// Imagens: baixa e normaliza pra JPEG via canvas.
// Normalizar cobre PNG/WebP antigos (xlsx não aceita webp) e reduz o
// tamanho do arquivo (thumbnail é suficiente pra planilha).
// ═══════════════════════════════════════════════════════════════════

async function fetchAsJpeg(url, maxSize = 480) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = setTimeout(() => resolve(null), 15000)
    img.onload = () => {
      clearTimeout(timer)
      try {
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(img.naturalWidth * scale))
        c.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = c.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, c.width, c.height)
        ctx.drawImage(img, 0, 0, c.width, c.height)
        c.toBlob(async (blob) => {
          if (!blob) return resolve(null)
          resolve({ buffer: await blob.arrayBuffer(), width: c.width, height: c.height })
        }, 'image/jpeg', 0.85)
      } catch (e) {
        log.warn('[factory-sheet] falha ao converter imagem:', e)
        resolve(null)
      }
    }
    img.onerror = () => { clearTimeout(timer); resolve(null) }
    img.src = url
  })
}

// Swatch sólido com o hex da cor — fallback quando a cor não tem foto no banco.
function hexSwatchJpeg(hex, size = 240) {
  return new Promise((resolve) => {
    try {
      const c = document.createElement('canvas')
      c.width = size
      c.height = size
      const ctx = c.getContext('2d')
      ctx.fillStyle = /^#[0-9a-fA-F]{6}$/.test(hex || '') ? hex : '#d9d9d9'
      ctx.fillRect(0, 0, size, size)
      c.toBlob(async (blob) => {
        if (!blob) return resolve(null)
        resolve({ buffer: await blob.arrayBuffer(), width: size, height: size })
      }, 'image/jpeg', 0.85)
    } catch {
      resolve(null)
    }
  })
}

// Tamanho proporcional dentro de uma caixa (px) — a imagem NUNCA distorce.
function fitPx(img, maxW, maxH) {
  const r = Math.min(maxW / img.width, maxH / img.height, 1e9)
  return { width: Math.max(1, Math.round(img.width * r)), height: Math.max(1, Math.round(img.height * r)) }
}

// ═══════════════════════════════════════════════════════════════════
// Geração do .xlsx — grade de 16 colunas uniformes + mesclagens
// ═══════════════════════════════════════════════════════════════════

const GREEN = 'FF92D050'    // verde dos destaques da planilha original
const CYAN = 'FF00FFFF'     // ciano do nome do modelo
const RED = 'FFFF0000'      // banner COLORS
const YELLOW = 'FFFFFF00'   // aviso geral
const MAGENTA = 'FFFF00FF'  // faixa separadora entre modelos (planilha original)
const HEADER_GRAY = 'FFF2F2F2'

const N_COLS = 16
const COL_W = 9.5                      // largura uniforme (~71px cada)
const PX_PER_COL = Math.round(COL_W * 7 + 5)   // ≈ 71px
const PT_TO_PX = 4 / 3                 // altura de linha: pontos → pixels

// Regiões da grade (colunas 1-index, inclusive)
const PHOTO_C = [1, 4]      // fotos do modelo (2 fotos lado a lado)
const MODEL_C = [5, 7]      // código + nome (ciano)
const CAP_C = [8, 9]
const COLOR_C = [10, 12]    // código da cor (verde)
const QTY_C = [13, 13]
const REQ_C = [14, 16]      // requeriments

export async function generateFactorySheet(order, products = [], colors = []) {
  const data = buildFactorySheetData(order, products, colors)
  const ExcelJS = (await import('exceljs')).default

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Kira Gestão'
  const ws = wb.addWorksheet('PEDIDO', { views: [{ showGridLines: false }] })
  ws.columns = Array.from({ length: N_COLS }, () => ({ width: COL_W }))

  const mergeSet = (r1, c1, r2, c2, value, opts = {}) => {
    ws.mergeCells(r1, c1, r2, c2)
    const cell = ws.getCell(r1, c1)
    if (value !== undefined) cell.value = value
    if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } }
    if (opts.font) cell.font = opts.font
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, ...(opts.align || {}) }
    if (opts.border !== false) cell.border = thinBorder()
    return cell
  }

  // ── Aviso geral do pedido (banner amarelo, texto vermelho) ──
  if (data.generalNote) {
    const r = ws.addRow([]).number
    mergeSet(r, 1, r, N_COLS, `Note: ${data.generalNote}`, {
      fill: YELLOW,
      font: { bold: true, color: { argb: RED }, size: 11 },
    })
    ws.getRow(r).height = Math.max(22, Math.ceil(data.generalNote.length / 110) * 16)
    ws.addRow([])
  }

  // ── Blocos por modelo ──
  for (const m of data.models) {
    // Cabeçalho do bloco (repetido por modelo — fábrica entende cada seção)
    const hr = ws.addRow([]).number
    const H = { fill: HEADER_GRAY, font: { bold: true, size: 10 } }
    mergeSet(hr, PHOTO_C[0], hr, PHOTO_C[1], 'PHOTO', H)
    mergeSet(hr, MODEL_C[0], hr, MODEL_C[1], 'MODEL', H)
    mergeSet(hr, CAP_C[0], hr, CAP_C[1], 'CAP', H)
    mergeSet(hr, COLOR_C[0], hr, COLOR_C[1], 'COLOR', H)
    mergeSet(hr, QTY_C[0], hr, QTY_C[1], 'QUANTITY', H)
    mergeSet(hr, REQ_C[0], hr, REQ_C[1], 'Requeriments', H)
    ws.getRow(hr).height = 16

    const n = Math.max(m.colorRows.length, 1)
    // Altura de cada linha de cor: bloco total ≥ ~200px pra caber as fotos,
    // e cada linha ≥ 26pt pra nomes de cor grandes (2 linhas)
    const rowPt = Math.max(26, Math.ceil(210 / n / PT_TO_PX))
    const startRow = ws.rowCount + 1

    m.colorRows.forEach((r) => {
      const row = ws.addRow([])
      row.height = rowPt
      const rn = row.number
      mergeSet(rn, COLOR_C[0], rn, COLOR_C[1], r.colorCode || '—', { fill: GREEN, font: { bold: true, size: 10 } })
      mergeSet(rn, QTY_C[0], rn, QTY_C[1], r.qty, { font: { size: 11 } })
    })
    const endRow = startRow + n - 1

    // Regiões verticais do bloco (foto, modelo, cap, requeriments)
    mergeSet(startRow, PHOTO_C[0], endRow, PHOTO_C[1], '')
    mergeSet(startRow, MODEL_C[0], endRow, MODEL_C[1], `${m.code}${m.code && m.name ? '\n' : ''}${m.name}`, {
      fill: CYAN, font: { bold: true, size: 11 },
    })
    mergeSet(startRow, CAP_C[0], endRow, CAP_C[1], m.cap, { font: { size: 10 } })
    mergeSet(startRow, REQ_C[0], endRow, REQ_C[1], m.requirements || '', {
      font: { size: 10, color: { argb: 'FF1D4ED8' } },
      align: { horizontal: 'left' },
    })

    // Fotos do modelo: tamanho FIXO proporcional (nunca estica), lado a lado
    const blockPx = n * rowPt * PT_TO_PX
    const photos = (m.photoUrls || []).slice(0, 2)
    for (let pi = 0; pi < photos.length; pi++) {
      const img = await fetchAsJpeg(photos[pi])
      if (!img) continue
      const id = wb.addImage({ buffer: img.buffer, extension: 'jpeg' })
      const ext = fitPx(img, PX_PER_COL * 2 - 10, blockPx - 8)
      ws.addImage(id, {
        tl: { col: (PHOTO_C[0] - 1) + pi * 2 + 0.08, row: startRow - 1 + 0.05 },
        ext,
        editAs: 'oneCell',
      })
    }

    // ── COLORS deste modelo: banner vermelho + rótulo/foto por coluna dupla ──
    if (m.usedColors.length > 0) {
      const br = ws.addRow([]).number
      mergeSet(br, 1, br, N_COLS, 'COLORS', {
        fill: RED, font: { bold: true, color: { argb: YELLOW }, size: 12 },
      })
      ws.getRow(br).height = 16

      const PER_ROW = 8   // 8 cores por linha, cada uma em 2 colunas (~142px)
      for (let i = 0; i < m.usedColors.length; i += PER_ROW) {
        const chunk = m.usedColors.slice(i, i + PER_ROW)

        const labelRowN = ws.addRow([]).number
        ws.getRow(labelRowN).height = 24
        chunk.forEach((c, j) => {
          mergeSet(labelRowN, j * 2 + 1, labelRowN, j * 2 + 2, c.code, {
            fill: GREEN, font: { bold: true, size: 9 },
          })
        })

        const photoRowN = ws.addRow([]).number
        ws.getRow(photoRowN).height = 100  // ≈133px
        for (let j = 0; j < chunk.length; j++) {
          mergeSet(photoRowN, j * 2 + 1, photoRowN, j * 2 + 2, '')
          const c = chunk[j]
          const img = c.photoUrl ? await fetchAsJpeg(c.photoUrl, 360) : await hexSwatchJpeg(c.hex)
          if (!img) continue
          const id = wb.addImage({ buffer: img.buffer, extension: 'jpeg' })
          const ext = fitPx(img, PX_PER_COL * 2 - 12, 126)
          ws.addImage(id, {
            tl: { col: j * 2 + 0.08, row: photoRowN - 1 + 0.03 },
            ext,
            editAs: 'oneCell',
          })
        }
      }
    }

    // ── Faixa rosa separando os modelos (como na planilha original) ──
    const sep = ws.addRow([]).number
    mergeSet(sep, 1, sep, N_COLS, '', { fill: MAGENTA, border: false })
    ws.getRow(sep).height = 12
    ws.addRow([])
  }

  // ── Total geral: só PEÇAS (valores são controle interno, não vão pra fábrica) ──
  const tr = ws.addRow([]).number
  mergeSet(tr, COLOR_C[0], tr, COLOR_C[1], 'TOTAL', { font: { bold: true, size: 12 }, border: false, align: { horizontal: 'right' } })
  mergeSet(tr, QTY_C[0], tr, QTY_C[1], data.grandQty, { font: { bold: true, size: 12 }, border: false })
  ws.getRow(tr).height = 22

  // ── Download ──
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeName = (data.orderName || 'pedido').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')
  a.href = url
  a.download = `${data.factory || 'fabrica'}-${safeName || 'pedido'}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)

  return { models: data.models.length, colors: data.models.reduce((a, m) => a + m.usedColors.length, 0) }
}

function thinBorder() {
  const s = { style: 'thin', color: { argb: 'FF999999' } }
  return { top: s, left: s, bottom: s, right: s }
}
