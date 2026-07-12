-- sql/17_protection_triggers.sql
-- v13.31 — Triggers de proteção (decisões da usuária):
--   #3: Logs imutáveis (audit trail nunca pode ser alterado/apagado)
--   #4: Anti-undo de purged_at (purga é definitiva)
--
-- NÃO inclui (decisão da usuária):
--   - Bloqueio de "completed sem pagamento" (warning no front é suficiente)
--   - Bloqueio de data retroativa de manufacturing

-- ═══════════════════════════════════════════════════════════════════
-- #3 — Logs imutáveis
-- ═══════════════════════════════════════════════════════════════════
-- activity_logs só aceita INSERT. UPDATE e DELETE são proibidos.
-- Justificativa: logs são audit trail, alteração descaracteriza.

CREATE OR REPLACE FUNCTION reject_log_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Logs de atividade são imutáveis. Não é permitido %.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS prevent_log_update ON activity_logs;
CREATE TRIGGER prevent_log_update
  BEFORE UPDATE ON activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION reject_log_modification();

DROP TRIGGER IF EXISTS prevent_log_delete ON activity_logs;
CREATE TRIGGER prevent_log_delete
  BEFORE DELETE ON activity_logs
  FOR EACH ROW
  EXECUTE FUNCTION reject_log_modification();

-- ═══════════════════════════════════════════════════════════════════
-- #4 — Anti-undo de purged_at
-- ═══════════════════════════════════════════════════════════════════
-- Se um pedido foi purgado (purged_at != NULL), não pode voltar pra NULL.
-- Justificativa: purga é definitiva, "des-purgar" causaria inconsistência
-- com Storage (arquivos podem ter sido deletados, etc.)

CREATE OR REPLACE FUNCTION reject_purge_undo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS NULL THEN
    RAISE EXCEPTION 'Não é possível desfazer purga de pedido. Foi marcado como excluído definitivo em %.', OLD.purged_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_purge_undo ON orders;
CREATE TRIGGER prevent_purge_undo
  BEFORE UPDATE ON orders
  FOR EACH ROW
  WHEN (OLD.purged_at IS NOT NULL)
  EXECUTE FUNCTION reject_purge_undo();

COMMENT ON FUNCTION reject_log_modification() IS 'v13.31 — Garante que logs de auditoria são imutáveis';
COMMENT ON FUNCTION reject_purge_undo() IS 'v13.31 — Garante que purga de pedido é definitiva';
