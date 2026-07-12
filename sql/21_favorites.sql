-- v13.44 — Sistema universal de favoritos
--
-- Padrão: uma tabela só, genérica por entity_type.
-- Atende produtos, ideias, cores, pedidos, fábricas, etc — sem precisar de nova migração.
--
-- Por usuário (profiles.id) — cada usuário tem sua própria lista de favoritos.
-- Idempotente (seguro rodar várias vezes).

CREATE TABLE IF NOT EXISTS user_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,      -- 'product', 'idea', 'color', 'order', 'factory', etc
  entity_id TEXT NOT NULL,        -- id da entity (UUID ou string, dependendo da tabela)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, entity_type, entity_id)
);

-- Index pra listagem rápida por usuário
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_type
  ON user_favorites(user_id, entity_type);

-- Index pra verificar "esta entity é favorita?"
CREATE INDEX IF NOT EXISTS idx_user_favorites_entity
  ON user_favorites(entity_type, entity_id);

-- RLS — cada usuário só vê/edita seus favoritos
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_favorites_select_own ON user_favorites;
CREATE POLICY user_favorites_select_own ON user_favorites
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_favorites_insert_own ON user_favorites;
CREATE POLICY user_favorites_insert_own ON user_favorites
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_favorites_delete_own ON user_favorites;
CREATE POLICY user_favorites_delete_own ON user_favorites
  FOR DELETE USING (user_id = auth.uid());

COMMENT ON TABLE user_favorites IS
  'v13.44 — Favoritos por usuário. Genérico: entity_type identifica de que tabela é (product, idea, color, etc).';
