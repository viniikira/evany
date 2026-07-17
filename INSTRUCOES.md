# KIRA v13.59 — Planilha da fábrica: layout consertado (fotos, textos, separadores)

Correções a partir do teste real da usuária no Google Sheets (fotos "bugadas", textos grandes estourando, blocos grudados).

## 🖼️ O que mudou

1. **Fotos nunca mais distorcem.** Antes a imagem era ancorada pra "preencher a célula" — o Google Sheets estica/espreme isso. Agora toda foto entra em **tamanho fixo proporcional** (calculado da dimensão real da imagem). Foto alta sai alta, quadrada sai quadrada — em Excel E no Google Sheets.
2. **Grade de 16 colunas uniformes + mesclagens** — o jeito que a sua planilha original é construída. Nome de cor grande ("#24B18S8 SHADED MOCHA", "BALAYAGE ASH BLONDE") tem ~213px de célula mesclada com quebra de linha, não estoura mais.
3. **Faixa ROSA separando cada modelo** (como na original) + **cabeçalho repetido em cada bloco** (PHOTO | MODEL | CAP | COLOR | QUANTITY | Requeriments) — a fábrica entende cada seção sem adivinhar.
4. Rótulos das cores em células duplas (~142px) com quebra; fotos das cores em caixas de 142×133px, 8 por linha.

## ✅ Verificações

- xlsx gerado e **reaberto com ExcelJS**: proporções conferidas imagem a imagem (foto-teste 120×400 saiu 38×126 — mesma razão, sem esticar; quadrada saiu 126×126), 2 faixas magenta (1 por modelo), cabeçalho nos 2 blocos, nomes grandes presentes, requeriments e aviso no lugar, 9 imagens, 39 mesclagens
- ESLint 0 erros, build OK, 225/226 testes (o 1 é o pré-existente de fuso; a camada pura da planilha não mudou)

## 📋 Rodadas anteriores (em produção)

- **v13.58** — formato sem valores + requeriments por modelo + aviso geral + COLORS por modelo + fix do snapshot de preço (sql/24).
- Pendências do usuário: revogar token antigo da Shopify · ativar proteção de senha vazada no Supabase.
