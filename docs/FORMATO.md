# Formatos de dados

O caderno tem um backup JSON completo, um CSV de conteúdo para troca de cartões e um CSV de histórico para consulta. Somente o JSON restaura versões, arquivamento e avaliações. Todos são texto UTF-8 e não têm criptografia.

Ao selecionar um arquivo, a interface confere seu tamanho antes e depois da leitura e recusa sequências de bytes UTF-8 inválidas. Um BOM UTF-8 inicial, se presente, é removido na decodificação do arquivo.

## Backup JSON, esquema 1

Exemplo completo válido:

```json
{
  "schemaVersion": 1,
  "id": "caderno-001",
  "title": "Meus estudos",
  "decks": [
    { "id": "baralho-001", "name": "Contas simples", "description": "" }
  ],
  "cards": [
    {
      "id": "cartao-001",
      "deckId": "baralho-001",
      "archived": false,
      "versions": [
        { "front": "2 + 3?", "back": "5", "changedOn": "2026-11-08" }
      ]
    }
  ],
  "reviews": [
    {
      "id": "revisao-001",
      "cardId": "cartao-001",
      "version": 1,
      "studiedOn": "2026-11-08",
      "grade": "good"
    }
  ]
}
```

Essa avaliação leva ao estágio 1 e à próxima revisão em `2026-11-09`. Estágio e próxima data são derivados do histórico; não acrescente esses campos ao documento.

### Campos e limites

Todos os campos apresentados são obrigatórios, mesmo listas vazias e descrições vazias. Campos desconhecidos, campos ausentes e chaves JSON duplicadas são recusados. `schemaVersion` deve ser o número `1`.

| Local | Campos |
| --- | --- |
| Raiz | `schemaVersion`, `id`, `title`, `decks`, `cards`, `reviews` |
| Item de `decks` | `id`, `name`, `description` |
| Item de `cards` | `id`, `deckId`, `archived`, `versions` |
| Item de `versions` | `front`, `back`, `changedOn` |
| Item de `reviews` | `id`, `cardId`, `version`, `studiedOn`, `grade` |

| Dado | Limite ou regra |
| --- | --- |
| IDs | 1 a 80 caracteres ASCII: letras, números, `_` ou `-` |
| Unicidade | IDs de caderno, baralhos, cartões e avaliações são únicos entre si no documento |
| `title`, `name` | Até 120 pontos Unicode; o formato aceita texto vazio |
| `description` | Até 1.000 pontos Unicode; pode ser vazia |
| `front`, `back` | Até 4.000 pontos Unicode por lado; não podem conter só espaços |
| `archived` | Booleano `true` ou `false` |
| Datas | Datas civis reais `AAAA-MM-DD`, dos anos `0001` a `9999`, sem horário nem deslocamento |
| Baralhos | Até 100 |
| Cartões | Até 2.000, incluindo arquivados |
| Versões | De 1 a 20 por cartão |
| Avaliações | Até 50.000 no caderno |
| JSON de entrada | Até 8.388.608 bytes UTF-8 (8 MiB), inclusive espaços de formatação |
| JSON canônico completo | Até 8.388.608 bytes UTF-8, com textos escapados como JSON |
| Profundidade de JSON | Até 32 níveis de objetos/listas |

Os limites de texto contam pontos Unicode, não bytes nem unidades UTF-16: um emoji representado por um par substituto conta como um ponto. Texto deve ser Unicode válido. Caracteres de controle C0/C1 são recusados, exceto TAB (`\t`) e LF (`\n`) em frente, verso e descrição. CR (`\r`) não é aceito nesses campos JSON. Textos são preservados, sem aparar espaços ou interpretar HTML.

Cada `deckId` precisa apontar para um baralho existente. Cada avaliação precisa apontar para um cartão e uma versão existentes. A versão é um inteiro começando em 1 e corresponde à posição em `versions`, mais um; as versões não têm ID próprio.

### Sequência de conteúdo e avaliações

