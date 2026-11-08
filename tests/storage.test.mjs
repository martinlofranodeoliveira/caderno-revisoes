/*
 * Adapted from Garantia Aberta's IndexedDB adapter tests.
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { emptyNotebook } from '../src/domain.mjs';
import { ConflictError, StorageError, openNotebookStore } from '../src/storage.mjs';

const TEST_DATABASE = 'notebook-test';

async function openStore(t, indexedDB = new IDBFactory(), dbName = TEST_DATABASE) {
  const store = await openNotebookStore({ indexedDB, dbName });
  t.after(() => store.close());
  return store;
}

function openRaw(indexedDB, dbName = TEST_DATABASE, version) {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(dbName) : indexedDB.open(dbName, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function rawTransaction(indexedDB, mode, callback, dbName = TEST_DATABASE) {
  const db = await openRaw(indexedDB, dbName);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('notebook', mode);
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error);
      callback(transaction.objectStore('notebook'), (value) => { result = value; });
    });
  } finally {
    db.close();
  }
}

function persistedRecords(indexedDB, dbName = TEST_DATABASE) {
  return rawTransaction(indexedDB, 'readonly', (store, done) => {
    store.getAll().onsuccess = (event) => done(event.target.result);
  }, dbName);
}

function replaceStoredRecord(indexedDB, replace) {
  return rawTransaction(indexedDB, 'readwrite', (store) => {
    store.get('current').onsuccess = (event) => store.put(replace(event.target.result), 'current');
  });
}

function populatedNotebook() {
  return {
    ...emptyNotebook('notebook-1'),
    decks: [{ id: 'deck-1', name: 'Contas', description: 'Exemplos simples' }],
    cards: [{
      id: 'card-1', deckId: 'deck-1', archived: false,
      versions: [{ front: '2 + 3?', back: '5', changedOn: '2026-11-08' }],
    }],
    reviews: [{
      id: 'review-1', cardId: 'card-1', version: 1,
      studiedOn: '2026-11-08', grade: 'good',
    }],
  };
}

function instrumentFactory(indexedDB, patchConnection) {
  return {
    open(...args) {
      const request = indexedDB.open(...args);
      request.addEventListener('success', () => patchConnection(request.result));
      return request;
    },
  };
}

test('opening and loading an absent notebook never writes a document', async (t) => {
  const indexedDB = new IDBFactory();
  const store = await openStore(t, indexedDB);
  assert.deepEqual(await store.load(), { revision: 0, notebook: null });
  assert.deepEqual(await store.load(), { revision: 0, notebook: null });
  assert.deepEqual(await persistedRecords(indexedDB), []);
});

test('the default database name is confined to this application', async (t) => {
  const indexedDB = new IDBFactory();
  const store = await openNotebookStore({ indexedDB });
  t.after(() => store.close());
  assert.deepEqual(await store.load(), { revision: 0, notebook: null });
  assert.deepEqual(await indexedDB.databases(), [{ name: 'lofrano-caderno-revisoes-v1', version: 1 }]);
});

test('notebooks persist across connections and all returned references are detached', async (t) => {
  const indexedDB = new IDBFactory();
  const store = await openStore(t, indexedDB);
  const notebook = populatedNotebook();
  const original = structuredClone(notebook);
  const pendingSave = store.save(notebook, 0);
  // Validation and cloning must have happened before the caller can change input.
  notebook.cards[0].versions[0].front = 'Caller changed before commit';
  const saved = await pendingSave;
  assert.deepEqual(saved, { revision: 1, notebook: original });
  saved.notebook.cards[0].versions[0].back = 'Changed returned result';
  saved.notebook.reviews.length = 0;
  const loaded = await store.load();
  assert.deepEqual(loaded, { revision: 1, notebook: original });
  loaded.notebook.cards[0].versions.length = 0;
  loaded.notebook.decks[0].name = 'Changed load result';
  assert.deepEqual(await store.load(), { revision: 1, notebook: original });
  store.close();
  const reopened = await openStore(t, indexedDB);
  assert.deepEqual(await reopened.load(), { revision: 1, notebook: original });
});

test('two real IndexedDB connections saving one revision have exactly one winner', async (t) => {
  const indexedDB = new IDBFactory();
  const first = await openStore(t, indexedDB);
  const second = await openStore(t, indexedDB);
  const outcomes = await Promise.allSettled([
    first.save(emptyNotebook('notebook-a'), 0),
    second.save(emptyNotebook('notebook-b'), 0),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const conflict = outcomes.find((result) => result.status === 'rejected').reason;
  assert.ok(conflict instanceof ConflictError);
  assert.equal(conflict.expectedRevision, 0);
  assert.equal(conflict.actualRevision, 1);
  const winner = outcomes.find((result) => result.status === 'fulfilled').value;
  assert.deepEqual(await first.load(), winner);
  assert.deepEqual(await second.load(), winner);
});

test('a stale clear cannot erase a newer saved notebook', async (t) => {
  const indexedDB = new IDBFactory();
  const first = await openStore(t, indexedDB);
  const second = await openStore(t, indexedDB);
  const saved = await first.save(emptyNotebook('notebook-1'), 0);
  await assert.rejects(second.clear(0), (error) => error instanceof ConflictError
    && error.expectedRevision === 0 && error.actualRevision === 1);
  assert.deepEqual(await second.load(), saved);
});

test('competing save and clear operations use the same transactional CAS', async (t) => {
  const indexedDB = new IDBFactory();
  const first = await openStore(t, indexedDB);
  const second = await openStore(t, indexedDB);
  await first.save(emptyNotebook('initial'), 0);
  const outcomes = await Promise.allSettled([
    first.save(emptyNotebook('replacement'), 1), second.clear(1),
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const conflict = outcomes.find((result) => result.status === 'rejected').reason;
  assert.ok(conflict instanceof ConflictError);
  assert.equal(conflict.actualRevision, 2);
  assert.deepEqual(await first.load(), outcomes.find((result) => result.status === 'fulfilled').value);
});

test('clear keeps growing tombstones across reopen and prevents ABA', async (t) => {
  const indexedDB = new IDBFactory();
  const first = await openStore(t, indexedDB);
  await first.save(emptyNotebook('first'), 0);
  assert.deepEqual(await first.clear(1), { revision: 2, notebook: null });
  first.close();
  const reopened = await openStore(t, indexedDB);
  assert.deepEqual(await reopened.load(), { revision: 2, notebook: null });
  assert.deepEqual(await persistedRecords(indexedDB), [{ revision: 2, notebook: null }]);
  await assert.rejects(reopened.save(emptyNotebook('stale'), 0), (error) => error instanceof ConflictError
    && error.actualRevision === 2);
  assert.equal((await reopened.save(emptyNotebook('new'), 2)).revision, 3);
  assert.deepEqual(await reopened.clear(3), { revision: 4, notebook: null });
  assert.deepEqual(await reopened.clear(4), { revision: 5, notebook: null });
});

test('clearing an initially absent notebook also retains a revision', async (t) => {
  const store = await openStore(t);
  assert.deepEqual(await store.clear(0), { revision: 1, notebook: null });
  await assert.rejects(store.save(emptyNotebook('old'), 0), (error) => error instanceof ConflictError
    && error.actualRevision === 1);
});

test('clear preserves other databases and unrelated keys', async (t) => {
  const indexedDB = new IDBFactory();
  const store = await openStore(t, indexedDB);
  const other = await openStore(t, indexedDB, 'another-application');
  const otherValue = await other.save(emptyNotebook('other'), 0);
  await store.save(emptyNotebook('own'), 0);
  await rawTransaction(indexedDB, 'readwrite', (objectStore) => objectStore.put('unrelated', 'other-key'));
  await store.clear(1);
  assert.deepEqual(await other.load(), otherValue);
  const records = await persistedRecords(indexedDB);
  assert.ok(records.includes('unrelated'));
  assert.ok(records.some((record) => record?.revision === 2 && record.notebook === null));
});

test('invalid input is rejected before a write transaction and preserves the saved notebook', async (t) => {
  const indexedDB = new IDBFactory();
  let writeTransactions = 0;
  const observedFactory = instrumentFactory(indexedDB, (db) => {
    const transaction = db.transaction.bind(db);
    db.transaction = (...args) => {
      if (args[1] === 'readwrite') writeTransactions += 1;
      return transaction(...args);
    };
  });
  const store = await openStore(t, observedFactory);
  const saved = await store.save(populatedNotebook(), 0);
  const invalid = populatedNotebook();
  invalid.cards[0].versions[0].front = 'private-study-secret';
  invalid.cards[0].deckId = 'missing-deck';
  const before = writeTransactions;
  await assert.rejects(store.save(invalid, 1), (error) => error instanceof StorageError
    && error.code === 'invalid' && !String(error).includes('private-study-secret')
    && !JSON.stringify(error).includes('private-study-secret') && !Object.hasOwn(error, 'cause'));
  assert.equal(writeTransactions, before);
  assert.deepEqual(await store.load(), saved);
});

test('load rejects corrupted notebook content without writes or private error values', async (t) => {
  const indexedDB = new IDBFactory();
  const store = await openStore(t, indexedDB);
  await store.save(populatedNotebook(), 0);
  await replaceStoredRecord(indexedDB, (record) => {
    record.notebook.title = 'private-study-secret';
    record.notebook.cards[0].deckId = 'missing-deck';
    return record;
  });
  const before = await persistedRecords(indexedDB);
  await assert.rejects(store.load(), (error) => error instanceof StorageError
    && error.code === 'corrupt' && !String(error).includes('private-study-secret')
    && !JSON.stringify(error).includes('private-study-secret') && !Object.hasOwn(error, 'cause'));
  assert.deepEqual(await persistedRecords(indexedDB), before);
});

test('invalid stored envelopes never become absence and exhausted revisions cannot wrap', async (t) => {
  const indexedDB = new IDBFactory();
  const store = await openStore(t, indexedDB);
  await store.save(emptyNotebook('first'), 0);
  for (const invalid of [
    null, [], { revision: 0, notebook: null }, { revision: -1, notebook: null },
    { revision: 1.5, notebook: null }, { revision: '1', notebook: null },
    { revision: 1, notebook: [] }, { revision: 1, notebook: null, unknown: true },
    { revision: 1 }, { notebook: null },
  ]) {
    await replaceStoredRecord(indexedDB, () => invalid);
    await assert.rejects(store.load(), { code: 'corrupt' });
    await assert.rejects(store.clear(0), { code: 'corrupt' });
  }
  await replaceStoredRecord(indexedDB, () => ({ revision: Number.MAX_SAFE_INTEGER, notebook: null }));
  await assert.rejects(store.clear(Number.MAX_SAFE_INTEGER), { code: 'revision' });
  await assert.rejects(store.save(emptyNotebook('next'), Number.MAX_SAFE_INTEGER), { code: 'revision' });
  assert.deepEqual(await store.load(), { revision: Number.MAX_SAFE_INTEGER, notebook: null });
});

test('invalid expected revisions cannot change storage', async (t) => {
  const store = await openStore(t);
  for (const revision of [-1, 0.5, NaN, Infinity, '0', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(store.save(emptyNotebook('notebook'), revision), { code: 'revision' });
    await assert.rejects(store.clear(revision), { code: 'revision' });
  }
  assert.deepEqual(await store.load(), { revision: 0, notebook: null });
});

test('write request success followed by transaction abort rejects and rolls back', async (t) => {
  const indexedDB = new IDBFactory();
  let abortNextWrite = false;
  let putSucceeded = false;
  const instrumented = instrumentFactory(indexedDB, (db) => {
    const originalTransaction = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = originalTransaction(...args);
      if (args[1] !== 'readwrite' || !abortNextWrite) return transaction;
      abortNextWrite = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name);
        const put = store.put.bind(store);
        store.put = (...putArgs) => {
          const request = put(...putArgs);
          request.addEventListener('success', () => {
            putSucceeded = true;
            transaction.abort();
          });
          return request;
        };
        return store;
      };
      return transaction;
    };
  });
  const store = await openStore(t, instrumented);
  const original = await store.save(emptyNotebook('original'), 0);
  abortNextWrite = true;
  await assert.rejects(store.save(emptyNotebook('rejected'), 1), { code: 'abort' });
  assert.equal(putSucceeded, true);
  assert.deepEqual(await store.load(), original);
});

test('read request success followed by transaction abort never returns a notebook', async (t) => {
  const indexedDB = new IDBFactory();
  let abortNextRead = false;
  let readSucceeded = false;
  const instrumented = instrumentFactory(indexedDB, (db) => {
    const originalTransaction = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = originalTransaction(...args);
      if (args[1] !== 'readonly' || !abortNextRead) return transaction;
      abortNextRead = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name);
        const get = store.get.bind(store);
        store.get = (...getArgs) => {
          const request = get(...getArgs);
          request.addEventListener('success', () => {
            readSucceeded = true;
            transaction.abort();
          });
          return request;
        };
        return store;
      };
      return transaction;
    };
  });
  const store = await openStore(t, instrumented);
  const original = await store.save(emptyNotebook('private-notebook'), 0);
  abortNextRead = true;
  await assert.rejects(store.load(), (error) => error instanceof StorageError
    && error.code === 'abort' && !JSON.stringify(error).includes('private-notebook'));
  assert.equal(readSucceeded, true);
  assert.deepEqual(await store.load(), original);
});

test('injected quota failures expose a fixed error and preserve previous data', async (t) => {
  const indexedDB = new IDBFactory();
  let quotaNextWrite = false;
  const instrumented = instrumentFactory(indexedDB, (db) => {
    const originalTransaction = db.transaction.bind(db);
    db.transaction = (...args) => {
      const transaction = originalTransaction(...args);
      if (args[1] !== 'readwrite' || !quotaNextWrite) return transaction;
      quotaNextWrite = false;
      const objectStore = transaction.objectStore.bind(transaction);
      transaction.objectStore = (name) => {
        const store = objectStore(name);
        store.put = () => { throw new DOMException('private-study-secret', 'QuotaExceededError'); };
        return store;
      };
      return transaction;
    };
  });
  const store = await openStore(t, instrumented);
  const original = await store.save(emptyNotebook('original'), 0);
  quotaNextWrite = true;
  await assert.rejects(store.save(emptyNotebook('rejected'), 1), (error) => error instanceof StorageError
    && error.code === 'quota' && !String(error).includes('private-study-secret')
    && !Object.hasOwn(error, 'cause'));
  assert.deepEqual(await store.load(), original);
});

test('version changes close this adapter and make its stale status explicit', async (t) => {
  const indexedDB = new IDBFactory();
  const store = await openStore(t, indexedDB);
  await store.save(emptyNotebook('notebook'), 0);
  const upgraded = await openRaw(indexedDB, TEST_DATABASE, 2);
  t.after(() => upgraded.close());
  await assert.rejects(store.load(), { code: 'versionchange' });
  await assert.rejects(store.save(emptyNotebook('new'), 1), { code: 'versionchange' });
  await assert.rejects(store.clear(1), { code: 'versionchange' });
  await assert.rejects(openNotebookStore({ indexedDB, dbName: TEST_DATABASE }), { code: 'versionchange' });
});

test('closed and unavailable stores fail explicitly without an in-memory fallback', async (t) => {
  await assert.rejects(openNotebookStore({ indexedDB: null }), { code: 'unavailable' });
  await assert.rejects(openNotebookStore({
    indexedDB: { open() { throw new DOMException('private-study-secret', 'SecurityError'); } },
  }), (error) => error instanceof StorageError && error.code === 'unavailable'
    && !String(error).includes('private-study-secret') && !Object.hasOwn(error, 'cause'));
  for (const dbName of ['', null, 42]) {
    await assert.rejects(openNotebookStore({ indexedDB: new IDBFactory(), dbName }), { code: 'open' });
  }
  const store = await openStore(t);
  store.close();
  store.close();
  await assert.rejects(store.load(), { code: 'closed' });
  await assert.rejects(store.save(emptyNotebook('notebook'), 0), { code: 'closed' });
  await assert.rejects(store.clear(0), { code: 'closed' });
});

test('opening a database with a foreign schema does not modify it', async () => {
  const indexedDB = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(TEST_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('foreign');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  await assert.rejects(openNotebookStore({ indexedDB, dbName: TEST_DATABASE }), { code: 'corrupt' });
  const db = await openRaw(indexedDB);
  try {
    assert.deepEqual([...db.objectStoreNames], ['foreign']);
    assert.equal(db.version, 1);
  } finally {
    db.close();
  }
});
