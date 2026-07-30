# KIRA v13.67 — VALOR FINAL da trading (Fase 1 do financeiro de importação)

## 🔴 O erro que existia (e o porquê da planilha)

Todo o financeiro media a dívida contra o **FOB** — mas o que você paga é o **valor final da trading** (FOB + impostos + frete + tudo, multiplicador ~1,5–1,8). Nos seus dados reais o sistema subestimava em **~$33.000** só em dois pedidos. Com a planilha da VALENTINA/CASSANDRA como teste: o certo é faltar **$8.885,63**; o sistema antigo diria **$4.963,43**. Daí ele nunca ter servido pra decidir nada.

## ✅ O que passou a existir

**💵 Valores da trading** — botão novo no detalhe do pedido. Abre uma tela com **todas as linhas** (produto · cor · qtd · FOB) pra você digitar o **valor final por peça** que a importadora mandou:

- **Valor base por produto** que as cores herdam + **override por cor** quando a trading manda diferente (na sua planilha, VALENTINA 1B/2/COPPER = $25,76 e TT2-CARMEL = $27,90 — exatamente esse caso).
- **Multiplicador ao vivo** em cada linha (×1,52, ×1,42…) e o **médio do pedido** (×1,501 no teste).
- **Total da compra** em USD e em BRL, com o câmbio do pedido.
- Contador **"linhas confirmadas 4/4"** — o que ainda não tem valor da trading segue como **estimativa** (FOB × fator) e é marcado como tal. Estimativa nunca se disfarça de número real.
- Atalho opcional: aplicar um fator só nas linhas vazias.

**Painel financeiro do pedido reescrito** — 4 blocos: **FOB (fábrica)** com o fator · **TOTAL DA COMPRA** (o que você deve, USD e BRL) · **PAGO** · **FALTA PAGAR** (USD e BRL), mais barra de quitação, câmbio médio efetivo dos seus pagamentos e aviso quando parte é estimativa.

**Financeiro consolidado**: o card virou **"FALTA PAGAR (TUDO)"** com o valor em USD **e em BRL**, quantos pedidos e quantos ainda estão sem valor da trading. Projeções e análise passaram a usar o valor final automaticamente.

**Pagamentos**: já funcionavam do jeito que você precisa (quantos quiser, data, banco, comprovante, e BRL↔USD pela cotação do dia) — agora eles abatem do **total certo**.

## 🗄️ Banco

`order_items.final_price_usd` (unitário) + `colors[].final_price_usd` (override por cor), espelhando a estrutura que o FOB já tinha. RPC atualizado. Migração `sql/25` aplicada em produção.

## ✅ Verificações

- 10 testes novos com os números reais da sua planilha (final por cor sobrescreve o do item; total = soma(final × qtd); multiplicador; pedido misto confirmado/estimado; **"pagar só o FOB não quita"**; consolidado com crítico primeiro)
- Testado no navegador com VALENTINA + CASSANDRA: FOB $7.823,40 · total final $11.745,60 · ×1,501 · 460 peças · falta **$8.885,63 ≈ R$ 46.916** · câmbio médio efetivo 5,28 — tudo conferido na mão
- 3 testes antigos que codificavam o comportamento errado foram reescritos (documentando a mudança de semântica)
- ESLint 0 erros, build OK, 246/247 testes (o 1 é o pré-existente de fuso)

## 🗓️ Próximas fases (já decididas com a dona)

- **Fase 2**: caixinha/reserva **por pedido** (quanto já está guardado, em qual banco, rendendo) + % coberto
- **Fase 3**: painel consolidado inteligente — quanto devo no total vs quanto tenho reservado, timeline de vencimentos, alertas

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
