-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.46 — correções cirúrgicas (saúde de dados)
-- ═══════════════════════════════════════════════════════════════════
--   #1: CHECK de orders.status não aceitava 'in_transit'. A UI oferece
--       "Em Trânsito" desde a v13.x, mas o banco rejeitava a transição
--       (0 pedidos in_transit em produção confirmam o bug).
--   #2: clean_old_logs (sql/08) deletava da tabela 'logs', que não
--       existe — a tabela real de auditoria é activity_logs. Resultado:
--       a retenção de 90 dias nunca funcionou.
--   #3: o trigger de imutabilidade (sql/17) proibia TODO delete em
--       activity_logs, o que tornaria a retenção impossível mesmo com
--       o nome certo. Agora: UPDATE continua proibido sempre; DELETE
--       só é permitido para logs com mais de 90 dias (retenção).

-- ═══ #1 — orders.status ganha 'in_transit' ═══
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('draft','sent','manufacturing','in_transit','completed'));

-- ═══ #2 — clean_old_logs corrigida ═══
-- SECURITY DEFINER: o client não tem policy de DELETE em activity_logs,
-- então a limpeza roda com privilégio da função (via RPC).
-- Clamp em 90 dias: ninguém consegue usar a função pra apagar logs recentes.
CREATE OR REPLACE FUNCTION clean_old_logs(retention_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed INT;
BEGIN
  IF retention_days < 90 THEN
    retention_days := 90;
  END IF;
  DELETE FROM activity_logs WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

-- ═══ #3 — imutabilidade compatível com retenção ═══
CREATE OR REPLACE FUNCTION reject_log_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Única exceção: retenção — logs com mais de 90 dias podem ser removidos.
  IF TG_OP = 'DELETE' AND OLD.created_at < NOW() - INTERVAL '90 days' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Logs de atividade são imutáveis. Não é permitido %.', TG_OP;
END;
$$;

COMMENT ON FUNCTION clean_old_logs(INT) IS 'v13.46 — Retenção de activity_logs (mínimo 90 dias), SECURITY DEFINER';
COMMENT ON FUNCTION reject_log_modification() IS 'v13.46 — Logs imutáveis, exceto retenção de >90 dias';
