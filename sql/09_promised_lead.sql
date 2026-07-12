-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.15 — prazo prometido pelo fornecedor (em dias)
-- ═══════════════════════════════════════════════════════════════════
-- Permite informar manualmente o prazo combinado quando pedido vira "Em Fabricação".
-- Sistema usa esse valor pra alertar atrasos. Se vazio, cai no fallback da média histórica.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS promised_lead_days INT,
  ADD COLUMN IF NOT EXISTS manufacturing_started_at TIMESTAMPTZ;
