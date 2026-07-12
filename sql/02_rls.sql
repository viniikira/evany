-- ═══════════════════════════════════════════════════════════════════
-- KIRA v12 — Row Level Security
-- ═══════════════════════════════════════════════════════════════════
-- Rodar DEPOIS de 01_schema.sql
-- Regras (espelham PERMS do frontend):
--   admin   — tudo
--   gerente — produtos/pedidos/ideias/coleções/nomes/cores/shopify/logs. 
--             NÃO vê preços/fábricas/usuários.
--   equipe  — produtos (leitura e edição limitada), coleções, cores. 
--             NÃO vê pedidos, ideias, fábricas, preços, custos, pagamentos.
-- ═══════════════════════════════════════════════════════════════════

-- Ativa RLS em todas as tabelas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE colors ENABLE ROW LEVEL SECURITY;
ALTER TABLE names ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE color_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_cache ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
-- PROFILES: todos leem nomes; só admin edita roles
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS p_profiles_read ON profiles;
CREATE POLICY p_profiles_read ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS p_profiles_update_self ON profiles;
CREATE POLICY p_profiles_update_self ON profiles FOR UPDATE
  TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid() AND role = current_user_role());
  -- Usuário edita só a si mesmo, mas não pode mudar o próprio role

DROP POLICY IF EXISTS p_profiles_admin_all ON profiles;
CREATE POLICY p_profiles_admin_all ON profiles FOR ALL
  TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ═══════════════════════════════════════════════════════════════════
-- CADASTROS gerais: todos autenticados leem, admin/gerente escrevem
-- ═══════════════════════════════════════════════════════════════════

-- FACTORIES — só admin vê/edita (dado sensível: contatos de fornecedor)
DROP POLICY IF EXISTS p_factories_admin ON factories;
CREATE POLICY p_factories_admin ON factories FOR ALL
  TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- COLLECTIONS — todos leem, admin/gerente escrevem
DROP POLICY IF EXISTS p_collections_read ON collections;
CREATE POLICY p_collections_read ON collections FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS p_collections_write ON collections;
CREATE POLICY p_collections_write ON collections FOR INSERT TO authenticated WITH CHECK (is_manager_or_admin());
DROP POLICY IF EXISTS p_collections_update ON collections;
CREATE POLICY p_collections_update ON collections FOR UPDATE TO authenticated USING (is_manager_or_admin());
DROP POLICY IF EXISTS p_collections_delete ON collections;
CREATE POLICY p_collections_delete ON collections FOR DELETE TO authenticated USING (is_manager_or_admin());

-- COLORS — todos leem, admin/gerente escrevem
DROP POLICY IF EXISTS p_colors_read ON colors;
CREATE POLICY p_colors_read ON colors FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS p_colors_write ON colors;
CREATE POLICY p_colors_write ON colors FOR ALL TO authenticated USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- NAMES — só admin/gerente (banco de nomes é gestão)
DROP POLICY IF EXISTS p_names_all ON names;
CREATE POLICY p_names_all ON names FOR ALL TO authenticated USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- ═══════════════════════════════════════════════════════════════════
-- IDEAS — admin/gerente (equipe NÃO vê ideias)
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS p_ideas_all ON ideas;
CREATE POLICY p_ideas_all ON ideas FOR ALL TO authenticated USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- ═══════════════════════════════════════════════════════════════════
-- PRODUCTS — todos veem, equipe não edita campos sensíveis (via coluna)
-- Edição ampla: admin/gerente. Leitura: todos.
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS p_products_read ON products;
CREATE POLICY p_products_read ON products FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS p_products_write ON products;
CREATE POLICY p_products_write ON products FOR ALL TO authenticated 
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- COLOR_VARIANTS — todos leem; admin/gerente escrevem
DROP POLICY IF EXISTS p_cv_read ON color_variants;
CREATE POLICY p_cv_read ON color_variants FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS p_cv_write ON color_variants;
CREATE POLICY p_cv_write ON color_variants FOR ALL TO authenticated
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- SUPPLIERS — só admin (inclui preço sensível)
DROP POLICY IF EXISTS p_suppliers_admin ON suppliers;
CREATE POLICY p_suppliers_admin ON suppliers FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ═══════════════════════════════════════════════════════════════════
-- ORDERS — admin/gerente. Equipe não vê pedidos.
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS p_orders_all ON orders;
CREATE POLICY p_orders_all ON orders FOR ALL TO authenticated
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

DROP POLICY IF EXISTS p_order_items_all ON order_items;
CREATE POLICY p_order_items_all ON order_items FOR ALL TO authenticated
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- PAYMENTS — só admin (dado financeiro sensível)
DROP POLICY IF EXISTS p_payments_admin ON payments;
CREATE POLICY p_payments_admin ON payments FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ═══════════════════════════════════════════════════════════════════
-- ACTIVITY_LOGS — todos veem seus próprios; admin/gerente veem tudo
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS p_logs_read_own ON activity_logs;
CREATE POLICY p_logs_read_own ON activity_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_manager_or_admin());

DROP POLICY IF EXISTS p_logs_insert ON activity_logs;
CREATE POLICY p_logs_insert ON activity_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════════════
-- SHOPIFY_CACHE — admin/gerente só. Equipe não vê Shopify.
-- ═══════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS p_shopify_all ON shopify_cache;
CREATE POLICY p_shopify_all ON shopify_cache FOR ALL TO authenticated
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());
