-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.14 — bucket de backups + retenção de logs
-- ═══════════════════════════════════════════════════════════════════

-- 1. Cria bucket privado pra backups (idempotente)
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Política: apenas authenticated users podem ler/escrever no bucket de backups
DROP POLICY IF EXISTS "auth users full access to backups" ON storage.objects;
CREATE POLICY "auth users full access to backups"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'backups')
WITH CHECK (bucket_id = 'backups');

-- 3. (OPCIONAL — robustez total) Função SQL pra limpar logs antigos no servidor
-- Pode ser agendada via pg_cron pra rodar 1x por dia independente do client.
-- Exemplo de agendamento (rodar separadamente após instalar pg_cron):
--   SELECT cron.schedule('clean-old-logs', '0 3 * * *', 'SELECT clean_old_logs(90)');
CREATE OR REPLACE FUNCTION clean_old_logs(retention_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  removed INT;
BEGIN
  DELETE FROM logs WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
