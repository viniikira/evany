// src/pages/Users.jsx
// v13.28 — Extraído de SimplePages.jsx

import { useEffect, useState } from 'react'
import { SkeletonList, useToast } from '../components/ui'
import { listProfiles, updateProfileRole, addLog as writeLog } from '../lib/data/misc'
import { toastError } from '../lib/errors'
import { formatDate } from '../lib/utils'

export function UsersPage({ perm, user }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  
  const load = async () => {
    setLoading(true)
    try { setProfiles(await listProfiles()) } catch (e) { toastError(toast, e) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])
  
  if (!perm.users) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Sem permissão.</p></div>
  
  const changeRole = async (p, newRole) => {
    if (p.id === user.id) {
      toast.push('Você não pode alterar seu próprio role', { kind: 'warning' })
      return
    }
    try {
      await updateProfileRole(p.id, newRole)
      writeLog({ userId: user.id, userName: user.name, action: 'alterou role', target: p.name, details: newRole })
      await load()
      toast.push('Role atualizado', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
  }
  
  return <div>
    <div className="card mb-md" style={{ background: '#FEF3C7', border: '1px solid #FDE68A' }}>
      <div style={{ fontSize: 13, color: '#92400E' }}>
        💡 <strong>Para adicionar usuários novos:</strong> use o painel Auth do Supabase (Dashboard → Authentication → Users → Invite).
        Ao criar, o email recebe um link para definir senha. Depois volte aqui para ajustar o role.
      </div>
    </div>
    {loading ? <SkeletonList rows={4} />
    : <div className="card">
      <table className="data-table">
        <thead><tr><th>Nome</th><th>Role</th><th>Criado em</th><th></th></tr></thead>
        <tbody>{profiles.map(p => (
          <tr key={p.id}>
            <td><strong>{p.name}</strong>{p.id === user.id && <span className="text-muted text-xs"> (você)</span>}</td>
            <td>
              <span className="chip" style={{ background: p.role === 'admin' ? '#4A1942' : p.role === 'gerente' ? '#3B82F6' : '#9CA3AF', color: '#fff' }}>
                {p.role}
              </span>
            </td>
            <td className="text-muted text-sm">{formatDate(p.created_at, 'full')}</td>
            <td>
              {p.id !== user.id && (
                <select className="field field-sm" value={p.role} onChange={e => changeRole(p, e.target.value)}>
                  <option value="equipe">equipe</option>
                  <option value="gerente">gerente</option>
                  <option value="admin">admin</option>
                </select>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>}
  </div>
}
