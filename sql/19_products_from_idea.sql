-- sql/19_products_from_idea.sql
-- v13.32 — Vínculo explícito ideia → produto pra funil exato
--
-- Antes (v13.31): view v_analytics_funnel usava match por nome (heurística).
-- Agora: produto sabe explicitamente se veio de ideia.

-- Coluna nova (nullable — produtos antigos não têm)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS from_idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_from_idea_id_idx
  ON products(from_idea_id) WHERE from_idea_id IS NOT NULL;

COMMENT ON COLUMN products.from_idea_id IS 'v13.32 — ID da ideia de origem se foi convertido. NULL = criado direto como produto.';

-- ═══════════════════════════════════════════════════════════════════
-- Atualiza view do funil pra usar from_idea_id (preciso) com fallback
-- pra heurística por nome (cobre produtos antigos da v13.31 ou antes)
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_analytics_funnel AS
WITH counts AS (
  SELECT
    -- Stage 1: Ideias criadas (excluindo descartadas)
    (SELECT COUNT(*) FROM ideas WHERE status != 'discarded') AS ideias_ativas,
    
    -- Stage 2: Ideias convertidas em produto
    -- Modo preciso: products.from_idea_id apontando pra ideia
    -- + Fallback heurístico pra produtos antigos sem vínculo (match por nome)
    (SELECT COUNT(DISTINCT i.id) FROM ideas i
      WHERE i.status != 'discarded'
      AND (
        EXISTS (SELECT 1 FROM products p WHERE p.from_idea_id = i.id)
        OR EXISTS (
          SELECT 1 FROM products p
          WHERE p.from_idea_id IS NULL  -- só fallback pra antigos
          AND LOWER(p.name) = LOWER(i.name)
        )
      )
    ) AS ideias_convertidas,
    
    -- Stage 3: Produtos com pelo menos 1 pedido
    (SELECT COUNT(DISTINCT p.id) FROM products p
      WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id)
    ) AS produtos_pedidos,
    
    -- Stage 4: Produtos com pedido completed
    (SELECT COUNT(DISTINCT p.id) FROM products p
      WHERE EXISTS (
        SELECT 1 FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id AND o.status = 'completed'
      )
    ) AS produtos_completados
)
SELECT
  ideias_ativas,
  ideias_convertidas,
  produtos_pedidos,
  produtos_completados,
  CASE WHEN ideias_ativas > 0
       THEN ROUND((ideias_convertidas::numeric / ideias_ativas) * 100, 1)
       ELSE 0 END AS pct_ideia_to_produto,
  CASE WHEN ideias_convertidas > 0
       THEN ROUND((produtos_pedidos::numeric / ideias_convertidas) * 100, 1)
       ELSE 0 END AS pct_produto_to_pedido,
  CASE WHEN produtos_pedidos > 0
       THEN ROUND((produtos_completados::numeric / produtos_pedidos) * 100, 1)
       ELSE 0 END AS pct_pedido_to_completed
FROM counts;
