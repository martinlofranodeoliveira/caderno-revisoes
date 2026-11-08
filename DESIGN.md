---
name: "Caderno de Revisões"
description: "Cartões, prática e agenda de revisões na identidade LOFRANO TECNOLOGIA."
colors:
  ink: "#19212e"
  muted: "#5b6472"
  accent: "#ae185c"
  accent-hover: "#8c134a"
  canvas: "#f0f2f6"
  paper: "#fff"
  line: "#d8dde5"
  control-line: "#c1cad6"
  secondary-line: "#cbd2dc"
  section-line: "#bcc5d1"
  frame: "#17202d"
  focus: "#b23975"
  danger: "#a51d36"
  secondary-hover: "#f7edf2"
  secondary-hover-line: "#bc8ba3"
typography:
  headline:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.3
  section:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.5
  field:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  action:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.3
  metadata:
    fontFamily: "Lato, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  field: "6px"
  button: "7px"
  notice: "8px"
  surface: "12px"
spacing:
  tight: "6px"
  icon: "8px"
  control: "10px"
  compact: "12px"
  regular: "16px"
  field-gap: "18px"
  group: "20px"
  block: "22px"
  section: "24px"
  panel: "28px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.button}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.button}"
    padding: "10px 14px"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.button}"
    padding: "10px 14px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    padding: "6px 0"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.field}"
    padding: "10px 11px"
  navigation:
    textColor: "{colors.muted}"
    padding: "14px 0"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "28px"
  practice-panel:
    textColor: "{colors.ink}"
    padding: "28px 36px 30px"
---

# Design System: Caderno de Revisões

## Overview

**Creative North Star: "Caderno de prática"**

O Caderno de prática dá prioridade à pergunta, à leitura da resposta e à próxima data. A linguagem vem da família LOFRANO TECNOLOGIA: Lato local, neutros frios, cabeçalho escuro e rosa de ação. As áreas de trabalho têm densidade compacta; o item aberto ganha papel branco e espaço de leitura dentro da própria fila.

A hierarquia usa peso, tamanho, alinhamento e divisórias. Texto simples e ícones SVG de traço sustentam os controles; avisos, confirmações e formulários permanecem no fluxo da página. A passagem entre pergunta, resposta e avaliação não acrescenta movimento ornamental.

**Key Characteristics:**

- Neutros frios e papel branco, com rosa nas ações e seleções.
- Uma família tipográfica, com pesos regular e negrito.
- Listas planas e expansão de leitura dentro do item.
- Datas e estados descritos por texto, com foco de teclado visível.

## Colors

A paleta reúne tinta azulada, superfícies frias e papel branco; o rosa concentra identidade e resposta dos controles.

### Primary

- **Rosa LOFRANO** (`accent`): botões principais, links, item ativo da navegação, cursor de edição e checkbox.
- **Rosa profundo** (`accent-hover`): resposta de ações primárias e textuais ao ponteiro.
- **Rosa de foco** (`focus`): contorno de teclado e foco dentro dos seletores de arquivo.
- **Rosa de apoio** (`secondary-hover` e `secondary-hover-line`): fundo e borda dos controles secundários no hover.

### Neutral

- **Tinta azulada** (`ink`): títulos, perguntas, respostas e texto dos controles secundários.
- **Cinza de apoio** (`muted`): metadados, instruções, placeholders e barra de rolagem.
- **Plano frio** (`canvas`): fundo contínuo da aplicação e trilho da barra de rolagem.
- **Papel branco** (`paper`): campos, formulários, painéis e item de estudo aberto.
- **Linha fria** (`line`): separações internas e bordas de painéis.
- **Linha de campo** (`control-line`): contornos dos campos e seletores.
- **Linha secundária** (`secondary-line`): botões secundários, linhas da fila, biblioteca e rodapé.
- **Linha de seção** (`section-line`): base da navegação e início das listas.
- **Azul da moldura** (`frame`): cabeçalho, com marca e acessos claros.

O vermelho de correção (`danger`) acompanha mensagens de erro e ações destrutivas. Avisos e confirmações usam fundos rosados claros, texto escuro e borda tonal. São tratamentos de feedback, sem tornar o plano inteiro uma ação principal.

**The Acento de ação Rule.** Preserve os planos de leitura em neutros; use o rosa para ação, seleção, foco e resposta de edição.

**The Estado por extenso Rule.** Acompanhe cada estado, erro e escolha de avaliação com texto; a cor reforça a informação.

## Typography

**Display Font:** Lato, com Arial e sans-serif como fallback.
**Body Font:** Lato, com os mesmos fallbacks. Os arquivos locais fornecem os pesos (400 e 700).

