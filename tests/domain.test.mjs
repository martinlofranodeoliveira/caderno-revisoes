import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, ValidationError, emptyNotebook, validateNotebook, parseNotebookJson,
  addDeck, replaceDeck, removeDeck, addCard, updateCard, setArchived, removeCard,
  addCards, recordReview, undoLastReview, evaluateNotebook, historyEntries,
  daysBetween, addDays, reviewOutcome, createExampleNotebook,
} from '../src/domain.mjs';

const TODAY = '2026-11-08';
const deck = (id = 'deck') => ({ id, name: 'Aritmética', description: '' });
const card = (id = 'card', changedOn = TODAY, deckId = 'deck') => ({
  id, deckId, archived: false, versions: [{ front: '2 + 3?', back: '5', changedOn }],
});
function book() { return addCard(addDeck(emptyNotebook('book'), deck()), card()); }
function grade(data, id, studiedOn = TODAY, value = 'good', cardId = 'card', expectedVersion = 1) {
  return recordReview(data, { id, cardId, expectedVersion, studiedOn, grade: value });
}
const clone = value => structuredClone(value);
const invalid = (operation, field) => assert.throws(operation,
  error => error instanceof ValidationError && (field === undefined || error.field === field));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Independent date oracle: JavaScript's UTC calendar, with setUTCFullYear to
