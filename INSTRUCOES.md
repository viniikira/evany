# KIRA v13.65 — SKUs PUXADOS da Shopify (não mais sugeridos)

Do feedback: "esses SKU deveriam puxar direto do Shopify e não sugerir".

## 🛒 O que mudou

A lógica invertida — a loja é a fonte da verdade:

1. **Ao escolher a cor** de uma variante, o sistema tenta **puxar o SKU real** do cache da Shopify. Achou com confiança → preenche verificado (linha verde "vinculado" na hora). Não achou → deixa vazio (nada de chute).
2. **Botão "🛒 Puxar SKUs da Shopify"** no cabeçalho das variantes: preenche **todos os SKUs vazios de uma vez** com os SKUs reais, e avisa o placar ("9 puxados · 2 sem correspondência").
3. A **convenção (✨)** virou só fallback manual — pra produto que ainda não está na loja.

**Regra de confiança** (nada é inventado):
- 1º: a convenção NOME+COR **existe na loja**? → é ela (verificada).
- 2º: entre os produtos da loja cujo título contém o nome, **exatamente um** tem SKU terminando na cor? → é ele (pega os casos fora da convenção, tipo `CHEREY6`).
- Ambíguo ou ausente → fica vazio, com os chips de sugestão de sempre pra você decidir.

**Importante**: a fonte é o **cache** da Shopify. Se os produtos são recentes e o cache é de abril, o puxar não vai achá-los — o botão avisa e a solução é o **Sync** na aba Shopify (ou, de vez, o sync automático noturno que segue na fila).

## ✅ Verificações

- 4 testes novos pro `resolveShopifySku` (convenção existente vence; título+cor único acha SKU fora da convenção; ambíguo não chuta; ausente → null)
- Testado no navegador com os 4 casos: `LARA2` puxado (convenção), `XLARA-SEIS6` puxado (fora da convenção, via título), 99J ambígua ficou vazia, 912 inexistente ficou vazia; 2 linhas "vinculado" verdes na hora
- ESLint 0 erros, build OK, 229/230 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
- Fila estratégica: **sync automático noturno da Shopify** (faria o "puxar SKUs" enxergar a loja inteira sempre) · conferência de recebimento