`versions` guarda a sequência de conteúdo de cada cartão. Suas datas `changedOn` não podem retroceder. A versão atual é a última. Alterar frente ou verso pelo aplicativo acrescenta uma versão, inicia sua agenda no estágio 0 e preserva as avaliações antigas. Mover o cartão troca somente `deckId`.

`reviews` é a sequência de inclusão das avaliações. A ordem entre cartões diferentes não precisa ser cronológica; para um mesmo cartão, datas e números de versão não podem retroceder. Cada avaliação:

- usa `grade` igual a `again`, `good` ou `easy`;
- ocorre a partir de `changedOn` daquela versão e, se houver versão seguinte, até o `changedOn` seguinte, inclusive;
- ocorre a partir da data prevista calculada para aquela versão;
- é a única avaliação desse cartão e dessa versão em `studiedOn`.

A inclusão de uma nova avaliação no aplicativo exige a versão atual e um cartão não arquivado. Arquivar depois não invalida avaliações anteriores. A edição de conteúdo pode ocorrer no mesmo dia da avaliação: a versão antiga e a nova ainda são versões distintas.

A regra reexecutada durante a validação é:

| Avaliação | Estágio de destino |
| --- | --- |
| `again` | 0 |
| `good` | `min(estágio + 1, 6)` |
| `easy` | `min(estágio + 2, 6)` |

Os intervalos dos estágios de destino `0, 1, 2, 3, 4, 5, 6` são, respectivamente, `1, 1, 3, 7, 14, 30, 60` dias. A próxima data parte de `studiedOn`, não do vencimento anterior. Uma data resultante fora dos anos 0001–9999 é inválida. A fila usa a versão atual, exclui arquivados e seleciona `dueOn <= data de referência`; sua ordem é data prevista e, em empate, ID do cartão em ordem ASCII.

### Tamanho, exportação e restauração

O exportador valida o caderno completo antes de gerar o arquivo. Primeiro tenta JSON indentado com LF final. Se não couber em 8 MiB, gera JSON compacto com LF final; se o JSON compacto já ocupar exatamente 8 MiB, omite o LF final. Todos esses formatos podem ser restaurados pelo importador.

O limite do arquivo de entrada inclui todos os bytes, inclusive espaços externos e eventual BOM. O JSON aceita os espaços definidos pela gramática JSON, mas não comentários ou vírgulas finais. Na interface, um BOM UTF-8 inicial é retirado durante a leitura; a função `parseNotebookJson` recebe texto já decodificado e não aceita um caractere BOM no início dessa string. Repetir uma chave é erro mesmo que uma das grafias use escape, como `title` e `ti\u0074le`.

Restaurar substitui o caderno inteiro após validação e confirmação da interface. Não há mesclagem por IDs. O processo não descarta silenciosamente revisões inválidas. Faça um backup da versão em uso antes de confirmar uma substituição.

## CSV de cartões

O CSV é importado para o baralho selecionado. Use exatamente duas colunas, com cabeçalhos sensíveis a maiúsculas e acentos: `Frente` e `Verso`, nessa ordem. Escolha explicitamente ponto e vírgula ou vírgula na interface; não há detecção automática.

Exemplo com ponto e vírgula:

```csv
Frente;Verso
2 + 3?;5
"O que significa ""dobro""?";Multiplicar por dois.
"Liste dois números.
Um por linha.";"2
4"
```

Exemplo com vírgula, que exige a seleção desse separador:

```csv
Frente,Verso
"Quanto é 1,5 + 1,5?",3
```

