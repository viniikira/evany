-- sql/18_analytics.sql
-- v13.31 — Sistema de métricas de uso
--
-- Captura:
-- - Pageviews (qual tela, quanto tempo, quem)
-- - Eventos importantes (criar pedido, mudar status, exportar PDF...)
-- - Funil ideia → produto → pedido → completed (calculado em SQL)
--
-- Privacidade: tudo fica no SEU Supabase. Nada vai pra terceiros.

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT,                  -- snapshot pra não perder se profile for deletado
  event_type TEXT NOT NULL,        -- 'pageview' | 'click' | 'action'
  event_name TEXT NOT NULL,        -- 'dashboard' | 'create_order' | 'export_pdf' etc
  page TEXT,                        -- página onde aconteceu
  metadata JSONB,                   -- dados livres ({ orderId: 'x', status: 'sent' })
  duration_ms INTEGER,              -- pra pageviews: tempo na tela
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx
  ON analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_user_id_idx
  ON analytics_events (user_id);
CREATE INDEX IF NOT EXISTS analytics_events_event_name_idx
  ON analytics_events (event_name);

-- RLS: usuários inserem suas próprias métricas; só admin lê tudo
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_insert_own" ON analytics_events;
CREATE POLICY "analytics_insert_own" ON analytics_events
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "analytics_select_admin" ON analytics_events;
CREATE POLICY "analytics_select_admin" ON analytics_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- ═══════════════════════════════════════════════════════════════════
-- View: estatísticas de uso por página (últimos 30 dias)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_analytics_pages AS
SELECT
  page,
  COUNT(*) AS views_count,
  COUNT(DISTINCT user_id) AS unique_users,
  ROUND(AVG(duration_ms) / 1000.0, 1) AS avg_seconds,
  MAX(created_at) AS last_view
FROM analytics_events
WHERE event_type = 'pageview'
  AND created_at > now() - INTERVAL '30 days'
  AND page IS NOT NULL
GROUP BY page
ORDER BY views_count DESC;

-- ═══════════════════════════════════════════════════════════════════
-- View: ações mais executadas (últimos 30 dias)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_analytics_actions AS
SELECT
  event_name,
  COUNT(*) AS executions,
  COUNT(DISTINCT user_id) AS unique_users,
  MAX(created_at) AS last_execution
FROM analytics_events
WHERE event_type = 'action'
  AND created_at > now() - INTERVAL '30 days'
GROUP BY event_name
ORDER BY executions DESC;

-- ═══════════════════════════════════════════════════════════════════
-- Funil: ideia → produto → pedido → completed
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_analytics_funnel AS
WITH counts AS (
  SELECT
    -- Stage 1: Ideias criadas (excluindo descartadas)
    (SELECT COUNT(*) FROM ideas WHERE status != 'discarded') AS ideias_ativas,
    -- Stage 2: Ideias convertidas em produto (existe produto com mesmo nome — heurística)
    (SELECT COUNT(*) FROM products WHERE EXISTS (
      SELECT 1 FROM ideas WHERE LOWER(ideas.name) = LOWER(products.name)
    )) AS ideias_convertidas,
    -- Stage 3: Produtos com pelo menos 1 pedido
    (SELECT COUNT(DISTINCT p.id) FROM products p
      WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id)
    ) AS produtos_pedidos,
    -- Stage 4: Produtos com pedido completed
    (SELECT COUNT(DISTINCT p.id) FROM products p
      WHERE EXISTS (
        SELECT 1 FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id AND o.status = 'completed'
      )
    ) AS produtos_completados
)
SELECT
  ideias_ativas,
  ideias_convertidas,
  produtos_pedidos,
  produtos_completados,
  CASE WHEN ideias_ativas > 0
       THEN ROUND((ideias_convertidas::numeric / ideias_ativas) * 100, 1)
       ELSE 0 END AS pct_ideia_to_produto,
  CASE WHEN ideias_convertidas > 0
       THEN ROUND((produtos_pedidos::numeric / ideias_convertidas) * 100, 1)
       ELSE 0 END AS pct_produto_to_pedido,
  CASE WHEN produtos_pedidos > 0
       THEN ROUND((produtos_completados::numeric / produtos_pedidos) * 100, 1)
       ELSE 0 END AS pct_pedido_to_completed
FROM counts;

COMMENT ON TABLE analytics_events IS 'v13.31 — Eventos de uso do sistema (pageviews, clicks, actions)';
COMMENT ON VIEW v_analytics_pages IS 'Estatísticas de uso por página (últimos 30d)';
COMMENT ON VIEW v_analytics_actions IS 'Ações mais executadas (últimos 30d)';
COMMENT ON VIEW v_analytics_funnel IS 'Funil ideia → produto → pedido → completed';
