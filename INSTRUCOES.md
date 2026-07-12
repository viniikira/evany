# KIRA v13.47 — Planilha da Fábrica (Fase 1 do novo criador de pedidos)

## ✨ Nova feature: exportar a planilha da fábrica com um clique

Botão **"📊 Planilha Fábrica"** no detalhe do pedido (ao lado do PDF, visível só pra admin — a planilha contém FOB). Gera um **Excel (.xlsx) com fotos embutidas**, no mesmo formato da planilha do Google Sheets que era montada à mão pra enviar à fábrica:

- **Bloco por modelo**: foto do produto (a foto congelada do pedido), código da fábrica + nome, cap (ex.: 13x4 HD), uma linha por cor com quantidade, "same as sample", FOB, TOTAL PRICE, **PP** (FOB × fator de conversão do pedido) e **BRL** (PP × câmbio orçado; fallback: câmbio atual do app).
- **Total geral** de peças e dólares.
- **Seção COLORS**: banner vermelho + foto real de cada cor usada (do banco de cores). Cor sem foto vira um quadrado sólido com o hex dela.
- Cores com **preço próprio** aparecem com o preço certo (mesma regra do FOB do sistema).
- Nome do arquivo: `FABRICA-nome-do-pedido.xlsx`.

**Detalhes técnicos**: `src/lib/factorySheet.js` (camada pura `buildFactorySheetData` + geração ExcelJS). ExcelJS entra por `import()` dinâmico — o bundle principal não cresce. Fotos são normalizadas pra JPEG via canvas (compatível com .xlsx, arquivo menor). O BRL parte do PP sem arredondar, igual à planilha original (18.50×1.65×5.75 = R$175,52).

## ✅ Verificações

- 11 testes novos pra `buildFactorySheetData` (snapshots, preço por cor, PP/BRL com os valores da planilha real, dedupe de cores, fallbacks)
- 185/186 testes passando (o 1 que falha é o pré-existente de fuso em `computeMonthlyTrend`, anotado pra rodada separada)
- ESLint 0 erros, build OK

## 🗓️ Próxima fase (quando quiser)

**Fase 2 — Criador visual de pedidos**: tela cheia em etapas (fábrica → modelos e cores → revisão), galeria de cores com foto real, combinações modelo+cor lado a lado, totais ao vivo em USD/BRL.

## 📋 Registro da v13.46 (rodada anterior, já aplicada)

Correções aplicadas no código **e no Supabase de produção** em 12/07/2026:
- Backup automático agora inclui `payments`, `color_variants` e `suppliers` (tabelas fantasmas removidas das listas)
- Edge function `daily-backup` **deployada** (nunca tinha sido) e cron `kira-daily-backup` corrigido (rodava com placeholders `YOUR_PROJECT_REF` — nunca funcionou); testado de ponta a ponta: `auto/2026-07-12/dump.json` com 585 KB
- `clean_old_logs` corrigida (mirava tabela inexistente) + trigger de imutabilidade permite só retenção >90d
- CHECK de `orders.status` aceita `in_transit` (banco rejeitava o status da UI)
