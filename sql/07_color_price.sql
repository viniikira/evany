-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.13 — preço opcional por cor no item do pedido
-- ═══════════════════════════════════════════════════════════════════
-- Cada cor pode ter preço próprio que sobrescreve o preço do item.
-- Caso comum: cor null usa preço do item (todas iguais).
-- Caso especial: cor especial mais cara → tem price_usd próprio.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE order_item_colors
  ADD COLUMN IF NOT EXISTS price_usd NUMERIC(10,2);
