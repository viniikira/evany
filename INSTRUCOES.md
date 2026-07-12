# KIRA v13.52 — Auto-SKU + hardening de segurança

Duas frentes nesta rodada: uma melhoria de criação que **começa a destravar a Fase 2 sozinha**, e o endurecimento de segurança do banco.

## ✨ Auto-SKU ao adicionar cor (criação)

No modal de **Produto**, na seção de Variantes de Cor:
- Ao **escolher o código da cor**, o sistema já preenche o **SKU** pela sua convenção (`NOMEDOPRODUTO+COR`, ex.: Valentina + 1B → `VALENTINA1B`). Só preenche se o SKU estiver vazio — nunca sobrescreve o que você digitou.
- Nas variantes antigas que têm cor mas **sem SKU**, aparece um botão **✨ com o SKU sugerido** — um toque preenche.

Por que isso importa: o SKU é o que **vincula o produto com a Shopify** (vendas e estoque). Hoje só 3 de 131 variantes têm SKU. Preenchendo naturalmente conforme você trabalha, isso vai **destravando a reposição por vendas (Fase 2)** sem mutirão. O SKU continua editável e opcional.

Lógica em `src/lib/creationAssist.js` → `proposeSku(nome, cor)` (testada). Integrado no `ProductModal` (Products.jsx). Ideias não têm SKU (é conceito de produto).

## 🔒 Hardening de segurança (banco — já aplicado no Supabase)

Rodei o diagnóstico oficial do Supabase e corrigi (detalhes em `sql/23_seguranca_hardening.sql`):
- **🔴 CRÍTICO resolvido:** `kv_store`/`kv_store_history` estavam **legíveis sem login** (dados antigos do negócio). Fechado com RLS admin-only.
- 4 views `SECURITY DEFINER` → `security_invoker` (respeitam a permissão de quem consulta; `products_safe` segue mascarando custo).
- `search_path` fixo em 14 funções.
- `anon` não dispara mais `clean_old_logs` nem funções de trigger.

**⚠️ Uma ação é sua:** ativar **proteção contra senha vazada** no painel do Supabase → Authentication → Policies (é config de Auth, não dá por SQL).

## ✅ Verificações

- 3 testes novos pra `proposeSku` (convenção, remove caracteres especiais, vazio); 13 no `creationAssist` no total
- Auto-SKU testado no navegador: seleção de cor preencheu `VALENTINA613`, botão preencheu `VALENTINA1B`
- Segurança verificada: `anon` bloqueado no `kv_store`, `products_safe` ainda retorna os 47 produtos, advisor sem mais ERROS
- ESLint 0 erros, build OK, testes passando (só a falha pré-existente de fuso em `computeMonthlyTrend`)

## 🗓️ Fases da criação inteligente

- **Fase 1 (v13.50)** ✅ apoio à decisão no criador de pedidos.
- **Fase 3 (v13.51)** ✅ assistente de Nova Ideia.
- **Fase 2 (reposição por vendas)** — sendo destravada aos poucos pelo auto-SKU. Quando os SKUs estiverem preenchidos e o Shopify re-sincronizado, dá pra ligar a reposição no criador.
