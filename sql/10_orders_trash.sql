-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.18 — Lixeira de Pedidos (soft delete + retenção 30d)
-- ═══════════════════════════════════════════════════════════════════
-- Pedidos "deletados" recebem deleted_at. Ficam invisíveis em queries normais
-- mas podem ser restaurados em até 30 dias. Após isso, função purge limpa de vez.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Coluna soft delete
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2. Índice pra acelerar filtro "deleted_at IS NULL" (query padrão)
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted ON orders (created_at DESC) WHERE deleted_at IS NULL;

-- 3. Função pra purge final (deleta pedidos com >30d na lixeira)
-- Cascata vai limpar order_items e payments via FK ON DELETE CASCADE
CREATE OR REPLACE FUNCTION purge_old_deleted_orders(retention_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  removed INT;
BEGIN
  DELETE FROM orders
  WHERE deleted_at IS NOT NULL
    AND deleted_at < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
