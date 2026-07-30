-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.69 — sync automático da Shopify + quitar pedido
-- Aplicada em produção em 30/07/2026.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Status da sincronização da Shopify (a edge function shopify-sync grava aqui)
ALTER TABLE shopify_cache
  ADD COLUMN IF NOT EXISTS last_sync_source text,
  ADD COLUMN IF NOT EXISTS last_sync_ok boolean,
  ADD COLUMN IF NOT EXISTS last_sync_error text,
  ADD COLUMN IF NOT EXISTS products_count integer,
  ADD COLUMN IF NOT EXISTS orders_count integer,
  ADD COLUMN IF NOT EXISTS last_sync_ms integer;

COMMENT ON COLUMN shopify_cache.last_sync_source IS 'v13.69 — quem disparou: cron | manual';
COMMENT ON COLUMN shopify_cache.last_sync_ok IS 'v13.69 — a última execução terminou sem erro?';

-- 2) QUITAR PEDIDO manualmente (pedidos antigos pagos fora do sistema)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_note text;

COMMENT ON COLUMN orders.settled_at IS
  'v13.69 — quando a dona marcou o pedido como PAGO INTEGRALMENTE (pagamentos podem ter sido feitos fora do sistema). NULL = em aberto';

-- 3) Agendamento: sync toda noite às 03:30 UTC (00:30 BRT), meia hora depois
--    do backup pra não competir. Substituir o Bearer pela anon key do projeto.
-- SELECT cron.schedule('kira-shopify-sync', '30 3 * * *', $$
--   SELECT net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/shopify-sync',
--     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>'),
--     body := jsonb_build_object('source','cron')
--   );
-- $$);
