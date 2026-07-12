// src/components/ThemeToggle.jsx
// Toggle manual entre tema claro/escuro.
// Persiste preferência em localStorage.
// Aplica o atributo data-theme em <html> direto (sem re-render do app).

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'kira_theme'

// Helper exportado pra App.jsx aplicar tema antes do primeiro paint
export function applyInitialTheme() {
  if (typeof document === 'undefined') return
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved)
    }
    // Se nada salvo: mantém light (default). Não usa prefers-color-scheme
    // porque o usuário pediu explicitamente "manual".
  } catch {}
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    if (typeof document === 'undefined') return 'light'
    return document.documentElement.getAttribute('data-theme') || 'light'
  })
  
  useEffect(() => {
    try {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark')
        localStorage.setItem(STORAGE_KEY, 'dark')
      } else {
        document.documentElement.removeAttribute('data-theme')
        localStorage.setItem(STORAGE_KEY, 'light')
      }
    } catch {}
  }, [theme])
  
  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')
  
  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Mudar pra tema claro' : 'Mudar pra tema escuro'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        width: '100%', padding: '8px 10px',
        background: 'var(--sidebar-hover)',
        border: 'none', borderRadius: 6,
        color: 'var(--sidebar-text)',
        cursor: 'pointer', fontSize: 12,
        fontFamily: 'inherit',
        transition: 'background .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--sidebar-active)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--sidebar-hover)' }}
    >
      <span style={{ fontSize: 14 }}>{theme === 'dark' ? '☀️' : '🌙'}</span>
      <span>{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</span>
    </button>
  )
}
