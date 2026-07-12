-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.20 — Cor com personalidade
-- ═══════════════════════════════════════════════════════════════════
-- Adiciona campos descritivos pra cores deixarem de ser só "código frio"
-- e passarem a ser objetos visuais (foto, hex, nome em pt, fábricas)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE colors
  ADD COLUMN IF NOT EXISTS name_pt    TEXT,
  ADD COLUMN IF NOT EXISTS hex        TEXT,
  ADD COLUMN IF NOT EXISTS photo_url  TEXT,
  ADD COLUMN IF NOT EXISTS factories  JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes      TEXT;

-- Constraint leve no hex (validação opcional)
-- Permitimos null mas se preenchido deve ser hex válido (#RGB, #RRGGBB)
ALTER TABLE colors
  DROP CONSTRAINT IF EXISTS colors_hex_format;
ALTER TABLE colors
  ADD CONSTRAINT colors_hex_format CHECK (hex IS NULL OR hex ~ '^#[0-9A-Fa-f]{3,8}$');
