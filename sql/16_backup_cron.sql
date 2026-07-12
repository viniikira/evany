-- sql/16_backup_cron.sql
-- v13.31 — Configura pg_cron pra disparar daily-backup edge function 1x/dia
--
-- IMPORTANTE: 
-- 1. Antes de aplicar, deploy a edge function "daily-backup" via Supabase CLI
-- 2. Habilite as extensões pg_cron e pg_net no Dashboard:
--    Database → Extensions → Enable: pg_cron, pg_net
-- 3. Ajuste o vault.secret se necessário (token de service_role)

-- Habilita extensões (se ainda não)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove job anterior se existir (idempotente)
SELECT cron.unschedule('kira-daily-backup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'kira-daily-backup');

-- Agenda: todo dia às 03:00 UTC (00:00 BRT)
-- Substitua YOUR_PROJECT_REF e YOUR_SERVICE_ROLE_KEY pelos valores reais
SELECT cron.schedule(
  'kira-daily-backup',
  '0 3 * * *',  -- cron: minuto hora dia mês dia-da-semana
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Confere agendamento
-- SELECT * FROM cron.job WHERE jobname = 'kira-daily-backup';
