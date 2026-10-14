// src/components/orders/ReceiptViewer.jsx
// v13.77 — Comprovante aberto DENTRO do sistema ("tem que tudo ficar dentro do
// sistema"). Antes o botão abria o arquivo numa aba nova do navegador.
// Foto: aparece inteira, clique pra ampliar 100%. PDF: aparece na própria tela.

import { useEffect, useState } from 'react'
import { getReceiptSignedUrl } from '../../lib/storage'
import '../../styles/payments.css'

const isPdf = (path) => /\.pdf($|\?)/i.test(path || '')

export function ReceiptViewer({ path, title, subtitle, onClose, onReplace, getUrl = getReceiptSignedUrl }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(null)
  const [zoom, setZoom] = useState(false)

  useEffect(() => {
    let alive = true
    setUrl(null); setError(null)
    getUrl(path)
      .then(u => { if (alive) setUrl(u) })
      .catch(e => { if (alive) setError(e?.message || 'Não foi possível abrir o comprovante') })
    return () => { alive = false }
  }, [path, getUrl])

  // Esc fecha SÓ o comprovante: escuta na fase de captura e para o evento,
  // senão o modal do pedido (que escuta no document) fecharia junto
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Baixar sem sair do sistema: o arquivo vem do storage (outro domínio), e aí
  // o navegador ignora o "download" do link e navega pra ele. Baixa por blob.
  const [downloading, setDownloading] = useState(false)
  const download = async () => {
    if (!url) return
    setDownloading(true)
    try {
      const blob = await (await fetch(url)).blob()
      const obj = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = obj
      a.download = (path || 'comprovante').split('/').pop()
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(obj), 2000)
    } catch {
      setError('Não foi possível baixar o arquivo')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="rv-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Comprovante">
      <div className="rv" onClick={e => e.stopPropagation()}>
        <header className="rv-head">
          <div>
            <h3>{title || 'Comprovante'}</h3>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <div className="rv-actions">
            {onReplace && (
              <label className="pay-btn">
                Trocar arquivo
                <input type="file" accept="image/*,.pdf" hidden onChange={e => e.target.files?.[0] && onReplace(e.target.files[0])} />
              </label>
            )}
            {url && <button type="button" className="pay-btn" onClick={download} disabled={downloading}>{downloading ? 'Baixando…' : 'Baixar'}</button>}
            <button type="button" className="pay-btn" onClick={onClose}>Fechar</button>
          </div>
        </header>
        <div className={`rv-body${zoom ? ' zoom' : ''}`}>
          {error && <p className="rv-msg bad">{error}</p>}
          {!error && !url && <p className="rv-msg">Carregando comprovante…</p>}
          {url && (isPdf(path)
            ? <iframe className="rv-pdf" src={url} title={title || 'Comprovante'} />
            : <img
                src={url}
                alt={title || 'Comprovante'}
                onClick={() => setZoom(z => !z)}
                title={zoom ? 'Clique pra ajustar à tela' : 'Clique pra ver no tamanho real'}
              />)}
        </div>
      </div>
    </div>
  )
}
