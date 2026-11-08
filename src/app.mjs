import { LIMITS, ValidationError, emptyNotebook, validateNotebook, addDeck, replaceDeck, removeDeck,
  addCard, updateCard, setArchived, removeCard, addCards, recordReview, undoLastReview,
  evaluateNotebook, historyEntries, reviewOutcome, daysBetween, createExampleNotebook } from './domain.mjs';
import { exportBackup, importBackup, parseCardsCsv, exportCardsCsv, exportReviewsCsv, backupFilename } from './io.mjs';
import { openNotebookStore, ConflictError } from './storage.mjs';

const PAGE_SIZE = 50, CSV_BYTES = 1024 * 1024;
const randomId = () => globalThis.crypto?.randomUUID?.() || 'id-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
const dateLabel = value => value.split('-').reverse().join('/');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const gradeName = grade => ({ again: 'Rever amanhã', good: 'Lembrei', easy: 'Fácil' }[grade]);
export function todayInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = key => parts.find(value => value.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function downloadFile(text, mime, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: mime })), link = globalThis.document.createElement('a');
  link.href = url; link.download = filename; globalThis.document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function readUtf8File(file, maximum) {
  if (!Number.isSafeInteger(file.size) || file.size > maximum) throw new ValidationError('file', 'O arquivo excede o limite informado.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > maximum) throw new ValidationError('file', 'O arquivo excede o limite informado.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Browser and DOM tests share these handlers; no notebook is sent to a server. */
export async function createApp({ document = globalThis.document, eventTarget = globalThis.window,
  storeFactory = () => openNotebookStore(), makeId = randomId, today = todayInSaoPaulo, onDownload = downloadFile } = {}) {
  const $ = id => document.getElementById(id);
  const node = (tag, text = '', className = '') => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
  const button = (label, key, value, className = 'text-button') => { const el = node('button', label, className); el.type = 'button'; el.dataset[key] = value; return el; };
  let notebook = emptyNotebook(makeId()), referenceDate = today(), store = null, revision = 0, remember = false, paused = false, conflict = false;
  let view = 'today', busy = false, dirty = false, previous = null, lastAction = Promise.resolve(), pendingFocus = null;
  let libraryDeckId = '', editingDeckId = null, editingCardId = null, removingCardId = null, activeStudy = null;
  let pendingImport = null, pendingCsv = null, pendingReload = null;
  let queuePage = 0, cardPage = 0, historyPage = 0;
  let cachedNotebook = null, cachedDay = null, evaluation, progress, cards, decks, history;
  const pagerStates = new Map();
  daysBetween(referenceDate, referenceDate);
  function model() {
    if (cachedNotebook === notebook && cachedDay === referenceDate) return;
    evaluation = evaluateNotebook(notebook, referenceDate); progress = new Map(evaluation.cards.map(card => [card.cardId, card]));
    cards = new Map(notebook.cards.map(card => [card.id, card])); decks = new Map(notebook.decks.map(deck => [deck.id, deck]));
    if (cachedNotebook !== notebook) history = historyEntries(notebook);
    cachedNotebook = notebook; cachedDay = referenceDate;
    if (!decks.has(libraryDeckId)) libraryDeckId = notebook.decks[0]?.id || '';
  }
  const message = text => {
    $('notice').hidden = !text; $('notice-text').textContent = text; $('live').textContent = text;
    $('undo').hidden = !previous; $('undo').textContent = previous?.kind === 'review' ? 'Desfazer última avaliação' : 'Desfazer última alteração';
    $('reload-saved').hidden = !conflict;
  };
  function status() {
    $('save-status').textContent = conflict ? 'Conflito: alterações só nesta aba' : paused ? 'Salvamento pausado: faça um backup' : remember ? 'Salvo neste navegador' : 'Somente na memória desta aba';
    $('today-label').textContent = 'Referência: ' + dateLabel(referenceDate);
    $('remember').checked = remember; $('remember').disabled = !store;
    $('storage-detail').textContent = !store ? 'O armazenamento local não está disponível. Você pode usar esta aba e baixar um backup.'
      : conflict ? 'A versão salva mudou em outra aba. Baixe sua cópia antes de carregar a versão salva.'
      : paused ? 'O salvamento desta versão não foi confirmado. Os registros continuam na memória para backup.'
      : remember ? `Salvamento confirmado #${revision}. Novas alterações confirmadas serão guardadas neste navegador.` : 'Nenhum novo dado será salvo automaticamente neste navegador.';
    $('retry-save').hidden = !(store && remember && paused && !conflict);
    for (const id of ['new-deck', 'first-deck']) $(id).disabled = notebook.decks.length >= LIMITS.maxDecks;
    $('new-card').disabled = !libraryDeckId || notebook.cards.length >= LIMITS.maxCards;
    $('csv-file').disabled = !libraryDeckId || notebook.cards.length >= LIMITS.maxCards;
    $('ask-remove-deck').disabled = !libraryDeckId || notebook.cards.some(card => card.deckId === libraryDeckId);
    for (const [prefix, state] of pagerStates) { $(prefix + '-prev').disabled = state.prev; $(prefix + '-next').disabled = state.next; }
  }
  function setBusy(value) {
    busy = value; document.querySelector('main').setAttribute('aria-busy', String(value));
    if (value) document.querySelectorAll('button,input,textarea,select').forEach(el => { el.dataset.previousDisabled = String(el.disabled); el.disabled = true; });
    else {
      document.querySelectorAll('[data-previous-disabled]').forEach(el => { el.disabled = el.dataset.previousDisabled === 'true'; delete el.dataset.previousDisabled; });
      status(); if (pendingFocus) { $(pendingFocus)?.focus(); pendingFocus = null; }
    }
  }
  async function run(fn) {
    if (busy) return false; setBusy(true);
    try { return await fn(); }
    catch (error) { message(error instanceof ValidationError ? error.message : 'A operação não foi concluída. Os dados desta aba foram preservados; tente novamente ou baixe um backup.'); return false; }
    finally { setBusy(false); }
  }
  const bind = (id, eventName, fn) => $(id).addEventListener(eventName, event => { event.preventDefault(); if (!busy) lastAction = run(() => fn(event)); });
  function clean() { if (!dirty) return true; message('Há alterações em edição. Salve ou cancele o formulário antes de trocar de área, importar ou exportar.'); return false; }
  function clearStages() { pendingImport = pendingCsv = pendingReload = null; for (const id of ['import-confirm', 'csv-confirm', 'confirm-reload', 'confirm-example']) $(id).hidden = true; }
  function closeForms() { $('deck-form').hidden = $('card-form').hidden = true; editingDeckId = editingCardId = null; }
  function selectView(next) {
    view = next;
    for (const name of ['today', 'library', 'history', 'backup']) {
      $('view-' + name).hidden = view !== name;
      if (view === name) $('nav-' + name).setAttribute('aria-current', 'page'); else $('nav-' + name).removeAttribute('aria-current');
    }
  }
  function navigate(next) { if (!clean()) return false; clearStages(); closeForms(); activeStudy = null; selectView(next); render(); return true; }
  function setOptions(id, selected, allLabel = null) {
    const select = $(id); select.replaceChildren();
    for (const entry of [...(allLabel ? [{ id: '', name: allLabel }] : []), ...notebook.decks]) {
      const option = node('option', entry.name || 'Baralho sem nome'); option.setAttribute('value', entry.id); option.selected = entry.id === selected; select.append(option);
    }
  }
  function paginate(items, page, prefix) {
    const maxPage = Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1), current = Math.max(0, Math.min(page, maxPage));
    $(prefix + '-pager').hidden = items.length <= PAGE_SIZE;
    pagerStates.set(prefix, { prev: current === 0, next: current === maxPage });
    $(prefix + '-prev').disabled = current === 0; $(prefix + '-next').disabled = current === maxPage;
    $(prefix + '-page-info').textContent = `${Math.min(current * PAGE_SIZE + 1, items.length)}–${Math.min((current + 1) * PAGE_SIZE, items.length)} de ${items.length}`;
    return { page: current, items: items.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE) };
  }
  function filteredDue() {
    const deckId = $('today-deck').value || '', query = $('today-search').value.toLocaleLowerCase('pt-BR');
    return evaluation.dueCardIds.filter(id => {
      const card = cards.get(id), name = decks.get(card.deckId)?.name || '';
      return (!deckId || card.deckId === deckId) && [name, card.versions.at(-1).front].some(text => text.toLocaleLowerCase('pt-BR').includes(query));
    });
  }
  function renderToday() {
    const selected = $('today-deck').value || ''; setOptions('today-deck', decks.has(selected) ? selected : '', 'Todos os baralhos');
    const due = filteredDue(), slice = paginate(due, queuePage, 'queue'); queuePage = slice.page;
    $('today-count').textContent = `${plural(evaluation.dueCount, 'cartão', 'cartões')} na fila · ${plural(evaluation.dueNewCount, 'novo')} · ${plural(evaluation.reviewedTodayCount, 'avaliação', 'avaliações')} hoje`;
    $('queue-head').hidden = !due.length; $('queue-empty').hidden = !!due.length; $('queue-list').replaceChildren();
    if (!notebook.decks.length) {
      $('queue-empty-title').textContent = 'Um caderno para a sua próxima descoberta.';
      $('queue-empty-copy').textContent = 'Crie um baralho, escreva seus cartões e volte para praticar. Você avalia a resposta e o aplicativo organiza a próxima data.';
      $('queue-library').textContent = 'Criar meu primeiro baralho';
    } else {
      $('queue-empty-title').textContent = evaluation.dueCount ? 'Nenhum cartão corresponde a estes filtros.' : 'Sua fila está em dia.';
      $('queue-empty-copy').textContent = evaluation.dueCount ? 'Ajuste o baralho ou a busca para ver os cartões previstos.' : 'Os cartões futuros e arquivados continuam na biblioteca. Você pode consultar o conteúdo e criar novos cartões por lá.';
      $('queue-library').textContent = 'Abrir meus baralhos';
    }
    for (const id of slice.items) {
      const card = cards.get(id), state = progress.get(id), current = card.versions.at(-1), isOpen = activeStudy?.cardId === id;
      const article = node('article', '', 'queue-item' + (isOpen ? ' is-open' : '')), row = node('div', '', 'queue-row');
      const date = node('div', dateLabel(state.dueOn), 'queue-date');
      date.append(node('small', state.reviewCount === 0 ? 'Novo conteúdo' : state.dueOn < referenceDate ? `Há ${plural(daysBetween(state.dueOn, referenceDate), 'dia')}` : 'Hoje'));
      const opener = button(isOpen ? 'Fechar' : 'Revisar', 'study', id, 'button secondary'); opener.setAttribute('aria-expanded', String(isOpen)); opener.setAttribute('aria-label', `${isOpen ? 'Fechar' : 'Revisar'}: ${current.front.slice(0, 100)}`);
      row.append(date, node('div', decks.get(card.deckId)?.name || 'Baralho sem nome', 'queue-deck'), node('div', current.front, 'queue-question'), opener); article.append(row);
      if (isOpen) {
        const panel = node('div', '', 'practice-panel'); panel.append(node('h2', current.front, 'practice-question'));
        if (!activeStudy.revealed) {
          const reveal = button('Mostrar resposta', 'reveal', id, 'button primary'); reveal.id = 'reveal-answer'; panel.append(reveal);
        } else {
          const answer = node('section', '', 'answer'); answer.id = 'study-answer'; answer.setAttribute('tabindex', '-1'); answer.append(node('h3', 'Resposta'), node('p', current.back)); panel.append(answer);
          panel.append(node('p', 'Como foi lembrar? Escolha uma avaliação para registrar a próxima data.', 'section-help'));
          const actions = node('div', '', 'grade-actions');
          for (const grade of ['again', 'good', 'easy']) {
            const next = reviewOutcome(state.stage, referenceDate, grade), rate = button('', 'grade', grade, 'button ' + (grade === 'good' ? 'primary' : 'secondary'));
            rate.id = 'grade-' + grade; rate.append(node('span', gradeName(grade)), node('small', 'Volta em ' + dateLabel(next.dueOn))); actions.append(rate);
          }
          panel.append(actions);
        }
        article.append(panel);
      }
      $('queue-list').append(article);
    }
  }
  function renderLibrary() {
    const counts = new Map(); for (const card of notebook.cards) counts.set(card.deckId, (counts.get(card.deckId) || 0) + 1);
    $('deck-list').replaceChildren(); $('decks-empty').hidden = !!notebook.decks.length;
    for (const deck of notebook.decks) {
      const item = button('', 'deck', deck.id, 'deck-button'); item.setAttribute('aria-current', String(libraryDeckId === deck.id)); item.append(node('strong', deck.name || 'Baralho sem nome'), node('small', plural(counts.get(deck.id) || 0, 'cartão', 'cartões'))); $('deck-list').append(item);
    }
    const deck = decks.get(libraryDeckId); $('deck-content').hidden = !deck; $('library-empty').hidden = !!deck || !$('deck-form').hidden;
    if (!deck) return;
    $('deck-title').textContent = deck.name || 'Baralho sem nome'; $('deck-description-display').textContent = deck.description; $('deck-description-display').hidden = !deck.description;
    $('deck-count').textContent = `${plural(counts.get(deck.id) || 0, 'cartão', 'cartões')}, incluindo arquivados. Remova ou mova todos antes de excluir o baralho.`;
    const query = $('card-search').value.toLocaleLowerCase('pt-BR');
    const matched = notebook.cards.filter(card => card.deckId === deck.id && ($('show-archived').checked || !card.archived) && [card.versions.at(-1).front, card.versions.at(-1).back].some(text => text.toLocaleLowerCase('pt-BR').includes(query)));
    const slice = paginate(matched, cardPage, 'card'); cardPage = slice.page; $('card-list').replaceChildren(); $('cards-empty').hidden = !!matched.length;
    for (const card of slice.items) {
      const current = card.versions.at(-1), state = progress.get(card.id), article = node('article', '', 'library-card');
      article.append(node('h3', current.front), node('p', current.back, 'card-preview'), node('p', `Versão ${card.versions.length} · ${card.archived ? 'Arquivado' : 'Próxima: ' + dateLabel(state.dueOn)} · Estágio ${state.stage}`, 'card-meta'));
      const actions = node('div', '', 'actions'); actions.append(button('Editar conteúdo', 'editCard', card.id), button('Duplicar', 'duplicateCard', card.id), button(card.archived ? 'Desarquivar' : 'Arquivar', 'archiveCard', card.id), button('Excluir', 'askRemoveCard', card.id, 'text-button danger-text')); article.append(actions);
      const details = node('details', '', 'versions'); details.append(node('summary', `Ver ${plural(card.versions.length, 'versão', 'versões')} do conteúdo`));
      card.versions.forEach((version, index) => { const line = node('section', '', 'version-record'); line.append(node('strong', `Versão ${index + 1} · ${dateLabel(version.changedOn)}`), node('p', version.front), node('p', version.back)); details.append(line); }); article.append(details); $('card-list').append(article);
    }
  }
  function renderHistory() {
    const selected = $('history-deck').value || ''; setOptions('history-deck', decks.has(selected) ? selected : '', 'Todos os baralhos');
    const deckId = $('history-deck').value || '', entries = [...history].reverse().filter(entry => !deckId || entry.deckId === deckId);
    const slice = paginate(entries, historyPage, 'history'); historyPage = slice.page; $('history-list').replaceChildren(); $('history-empty').hidden = !!entries.length;
    for (const entry of slice.items) {
      const article = node('article', '', 'history-record'); article.append(node('h2', entry.front), node('p', `${dateLabel(entry.studiedOn)} · ${gradeName(entry.grade)} · próxima em ${dateLabel(entry.dueOn)}`, 'history-date'), node('p', `${entry.deckName || 'Baralho sem nome'} (atual) · Versão ${entry.version} · Estágio ${entry.stage}`));
      const detail = node('details'); detail.append(node('summary', 'Conferir resposta daquela versão'), node('p', entry.back)); article.append(detail); $('history-list').append(article);
    }
  }
  function render() {
    model(); renderToday(); renderLibrary(); renderHistory(); $('notebook-title').value = notebook.title;
    for (const id of ['confirm-remove-deck', 'confirm-remove-card', 'confirm-empty']) $(id).hidden = true; status();
  }
  function clearErrors() { document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; }); document.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid')); }
  function formError(error, prefix) {
    clearErrors(); const name = error.field?.split('.').at(-1), id = prefix + '-' + (name === 'deckId' ? 'deck' : name), input = $(id), help = $('error-' + id);
    if (input) { input.setAttribute('aria-invalid', 'true'); if (help) { help.textContent = error.message; input.setAttribute('aria-describedby', help.id); } pendingFocus = id; }
    message(error instanceof ValidationError ? error.message : 'Confira os campos antes de salvar.');
  }
  function freshDate() {
    const value = today(); daysBetween(value, value);
    if (value === referenceDate) return true;
    referenceDate = value; activeStudy = null; model(); renderToday(); renderHistory(); status(); message('O dia de referência mudou. A fila foi atualizada; abra o cartão novamente antes de avaliar.'); return false;
  }
  async function commit(next, text, { target = view, kind = 'change', reviewId = null } = {}) {
    next = validateNotebook(next); let result = text;
    if (remember && store && !paused && !conflict) {
      try { const saved = await store.save(next, revision); revision = saved.revision; }
      catch (error) { paused = true; conflict = error instanceof ConflictError; result += conflict ? ' A versão salva mudou em outra aba. Esta alteração ficou somente nesta aba; faça um backup antes de carregar a versão salva.' : ' O salvamento falhou. Esta alteração ficou somente nesta aba; baixe um backup.'; }
    } else if (remember && (paused || conflict)) result += ' O salvamento continua pausado; este registro está somente nesta aba.';
    previous = { notebook, kind, reviewId }; notebook = next; dirty = false; activeStudy = null; clearStages(); closeForms(); queuePage = cardPage = historyPage = 0; selectView(target); render(); message(result); return true;
  }
  function openDeckForm(edit = false) {
    if (!clean()) return; clearStages(); closeForms(); selectView('library'); model(); editingDeckId = edit ? libraryDeckId : null;
    const deck = edit ? decks.get(libraryDeckId) : { name: '', description: '' }; if (!deck) return;
    $('deck-name').value = deck.name; $('deck-description').value = deck.description; $('deck-form-title').textContent = edit ? 'Editar baralho' : 'Novo baralho'; $('deck-form').hidden = false; clearErrors(); renderLibrary(); pendingFocus = 'deck-name';
  }
  function openCardForm(id = null) {
    if (!clean() || !notebook.decks.length) return; clearStages(); closeForms(); selectView('library'); editingCardId = id;
    const card = id ? cards.get(id) : null, content = card?.versions.at(-1) || { front: '', back: '' };
    setOptions('card-deck', card?.deckId || libraryDeckId); $('card-front').value = content.front; $('card-back').value = content.back;
    $('card-form-title').textContent = id ? `Editar cartão · versão ${card.versions.length}` : 'Adicionar cartão'; $('card-form').hidden = false; clearErrors(); pendingFocus = 'card-front';
  }
  function openStudy(id) {
    if (!clean() || !freshDate()) return;
    if (!evaluation.dueCardIds.includes(id)) { message('Este cartão não está na fila atual. Confira a agenda na biblioteca.'); return; }
    activeStudy = activeStudy?.cardId === id ? null : { cardId: id, version: cards.get(id).versions.length, day: referenceDate, revealed: false };
    renderToday(); if (activeStudy) pendingFocus = 'reveal-answer';
  }
  for (const name of ['today', 'library', 'history', 'backup']) bind('nav-' + name, 'click', () => { freshDate(); navigate(name); });
  bind('queue-library', 'click', () => { if (!clean()) return; navigate('library'); if (!notebook.decks.length) openDeckForm(false); });
  bind('new-deck', 'click', () => openDeckForm(false)); bind('first-deck', 'click', () => openDeckForm(false)); bind('edit-deck', 'click', () => openDeckForm(true));
  for (const id of ['today-deck', 'today-search']) $(id).addEventListener(id.endsWith('search') ? 'input' : 'change', () => { if (!busy) { activeStudy = null; queuePage = 0; renderToday(); } });
  for (const id of ['card-search', 'show-archived']) $(id).addEventListener(id === 'card-search' ? 'input' : 'change', () => { if (!busy) { cardPage = 0; renderLibrary(); } });
  $('history-deck').addEventListener('change', () => { if (!busy) { historyPage = 0; renderHistory(); } });
  for (const prefix of ['queue', 'card', 'history']) for (const direction of ['prev', 'next']) bind(prefix + '-' + direction, 'click', () => {
    const delta = direction === 'prev' ? -1 : 1; if (prefix === 'queue') { queuePage += delta; activeStudy = null; renderToday(); } else if (prefix === 'card') { cardPage += delta; renderLibrary(); } else { historyPage += delta; renderHistory(); }
  });
  bind('queue-list', 'click', async event => {
    const opener = event.target.closest('[data-study]'), reveal = event.target.closest('[data-reveal]'), rate = event.target.closest('[data-grade]');
    if (opener) return openStudy(opener.dataset.study);
    if (reveal && activeStudy?.cardId === reveal.dataset.reveal && freshDate()) { activeStudy.revealed = true; renderToday(); pendingFocus = 'study-answer'; return; }
    if (!rate || !activeStudy?.revealed || !freshDate()) return;
    const grade = rate.dataset.grade; if (!['again', 'good', 'easy'].includes(grade)) return;
    const action = { id: makeId(), cardId: activeStudy.cardId, expectedVersion: activeStudy.version, studiedOn: referenceDate, grade };
    const outcome = reviewOutcome(progress.get(action.cardId).stage, referenceDate, grade);
    await commit(recordReview(notebook, action), `Avaliação registrada: ${gradeName(grade)}. Próxima revisão em ${dateLabel(outcome.dueOn)}.`, { target: 'today', kind: 'review', reviewId: action.id });
    const next = filteredDue()[0]; if (next) { activeStudy = { cardId: next, version: cards.get(next).versions.length, day: referenceDate, revealed: false }; renderToday(); pendingFocus = 'reveal-answer'; }
  });
  bind('deck-list', 'click', event => { const item = event.target.closest('[data-deck]'); if (!item || !clean()) return; libraryDeckId = item.dataset.deck; cardPage = 0; clearStages(); closeForms(); renderLibrary(); status(); });
  for (const id of ['deck-form', 'card-form']) $(id).addEventListener('input', () => { dirty = true; });
  $('card-deck').addEventListener('change', () => { dirty = true; });
  $('notebook-title').addEventListener('input', () => { dirty = $('notebook-title').value !== notebook.title; });
  bind('deck-form', 'submit', async () => {
    const deck = { id: editingDeckId || makeId(), name: $('deck-name').value, description: $('deck-description').value };
    try { if (!deck.name.trim()) throw new ValidationError('name', 'Informe um nome para reconhecer o baralho.'); const next = editingDeckId ? replaceDeck(notebook, deck) : addDeck(notebook, deck); libraryDeckId = deck.id; clearErrors(); await commit(next, 'Baralho salvo.', { target: 'library' }); }
    catch (error) { formError(error, 'deck'); }
  });
  bind('cancel-deck', 'click', () => { dirty = false; closeForms(); clearErrors(); renderLibrary(); message('Edição do baralho cancelada.'); });
  bind('new-card', 'click', () => openCardForm());
  bind('card-form', 'submit', async () => {
    freshDate(); const changes = { front: $('card-front').value, back: $('card-back').value, changedOn: referenceDate, deckId: $('card-deck').value };
    try {
      const next = editingCardId ? updateCard(notebook, editingCardId, changes) : addCard(notebook, { id: makeId(), deckId: changes.deckId, archived: false, versions: [{ front: changes.front, back: changes.back, changedOn: changes.changedOn }] });
      libraryDeckId = changes.deckId; clearErrors(); await commit(next, 'Cartão salvo. A versão atual e sua agenda estão na biblioteca.', { target: 'library' });
    } catch (error) { formError(error, 'card'); }
  });
  bind('cancel-card', 'click', () => { dirty = false; closeForms(); clearErrors(); message('Edição do cartão cancelada.'); });
  bind('ask-remove-deck', 'click', () => { if (clean() && !notebook.cards.some(card => card.deckId === libraryDeckId)) $('confirm-remove-deck').hidden = false; });
  bind('cancel-remove-deck', 'click', () => { $('confirm-remove-deck').hidden = true; });
  bind('remove-deck', 'click', async () => { if (!clean() || $('confirm-remove-deck').hidden) return; await commit(removeDeck(notebook, libraryDeckId), 'Baralho vazio removido.', { target: 'library' }); });
  bind('card-list', 'click', async event => {
    const edit = event.target.closest('[data-edit-card]'), duplicate = event.target.closest('[data-duplicate-card]'), archive = event.target.closest('[data-archive-card]'), remove = event.target.closest('[data-ask-remove-card]');
    if (edit) return openCardForm(edit.dataset.editCard); if (!clean()) return;
    if (duplicate) { freshDate(); const source = cards.get(duplicate.dataset.duplicateCard), current = source.versions.at(-1); await commit(addCard(notebook, { id: makeId(), deckId: source.deckId, archived: false, versions: [{ front: current.front, back: current.back, changedOn: referenceDate }] }), 'Cartão duplicado com agenda própria.', { target: 'library' }); }
    if (archive) { const card = cards.get(archive.dataset.archiveCard); await commit(setArchived(notebook, card.id, !card.archived), card.archived ? 'Cartão desarquivado.' : 'Cartão arquivado. O histórico foi preservado.', { target: 'library' }); }
    if (remove) { removingCardId = remove.dataset.askRemoveCard; $('remove-card-summary').textContent = `Excluir o cartão “${cards.get(removingCardId).versions.at(-1).front.slice(0, 140)}”, suas versões e seus registros de estudo? Baixe um backup para guardar uma cópia.`; $('confirm-remove-card').hidden = false; }
  });
  bind('cancel-remove-card', 'click', () => { removingCardId = null; $('confirm-remove-card').hidden = true; });
  bind('remove-card', 'click', async () => { if (!clean() || !removingCardId || $('confirm-remove-card').hidden) return; const id = removingCardId; removingCardId = null; await commit(removeCard(notebook, id), 'Cartão e histórico removidos desta versão.', { target: 'library' }); });
  bind('toggle-csv', 'click', () => { if (clean()) { $('csv-panel').hidden = !$('csv-panel').hidden; pendingCsv = null; $('csv-confirm').hidden = true; } });
  $('csv-delimiter').addEventListener('change', () => { pendingCsv = null; $('csv-confirm').hidden = true; });
  bind('csv-file', 'change', async event => {
    const file = event.target.files?.[0]; if (!file) return; pendingCsv = null; $('csv-confirm').hidden = true;
    try {
      if (!clean() || !libraryDeckId) return;
      const rows = parseCardsCsv(await readUtf8File(file, CSV_BYTES), { delimiter: $('csv-delimiter').value });
      if (!rows.length) { message('O CSV tem cabeçalho, mas nenhum cartão para importar.'); return; }
      freshDate(); const ids = rows.map(() => makeId()); addCards(notebook, libraryDeckId, rows, referenceDate, ids);
      pendingCsv = { rows, ids, deckId: libraryDeckId }; $('csv-summary').textContent = `${plural(rows.length, 'cartão', 'cartões')} validado(s) para “${decks.get(libraryDeckId).name || 'Baralho sem nome'}”. Prévia das primeiras ${Math.min(3, rows.length)} linhas:`;
      $('csv-preview').replaceChildren(); for (const row of rows.slice(0, 3)) { const line = node('div', '', 'csv-preview-row'); line.append(node('p', 'Frente: ' + row.front), node('p', 'Verso: ' + row.back)); $('csv-preview').append(line); }
      $('csv-confirm').hidden = false; message('CSV validado. Confira o baralho e confirme a inclusão dos cartões.');
    } catch { pendingCsv = null; message('O CSV não passou pela validação. Confira UTF-8, separador, cabeçalho Frente/Verso e limites; nenhum cartão foi adicionado.'); }
    finally { event.target.value = ''; }
  });
  bind('cancel-csv', 'click', () => { pendingCsv = null; $('csv-confirm').hidden = true; message('Importação CSV cancelada.'); });
  bind('confirm-csv', 'click', async () => { if (!clean() || !pendingCsv) return; freshDate(); const staged = pendingCsv; await commit(addCards(notebook, staged.deckId, staged.rows, referenceDate, staged.ids), 'Cartões do CSV adicionados.', { target: 'library' }); });
  bind('export-cards', 'click', () => { if (clean() && libraryDeckId) { onDownload(exportCardsCsv(notebook, libraryDeckId), 'text/csv;charset=utf-8', backupFilename(notebook, 'csv')); message('CSV do conteúdo atual preparado. Use JSON para guardar versões e histórico exatamente.'); } });
  bind('export-history', 'click', () => { if (clean()) { onDownload(exportReviewsCsv(notebook), 'text/csv;charset=utf-8', 'historico-' + backupFilename(notebook, 'csv')); message('Histórico CSV preparado para download.'); } });
  bind('export-backup', 'click', () => { if (clean()) { onDownload(exportBackup(notebook), 'application/json;charset=utf-8', backupFilename(notebook)); message('Backup completo preparado, com baralhos, versões e histórico.'); } });
  bind('import-file', 'change', async event => {
    const file = event.target.files?.[0]; if (!file) return; pendingImport = null; $('import-confirm').hidden = true;
    try {
      if (!clean()) return; pendingImport = importBackup(await readUtf8File(file, LIMITS.maxJsonBytes));
      $('import-summary').textContent = `Backup validado: ${plural(pendingImport.decks.length, 'baralho')}, ${plural(pendingImport.cards.length, 'cartão', 'cartões')} e ${plural(pendingImport.reviews.length, 'avaliação', 'avaliações')}. Substituir o caderno desta aba?`;
      $('import-confirm').hidden = false; message('Backup e histórico validados. Confira antes de substituir o caderno.');
    } catch { pendingImport = null; message('O backup não passou pela validação de UTF-8, formato, limites ou histórico. O caderno atual foi preservado.'); }
    finally { event.target.value = ''; }
  });
  bind('cancel-import', 'click', () => { pendingImport = null; $('import-confirm').hidden = true; message('Restauração cancelada.'); });
  bind('confirm-import', 'click', async () => { if (!clean() || !pendingImport) return; const next = pendingImport; await commit(next, 'Caderno restaurado. Confira seus baralhos e a fila.', { target: 'today' }); });
  const meaningful = () => notebook.decks.length || notebook.cards.length || notebook.reviews.length || notebook.title !== 'Meus estudos';
  async function loadExample() { await commit(createExampleNotebook(), 'Exemplo demonstrativo carregado, com histórico fictício e contas simples.', { target: 'today' }); }
  bind('load-example', 'click', async () => { if (!clean()) return; if (!meaningful()) return loadExample(); $('example-summary').textContent = `Substituir este caderno, com ${plural(notebook.cards.length, 'cartão', 'cartões')}, pelo exemplo demonstrativo? Baixe um backup antes de continuar.`; $('confirm-example').hidden = false; message('Você já tem dados. Confirme a substituição antes de carregar o exemplo.'); });
  bind('cancel-example', 'click', () => { $('confirm-example').hidden = true; message('Seu caderno foi preservado.'); });
  bind('confirm-example-replace', 'click', async () => { if (clean() && !$('confirm-example').hidden) await loadExample(); });
  bind('undo', 'click', async () => { if (!clean() || !previous) return; const saved = previous, next = saved.kind === 'review' ? undoLastReview(notebook, saved.reviewId) : saved.notebook; await commit(next, 'A última alteração desta aba foi desfeita.', { target: view }); previous = null; $('undo').hidden = true; });
  bind('reload-saved', 'click', async () => { if (!clean() || !store) return; pendingReload = await store.load(); $('reload-summary').textContent = `A cópia salva contém ${plural(pendingReload.notebook?.cards.length || 0, 'cartão', 'cartões')}. Substituir a versão em memória? Baixe seu backup antes de continuar.`; $('confirm-reload').hidden = false; });
  bind('cancel-reload', 'click', () => { pendingReload = null; $('confirm-reload').hidden = true; });
  bind('confirm-reload-replace', 'click', () => {
    if (!clean() || !pendingReload) return; const saved = pendingReload; previous = { notebook, kind: 'change', reviewId: null };
    notebook = saved.notebook || emptyNotebook(makeId()); revision = saved.revision; remember = saved.notebook !== null; conflict = paused = false; dirty = false; activeStudy = null; closeForms(); clearStages(); selectView('today'); render(); message('Versão salva carregada. A versão anterior desta aba pode ser recuperada.');
  });
  bind('remember', 'change', async () => {
    if (!clean()) { $('remember').checked = remember; return; } if (!store) return;
    if ($('remember').checked) {
      remember = true;
      if (paused || conflict) { status(); message('O salvamento continua pausado. Baixe esta versão ou confira a versão salva.'); return; }
      try { const saved = await store.save(notebook, revision); revision = saved.revision; message('Caderno salvo neste navegador. Guarde seu próprio backup.'); }
      catch (error) { paused = true; conflict = error instanceof ConflictError; message(conflict ? 'A versão salva mudou. Esta aba foi preservada; faça um backup antes de carregar a versão salva.' : 'O salvamento não foi confirmado. Os dados continuam nesta aba para backup.'); }
    } else {
      try { const cleared = await store.clear(revision); revision = cleared.revision; remember = false; paused = conflict = false; message('Salvamento desativado e cópia local desta revisão removida. O caderno continua na memória da aba.'); }
      catch (error) { remember = false; paused = false; conflict = error instanceof ConflictError; message(conflict ? 'Salvamento desta aba desativado. A cópia alterada em outra aba foi preservada.' : 'Salvamento desta aba desativado. A remoção da cópia local não foi confirmada; ela pode continuar neste navegador.'); }
    }
    status();
  });
  bind('retry-save', 'click', async () => { if (!clean() || !store || !remember || conflict) return; try { const saved = await store.save(notebook, revision); revision = saved.revision; paused = false; message('Esta versão foi salva neste navegador.'); } catch (error) { paused = true; conflict = error instanceof ConflictError; message('O salvamento não foi confirmado. Baixe um backup ou confira a versão salva.'); } status(); });
  bind('rename-notebook', 'click', async () => { const next = structuredClone(notebook); next.title = $('notebook-title').value; await commit(next, 'Nome do caderno salvo.'); });
  bind('ask-empty', 'click', () => { if (clean()) $('confirm-empty').hidden = false; });
  bind('cancel-empty', 'click', () => { $('confirm-empty').hidden = true; });
  bind('empty-notebook', 'click', async () => { if (clean() && !$('confirm-empty').hidden) await commit(emptyNotebook(makeId()), 'Caderno vazio criado. A versão anterior pode ser recuperada.', { target: 'today' }); });
  const onBeforeUnload = event => { if (dirty || ((!remember || paused || conflict) && meaningful())) { event.preventDefault(); event.returnValue = ''; } };
  const onFocus = () => { if (!busy) freshDate(); };
  eventTarget?.addEventListener('beforeunload', onBeforeUnload); eventTarget?.addEventListener('focus', onFocus);
  setBusy(true);
  try { store = await storeFactory(); const saved = await store.load(); revision = saved.revision; if (saved.notebook) { notebook = saved.notebook; remember = true; message('Caderno recuperado deste navegador.'); } }
  catch { store?.close(); store = null; message('O salvamento local está indisponível ou o caderno salvo não pôde ser validado. Ele não foi alterado. Você pode usar esta aba e baixar um backup.'); }
  render(); setBusy(false);
  return { getNotebook: () => validateNotebook(notebook), whenIdle: () => lastAction,
    destroy() { store?.close(); eventTarget?.removeEventListener('beforeunload', onBeforeUnload); eventTarget?.removeEventListener('focus', onFocus); } };
}
if (typeof window !== 'undefined' && globalThis.document?.getElementById('deck-form')) createApp().catch(() => { document.getElementById('fatal').hidden = false; });
