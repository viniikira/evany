-- ═══════════════════════════════════════════════════════════════════
-- KIRA v12 — Storage buckets
-- ═══════════════════════════════════════════════════════════════════
-- Rodar DEPOIS de 01_schema.sql e 02_rls.sql
-- Dois buckets:
--   product-photos   — público (qualquer um com URL pode ver). 
--                      Usado pra fotos de produto, cores, coleções.
--   payment-receipts — privado (só admin acessa). 
--                      Comprovantes de pagamento têm dado fiscal sensível.
-- ═══════════════════════════════════════════════════════════════════

-- Bucket público para fotos de produtos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-photos',
  'product-photos',
  true,     -- público
  5242880,  -- 5 MB limite
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif'];

-- Bucket privado para comprovantes
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,    -- privado
  10485760, -- 10 MB limite (PDFs e fotos grandes)
  ARRAY['image/jpeg','image/png','image/webp','application/pdf']
)
ON CONFLICT (id) DO UPDATE SET 
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','application/pdf'];

-- ═══════════════════════════════════════════════════════════════════
-- Policies do Storage
-- ═══════════════════════════════════════════════════════════════════

-- product-photos: qualquer um autenticado upload; público lê via URL
DROP POLICY IF EXISTS p_storage_product_photos_upload ON storage.objects;
CREATE POLICY p_storage_product_photos_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-photos');

DROP POLICY IF EXISTS p_storage_product_photos_update ON storage.objects;
CREATE POLICY p_storage_product_photos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-photos');

DROP POLICY IF EXISTS p_storage_product_photos_delete ON storage.objects;
CREATE POLICY p_storage_product_photos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-photos');

DROP POLICY IF EXISTS p_storage_product_photos_read ON storage.objects;
CREATE POLICY p_storage_product_photos_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'product-photos');

-- payment-receipts: só admin
DROP POLICY IF EXISTS p_storage_receipts_admin ON storage.objects;
CREATE POLICY p_storage_receipts_admin ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'payment-receipts' AND is_admin())
  WITH CHECK (bucket_id = 'payment-receipts' AND is_admin());
