// supabase/functions/daily-backup/index.ts
//
// Edge Function pra backup diário automático.
// Disparada por pg_cron 1x/dia (configurar em sql/15_backup_cron.sql).
//
// O que faz:
// 1. Exporta todas as tabelas críticas em JSON
// 2. Salva em bucket "backups/auto/YYYY-MM-DD/dump.json"
// 3. Registra execução em backup_history
// 4. Rotação: deleta backups auto com >30 dias
//
// Diferenças vs backup client-side (lib/backup.js):
// - Roda mesmo se você não abrir o app
// - Pasta separada (auto/) pra distinguir do client-side
// - Registra em tabela pra histórico visível na UI

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// v13.46 — lista corrigida: 'order_item_colors', 'order_payments' e
// 'order_status_history' nunca existiram no schema relacional (cores e
// histórico de status são colunas JSONB; pagamentos ficam em 'payments').
// Service role enxerga tudo, então aqui o dump é realmente completo.
const TABLES = [
  'products', 'color_variants', 'suppliers',
  'orders', 'order_items', 'payments',
  'ideas', 'colors', 'collections', 'factories', 'names',
  'color_categories', 'color_category_assignments',
  'profiles', 'activity_logs', 'user_favorites',
]

const RETENTION_DAYS = 30
const BUCKET = 'backups'

serve(async (req) => {
  // CORS pra eventual chamada manual
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }
  
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  
  // Service role pra ter acesso total às tabelas
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })
  
  const startedAt = new Date().toISOString()
  const today = startedAt.slice(0, 10)
  const filePath = `auto/${today}/dump.json`
  
  let result: any = {
    started_at: startedAt,
    file_path: filePath,
    tables: {},
    success: false,
    error: null,
    size_bytes: 0,
  }
  
  try {
    // 1) Exporta cada tabela
    const dump: Record<string, any[]> = {}
    for (const table of TABLES) {
      const { data, error } = await supa.from(table).select('*')
      if (error) {
        // Não aborta — registra e segue (tabela pode não existir em ambiente novo)
        result.tables[table] = { error: error.message, count: 0 }
        continue
      }
      dump[table] = data || []
      result.tables[table] = { count: (data || []).length }
    }
    
    // 2) Salva no Storage
    const json = JSON.stringify({
      backup_at: startedAt,
      version: 'v13.46',
      tables: dump,
    }, null, 2)
    
    const blob = new Blob([json], { type: 'application/json' })
    result.size_bytes = blob.size
    
    const { error: uploadErr } = await supa.storage
      .from(BUCKET)
      .upload(filePath, blob, { upsert: true, contentType: 'application/json' })
    
    if (uploadErr) throw new Error(`Upload falhou: ${uploadErr.message}`)
    
    // 3) Rotação: lista e apaga antigos
    const { data: existingFiles } = await supa.storage
      .from(BUCKET)
      .list('auto', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
    
    if (existingFiles) {
      const cutoff = Date.now() - RETENTION_DAYS * 86400000
      const toDelete: string[] = []
      for (const folder of existingFiles) {
        // folder.name = "YYYY-MM-DD"
        const folderDate = new Date(folder.name + 'T00:00:00Z').getTime()
        if (!isNaN(folderDate) && folderDate < cutoff) {
          toDelete.push(`auto/${folder.name}/dump.json`)
        }
      }
      if (toDelete.length > 0) {
        await supa.storage.from(BUCKET).remove(toDelete)
        result.deleted_old = toDelete.length
      }
    }
    
    result.success = true
  } catch (e: any) {
    result.error = e.message || String(e)
  }
  
  result.finished_at = new Date().toISOString()
  
  // 4) Registra em backup_history
  await supa.from('backup_history').insert({
    started_at: result.started_at,
    finished_at: result.finished_at,
    file_path: result.success ? result.file_path : null,
    size_bytes: result.size_bytes,
    success: result.success,
    error_message: result.error,
    tables_snapshot: result.tables,
    triggered_by: 'cron',
  })
  
  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 500,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
})
