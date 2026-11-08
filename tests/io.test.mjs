import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, ValidationError, validateNotebook } from '../src/domain.mjs';
import {
  backupFilename,
  exportBackup,
  exportCardsCsv,
  exportReviewsCsv,
  importBackup,
  parseCardsCsv,
} from '../src/io.mjs';

const utf8 = new TextEncoder();
const bytes = (value) => utf8.encode(value).byteLength;

function notebook() {
  return {
    schemaVersion: 1,
    id: 'io-notebook',
    title: 'Estudos de teste',
    decks: [
      { id: 'deck-one', name: 'Primeiro baralho', description: '' },
      { id: 'deck-two', name: 'Segundo baralho', description: '' },
    ],
    cards: [],
    reviews: [],
  };
}

function card(id, front = 'Pergunta', back = 'Resposta', deckId = 'deck-one') {
  return {
    id, deckId, archived: false,
    versions: [{ front, back, changedOn: '2026-11-01' }],
  };
}

// A regex-based reader independent of the production parser. It is used only
// to inspect generated exports, including quoted multiline cells.
function readExportedCsv(text, delimiter = ';') {
  assert.ok(text.startsWith('\uFEFF'));
  const source = text.slice(1);
  const separator = delimiter === ';' ? ';' : ',';
  const token = new RegExp(`("(?:[^"]|"")*"|[^"${separator}\\r\\n]*)(${separator}|\\r\\n|\\n|$)`, 'y');
  const records = [];
  let record = [];
  let position = 0;
  while (position < source.length) {
    token.lastIndex = position;
    const match = token.exec(source);
    assert.ok(match, `CSV exportado inválido no índice ${position}`);
    assert.ok(match[0].length > 0);
    const value = match[1].startsWith('"')
      ? match[1].slice(1, -1).replaceAll('""', '"')
      : match[1];
    record.push(value);
    position = token.lastIndex;
    if (match[2] !== delimiter) {
      records.push(record);
      record = [];
    }
  }
  assert.equal(record.length, 0);
  return records;
}

function jsonAtLimit(targetBytes) {
  const data = notebook();
  data.cards = Array.from({ length: 1100 }, (_, index) => card(`card-${String(index).padStart(4, '0')}`, 'x', 'y'));
  let remaining = targetBytes - bytes(JSON.stringify(data));
  assert.ok(remaining > 0);
  for (const entry of data.cards) {
    for (const field of ['front', 'back']) {
      const addition = Math.min(3999, remaining);
      entry.versions[0][field] = (field === 'front' ? 'x' : 'y').repeat(1 + addition);
      remaining -= addition;
    }
  }
  assert.equal(remaining, 0);
  // Four ASCII bytes become four UTF-8 bytes but only two UTF-16 code units.
  const first = data.cards[0].versions[0];
  first.front = `😀${first.front.slice(4)}`;
  assert.equal(bytes(JSON.stringify(data)), targetBytes);
  return data;
}

test('CSV parses BOM, escaped quotes, LF and CRLF with multiline cells', () => {
  const input = '\uFEFF"Frente";"Verso"\r\n"Uma; pergunta ""curta""\r\nsegunda linha";"Resposta 😀"\r\nOutra;Última\n';
  assert.deepEqual(parseCardsCsv(input), [
    { front: 'Uma; pergunta "curta"\nsegunda linha', back: 'Resposta 😀' },
    { front: 'Outra', back: 'Última' },
  ]);
  assert.deepEqual(parseCardsCsv('Frente;Verso'), []);
  assert.deepEqual(parseCardsCsv('Frente;Verso\r\n'), []);
  assert.deepEqual(parseCardsCsv('Frente;Verso\n"a\nb";c'), [{ front: 'a\nb', back: 'c' }]);
});

test('CSV delimiter is explicit and supports comma without inferring it', () => {
  assert.deepEqual(parseCardsCsv('Frente,Verso\n"a,b",c', { delimiter: ',' }), [{ front: 'a,b', back: 'c' }]);
  assert.throws(() => parseCardsCsv('Frente,Verso\na,b'), ValidationError);
  for (const delimiter of ['', '|', '\t', ';;', null, 1]) {
    assert.throws(() => parseCardsCsv('Frente;Verso', { delimiter }), ValidationError);
  }
  assert.throws(() => parseCardsCsv('Frente;Verso', null), ValidationError);
  assert.throws(() => parseCardsCsv(null), ValidationError);
});

