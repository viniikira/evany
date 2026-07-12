// src/lib/backup.js
// Backup automático: dump JSON das tabelas críticas pra Supabase Storage.
// Disparado uma vez por dia quando usuário entra no app (via runOncePerDay).
// Retenção: mantém últimos 30 dias, deleta o resto.
//
// IMPORTANTE: este backup roda no client. Funciona se o usuário abrir o app
// pelo menos 1x por dia. Pra robustez total, montar Edge Function com pg_cron
// no Supabase rodando este mesmo dump server-side.

import { supabase } from './supabase'
import { log } from './logger'

const BACKUP_BUCKET = 'backups'
const RETENTION_DAYS = 30

// v13.46 — lista corrigida: 'order_item_colors', 'order_payments' e
// 'order_status_history' nunca existiram no schema relacional (cores e
// histórico são colunas JSONB; pagamentos ficam na tabela 'payments').
// Com os nomes fantasmas, payments/color_variants/suppliers ficavam FORA
// do backup. RLS ainda se aplica: payments só entra quando um admin abre o app.
const TABLES_TO_BACKUP = [
  'products',
  'color_variants',
  'suppliers',
  'orders',
  'order_items',
  'payments',
  'ideas',
  'colors',
  'color_categories',
  'color_category_assignments',
  'collections',
  'factories',
  'names',
]

/**
 * Cria um backup completo das tabelas críticas em JSON.
 * Salva em: backups/YYYY-MM-DD/dump.json
 * Em caso de erro, registra mas não quebra o app.
 */
export async function runDailyBackup() {
  const today = new Date().toISOString().slice(0, 10)
  log.info(`[backup] Iniciando dump diário ${today}...`)
  
  const dump = { 
    version: 'v13.46',
    created_at: new Date().toISOString(),
    tables: {},
  }
  
  let totalRows = 0
  
  for (const table of TABLES_TO_BACKUP) {
    try {
      const { data, error } = await supabase.from(table).select('*')
      if (error) {
        log.warn(`[backup] erro tabela ${table}:`, error.message)
        dump.tables[table] = { error: error.message }
        continue
      }
      dump.tables[table] = data || []
      totalRows += (data || []).length
    } catch (e) {
      log.warn(`[backup] exceção tabela ${table}:`, e)
      dump.tables[table] = { error: String(e) }
    }
  }
  
  dump.total_rows = totalRows
  
  const json = JSON.stringify(dump, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const path = `${today}/dump.json`
  
  try {
    const { error: upErr } = await supabase.storage
      .from(BACKUP_BUCKET)
      .upload(path, blob, { upsert: true, contentType: 'application/json' })
    
    if (upErr) {
      log.error('[backup] upload falhou:', upErr)
      return { success: false, error: upErr.message }
    }
    
    log.info(`[backup] ✓ ${totalRows} linhas salvas em ${path}`)
    
    // Limpa backups antigos (>30 dias)
    await cleanOldBackups()
    
    return { success: true, path, totalRows }
  } catch (e) {
    log.error('[backup] erro:', e)
    return { success: false, error: String(e) }
  }
}

/**
 * Lista backups antigos e deleta os com mais de RETENTION_DAYS.
 */
async function cleanOldBackups() {
  try {
    const { data: folders, error } = await supabase.storage
      .from(BACKUP_BUCKET)
      .list('', { limit: 100 })
    
    if (error) {
      log.warn('[backup-clean] list falhou:', error)
      return
    }
    
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    
    const toDelete = []
    for (const folder of (folders || [])) {
      // Folder name é YYYY-MM-DD
      if (folder.name && folder.name < cutoffStr) {
        toDelete.push(`${folder.name}/dump.json`)
      }
    }
    
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase.storage.from(BACKUP_BUCKET).remove(toDelete)
      if (delErr) {
        log.warn('[backup-clean] delete falhou:', delErr)
      } else {
        log.info(`[backup-clean] ✓ ${toDelete.length} backups antigos removidos`)
      }
    }
  } catch (e) {
    log.warn('[backup-clean] erro:', e)
  }
}

/**
 * Lista backups disponíveis (pra UI mostrar pra restauração manual).
 */
export async function listBackups() {
  try {
    const { data, error } = await supabase.storage.from(BACKUP_BUCKET).list('', { limit: 100 })
    if (error) return { backups: [], error: error.message }
    
    const backups = (data || [])
      .filter(item => item.name && /^\d{4}-\d{2}-\d{2}$/.test(item.name))
      .map(item => ({
        date: item.name,
        path: `${item.name}/dump.json`,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))  // mais recente primeiro
    
    return { backups }
  } catch (e) {
    return { backups: [], error: String(e) }
  }
}
