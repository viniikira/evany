-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.23 — Categorias de cores (livres + N:N)
-- ═══════════════════════════════════════════════════════════════════
-- Você cadastra categorias livremente (escuras, loiras, ruivas, festa, etc.)
-- Cada cor pode ter VÁRIAS categorias. Cada categoria pode ter várias cores.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Tabela de categorias
CREATE TABLE IF NOT EXISTS color_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  hex         TEXT,                                -- cor visual da chip (opcional)
  icon        TEXT,                                -- emoji/símbolo (opcional)
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT color_categories_name_unique UNIQUE (name),
  CONSTRAINT color_categories_hex_format CHECK (hex IS NULL OR hex ~ '^#[0-9A-Fa-f]{3,8}$')
);

-- 2. Junction N:N (uma cor → várias categorias)
CREATE TABLE IF NOT EXISTS color_category_assignments (
  color_id     UUID NOT NULL REFERENCES colors(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES color_categories(id) ON DELETE CASCADE,
  
  PRIMARY KEY (color_id, category_id)
);

-- 3. Índices pra queries comuns
CREATE INDEX IF NOT EXISTS idx_color_cat_assignments_color    ON color_category_assignments (color_id);
CREATE INDEX IF NOT EXISTS idx_color_cat_assignments_category ON color_category_assignments (category_id);
CREATE INDEX IF NOT EXISTS idx_color_categories_sort          ON color_categories (sort_order, name);

-- 4. RLS (mesmo padrão de colors: leitura pública pra todos autenticados, escrita admin/gerente)
ALTER TABLE color_categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE color_category_assignments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS color_categories_read ON color_categories;
CREATE POLICY color_categories_read ON color_categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS color_categories_write ON color_categories;
CREATE POLICY color_categories_write ON color_categories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS color_cat_assignments_read ON color_category_assignments;
CREATE POLICY color_cat_assignments_read ON color_category_assignments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS color_cat_assignments_write ON color_category_assignments;
CREATE POLICY color_cat_assignments_write ON color_category_assignments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
