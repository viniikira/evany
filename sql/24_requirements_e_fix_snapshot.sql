-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.58 — requeriments por item + FIX do snapshot de preço
-- Aplicada em produção em 13/07/2026.
-- ═══════════════════════════════════════════════════════════════════
-- (1) `order_items.requirements`: instruções por modelo pra fábrica
--     (coluna "Requeriments" da planilha exportada).
-- (2) FIX: o RPC replace_order_items NÃO inseria price_usd_snapshot —
--     o app enviava e o banco descartava desde sempre (0/67 itens tinham
--     snapshot). O app não quebrava porque todo lugar lê snapshot ?? price_usd,
--     mas a semântica "snapshot é sagrado" não existia de fato no banco.
--     Backfill: price_usd do item JÁ É o valor congelado daquele pedido.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS requirements text;

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
      cap_manual, quantity, price_usd, price_usd_snapshot, requirements, colors
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
      NULLIF(it->>'requirements', ''),
      COALESCE(it->'colors', '[]'::jsonb)
    FROM jsonb_array_elements(p_items) it;
  END IF;

  SELECT jsonb_agg(row_to_json(oi)::jsonb) INTO v_inserted
  FROM order_items oi WHERE oi.order_id = p_order_id;

  RETURN COALESCE(v_inserted, '[]'::jsonb);
END;
$function$;

UPDATE order_items SET price_usd_snapshot = price_usd
WHERE price_usd_snapshot IS NULL AND price_usd IS NOT NULL;
