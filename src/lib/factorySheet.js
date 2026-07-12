// src/lib/factorySheet.js
// v13.47 — Exporta a "planilha da fábrica": Excel (.xlsx) com fotos embutidas,
// no mesmo formato da planilha manual do Google Sheets que era montada à mão
// pra enviar à fábrica (foto do modelo, cores/quantidades, FOB, totais, PP,
// BRL e a seção COLORS com a foto real de cada cor do banco de cores).
//
// ExcelJS é pesado (~940KB) — carregado via import() dinâmico só quando o
// usuário clica em exportar, pra não inflar o bundle principal.

import { UC } from './utils'
import { log } from './logger'

// ═══════════════════════════════════════════════════════════════════
// Camada pura (testável): transforma pedido → estrutura da planilha
// ═══════════════════════════════════════════════════════════════════

// PP = FOB × fator de conversão (custo estimado com impostos/frete embutidos)
// BRL = PP × câmbio (budget_rate do pedido, ou câmbio atual passado como fallback)
export function buildFactorySheetData(order, products = [], colors = [], { rate } = {}) {
  const factor = parseFloat(order?.conversion_factor) || 1.5
  const fx = parseFloat(order?.budget_rate) || parseFloat(rate) || 0

  const models = (order?.items || []).map(it => {
    const prod = products.find(p => p.id === it.product_id)
    const name = it.name_manual || prod?.name || it.product_name_snapshot || ''
    const code = it.code_manual || prod?.factory_code || it.product_code_snapshot || ''
    const cap = it.cap_manual || it.product_cap_snapshot || ''
    const photoUrl = it.selected_photo_url || prod?.card_image_url || null
    const itemPrice = parseFloat(it.price_usd_snapshot ?? it.price_usd) || 0

    const cls = it.colors || []
    const colorRows = cls.length > 0
      ? cls.map(c => {
          const qty = Number(c.qty || 0)
          const fob = c.price_usd != null && c.price_usd !== '' ? (parseFloat(c.price_usd) || 0) : itemPrice
          return buildRow(c.code || '', qty, fob, factor, fx)
        })
      : [buildRow('', Number(it.quantity || 0), itemPrice, factor, fx)]

    return {
      name: UC(name),
      code,
      cap,
      photoUrl,
      colorRows,
      modelTotal: round2(colorRows.reduce((a, r) => a + r.total, 0)),
      modelQty: colorRows.reduce((a, r) => a + r.qty, 0),
    }
  })

  // Cores distintas usadas no pedido, com foto/hex do banco de cores.
  // Matching case-insensitive (mesma regra do resto do sistema).
  const seen = new Set()
  const usedColors = []
  for (const m of models) {
    for (const r of m.colorRows) {
      const key = (r.colorCode || '').trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      const bank = colors.find(c => (c.code || '').trim().toLowerCase() === key)
      usedColors.push({
        code: r.colorCode,
        photoUrl: bank?.photo_url || null,
        hex: bank?.hex || null,
        namePt: bank?.name_pt || null,
      })
    }
  }

  return {
    factory: order?.factory || '',
    orderName: order?.order_name || '',
    factor,
    rate: fx,
    models,
    usedColors,
    grandTotal: round2(models.reduce((a, m) => a + m.modelTotal, 0)),
    grandQty: models.reduce((a, m) => a + m.modelQty, 0),
  }
}

