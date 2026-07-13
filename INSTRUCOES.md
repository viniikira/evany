# KIRA v13.57 — SKU integrado com a Shopify (sugere o real, valida o digitado)

## 🛒 O que mudou

O ✨ da v13.52 sugeria o SKU **pela convenção** (`DEUSA2`) — mas algumas linhas da loja usam outro código (Afro Puff = `CHEREY6`). Agora, no modal de Produto, cada variante de cor conversa com o **catálogo real da Shopify** (o cache da última sincronização):

1. **Variante sem SKU** → além do ✨ da convenção, aparecem chips **"🛒 na Shopify:"** com os SKUs **reais** de produtos da loja cujo título casa com o nome — ranqueados pela cor (o `CHEREY1B` aparece primeiro pra cor 1B). Um clique preenche.
2. **SKU preenchido e correto** → linha verde **"🛒 vinculado: [título da loja] · N un"** — você vê na hora o produto da Shopify e o estoque atual.
3. **SKU preenchido mas inexistente na loja** → aviso âmbar **"⚠️ SKU não encontrado na Shopify"** — pega erro de digitação antes de virar vínculo morto.

É a ponte que faltava pro caso "a convenção não bate": em vez de adivinhar, o sistema **mostra o que existe na loja** e você escolhe. Cada vínculo certo alimenta a reposição por vendas.

Nota: as sugestões vêm do **cache** da Shopify (última sincronização). Sincronizar na aba Shopify deixa tudo fresco — e com a paginação corrigida (v13.53), o sync agora pega a loja inteira.

## 🔧 Técnica

- `creationAssist.js`: `buildShopifyIndex` (achata o cache), `suggestShopifyLinks` (match por nome normalizado + ranking por cor), `findShopifyBySku` (validação case-insensitive). 6 testes novos (19 no arquivo).
- `ProductModal` recebe `shopifyCache` (já disponível na página); índice memoizado.

## ✅ Verificações

- Testado no navegador com os 3 estados: sugestões reais rankeadas (CHEREY1B primeiro pra cor 1B), aviso pra SKU errado, vinculado com título+estoque; clique na sugestão preenche e vira "vinculado"
- ESLint 0 erros, build OK, 228/229 testes (o 1 é o pré-existente de fuso)

## 🔒 Segurança (status em 13/07/2026)

Diagnóstico do Supabase re-rodado: **0 erros**. Restam só avisos deixados de propósito (funções-base da RLS, políticas de categorias de cor que a equipe gerencia, listagem do bucket público de fotos, pg_net onde o cron precisa). Pendências do usuário: revogar o **token antigo da Shopify** e ativar **proteção contra senha vazada** (Authentication → Policies).
