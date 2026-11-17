-- ═══════════════════════════════════════════════════════════════════
-- v13.85 — PREÇO ATUAL DO MODELO DE MARCA PARCEIRA
--
-- A SLEEK manda tabela de preço por modelo (em reais, muda de tempos em
-- tempos: ex. TANIA 130 → 145). Fica no cadastro do modelo e vira o preço
-- inicial quando ela monta um pedido (continua editável por pedido).
-- Só admin vê (mesma regra do price_usd).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE products ADD COLUMN IF NOT EXISTS price_brl numeric;

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
    kind,
        CASE
            WHEN current_user_role() = 'admin'::text THEN price_brl
            ELSE NULL::numeric
        END AS price_brl
   FROM products;