function buildRow(colorCode, qty, fob, factor, fx) {
  // BRL parte do PP cheio (sem arredondar) — mesmo comportamento da planilha
  // original do Google Sheets: 18.50×1.65×5.75 = R$175.52, não 30.53×5.75.
  return {
    colorCode,
    qty,
    fob: round2(fob),
    total: round2(fob * qty),
    pp: round2(fob * factor),
    brl: fx > 0 ? round2(fob * factor * fx) : null,
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
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

const GREEN = 'FF92D050'   // verde dos destaques da planilha original
const RED = 'FFFF0000'     // banner COLORS
const HEADER_GRAY = 'FFF2F2F2'

export async function generateFactorySheet(order, products = [], colors = [], { rate } = {}) {
  const data = buildFactorySheetData(order, products, colors, { rate })
  const ExcelJS = (await import('exceljs')).default

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Kira Gestão'
  const ws = wb.addWorksheet('PEDIDO', { views: [{ showGridLines: true }] })

  // A foto | B modelo | C cap | D cor | E qtd | F requeriments | G FOB | H total | I PP | J BRL
  ws.columns = [
    { width: 18 }, { width: 16 }, { width: 12 }, { width: 18 }, { width: 11 },
    { width: 22 }, { width: 11 }, { width: 14 }, { width: 11 }, { width: 12 },
  ]

  const header = ws.addRow(['', 'MODEL', 'CAP', 'COLOR', 'QUANTITY', 'Requeriments', 'FOB', 'TOTAL PRICE', 'PP', 'BRL'])
  header.font = { bold: true, size: 10 }
  header.alignment = { horizontal: 'center', vertical: 'middle' }
  header.eachCell(cell => {
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
        i === 0 ? 'same as sample' : '',
        r.fob,
        r.total,
        r.pp,
        r.brl != null ? r.brl : '',
      ])
      row.height = Math.max(22, Math.floor(110 / n))
      row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
      row.getCell(7).numFmt = '"$"#,##0.00'
      row.getCell(8).numFmt = '"$"#,##0.00'
      row.getCell(9).numFmt = '"$"#,##0.00'
      if (r.brl != null) row.getCell(10).numFmt = '"R$"#,##0.00'
      row.eachCell({ includeEmpty: true }, cell => { cell.border = thinBorder() })
    })

    const endRow = startRow + n - 1
    if (n > 1) {
      ws.mergeCells(startRow, 1, endRow, 1)
      ws.mergeCells(startRow, 2, endRow, 2)
      ws.mergeCells(startRow, 3, endRow, 3)
      ws.mergeCells(startRow, 6, endRow, 6)
    }
    ws.getCell(startRow, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }

    // Foto do modelo ancorada na célula mesclada da coluna A
    if (m.photoUrl) {
      const img = await fetchAsJpeg(m.photoUrl)
      if (img) {
        const id = wb.addImage({ buffer: img.buffer, extension: 'jpeg' })
        ws.addImage(id, {
          tl: { col: 0.05, row: startRow - 1 + 0.05 },
          br: { col: 0.95, row: endRow - 0.05 },
          editAs: 'oneCell',
        })
      }
    }
  }

  // ── Total geral ──
  const totalRow = ws.addRow(['', '', '', '', data.grandQty, '', '', data.grandTotal, '', ''])
  totalRow.font = { bold: true, italic: true, size: 12 }
  totalRow.getCell(8).numFmt = '"$"#,##0.00'
  totalRow.getCell(5).alignment = { horizontal: 'center' }
  totalRow.height = 24

  // ── Seção COLORS: banner + fotos das cores usadas ──
  if (data.usedColors.length > 0) {
    ws.addRow([])
    const bannerRow = ws.addRow(['COLORS'])
    ws.mergeCells(bannerRow.number, 1, bannerRow.number, 10)
    const banner = ws.getCell(bannerRow.number, 1)
    banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RED } }
    banner.font = { bold: true, color: { argb: 'FFFFFF00' }, size: 12 }
    banner.alignment = { horizontal: 'center', vertical: 'middle' }
    bannerRow.height = 20

    // Blocos de 5 cores por linha: linha de rótulos + linha alta com as fotos
    const PER_ROW = 5
    for (let i = 0; i < data.usedColors.length; i += PER_ROW) {
      const chunk = data.usedColors.slice(i, i + PER_ROW)

      const labelCells = []
      chunk.forEach((c) => { labelCells.push(c.code, '') })
      const labelRow = ws.addRow(labelCells)
      labelRow.height = 20
      chunk.forEach((c, j) => {
        const cell = labelRow.getCell(j * 2 + 1)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
        cell.font = { bold: true, size: 10 }
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
        cell.border = thinBorder()
      })

      const photoRow = ws.addRow([])
      photoRow.height = 130
      for (let j = 0; j < chunk.length; j++) {
        const c = chunk[j]
        const img = c.photoUrl ? await fetchAsJpeg(c.photoUrl, 360) : await hexSwatchJpeg(c.hex)
        if (!img) continue
        const id = wb.addImage({ buffer: img.buffer, extension: 'jpeg' })
        const col = j * 2
        ws.addImage(id, {
          tl: { col: col + 0.05, row: photoRow.number - 1 + 0.03 },
          br: { col: col + 0.95, row: photoRow.number - 0.03 },
          editAs: 'oneCell',
        })
      }
    }
  }

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

  return { models: data.models.length, colors: data.usedColors.length }
}

function thinBorder() {
  const s = { style: 'thin', color: { argb: 'FFBFBFBF' } }
  return { top: s, left: s, bottom: s, right: s }
}
