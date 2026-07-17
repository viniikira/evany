// src/lib/factorySheet.js
// v13.47 — Exporta a "planilha da fábrica": Excel (.xlsx) com fotos embutidas.
// v13.58 — Formato alinhado com a planilha real enviada à fábrica:
//   • SEM valores (FOB/TOTAL/PP/BRL são controle interno — fábrica não vê)
//   • Aviso geral do pedido no topo (banner amarelo, texto vermelho)
//   • Requeriments POR MODELO (campo próprio do item)
//   • Seção COLORS com foto logo abaixo de CADA modelo (não no fim)
//   • Até 2 fotos do modelo lado a lado (frente/verso quando houver galeria)
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

// ═══════════════════════════════════════════════════════════════════
// Geração do .xlsx
// ═══════════════════════════════════════════════════════════════════

const GREEN = 'FF92D050'    // verde dos destaques da planilha original
const CYAN = 'FF00FFFF'     // ciano do nome do modelo (planilha original)
const RED = 'FFFF0000'      // banner COLORS
const YELLOW = 'FFFFFF00'   // banner do aviso geral
const HEADER_GRAY = 'FFF2F2F2'
const PER_ROW = 5           // fotos de cor por linha

export async function generateFactorySheet(order, products = [], colors = []) {
  const data = buildFactorySheetData(order, products, colors)
  const ExcelJS = (await import('exceljs')).default

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Kira Gestão'
  const ws = wb.addWorksheet('PEDIDO', { views: [{ showGridLines: true }] })

  // A fotos do modelo (larga p/ 2 imgs) | B código+nome | C cap | D cor | E qtd | F..H requeriments
  ws.columns = [
    { width: 34 }, { width: 17 }, { width: 11 }, { width: 19 }, { width: 11 },
    { width: 16 }, { width: 16 }, { width: 16 },
  ]

  // ── Aviso geral do pedido (banner amarelo, como na planilha original) ──
  if (data.generalNote) {
    const noteRow = ws.addRow([`Note: ${data.generalNote}`])
    ws.mergeCells(noteRow.number, 1, noteRow.number, 8)
    const cell = ws.getCell(noteRow.number, 1)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } }
    cell.font = { bold: true, color: { argb: RED }, size: 11 }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    noteRow.height = Math.max(20, Math.ceil(data.generalNote.length / 90) * 16)
    ws.addRow([])
  }

  const header = ws.addRow(['', 'MODEL', 'CAP', 'COLOR', 'QUANTITY', 'Requeriments'])
  ws.mergeCells(header.number, 6, header.number, 8)
  header.font = { bold: true, size: 10 }
  header.alignment = { horizontal: 'center', vertical: 'middle' }
  header.eachCell({ includeEmpty: false }, cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_GRAY } }
    cell.border = thinBorder()
  })

  // ── Blocos por modelo ──
  for (const m of data.models) {
    const startRow = ws.rowCount + 1
    const n = Math.max(m.colorRows.length, 1)

    m.colorRows.forEach((r, i) => {
      const row = ws.addRow([
        i === 0 ? '' : undefined,
        i === 0 ? `${m.code}${m.code && m.name ? '\n' : ''}${m.name}` : undefined,
        i === 0 ? m.cap : undefined,
        r.colorCode || '—',
        r.qty,
        i === 0 ? (m.requirements || '') : undefined,
      ])
      row.height = Math.max(24, Math.floor(130 / n))
      row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
      for (const col of [3, 4, 5]) row.getCell(col).border = thinBorder()
    })

    const endRow = startRow + n - 1
    if (n > 1) {
      ws.mergeCells(startRow, 1, endRow, 1)
      ws.mergeCells(startRow, 2, endRow, 2)
      ws.mergeCells(startRow, 3, endRow, 3)
    }
    // Requeriments: caixa larga mesclada (F..H em todas as linhas do modelo)
    ws.mergeCells(startRow, 6, endRow, 8)
    const reqCell = ws.getCell(startRow, 6)
    reqCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    reqCell.font = { size: 10, color: { argb: 'FF1D4ED8' } }
    reqCell.border = thinBorder()
    // Nome do modelo em ciano (identidade visual da planilha original)
    const modelCell = ws.getCell(startRow, 2)
    modelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CYAN } }
    modelCell.font = { bold: true, size: 11 }
    modelCell.border = thinBorder()
    ws.getCell(startRow, 1).border = thinBorder()

    // Até 2 fotos do modelo lado a lado dentro da célula mesclada da coluna A
    const photos = (m.photoUrls || []).slice(0, 2)
    for (let pi = 0; pi < photos.length; pi++) {
      const img = await fetchAsJpeg(photos[pi])
      if (!img) continue
      const id = wb.addImage({ buffer: img.buffer, extension: 'jpeg' })
      const half = photos.length > 1 ? 0.5 : 1
      ws.addImage(id, {
        tl: { col: 0.03 + pi * half, row: startRow - 1 + 0.04 },
        br: { col: 0.03 + pi * half + (half - 0.06), row: endRow - 0.04 },
        editAs: 'oneCell',
      })
    }

    // ── COLORS deste modelo: banner vermelho + fotos (logo abaixo, como no original) ──
    const modelColors = m.usedColors
    if (modelColors.length > 0) {
      const bannerRow = ws.addRow(['COLORS'])
      ws.mergeCells(bannerRow.number, 1, bannerRow.number, 8)
      const banner = ws.getCell(bannerRow.number, 1)
      banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } }
      banner.font = { bold: true, color: { argb: YELLOW }, size: 12 }
      banner.alignment = { horizontal: 'center', vertical: 'middle' }
      bannerRow.height = 18

      for (let i = 0; i < modelColors.length; i += PER_ROW) {
        const chunk = modelColors.slice(i, i + PER_ROW)

        const labelRow = ws.addRow([])
        labelRow.height = 20
        chunk.forEach((c, j) => {
          const cell = labelRow.getCell(j + 1)
          cell.value = c.code
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
          cell.font = { bold: true, size: 10 }
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
          cell.border = thinBorder()
        })

        const photoRow = ws.addRow([])
        photoRow.height = 120
        for (let j = 0; j < chunk.length; j++) {
          const c = chunk[j]
          const img = c.photoUrl ? await fetchAsJpeg(c.photoUrl, 360) : await hexSwatchJpeg(c.hex)
          if (!img) continue
          const id = wb.addImage({ buffer: img.buffer, extension: 'jpeg' })
          ws.addImage(id, {
            tl: { col: j + 0.06, row: photoRow.number - 1 + 0.03 },
            br: { col: j + 0.94, row: photoRow.number - 0.03 },
            editAs: 'oneCell',
          })
        }
      }
    }

    ws.addRow([])  // respiro entre modelos
  }

  // ── Total geral: só PEÇAS (valores são controle interno, não vão pra fábrica) ──
  const totalRow = ws.addRow(['', '', '', 'TOTAL', data.grandQty])
  totalRow.font = { bold: true, size: 12 }
  totalRow.getCell(4).alignment = { horizontal: 'right' }
  totalRow.getCell(5).alignment = { horizontal: 'center' }
  totalRow.height = 22

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
  const s = { style: 'thin', color: { argb: 'FFBFBFBF' } }
  return { top: s, left: s, bottom: s, right: s }
}
