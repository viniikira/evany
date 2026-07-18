# KIRA v13.64 — Produção: swatches legíveis + PANORAMA do produto

Do feedback: "as cores estão ruins, difícil de ver; deveria dar um panorama geral e inteligente de cada produto quando clicar nele".

## 🎨 Cores finalmente visíveis

Os pontinhos de 20px viraram **swatches de 52px** nos cards: foto da cor grande, quantidade sobreposta (×80) e código embaixo. Cor presa (sem pedido) ganha anel dourado + badge **!**. Clicar no swatch amplia a foto.

## 📊 Panorama do produto (clique no card)

Clicar em qualquer produto da Produção abre o **panorama** — tudo que você quer saber, num lugar:

- **Agora**: total de peças em produção, grande.
- **Pedidos ativos com o modelo**: nome (clicável → abre o pedido), status, peças, **barra de prazo** (verde → âmbar → vermelha se estourou), dias corridos vs prometido, atraso, chegada prevista — e **FOB + "≈ R$ X chegando"** usando o fator × dólar **salvos naquele pedido** (v13.62 fechando o ciclo).
- **Cores em produção**: swatches de 74px com nome em português, quantidade, e as presas destacadas.
- **Histórico do modelo**: quantas peças você já pediu na vida, em quantos pedidos, quando foi o último — e o sinal de preço (última FOB, tendência, alerta de aumento).
- **🛒 Na loja** (se as cores têm SKU vinculado): estoque atual + vendidas em 6 meses, com aviso de idade do cache ("dados de 85d atrás — sincronize").
- **"Costuma pedir"**: as cores usuais do modelo com médias.

É o raio-X que responde "produzo mais ou já chega?" sem abrir cinco telas.

## ✅ Verificações

- Testado no navegador com cenário completo: 130 pç (80+50, case-insensitive), histórico 170 pç/2 pedidos, loja 7 estoque/12 vendidas + aviso de 85d, FOB $1.300 · ≈ R$ 11.798 chegando (fator/dólar do pedido, conta exata), 139 corridos/prazo 60/atrasado 79d com barra vermelha, GREY presa com !, clique abrindo o pedido
- ESLint 0 erros, build OK, 225/226 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
- Fila estratégica: **sync automático noturno da Shopify** (deixaria o bloco "Na loja" do panorama sempre fresco) · conferência de recebimento
