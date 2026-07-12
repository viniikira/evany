-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION v13.21 — status_history em pedidos (timeline visual)
-- ═══════════════════════════════════════════════════════════════════
-- Adiciona coluna jsonb que registra cada mudança de status com timestamp.
-- Estrutura: [{ status: 'sent', at: '2026-01-15T10:30:00Z', user_name: 'Kira' }, ...]
--
-- Pra pedidos legados (sem essa coluna), o frontend infere do que tem:
-- - created_at sempre disponível → marco "Criado"
-- - manufacturing_started_at (v13.16+) → marco "Em Fabricação"
-- - Outros marcos: "data desconhecida" mas mostra o status
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::jsonb;