test('CSV requires the exact header and exactly two cells in every record', () => {
  for (const input of [
    '', 'frente;Verso', 'Verso;Frente', ' Frente;Verso', 'Frente;Verso;Outra',
    'Frente;Verso\na', 'Frente;Verso\na;b;c', 'Frente;Verso\na;b;',
    'Frente;Verso\na;b\n\n', 'Frente;Verso\n;a', 'Frente;Verso\na;   ',
  ]) assert.throws(() => parseCardsCsv(input), ValidationError);
});

test('CSV rejects malformed quoting and bare CR without echoing private text', () => {
  for (const body of ['"segredo não publicável;b', 'segredo"não publicável;b', '"segredo não publicável"x;b', 'segredo não publicável;b\r']) {
    assert.throws(() => parseCardsCsv(`Frente;Verso\n${body}`), (error) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.field, 'csv');
      assert.doesNotMatch(error.message, /segredo|publicável/);
      return true;
    });
  }
  assert.throws(() => parseCardsCsv('Frente;Verso\n"a\rb";c'), ValidationError);
});

test('CSV enforces Unicode scalar and control-character rules', () => {
  for (const forbidden of ['\u0000', '\u000B', '\u007F', '\u0085', '\uD800', '\uDC00']) {
    assert.throws(() => parseCardsCsv(`Frente;Verso\na${forbidden};b`), ValidationError);
  }
  assert.deepEqual(parseCardsCsv('Frente;Verso\na\tb;ação 😀'), [{ front: 'a\tb', back: 'ação 😀' }]);
  assert.equal(parseCardsCsv(`Frente;Verso\n${'😀'.repeat(4000)};b`)[0].front.length, 8000);
  assert.throws(() => parseCardsCsv(`Frente;Verso\n${'😀'.repeat(4001)};b`), ValidationError);
  assert.throws(() => parseCardsCsv(`Frente;Verso\na;${'b'.repeat(4001)}`), ValidationError);
});

test('CSV accepts 500 rows and rejects the whole document at row 501', () => {
  const data = `Frente;Verso\n${Array.from({ length: 500 }, (_, index) => `Pergunta ${index};Resposta ${index}`).join('\n')}\n`;
  assert.equal(parseCardsCsv(data).length, 500);
  assert.throws(() => parseCardsCsv(`${data}Excesso;Resposta\n`), ValidationError);
  assert.throws(() => parseCardsCsv(`${data}Última;\n`), ValidationError);
});

test('CSV measures its inclusive 1 MiB limit in UTF-8 bytes', () => {
  const entries = Array.from({ length: 140 }, () => ({ front: 'x', back: 'y' }));
  const render = () => `Frente;Verso\n${entries.map((entry) => `${entry.front};${entry.back}`).join('\n')}\n`;
  let remaining = 1024 * 1024 - bytes(render());
  for (const entry of entries) {
    for (const field of ['front', 'back']) {
      const addition = Math.min(3999, remaining);
      entry[field] = entry[field].repeat(1 + addition);
      remaining -= addition;
    }
  }
  assert.equal(remaining, 0);
  const exact = render();
  assert.equal(bytes(exact), 1024 * 1024);
  assert.equal(parseCardsCsv(exact).length, 140);
  assert.throws(() => parseCardsCsv(`${exact}x`), /1 MiB/);
  assert.throws(() => parseCardsCsv(`Frente;Verso\n${'😀'.repeat(300000)};b`), /1 MiB/);
  assert.throws(() => parseCardsCsv(`\uFEFF${exact}`), /1 MiB/);
});

test('card export contains only current, nonarchived cards of the chosen deck', () => {
  const data = notebook();
  const current = card('current', 'Antiga', 'Antigo verso');
  current.versions.push({ front: 'Atual; "com aspas"\nOutra linha 😀', back: 'Ação, resposta', changedOn: '2026-11-02' });
  const archived = card('archived');
  archived.archived = true;
  data.cards.push(current, archived, card('other', 'Outro', 'Outro verso', 'deck-two'));
  const before = JSON.stringify(data);
  const result = exportCardsCsv(data, 'deck-one');
  assert.ok(result.endsWith('\r\n'));
  assert.deepEqual(readExportedCsv(result), [
    ['Frente', 'Verso'], ['Atual; "com aspas"\nOutra linha 😀', 'Ação, resposta'],
  ]);
  assert.deepEqual(readExportedCsv(exportCardsCsv(data, 'deck-one', { delimiter: ',' }), ','), [
    ['Frente', 'Verso'], ['Atual; "com aspas"\nOutra linha 😀', 'Ação, resposta'],
  ]);
  assert.equal(JSON.stringify(data), before);
  assert.throws(() => exportCardsCsv(data, 'missing'), ValidationError);
  assert.throws(() => exportCardsCsv(data, 'deck-one', { delimiter: '\t' }), ValidationError);
});

