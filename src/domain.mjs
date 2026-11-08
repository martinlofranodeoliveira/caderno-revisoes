/**
 * Núcleo puro do Caderno de Revisões. O chamador fornece IDs e datas civis;
 * este módulo não consulta relógio, não gera identificadores e não faz I/O.
 *
 * Validação de objetos/listas, Unicode, inspeção lexical de JSON e ordinal
 * gregoriano adaptados do Garantia Aberta (e, para objetos/listas, do
 * Orçamento Aberto), sob licença MIT.
 * Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA.
 * Os avisos e termos de permissão estão preservados em ../LICENSE.
 */

export const LIMITS = Object.freeze({
  maxDecks: 100, maxCards: 2000, maxVersionsPerCard: 20, maxReviews: 50000,
  maxJsonBytes: 8 * 1024 * 1024, maxJsonDepth: 32, maxCsvRows: 500,
  maxTitleLength: 120, maxDeckNameLength: 120, maxDescriptionLength: 1000,
  maxFrontLength: 4000, maxBackLength: 4000,
  maxTextUtf8BytesPerCodePoint: 4,
});

export class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const NOTEBOOK_KEYS = ['schemaVersion', 'id', 'title', 'decks', 'cards', 'reviews'];
const DECK_KEYS = ['id', 'name', 'description'];
const CARD_KEYS = ['id', 'deckId', 'archived', 'versions'];
const VERSION_KEYS = ['front', 'back', 'changedOn'];
const REVIEW_KEYS = ['id', 'cardId', 'version', 'studiedOn', 'grade'];
const INTERVALS = Object.freeze([1, 1, 3, 7, 14, 30, 60]);
const utf8 = new TextEncoder();
const fail = (field, message) => { throw new ValidationError(field, message); };

function dataObject(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'Use um objeto de dados.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(field, 'O objeto não pode possuir protótipo personalizado.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const found = Reflect.ownKeys(descriptors);
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) {
    fail(field, 'O objeto contém campos ausentes ou desconhecidos.');
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail(`${field}.${key}`, 'Use um campo de dados comum, sem getters ou setters.');
    }
  }
}

