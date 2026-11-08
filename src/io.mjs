import {
  LIMITS,
  ValidationError,
  historyEntries,
  parseNotebookJson,
  validateNotebook,
} from './domain.mjs';

const encoder = new TextEncoder();
const MAX_CSV_BYTES = 1024 * 1024;
const BOM = '\uFEFF';

function fail(field, message) {
  throw new ValidationError(field, message);
}

function delimiterFrom(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    fail('csv', 'As opções do CSV são inválidas.');
  }
  const delimiter = options.delimiter === undefined ? ';' : options.delimiter;
  if (delimiter !== ';' && delimiter !== ',') {
    fail('csv', 'Escolha ponto e vírgula ou vírgula como delimitador.');
  }
  return delimiter;
}

function validateCell(value, field, maxLength, recordNumber) {
  if (!value.trim()) {
    fail('csv', `O registro ${recordNumber} precisa ter frente e verso preenchidos.`);
  }
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    if ((point < 32 && point !== 9 && point !== 10) ||
        (point >= 127 && point <= 159) ||
        (point >= 0xD800 && point <= 0xDFFF)) {
      fail('csv', `O registro ${recordNumber} contém caracteres não permitidos.`);
    }
    length += 1;
    if (length > maxLength) {
      fail('csv', `O campo ${field} do registro ${recordNumber} excede o limite de ${maxLength} caracteres.`);
    }
  }
}

/** Return an exact, validated JSON backup without exceeding the import limit. */
export function exportBackup(data) {
  const notebook = validateNotebook(data);
  const pretty = `${JSON.stringify(notebook, null, 2)}\n`;
  if (encoder.encode(pretty).byteLength <= LIMITS.maxJsonBytes) return pretty;
  const compact = JSON.stringify(notebook);
  if (encoder.encode(compact).byteLength < LIMITS.maxJsonBytes) return `${compact}\n`;
  return compact;
}

export function importBackup(text) {
  return parseNotebookJson(text);
}

/** Parse the explicitly selected CSV dialect; records are validated atomically. */
export function parseCardsCsv(text, options = {}) {
  const delimiter = delimiterFrom(options);
  if (typeof text !== 'string') fail('csv', 'O CSV precisa ser texto.');
  if (text.length > MAX_CSV_BYTES || encoder.encode(text).byteLength > MAX_CSV_BYTES) {
    fail('csv', 'O CSV excede o limite de 1 MiB.');
  }
  const source = text.startsWith(BOM) ? text.slice(1) : text;
  const rows = [];
  let cells = [];
  let cell = '';
  let mode = 'start';
  let recordNumber = 0;

  const finishCell = () => {
    cells.push(cell);
    cell = '';
    mode = 'start';
  };
  const finishRecord = () => {
    finishCell();
    recordNumber += 1;
    if (recordNumber === 1) {
      if (cells.length !== 2 || cells[0] !== 'Frente' || cells[1] !== 'Verso') {
        fail('csv', 'O cabeçalho precisa ter exatamente Frente e Verso, nessa ordem.');
      }
    } else {
      if (rows.length >= LIMITS.maxCsvRows) fail('csv', 'O CSV excede o limite de 500 cartões.');
      if (cells.length !== 2) {
        fail('csv', `O registro ${recordNumber} precisa ter exatamente duas células.`);
      }
      validateCell(cells[0], 'Frente', LIMITS.maxFrontLength, recordNumber);
      validateCell(cells[1], 'Verso', LIMITS.maxBackLength, recordNumber);
      rows.push({ front: cells[0], back: cells[1] });
    }
    cells = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (mode === 'quoted') {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          mode = 'closed';
        }
      } else if (character === '\r') {
        if (source[index + 1] !== '\n') fail('csv', 'O CSV contém uma quebra de linha inválida.');
        cell += '\n';
        index += 1;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === delimiter) {
      finishCell();
    } else if (character === '\n' || character === '\r') {
      if (character === '\r') {
        if (source[index + 1] !== '\n') fail('csv', 'O CSV contém uma quebra de linha inválida.');
        index += 1;
      }
      finishRecord();
    } else if (character === '"' && mode === 'start') {
      mode = 'quoted';
    } else if (character === '"' || mode === 'closed') {
      fail('csv', 'O CSV contém aspas em uma posição inválida.');
    } else {
      cell += character;
      mode = 'unquoted';
    }
  }
  if (mode === 'quoted') fail('csv', 'O CSV contém uma célula com aspas não fechadas.');
  if (mode !== 'start' || cells.length > 0 || recordNumber === 0) finishRecord();
  return rows;
}

// Neutralize spreadsheet formulas before CSV quoting, including whitespace and
// invisible prefixes and compatibility forms such as the full-width equals sign.
function spreadsheetText(value) {
  const text = String(value);
  const normalized = text.normalize('NFKC');
  const formula = /^[\s\u200B-\u200F\u202A-\u202E\u2060-\u206F]*[=+\-@]/u;
  return /^[\t\n\r]/u.test(text) || formula.test(normalized) ? `'${text}` : text;
}

function csvCell(value, delimiter) {
  const text = spreadsheetText(value);
  return text.includes(delimiter) || /["\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function csvDocument(headers, records, delimiter) {
  const lines = [headers.map((value) => csvCell(value, delimiter)).join(delimiter)];
  for (const record of records) {
    lines.push(record.map((value) => csvCell(value, delimiter)).join(delimiter));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

export function exportCardsCsv(data, deckId, options = {}) {
  const delimiter = delimiterFrom(options);
  const notebook = validateNotebook(data);
  if (!notebook.decks.some((deck) => deck.id === deckId)) {
    fail('deckId', 'O baralho selecionado não existe.');
  }
  const records = [];
  for (const card of notebook.cards) {
    if (card.deckId !== deckId || card.archived) continue;
    const version = card.versions.at(-1);
    records.push([version.front, version.back]);
  }
  return csvDocument(['Frente', 'Verso'], records, delimiter);
}

export function exportReviewsCsv(data) {
  const entries = historyEntries(data);
  const records = entries.map((entry) => [
    entry.reviewId,
    entry.deckId,
    entry.deckName,
    entry.cardId,
    entry.version,
    entry.front,
    entry.studiedOn,
    entry.grade,
    entry.stage,
    entry.dueOn,
  ]);
  return csvDocument([
    'Revisão ID', 'Baralho ID', 'Baralho atual', 'Cartão ID', 'Versão',
    'Frente', 'Data de estudo', 'Avaliação', 'Estágio', 'Próxima revisão',
  ], records, ';');
}

export function backupFilename(data, extension = 'json') {
  if (extension !== 'json' && extension !== 'csv') {
    fail('extension', 'A extensão precisa ser json ou csv.');
  }
  const notebook = validateNotebook(data);
  const slug = notebook.title.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
    .slice(0, 48).replace(/-+$/u, '') || 'estudos';
  return `caderno-${slug}-${notebook.id}.${extension}`;
}
