# KIRA v13.56 — Deep-links: pedido e produto com URL própria

## 🔗 O que mudou

Fase 2 das URLs (v13.55 deu endereço às telas; agora os **itens** também têm):

- **Abrir o detalhe de um pedido** muda a URL pra `#/pedidos/novembro-2025` — dá pra favoritar, mandar no WhatsApp, apertar F5 e voltar exatamente naquele pedido.
- **Produtos idem**: `#/produtos/lara` abre o detalhe da LARA direto.
- **Formatos aceitos** no link: o nome (slug: minúsculas, sem acento, hífens), o id completo, ou um prefixo do id (≥8 caracteres). Se dois pedidos tiverem o mesmo nome, a URL usa o prefixo do id pra não ter ambiguidade.
- **Fechar o detalhe** volta a URL pra `#/pedidos` / `#/produtos`. Link quebrado (item apagado) cai na lista, sem erro.
- **Busca global (Ctrl+K)** agora abre o **produto** direto no detalhe (antes só navegava pra tela; pedidos já faziam isso).
- Deep-link **sobrevive ao login**: quem abre `#/pedidos/novembro-2025` deslogado, loga e cai direto no pedido.

## 🔧 Técnica

- `router.js`: `entitySegmentForHash`, `hashForEntity`, `slugifyName`, `matchesEntity` (4 testes novos; 12 no router).
- Reutiliza o mecanismo `initialDetailId`/`onDetailOpened` que a Visão Financeira já usava pra abrir pedido — agora com matching por nome/prefixo e espelhado em Produtos.
- O sync página→URL preserva o segmento do item no carregamento (senão o deep-link seria apagado antes de o dado carregar).

## ✅ Verificações

- App real: `#/pedidos/novembro-2025` sobrevive ao carregamento (não é normalizado pra `#/pedidos`), troca pra `#/produtos/lara` aceita, tela de login intacta, zero erros de console
- ESLint 0 erros, build OK, 222/223 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** (o novo, via secret, já está em uso)
- Ativar **proteção contra senha vazada** no Supabase (Authentication → Policies)
