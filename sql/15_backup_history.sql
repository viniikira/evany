-- sql/15_backup_history.sql
-- v13.31 — Histórico de execuções de backup automático
-- Aplique APÓS deploy da edge function daily-backup

CREATE TABLE IF NOT EXISTS backup_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  file_path TEXT,
  size_bytes BIGINT DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  tables_snapshot JSONB,  -- { "products": { count: 50 }, ... }
  triggered_by TEXT DEFAULT 'cron',  -- 'cron' | 'manual' | 'client-side'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backup_history_started_at_idx
  ON backup_history (started_at DESC);

-- RLS: só admin lê (e service_role insere)
ALTER TABLE backup_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backup_history_select" ON backup_history;
CREATE POLICY "backup_history_select" ON backup_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- INSERT só via service_role (edge function)
DROP POLICY IF EXISTS "backup_history_insert" ON backup_history;
CREATE POLICY "backup_history_insert" ON backup_history
  FOR INSERT WITH CHECK (false);  -- service_role bypassa RLS

COMMENT ON TABLE backup_history IS 'Histórico de execuções de backup automático (edge function daily-backup)';