function dataArray(value, field, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    fail(field, `Use uma lista de até ${maximum} itens.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' &&
      (typeof key !== 'string' || /[^0-9]/u.test(key) || key === '' || String(Number(key)) !== key))) {
    fail(field, 'A lista precisa conter apenas itens contínuos, sem campos adicionais.');
  }
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail(`${field}[${index}]`, 'O item precisa ser um campo de dados comum.');
    }
  }
}

function text(value, field, maximum, multiline = false, required = false) {
  if (typeof value !== 'string' || value.length > maximum * 2) fail(field, `Use um texto de até ${maximum} caracteres Unicode.`);
  let length = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 && !(multiline && (code === 9 || code === 10))) || (code >= 127 && code <= 159)) {
      fail(field, 'O texto contém caracteres de controle não permitidos.');
    }
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) fail(field, 'Use apenas Unicode válido.');
      index++;
    } else if (code >= 0xDC00 && code <= 0xDFFF) fail(field, 'Use apenas Unicode válido.');
    if (++length > maximum) fail(field, `Use um texto de até ${maximum} caracteres Unicode.`);
  }
  if (utf8.encode(value).byteLength > maximum * LIMITS.maxTextUtf8BytesPerCodePoint) fail(field, 'O texto excede o limite de bytes UTF-8.');
  if (required && value.trim() === '') fail(field, 'Informe um texto que não seja apenas espaços.');
  return value;
}

function identifier(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80 || /[^A-Za-z0-9_-]/u.test(value)) {
    fail(field, 'Use um identificador de 1 a 80 letras ASCII, números, hífens ou sublinhados.');
  }
  return value;
}

function uniqueId(value, field, seen) {
  const id = identifier(value, field);
  if (seen.has(id)) fail(field, 'Todos os identificadores do caderno precisam ser únicos.');
  seen.add(id);
  return id;
}

function calendarDate(value, field) {
  if (typeof value !== 'string' || value.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value)) {
    fail(field, 'Use uma data real no formato AAAA-MM-DD.');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) {
    fail(field, 'A data informada não existe no calendário.');
  }
  return value;
}

// Ordinal gregoriano sem Date/UTC, inclusive para os anos 0001–0099.
function ordinal(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const previousYear = year - 1;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const beforeMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return previousYear * 365 + Math.floor(previousYear / 4) - Math.floor(previousYear / 100) +
    Math.floor(previousYear / 400) + beforeMonth[month - 1] + (leap && month > 2 ? 1 : 0) + Number(date.slice(8, 10));
}

export function daysBetween(from, to) {
  return ordinal(calendarDate(to, 'to')) - ordinal(calendarDate(from, 'from'));
}

export function addDays(date, integer) {
  calendarDate(date, 'date');
  if (!Number.isSafeInteger(integer)) fail('days', 'Use um número inteiro seguro de dias.');
  const target = ordinal(date) + integer;
  if (!Number.isSafeInteger(target) || target < 1 || target > 3652059) fail('date', 'A data calculada ultrapassa os anos 0001 a 9999.');
  // Busca limitada a 14 passos, independente do intervalo solicitado.
  let low = 1;
  let high = 10000;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (ordinal(`${String(middle).padStart(4, '0')}-01-01`) <= target) low = middle;
    else high = middle;
  }
  const year = String(low).padStart(4, '0');
  let month = 1;
  while (month < 12 && ordinal(`${year}-${String(month + 1).padStart(2, '0')}-01`) <= target) month++;
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return `${prefix}-${String(target - ordinal(`${prefix}-01`) + 1).padStart(2, '0')}`;
}

export function reviewOutcome(stage, studiedOn, grade) {
  if (!Number.isSafeInteger(stage) || stage < 0 || stage > 6) fail('stage', 'Use um estágio inteiro de 0 a 6.');
  calendarDate(studiedOn, 'studiedOn');
  if (grade !== 'again' && grade !== 'good' && grade !== 'easy') fail('grade', 'Use uma das três avaliações disponíveis.');
  const nextStage = grade === 'again' ? 0 : Math.min(6, stage + (grade === 'easy' ? 2 : 1));
  return { stage: nextStage, dueOn: addDays(studiedOn, INTERVALS[nextStage]) };
}

function cloneDeck(value, field, seen) {
  dataObject(value, DECK_KEYS, field);
  return { id: uniqueId(value.id, `${field}.id`, seen),
    name: text(value.name, `${field}.name`, LIMITS.maxDeckNameLength),
    description: text(value.description, `${field}.description`, LIMITS.maxDescriptionLength, true) };
}

function cloneCard(value, field, seen, deckIds) {
  dataObject(value, CARD_KEYS, field);
  const id = uniqueId(value.id, `${field}.id`, seen);
  const deckId = identifier(value.deckId, `${field}.deckId`);
  if (!deckIds.has(deckId)) fail(`${field}.deckId`, 'O baralho do cartão precisa existir.');
  if (typeof value.archived !== 'boolean') fail(`${field}.archived`, 'Use verdadeiro ou falso para arquivamento.');
  dataArray(value.versions, `${field}.versions`, LIMITS.maxVersionsPerCard);
  if (!value.versions.length) fail(`${field}.versions`, 'O cartão precisa ter uma versão inicial.');
  let previousChangedOn = '';
  const versions = value.versions.map((version, index) => {
    const versionField = `${field}.versions[${index}]`;
    dataObject(version, VERSION_KEYS, versionField);
    const changedOn = calendarDate(version.changedOn, `${versionField}.changedOn`);
    if (changedOn < previousChangedOn) fail(`${versionField}.changedOn`, 'As datas de conteúdo não podem retroceder.');
    previousChangedOn = changedOn;
    return { front: text(version.front, `${versionField}.front`, LIMITS.maxFrontLength, true, true),
      back: text(version.back, `${versionField}.back`, LIMITS.maxBackLength, true, true), changedOn };
  });
  return { id, deckId, archived: value.archived, versions };
}

function cloneReview(value, field, seen) {
  dataObject(value, REVIEW_KEYS, field);
  if (!Number.isSafeInteger(value.version) || value.version < 1) fail(`${field}.version`, 'Informe uma versão inteira existente.');
  if (value.grade !== 'again' && value.grade !== 'good' && value.grade !== 'easy') fail(`${field}.grade`, 'Use uma das três avaliações disponíveis.');
  return { id: uniqueId(value.id, `${field}.id`, seen), cardId: identifier(value.cardId, `${field}.cardId`),
    version: value.version, studiedOn: calendarDate(value.studiedOn, `${field}.studiedOn`), grade: value.grade };
}

/** Um mapa por cartão/versão permite replay linear, sem revalidar prefixos. */
function replay(notebook, includeHistory = false) {
  const decks = new Map(notebook.decks.map(deck => [deck.id, deck]));
  const cards = new Map(notebook.cards.map(card => [card.id, {
    card, lastDate: '', lastVersion: 0,
    states: card.versions.map(version => ({ stage: 0, dueOn: version.changedOn, lastStudiedOn: null, reviewCount: 0 })),
  }]));
  const history = [];
  for (let index = 0; index < notebook.reviews.length; index++) {
    const review = notebook.reviews[index];
    const field = `reviews[${index}]`;
    const entry = cards.get(review.cardId);
    if (!entry) fail(`${field}.cardId`, 'O cartão da revisão precisa existir.');
    const content = entry.card.versions[review.version - 1];
    if (!content) fail(`${field}.version`, 'A versão da revisão precisa existir.');
    const nextContent = entry.card.versions[review.version];
    if (review.version < entry.lastVersion) fail(`${field}.version`, 'As versões estudadas de um cartão não podem retroceder.');
    if (review.studiedOn < entry.lastDate || review.studiedOn < content.changedOn ||
        (nextContent && review.studiedOn > nextContent.changedOn)) {
      fail(`${field}.studiedOn`, 'A data precisa respeitar a sequência de conteúdo e revisões do cartão.');
    }
    const state = entry.states[review.version - 1];
    if (review.studiedOn === state.lastStudiedOn) fail(`${field}.studiedOn`, 'Esta versão já foi avaliada nesta data.');
    if (review.studiedOn < state.dueOn) fail(`${field}.studiedOn`, 'Estude somente a partir da data prevista.');
    const outcome = reviewOutcome(state.stage, review.studiedOn, review.grade);
    state.stage = outcome.stage;
    state.dueOn = outcome.dueOn;
    state.lastStudiedOn = review.studiedOn;
    state.reviewCount++;
    entry.lastDate = review.studiedOn;
    entry.lastVersion = review.version;
    if (includeHistory) history.push({ reviewId: review.id, cardId: review.cardId,
      deckId: entry.card.deckId, deckName: decks.get(entry.card.deckId).name,
      version: review.version, front: content.front, back: content.back,
      studiedOn: review.studiedOn, grade: review.grade, stage: state.stage, dueOn: state.dueOn });
  }
  return { cards, history };
}

function validated(value, includeHistory = false) {
  dataObject(value, NOTEBOOK_KEYS, 'notebook');
  if (value.schemaVersion !== 1) fail('schemaVersion', 'Apenas schemaVersion 1 é suportado.');
  const id = identifier(value.id, 'id');
  const title = text(value.title, 'title', LIMITS.maxTitleLength);
  dataArray(value.decks, 'decks', LIMITS.maxDecks);
  dataArray(value.cards, 'cards', LIMITS.maxCards);
  dataArray(value.reviews, 'reviews', LIMITS.maxReviews);
  const seen = new Set([id]);
  const decks = value.decks.map((deck, index) => cloneDeck(deck, `decks[${index}]`, seen));
  const deckIds = new Set(decks.map(deck => deck.id));
  const cards = value.cards.map((card, index) => cloneCard(card, `cards[${index}]`, seen, deckIds));
  const reviews = value.reviews.map((review, index) => cloneReview(review, `reviews[${index}]`, seen));
  const notebook = { schemaVersion: 1, id, title, decks, cards, reviews };
  if (utf8.encode(JSON.stringify(notebook)).byteLength > LIMITS.maxJsonBytes) fail('json', 'O caderno excede o limite de 8 MiB de JSON.');
  return { notebook, ...replay(notebook, includeHistory) };
}

export function validateNotebook(value) { return validated(value).notebook; }

export function emptyNotebook(id) {
  return validateNotebook({ schemaVersion: 1, id, title: 'Meus estudos', decks: [], cards: [], reviews: [] });
}

/** Inspeção lexical iterativa; JSON.parse continua sendo a autoridade da gramática. */
function inspectJson(source) {
  const stack = [];
  for (let position = 0; position < source.length; position++) {
    const character = source[position];
    if (character === '"') {
      const start = position;
      let closed = false;
      while (++position < source.length) {
        if (source[position] === '\\') position++;
        else if (source[position] === '"') { closed = true; break; }
      }
      if (!closed) fail('json', 'O arquivo não contém JSON válido.');
      let next = position + 1;
      while (next < source.length && /[\x20\t\n\r]/u.test(source[next])) next++;
      if (source[next] === ':' && stack.at(-1)?.type === '{') {
        let key;
        try { key = JSON.parse(source.slice(start, position + 1)); }
        catch { fail('json', 'O arquivo não contém JSON válido.'); }
        const keys = stack.at(-1).keys;
        if (keys.has(key)) fail('json', 'O JSON contém uma chave repetida.');
        keys.add(key);
      }
    } else if (character === '{' || character === '[') {
      stack.push({ type: character, keys: character === '{' ? new Set() : null });
      if (stack.length > LIMITS.maxJsonDepth) fail('json', 'O JSON excede a profundidade permitida.');
    } else if (character === '}' || character === ']') {
      const open = stack.pop();
      if (!open || open.type !== (character === '}' ? '{' : '[')) fail('json', 'O arquivo não contém JSON válido.');
    }
  }
  if (stack.length) fail('json', 'O arquivo não contém JSON válido.');
}

export function parseNotebookJson(source) {
  if (typeof source !== 'string' || source.length > LIMITS.maxJsonBytes || utf8.encode(source).byteLength > LIMITS.maxJsonBytes) {
    fail('json', 'Importe um arquivo JSON de até 8 MiB.');
  }
  inspectJson(source);
  let value;
  try { value = JSON.parse(source); }
  catch { fail('json', 'O arquivo não contém JSON válido.'); }
  return validateNotebook(value);
}

function mutate(data, operation) {
  const next = validateNotebook(data);
  operation(next);
  return validateNotebook(next);
}

function find(values, id, field) {
  identifier(id, field);
  const index = values.findIndex(value => value.id === id);
  if (index < 0) fail(field, 'O identificador informado não existe.');
  return index;
}

export function addDeck(data, deck) {
  return mutate(data, next => { next.decks.push(deck); });
}

export function replaceDeck(data, deck) {
  return mutate(data, next => {
    const replacement = cloneDeck(deck, 'deck', new Set());
    next.decks[find(next.decks, replacement.id, 'deckId')] = replacement;
  });
}

export function removeDeck(data, id) {
  return mutate(data, next => {
    const index = find(next.decks, id, 'deckId');
    if (next.cards.some(card => card.deckId === id)) fail('deckId', 'Remova ou mova todos os cartões antes de excluir o baralho.');
    next.decks.splice(index, 1);
  });
}

export function addCard(data, card) {
  return mutate(data, next => {
    dataObject(card, CARD_KEYS, 'card');
    dataArray(card.versions, 'card.versions', 1);
    if (card.versions.length !== 1) fail('card.versions', 'Um cartão novo precisa de exatamente uma versão.');
    next.cards.push(card);
  });
}

export function updateCard(data, cardId, changes) {
  return mutate(data, next => {
    dataObject(changes, ['front', 'back', 'changedOn', 'deckId'], 'changes');
    const card = next.cards[find(next.cards, cardId, 'cardId')];
    const front = text(changes.front, 'changes.front', LIMITS.maxFrontLength, true, true);
    const back = text(changes.back, 'changes.back', LIMITS.maxBackLength, true, true);
    const changedOn = calendarDate(changes.changedOn, 'changes.changedOn');
    find(next.decks, changes.deckId, 'changes.deckId');
    const current = card.versions.at(-1);
    if (front !== current.front || back !== current.back) {
      let lastDate = current.changedOn;
      for (const review of next.reviews) if (review.cardId === cardId && review.studiedOn > lastDate) lastDate = review.studiedOn;
      if (changedOn < lastDate) fail('changes.changedOn', 'A nova versão não pode anteceder conteúdo ou revisão já registrados.');
      card.versions.push({ front, back, changedOn });
    }
    card.deckId = changes.deckId;
  });
}

export function setArchived(data, cardId, archived) {
  return mutate(data, next => {
    if (typeof archived !== 'boolean') fail('archived', 'Use verdadeiro ou falso para arquivamento.');
    next.cards[find(next.cards, cardId, 'cardId')].archived = archived;
  });
}

export function removeCard(data, cardId) {
  return mutate(data, next => {
    next.cards.splice(find(next.cards, cardId, 'cardId'), 1);
    next.reviews = next.reviews.filter(review => review.cardId !== cardId);
  });
}

export function addCards(data, deckId, rows, changedOn, ids) {
  return mutate(data, next => {
    find(next.decks, deckId, 'deckId');
    calendarDate(changedOn, 'changedOn');
    dataArray(rows, 'rows', LIMITS.maxCsvRows);
    dataArray(ids, 'ids', LIMITS.maxCsvRows);
    if (rows.length !== ids.length) fail('ids', 'Forneça um identificador para cada cartão.');
    rows.forEach((row, index) => {
      dataObject(row, ['front', 'back'], `rows[${index}]`);
      next.cards.push({ id: ids[index], deckId, archived: false,
        versions: [{ front: row.front, back: row.back, changedOn }] });
    });
  });
}

export function recordReview(data, review) {
  return mutate(data, next => {
    dataObject(review, ['id', 'cardId', 'expectedVersion', 'studiedOn', 'grade'], 'review');
    const card = next.cards[find(next.cards, review.cardId, 'review.cardId')];
    if (card.archived) fail('review.cardId', 'Desarquive o cartão antes de estudar.');
    if (!Number.isSafeInteger(review.expectedVersion) || review.expectedVersion !== card.versions.length) {
      fail('review.expectedVersion', 'O conteúdo mudou; abra a versão atual antes de avaliar.');
    }
    next.reviews.push({ id: review.id, cardId: review.cardId, version: review.expectedVersion,
      studiedOn: review.studiedOn, grade: review.grade });
  });
}

export function undoLastReview(data, reviewId) {
  return mutate(data, next => {
    identifier(reviewId, 'reviewId');
    if (!next.reviews.length || next.reviews.at(-1).id !== reviewId) fail('reviewId', 'Somente a última avaliação registrada pode ser desfeita.');
    next.reviews.pop();
  });
}

export function evaluateNotebook(data, today) {
  calendarDate(today, 'today');
  const { notebook, cards: replayed } = validated(data);
  const cards = notebook.cards.map(card => ({ cardId: card.id, deckId: card.deckId,
    version: card.versions.length, ...replayed.get(card.id).states.at(-1), archived: card.archived }));
  const due = cards.filter(card => !card.archived && card.dueOn <= today);
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  due.sort((left, right) => compare(left.dueOn, right.dueOn) || compare(left.cardId, right.cardId));
  return { cards, dueCardIds: due.map(card => card.cardId), dueCount: due.length,
    dueNewCount: due.filter(card => card.reviewCount === 0).length,
    reviewedTodayCount: notebook.reviews.reduce((count, review) => count + (review.studiedOn === today ? 1 : 0), 0) };
}

export function historyEntries(data) { return validated(data, true).history; }

export function createExampleNotebook() {
  return validateNotebook({ schemaVersion: 1, id: 'caderno-exemplo', title: 'Caderno de exemplo', decks: [
    { id: 'baralho-somas', name: 'Somas e diferenças', description: 'Cartões demonstrativos com contas simples.' },
    { id: 'baralho-produtos', name: 'Produtos e divisões', description: 'Conteúdo demonstrativo para experimentar a fila.' },
  ], cards: [
    { id: 'cartao-soma-1', deckId: 'baralho-somas', archived: false, versions: [{ front: '2 + 3?', back: '5', changedOn: '2026-11-05' }] },
    { id: 'cartao-soma-2', deckId: 'baralho-somas', archived: false, versions: [{ front: '10 − 4?', back: '6', changedOn: '2026-11-06' }] },
    { id: 'cartao-soma-3', deckId: 'baralho-somas', archived: false, versions: [{ front: '7 + 8?', back: '15', changedOn: '2026-11-08' }] },
    { id: 'cartao-produto-1', deckId: 'baralho-produtos', archived: false, versions: [{ front: '3 × 4?', back: '12', changedOn: '2026-11-05' }] },
    { id: 'cartao-produto-2', deckId: 'baralho-produtos', archived: false, versions: [{ front: '18 ÷ 3?', back: '6', changedOn: '2026-11-07' }] },
    { id: 'cartao-produto-3', deckId: 'baralho-produtos', archived: true, versions: [{ front: '5 × 5?', back: '25', changedOn: '2026-11-06' }] },
  ], reviews: [
    { id: 'revisao-exemplo-1', cardId: 'cartao-soma-1', version: 1, studiedOn: '2026-11-05', grade: 'good' },
    { id: 'revisao-exemplo-2', cardId: 'cartao-produto-1', version: 1, studiedOn: '2026-11-05', grade: 'easy' },
    { id: 'revisao-exemplo-3', cardId: 'cartao-soma-2', version: 1, studiedOn: '2026-11-06', grade: 'again' },
    { id: 'revisao-exemplo-4', cardId: 'cartao-soma-1', version: 1, studiedOn: '2026-11-06', grade: 'good' },
    { id: 'revisao-exemplo-5', cardId: 'cartao-produto-2', version: 1, studiedOn: '2026-11-08', grade: 'good' },
  ] });
}
