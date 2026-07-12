# KIRA v13.48 — Criador visual de pedidos (Fase 2 da "mesa de criação")

## ✨ Nova experiência: criar pedido virou visual e estratégico

O botão **"+ Novo Pedido"** agora abre um **criador em tela cheia**, em 3 etapas, no lugar do formulário apertado. (A edição de pedidos existentes continua no formulário clássico — que também segue acessível pelo botão "📝 Modo clássico" no topo do criador, pra quem preferir.)

### Etapa 1 — Fábrica
Cards grandes das fábricas, cada um mostrando quantos modelos tem cadastrados e o prazo médio. Nome do pedido opcional.

### Etapa 2 — Modelos e cores (a "mesa de criação")
- **Galeria de modelos** à esquerda, com **foto grande** de cada um, agrupados por relevância: cadastrados na fábrica, em pesquisa, de outras fábricas e ideias (que viram produto ao salvar). Busca por nome/código.
- Tocou num modelo, ele entra na mesa. Aí aparece a **galeria de cores** com a **foto real** de cada cor do banco — as cores já cadastradas no modelo vêm primeiro, marcadas com ⭐.
- Tocou numa cor, nasce uma **combinação modelo+cor**: foto do modelo e foto da cor **lado a lado** (o "como fica a LARA em 99J?" na tela), com quantidade em botões grandes de −5/+5 e campo direto. Cor pode ter preço próprio.
- **Totais ao vivo no rodapé**: peças, FOB em dólar e **≈ R$ no câmbio de hoje** (Wise), atualizando a cada toque.

### Etapa 3 — Revisão
Resumo tipo planilha (foto + cores + quantidades + preços), status inicial (Rascunho ou Em Revisão), previsão de chegada, data retroativa e prazo prometido. Salvar.

## 🔗 Como se conecta ao que já existe

O criador **não duplica regra de negócio**: ele monta o mesmo payload do formulário clássico e salva pela mesma função. Ou seja, tudo que já funcionava continua igual — conversão automática de ideia em produto (com dry-run de validação), snapshots de preço/nome/foto, inteligência de fábrica (produto sem fábrica adota a do pedido; de outra fábrica vira fornecedor secundário) e os logs. Depois de salvar, o pedido abre no detalhe de sempre, com o botão **"📊 Planilha Fábrica"** (v13.47) pronto pra exportar.

**Detalhe honesto**: quanto mais cores tiverem foto cadastrada no banco de cores, mais rica a galeria fica. Cores sem foto aparecem como bolinha com a cor sólida (hex). Vale um mutirão de fotos das cores mais usadas.

## ✅ Verificações

- Fluxo completo testado no navegador (fábrica → modelos → cores → combinações → revisão → salvar); payload conferido e idêntico ao do formulário clássico
- ESLint 0 erros, build OK, 185/186 testes (o 1 que falha é o pré-existente de fuso em `computeMonthlyTrend`, anotado)
- `src/components/orders/OrderCreator.jsx` (novo); `Orders.jsx` passou a abrir o criador no "+ Novo Pedido" (edição segue no modal clássico)

## 🗓️ Próximos passos possíveis (quando quiser)

- Mutirão de fotos no banco de cores (deixa a galeria muito melhor)
- Botão de exportar planilha da fábrica direto da etapa de revisão (hoje é no detalhe do pedido, pós-salvar)
- Duplicar/reaproveitar um pedido anterior como ponto de partida no criador

## 📋 Registro das rodadas anteriores (já aplicadas)

- **v13.47** — Planilha da Fábrica: exporta Excel com fotos no formato enviado à fábrica (modelo/cores/FOB/PP/BRL + seção COLORS). Botão no detalhe do pedido (só admin).
- **v13.46** — Correções aplicadas no código e no Supabase: backup passou a incluir `payments`/`color_variants`/`suppliers`; edge function `daily-backup` deployada e cron corrigido (rodava com placeholders, nunca funcionou); `clean_old_logs` corrigida; `orders.status` aceita `in_transit`.
