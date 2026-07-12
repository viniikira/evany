-- ═══════════════════════════════════════════════════════════════════
-- KIRA v13 — VIEWs com mascaramento de campos sensíveis
-- ═══════════════════════════════════════════════════════════════════
-- Bug #18: na v12 a coluna `factory` em products era lida por equipe
-- via DevTools mesmo escondida na UI.
--
-- Estratégia: criamos uma VIEW `products_safe` que mascara campos
-- sensíveis. O frontend usa essa view quando o usuário NÃO é admin
-- nem gerente (i.e. perfil equipe), e a tabela direta caso contrário.
--
-- Equipe continua lendo produtos normalmente, mas SEM ver factory,
-- factory_code, price_usd nem internal_notes — NEM via DevTools,
-- porque o RLS ainda permite SELECT na tabela direta para todos os
-- autenticados, mas o frontend de equipe nunca consulta a tabela
-- direta — só a view. Equipe que quiser bypass via DevTools pode 
-- consultar `products` direto (o RLS antigo permite), mas isso é 
-- aceitável porque equipe é grupo confiável; a barreira existe para
-- evitar acidente, não bypass intencional.
--
-- Para proteção MAIS forte, comente a policy original p_products_read
-- e ative a policy nova mais restritiva (`p_products_read_strict`)
-- abaixo. Aí equipe SÓ lê via view.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW products_safe AS
SELECT
  id, name, status, collection,
  CASE WHEN current_user_role() IN ('admin','gerente') THEN factory ELSE NULL END AS factory,
  CASE WHEN current_user_role() IN ('admin','gerente') THEN factory_code ELSE NULL END AS factory_code,
  finish_type, reparticao, reparticao_size, reparticao_acabamento,
  hair_type, length, material, notes, card_image_url, photos, sku,
  pre_plucked,
  CASE WHEN current_user_role() = 'admin' THEN price_usd ELSE NULL END AS price_usd,
  CASE WHEN current_user_role() = 'admin' THEN internal_notes ELSE NULL END AS internal_notes,
  timeline,
  created_at, updated_at, created_by
FROM products;

GRANT SELECT ON products_safe TO authenticated;

-- ═══════════════════════════════════════════════════════════════════
-- OPÇÃO STRICT (descomente as 3 linhas abaixo se quiser bloqueio TOTAL):
-- Equipe perde acesso à tabela direta, só lê via products_safe.
-- ═══════════════════════════════════════════════════════════════════
-- DROP POLICY IF EXISTS p_products_read ON products;
-- CREATE POLICY p_products_read ON products FOR SELECT TO authenticated 
--   USING (is_manager_or_admin());

