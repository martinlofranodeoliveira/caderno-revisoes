import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { IDBFactory } from 'fake-indexeddb';
import { createApp } from '../src/app.mjs';
import { openNotebookStore, StorageError } from '../src/storage.mjs';
import { emptyNotebook, addDeck, addCards, createExampleNotebook, evaluateNotebook } from '../src/domain.mjs';
import { exportBackup, importBackup } from '../src/io.mjs';

const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
let serial = 0;
async function fixture(options = {}) {
  const { window, document } = parseHTML(markup), downloads = [], indexedDB = options.indexedDB || new IDBFactory();
  const dbName = 'study-ui-' + ++serial; let id = 0;
  if (options.notebook) { const seed = await openNotebookStore({ indexedDB, dbName }); await seed.save(options.notebook, 0); seed.close(); }
  const app = await createApp({ document, eventTarget: window, makeId: () => `${dbName}-${++id}`, today: options.today || (() => '2026-11-08'),
    storeFactory: options.storeFactory || (() => openNotebookStore({ indexedDB, dbName })), onDownload: (...args) => downloads.push(args) });
  const $ = id => document.getElementById(id);
  const dispatch = async (el, type) => { el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true })); await app.whenIdle(); };
  const click = id => dispatch($(id), 'click');
  const input = async (id, value) => { $(id).value = value; await dispatch($(id), 'input'); };
  const select = async (id, value) => { for (const option of $(id).querySelectorAll('option')) option.selected = option.getAttribute('value') === value; await dispatch($(id), 'change'); };
  const submit = id => dispatch($(id), 'submit');
  const file = async (id, f) => { Object.defineProperty($(id), 'files', { configurable: true, value: [f] }); await dispatch($(id), 'change'); };
  const remember = async value => { $('remember').checked = value; await dispatch($('remember'), 'change'); };
  return { app, document, window, $, dispatch, click, input, select, submit, file, remember, downloads, dbName, indexedDB,
    otherStore: () => openNotebookStore({ indexedDB, dbName }) };
}
const fileOf = (text, name = 'exemplo.csv') => { const bytes = new TextEncoder().encode(text); return { name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }; };
async function addTestDeck(f, name = 'Meu assunto') { await f.click('new-deck'); await f.input('deck-name', name); await f.submit('deck-form'); return f.app.getNotebook().decks.at(-1).id; }
async function addTestCard(f, front = '2 + 2?', back = '4') { await f.click('new-card'); await f.input('card-front', front); await f.input('card-back', back); await f.submit('card-form'); return f.app.getNotebook().cards.at(-1).id; }
async function openFirst(f) { await f.click('nav-today'); await f.dispatch(f.$('queue-list').querySelector('[data-study]'), 'click'); }

test('first open is empty without an implicit saved notebook', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); assert.equal(f.app.getNotebook().cards.length, 0); assert.equal(f.$('queue-empty').hidden, false);
  const db = await f.otherStore(); t.after(() => db.close()); assert.deepEqual(await db.load(), { revision: 0, notebook: null }); assert.equal(f.$('remember').checked, false);
});

test('deck and card forms commit only complete valid data and preserve failed input', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await f.click('new-deck'); await f.submit('deck-form'); assert.equal(f.app.getNotebook().decks.length, 0);
  await f.input('deck-name', 'Prática'); await f.submit('deck-form'); await f.click('new-card'); await f.input('card-front', 'Pergunta em edição'); await f.submit('card-form');
  assert.equal(f.app.getNotebook().cards.length, 0); assert.equal(f.$('card-front').value, 'Pergunta em edição'); assert.equal(f.$('card-back').getAttribute('aria-invalid'), 'true');
  await f.input('card-back', 'Resposta'); await f.submit('card-form'); assert.equal(f.app.getNotebook().cards.length, 1);
});

test('question is opened inline, answer is hidden until reveal and grade registers once', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f); await openFirst(f);
  assert.equal(f.$('study-answer'), null); assert.equal(f.$('grade-good'), null); assert.equal(f.app.getNotebook().reviews.length, 0);
  await f.click('reveal-answer'); assert.match(f.$('study-answer').textContent, /4/); await f.click('grade-good');
  const data = f.app.getNotebook(); assert.equal(data.reviews.length, 1); assert.equal(data.reviews[0].grade, 'good'); assert.equal(evaluateNotebook(data, '2026-11-08').cards[0].dueOn, '2026-11-09');
  assert.equal(f.$('queue-empty').hidden, false); await f.click('undo'); assert.equal(f.app.getNotebook().reviews.length, 0);
});

