-- v13.40 — Campo order_date na tabela orders
-- 
-- Motivo: permitir registrar pedidos antigos com data real (não data de criação no sistema).
-- created_at continua sendo auditoria de "quando foi inserido no sistema" (imutável).
-- order_date é opcional: se NULL, usa created_at. Se preenchido, é a data "real" do pedido.
--
-- Uso em UI:
--   - OrderModal: campo opcional "Data do pedido"
--   - OrderDetail: mostra order_date como data principal, created_at no tooltip
--   - Lista de pedidos: ordena por order_date quando presente
--
-- Idempotente: se já existe, não dá erro.

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'order_date'
  ) THEN
    ALTER TABLE orders ADD COLUMN order_date DATE;
    COMMENT ON COLUMN orders.order_date IS
      'Data real do pedido quando preenchida manualmente (pedidos antigos, retroativos). NULL = usar created_at.';
  END IF;
END $$;

-- Index opcional pra ordenação eficiente por data
CREATE INDEX IF NOT EXISTS orders_order_date_idx ON orders(order_date) WHERE order_date IS NOT NULL;
