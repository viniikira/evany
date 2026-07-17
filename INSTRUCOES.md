# KIRA v13.61 — Produção: mega revisão (peças em primeiro lugar)

Do feedback: "não dá pra saber quantas peças estão em produção, atrelado a qual produto; espaço mal utilizado; não está lógico".

## 🏭 O que mudou

**A pergunta nº1 agora tem resposta em todo nível:**
- **KPIs no topo**: peças em produção · produtos · cores (com ⚠ das sem pedido) · peças em trânsito · próxima chegada.
- **Por produto**: o total de peças aparece grande ao lado do nome ("ALICE — 70 pç").
- **Por cor**: cada cor virou uma pill `[foto] 2 ×50` com a quantidade somada dos pedidos ativos. Cor em produção **sem pedido** ganha pill destacada "sem pedido".
- **Por fábrica**: o cabeçalho do grupo mostra "480 peças · 10 produtos · 19 cores".
- As **abas** contam peças ("Em produção 105 pç · Em trânsito 40 pç"), não mais cores.

**Vínculo com pedidos (o "atrelado a qual" que faltava):**
- Cada produto mostra chips dos **pedidos ativos** que o contêm: "📋 Novembro 2025 · chega 10/08" ou "📋 … · **atrasado 47d**" — e o chip **abre o pedido** (mesma infra dos deep-links).
- Na aba Trânsito, o nome do pedido é clicável e ganhou badge "**chega em Nd**" (âmbar ≤7d, vermelho se a previsão já passou).

**Espaço bem usado:**
- Foto do produto encolheu de 160px pra 96px (era arte de marketing dominando o card) — os cards ficaram ~metade da altura, com o dobro de informação.
- Ordenação padrão nova: **Mais peças** (o que é grande aparece primeiro).
- Matching de cor ↔ pedido agora é **case-insensitive** (antes "r4/33/27" no pedido não casava com "R4/33/27" do produto e a quantidade sumia).

## ✅ Verificações

- Testado no navegador com dados realistas: KPIs corretos (105 pç = 50+20+35), matching case-insensitive somando certo, cor presa marcada (1⚠), chip de pedido com "atrasado 47d" exato (107 corridos − 60 prometidos) e clique abrindo o pedido, trânsito com "chega em 3d"
- ESLint 0 erros, build OK, 225/226 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
- Fila estratégica: **sync automático noturno da Shopify** · conferência de recebimento