test('a double click while a grade is saving does not register another answer', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f); await f.click('nav-backup'); await f.remember(true); await openFirst(f); await f.click('reveal-answer');
  const rate = f.$('grade-easy'); rate.dispatchEvent(new f.window.Event('click', { bubbles: true, cancelable: true })); rate.dispatchEvent(new f.window.Event('click', { bubbles: true, cancelable: true })); await f.app.whenIdle();
  assert.equal(f.app.getNotebook().reviews.length, 1); assert.equal(f.app.getNotebook().reviews[0].grade, 'easy');
});

test('auto next opens another question without revealing or evaluating it', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f, 'Primeira', 'A'); await addTestCard(f, 'Segunda', 'B'); await openFirst(f); await f.click('reveal-answer'); await f.click('grade-good');
  assert.equal(f.app.getNotebook().reviews.length, 1); assert.ok(f.$('reveal-answer')); assert.equal(f.$('study-answer'), null); assert.equal(f.$('grade-good'), null);
});

test('changing day between opening and grading refreshes the queue without an old-day event', async t => {
  let day = '2026-11-08'; const f = await fixture({ today: () => day }); t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f); await openFirst(f); await f.click('reveal-answer');
  day = '2026-11-09'; await f.click('grade-good'); assert.equal(f.app.getNotebook().reviews.length, 0); assert.match(f.$('today-label').textContent, /09\/11\/2026/); assert.equal(f.$('grade-good'), null);
  await openFirst(f); await f.click('reveal-answer'); await f.click('grade-good'); assert.equal(f.app.getNotebook().reviews[0].studiedOn, day);
});

test('editing text starts a new version while retaining history and its original front', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); const cardId = await addTestCard(f, '2 + 2?', '4'); await openFirst(f); await f.click('reveal-answer'); await f.click('grade-good');
  await f.click('nav-library'); await f.dispatch(f.$('card-list').querySelector('[data-edit-card]'), 'click'); await f.input('card-front', '2 + 3?'); await f.input('card-back', '5'); await f.submit('card-form');
  const data = f.app.getNotebook(); assert.equal(data.cards[0].versions.length, 2); assert.equal(data.reviews.length, 1); assert.equal(data.reviews[0].version, 1);
  const current = evaluateNotebook(data, '2026-11-08').cards.find(c => c.cardId === cardId); assert.equal(current.stage, 0); assert.equal(current.dueOn, '2026-11-08');
  await f.click('nav-history'); assert.match(f.$('history-list').textContent, /2 \+ 2/); assert.ok(!f.$('history-list').textContent.includes('2 + 3?'));
});

test('moving a card without text change preserves version and schedule', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); const first = await addTestDeck(f, 'Primeiro'); await addTestCard(f); await openFirst(f); await f.click('reveal-answer'); await f.click('grade-easy');
  const second = await addTestDeck(f, 'Segundo'); await f.dispatch(f.$('deck-list').querySelector(`[data-deck="${first}"]`), 'click'); await f.dispatch(f.$('card-list').querySelector('[data-edit-card]'), 'click'); await f.select('card-deck', second); await f.submit('card-form');
  const data = f.app.getNotebook(); assert.equal(data.cards[0].deckId, second); assert.equal(data.cards[0].versions.length, 1); assert.equal(evaluateNotebook(data, '2026-11-08').cards[0].dueOn, '2026-11-11');
});

test('archive hides a due card while exclusion requires confirmation and can be undone', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f); await f.dispatch(f.$('card-list').querySelector('[data-archive-card]'), 'click');
  assert.equal(f.app.getNotebook().cards[0].archived, true); await f.click('nav-today'); assert.equal(f.$('queue-empty').hidden, false); await f.click('nav-library');
  f.$('show-archived').checked = true; await f.dispatch(f.$('show-archived'), 'change'); await f.dispatch(f.$('card-list').querySelector('[data-ask-remove-card]'), 'click');
  assert.equal(f.app.getNotebook().cards.length, 1); await f.click('cancel-remove-card'); assert.equal(f.app.getNotebook().cards.length, 1);
  await f.dispatch(f.$('card-list').querySelector('[data-ask-remove-card]'), 'click'); await f.click('remove-card'); assert.equal(f.app.getNotebook().cards.length, 0); await f.click('undo'); assert.equal(f.app.getNotebook().cards.length, 1);
});

