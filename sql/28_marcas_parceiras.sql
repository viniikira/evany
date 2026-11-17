-- ═══════════════════════════════════════════════════════════════════
-- v13.84 — MARCAS PARCEIRAS (ex.: Slick)
--
-- Além das fábricas (modelos exclusivos da Evany Hair, pagos em dólar via
-- trading), ela compra modelos PRONTOS de marcas que não são exclusivas.
-- Pedido personalizado (escolhe as cores), preço muda a cada pedido e é
-- pago em REAIS. Esses produtos e pedidos não podem se misturar com os de
-- fabricação própria.
--
--   factories.kind    'factory' (fábrica) | 'brand' (marca parceira)
--   products.kind     'own' (fabricação própria) | 'brand' (modelo da marca)
--   orders.kind       'factory' | 'brand'
--   orders.currency   'USD' | 'BRL' — moeda em que o pedido é cobrado
--   order_items.price_brl + colors[].price_brl — preço por peça em reais
--
-- Tudo com DEFAULT: o que já existe continua igual (fábrica / USD).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE factories ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'factory';
ALTER TABLE factories DROP CONSTRAINT IF EXISTS factories_kind_check;
ALTER TABLE factories ADD CONSTRAINT factories_kind_check CHECK (kind IN ('factory', 'brand'));

ALTER TABLE products ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'own';
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK (kind IN ('own', 'brand'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'factory';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_kind_check;
ALTER TABLE orders ADD CONSTRAINT orders_kind_check CHECK (kind IN ('factory', 'brand'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_currency_check;
ALTER TABLE orders ADD CONSTRAINT orders_currency_check CHECK (currency IN ('USD', 'BRL'));

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_brl numeric;

-- products_safe: expõe o tipo (coluna nova vai no FIM — exigência do CREATE OR REPLACE VIEW)
CREATE OR REPLACE VIEW public.products_safe WITH (security_invoker = true) AS
 SELECT id,
    name,
    status,
    collection,
        CASE
            WHEN current_user_role() = ANY (ARRAY['admin'::text, 'gerente'::text]) THEN factory
            ELSE NULL::text
        END AS factory,
        CASE
            WHEN current_user_role() = ANY (ARRAY['admin'::text, 'gerente'::text]) THEN factory_code
            ELSE NULL::text
        END AS factory_code,
    finish_type,
    reparticao,
    reparticao_size,
    reparticao_acabamento,
    hair_type,
    length,
    material,
    notes,
    card_image_url,
    photos,
    sku,
    pre_plucked,
        CASE
            WHEN current_user_role() = 'admin'::text THEN price_usd
            ELSE NULL::numeric
        END AS price_usd,
        CASE
            WHEN current_user_role() = 'admin'::text THEN internal_notes
            ELSE NULL::jsonb
        END AS internal_notes,
    timeline,
    created_at,
    updated_at,
    created_by,
    kind
   FROM products;

-- replace_order_items: grava também o preço em reais do item
CREATE OR REPLACE FUNCTION public.replace_order_items(p_order_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted JSONB;
BEGIN
  DELETE FROM order_items WHERE order_id = p_order_id;

  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO order_items (
      order_id, product_id, product_name_snapshot, product_code_snapshot,
      product_cap_snapshot, selected_photo_url, name_manual, code_manual,
      cap_manual, quantity, price_usd, price_usd_snapshot, final_price_usd,
      price_brl, requirements, colors
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
      NULLIF(it->>'price_usd_snapshot', '')::numeric,
      NULLIF(it->>'final_price_usd', '')::numeric,
      NULLIF(it->>'price_brl', '')::numeric,
      NULLIF(it->>'requirements', ''),
      COALESCE(it->'colors', '[]'::jsonb)
    FROM jsonb_array_elements(p_items) it;
  END IF;

  SELECT jsonb_agg(row_to_json(oi)::jsonb) INTO v_inserted
  FROM order_items oi WHERE oi.order_id = p_order_id;

  RETURN COALESCE(v_inserted, '[]'::jsonb);
END;
$function$;
