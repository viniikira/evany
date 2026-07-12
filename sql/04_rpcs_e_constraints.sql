-- ═══════════════════════════════════════════════════════════════════
-- KIRA v13 — RPCs transacionais para evitar perda silenciosa de dados
-- ═══════════════════════════════════════════════════════════════════
-- Fix do bug #2: replaceColorVariants/Suppliers/OrderItems faziam
-- DELETE + INSERT sem transação. Se o INSERT falhasse (timeout, RLS,
-- typo), o produto ficava SEM cores e o usuário só via "Erro".
--
-- Estas funções rodam DELETE + INSERT em uma única transação atômica.
-- Se qualquer parte falha, tudo é revertido.
-- ═══════════════════════════════════════════════════════════════════

-- Replace atômico de color_variants
CREATE OR REPLACE FUNCTION replace_color_variants(
  p_product_id UUID,
  p_variants JSONB  -- array de {code, status, sku}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER  -- respeita RLS do chamador
AS $$
DECLARE
  v_inserted JSONB;
BEGIN
  -- Tudo dentro de uma transação implícita (função plpgsql é atômica)
  DELETE FROM color_variants WHERE product_id = p_product_id;
  
  IF jsonb_array_length(p_variants) > 0 THEN
    INSERT INTO color_variants (product_id, code, status, sku)
    SELECT 
      p_product_id,
      (v->>'code'),
      COALESCE(v->>'status', 'idea'),
      NULLIF(v->>'sku', '')
    FROM jsonb_array_elements(p_variants) v;
  END IF;
  
  -- Retorna as cores resultantes
  SELECT jsonb_agg(row_to_json(cv)::jsonb) INTO v_inserted
  FROM color_variants cv WHERE cv.product_id = p_product_id;
  
  RETURN COALESCE(v_inserted, '[]'::jsonb);
END;
$$;

-- Replace atômico de suppliers
CREATE OR REPLACE FUNCTION replace_suppliers(
  p_product_id UUID,
  p_suppliers JSONB  -- array de {factory, factory_code, price_usd}
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_inserted JSONB;
BEGIN
  DELETE FROM suppliers WHERE product_id = p_product_id;
  
  IF jsonb_array_length(p_suppliers) > 0 THEN
    INSERT INTO suppliers (product_id, factory, factory_code, price_usd)
    SELECT 
      p_product_id,
      (s->>'factory'),
      NULLIF(s->>'factory_code', ''),
      NULLIF(s->>'price_usd', '')::numeric
    FROM jsonb_array_elements(p_suppliers) s;
  END IF;
  
  SELECT jsonb_agg(row_to_json(sp)::jsonb) INTO v_inserted
  FROM suppliers sp WHERE sp.product_id = p_product_id;
  
  RETURN COALESCE(v_inserted, '[]'::jsonb);
END;
$$;

-- Replace atômico de order_items
CREATE OR REPLACE FUNCTION replace_order_items(
  p_order_id UUID,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_inserted JSONB;
BEGIN
  DELETE FROM order_items WHERE order_id = p_order_id;
  
  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO order_items (
      order_id, product_id, product_name_snapshot, product_code_snapshot,
      product_cap_snapshot, selected_photo_url, name_manual, code_manual,
      cap_manual, quantity, price_usd, colors
    )
    SELECT 
      p_order_id,
      NULLIF(it->>'product_id', '')::uuid,
      NULLIF(it->>'product_name_snapshot', ''),
      NULLIF(it->>'product_code_snapshot', ''),
      NULLIF(it->>'product_cap_snapshot', ''),
      NULLIF(it->>'selected_photo_url', ''),
      NULLIF(it->>'name_manual', ''),
      NULLIF(it->>'code_manual', ''),
      NULLIF(it->>'cap_manual', ''),
      COALESCE(NULLIF(it->>'quantity', '')::int, 0),
      NULLIF(it->>'price_usd', '')::numeric,
      COALESCE(it->'colors', '[]'::jsonb)
    FROM jsonb_array_elements(p_items) it;
  END IF;
  
  SELECT jsonb_agg(row_to_json(oi)::jsonb) INTO v_inserted
  FROM order_items oi WHERE oi.order_id = p_order_id;
  
  RETURN COALESCE(v_inserted, '[]'::jsonb);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- Constraints e índices que faltavam (#16)
-- ═══════════════════════════════════════════════════════════════════

-- Cor única por produto (evita duplicatas como "27" + "27")
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_color_variants_product_code'
  ) THEN
    -- Limpa duplicatas existentes mantendo a mais recente antes de criar constraint
    DELETE FROM color_variants a USING color_variants b
    WHERE a.id < b.id AND a.product_id = b.product_id AND a.code = b.code;
    
    ALTER TABLE color_variants 
      ADD CONSTRAINT uq_color_variants_product_code UNIQUE (product_id, code);
  END IF;
END $$;

-- Nome único de produto (case-insensitive) — evita duplicatas em re-migração
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name_lower ON products (LOWER(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_ideas_name_lower ON ideas (LOWER(name));

-- Order: combinação factory+order_name+created_at deve ser única (proteção migração)
-- Comentado porque pode haver pedidos legítimos com mesmo nome em datas próximas
-- Se precisar, descomente
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_name_factory ON orders (factory, order_name, date_trunc('day', created_at));