test('unsaved text blocks navigation and export without replacing the current fields', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await f.click('new-card'); await f.input('card-front', 'Ainda em edição'); await f.click('nav-backup'); assert.equal(f.$('view-library').hidden, false); assert.equal(f.$('card-front').value, 'Ainda em edição');
  await f.click('export-backup'); assert.equal(f.downloads.length, 0); await f.click('cancel-card'); await f.click('nav-backup'); assert.equal(f.$('view-backup').hidden, false);
});

test('exports, cancelled editing and invalid imports preserve the last available undo', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f); await openFirst(f); await f.click('reveal-answer'); await f.click('grade-good');
  await f.click('nav-backup'); await f.click('export-backup'); assert.equal(f.$('undo').hidden, false); assert.equal(f.$('undo').textContent, 'Desfazer última avaliação');
  await f.click('undo'); assert.equal(f.app.getNotebook().reviews.length, 0); assert.equal(f.$('undo').hidden, true);
  await f.click('nav-library'); const original = f.app.getNotebook(); await f.dispatch(f.$('card-list').querySelector('[data-ask-remove-card]'), 'click'); await f.click('remove-card');
  await f.click('new-card'); await f.input('card-front', 'Rascunho cancelado'); await f.click('cancel-card'); assert.equal(f.$('undo').hidden, false);
  await f.click('nav-backup'); await f.file('import-file', fileOf('{"invalid":true}', 'invalid.json')); await f.click('export-backup');
  assert.equal(f.$('undo').hidden, false); assert.equal(f.app.getNotebook().cards.length, 0); await f.click('undo'); assert.deepEqual(f.app.getNotebook(), original); assert.equal(f.$('undo').hidden, true);
});

test('CSV is staged atomically and delimiter changes invalidate the previous preview', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await f.click('toggle-csv'); await f.file('csv-file', fileOf('Frente;Verso\r\n"Pergunta\nmultilinha";"Resposta"\r\n'));
  assert.equal(f.app.getNotebook().cards.length, 0); assert.equal(f.$('csv-confirm').hidden, false);
  await f.select('csv-delimiter', ','); assert.equal(f.$('csv-confirm').hidden, true); await f.click('confirm-csv'); assert.equal(f.app.getNotebook().cards.length, 0);
  await f.file('csv-file', fileOf('Frente,Verso\nA,B\n')); await f.click('confirm-csv'); assert.equal(f.app.getNotebook().cards[0].versions[0].front, 'A');
});

test('oversized or malformed UTF-8 input clears staging and cannot add old rows', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await f.click('toggle-csv'); await f.file('csv-file', fileOf('Frente;Verso\nA;B\n')); assert.equal(f.$('csv-confirm').hidden, false);
  let read = false; await f.file('csv-file', { name: 'large.csv', size: 1048577, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } });
  assert.equal(read, false); assert.equal(f.$('csv-confirm').hidden, true); await f.click('confirm-csv'); assert.equal(f.app.getNotebook().cards.length, 0);
  await f.file('csv-file', { name: 'invalid.csv', size: 2, arrayBuffer: async () => Uint8Array.of(0xc3, 0x28).buffer }); assert.equal(f.$('csv-confirm').hidden, true); assert.equal(f.app.getNotebook().cards.length, 0);
});

test('JSON restore confirms before replacement and rejects a new oversized selection atomically', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await f.click('nav-backup'); const before = f.app.getNotebook(), data = createExampleNotebook();
  await f.file('import-file', fileOf(exportBackup(data), 'backup.json')); assert.deepEqual(f.app.getNotebook(), before); assert.equal(f.$('import-confirm').hidden, false);
  await f.file('import-file', { name: 'too-large.json', size: 8388609, arrayBuffer: async () => { throw Error('must not read'); } }); await f.click('confirm-import'); assert.deepEqual(f.app.getNotebook(), before);
  await f.file('import-file', fileOf(exportBackup(data), 'backup.json')); await f.click('confirm-import'); assert.deepEqual(f.app.getNotebook(), data);
  await f.click('nav-backup'); await f.click('export-backup'); assert.deepEqual(importBackup(f.downloads[0][0]), data);
});

test('example requires confirmation when only a custom notebook name exists', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await f.click('nav-backup'); await f.input('notebook-title', 'Meu caderno real'); await f.click('rename-notebook'); await f.click('nav-today'); await f.click('load-example');
  assert.equal(f.app.getNotebook().title, 'Meu caderno real'); assert.equal(f.$('confirm-example').hidden, false); await f.click('cancel-example'); assert.equal(f.app.getNotebook().title, 'Meu caderno real');
  await f.click('load-example'); await f.click('confirm-example-replace'); assert.equal(f.app.getNotebook().cards.length, 6);
});

