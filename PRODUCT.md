# Produto

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

HTML, CSS e módulos JavaScript estáticos, publicáveis no GitHub Pages. Núcleo puro de agendamento e histórico, IndexedDB opcional com revisão transacional e testes Node.js. Sem dependências de execução no navegador.

## Users

Público proposto: pessoas que estudam e querem criar cartões próprios, praticar e consultar uma agenda de revisões. Ainda não há pesquisa de uso documentada.

## Product Purpose

Criar baralhos e cartões, revelar respostas durante a prática e registrar uma autoavaliação que determina a próxima data pela regra explícita do aplicativo. Manter histórico e backup portátil sem conta ou serviço de IA.

## Operating Context

Uso no navegador, com uma data de referência no fuso America/Sao_Paulo. A fila inclui cartões não arquivados com revisão prevista até essa data. Conteúdo, avaliação e escolha de estudar pertencem à pessoa que usa o app. Não há notificações de fundo ou promessa de eficácia pedagógica.

## Capabilities and Constraints

Até 100 baralhos, 2.000 cartões, 20 versões de conteúdo por cartão e 50.000 registros de revisão; o JSON canônico completo deve caber em 8 MiB. Textos são simples, sem HTML ou mídia. A mudança do texto cria nova versão e reinicia a fila daquele conteúdo, preservando o histórico anterior. Cada versão pode receber uma avaliação por dia, somente quando estiver na fila. As respostas são autoavaliadas em Rever amanhã, Lembrei ou Fácil; a regra de intervalos é documentada. Importação CSV por baralho com prévia e validação integral; backup JSON completo. Salvamento local opcional com conflitos explícitos, sem sincronização na nuvem.

## Brand Commitments

Aplicação aberta da LOFRANO TECNOLOGIA, vinculada a https://lofranotecnologia.com.br. Herda Lato, neutros frios, cabeçalho escuro e rosa de ação dos aplicativos Orçamento Aberto e Garantia Aberta. Esta superfície prioriza a prática e a leitura dos cartões, com controles de estudo consistentes. Exemplos públicos usam baralhos e histórico demonstrativos.
