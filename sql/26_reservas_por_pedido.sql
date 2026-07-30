-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.68 — CAIXINHAS / RESERVAS por pedido (Fase 2)
-- Aplicada em produção em 30/07/2026.
-- ═══════════════════════════════════════════════════════════════════
-- A dona às vezes já tem o dinheiro do pedido guardado (rendendo) antes de
-- pagar. Ela quer esse controle: quanto está guardado, em qual banco e se
-- está rendendo — pra saber o quanto do pedido já está coberto e quanto
-- ainda precisa captar.
--
-- Reserva é em BRL (dinheiro em banco brasileiro); a dívida é em USD. A
-- comparação acontece na camada de cálculo (falta em BRL vs reservado).
--
-- JSONB array em vez de tabela: poucos registros por pedido, sempre lidos
-- junto com o pedido, sem consulta transversal — mesma escolha de colors[].
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reserves jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN orders.reserves IS
  'v13.68 — Caixinhas/reservas em BRL guardadas pra este pedido: [{amount_brl, bank, yields, note}]';
