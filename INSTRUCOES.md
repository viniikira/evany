# KIRA v13.60 — Pacote de costura (UX): o sistema te LEVA, não só avisa

Rodada sem feature nova — só costuras entre partes que estavam desconexas, a partir de uma auditoria fria da experiência.

## 🧵 As costuras

1. **Avisos agora abrem o item.** O sino 🔔 de pendências e os cards de "Atenções" do Dashboard abriam só a página — você tinha que caçar o pedido na lista. Agora clicar em "pedido X atrasado" abre **o pedido X**, direto no detalhe (mesmo caminho da busca global e dos deep-links).
2. **Salvou o pedido → ele abre.** Depois de salvar na mesa de criação, o detalhe do pedido salvo abre sozinho — exportar a planilha ou mudar o status vira o próximo clique natural, sem reencontrar o card.
3. **"Duplicar" unificado com "Reaproveitar".** Eram dois comportamentos pra mesma ideia: um criava rascunho silencioso no banco, o outro abria a mesa pré-carregada. Agora o 📋 Duplicar **abre a mesa de criação pré-carregada** (fábrica, itens, cores, preços, requeriments) — nada é criado até você salvar. Pagamentos e histórico nunca vêm junto.
4. **Menu agrupado**: 16 itens planos viraram três seções — **Operação** (Ideias→Calculadoras), **Cadastros** (Cores, Nomes, Coleções, Fábricas) e **Administração** (Atividades, Métricas, Backup, Usuários).
5. **Dado velho não finge ser atual**: no modal de Produto, se o cache da Shopify tiver mais de 7 dias, aparece o aviso "dados de N dias atrás — atualize na aba Shopify" junto das sugestões de SKU/estoque.
6. **Cores sem foto ficaram visíveis**: chip "📷 Sem foto (N)" na tela Cores filtra direto as que estragariam a planilha da fábrica.
7. Miudezas: "📄 PDF" virou "📄 PDF interno" (pra não confundir com a planilha da fábrica), ícone do status "Em Revisão" unificado (o criador mostrava 📨, o resto 🔍), e o aviso de "outra aba aberta" ficou explicativo (navegar em várias abas é ok; só evite editar o mesmo item em duas).

## ✅ Verificações

- Duplicar verificado no navegador: abre direto na mesa (etapa 2) como pedido NOVO, itens/qtd/requeriments/preço-snapshot preservados, e o payload salvo **sem id e sem pagamentos** (confirmado no console)
- ESLint 0 erros, build OK, 225/226 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
- Na fila estratégica: **sync automático noturno da Shopify** (mata a raiz do dado velho)
