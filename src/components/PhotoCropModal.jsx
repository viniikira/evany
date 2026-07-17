// src/components/PhotoCropModal.jsx
// v13.63 — Recorte de foto DENTRO do sistema (zero dependências).
//
// Caso de uso: as fábricas mandam fichas técnicas gigantes (5 fotos + texto
// numa imagem só) e a usuária precisava cortar em outro programa antes de
// anexar na cor. Agora: escolhe o arquivo → arrasta/redimensiona a seleção →
// "Cortar e usar". O recorte sai na resolução ORIGINAL da região (o pipeline
// de upload comprime depois).
//
// Interações: arrastar dentro da seleção move; alças nos 4 cantos
// redimensionam; arrastar fora desenha uma seleção nova; ESC cancela.

import { useState, useEffect, useRef, useCallback } from 'react'

const MIN_SEL = 24  // px de tela

export function PhotoCropModal({ file, title = 'Recortar foto', onCancel, onCrop }) {
  const [url, setUrl] = useState(null)
  const [nat, setNat] = useState(null)          // { w, h } natural
  const [disp, setDisp] = useState(null)        // { w, h } exibido
  const [sel, setSel] = useState(null)          // { x, y, w, h } em px de tela
  const containerRef = useRef(null)
  const dragRef = useRef(null)                  // { mode, handle, startX, startY, orig }

  // Carrega o arquivo
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  // ESC cancela
  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onCancel])

  const onImgLoad = (e) => {
    const img = e.target
    const natW = img.naturalWidth, natH = img.naturalHeight
    // Escala de exibição: cabe em ~88vw × 58vh (fallbacks pra viewport degenerado)
    const vw = window.innerWidth || document.documentElement.clientWidth || 1200
    const vh = window.innerHeight || document.documentElement.clientHeight || 800
    const maxW = Math.min(vw * 0.88, 980)
    const maxH = vh * 0.58
    const scale = Math.min(maxW / natW, maxH / natH, 1)
    const w = Math.max(60, Math.round(natW * scale))
    const h = Math.max(60, Math.round(natH * scale))
    setNat({ w: natW, h: natH })
    setDisp({ w, h })
    // Seleção inicial: quadrado centralizado (70% do menor lado)
    const s = Math.round(Math.min(w, h) * 0.7)
    setSel({ x: Math.round((w - s) / 2), y: Math.round((h - s) / 2), w: s, h: s })
  }

  const clampSel = useCallback((r) => {
    if (!disp) return r
    const w = Math.max(MIN_SEL, Math.min(r.w, disp.w))
    const h = Math.max(MIN_SEL, Math.min(r.h, disp.h))
    const x = Math.max(0, Math.min(r.x, disp.w - w))
    const y = Math.max(0, Math.min(r.y, disp.h - h))
    return { x, y, w, h }
  }, [disp])

  const localPoint = (e) => {
    const rect = containerRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e) => {
    if (!sel || !disp) return
    e.preventDefault()
    containerRef.current.setPointerCapture?.(e.pointerId)
    const p = localPoint(e)
    const handle = e.target?.dataset?.handle
    if (handle) {
      dragRef.current = { mode: 'resize', handle, start: p, orig: { ...sel } }
    } else if (p.x >= sel.x && p.x <= sel.x + sel.w && p.y >= sel.y && p.y <= sel.y + sel.h) {
      dragRef.current = { mode: 'move', start: p, orig: { ...sel } }
    } else {
      // Desenha seleção nova a partir do ponto
      dragRef.current = { mode: 'draw', start: p, orig: null }
      setSel(clampSel({ x: p.x, y: p.y, w: MIN_SEL, h: MIN_SEL }))
    }
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d || !disp) return
    const p = localPoint(e)
    const dx = p.x - d.start.x
    const dy = p.y - d.start.y
    if (d.mode === 'move') {
      setSel(clampSel({ ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy }))
    } else if (d.mode === 'draw') {
      const x = Math.min(d.start.x, p.x)
      const y = Math.min(d.start.y, p.y)
      setSel(clampSel({ x, y, w: Math.abs(dx), h: Math.abs(dy) }))
    } else if (d.mode === 'resize') {
      const o = d.orig
      let { x, y, w, h } = o
      if (d.handle.includes('e')) w = o.w + dx
      if (d.handle.includes('s')) h = o.h + dy
      if (d.handle.includes('w')) { x = o.x + dx; w = o.w - dx }
      if (d.handle.includes('n')) { y = o.y + dy; h = o.h - dy }
      if (w < MIN_SEL) { if (d.handle.includes('w')) x -= (MIN_SEL - w); w = MIN_SEL }
      if (h < MIN_SEL) { if (d.handle.includes('n')) y -= (MIN_SEL - h); h = MIN_SEL }
      setSel(clampSel({ x, y, w, h }))
    }
  }

  const onPointerUp = () => { dragRef.current = null }

  // Recorta na resolução ORIGINAL da região selecionada
  const doCrop = async (full = false) => {
    if (!nat || !disp) return
    const scaleX = nat.w / disp.w
    const scaleY = nat.h / disp.h
    const region = full || !sel
      ? { x: 0, y: 0, w: nat.w, h: nat.h }
      : {
          x: Math.round(sel.x * scaleX),
          y: Math.round(sel.y * scaleY),
          w: Math.max(1, Math.round(sel.w * scaleX)),
          h: Math.max(1, Math.round(sel.h * scaleY)),
        }
    const img = new Image()
    img.src = url
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
    const canvas = document.createElement('canvas')
    canvas.width = region.w
    canvas.height = region.h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, region.w, region.h)
    ctx.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h)
    canvas.toBlob((blob) => {
      if (!blob) return onCancel()
      const name = (file.name || 'foto').replace(/\.[^.]+$/, '') + (full ? '.jpg' : '-recorte.jpg')
      onCrop(new File([blob], name, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }

  const natSel = sel && nat && disp
    ? { w: Math.round(sel.w * nat.w / disp.w), h: Math.round(sel.h * nat.h / disp.h) }
    : null

  const HANDLES = ['nw', 'ne', 'sw', 'se']
  const handlePos = {
    nw: { left: -6, top: -6, cursor: 'nwse-resize' },
    ne: { right: -6, top: -6, cursor: 'nesw-resize' },
    sw: { left: -6, bottom: -6, cursor: 'nesw-resize' },
    se: { right: -6, bottom: -6, cursor: 'nwse-resize' },
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9400,
      background: 'rgba(0,0,0,.72)', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14,
    }}>
      <div style={{ color: '#fff', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
        ✂️ {title}
        <span style={{ fontSize: 11, fontWeight: 400, opacity: .75 }}>
          arraste pra mover · cantos redimensionam · fora da seleção desenha outra
        </span>
      </div>

      {url && (
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: 'relative',
            width: disp?.w, height: disp?.h,
            touchAction: 'none', userSelect: 'none',
            cursor: 'crosshair',
            overflow: 'hidden',
            borderRadius: 6,
            boxShadow: '0 12px 48px rgba(0,0,0,.5)',
          }}
        >
          <img
            src={url}
            alt=""
            onLoad={onImgLoad}
            draggable={false}
            style={{ width: disp?.w, height: disp?.h, display: 'block', pointerEvents: 'none' }}
          />
          {sel && (
            <div style={{
              position: 'absolute',
              left: sel.x, top: sel.y, width: sel.w, height: sel.h,
              border: '2px solid #fff',
              outline: '1px solid rgba(0,0,0,.4)',
              boxShadow: '0 0 0 10000px rgba(0,0,0,.55)',
              cursor: 'move',
            }}>
              {HANDLES.map(hd => (
                <div
                  key={hd}
                  data-handle={hd}
                  style={{
                    position: 'absolute', width: 13, height: 13,
                    background: '#fff', border: '1px solid rgba(0,0,0,.45)', borderRadius: 3,
                    ...handlePos[hd],
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        {natSel && (
          <span style={{ color: 'rgba(255,255,255,.7)', fontSize: 11, fontFamily: 'monospace' }}>
            recorte: {natSel.w}×{natSel.h}px
          </span>
        )}
        <button className="btn btn-outline" style={{ background: '#fff' }} onClick={onCancel}>Cancelar</button>
        <button className="btn btn-outline" style={{ background: '#fff' }} onClick={() => doCrop(true)} title="Envia a imagem original sem recortar">Usar inteira</button>
        <button className="btn btn-primary" onClick={() => doCrop(false)} disabled={!sel}>✂️ Cortar e usar</button>
      </div>
    </div>
  )
}
