# KIRA v13.63 — Recorte de foto embutido + cores por fábrica

## ✂️ Recortar a foto DENTRO do sistema

As fichas técnicas das fábricas vêm com 5 fotos + texto numa imagem só — antes era preciso cortar em outro programa antes de anexar na cor. Agora, no **Banco de Cores**, ao clicar em "📷 Adicionar/Trocar foto":

1. Escolhe o arquivo → abre a tela de **recorte** com a imagem grande.
2. **Arrasta** a seleção pra mover · **cantos** redimensionam · arrastar fora desenha uma seleção nova · mostra o tamanho do recorte em px.
3. **"✂️ Cortar e usar"** recorta na resolução original da região e sobe direto. Tem também **"Usar inteira"** (sem recorte) e ESC cancela.

Componente próprio (`PhotoCropModal`), zero dependências novas. Por enquanto ligado nas **cores** (onde doía); dá pra ligar em produtos/ideias depois se quiser.

## 🏭 Cores por fábrica

Algumas cores só existem em certas fábricas — o campo "Fábricas que fazem esta cor bem" já existia na edição da cor e agora é usado de verdade:

- **Banco de Cores**: seletor "🏭 Todas as fábricas" filtra as cores marcadas pra uma fábrica específica.
- **Criador de pedidos**: a galeria de cores de cada modelo abre por padrão mostrando **só as cores da fábrica do pedido + as sem restrição** (cor sem fábrica marcada = disponível em todas). O chip **"🏭 cores de EPF"** vira **"🌐 todas as cores"** com um clique. Cores já selecionadas nunca somem da galeria.
- O toggle só aparece quando existe pelo menos uma cor com restrição de fábrica (senão seria ruído).

**Pra funcionar bem**: marque as fábricas nas cores restritas (editar cor → seção Fábricas). Cores sem marcação continuam aparecendo em todo lugar.

## ✅ Verificações

- Cropper: arrasto de 50% da largura produziu recorte de **exatamente 500px** dos 1000px originais (mapeamento pixel-perfect); clamp mínimo e saída JPEG conferidos; fallback pra viewport degenerado adicionado
- Filtro por fábrica no criador: escondeu a cor exclusiva de outra fábrica, manteve a da fábrica + as sem restrição, e o toggle "todas" trouxe tudo de volta
- ESLint 0 erros, build OK, 225/226 testes (o 1 é o pré-existente de fuso)

## 📋 Pendências do usuário (seguem valendo)

- Revogar o **token antigo da Shopify** · Ativar **proteção de senha vazada** no Supabase
- Fila estratégica: **sync automático noturno da Shopify** · conferência de recebimento
