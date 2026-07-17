# KIRA v13.62 — HIDE MODE + custo estimado no Brasil (fator × dólar)

Duas features do uso real na mesa de criação de pedidos.

## 🙈 HIDE MODE (modo discrição)

Botão **🙈** no topo do criador de pedidos. Um clique e **todos os valores somem da tela**: preço base do modelo, preço por cor, coluna preço/un, totais por linha, FOB, estimativa em reais, chip de "última FOB" e o fator/dólar. Fica um selo âmbar **"🙈 valores ocultos"** — clicar nele traz tudo de volta.

Pra quê: criar pedido, escolher modelos e cores **com uma funcionária do lado** sem expor custo nenhum. O estado persiste (recarregar a página não revela os valores) e a exportação da planilha da fábrica continua disponível (ela não tem preços desde a v13.58).

## 💵 Fator de conversão × dólar (custo estimado no Brasil)

No topo do criador (modo normal): **`fator × [1,65] · US$ [5,50]`** — os dois editáveis.

- **Fator** (~1,50–1,80): o multiplicador da importação que dá a "ideia" do custo final da peça.
- **Dólar**: sugerido a partir da cotação ao vivo **arredondada pra cima** (5,43 → sugestão 5,50), mas você trava no valor que quiser.
- O rodapé mostra **"≈ R$ X no Brasil"** = FOB × fator × dólar (tooltip com a conta aberta), e **cada combinação** mostra o custo estimado por peça ("≈ R$ 168/un").
- Os dois valores são **salvos no pedido** (colunas `conversion_factor` e `budget_rate`, que já existiam no banco e nunca tinham sido expostas na criação) e **lembrados** pro próximo pedido.

## ✅ Verificações

- Testado no navegador: estimativa exata (FOB $185 × 1,65 × 5,50 = R$ 1.679 ✓, R$ 168/un ✓), dólar sugerido 5,50 a partir de 5,43 ✓; HIDE MODE zera **todos** os cifrões da tela, o selo permite desocultar, e o payload salvo leva fator/dólar
- Bug pego na própria verificação: o botão de desocultar sumia junto com os valores (gate errado) — corrigido antes de publicar
- ESLint 0 erros, build OK, 225/226 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
- Fila estratégica: **sync automático noturno da Shopify** · conferência de recebimento