test('card export neutralizes spreadsheet formulas before quoting and preserves Unicode', () => {
  const data = notebook();
  const fronts = ['=1+1', '+2', '-3', '@SUM(A1)', '  =1;"quoted"', '\tordinary', '\nordinary', '\u200B=1', '＝1+1', '＋2', '－3', '＠SUM(A1)'];
  data.cards = fronts.map((front, index) => card(`formula-${index}`, front, 'Resposta 😀'));
  const exported = exportCardsCsv(data, 'deck-one');
  const parsed = readExportedCsv(exported);
  assert.deepEqual(parsed.slice(1), fronts.map((front) => [`'${front}`, 'Resposta 😀']));
  assert.ok(exported.includes('"\'  =1;""quoted"""'));
  data.cards = [card('literal', "'=já protegido", '普通の文字')];
  assert.deepEqual(readExportedCsv(exportCardsCsv(data, 'deck-one'))[1], ["'=já protegido", '普通の文字']);
  assert.deepEqual(parseCardsCsv(exportCardsCsv(data, 'deck-one')), [{ front: "'=já protegido", back: '普通の文字' }]);
});

test('header-only export is valid for an empty or fully archived deck', () => {
  const data = notebook();
  const archived = card('archived');
  archived.archived = true;
  data.cards.push(archived);
  assert.equal(exportCardsCsv(data, 'deck-one'), '\uFEFFFrente;Verso\r\n');
  assert.deepEqual(parseCardsCsv(exportCardsCsv(data, 'deck-one')), []);
});

function versionedNotebook() {
  const data = notebook();
  data.decks[1].name = '=Nome atual; "renomeado"';
  const versioned = card('versioned', 'Frente antiga; "citada"\nsegunda linha', 'Verso antigo', 'deck-two');
  versioned.versions.push({ front: '=Frente nova 😀', back: 'Verso novo', changedOn: '2026-11-03' });
  versioned.archived = true;
  data.cards.push(versioned);
  data.reviews.push(
    { id: 'review-one', cardId: 'versioned', version: 1, studiedOn: '2026-11-01', grade: 'good' },
    { id: 'review-two', cardId: 'versioned', version: 1, studiedOn: '2026-11-02', grade: 'easy' },
    { id: 'review-three', cardId: 'versioned', version: 2, studiedOn: '2026-11-03', grade: 'again' },
    { id: 'review-four', cardId: 'versioned', version: 2, studiedOn: '2026-11-04', grade: 'easy' },
  );
  return data;
}

test('history export uses each event version, replay result and the current deck name', () => {
  const data = versionedNotebook();
  const before = JSON.stringify(data);
  const rows = readExportedCsv(exportReviewsCsv(data));
  assert.deepEqual(rows[0], [
    'Revisão ID', 'Baralho ID', 'Baralho atual', 'Cartão ID', 'Versão',
    'Frente', 'Data de estudo', 'Avaliação', 'Estágio', 'Próxima revisão',
  ]);
  assert.deepEqual(rows.slice(1), [
    ['review-one', 'deck-two', '\'=Nome atual; "renomeado"', 'versioned', '1', 'Frente antiga; "citada"\nsegunda linha', '2026-11-01', 'good', '1', '2026-11-02'],
    ['review-two', 'deck-two', '\'=Nome atual; "renomeado"', 'versioned', '1', 'Frente antiga; "citada"\nsegunda linha', '2026-11-02', 'easy', '3', '2026-11-09'],
    ['review-three', 'deck-two', '\'=Nome atual; "renomeado"', 'versioned', '2', '\'=Frente nova 😀', '2026-11-03', 'again', '0', '2026-11-04'],
    ['review-four', 'deck-two', '\'=Nome atual; "renomeado"', 'versioned', '2', '\'=Frente nova 😀', '2026-11-04', 'easy', '2', '2026-11-07'],
  ]);
  assert.equal(JSON.stringify(data), before);
  assert.equal(readExportedCsv(exportReviewsCsv(notebook())).length, 1);
});

