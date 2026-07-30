# KIRA v13.68 — Caixinhas por pedido + painel "quanto devo em tudo"

Fases 2 e 3 do financeiro de importação (a Fase 1 — valor final da trading — saiu na v13.67).

## 🏦 Caixinhas (Fase 2)

No painel financeiro de cada pedido, seção **"🏦 Já guardado pra este pedido"**:

- **+ Caixinha**: valor em R$, banco/onde está e se está **rendendo** (marcável depois com um clique: 📈 rendendo ⇄ 💤 parado).
- Quantas quiser por pedido (ex.: R$ 30.000 no Itaú + R$ 20.000 na Cora).
- Mostra na hora: **"Cobre 64% do que falta (R$ 46.916) · faltam captar R$ 16.916"**, barra de cobertura, e quanto do guardado está rendendo. Quando cobre tudo: **"✓ O que falta já está todo guardado"**.

A reserva é em reais (é dinheiro no banco) e a dívida em dólar — a comparação usa o câmbio do pedido (orçado, ou o médio efetivo dos seus pagamentos).

## 🚢 Aba "Importações" (Fase 3)

Nova aba no Financeiro, com **o compromisso total** em cima:

- **FALTA PAGAR EM TODOS OS PEDIDOS** em USD **e** em BRL, com total comprado, já pago e quantos pedidos.
- Aviso de quanto desse valor ainda é **estimativa** (pedidos sem os valores da trading) vs **confirmado**.
- **JÁ GUARDADO (CAIXINHAS)** · **COBERTURA %** · **PRECISO CAPTAR** — a resposta pra "tenho o dinheiro ou preciso correr?".
- **Pedido por pedido**: falta em USD/BRL, total, % pago, fator, caixinha e cobertura, chegada prevista, 🚨 nos concluídos sem quitar — cada linha abre o pedido.
- Barra dupla por pedido: verde = pago · azul = guardado em caixinha · cinza = a captar.

Atalho novo na Visão Geral: **"Quanto devo em tudo"**.

## ✅ Verificações

- 6 testes novos de reservas (soma só valores válidos, cobertura, cap em 100%, separa rendendo de parado, sem reservas não quebra, consolidado devo × guardado × captar) — 252/253 no total (o 1 é o pré-existente de fuso)
- Testado no navegador com o pedido real: falta R$ 46.916 → caixinha de R$ 30.000 no Itaú deu **64% de cobertura e R$ 16.916 a captar**; toggle rendendo→parado zerou o "rendendo" mantendo o reservado; segunda caixinha de R$ 20.000 levou a **100% coberto**
- ESLint 0 erros, build OK · migração `sql/26` aplicada em produção

## 🗄️ Banco

`orders.reserves` JSONB — `[{amount_brl, bank, yields, note}]`, sanitizado na gravação (só valor positivo entra).

## 📋 Pendências do usuário

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
