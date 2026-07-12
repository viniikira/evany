# KIRA v13.53 — Mesa de criação: polimento visual + correções (do feedback de uso)

Rodada guiada pelo feedback real de uso do criador de pedidos: "a parte de quantidades e preço está feia e confusa, o X não fecha, o modo clássico não faz sentido".

## 🐛 Corrigido

1. **O ✕ de fechar não funcionava** — na verdade funcionava, mas a pergunta "Descartar pedido?" abria **atrás** da tela cheia (z-index) e ficava invisível. Agora o diálogo de confirmação abre por cima de qualquer tela (correção global — vale pra todo o sistema).
2. **Tecla ESC** agora também fecha o criador (com a mesma proteção de descarte).
3. **"Modo clássico" removido** — só confundia. A edição de pedidos existentes continua no formulário antigo, isso não muda.

## 🎨 A linha de combinação foi redesenhada

Antes: caixa de preço idêntica à de quantidade (o "12" amarelo parecia outra quantidade ao lado do "13"), placeholder truncado "$ própri", total "—" parecendo um sinal de menos solto.

Agora:
- **Cabeçalho de colunas** (combinação · preço/un · quantidade · total) em cada modelo.
- **Preço com cara de dinheiro**: caixa própria com `$` na frente e `/un` atrás; herda o preço do modelo quando vazia; fica âmbar quando tem preço próprio.
- **Quantidade em stepper único** [− | 25 | +] (passo de 5), sem botões soltos.
- **Total** aparece como "= $184.00" só quando existe; sem tracinho fantasma.

## 🧠 Mais inteligência

- **Preço automático da última FOB**: modelo sem preço cadastrado entra na mesa já com a última FOB do histórico (ex.: ANDIRA entrava com 0.00 mesmo com "última FOB $9.20" na cara — agora entra com $9.20, editável). E se o preço estiver zerado, o chip da FOB vira botão "usar".
- **Galeria de cores enxuta**: em vez das 60+ cores do banco dominando a tela, cada modelo mostra só **as cores dele + as que costuma pedir**; o resto fica atrás de um botão "+N todas". Buscar mostra tudo que casa.
- **Busca de cor por modelo** — antes era um campo compartilhado (digitar num card filtrava todos).

## 🔒 Shopify-proxy (concluído nesta rodada, com o usuário)

- Edge function redeployada: **fechada sem login (401)**, token agora via **secret** (`SHOPIFY_TOKEN`), e **com paginação** (o sync não trava mais em 250 itens). Testada de ponta a ponta (shop.json retornou os dados da loja).
- ⚠️ **Pendência do usuário: revogar o token ANTIGO da Shopify** (ficou hardcoded em versões antigas da função). O sistema já usa o novo.

## ✅ Verificações

- Fluxo completo no navegador: galeria recolhida (+18/todas), preço automático ($9.20 fluiu pros totais), linha nova com cabeçalho, X → confirmação visível → descarta com exatamente 1 fechamento, ESC idem
- ESLint 0 erros, build OK, 210/211 testes (o 1 é o pré-existente de fuso)
