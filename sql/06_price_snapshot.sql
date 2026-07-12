-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.10 — snapshot de preço USD + paridade ideias↔produtos
-- ═══════════════════════════════════════════════════════════════════
-- 1) snapshot de preço no item do pedido
-- 2) coluna pre_plucked em ideias (paridade com produtos)
-- 
-- Idempotente: pode rodar várias vezes sem erro.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS price_usd_snapshot NUMERIC(10,2);

UPDATE order_items
SET price_usd_snapshot = price_usd
WHERE price_usd_snapshot IS NULL
  AND price_usd IS NOT NULL;

-- Pre-plucked nas ideias (paridade com produtos)
ALTER TABLE ideas
  ADD COLUMN IF NOT EXISTS pre_plucked BOOLEAN DEFAULT FALSE;
