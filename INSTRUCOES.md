# KIRA v13.50 — Criação inteligente (Fase 1: apoio à decisão)

O criador de pedidos agora **usa seu histórico** pra te ajudar a decidir na hora de montar — sem você abrir outra tela. Tudo calculado dos pedidos que já existem; nada novo pra preencher.

## 🧠 O que apareceu no criador

Ao escolher um modelo na mesa de criação:

1. **Quantidade sugerida por combinação** — quando você toca numa cor, ela já entra com a **média das vezes que você pediu aquele modelo naquela cor**, em vez de um número fixo. Se você mexer na quantidade e quiser voltar, aparece "↩ usar sugerido: N".
2. **"↻ Costuma pedir"** — uma faixa com as cores que aquele modelo mais leva, cada uma com a média (ex.: "+ 2 ~25", "+ 99J ~15"). Um toque adiciona a combinação já com a quantidade certa. É o pedido típico montado em segundos.
3. **Sinal de preço** — chip com a última FOB registrada e a tendência (📈/📉). Se o último preço subiu mais de 15%, fica vermelho com o "% que subiu" — pra você perceber aumento antes de fechar.
4. **Aviso de "já vindo"** — se aquele modelo está num pedido a caminho (Em Revisão / Fabricação / Trânsito), aparece "⏳ já vindo: [pedido] · chega [data]". Evita reencomendar algo que já está chegando.

## 🔗 Como funciona por baixo

Tudo vem de `src/lib/orderIntelligence.js` (funções puras e testadas): média de quantidade, cores por frequência, pedidos em trânsito e sinal de preço (reusa o histórico de preço que já existia). Só leitura do histórico — não muda nada no pedido nem no banco. O payload salvo continua idêntico.

## ✅ Verificações

- 12 testes novos pra `orderIntelligence` (média ignora rascunho, case-insensitive, ranking de cores, pedidos a caminho, sinal de preço)
- Fluxo testado no navegador: sugestão de quantidade, faixa "costuma pedir" (1 toque adiciona com a média), sinal de preço e aviso "já vindo" — todos aparecendo com dados de histórico
- ESLint 0 erros, build OK, 197/198 testes (o 1 que falha é o pré-existente de fuso em `computeMonthlyTrend`)

## 🗓️ Próximas fases (na ordem combinada)

- **Fase 2 — Destravar a reposição por vendas**: preencher os SKUs das variantes e reativar o sync do Shopify, pra o sistema poder sugerir *o que* repor com base em venda e estoque reais (hoje só 3 de 131 variantes têm SKU, e o sync parou em abril).
- **Fase 3 — Assistente de novos produtos/ideias**: nome livre sugerido do banco, pré-preenchimento de specs, detecção de duplicata.

## 📋 Rodadas anteriores (em produção)

- **v13.49** — Reaproveitar pedido anterior + exportar planilha na revisão do criador.
- **v13.48** — Criador visual de pedidos em tela cheia.
- **v13.47** — Planilha da Fábrica (Excel com fotos).
- **v13.46** — Correções de backup/logs/status + backup noturno server-side.
