-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.52 — Hardening de segurança (achados do advisor Supabase)
-- Aplicada em produção em 12/07/2026. Somente banco (não muda o app).
-- ═══════════════════════════════════════════════════════════════════

-- 1) CRÍTICO — kv_store / kv_store_history estavam LEGÍVEIS SEM LOGIN
--    (RLS desligado + EXECUTE/SELECT herdado por anon). Vazamento real dos
--    dados antigos do negócio. Liga RLS com política só-admin; a migração
--    (migrate.js, roda como admin) continua funcionando.
ALTER TABLE public.kv_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kv_store_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kv_store_admin_all ON public.kv_store;
CREATE POLICY kv_store_admin_all ON public.kv_store FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
DROP POLICY IF EXISTS kv_store_history_admin_all ON public.kv_store_history;
CREATE POLICY kv_store_history_admin_all ON public.kv_store_history FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
REVOKE ALL ON public.kv_store FROM anon;
REVOKE ALL ON public.kv_store_history FROM anon;

-- 2) search_path fixo (evita search_path injection em funções SECURITY DEFINER)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'touch_updated_at','replace_color_variants','replace_suppliers','replace_order_items',
      'reject_log_modification','purge_old_deleted_orders','reject_purge_undo',
      'fn_limpar_historico_antigo','clean_old_logs','is_admin','is_manager_or_admin',
      'current_user_role','handle_new_user','fn_kv_backup_antes_update')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END $$;

-- 3) Views deixam de ser SECURITY DEFINER → respeitam a RLS do usuário que consulta.
--    products_safe só lê `products` (mascaramento de custo/fábrica preservado);
--    as views de analytics passam a ser admin-only de fato.
ALTER VIEW public.products_safe      SET (security_invoker = true);
ALTER VIEW public.v_analytics_pages  SET (security_invoker = true);
ALTER VIEW public.v_analytics_actions SET (security_invoker = true);
ALTER VIEW public.v_analytics_funnel SET (security_invoker = true);

-- 4) EXECUTE estava concedido a PUBLIC (anon herdava). Revoga do PUBLIC nos casos seguros.
--    clean_old_logs: app chama como authenticated; cron/edge usam service_role.
REVOKE EXECUTE ON FUNCTION public.clean_old_logs(integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.clean_old_logs(integer) TO authenticated;
--    Funções de trigger nunca precisam de EXECUTE via RPC (rodam como dono).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_kv_backup_antes_update() FROM PUBLIC;

-- ───────────────────────────────────────────────────────────────────
-- NÃO alterado de propósito (baixo risco / por design):
--   • is_admin / is_manager_or_admin / current_user_role executáveis:
--     são a BASE da RLS (authenticated precisa de EXECUTE) e retornam
--     false/null pra anon — inofensivo. Mexer arriscaria quebrar a RLS.
--   • color_categories / color_category_assignments com política ALL USING(true):
--     equipe gerencia cores (inclui categorias) — permissivo é intencional.
--   • bucket product-photos permite listagem: imagens já são públicas.
--   • pg_net no schema public: mover arriscaria o pg_cron (backup diário).
--   • Proteção de senha vazada (HaveIBeenPwned): ativar no painel Supabase
--     (Auth → Policies) — é configuração de Auth, não SQL.