- O arquivo de entrada pode ter até 1.048.576 bytes UTF-8 (1 MiB), incluindo BOM e quebras de linha, e até 500 linhas de dados. O cabeçalho não conta como cartão. Uma célula com várias linhas continua sendo um único registro.
- O BOM UTF-8 inicial é aceito. Registros podem terminar em LF ou CRLF. CR isolado é erro. CRLF dentro de células entre aspas é convertido em LF no conteúdo importado.
- Use aspas duplas ao redor de uma célula que contém separador, aspas ou quebra de linha. Duplique uma aspa literal: `""`. Não coloque espaços depois da aspa de fechamento antes do separador ou da quebra de linha.
- Cada registro precisa ter exatamente duas células preenchidas, com até 4.000 pontos Unicode por célula. Aplicam-se as regras de Unicode e controles dos textos do JSON.
- Arquivo apenas com cabeçalho é válido e contém zero cartões. Linhas de dados vazias ou colunas extras são erro. Não acrescente uma linha vazia extra depois do registro final.
- O arquivo inteiro é validado antes da confirmação, incluindo uma tentativa de inclusão sem alterar o estado para conferir os limites globais do caderno. Ao confirmar, a inclusão é validada novamente. Falhar em uma linha não adiciona as anteriores.

A importação cria cartões novos, com IDs gerados pelo aplicativo, versão inicial, sem avaliações e data de criação igual à data de referência. Não faz deduplicação nem atualiza cartões existentes pelo texto.

A exportação contém somente frente e verso **atuais** dos cartões **não arquivados** do baralho escolhido. Pela interface, usa ponto e vírgula; o adaptador `exportCardsCsv` também permite solicitar vírgula por opção. Usa BOM UTF-8, CRLF entre registros e uma quebra final. Não inclui IDs, versões anteriores ou progresso. Um baralho vazio ou totalmente arquivado gera apenas o cabeçalho. A exportação de um baralho grande pode exceder os 500 cartões ou 1 MiB permitidos por importação; divida o CSV antes de reimportar ou use o backup JSON completo.

### Proteção contra fórmulas

Antes de aplicar as aspas do CSV, o exportador prefixa um apóstrofo (`'`) nos valores que começam com TAB/LF/CR ou que podem começar uma fórmula com `=`, `+`, `-` ou `@`, considerando espaços, certos caracteres invisíveis e equivalentes de compatibilidade Unicode. Por exemplo, uma frente `=2+3` sai como `'=2+3`.

O importador não remove esse apóstrofo. Assim, uma ida e volta por CSV pode alterar o texto. Use JSON para uma cópia editável exata. O tratamento é aplicado também ao CSV de histórico.

## CSV de histórico

Relatório exportado com ponto e vírgula, BOM UTF-8 e CRLF. Não é aceito como CSV de cartões nem como backup. Colunas, nesta ordem:

```text
Revisão ID;Baralho ID;Baralho atual;Cartão ID;Versão;Frente;Data de estudo;Avaliação;Estágio;Próxima revisão
```

As linhas seguem a ordem de inclusão de `reviews`. Baralho, seu ID e nome representam o vínculo **atual** do cartão; não há registro dos nomes antigos de baralhos. Frente e versão são as efetivamente avaliadas naquele evento. O verso não é exportado. Avaliação usa `again`, `good` ou `easy`; estágio e próxima revisão são os resultados daquele evento, calculados pela regra de replay, sem consultar o relógio.

## Armazenamento local

O adaptador IndexedDB usa por padrão o banco `lofrano-caderno-revisoes-v1`, versão 1, object store `notebook` e chave `current`. Isso é um detalhe de armazenamento, separado do formato portátil de backup.

O registro local tem `{ revision, notebook }`. Ausência é lida como revisão 0 e caderno nulo, sem gravar um documento durante a leitura. Gravar exige a revisão esperada: comparação e escrita ficam na mesma transação. Limpar grava um registro com `notebook: null` e revisão crescente; esse marcador impede que uma conexão antiga salve como se o banco nunca tivesse recebido dados. Não inclua `revision` no backup JSON.

O armazenamento não criptografa os dados nem cria isolamento entre aplicativos da mesma origem. Erros são informados pela interface; não há fallback silencioso. Veja [SECURITY.md](../SECURITY.md) e o [contrato dos módulos](API-CONTRACT.md).
