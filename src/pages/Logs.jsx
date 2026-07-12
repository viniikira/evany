// src/pages/Logs.jsx
// v13.28 — Extraído de SimplePages.jsx (refatoração)
// Página simples: lista os últimos 100 logs de atividade.

import { useEffect, useState } from 'react'
import { SkeletonList } from '../components/ui'
import { listLogs } from '../lib/data/misc'

export function LogsPage({ perm }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    (async () => {
      try { setLogs(await listLogs(100)) } catch {}
      setLoading(false)
    })()
  }, [])
  
  if (!perm.logs) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Sem permissão.</p></div>
  
  return loading ? <SkeletonList rows={5} />
    : logs.length === 0 ? <div className="empty-state"><div className="empty-icon">📜</div><p>Nenhuma atividade.</p></div>
    : <div className="card"><table className="data-table">
      <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Item</th><th>Detalhes</th></tr></thead>
      <tbody>{logs.map(l => (
        <tr key={l.id}>
          <td className="text-muted text-sm">{new Date(l.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
          <td><strong>{l.user_name_snapshot}</strong></td>
          <td>{l.action}</td>
          <td>{l.target}</td>
          <td className="text-muted text-sm">{l.details || '—'}</td>
        </tr>
      ))}</tbody>
    </table></div>
}