**Character:** Uma única família conduz títulos, perguntas, respostas, rótulos e registros. Peso e tamanho estabelecem a hierarquia; metadados menores permanecem subordinados ao conteúdo de estudo.

### Hierarchy

- **Headline:** título da área ativa, no papel `headline`; passa a (24px) até o breakpoint móvel.
- **Title / Section:** títulos de painéis e grupos usam `title` e `section`. Títulos de registros do histórico usam (16px); perguntas resumidas da fila e da biblioteca usam (15px) em negrito.
- **Body:** base em `body`. Descrições e texto de apoio usam em geral (12–13px), com entrelinha ampliada nas áreas longas de ajuda e backup.
- **Label / Field:** rótulos em `label`, valores em `field`; no móvel os rótulos passam a (11px) e os campos a (16px).
- **Action / Metadata:** controles em `action`; contagens, datas de apoio e rodapé em `metadata`. Controles compactos da fila e da paginação usam (11px).
- **Pergunta aberta:** (23px), entrelinha (1,5) e medida máxima de (60ch); no móvel, (20px) e entrelinha (1,6).
- **Resposta aberta:** (18px), entrelinha (1,7) e medida máxima de (70ch); no móvel, (17px).

Textos de ajuda, detalhes de versões e respostas históricas têm medida máxima de (75ch); o texto dos painéis de backup usa até (65ch). Perguntas e respostas preservam quebras de linha e quebram palavras longas. Datas da fila e do histórico usam algarismos tabulares.

**The Leitura antes da ação Rule.** Dê à pergunta e à resposta abertas mais espaço e tamanho que aos metadados e aos controles ao redor.

## Layout

A área principal é centralizada, com largura máxima de (1240px), respiro lateral de `panel`, respiro superior de (18px) e inferior de `section`. Cabeçalho e rodapé compartilham a referência externa. A barra de trabalho reúne quatro acessos e o estado textual da sessão acima do conteúdo ativo.

A fila usa quatro colunas para data, baralho, pergunta e ação: (120px / 200px / espaço flexível / 100px), com intervalo de `group`. Os filtros têm proporção (1fr / 1,5fr). A biblioteca combina uma lateral de (230px) com a área flexível de cartões, separadas por um intervalo de (30px). Backup usa duas colunas iguais, com intervalo de `section`. Formulários e confirmações se abrem no fluxo, sem sobreposição à página.

Até (1050px), a fila reduz suas colunas para (105px / 150px / espaço flexível / 85px) e intervalo de (15px); a lateral da biblioteca passa a (200px), com intervalo de `block`. Até (700px), o respiro lateral geral passa a `regular`, os filtros se empilham e o cabeçalho da fila desaparece. Cada item coloca data e baralho na primeira linha, pergunta na linha seguinte e botão abaixo. A avaliação usa uma coluna de controles com descrição e data lado a lado. Biblioteca e backup se empilham; os acessos aos baralhos quebram linha acima da lista. A navegação mantém os quatro acessos em linha, com o estado da sessão abaixo.

Grupos de ações podem quebrar linha. O item de estudo aberto conserva o contexto da fila e recebe respiro de leitura, reduzido no móvel. A barra de rolagem usa neutros em todas as larguras; a reserva estável de espaço e a rolagem vertical permanente ficam restritas a larguras a partir de (760px), preservando a largura útil no móvel.

## Elevation & Depth

O sistema não usa sombras. A profundidade vem da moldura escura, do plano frio e das superfícies brancas. Bordas finas delimitam painéis, e divisórias organizam a informação. A expansão do estudo acrescenta uma superfície dentro da lista; o foco usa contorno temporário, sem deslocar o controle.

**The Planos sem elevação Rule.** Diferencie áreas por fundo, borda e espaço; mantenha superfícies planas, inclusive no hover.

## Shapes

Cantos discretos diferenciam campos (`field`), botões (`button`), avisos e confirmações (`notice`) e superfícies maiores (`surface`). O item aberto, os formulários e os painéis de backup compartilham o raio de superfície. As bordas usuais têm espessura de (1px); estados vazios usam borda tracejada.

Os ícones funcionais são SVGs sem preenchimento, com traço de (1,7px), pontas e junções arredondadas. O padrão é (20px), reduzido para (16px) nos botões e para os acessos menores de cabeçalho e rodapé. Os ícones acompanham texto que identifica a ação.

## Components

### Buttons

Ações compactas e nomeadas por verbo.

