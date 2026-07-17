# KIRA v13.58 — Planilha da fábrica no formato REAL (sem valores) + fix de snapshot

## 📊 A planilha da fábrica ficou igual à sua

Refeita com base na planilha real do Google Sheets:

- **SEM valores.** FOB, TOTAL PRICE, PP e BRL saíram — isso é controle interno seu (continua no Financeiro do sistema). A fábrica recebe só o que precisa.
- **Aviso geral do pedido** no topo: banner amarelo com texto vermelho (ex.: "Our products fiber cant SHINE!..."). Vem do campo "Aviso geral" da revisão do pedido.
- **Requeriments POR MODELO**: campo novo em cada modelo na mesa de criação ("hd lace, same hairline, no baby hair..."), que sai numa caixa larga ao lado das cores do modelo.
- **Cores com foto logo abaixo de CADA modelo** (banner vermelho COLORS + fotos), não mais tudo no fim.
- **Até 2 fotos do modelo lado a lado** (frente/verso, quando o produto tem galeria).
- Total geral só de **peças**.

O campo Requeriments é salvo no pedido (novo no banco) — preencha uma vez e toda exportação sai certa. O aviso geral usa as observações do pedido.

## 🐛 FIX descoberto no caminho: snapshot de preço nunca era gravado

O RPC `replace_order_items` no banco **descartava o `price_usd_snapshot`** desde sempre — o app enviava, o banco ignorava (0 de 67 itens tinham snapshot). Nada quebrava porque o código lê `snapshot ?? price_usd`, mas a garantia "snapshot é sagrado" não existia de fato. Corrigido no RPC + backfill dos 14 itens com preço (`sql/24`, já aplicada em produção).

## ✅ Verificações

- O .xlsx gerado foi **reaberto e inspecionado célula a célula** no teste: banner amarelo na linha 1, cabeçalho MODEL/CAP/COLOR/QUANTITY/Requeriments, requeriments do modelo presente, **zero ocorrência de $/FOB/PP/BRL**, COLORS por modelo, TOTAL=35 peças, 4 imagens embutidas (2 do modelo + 2 de cor)
- Campo Requeriments no criador verificado (pré-carrega na edição, salva no payload)
- 8 testes reescritos pro novo formato; ESLint 0 erros, build OK, 225/226 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção contra senha vazada** no Supabase
