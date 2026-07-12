// src/components/BackupHistoryPanel.jsx
// v13.31 — Painel de histórico de backups automáticos (edge function daily-backup)

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from './ui'
import { toastError } from '../lib/errors'
import { formatDate } from '../lib/utils'

export function BackupHistoryPanel() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState(null)
  const toast = useToast()
  
  const load = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('backup_history')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(60)
      if (error) throw error
      setHistory(data || [])
    } catch (e) {
      toastError(toast, e)
    }
    setLoading(false)
  }
  
  useEffect(() => { load() }, [])
  
  const downloadBackup = async (entry) => {
    if (!entry.file_path) return
    setDownloadingId(entry.id)
    try {
      const { data, error } = await supabase.storage
        .from('backups')
        .download(entry.file_path)
      if (error) throw error
      const url = URL.createObjectURL(data)
      const a = document.createElement('a')
      a.href = url
      a.download = `backup-${entry.started_at.slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.push('Download iniciado', { kind: 'success' })
    } catch (e) {
      toastError(toast, e)
    }
    setDownloadingId(null)
  }
  
  const formatSize = (bytes) => {
    if (!bytes) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }
  
  // Estatísticas resumidas
  const stats = {
    total: history.length,
    success: history.filter(h => h.success).length,
    last: history.find(h => h.success),
  }
  
  return (
    <div className="card mb-md">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📦 Backups automáticos</span>
        <button className="btn btn-outline btn-sm" onClick={load} disabled={loading}>
          🔄 Atualizar
        </button>
      </div>
      
      {/* Resumo */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 10, marginBottom: 14,
      }}>
        <div style={{ padding: 10, background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div className="text-muted text-xs">ÚLTIMO BACKUP</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: stats.last ? 'var(--success)' : 'var(--danger)' }}>
            {stats.last ? formatDate(stats.last.started_at, 'with-time') : 'Nunca'}
          </div>
        </div>
        <div style={{ padding: 10, background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div className="text-muted text-xs">SUCESSOS / TOTAL</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {stats.success} / {stats.total}
          </div>
        </div>
        <div style={{ padding: 10, background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div className="text-muted text-xs">TAMANHO ÚLTIMO</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {stats.last ? formatSize(stats.last.size_bytes) : '—'}
          </div>
        </div>
      </div>
      
      {/* Lista */}
      {loading ? (
        <p className="text-muted text-sm">Carregando…</p>
      ) : history.length === 0 ? (
        <div style={{ padding: 16, background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 6, fontSize: 13, color: '#92400E' }}>
          <strong>Sem backups automáticos ainda.</strong> Confirme que:
          <ul style={{ marginLeft: 20, marginTop: 6 }}>
            <li>Edge function <code>daily-backup</code> foi deployada</li>
            <li>SQL <code>15_backup_history.sql</code> aplicado</li>
            <li>SQL <code>16_backup_cron.sql</code> aplicado (com URL e token corretos)</li>
            <li>Aguarde até 24h pra próxima execução agendada (03:00 UTC)</li>
          </ul>
        </div>
      ) : (
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Status</th>
              <th>Tamanho</th>
              <th>Origem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {history.map(h => (
              <tr key={h.id}>
                <td>
                  <div>{formatDate(h.started_at, 'with-time')}</div>
                  {h.finished_at && (
                    <div className="text-muted text-xs">
                      {Math.round((new Date(h.finished_at) - new Date(h.started_at)) / 1000)}s
                    </div>
                  )}
                </td>
                <td>
                  {h.success ? (
                    <span className="chip" style={{ background: '#D1FAE5', color: '#065F46' }}>✓ OK</span>
                  ) : (
                    <span className="chip" style={{ background: '#FEE2E2', color: '#991B1B' }} title={h.error_message || 'Erro desconhecido'}>
                      ✗ Falhou
                    </span>
                  )}
                </td>
                <td>{formatSize(h.size_bytes)}</td>
                <td>
                  <span className="chip" style={{
                    background: h.triggered_by === 'cron' ? '#DBEAFE' : '#F3E8FF',
                    color: h.triggered_by === 'cron' ? '#1E40AF' : '#6B21A8',
                    fontSize: 10,
                  }}>
                    {h.triggered_by === 'cron' ? '⏰ Auto' : h.triggered_by === 'manual' ? '👆 Manual' : '💻 Cliente'}
                  </span>
                </td>
                <td>
                  {h.success && h.file_path && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => downloadBackup(h)}
                      disabled={downloadingId === h.id}
                    >
                      {downloadingId === h.id ? '⏳' : '⬇️'} Baixar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
