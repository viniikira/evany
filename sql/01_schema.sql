-- ═══════════════════════════════════════════════════════════════════
-- KIRA v12 — Schema relacional
-- ═══════════════════════════════════════════════════════════════════
-- Rodar no SQL Editor do Supabase em ORDEM:
--   1. 01_schema.sql  (este arquivo)
--   2. 02_rls.sql     (policies de segurança)
--   3. 03_storage.sql (buckets)
-- A migração de dados antigos fica em um script JS separado (rodado pelo app).
-- ═══════════════════════════════════════════════════════════════════

-- Extensões úteis
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════
-- PROFILES — extensão de auth.users com role/nome
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'equipe' CHECK (role IN ('admin','gerente','equipe')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

-- Cria profile automaticamente quando usuário é registrado
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'equipe')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Helper: pegar role do usuário atual (usado em RLS)
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE;

-- Helper: usuário é admin?
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role = 'admin' FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE;

-- Helper: usuário é admin ou gerente?
CREATE OR REPLACE FUNCTION is_manager_or_admin()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role IN ('admin','gerente') FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════
-- CADASTROS BÁSICOS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS factories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  country TEXT DEFAULT 'China',
  contact TEXT,
  notes TEXT,
  wechats JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  active BOOLEAN DEFAULT true,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS colors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Índice case-insensitive pra evitar duplicatas "Valentina" vs "VALENTINA"
CREATE UNIQUE INDEX IF NOT EXISTS idx_names_lower ON names (LOWER(name));

-- ═══════════════════════════════════════════════════════════════════
-- IDEAS — possíveis produtos em pesquisa
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'possibility' CHECK (status IN ('possibility','researching','discarded')),
  collection TEXT,
  factory TEXT,
  factory_code TEXT,
  finish_type TEXT,
  reparticao TEXT,
  reparticao_size TEXT,
  reparticao_acabamento TEXT,
  hair_type TEXT,
  length TEXT,
  material TEXT,
  notes TEXT,
  card_image_url TEXT,
  photos JSONB DEFAULT '[]'::jsonb,  -- array de URLs
  price_usd NUMERIC(10,2),
  timeline JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
CREATE INDEX IF NOT EXISTS idx_ideas_name ON ideas(LOWER(name));

-- ═══════════════════════════════════════════════════════════════════
-- PRODUCTS — produto principal
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'developing' CHECK (status IN ('developing','in_production','catalog','discontinued')),
  collection TEXT,
  factory TEXT,                -- fábrica principal (compat)
  factory_code TEXT,
  finish_type TEXT,
  reparticao TEXT,
  reparticao_size TEXT,
  reparticao_acabamento TEXT,
  hair_type TEXT,
  length TEXT,
  material TEXT,
  notes TEXT,
  card_image_url TEXT,
  photos JSONB DEFAULT '[]'::jsonb,
  sku TEXT,
  pre_plucked BOOLEAN DEFAULT false,
  price_usd NUMERIC(10,2),
  internal_notes JSONB DEFAULT '[]'::jsonb,
  timeline JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_products_collection ON products(collection);
CREATE INDEX IF NOT EXISTS idx_products_factory ON products(factory);

-- Color variants (1:N com produtos)
CREATE TABLE IF NOT EXISTS color_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','production','catalog','discontinued')),
  sku TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_color_variants_product ON color_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_color_variants_sku ON color_variants(sku) WHERE sku IS NOT NULL;

-- Suppliers (1:N — múltiplas fábricas por produto)
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  factory TEXT NOT NULL,
  factory_code TEXT,
  price_usd NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_product ON suppliers(product_id);

-- ═══════════════════════════════════════════════════════════════════
-- ORDERS — pedido para fábrica
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_name TEXT,
  factory TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','manufacturing','completed')),
  dispatch_code TEXT,
  conversion_factor NUMERIC(5,2) DEFAULT 1.5,
  budget_rate NUMERIC(10,4),
  real_cost_brl NUMERIC(12,2),
  notes TEXT,
  expected_arrival DATE,     -- NOVO: previsão de chegada
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_factory ON orders(factory);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- Itens do pedido (1:N)
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  -- SNAPSHOT: congelado no momento da criação pra auditoria
  product_name_snapshot TEXT,
  product_code_snapshot TEXT,
  product_cap_snapshot TEXT,
  selected_photo_url TEXT,
  name_manual TEXT,
  code_manual TEXT,
  cap_manual TEXT,
  quantity INTEGER DEFAULT 0,
  price_usd NUMERIC(10,2),
  colors JSONB DEFAULT '[]'::jsonb,  -- array [{code, qty}]
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- Pagamentos do pedido (1:N)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_date DATE,
  amount_usd NUMERIC(12,2),
  rate_paid NUMERIC(10,4),
  amount_brl NUMERIC(12,2),
  bank TEXT,
  receipt_url TEXT,           -- bucket privado
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- ═══════════════════════════════════════════════════════════════════
-- ACTIVITY LOG — append-only
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_name_snapshot TEXT,       -- congela nome no momento, sobrevive à exclusão
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  entity_type TEXT,              -- 'product', 'order', etc
  entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity_type, entity_id);

-- ═══════════════════════════════════════════════════════════════════
-- SHOPIFY CACHE — cache de dados do Shopify, único JSON é aceitável aqui
-- (é cache descartável, não dado crítico)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS shopify_cache (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  products JSONB DEFAULT '[]'::jsonb,
  orders JSONB DEFAULT '[]'::jsonb,
  last_sync TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO shopify_cache (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- Trigger pra atualizar updated_at automaticamente
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'factories','collections','colors','ideas','products','orders','shopify_cache'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- Seeds mínimos (cores padrão, coleções padrão, fábricas padrão)
-- Só insere se a tabela estiver vazia
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO factories (name, country) VALUES
  ('EPF','China'),('HAIRCHUAN','China'),('HAIR FORTUNE','China')
ON CONFLICT (name) DO NOTHING;

INSERT INTO collections (name, description, active) VALUES
  ('Evany Hair','Linha exclusiva Kira Perucas · CNPJ 27.760.371/0001-28', true),
  ('Morena Obsessão','Tons escuros e naturais', true),
  ('KiLace','Laces premium', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO colors (code) VALUES
  ('1'),('1B'),('2'),('4'),('6'),('27'),('30'),('33'),('99J'),('613'),
  ('T1B/27'),('T1B/30'),('T1B/613'),('TT2/4325'),('FS4/27'),('TT6/1613'),
  ('Ombré'),('Balayage')
ON CONFLICT (code) DO NOTHING;
