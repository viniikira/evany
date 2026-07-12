# KIRA v13.46 — Correções cirúrgicas (backup, logs, status)

**Esta rodada não tem features novas.** São três correções de bugs latentes encontrados em auditoria completa do código + banco de produção.

## ⚠️ ORDEM DE APLICAÇÃO

1. **Primeiro o banco**: rodar `sql/22_correcoes_status_logs.sql` no SQL Editor do Supabase.
2. **Depois o código**: push pro GitHub (Railway faz deploy sozinho).

Se o código subir antes do SQL, nada quebra — mas a limpeza de logs continua sem funcionar e "Em Trânsito" continua sendo rejeitado até o SQL rodar.

## 🐛 1. Backup não incluía pagamentos (CRÍTICO)

O backup automático (client-side `src/lib/backup.js` e edge function `daily-backup`) listava tabelas que **nunca existiram** no schema relacional: `order_item_colors`, `order_payments`, `order_status_history` (resquício de um design antigo — cores e histórico de status são colunas JSONB; pagamentos ficam na tabela `payments`).

**Consequência real**: `payments` (todos os pagamentos e comprovantes), `color_variants` e `suppliers` estavam **fora de todos os backups automáticos**. O export manual da aba Backup sempre esteve correto.

**Corrigido**: as duas listas agora usam as tabelas reais. A edge function ainda inclui `profiles`, `activity_logs` e `user_favorites` (roda com service role, dump completo).

**Descoberto na auditoria**: a edge function `daily-backup` **nunca foi deployada** no Supabase (só existe a `shopify-proxy`). O backup server-side nunca rodou — só o client-side. Deploy pendente de decisão.

## 🐛 2. Limpeza de logs nunca funcionou

`cleanOldLogs` (client) e `clean_old_logs` (SQL, `sql/08`) deletavam da tabela `logs` — que não existe. A tabela real é `activity_logs`. E mesmo com o nome certo, o delete seria barrado: RLS não tem policy de DELETE e o trigger de imutabilidade (`sql/17`) proíbe qualquer DELETE.

**Corrigido** (em `sql/22`):
- `clean_old_logs` agora mira `activity_logs`, roda como `SECURITY DEFINER` e tem **clamp de 90 dias** (impossível usar pra apagar logs recentes).
- O trigger de imutabilidade ganhou uma única exceção: DELETE de logs com **mais de 90 dias** (retenção). UPDATE continua proibido sempre.
- `src/lib/data/misc.js` chama a RPC em vez de delete direto (mesmo padrão do `purgeOldTrash`).

A intenção original das duas features fica preservada: auditoria intocável dentro da janela de 90 dias, retenção funcionando fora dela.

## 🐛 3. "Em Trânsito" era rejeitado pelo banco

O CHECK de `orders.status` (`sql/01`) só permitia `draft/sent/manufacturing/completed`. A UI oferece `in_transit` desde a v13.x, mas o Postgres rejeitava a transição — confirmado em produção: **0 pedidos em trânsito** (nenhum conseguiu ser salvo).

**Corrigido** (em `sql/22`): CHECK recriado incluindo `in_transit`.

## ✅ Verificações aplicadas

- ESLint 0 erros
- Build compila
- 174/175 testes passando — o 1 que falha (`computeMonthlyTrend > ordena cronologicamente`) é **pré-existente e não relacionado**: sensibilidade a fuso horário no próprio teste (datas UTC meia-noite recuam um mês em UTC-3). Anotado pra correção separada.

## 📋 Pendências desta rodada

- [ ] Rodar `sql/22_correcoes_status_logs.sql` no Supabase (produção)
- [ ] Decidir deploy da edge function `daily-backup` + agendamento pg_cron (`sql/16` tem placeholders nunca preenchidos)
- [ ] Corrigir teste de fuso em `financial.test.js` (rodada separada)