- **Shape:** raio `button`, altura mínima de (42px), intervalo ícone–texto de `icon` e padding do componente `button-primary`.
- **Primary:** rosa e texto branco; hover em rosa profundo. Na avaliação, Lembrei recebe o tratamento primário; as duas outras opções usam o secundário.
- **Secondary:** papel branco, tinta azulada e borda secundária; hover com fundo e borda de apoio rosados.
- **Danger:** confirmações destrutivas usam fundo vermelho e texto branco; o hover escurece esse vermelho. Pedidos de remoção usam ação textual vermelha antes da confirmação inline.
- **Text:** fundo transparente, texto rosa, sublinhado e recuo vertical de `tight`; ações destrutivas mudam a cor para correção.
- **States:** fundo, cor e borda transitam em (0,16s ease-out). O foco tem contorno rosa de (3px), afastado (3px). Controles desabilitados usam opacidade de (0,55) e cursor correspondente. Fila e paginação usam controles compactos, com altura mínima de (36px) e (35px), respectivamente.

### Cards / Containers

Planos brancos agrupam conteúdo que precisa de leitura ou edição.

- **Panels:** borda fria, raio `surface` e padding do componente `panel`; os painéis de backup reduzem o espaço interno para (23px) no móvel.
- **Forms:** fundo branco, borda fria, raio de superfície e espaço interno de (26px), reduzido para `block` no móvel. Campos se organizam em uma coluna.
- **Empty state:** papel branco, borda tracejada e alinhamento central; apresenta título, explicação curta e ação relacionada.
- **Lists:** cartões da biblioteca e registros históricos usam divisórias, sem caixas individuais elevadas. A fila fechada usa o próprio plano da página.

### Inputs / Fields

Rótulos visíveis ficam acima de campos brancos e contornados.

- **Style:** raio `field`, altura mínima de (42px), borda de campo e padding do componente `field`; textarea pode ser redimensionada verticalmente.
- **Focus:** borda e cursor de edição no rosa, com contorno comum no foco de teclado.
- **Placeholder:** cinza de apoio com opacidade total.
- **Error:** borda vermelha, fundo levemente rosado e mensagem de (11px) abaixo do campo; o código relaciona mensagem e campo com `aria-describedby` e informa `aria-invalid`.
- **Search:** SVG posicionado à esquerda, com recuo de texto de (38px).
- **Checkbox:** controle nativo com acento rosa, dimensão de (17px) e rótulo textual.
- **File:** a seleção de arquivo tem a aparência do botão secundário e contorno de foco quando o campo recebe foco.

### Navigation

O cabeçalho escuro contém marca à esquerda e código aberto à direita. A navegação de trabalho usa botões sem fundo, com texto de apoio e uma linha inferior transparente de (3px). O acesso com `aria-current="page"` recebe texto e linha rosa; o hover escurece o texto. A seleção dos baralhos usa texto alinhado à esquerda, nome em negrito, contagem menor e superfície branca contornada para o item atual. No móvel esses controles formam uma sequência que quebra linha.

### Inline Practice

A pergunta se abre dentro da fila, em superfície branca com borda e cantos de superfície. A linha de resumo continua visível acima, separada por divisória. Mostrar resposta é a ação primária antes da revelação; depois dela, a resposta aparece sob uma linha horizontal e os três controles de autoavaliação mostram a próxima data por extenso. O foco acompanha a revelação para a resposta e, após uma avaliação, segue para o próximo cartão disponível.

### Records and Feedback

Biblioteca e histórico apresentam pergunta, metadados e detalhes recolhíveis. A fila limita a pergunta resumida a duas linhas; a biblioteca limita a prévia da resposta a três. A leitura completa permanece na prática, nos detalhes e na edição. Avisos e confirmações surgem no fluxo sobre planos rosados; o estado da sessão permanece textual junto à navegação e as mensagens de operação alimentam uma região de status. A preferência por movimento reduzido remove as transições.

## Do's and Don'ts

### Do:

- **Do** preservar Lato local e os pesos regular e negrito para a hierarquia.
- **Do** manter rótulos visíveis, placeholders legíveis e foco de teclado destacado.
- **Do** apresentar a data completa junto ao texto relativo e usar números tabulares nas datas de conferência.
- **Do** deixar estados, instruções e confirmações junto ao contexto a que pertencem.
- **Do** adaptar grades, grupos de ações e áreas de leitura à largura disponível.

### Don't:

- **Don't** usar o rosa como fundo extenso da pergunta, da resposta ou das listas.
- **Don't** elevar painéis com sombras ou deslocamentos no hover.
- **Don't** comunicar avaliação, erro, seleção ou salvamento somente pela cor.
- **Don't** substituir rótulos por placeholders ou ações nomeadas por ícones isolados.
- **Don't** acrescentar animação ornamental ao revelar a resposta ou trocar de área.
