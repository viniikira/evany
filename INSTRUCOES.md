# KIRA v13.54 — Editar pedido também na mesa de criação

## ✏️ Editar agora abre a tela nova

Clicar em **Editar** num pedido abria o formulário antigo e apertado — incoerente com a mesa de criação. Agora **criação E edição usam a mesma tela cheia**:

- Editar abre **direto na etapa 2** (mesa de criação), com título "✏️ [nome do pedido]" e o chip do status atual.
- Todos os itens entram **pré-carregados**: cores, quantidades, preços (inclusive preço próprio por cor, destacado em âmbar).
- **Itens órfãos** (produto deletado/convertido, pedidos antigos) aparecem pelo snapshot congelado — nome, código e foto da época.
- A etapa de revisão mostra **todos os status** na edição (não só Rascunho/Em Revisão) e o botão vira "Salvar alterações".
- Fechar sem salvar pergunta "Sair sem salvar?" — o pedido continua como estava.
- O aviso "⏳ já vindo" **não acusa o próprio pedido** que está sendo editado.
- Campos que o formulário não mostra (pagamentos, histórico de status, câmbio orçado, datas internas) são **preservados intactos** no save — mesmo contrato do modal antigo.

**O OrderModal clássico saiu de cena** no fluxo de pedidos (arquivo mantido no repo por segurança, sem uso). Toda a lógica de negócio do save continua a mesma em Orders.jsx (conversão de ideias, snapshots, inteligência de fábrica).

## ✅ Verificações

- Modo edição testado no navegador com um pedido real simulado: 2 itens (um com preço por cor, um órfão só-snapshot), abriu na etapa 2 com tudo pré-carregado, FOB $1.550 correto, revisão com os 5 status e datas/prazo/notas do pedido, save retornou o payload com `id` e pagamentos preservados
- ESLint 0 erros, build OK, 210/211 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** (o novo, via secret, já está em uso)
- Ativar **proteção contra senha vazada** no Supabase (Authentication → Policies)