test('a competing saved revision preserves both study versions and reload also requires confirmation', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f); await f.click('nav-backup'); await f.remember(true);
  const db = await f.otherStore(); t.after(() => db.close()); const remote = await db.load(); remote.notebook.title = 'Outra aba'; await db.save(remote.notebook, remote.revision);
  await openFirst(f); await f.click('reveal-answer'); await f.click('grade-good'); assert.equal(f.app.getNotebook().reviews.length, 1); assert.equal((await db.load()).notebook.reviews.length, 0); assert.match(f.$('save-status').textContent, /Conflito/);
  await f.click('nav-backup'); await f.click('export-backup'); assert.equal(importBackup(f.downloads[0][0]).reviews.length, 1);
  await f.click('reload-saved'); assert.equal(f.app.getNotebook().reviews.length, 1); await f.click('confirm-reload-replace'); assert.equal(f.app.getNotebook().title, 'Outra aba'); assert.equal(f.app.getNotebook().reviews.length, 0);
});

test('quota failure keeps study and exact backup available in memory', async t => {
  const f = await fixture({ storeFactory: async () => ({ load: async () => ({ revision: 0, notebook: null }), save: async () => { throw new StorageError('quota'); }, close() {} }) });
  t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f); await f.click('nav-backup'); await f.remember(true); await openFirst(f); await f.click('reveal-answer'); await f.click('grade-good');
  assert.match(f.$('save-status').textContent, /pausado/); await f.click('nav-backup'); await f.click('export-backup'); assert.equal(importBackup(f.downloads[0][0]).reviews.length, 1);
});

test('display pagination reaches all cards and navigation states stay correct after busy actions', async t => {
  let data = addDeck(emptyNotebook('many-notes'), { id: 'many-deck', name: 'Muitos', description: '' });
  data = addCards(data, 'many-deck', Array.from({ length: 101 }, (_, i) => ({ front: 'Pergunta ' + i, back: 'Resposta ' + i })), '2026-11-08', Array.from({ length: 101 }, (_, i) => 'card-' + String(i).padStart(3, '0')));
  const f = await fixture({ notebook: data }); t.after(() => f.app.destroy()); assert.equal(f.$('queue-list').children.length, 50); assert.equal(f.$('queue-prev').disabled, true); assert.equal(f.$('queue-next').disabled, false);
  await f.click('queue-next'); assert.equal(f.$('queue-prev').disabled, false); assert.match(f.$('queue-page-info').textContent, /51–100 de 101/);
  await f.click('queue-next'); assert.equal(f.$('queue-list').children.length, 1); assert.equal(f.$('queue-next').disabled, true); await f.click('queue-prev'); assert.equal(f.$('queue-list').children.length, 50);
});

test('initial pending load blocks actions until the verified saved notebook is ready', async t => {
  const { window, document } = parseHTML(markup); let finish; const gate = new Promise(resolve => { finish = resolve; });
  const init = createApp({ document, eventTarget: window, today: () => '2026-11-08', makeId: () => 'initial-note', storeFactory: () => ({ load: () => gate, close() {} }) });
  const $ = id => document.getElementById(id); assert.equal($('new-deck').disabled, true); $('new-deck').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })); assert.equal($('deck-form').hidden, true);
  const saved = createExampleNotebook(); finish({ revision: 3, notebook: saved }); const app = await init; t.after(() => app.destroy()); assert.deepEqual(app.getNotebook(), saved); assert.equal($('new-deck').disabled, false);
});

test('question and answer strings stay text in practice, history and backup', async t => {
  const f = await fixture(); t.after(() => f.app.destroy()); await addTestDeck(f); await addTestCard(f, '<img src=x onerror=alert(1)>', '<script>alert(1)</script>'); await openFirst(f); await f.click('reveal-answer');
  assert.equal(f.$('queue-list').querySelectorAll('img,script').length, 0); await f.click('grade-good'); await f.click('nav-history'); assert.equal(f.$('history-list').querySelectorAll('img,script').length, 0);
  await f.click('nav-backup'); await f.click('export-backup'); assert.equal(importBackup(f.downloads[0][0]).cards[0].versions[0].back, '<script>alert(1)</script>');
});
