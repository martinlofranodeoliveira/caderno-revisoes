# Contrato do núcleo e dos adaptadores

IDs fornecidos pelo chamador: 1–80 caracteres ASCII alfanuméricos, `_` ou `-`, únicos no documento (incluindo ID principal). Nenhum módulo de domínio consulta relógio, gera IDs ou faz I/O.

```js
{
  schemaVersion:1, id:'caderno-001', title:'Meus estudos',
  decks:[{id:'baralho-001',name:'Exemplo',description:''}],
  cards:[{id:'cartao-001',deckId:'baralho-001',archived:false,
    versions:[{front:'2 + 3?',back:'5',changedOn:'2026-11-08'}]}],
  reviews:[{id:'revisao-001',cardId:'cartao-001',version:1,studiedOn:'2026-11-08',grade:'good'}]
}
```

Versões são numeradas pelo índice da lista + 1. Datas civis `YYYY-MM-DD` válidas (0001–9999). Campos desconhecidos recusados. Texto simples; front/back/description admitem TAB e LF, sem outros C0/C1 ou Unicode inválido. Nome/título 120 pontos Unicode; description1.000; front/back4.000, estes não podem ser só espaços. Deck precisa existir para cada cartão. Card e sua versão precisam existir para cada revisão.

## Regra de estudo

- A versão começa no estágio0 e vence em changedOn.
- `again` → estágio0 e +1 dia.
- `good` → min(estágio+1,6); `easy` → min(estágio+2,6).
- Intervalo por estágio de destino0..6: `[1,1,3,7,14,30,60]` dias.
- Prazo sempre calculado a partir de studiedOn; revisão atrasada não usa a data vencida como base.
- Não se registra antes do vencimento, nem mais de uma vez por cartão/versão/dia. Datas por cartão não retrocedem e versões nas revisões não retrocedem. Data do registro >=changedOn daquela versão; <=changedOn da próxima versão quando existir (inclusive permite edição no mesmo dia).
- Atualizar frente/verso cria versão nova, com changedOn >= última data de conteúdo/revisão daquele cartão. Se os textos não mudaram, não cria versão. Mover entre baralhos preserva conteúdo/progresso.
- Arquivar exclui da fila, preservando histórico. Excluir cartão remove suas versões e revisões; a UI confirma essa ação e oferece desfazer da última alteração durante a sessão.
- A fila tem versões atuais não arquivadas, dueOn<=today; ordenação dueOn/cardId ASCII. Nenhuma data avança sem avaliação explícita.

## src/domain.mjs

Exports:
- `LIMITS`: maxDecks100,maxCards2000,maxVersionsPerCard20,maxReviews50000,maxJsonBytes8388608,maxJsonDepth32,maxCsvRows500; limites textuais conforme acima.
- `ValidationError(field,message)`.
- `emptyNotebook(id)` → título `Meus estudos`, listas vazias.
- `validateNotebook(value)` → clone canônico; schema, limites, referências, replay integral do histórico e JSON compacto<=8MiB.
- `parseNotebookJson(text)` → parser estrito, tamanho UTF8, profundidade e chaves duplicadas.
- `addDeck(data,deck)`, `replaceDeck(data,deck)`, `removeDeck(data,id)` → novo estado; remover baralho exige zero cartões (incluindo arquivados).
- `addCard(data,card)` → cartão completo com versão inicial, rejeita ID existente.
- `updateCard(data,cardId,{front,back,changedOn,deckId})` → nova versão só se textos mudam; alvo deckId precisa existir.
- `setArchived(data,cardId,boolean)`, `removeCard(data,cardId)` → novo estado.
- `addCards(data,deckId,rows,changedOn,ids)` → novos cartões das rows `{front,back}`; ids tem mesmo tamanho; valida tudo antes de retornar.
- `recordReview(data,{id,cardId,expectedVersion,studiedOn,grade})` → novo estado com evento da versão atual; exige não arquivado e versão esperada igual à atual.
- `undoLastReview(data,reviewId)` → remove somente o último evento global se o ID corresponder; não altera conteúdo.
- `evaluateNotebook(data,today)` → `{cards:[{cardId,deckId,version,stage,dueOn,lastStudiedOn,reviewCount,archived}],dueCardIds:[...],dueCount,dueNewCount,reviewedTodayCount}`. ReviewedTodayCount conta eventos de todas as versões, incluindo arquivadas; dueNewCount conta versões sem revisão na fila.
- `historyEntries(data)` → histórico em ordem de registro, com `{reviewId,cardId,deckId,deckName,version,front,back,studiedOn,grade,stage,dueOn}`. Deck/nome são atuais; frente/verso são os da versão efetivamente avaliada. Calcular em uma passagem, não por prefixos.
- `reviewOutcome(stage,studiedOn,grade)` → `{stage,dueOn}`; prévia pura da mesma regra usada no replay.
- `daysBetween(from,to)`, `addDays(date,integer)` → datas civis; overflow é erro.
- `createExampleNotebook()` → 2 baralhos/6 cartões e registros demonstrativos com datas fixas próximas a 2026-11-08; fatos aritméticos simples, nenhum dado pessoal.

Operações são puras/failure-atomic. Replay precisa ser linear em cartões/versões/revisões, sem revalidar o documento inteiro por evento ou por cartão.

## src/io.mjs

- `exportBackup(data)` → JSON completo validado; pretty+newline se couber em8MiB, fallback compacto com/sem newline dentro do limite.
- `importBackup(text)` → documento validado, sem modificar estado externo.
- `parseCardsCsv(text,{delimiter=';'}={})` → rows `{front,back}`; max1MiB UTF8,500rows; cabeçalho exatamente `Frente` e `Verso`; delimitador `;` ou `,` explícito. Aspas duplas escapadas, células multiline e LF/CRLF; BOM inicial aceito. Erros não ecoam conteúdo privado.
- `exportCardsCsv(data,deckId,{delimiter=';'}={})` → conteúdo atual dos cartões não arquivados daquele baralho, sem progresso; BOM UTF8,CRLF, proteção contra fórmulas antes de quoting. README avisa prefixo apóstrofo e usa JSON para cópia editável exata.
- `exportReviewsCsv(data)` → histórico com deck/card/version, frente daquela versão, data, grau, estágio e próxima data calculados pelo replay; sem chamar relógio. CSVBOM/semicolon/CRLF/formula protection.
- `backupFilename(data,extension='json')` → ASCII safe apenas json/csv.

## src/storage.mjs

- `openNotebookStore({indexedDB=globalThis.indexedDB,dbName='lofrano-caderno-revisoes-v1'}={})` → Promise adapter.
- `.load()` → `{revision:0,notebook:null}` ausente, ou clone validado. Nenhuma escrita de documento no load.
- `.save(notebook,expectedRevision)` → `{revision,notebook}` após transação commit; valida/clone antes da transação, CAS e put na mesma readwrite transaction.
- `.clear(expectedRevision)` → tombstone `{revision,notebook:null}` crescente, protege ABA e outros bancos/chaves.
- `.close()`; `ConflictError(expectedRevision,actualRevision)` e `StorageError(code)` sanitizados, sem dados privados.

A UI bloqueia interação até load inicial concluir, mantém falhas de salvamento na memória com status explícito e permite backup, limpa importações anteriores ao selecionar novo arquivo e confirma substituição por exemplo/backup sobre dados existentes.
