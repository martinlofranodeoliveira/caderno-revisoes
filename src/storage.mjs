/*
 * Adapted from Garantia Aberta's IndexedDB adapter.
 * Copyright (c) 2026 Contribuidores da LOFRANO TECNOLOGIA
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { validateNotebook } from './domain.mjs';

const DATABASE_VERSION = 1;
const STORE_NAME = 'notebook';
const NOTEBOOK_KEY = 'current';
const DEFAULT_DATABASE_NAME = 'lofrano-caderno-revisoes-v1';

const MESSAGES = Object.freeze({
  unavailable: 'O salvamento local não está disponível.',
  blocked: 'Outra conexão está impedindo a abertura do salvamento local.',
  versionchange: 'O banco local mudou de versão. Abra uma nova conexão.',
  closed: 'A conexão com o salvamento local está fechada.',
  corrupt: 'O registro local não passou pela validação.',
  invalid: 'O caderno informado não é válido para salvamento.',
  quota: 'Não há espaço disponível para salvar o caderno.',
  abort: 'A operação de salvamento local foi interrompida.',
  revision: 'A revisão do salvamento local não é válida.',
  transaction: 'Não foi possível concluir a operação no salvamento local.',
  open: 'Não foi possível abrir o salvamento local.',
});

export class StorageError extends Error {
  constructor(code = 'transaction') {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'transaction';
    super(MESSAGES[safeCode]);
    this.name = 'StorageError';
    this.code = safeCode;
  }
}

export class ConflictError extends Error {
  constructor(expectedRevision, actualRevision) {
    super('O caderno local mudou. Recarregue antes de salvar.');
    this.name = 'ConflictError';
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function storageError(error, fallback = 'transaction') {
  if (error instanceof StorageError || error instanceof ConflictError) return error;
  // Browser exceptions can contain private data: do not copy message or cause.
  switch (error?.name) {
    case 'QuotaExceededError': return new StorageError('quota');
    case 'AbortError': return new StorageError('abort');
    case 'SecurityError':
    case 'NotSupportedError': return new StorageError('unavailable');
    case 'VersionError': return new StorageError('versionchange');
    default: return new StorageError(fallback);
  }
}

function checkExpectedRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new StorageError('revision');
}

function readRecord(value) {
  if (value === undefined) return { revision: 0, notebook: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 2
      || !Object.hasOwn(value, 'revision') || !Object.hasOwn(value, 'notebook')
      || !Number.isSafeInteger(value.revision) || value.revision < 1
      || (value.notebook !== null && (typeof value.notebook !== 'object' || Array.isArray(value.notebook)))) {
    throw new StorageError('corrupt');
  }
  return value;
}

/** Open only this application's database; opening and loading write no notebook. */
export async function openNotebookStore({ indexedDB = globalThis.indexedDB, dbName = DEFAULT_DATABASE_NAME } = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') throw new StorageError('unavailable');
  if (typeof dbName !== 'string' || !dbName) throw new StorageError('open');

  const db = await new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      request = indexedDB.open(dbName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        try {
          // Rejected blocked requests can resume later; abort their upgrade.
          if (settled) {
            request.transaction.abort();
            return;
          }
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME);
          }
        } catch (error) {
          fail(storageError(error, 'open'));
          try { request.transaction.abort(); } catch { /* Already inactive. */ }
        }
      };
      request.onerror = () => fail(storageError(request.error, 'open'));
      request.onblocked = () => fail(new StorageError('blocked'));
      request.onsuccess = () => {
        const connection = request.result;
        if (settled) {
          connection.close();
          return;
        }
        if (!connection.objectStoreNames.contains(STORE_NAME)) {
          connection.close();
          fail(new StorageError('corrupt'));
          return;
        }
        settled = true;
        resolve(connection);
      };
    } catch (error) {
      fail(storageError(error, 'open'));
    }
  });

  let state = 'open';
  db.onversionchange = () => {
    state = 'versionchange';
    db.close();
  };
  db.onclose = () => {
    if (state === 'open') state = 'unavailable';
  };

  function ensureOpen() {
    if (state !== 'open') throw new StorageError(state);
  }

  function transact(mode, modify) {
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let failure;
      try {
        ensureOpen();
        transaction = db.transaction(STORE_NAME, mode);
        transaction.oncomplete = () => resolve(result);
        // Request success precedes commit; a later abort must reject the operation.
        transaction.onabort = () => reject(failure || storageError(transaction.error, 'abort'));
        transaction.onerror = (event) => {
          failure ||= storageError(event.target?.error || transaction.error);
        };
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(NOTEBOOK_KEY);
        request.onerror = () => { failure = storageError(request.error); };
        request.onsuccess = () => {
          try {
            const current = readRecord(request.result);
            result = modify ? modify(current, store) : current;
          } catch (error) {
            failure = storageError(error);
            transaction.abort();
          }
        };
      } catch (error) {
        failure = storageError(error);
        if (transaction) {
          try { transaction.abort(); } catch { reject(failure); }
        } else {
          reject(failure);
        }
      }
    });
  }

  function write(notebook, expectedRevision) {
    return transact('readwrite', (current, store) => {
      if (current.revision !== expectedRevision) {
        throw new ConflictError(expectedRevision, current.revision);
      }
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new StorageError('revision');
      const next = { revision: current.revision + 1, notebook };
      // CAS and put remain synchronous in the same active readwrite transaction.
      store.put(next, NOTEBOOK_KEY);
      return next;
    });
  }

  return Object.freeze({
    async load() {
      const record = await transact('readonly');
      if (record.notebook === null) return { revision: record.revision, notebook: null };
      try {
        return { revision: record.revision, notebook: validateNotebook(record.notebook) };
      } catch {
        throw new StorageError('corrupt');
      }
    },
    async save(notebook, expectedRevision) {
      ensureOpen();
      checkExpectedRevision(expectedRevision);
      let validatedNotebook;
      try {
        // Validate and detach caller data before starting any write transaction.
        validatedNotebook = validateNotebook(notebook);
      } catch {
        throw new StorageError('invalid');
      }
      return write(validatedNotebook, expectedRevision);
    },
    async clear(expectedRevision) {
      ensureOpen();
      checkExpectedRevision(expectedRevision);
      // Preserve a monotonically growing revision even when no notebook remains.
      return write(null, expectedRevision);
    },
    close() {
      if (state === 'open') {
        state = 'closed';
        db.close();
      }
    },
  });
}
