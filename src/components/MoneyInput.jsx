// src/components/MoneyInput.jsx
// v13.78 — Campo de dinheiro "estilo calculadora" (ver lib/moneyMask.js).
// Ela só digita números: 1250050 vira 12.500,50 enquanto digita.
//
// Uso:  <MoneyInput value={x} onChange={n => setX(n)} prefix="R$" />
//   value: número, "17.50" ou vazio · onChange recebe número ou null
//   decimals: casas decimais (2 pra dinheiro e câmbio)

import { useRef, useLayoutEffect } from 'react'
import { toNumber, formatFixedBR, digitsToValue, pastedToValue } from '../lib/moneyMask'

export function MoneyInput({
  value, onChange, decimals = 2, prefix = null, placeholder,
  className = 'field', style, inputStyle, disabled = false, autoFocus = false,
  ariaLabel, id, onBlur, money = true, title,
}) {
  const ref = useRef(null)
  const num = toNumber(value)
  const text = num == null ? '' : formatFixedBR(num, decimals)

  // Calculadora: o cursor fica sempre no fim (os números entram pela direita)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement === el) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [text])

  const toEnd = () => {
    const el = ref.current
    if (!el) return
    requestAnimationFrame(() => { const end = el.value.length; el.setSelectionRange(end, end) })
  }

  const input = (
    <input
      ref={ref}
      id={id}
      className={prefix ? undefined : className}
      style={prefix ? { border: 0, outline: 'none', background: 'transparent', flex: 1, minWidth: 0, font: 'inherit', textAlign: 'right', ...inputStyle } : { textAlign: 'right', ...style, ...inputStyle }}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      placeholder={placeholder ?? formatFixedBR(0, decimals)}
      disabled={disabled}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      title={title}
      onFocus={toEnd}
      onClick={toEnd}
      onBlur={onBlur}
      onChange={(e) => onChange(digitsToValue(e.target.value, decimals))}
      onPaste={(e) => {
        const t = e.clipboardData?.getData('text')
        if (t == null) return
        e.preventDefault()
        onChange(pastedToValue(t, decimals, { money }))
      }}
    />
  )

  if (!prefix) return input
  return (
    <div className={`money-input ${className}`} style={style}>
      <span className="money-input-prefix">{prefix}</span>
      {input}
    </div>
  )
}
