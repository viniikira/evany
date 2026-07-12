// src/pages/Login.jsx
import { useState } from 'react'
import { signIn } from '../lib/auth'
import { KIRA_LOGO, EVANY_LOGO } from '../lib/constants'

export default function Login({ onSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const go = async (e) => {
    e?.preventDefault()
    setErr('')
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      onSuccess?.()
    } catch (e) {
      setErr(e.message || 'Erro ao entrar')
    }
    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-top">
          <img src={KIRA_LOGO} alt="" className="login-kira"/>
          <img src={EVANY_LOGO} alt="" className="login-evany"/>
          <p className="login-sub">SISTEMA DE GESTÃO</p>
        </div>
        <form onSubmit={go}>
          {err && <div className="alert alert-warn">{err}</div>}
          <label className="field-label">Email</label>
          <input
            className="field"
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setErr('') }}
            autoFocus
            required
          />
          <label className="field-label" style={{ marginTop: 16 }}>Senha</label>
          <input
            className="field"
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setErr('') }}
            required
          />
          <button
            type="submit"
            className="btn btn-primary full"
            style={{ marginTop: 20 }}
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
