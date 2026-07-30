# KIRA v13.69 — Shopify sincroniza sozinha + quitar pedido

## 🌙 Sync automático da Shopify (a dívida mais antiga da fila)

Uma edge function agora sincroniza a loja **toda noite às 00:30**, sem clique. Isso conserta a raiz de vários problemas: sugestão e "puxar SKU" liam dados de abril, o estoque no panorama da Produção estava velho, e a reposição por vendas dependia de você lembrar de sincronizar.

**Descoberta no caminho**: a loja tem **737 produtos**, não 250 — o cache antigo estava truncado numa página só (a paginação nunca tinha funcionado até a v13.53).

**Arquitetura** (definida testando de verdade contra a sua loja):
- **Produtos: sempre completos** (737, 3 páginas, ~10s) — é o que alimenta estoque e SKU. Salvos primeiro, de forma independente.
- **Pedidos: incremental** — buscar os 4.500+ pedidos de 6 meses estoura o limite de 150s da edge function (testei: estourou). Então cada noite pega só os criados desde a última sincronização, com 2 dias de margem, e faz merge preservando o histórico da janela de 6 meses. Resultado real: **2,5 segundos**, 65 pedidos novos, 4.533 no total.
- O **Sync completo** manual continua na aba Shopify (o navegador não tem limite de 150s) — pra reconstruir tudo quando quiser.
- Se algo falhar, o erro fica registrado e aparece na tela.

Na aba Shopify agora tem a **prova de vida**: "🌙 última sincronização há 2h (automática) · 737 produtos · 4.533 pedidos · roda sozinho todo dia 00:30". Fica âmbar se passar de 48h e vermelho se a última tentativa falhou.

## ✓ Quitar pedido (pedido antigo já pago)

Botão **"✓ Marcar como pago"** no painel de pagamentos. Pra pedidos antigos que você já pagou integralmente fora do sistema — sem precisar lançar cada pagamento retroativo.

- O pedido **sai do saldo em aberto** e do consolidado de Importações (para de contar como dívida).
- Nada é apagado: os pagamentos que já estavam registrados continuam lá, e o valor da compra segue no histórico.
- Ganha um selo verde "Pago integralmente" com a data.
- **Reversível**: "↩ Reabrir cobrança" volta a contar (com confirmação).
- Fica registrado no log de atividades quem marcou e qual era o saldo na hora.

## ✅ Verificações

- Sync testado contra a loja real: 401 sem login; execução via cron (`source: cron`) em **2.572ms** com ok=true, 737 produtos e 4.533 pedidos em 145 kB de cache; cron `kira-shopify-sync` agendado e confirmado na lista
- 6 testes novos de quitação (zera saldo, marca 100%, sai do consolidado, preserva pagamentos parciais, reabrir volta a cobrar) — 257/258 no total (o 1 é o pré-existente de fuso)
- ESLint 0 erros, build OK · migração `sql/27` aplicada em produção

## 📋 Pendências do usuário

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
- Fila: conferência de recebimento · faxina técnica (teste de fuso, assistente no Produto, bundle split) · passada mobile
