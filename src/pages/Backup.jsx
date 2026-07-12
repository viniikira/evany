// src/pages/Backup.jsx
// Aba de backup + migração de dados antigos do kv_store

import { useState } from 'react'
import { useConfirm, useToast } from '../components/ui'
import { BackupHistoryPanel } from '../components/BackupHistoryPanel'
import { ProgressBar } from '../components/ProgressBar'
import { supabase } from '../lib/supabase'
import { migrateFromKvStore } from '../lib/migrate'
import { toastError } from '../lib/errors'

export default function BackupPage({ user, perm }) {
  const [migrating, setMigrating] = useState(false)
  const [migResult, setMigResult] = useState(null)
  const [exporting, setExporting] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()

  if (!perm.backup) return <div className="empty-state"><div className="empty-icon">🔒</div><p>Sem permissão.</p></div>

  // Export completo: dump de todas as tabelas novas
  const exportAll = async () => {
    setExporting(true)
    try {
      const tables = ['products', 'color_variants', 'suppliers', 'ideas', 'orders', 'order_items', 'payments', 'collections', 'colors', 'factories', 'names', 'profiles', 'activity_logs', 'shopify_cache']
      const out = { exportedAt: new Date().toISOString(), tables: {} }
      for (const t of tables) {
        const { data } = await supabase.from(t).select('*')
        out.tables[t] = data || []
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kira-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.push('Backup baixado', { kind: 'success' })
    } catch (e) { toastError(toast, e) }
    setExporting(false)
  }

  const runMigration = async (dryRun) => {
    if (!dryRun) {
      const ok = await confirm({
        title: 'Migrar dados do sistema antigo?',
        message: 'Isso vai ler o JSON antigo em kv_store e inserir nas tabelas novas. É seguro rodar mais de uma vez, mas pode criar duplicatas se você já migrou antes.',
        details: 'ATENÇÃO: fotos em base64 do sistema antigo NÃO serão migradas automaticamente — você vai precisar reanexá-las nas páginas de produto/pedido.',
        confirmLabel: 'Migrar',
        danger: false,
      })
      if (!ok) return
    }
    setMigrating(true)
    setMigResult(null)
    try {
      const result = await migrateFromKvStore({ dryRun })
      setMigResult(result)
      if (!dryRun && result.ok) toast.push('Migração concluída', { kind: 'success' })
    } catch (e) {
      toastError(toast, e)
    }
    setMigrating(false)
  }

  return <div>
    <BackupHistoryPanel />
    
    <div className="card mb-md">
      <div className="card-title">📥 Exportar backup completo</div>
      <p className="text-sm text-muted mb-md">
        Baixa um arquivo JSON com TODAS as tabelas do sistema. Guarde esse arquivo em local seguro (Drive, email) pelo menos uma vez por semana.
      </p>
      <button className="btn btn-primary" onClick={exportAll} disabled={exporting}>
        {exporting ? '⏳ Exportando...' : '📥 Baixar backup agora'}
      </button>
      {exporting && (
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={null} label="Exportando todas as tabelas do banco..." sub="pode levar alguns segundos" />
        </div>
      )}
    </div>

    <div className="card mb-md" style={{ border: '2px solid #FCD34D', background: '#FFFBEB' }}>
      <div className="card-title" style={{ color: '#92400E' }}>🔄 Migrar dados antigos (kv_store → tabelas novas)</div>
      <p className="text-sm" style={{ color: '#78350F', marginBottom: 12 }}>
        Se você está vindo da versão antiga do sistema (v9/v10/v11) e ainda tem dados em <code>kv_store</code>, use essa ferramenta para copiá-los para as tabelas novas.
      </p>
      <p className="text-sm" style={{ color: '#78350F', marginBottom: 16 }}>
        <strong>Sempre rode "Dry run" primeiro</strong> para ver o que seria importado, sem escrever nada.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-outline" onClick={() => runMigration(true)} disabled={migrating}>
          {migrating ? '⏳' : '🔍'} Dry run (só simula)
        </button>
        <button className="btn btn-primary" onClick={() => runMigration(false)} disabled={migrating}>
          {migrating ? '⏳ Migrando...' : '▶️ Executar migração'}
        </button>
      </div>
      {migrating && (
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={null} label="Processando migração..." sub="lendo kv_store e inserindo em tabelas novas" />
        </div>
      )}
      {migResult && (
        <div style={{ marginTop: 16, padding: 12, background: migResult.ok ? '#D1FAE5' : '#FEE2E2', borderRadius: 6, fontSize: 12 }}>
          <strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            {migResult.ok ? '✓ Processado' : '✗ Falhou'}
          </strong>
          {migResult.counts?.inserted && Object.keys(migResult.counts.inserted).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <strong>Inseridos:</strong>{' '}
              {Object.entries(migResult.counts.inserted).map(([k, v]) => `${k}: ${v}`).join(', ')}
            </div>
          )}
          {migResult.counts?.errors?.length > 0 && (
            <div>
              <strong>Erros ({migResult.counts.errors.length}):</strong>
              <ul style={{ marginLeft: 20, marginTop: 4 }}>
                {migResult.counts.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                {migResult.counts.errors.length > 10 && <li>... e mais {migResult.counts.errors.length - 10}</li>}
              </ul>
            </div>
          )}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer' }}>Log completo</summary>
            <pre style={{ fontSize: 11, marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {(migResult.messages || []).join('\n')}
            </pre>
          </details>
        </div>
      )}
    </div>

    <div className="card" style={{ background: '#EFF6FF', border: '1px solid #BFDBFE' }}>
      <div className="card-title" style={{ color: '#1E40AF' }}>💡 Proteção ativa</div>
      <ul style={{ margin: '8px 0 0 20px', fontSize: 13, color: '#1E3A8A', lineHeight: 1.8 }}>
        <li>Dados em tabelas relacionais (fim do JSON único)</li>
        <li>Fotos em Supabase Storage (sem base64 no banco)</li>
        <li>Autenticação oficial do Supabase (senhas hash)</li>
        <li>Permissões enforcing no banco (RLS) — equipe não acessa dados sensíveis nem via DevTools</li>
        <li>Comprovantes em bucket privado (só admin acessa)</li>
      </ul>
    </div>
  </div>
}
