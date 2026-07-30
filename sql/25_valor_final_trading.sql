-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.67 — VALOR FINAL da trading (o que é realmente pago)
-- Aplicada em produção em 30/07/2026.
-- ═══════════════════════════════════════════════════════════════════
-- Contexto: a importação passa por uma trading que devolve o valor FINAL
-- por linha (FOB + impostos + frete + tudo), com multiplicador ~1,5–1,8 que
-- varia por produto E por cor. O FOB continua sendo o custo na fábrica.
--
-- Até a v13.66 todo o financeiro media a dívida contra o FOB — subestimando
-- em ~60%. Ex. real: FOB $7.823,40 → total da compra $11.745,60.
--
-- Estrutura espelha a do FOB: unitário no item + override por cor (dentro do
-- JSONB colors, que não precisa de DDL).

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS final_price_usd numeric;

COMMENT ON COLUMN order_items.final_price_usd IS
  'v13.67 — Valor FINAL unitário em USD informado pela trading (inclui impostos/frete). NULL = ainda não informado; cores podem sobrescrever via colors[].final_price_usd';

-- RPC atualizado: persiste final_price_usd (item) e preserva o override por cor
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
      requirements, colors
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
      NULLIF(it->>'requirements', ''),
      COALESCE(it->'colors', '[]'::jsonb)
    FROM jsonb_array_elements(p_items) it;
  END IF;

  SELECT jsonb_agg(row_to_json(oi)::jsonb) INTO v_inserted
  FROM order_items oi WHERE oi.order_id = p_order_id;

  RETURN COALESCE(v_inserted, '[]'::jsonb);
END;
$function$;