test('JSON backup preserves versions, history, archived cards and exact editable text', () => {
  const data = versionedNotebook();
  const before = JSON.stringify(data);
  const backup = exportBackup(data);
  assert.ok(backup.endsWith('\n'));
  assert.ok(backup.includes('\n  "schemaVersion": 1,'));
  const imported = importBackup(backup);
  assert.deepEqual(imported, validateNotebook(data));
  assert.equal(imported.cards[0].versions[1].front, '=Frente nova 😀');
  imported.cards[0].versions[0].front = 'Mudança somente no clone';
  assert.equal(JSON.stringify(data), before);
});

test('JSON backup falls back to compact with newline, then exactly 8 MiB without newline', () => {
  const almost = jsonAtLimit(LIMITS.maxJsonBytes - 1);
  const withNewline = exportBackup(almost);
  assert.equal(bytes(withNewline), LIMITS.maxJsonBytes);
  assert.ok(withNewline.endsWith('\n'));
  assert.equal(withNewline, `${JSON.stringify(almost)}\n`);
  assert.deepEqual(importBackup(withNewline), almost);

  const exact = jsonAtLimit(LIMITS.maxJsonBytes);
  const withoutNewline = exportBackup(exact);
  assert.equal(bytes(withoutNewline), LIMITS.maxJsonBytes);
  assert.ok(!withoutNewline.endsWith('\n'));
  assert.equal(withoutNewline, JSON.stringify(exact));
  assert.deepEqual(importBackup(withoutNewline), exact);
  assert.throws(() => importBackup(`${withoutNewline}\n`), ValidationError);
  exact.cards.at(-1).versions[0].back += 'x';
  assert.throws(() => exportBackup(exact), ValidationError);
});

test('JSON import rejects invalid structure, duplicate keys and invalid replay atomically', () => {
  const original = versionedNotebook();
  const before = JSON.stringify(original);
  const badHistory = structuredClone(original);
  badHistory.reviews[1].studiedOn = '2026-11-01';
  const badVersion = structuredClone(original);
  badVersion.reviews[0].version = 0;
  const unknown = structuredClone(original);
  unknown.privateUnknown = 'segredo não publicável';
  const wrongSchema = { ...original, schemaVersion: 2 };
  for (const text of [
    '{', '{"schemaVersion":1,"schemaVersion":1}',
    JSON.stringify(badHistory), JSON.stringify(badVersion), JSON.stringify(unknown), JSON.stringify(wrongSchema),
    '{"constructor":{"prototype":{}}}',
  ]) {
    assert.throws(() => importBackup(text), (error) => {
      assert.ok(error instanceof ValidationError);
      assert.doesNotMatch(error.message, /segredo|publicável/);
      return true;
    });
    assert.equal(JSON.stringify(original), before);
  }
  assert.throws(() => exportBackup(unknown), ValidationError);
  assert.throws(() => exportCardsCsv(badHistory, 'deck-one'), ValidationError);
  assert.throws(() => exportReviewsCsv(badVersion), ValidationError);
});

test('backup filenames are bounded ASCII names with safe IDs and allowed extensions', () => {
  const data = notebook();
  data.title = 'Revisões / ação: 😀 <arquivo> ..';
  assert.equal(backupFilename(data), 'caderno-revisoes-acao-arquivo-io-notebook.json');
  assert.equal(backupFilename(data, 'csv'), 'caderno-revisoes-acao-arquivo-io-notebook.csv');
  data.title = '😀';
  assert.equal(backupFilename(data), 'caderno-estudos-io-notebook.json');
  data.title = 'x'.repeat(120);
  data.id = 'N'.repeat(80);
  const name = backupFilename(data);
  assert.ok(name.length <= 142);
  assert.match(name, /^[A-Za-z0-9_-]+\.json$/u);
  assert.ok(name.includes(data.id));
  for (const extension of ['html', '../json', '.json', 'JSON', '', null]) {
    assert.throws(() => backupFilename(data, extension), ValidationError);
  }
});
