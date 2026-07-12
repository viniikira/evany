import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyInitialTheme } from './components/ThemeToggle'

// v13.27 — Aplica tema antes do primeiro paint pra evitar flash branco
applyInitialTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
