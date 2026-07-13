# KIRA v13.55 — Cada tela ganhou uma URL (#/pedidos, #/financeiro…)

## 🔗 O que mudou

O sistema era uma tela só pro navegador: navegar entre Ideias, Pedidos e Financeiro nunca mudava a URL. Agora **cada tela tem endereço próprio**:

`#/inicio` · `#/ideias` · `#/produtos` · `#/producao` · `#/pedidos` · `#/financeiro` · `#/shopify` · `#/calculadoras` · `#/nomes` · `#/colecoes` · `#/fabricas` · `#/cores` · `#/atividades` · `#/metricas` · `#/backup` · `#/usuarios`

Na prática:
- **F5 mantém você na tela** em que estava (antes voltava pro início).
- **Voltar/avançar do navegador** funcionam entre as telas.
- **Dá pra favoritar e compartilhar**: `evany-production.up.railway.app/#/pedidos` abre direto em Pedidos — inclusive se a pessoa precisar logar antes (o destino é lembrado).
- **Permissão respeitada**: link direto pra tela que o papel não vê (ex.: equipe abrindo `#/financeiro`) cai no Dashboard. A segurança real continua sendo o RLS no servidor — isso é só coerência de navegação.

O `#` na URL é o que permite tudo isso **sem nenhuma configuração de servidor** (o app é estático no Railway). URLs sem `#` (tipo `/pedidos`) exigiriam fallback no servidor — dá pra evoluir depois se fizer questão.

## 🔧 Técnica

- `src/lib/router.js` (novo): mapa página↔slug, parse tolerante de hash e guard de permissão (espelha o `show` do menu). 8 testes.
- `App.jsx`: estado `page` sincroniza com `location.hash` nos dois sentidos (menu → URL; URL/voltar/avançar → tela), e a página inicial nasce do hash.
- Zero dependências novas (sem react-router).

## ✅ Verificações

- Testado no app real: abrir `/` normaliza pra `#/inicio`; colar `#/pedidos` é aceito e mantido (após login cai em Pedidos); sem erros de console
- 8 testes novos (ida-e-volta de todos os slugs, variações de formato, guard por papel)
- ESLint 0 erros, build OK, 218/219 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** (o novo, via secret, já está em uso)
- Ativar **proteção contra senha vazada** no Supabase (Authentication → Policies)
