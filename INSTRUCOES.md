# KIRA v13.66 — FIX: Sync da Shopify morria no fim ("Failed to fetch")

## 🐛 O que aconteceu

O Sync **funcionou** — buscou os produtos e chegou a 4.535 pedidos (página 19+) — e morreu **na hora de salvar**. Causa: com a paginação corrigida (v13.53), o sync passou a trazer o volume real da loja, e cada pedido/variante vem da API com **dezenas de campos** que o sistema nunca usa. O payload de vários MB estourava a gravação no Supabase e o sync perdia TUDO no último passo.

## ✅ O conserto (3 camadas)

1. **Slim antes de salvar**: o cache agora guarda só o que o sistema lê — produtos: `title + sku/estoque/preço` das variantes; pedidos: `data + sku/qtd/preço` dos itens. Payload de 4.500 pedidos: de dezenas de MB pra ~1 MB (testado).
2. **Salvamento em duas etapas**: os **produtos são salvos assim que chegam** — se a fase de pedidos falhar por qualquer motivo, estoque/SKUs ficam garantidos e os pedidos antigos do cache são preservados (não zera nada).
3. **Erro que explica**: no lugar do "TypeError: Failed to fetch" seco, a mensagem diz o que houve e que os produtos já salvos foram mantidos.

O slim fica **dentro** do gravador (`setShopifyCache`) — qualquer caminho futuro que salvar o cache já sai magro.

## ▶️ O que fazer agora

Ctrl+Shift+R → aba Shopify → **Sync** de novo. Deve completar; você verá "produtos salvos ✓" no meio do caminho e o total no fim. Aí: **🛒 Puxar SKUs da Shopify** nos produtos (v13.65) passa a enxergar a loja inteira e atual.

## ✅ Verificações

- 6 testes novos pro slim (mantém exatamente os campos usados, corta >5× no produto gordo real, 4.500 pedidos < 1,5MB, nulos não quebram)
- ESLint 0 erros, build OK, 235/236 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
- Fila estratégica: **sync automático noturno** (com o slim, ficou viável até pra edge function) · conferência de recebimento
