# KIRA v13.51 — Criação inteligente de ideias (Fase 3)

Criar uma **Nova Ideia** ficou mais esperto — três ajudas no próprio formulário:

## ✨ O que apareceu na Nova Ideia

1. **🎲 Sugerir nome livre** — botão ao lado do campo Nome. Um toque pega um nome **ainda não usado** do seu banco de nomes (ignora os que já viraram produto ou ideia). Clicou de novo, sorteia outro. O contador mostra quantos nomes livres ainda tem.
2. **Detecção de duplicata** — se você digitar um nome que **já existe** (produto ou ideia), aparece um aviso vermelho na hora e o botão Salvar trava até você trocar. Evita o conflito que dava dor de cabeça na conversão ideia→produto.
3. **✨ Basear specs em** — um seletor pra **copiar a "receita técnica"** de um modelo parecido (acabamento, repartição, material, tipo de fio, comprimento, coleção e fábrica). Só as características — nunca o nome, foto ou cores. Pra quando você faz "outra igual a LARA, só que com outro nome/cor".

## 🔗 Como funciona por baixo

`src/lib/creationAssist.js` (funções puras e testadas): nomes livres, conflito de nome e template de specs. Só leitura/cópia — não muda nada no banco. Integrado ao formulário de ideia (o de produto geralmente vem da conversão de ideia, então herda tudo).

## ✅ Verificações

- 10 testes novos pra `creationAssist` (nomes livres case-insensitive, conflito produto/ideia, ignora o próprio em edição, template não vaza nome/foto/cores)
- Fluxo testado no navegador: sugerir nome (pegou um livre), basear specs (copiou acabamento/material/fio/comprimento/coleção/fábrica sem tocar no nome) e duplicata (aviso + Salvar travado)
- ESLint 0 erros, build OK, 207/208 testes (o 1 que falha é o pré-existente de fuso em `computeMonthlyTrend`)

## 🗓️ Situação das fases

- **Fase 1 (v13.50)** ✅ — apoio à decisão no criador de pedidos (quantidade sugerida, cores usuais, sinal de preço, aviso "já vindo").
- **Fase 3 (v13.51)** ✅ — assistente de criação de ideias (esta rodada).
- **Fase 2 — reposição por vendas**: adiada de propósito. Depende de linkar SKUs internos↔Shopify (só 3 de 131 têm SKU) e de re-sincronizar o Shopify (parado desde abril). Como quase todo o catálogo ainda está em desenvolvimento, o payload é pequeno hoje — vale fazer quando mais produtos estiverem em catálogo/venda.

## 📋 Rodadas anteriores (em produção)

- **v13.49** — Reaproveitar pedido + exportar planilha na revisão do criador.
- **v13.48** — Criador visual de pedidos em tela cheia.
- **v13.47** — Planilha da Fábrica (Excel com fotos).
- **v13.46** — Correções de backup/logs/status + backup noturno server-side.
