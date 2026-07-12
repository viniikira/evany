// src/lib/pdf.js
// Gera PDF de pedido abrindo janela nova com HTML formatado e disparando 
// window.print(). Usuário escolhe "Salvar como PDF" no diálogo do navegador.
// 
// Por que não jsPDF/pdfmake? Adiciona ~200KB de dependência. Print do navegador
// é gratuito, suporta CSS, e o resultado é aceitável pra uso interno.

import { UC } from './utils'

const KIRA_LOGO = 'https://cdn.shopify.com/s/files/1/0633/6865/9009/files/Branco_1.webp?v=1745818832'

export function generateOrderPDF(order, products) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) {
    alert('Bloqueador de pop-up impediu de abrir a janela. Permita pop-ups e tente de novo.')
    return
  }

  const totalQty = (order.items || []).reduce((a, it) => {
    const cls = it.colors || []
    return a + cls.reduce((b, c) => b + Number(c.qty || 0), 0)
         + (cls.length === 0 ? Number(it.quantity || 0) : 0)
  }, 0)
  
  const totalUsd = (order.items || []).reduce((a, it) => {
    const pu = parseFloat(it.price_usd) || 0
    const cls = it.colors || []
    return a + cls.reduce((b, c) => b + pu * Number(c.qty || 0), 0)
         + (cls.length === 0 ? pu * Number(it.quantity || 0) : 0)
  }, 0)

  const itemsRows = (order.items || []).flatMap(it => {
    const prod = products?.find(p => p.id === it.product_id)
    const name = it.name_manual || prod?.name || it.product_name_snapshot || '—'
    const code = it.code_manual || prod?.factory_code || it.product_code_snapshot || '—'
    const cap = it.cap_manual || it.product_cap_snapshot || ''
    const photo = it.selected_photo_url || prod?.card_image_url
    const cls = it.colors || []
    
    if (cls.length > 0) {
      return cls.map((c, i) => `
        <tr>
          ${i === 0 ? `
            <td rowspan="${cls.length}" style="vertical-align:top">
              ${photo ? `<img src="${photo}" style="width:60px;height:80px;object-fit:cover;border-radius:4px"/>` : ''}
            </td>
            <td rowspan="${cls.length}" style="vertical-align:top">
              <strong>${UC(name)}</strong>
              ${cap ? `<br><small>${cap}</small>` : ''}
            </td>
            <td rowspan="${cls.length}">${code}</td>
          ` : ''}
          <td>${c.code || '—'}</td>
          <td style="text-align:center">${c.qty || 0}</td>
          <td style="text-align:right">${it.price_usd ? '$' + parseFloat(it.price_usd).toFixed(2) : '—'}</td>
        </tr>
      `).join('')
    } else {
      return [`
        <tr>
          <td>${photo ? `<img src="${photo}" style="width:60px;height:80px;object-fit:cover;border-radius:4px"/>` : ''}</td>
          <td><strong>${UC(name)}</strong>${cap ? `<br><small>${cap}</small>` : ''}</td>
          <td>${code}</td>
          <td>—</td>
          <td style="text-align:center">${it.quantity || 0}</td>
          <td style="text-align:right">${it.price_usd ? '$' + parseFloat(it.price_usd).toFixed(2) : '—'}</td>
        </tr>
      `]
    }
  }).join('')

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${order.order_name || 'Pedido'} · ${order.factory}</title>
<style>
  @page { margin: 1.5cm; size: A4 }
  * { box-sizing: border-box }
  body { font-family: -apple-system, system-ui, sans-serif; color: #2D2028; margin: 0; padding: 0 }
  header {
    display: flex; justify-content: space-between; align-items: center;
    border-bottom: 2px solid #4A1942; padding-bottom: 14px; margin-bottom: 20px;
  }
  .logo { height: 36px }
  .meta { text-align: right; font-size: 12px; color: #666 }
  h1 {
    color: #4A1942; font-size: 24px; margin: 0 0 4px 0;
    font-family: Georgia, serif;
  }
  .info-grid {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 14px; margin-bottom: 20px;
  }
  .info-item { background: #F5F2EF; padding: 10px 14px; border-radius: 6px }
  .info-label {
    font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px;
    font-weight: 600;
  }
  .info-value { font-size: 14px; font-weight: 600; color: #4A1942; margin-top: 2px }
  table {
    width: 100%; border-collapse: collapse; font-size: 12px;
    margin-bottom: 20px;
  }
  th {
    background: #4A1942; color: #fff; padding: 8px;
    text-align: left; font-weight: 600; font-size: 11px;
    text-transform: uppercase; letter-spacing: .5px;
  }
  td { padding: 8px; border-bottom: 1px solid #E8E2DC; vertical-align: middle }
  tr:nth-child(even) td { background: #FAFAFA }
  .totals {
    background: #F5F2EF; padding: 14px 20px; border-radius: 8px;
    display: flex; justify-content: space-between; font-size: 14px;
  }
  .totals strong { color: #4A1942; font-size: 16px }
  .notes {
    margin-top: 20px; padding: 12px; background: #FFFBEB;
    border: 1px solid #FCD34D; border-radius: 6px; font-size: 12px;
  }
  .notes strong { display: block; margin-bottom: 4px; color: #92400E }
  footer {
    margin-top: 40px; padding-top: 14px; border-top: 1px solid #ddd;
    text-align: center; font-size: 10px; color: #999;
  }
  @media print {
    .no-print { display: none }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact }
  }
  .no-print {
    position: fixed; bottom: 20px; right: 20px;
    background: #4A1942; color: #fff; padding: 10px 18px;
    border-radius: 6px; cursor: pointer; border: none; font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,.2);
  }
</style>
</head>
<body>
  <header>
    <img src="${KIRA_LOGO}" class="logo" alt="Kira" />
    <div class="meta">
      <h1>${order.order_name || 'Pedido'}</h1>
      <div>Emitido em ${new Date().toLocaleDateString('pt-BR')}</div>
    </div>
  </header>

  <div class="info-grid">
    <div class="info-item">
      <div class="info-label">Fábrica</div>
      <div class="info-value">${order.factory}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Status</div>
      <div class="info-value">${order.status}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Data Pedido</div>
      <div class="info-value">${new Date(order.created_at).toLocaleDateString('pt-BR')}</div>
    </div>
    ${order.expected_arrival ? `
      <div class="info-item">
        <div class="info-label">Chegada Prevista</div>
        <div class="info-value">${new Date(order.expected_arrival).toLocaleDateString('pt-BR')}</div>
      </div>
    ` : ''}
    ${order.dispatch_code ? `
      <div class="info-item">
        <div class="info-label">Cód. Envio</div>
        <div class="info-value">${order.dispatch_code}</div>
      </div>
    ` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:75px">Foto</th>
        <th>Produto</th>
        <th>Cód</th>
        <th>Cor</th>
        <th style="width:60px">Qtd</th>
        <th style="width:80px">Preço USD</th>
      </tr>
    </thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <div class="totals">
    <span>Total de peças</span>
    <strong>${totalQty}</strong>
  </div>
  ${totalUsd > 0 ? `
    <div class="totals" style="margin-top:6px">
      <span>Valor FOB total</span>
      <strong>$ ${totalUsd.toFixed(2)}</strong>
    </div>
  ` : ''}

  ${order.notes ? `
    <div class="notes">
      <strong>Observações</strong>
      ${order.notes}
    </div>
  ` : ''}

  <footer>Kira Perucas · Documento interno</footer>

  <button class="no-print" onclick="window.print()">🖨️ Imprimir / Salvar PDF</button>
</body>
</html>
  `.trim()

  win.document.open()
  win.document.write(html)
  win.document.close()
  // Espera as imagens carregarem antes de tentar print automático
  win.onload = () => {
    setTimeout(() => { try { win.focus(); win.print() } catch {} }, 300)
  }
}
