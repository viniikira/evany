# KIRA v13.49 — Criador de pedidos: reaproveitar e exportar

Dois complementos ao criador visual (v13.48), fechando o fluxo que mostrei no mockup.

## ♻️ Reaproveitar um pedido anterior

Na primeira etapa do "+ Novo Pedido", abaixo das fábricas, aparece **"Ou reaproveite um pedido recente"** com seus últimos 6 pedidos. Clicar em um deles **copia todos os modelos, cores, quantidades e preços** pra um rascunho novo e já pula pra mesa de criação — aí é só ajustar quantidades e salvar. Feito pro reorder: reencomendar a mesma coisa da mesma fábrica vira 2 cliques.

(Os preços próprios de cada cor são preservados. O pedido original não é tocado — é sempre um rascunho novo.)

## 📊 Exportar a planilha da fábrica direto da revisão

Na etapa de revisão, ao lado de "Salvar pedido", agora tem **"📊 Planilha da fábrica"** (só admin). Gera o mesmo Excel com fotos da v13.47, **antes mesmo de salvar** — útil pra conferir ou já mandar pro WeChat enquanto monta. Funciona tanto pra produtos quanto pra ideias (a ideia entra na planilha com nome/foto certos).

## ✅ Verificações

- Fluxo testado no navegador: reaproveitar pré-carregou o pedido certo (modelos, cores e preços próprios), e a exportação gerou o `.xlsx` válido sem erros
- ESLint 0 erros, build OK, 185/186 testes (o 1 que falha é o pré-existente de fuso em `computeMonthlyTrend`)

## 🎨 Sobre o mutirão de fotos do banco de cores

Levantei o estado real: das **61 cores** cadastradas, **49 já têm foto** (80%). Das 12 sem foto, **só 4 são usadas em algum produto** — então a galeria do criador já está bem servida. As 4 que valem a pena fotografar (por serem usadas): **M6/30, P4/30, P1B/30 e GREY**. As outras 8 sem foto não estão em nenhum produto, então não aparecem na galeria de nenhum modelo.

## 📋 Rodadas anteriores (já em produção)

- **v13.48** — Criador visual de pedidos em tela cheia (fábrica → modelos e cores → revisão), galeria de modelos e cores com foto, combinações modelo+cor lado a lado, totais ao vivo.
- **v13.47** — Planilha da Fábrica: exporta Excel com fotos no formato enviado à fábrica.
- **v13.46** — Correções: backup passou a incluir pagamentos; backup noturno server-side ativado; retenção de logs e status "Em Trânsito" corrigidos.