// avoid Date.UTC's special mapping of years 0–99. Domain uses ordinals instead.
function utc(date) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}
function oracleAdd(date, count) {
  const value = utc(date);
  value.setUTCDate(value.getUTCDate() + count);
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

test('empty document and validation create independent canonical clones', () => {
  assert.deepEqual(emptyNotebook('book'), { schemaVersion: 1, id: 'book', title: 'Meus estudos', decks: [], cards: [], reviews: [] });
  const source = freeze(book());
  const next = validateNotebook(source);
  assert.deepEqual(next, source);
  assert.notEqual(next.cards[0].versions, source.cards[0].versions);
  next.cards[0].versions[0].front = 'Outro';
  assert.equal(source.cards[0].versions[0].front, '2 + 3?');
  const noPrototype = Object.assign(Object.create(null), source);
  assert.deepEqual(validateNotebook(noPrototype), source);
  assert.ok(Object.isFrozen(LIMITS));
});

test('strict schema refuses unknown/missing/symbol fields, accessors and custom prototypes without reading them', () => {
  for (const change of [
    data => { data.extra = true; }, data => { delete data.title; },
    data => { data.decks[0].extra = true; }, data => { data.cards[0].versions[0].extra = true; },
    data => { data.cards[0][Symbol('private')] = true; },
    data => { Object.setPrototypeOf(data.decks[0], { polluted: true }); },
  ]) { const data = book(); change(data); invalid(() => validateNotebook(data)); }
  const data = book();
  let calls = 0;
  Object.defineProperty(data, 'title', { enumerable: true, get() { calls++; throw new Error('getter executed'); } });
  invalid(() => validateNotebook(data), 'notebook.title');
  assert.equal(calls, 0);
  const arrayGetter = book();
  Object.defineProperty(arrayGetter.cards, '0', { enumerable: true, get() { calls++; } });
  invalid(() => validateNotebook(arrayGetter), 'cards[0]');
  assert.equal(calls, 0);
  const hidden = book();
  Object.defineProperty(hidden, 'title', { value: 'Hidden', enumerable: false });
  invalid(() => validateNotebook(hidden));
});

test('arrays must be dense ordinary arrays without additional properties', () => {
  for (const change of [
    data => { delete data.cards[0]; },
    data => { data.cards.extra = 1; },
    data => { data.decks['1\n'] = deck('other'); },
    data => { Object.setPrototypeOf(data.cards, null); },
    data => { data.cards = { 0: card(), length: 1 }; },
  ]) { const data = book(); change(data); invalid(() => validateNotebook(data)); }
});

test('IDs use complete ASCII validation and one namespace for document/decks/cards/reviews', () => {
  for (const id of ['', 'a'.repeat(81), 'ação', 'x\n', 'x\r', 'x y', 'x.y', 'x/']) invalid(() => emptyNotebook(id), 'id');
  assert.equal(emptyNotebook('A_z-09').id, 'A_z-09');
  for (const id of ['book', 'deck', 'card']) invalid(() => addDeck(book(), deck(id)));
  invalid(() => grade(book(), 'book'));
  const data = grade(book(), 'review');
  invalid(() => addCard(data, card('review')));
  invalid(() => grade(data, 'review', '2026-11-09'));
});

test('Unicode limits count code points; allowed multiline controls remain exact', () => {
  const data = book();
  data.title = '😀'.repeat(120);
  data.decks[0].name = '';
  data.decks[0].description = 'A\tB\nC';
  data.cards[0].versions[0].front = '😀'.repeat(4000);
  data.cards[0].versions[0].back = ' a\tb\nc ';
  assert.deepEqual(validateNotebook(data), data);
  for (const character of ['\u0000', '\r', '\u001f', '\u007f', '\u0085', '\u009f', '\ud800', '\udc00']) {
    const bad = book(); bad.cards[0].versions[0].front += character; invalid(() => validateNotebook(bad));
  }
  for (const value of ['', ' \t\n ', '\u00a0', '\u2003']) {
    const bad = book(); bad.cards[0].versions[0].back = value; invalid(() => validateNotebook(bad));
  }
  for (const change of [
    value => { value.title = '😀'.repeat(121); },
    value => { value.title = 'a\nb'; },
    value => { value.decks[0].description = 'x'.repeat(1001); },
    value => { value.decks[0].name = 'a\tb'; },
    value => { value.cards[0].versions[0].front = '😀'.repeat(4001); },
    value => { value.cards[0].versions[0].back = 'x'.repeat(4001); },
  ]) { const bad = book(); change(bad); invalid(() => validateNotebook(bad)); }
});

test('JSON parsing refuses duplicate decoded keys, malformed input and excessive depth', () => {
  const json = JSON.stringify(book());
  assert.deepEqual(parseNotebookJson(` \n${json}\t\r\n`), book());
  invalid(() => parseNotebookJson(json.replace('"title":', '"title":"first","ti\\u0074le":')), 'json');
  invalid(() => parseNotebookJson(json.replace('"front":', '"front":"private","front":')), 'json');
  for (const source of ['{}x', '{"secret":', '[}', '{"x":NaN}', '\ufeff' + json, json.slice(0, -1), '']) {
    invalid(() => parseNotebookJson(source));
  }
  invalid(() => parseNotebookJson('['.repeat(33) + '0' + ']'.repeat(33)), 'json');
  invalid(() => parseNotebookJson(' '.repeat(LIMITS.maxJsonBytes + 1)), 'json');
  invalid(() => parseNotebookJson('"' + '😀'.repeat(LIMITS.maxJsonBytes / 4) + '"'), 'json');
  const malformed = '{"private-data-123":';
  assert.throws(() => parseNotebookJson(malformed), error => !error.message.includes('private-data-123'));
});

test('calendar arithmetic matches an independent UTC oracle through leap years and century boundaries', () => {
  const dates = ['0001-01-01', '0004-02-28', '0099-12-31', '0100-02-28', '0400-02-28',
    '1582-10-04', '1900-02-28', '2000-02-28', '2024-02-29', '2026-11-08', '9999-12-31'];
  for (const from of dates) {
    for (const to of dates) assert.equal(daysBetween(from, to), (utc(to) - utc(from)) / 86400000);
    for (const offset of [-367, -60, -1, 0, 1, 60, 367]) {
      const target = oracleAdd(from, offset);
      if (target.length === 10 && target >= '0001-01-01' && target <= '9999-12-31') assert.equal(addDays(from, offset), target);
      else invalid(() => addDays(from, offset));
    }
  }
  // A deterministic sweep over every year tests leap rules without sharing
  // the domain's formula or month lookup table.
  for (let year = 1; year <= 9998; year += 7) {
    const date = `${String(year).padStart(4, '0')}-02-28`;
    assert.equal(addDays(date, 2), oracleAdd(date, 2));
  }
  assert.equal(addDays('0001-01-01', 3652058), '9999-12-31');
  assert.equal(addDays('9999-12-31', -3652058), '0001-01-01');
});

test('dates reject malformed/newline-suffixed values, impossible dates, fractions and overflow', () => {
  for (const date of ['0000-01-01', '10000-01-01', '2026-02-29', '1900-02-29', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-1-01', '2026-11-08\n', '', null]) {
    invalid(() => daysBetween(date, TODAY)); invalid(() => addDays(date, 0));
  }
  for (const integer of [0.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) invalid(() => addDays(TODAY, integer));
  invalid(() => addDays('9999-12-31', 1));
  invalid(() => addDays('0001-01-01', -1));
  invalid(() => addDays(TODAY, Number.MAX_SAFE_INTEGER));
});

test('reviewOutcome implements every documented destination interval and validates inputs', () => {
  const expectedGood = [[1, 1], [2, 3], [3, 7], [4, 14], [5, 30], [6, 60], [6, 60]];
  const expectedEasy = [[2, 3], [3, 7], [4, 14], [5, 30], [6, 60], [6, 60], [6, 60]];
  for (let stage = 0; stage <= 6; stage++) {
    assert.deepEqual(reviewOutcome(stage, TODAY, 'again'), { stage: 0, dueOn: '2026-11-09' });
    for (const [value, expected] of [['good', expectedGood[stage]], ['easy', expectedEasy[stage]]]) {
      assert.deepEqual(reviewOutcome(stage, TODAY, value), { stage: expected[0], dueOn: oracleAdd(TODAY, expected[1]) });
    }
  }
  for (const stage of [-1, 7, 0.5, '0', NaN]) invalid(() => reviewOutcome(stage, TODAY, 'good'));
  invalid(() => reviewOutcome(0, TODAY, 'unknown'));
  invalid(() => reviewOutcome(0, '9999-12-31', 'again'));
});

test('new cards are due on changedOn; repeated evaluation never advances their state', () => {
  const data = freeze(book());
  assert.deepEqual(evaluateNotebook(data, '2026-11-07').dueCardIds, []);
  const result = evaluateNotebook(data, TODAY);
  assert.deepEqual(result, { cards: [{ cardId: 'card', deckId: 'deck', version: 1, stage: 0,
    dueOn: TODAY, lastStudiedOn: null, reviewCount: 0, archived: false }],
  dueCardIds: ['card'], dueCount: 1, dueNewCount: 1, reviewedTodayCount: 0 });
  assert.equal(evaluateNotebook(data, '2030-01-01').cards[0].dueOn, TODAY);
  assert.deepEqual(evaluateNotebook(data, TODAY), result);
});

test('late reviews schedule from actual study date and cannot be early or repeated that day', () => {
  const source = freeze(book());
  invalid(() => grade(source, 'early', '2026-11-07'));
  const first = grade(source, 'one', '2026-11-12', 'easy');
  assert.equal(evaluateNotebook(first, '2026-11-12').cards[0].dueOn, '2026-11-15');
  invalid(() => grade(first, 'same', '2026-11-12'));
  invalid(() => grade(first, 'early', '2026-11-14'));
  const next = grade(first, 'two', '2026-11-20', 'good');
  assert.deepEqual(historyEntries(next).map(row => [row.stage, row.dueOn]), [[2, '2026-11-15'], [3, '2026-11-27']]);
  assert.equal(source.reviews.length, 0);
});

test('cross-card review dates may interleave; chronology is enforced separately per card', () => {
  let data = addCard(book(), card('card2'));
  data = grade(data, 'one', '2026-11-12', 'good');
  data = grade(data, 'two', '2026-11-08', 'good', 'card2');
  assert.deepEqual(data.reviews.map(review => review.studiedOn), ['2026-11-12', '2026-11-08']);
  invalid(() => grade(data, 'three', '2026-11-11'));
  assert.equal(evaluateNotebook(data, TODAY).reviewedTodayCount, 1);
});

test('content editing creates fresh due version with old history preserved, including same-day editing', () => {
  const first = grade(book(), 'one');
  const edited = updateCard(first, 'card', { front: '3 + 3?', back: '6', changedOn: TODAY, deckId: 'deck' });
  assert.equal(edited.cards[0].versions.length, 2);
  assert.deepEqual(edited.reviews, first.reviews);
  assert.equal(evaluateNotebook(edited, TODAY).cards[0].reviewCount, 0);
  assert.equal(evaluateNotebook(edited, TODAY).dueNewCount, 1);
  invalid(() => grade(edited, 'stale', TODAY, 'good', 'card', 1), 'review.expectedVersion');
  const reviewed = grade(edited, 'two', TODAY, 'again', 'card', 2);
  assert.equal(evaluateNotebook(reviewed, TODAY).reviewedTodayCount, 2);
  const history = historyEntries(reviewed);
  assert.deepEqual(history.map(row => [row.version, row.front, row.back, row.stage]), [[1, '2 + 3?', '5', 1], [2, '3 + 3?', '6', 0]]);
  invalid(() => updateCard(reviewed, 'card', { front: 'New', back: '6', changedOn: '2026-11-07', deckId: 'deck' }));
  const late = grade(book(), 'late', '2026-11-20');
  invalid(() => updateCard(late, 'card', { front: 'New', back: '6', changedOn: '2026-11-19', deckId: 'deck' }));
});

test('unchanged content and deck moves preserve version and progress; history uses current deck metadata', () => {
  let data = addDeck(grade(book(), 'one'), deck('other'));
  const moved = updateCard(data, 'card', { front: '2 + 3?', back: '5', changedOn: '0001-01-01', deckId: 'other' });
  assert.equal(moved.cards[0].versions.length, 1);
  assert.deepEqual(evaluateNotebook(moved, TODAY).cards[0], { ...evaluateNotebook(data, TODAY).cards[0], deckId: 'other' });
  data = replaceDeck(moved, { id: 'other', name: 'Novo nome', description: 'Descrição' });
  assert.deepEqual(historyEntries(data).map(row => [row.deckId, row.deckName]), [['other', 'Novo nome']]);
  invalid(() => updateCard(data, 'card', { front: '2 + 3?', back: '5', changedOn: TODAY, deckId: 'missing' }));
  invalid(() => updateCard(data, 'card', { front: '2 + 3?', back: '5', changedOn: TODAY, deckId: 'other', unknown: true }));
});

test('replay rejects missing references, invalid grades, version/date reversals and content gaps', () => {
  const valid = grade(book(), 'one');
  for (const change of [
    data => { data.cards[0].deckId = 'missing'; },
    data => { data.reviews[0].cardId = 'missing'; },
    data => { data.reviews[0].version = 2; },
    data => { data.reviews[0].version = 0; },
    data => { data.reviews[0].version = 1.5; },
    data => { data.reviews[0].grade = 'good\n'; },
    data => { data.reviews[0].studiedOn = '2026-11-07'; },
    data => { data.cards[0].archived = 1; },
    data => { data.cards[0].versions = []; },
    data => { data.reviews[0].extra = true; },
  ]) { const bad = clone(valid); change(bad); invalid(() => validateNotebook(bad)); }
  const later = updateCard(valid, 'card', { front: 'Novo', back: '5', changedOn: '2026-11-10', deckId: 'deck' });
  const afterNextContent = clone(later); afterNextContent.reviews[0].studiedOn = '2026-11-11';
  invalid(() => validateNotebook(afterNextContent));
  const backwardsContent = clone(later); backwardsContent.cards[0].versions[1].changedOn = '2026-11-07';
  invalid(() => validateNotebook(backwardsContent));
  const versionTwo = grade(later, 'two', '2026-11-10', 'good', 'card', 2);
  const reverseVersion = clone(versionTwo);
  reverseVersion.reviews.push({ id: 'three', cardId: 'card', version: 1, studiedOn: '2026-11-10', grade: 'again' });
  invalid(() => validateNotebook(reverseVersion));
  const duplicateDay = clone(valid); duplicateDay.reviews.push({ ...duplicateDay.reviews[0], id: 'two' });
  invalid(() => validateNotebook(duplicateDay));
  const overflow = book(); overflow.cards[0].versions[0].changedOn = '9999-12-31';
  overflow.reviews.push({ id: 'last', cardId: 'card', version: 1, studiedOn: '9999-12-31', grade: 'again' });
  invalid(() => validateNotebook(overflow));
});

test('archiving removes cards from the due queue, keeps history and forbids new study', () => {
  const data = setArchived(grade(book(), 'one'), 'card', true);
  assert.equal(data.reviews.length, 1);
  assert.equal(evaluateNotebook(data, TODAY).reviewedTodayCount, 1);
  assert.deepEqual(evaluateNotebook(data, '2026-12-01').dueCardIds, []);
  invalid(() => grade(data, 'two', '2026-11-09'));
  invalid(() => setArchived(data, 'card', 'false'));
  assert.deepEqual(evaluateNotebook(setArchived(data, 'card', false), '2026-11-09').dueCardIds, ['card']);
});

test('queue sorts by due date then ASCII card ID and ignores future and archived cards', () => {
  let data = addDeck(emptyNotebook('book'), deck());
  for (const [id, date] of [['z', TODAY], ['a', TODAY], ['A', TODAY], ['old', '2026-11-07'], ['future', '2026-11-09']]) {
    data = addCard(data, card(id, date));
  }
  data = setArchived(data, 'old', true);
  const evaluated = evaluateNotebook(data, TODAY);
  assert.deepEqual(evaluated.dueCardIds, ['A', 'a', 'z']);
  assert.equal(evaluated.dueNewCount, 3);
});

test('removing cards cascades only their reviews; removing decks requires no cards even if archived', () => {
  let data = addCard(grade(book(), 'one'), card('other'));
  data = grade(data, 'two', TODAY, 'good', 'other');
  invalid(() => removeDeck(setArchived(data, 'card', true), 'deck'));
  const next = removeCard(data, 'card');
  assert.deepEqual(next.reviews.map(review => review.id), ['two']);
  assert.deepEqual(next.cards.map(value => value.id), ['other']);
  assert.equal(data.cards.length, 2);
  const empty = removeCard(next, 'other');
  assert.equal(removeDeck(empty, 'deck').decks.length, 0);
  invalid(() => removeCard(next, 'missing'));
  invalid(() => replaceDeck(next, deck('missing')));
});

test('undo accepts only the last global review and preserves all content', () => {
  let data = addCard(grade(book(), 'one'), card('other'));
  data = grade(data, 'two', TODAY, 'easy', 'other');
  invalid(() => undoLastReview(data, 'one'));
  const undone = undoLastReview(data, 'two');
  assert.deepEqual(undone.cards, data.cards);
  assert.deepEqual(undone.reviews.map(review => review.id), ['one']);
  assert.equal(evaluateNotebook(undone, TODAY).dueNewCount, 1);
  invalid(() => undoLastReview(book(), 'missing'));
});

test('every rejected mutation is failure atomic, including batch imports and stale grading', () => {
  const source = freeze(book());
  const snapshot = JSON.stringify(source);
  const failures = [
    () => addCards(source, 'deck', [{ front: 'A', back: 'B' }, { front: ' ', back: 'B' }], TODAY, ['one', 'two']),
    () => addCards(source, 'deck', [{ front: 'A', back: 'B' }, { front: 'C', back: 'D' }], TODAY, ['same', 'same']),
    () => addCards(source, 'deck', [{ front: 'A', back: 'B' }], TODAY, []),
    () => addCards(source, 'missing', [], TODAY, []),
    () => addCards(source, 'deck', [{ front: 'A', back: 'B', unknown: 1 }], TODAY, ['new']),
    () => addCard(source, { ...card('new'), versions: [...card().versions, ...card().versions] }),
    () => grade(source, 'stale', TODAY, 'good', 'card', '1'),
    () => grade(source, 'bad', TODAY, 'bad'),
    () => updateCard(source, 'card', { front: 'New', back: ' ', changedOn: TODAY, deckId: 'deck' }),
  ];
  for (const failure of failures) { invalid(failure); assert.equal(JSON.stringify(source), snapshot); }
  const rows = freeze([{ front: ' A\nB ', back: 'C' }, { front: 'D', back: 'E' }]);
  const added = addCards(source, 'deck', rows, TODAY, ['one', 'two']);
  assert.equal(added.cards.length, 3);
  assert.equal(added.cards[1].versions[0].front, ' A\nB ');
  assert.deepEqual(addCards(source, 'deck', [], TODAY, []), source);
});

test('deck/card/version/batch maxima are inclusive and overflow leaves original intact', () => {
  const data = emptyNotebook('book');
  data.decks = Array.from({ length: 100 }, (_, index) => deck(`deck-${index}`));
  assert.equal(validateNotebook(data).decks.length, 100);
  invalid(() => addDeck(data, deck('over')));
  data.decks = [deck()];
  data.cards = Array.from({ length: 2000 }, (_, index) => card(`card-${index}`));
  assert.equal(validateNotebook(data).cards.length, 2000);
  invalid(() => addCard(data, card('over')));
  const versions = book();
  versions.cards[0].versions = Array.from({ length: 20 }, (_, index) => ({ front: String(index), back: 'B', changedOn: TODAY }));
  assert.equal(validateNotebook(versions).cards[0].versions.length, 20);
  invalid(() => updateCard(versions, 'card', { front: '21', back: 'B', changedOn: TODAY, deckId: 'deck' }));
  assert.equal(updateCard(versions, 'card', { front: '19', back: 'B', changedOn: TODAY, deckId: 'deck' }).cards[0].versions.length, 20);
  const rows = Array.from({ length: 500 }, () => ({ front: 'A', back: 'B' }));
  const ids = rows.map((_, index) => `import-${index}`);
  assert.equal(addCards(book(), 'deck', rows, TODAY, ids).cards.length, 501);
  invalid(() => addCards(book(), 'deck', [...rows, rows[0]], TODAY, [...ids, 'over']));
});

test('canonical compact JSON byte limit includes UTF-8 and escaping overhead', () => {
  const data = addDeck(emptyNotebook('book'), deck());
  data.cards = Array.from({ length: 600 }, (_, index) => ({ ...card(`card-${index}`),
    versions: [{ front: '😀'.repeat(4000), back: 'B', changedOn: TODAY }] }));
  assert.ok(JSON.stringify(data).length < LIMITS.maxJsonBytes);
  invalid(() => validateNotebook(data), 'json');
  const escaped = addDeck(emptyNotebook('book'), deck());
  escaped.cards = Array.from({ length: 1100 }, (_, index) => ({ ...card(`card-${index}`),
    versions: [{ front: '"'.repeat(4000), back: 'B', changedOn: TODAY }] }));
  invalid(() => validateNotebook(escaped), 'json');
});

test('canonical JSON accepts exactly 8 MiB and refuses one additional byte', () => {
  const data = addDeck(emptyNotebook('book'), deck());
  data.cards = Array.from({ length: 1100 }, (_, index) => ({ ...card(`card-${index}`),
    versions: [{ front: 'x'.repeat(4000), back: 'B', changedOn: TODAY }] }));
  let remaining = LIMITS.maxJsonBytes - new TextEncoder().encode(JSON.stringify(data)).byteLength;
  assert.ok(remaining > 0);
  for (const value of data.cards) {
    const take = Math.min(remaining, 3999);
    value.versions[0].back += 'b'.repeat(take);
    remaining -= take;
  }
  assert.equal(remaining, 0);
  assert.equal(new TextEncoder().encode(JSON.stringify(data)).byteLength, LIMITS.maxJsonBytes);
  assert.equal(validateNotebook(data).cards.length, 1100);
  const room = data.cards.find(value => value.versions[0].back.length < 4000);
  room.versions[0].back += 'b';
  invalid(() => validateNotebook(data), 'json');
});

test('history replay matches an independent per-version oracle across late/cross-day edits and resets', () => {
  const data = { schemaVersion: 1, id: 'book', title: '', decks: [deck()], cards: [
    { ...card('a', '2026-01-01'), versions: [
      { front: 'a1', back: 'A', changedOn: '2026-01-01' },
      { front: 'a2', back: 'AA', changedOn: '2026-02-01' },
    ] }, card('b', '2026-01-01'),
  ], reviews: [
    { id: 'r1', cardId: 'a', version: 1, studiedOn: '2026-01-02', grade: 'easy' },
    { id: 'r2', cardId: 'b', version: 1, studiedOn: '2026-01-01', grade: 'good' },
    { id: 'r3', cardId: 'a', version: 1, studiedOn: '2026-01-06', grade: 'good' },
    { id: 'r4', cardId: 'b', version: 1, studiedOn: '2026-01-03', grade: 'easy' },
    { id: 'r5', cardId: 'a', version: 1, studiedOn: '2026-01-20', grade: 'again' },
    { id: 'r6', cardId: 'a', version: 2, studiedOn: '2026-02-01', grade: 'good' },
    { id: 'r7', cardId: 'a', version: 2, studiedOn: '2026-02-05', grade: 'easy' },
  ] };
  const stages = new Map();
  const expected = [];
  for (const event of data.reviews) {
    const key = `${event.cardId}/${event.version}`;
    const previous = stages.get(key) ?? 0;
    const destination = event.grade === 'again' ? 0 : Math.min(6, previous + (event.grade === 'good' ? 1 : 2));
    stages.set(key, destination);
    const intervals = { 0: 1, 1: 1, 2: 3, 3: 7, 4: 14, 5: 30, 6: 60 };
    expected.push([event.id, event.version, destination, oracleAdd(event.studiedOn, intervals[destination])]);
  }
  assert.deepEqual(historyEntries(data).map(row => [row.reviewId, row.version, row.stage, row.dueOn]), expected);
  assert.deepEqual(evaluateNotebook(data, '2026-02-10').cards.map(row => [row.cardId, row.stage, row.dueOn, row.reviewCount]),
    [['a', 3, '2026-02-12', 2], ['b', 3, '2026-01-10', 2]]);
});

test('50,000-review history is supported in one replay and the 50,001st event is rejected', () => {
  const data = addDeck(emptyNotebook('book'), deck());
  data.cards = [card('card', '0001-01-01')];
  const start = utc('0001-01-01');
  data.reviews = Array.from({ length: LIMITS.maxReviews }, (_, index) => {
    const value = new Date(start.getTime() + index * 86400000);
    const studiedOn = `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
    return { id: `review-${index}`, cardId: 'card', version: 1, studiedOn, grade: 'again' };
  });
  const history = historyEntries(data);
  assert.equal(history.length, 50000);
  assert.equal(history.at(-1).dueOn, oracleAdd('0001-01-01', 50000));
  assert.ok(new TextEncoder().encode(JSON.stringify(data)).byteLength < LIMITS.maxJsonBytes);
  const snapshot = data.reviews.length;
  invalid(() => grade(data, 'over', oracleAdd('0001-01-01', 50000), 'again'));
  assert.equal(data.reviews.length, snapshot);
});

test('example data is fixed, validated, independent and entirely demonstrative', () => {
  const first = createExampleNotebook();
  assert.equal(first.decks.length, 2);
  assert.equal(first.cards.length, 6);
  assert.deepEqual(validateNotebook(first), first);
  assert.deepEqual(first, createExampleNotebook());
  assert.ok(first.reviews.length > 0);
  assert.equal(evaluateNotebook(first, TODAY).dueCount, 3);
  first.cards[0].versions[0].front = 'Changed';
  assert.notEqual(first.cards[0].versions[0].front, createExampleNotebook().cards[0].versions[0].front);
});
