-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.22 — Soft delete eterno (purged_at)
-- ═══════════════════════════════════════════════════════════════════
-- Mudança: "excluir definitivamente" deixa de ser DELETE físico.
-- Agora marca purged_at e mantém pedido + items + payments + comprovantes
-- intactos pra auditoria fiscal (que pode chegar até 5 anos depois).
--
-- Estados de visibilidade:
--   deleted_at = NULL                          → ativo (lista normal)
--   deleted_at != NULL, purged_at = NULL      → na lixeira (recuperável)
--   purged_at != NULL                          → arquivo morto (oculto da UI, mas no banco)
--
-- A função purge_old_deleted_orders agora seta purged_at em vez de DELETE.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

-- Índice parcial pra acelerar listagens normais (que ignoram purgados)
CREATE INDEX IF NOT EXISTS idx_orders_not_purged ON orders (created_at DESC) WHERE purged_at IS NULL;

-- Substitui a função que antes fazia DELETE
CREATE OR REPLACE FUNCTION purge_old_deleted_orders(retention_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  affected INT;
BEGIN
  UPDATE orders
  SET purged_at = NOW()
  WHERE deleted_at IS NOT NULL
    AND purged_at IS NULL
    AND deleted_at < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
