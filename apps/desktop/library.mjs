// Trusted Library UI. Imported text is always rendered as text, never markup.
import { openPdf, readEpub } from './library-readers.mjs';
const categories = { all: 'All', books: 'Books', music: 'Music', audiobooks: 'Audiobooks', videos: 'Videos', photos: 'Photos', comics: 'Comics' };
const PAGE_SIZE = 2200;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const timeLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const sizeLabel = bytes => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const guessedCategory = name => /\.(png|jpe?g|webp)$/i.test(name) ? 'photos' : /\.(mp3|wav)$/i.test(name) ? 'music' : /\.(txt|pdf|epub)$/i.test(name) ? 'books' : 'videos';
const details = item => item.details || { favorite: false, collection: '', order: 0 };
const isPDF = item => item.mimeType === 'application/pdf';
const isText = item => item.category === 'books' && !isPDF(item);
const isImage = item => ['photos', 'comics'].includes(item.category) && !isPDF(item);
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
export function librarySequence(items, selected) {
  const collection = details(selected).collection;
  return items.filter(item => collection ? details(item).collection === collection : isImage(selected) && item.category === selected.category && isImage(item))
    .sort((a, b) => details(a).order - details(b).order || natural(a.title, b.title) || natural(a.filename, b.filename));
}

export function bookPageStarts(text, chapterStarts = []) {
  const starts = [0];
  while (starts.at(-1) + PAGE_SIZE < text.length) {
    const start = starts.at(-1);
    let end = start + PAGE_SIZE;
    const paragraph = text.lastIndexOf('\n\n', end);
    if (paragraph > start + PAGE_SIZE / 2) end = paragraph + 2;
    else {
      const whitespace = text.slice(start, end).search(/\s+\S*$/);
      if (whitespace > PAGE_SIZE / 2) end = start + whitespace + 1;
      else if (/[\uDC00-\uDFFF]/.test(text[end]) && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    }
    if (end >= text.length) break;
    starts.push(end);
  }
  // A chapter selector must land on that chapter, even when two short chapters
  // would otherwise share a page and reset the selector to the previous one.
  return [...new Set([...starts, ...chapterStarts.filter(start => Number.isSafeInteger(start) && start >= 0 && start < text.length)])].sort((a, b) => a - b);
}

export function createLibrary({ node, button, icon, api, perform, render, isBusy }) {
  const state = { items: [], query: '', category: 'all', filter: 'all', sort: 'recent', file: null, title: '', importCategory: 'photos', importing: false, selected: null, text: null, page: 0, pages: [0], chapters: [], pdf: null, textSize: 'normal' };
  let viewer = null;
  let pdfRender = null;
  let pdfGeneration = 0;
  let player = null;
  let playerReady = false;
  let lastQueued = 0;
  const pending = new Map();
  const saving = new Set();
  let lastError = '';

  function updateItem(item) {
    const index = state.items.findIndex(value => value.id === item.id);
    if (index === -1) state.items.unshift(item); else state.items[index] = item;
    if (state.selected?.id === item.id) state.selected = item;
  }
  function statusText() {
    if (lastError) return `Position not saved: ${lastError} Keep kidOS open and choose Retry positions.`;
    if (pending.size) return 'Saving your place…';
    return 'Your place is saved on this computer.';
  }
  function updateStatus() {
    document.querySelectorAll('[data-library-status]').forEach(element => { element.textContent = statusText(); });
    document.querySelectorAll('[data-library-retry]').forEach(element => { element.hidden = !lastError; });
  }
  async function flush(id) {
    if (saving.has(id) || !pending.has(id)) return;
    saving.add(id);
    try {
      while (pending.has(id)) {
        const position = pending.get(id);
        const { item } = await api(`/api/media/${encodeURIComponent(id)}/progress`, { method: 'PATCH', body: { position } });
        const current = state.items.find(value => value.id === item.id) || item;
        updateItem({ ...current, progress: item.progress });
        if (pending.get(id) === position) pending.delete(id);
      }
      if (!pending.size) lastError = '';
    } catch (error) { lastError = error.message || 'The local service is unavailable.'; }
    finally { saving.delete(id); updateStatus(); }
  }
  function queuePosition(position, id = state.selected?.id) {
    if (!id || !Number.isFinite(position) || position < 0) return;
    pending.set(id, position);
    updateStatus();
    void flush(id);
  }
  function capturePlayer() {
    if (player && playerReady && !player.error) queuePosition(player.ended ? 0 : Math.round(player.currentTime * 10) / 10);
  }
  function pause() { if (player) { capturePlayer(); player.pause(); } }
  function leave() {
    pause(); player = null; playerReady = false; viewer = null;
    pdfGeneration += 1; pdfRender?.cancel(); pdfRender = null;
    if (state.pdf) void state.pdf.destroy();
    state.selected = null; state.text = null; state.pdf = null; state.chapters = [];
  }
  async function refresh() {
    const { items } = await api('/api/media');
    state.items = items;
  }
  function progressNotice() {
    return node('div', { className: 'library-progress' },
      node('p', { 'data-library-status': '', role: 'status' }, statusText()),
      button('Retry positions', { className: 'retro small', hidden: !lastError, 'data-library-retry': '', onClick: () => {
        lastError = ''; for (const id of pending.keys()) void flush(id); updateStatus();
      } }),
    );
  }
  async function loadItem(item) {
      // Renew the per-process media cookie, including after a service restart.
      await api('/api/session');
      const { item: current } = await api(`/api/media/${encodeURIComponent(item.id)}`);
      let text = null, pdf = null, chapters = [];
      if (isPDF(current)) {
        const response = await api(`/media/${encodeURIComponent(item.id)}/content`, { raw: true });
        pdf = await openPdf(new Uint8Array(await response.arrayBuffer()));
      } else if (current.mimeType === 'application/epub+zip') {
        const response = await api(`/media/${encodeURIComponent(item.id)}/content`, { raw: true });
        ({ text, chapters } = await readEpub(new Uint8Array(await response.arrayBuffer())));
      } else if (isText(current)) {
        const response = await api(`/media/${encodeURIComponent(item.id)}/content`, { raw: true });
        text = await response.text();
      }
      leave();
      // A different desktop tab may have edited details since this catalog was
      // loaded. Progress responses merge into this cache, so refresh it too.
      updateItem(current);
      state.selected = current; state.text = text; state.pdf = pdf; state.chapters = chapters;
      const position = pending.get(item.id) ?? current.progress.position;
      state.pages = text === null ? [0] : bookPageStarts(text, chapters.map(chapter => chapter.start));
      state.page = pdf ? Math.min(position, pdf.document.numPages - 1) : Math.max(0, state.pages.findLastIndex(start => start <= position));
      viewer = null;
  }
  function open(item) { perform(() => loadItem(item), 'view-heading'); }
  function importFile(event) {
    event.preventDefault();
    const file = state.file;
    if (!file) return;
    perform(async () => {
      if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose a file between 1 byte and 64 MB. Text books must be under 2 MB.');
      const query = new URLSearchParams({ title: state.title.trim(), category: state.importCategory, filename: file.name });
      const { item, duplicate } = await api(`/api/media?${query}`, { method: 'POST', binary: file });
      updateItem(item);
      state.file = null; state.title = ''; state.importing = false;
      state.query = ''; state.category = item.category;
      state.importMessage = duplicate ? `“${item.title}” is already in your Library. Its place was kept.` : `Added “${item.title}” to your Library.`;
    }, 'view-heading');
  }
  function importView() {
    return node('form', { className: 'library-import', onSubmit: importFile },
      node('h3', {}, 'Add a file from this computer'),
      node('p', {}, 'Choose a local file to copy into Library. The original file stays where it is.'),
      node('label', {}, 'Choose file', node('input', { type: 'file', disabled: isBusy(), accept: '.jpg,.jpeg,.png,.webp,.mp3,.wav,.mp4,.webm,.txt,.pdf,.epub', onChange: event => {
        const file = event.target.files[0];
        if (!file) return;
        state.file = file; state.title = file.name.replace(/\.[^.]+$/, '').slice(0, 100); state.importCategory = guessedCategory(file.name); render('media-title');
      } })),
      state.file ? node('p', { className: 'selected-file' }, `Selected: ${state.file.name} · ${sizeLabel(state.file.size)}`) : null,
      node('label', {}, 'Title', node('input', { type: 'text', required: '', disabled: isBusy(), maxlength: '100', value: state.title, 'data-focus': 'media-title', onInput: event => { state.title = event.target.value; } })),
      node('label', {}, 'Shelf', node('select', { disabled: isBusy(), onChange: event => { state.importCategory = event.target.value; } }, Object.entries(categories).filter(([id]) => id !== 'all').map(([id, label]) => node('option', { value: id, ...(id === state.importCategory ? { selected: '' } : {}) }, label)))),
      node('div', { className: 'button-row' },
        button('Add to Library', { type: 'submit', className: 'retro primary', disabled: isBusy() || !state.file }),
        button('Cancel import', { onClick: () => { state.importing = false; state.file = null; state.title = ''; render('view-heading'); } }),
      ),
      node('p', { className: 'permission-note' }, 'JPG, PNG, WebP · MP3, WAV · MP4, WebM · TXT, PDF, EPUB. Up to 64 MB per file; TXT up to 2 MB. EPUB reads chapter text. Comics can be PDFs or image collections. Audio/video codecs depend on the browser.'),
      node('p', { className: 'permission-note' }, 'Development import: parent sign-in and parent-only import controls are not implemented yet.'),
    );
  }
  function itemTile(item) {
    const image = isImage(item);
    const emblem = image ? 'picture' : item.category === 'videos' ? 'film' : ['music', 'audiobooks'].includes(item.category) ? 'music' : 'library';
    return button([
      node('span', { className: `media-cover ${item.category}`, 'aria-hidden': 'true' }, icon(emblem)),
      node('strong', {}, `${details(item).favorite ? '★ ' : ''}${item.title}`),
      node('small', {}, `${categories[item.category]} · ${sizeLabel(item.size)}`),
      details(item).collection ? node('small', { className: 'media-collection' }, `${details(item).collection}${details(item).order ? ` · ${details(item).order}` : ''}`) : null,
      item.progress.position > 0 ? node('small', { className: 'media-bookmark' }, isPDF(item) ? `Continue on page ${item.progress.position + 1}` : isText(item) ? 'Continue reading' : `Continue at ${timeLabel(item.progress.position)}`) : null,
    ], { className: 'media-tile', 'aria-label': `Open ${item.title}`, onClick: () => open(item) });
  }
  function catalog() {
    const filtered = state.items.filter(item => (state.category === 'all' || item.category === state.category) && (state.filter === 'all' || state.filter === 'favorites' && details(item).favorite || state.filter === 'continue' && item.progress.position > 0) && `${item.title} ${item.filename} ${details(item).collection}`.toLocaleLowerCase().includes(state.query.trim().toLocaleLowerCase()));
    filtered.sort(state.sort === 'title' ? (a, b) => natural(a.title, b.title) : state.sort === 'collection' ? (a, b) => natural(details(a).collection, details(b).collection) || details(a).order - details(b).order || natural(a.title, b.title) : (a, b) => (b.progress.updatedAt || b.importedAt || '').localeCompare(a.progress.updatedAt || a.importedAt || '') || natural(a.title, b.title));
    return node('div', { className: 'library-view' },
      node('div', { className: 'library-heading' }, node('div', {}, node('h2', { tabindex: '-1', 'data-focus': 'view-heading' }, 'Library'), node('p', {}, 'Good things to come back to.')), node('div', { className: 'button-row' },
        button('Refresh', { onClick: () => perform(refresh, 'view-heading') }),
        button('Add file…', { className: 'retro primary', onClick: () => { state.importing = true; state.importMessage = ''; render('media-title'); } }),
      )),
      state.importMessage ? node('p', { className: 'library-message', role: 'status' }, state.importMessage) : null,
      state.importing ? importView() : null,
      node('div', { className: 'library-quick-filters', 'aria-label': 'Library collections' }, [['all', 'Everything'], ['favorites', 'Favorites'], ['continue', 'Continue']].map(([key, label]) => button(label, { className: `retro ${state.filter === key ? 'selected' : ''}`, 'aria-pressed': String(state.filter === key), onClick: () => { state.filter = key; render(); } }))),
      node('div', { className: 'library-filters' },
        node('label', {}, 'Search Library', node('input', { type: 'search', value: state.query, placeholder: 'Find a title or filename', 'data-focus': 'library-search', onInput: event => { state.query = event.target.value; render(); } })),
        node('label', {}, 'Shelf', node('select', { 'aria-label': 'Filter by shelf', 'data-focus': 'library-shelf', onChange: event => { state.category = event.target.value; render(); } }, Object.entries(categories).map(([id, label]) => node('option', { value: id, ...(id === state.category ? { selected: '' } : {}) }, label)))),
        node('label', {}, 'Sort', node('select', { 'aria-label': 'Sort Library', 'data-focus': 'library-sort', onChange: event => { state.sort = event.target.value; render(); } }, [['recent', 'Recently used'], ['title', 'Title'], ['collection', 'Collection order']].map(([id, label]) => node('option', { value: id, ...(id === state.sort ? { selected: '' } : {}) }, label)))),
      ),
      filtered.length ? node('div', { className: 'media-grid' }, filtered.map(itemTile)) : node('div', { className: 'library-empty' }, icon('library'), node('h3', {}, state.items.length ? 'Nothing on this shelf yet.' : 'A shelf of your own.'), node('p', {}, state.items.length ? 'Try another shelf or search.' : 'Add a book, song, film or picture from this computer.')),
      node('p', { className: 'library-count' }, `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'} · Stored on this computer`),
      pending.size || lastError ? progressNotice() : null,
    );
  }
  function mediaFailure(container, message) {
    container.replaceChildren(node('p', { role: 'alert' }, message), button('Try opening again', { onClick: () => open(state.selected) }));
  }
  function bookPage() {
    const pages = state.pages.length;
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    return node('div', { className: 'book-reader' },
      node('div', { className: 'book-preferences' },
        state.chapters.length ? node('label', {}, 'Chapter', node('select', { 'aria-label': 'Book chapter', onChange: event => {
          const chapter = state.chapters[Number(event.target.value)];
          if (!chapter) return;
          state.page = Math.max(0, state.pages.findLastIndex(start => start <= chapter.start));
          changePage(0);
        } }, state.chapters.map((chapter, index) => node('option', { value: index, ...(index === Math.max(0, state.chapters.findLastIndex(ch => ch.start <= state.pages[state.page])) ? { selected: '' } : {}) }, chapter.title)))) : null,
        node('label', {}, 'Text size', node('select', { 'aria-label': 'Reader text size', onChange: event => { state.textSize = event.target.value; changePage(0); } }, [['normal', 'Normal'], ['large', 'Large']].map(([value, label]) => node('option', { value, ...(state.textSize === value ? { selected: '' } : {}) }, label)))),
      ),
      node('div', { className: `book-paper ${state.textSize === 'large' ? 'book-large' : ''}`, tabindex: '0', 'aria-label': `Book text, page ${state.page + 1}`, 'data-focus': 'book-page' }, state.text.slice(state.pages[state.page], state.pages[state.page + 1])),
      node('div', { className: 'book-controls' },
        button('Previous page', { disabled: state.page === 0, onClick: () => changePage(-1) }),
        node('span', { role: 'status' }, `Page ${state.page + 1} of ${pages}`),
        button('Next page', { disabled: state.page >= pages - 1, onClick: () => changePage(1) }),
      ),
    );
  }
  function changePage(direction) {
    state.page = Math.max(0, Math.min(state.pages.length - 1, state.page + direction)); queuePosition(state.pages[state.page]);
    viewer.querySelector('.book-reader').replaceWith(bookPage());
    viewer.querySelector('[data-focus="book-page"]').focus();
  }
  function itemMeta(item) { return `${categories[item.category]} · ${item.filename} · ${sizeLabel(item.size)}${details(item).collection ? ` · ${details(item).collection}` : ''}`; }
  function saveDetails(values) {
    const id = state.selected.id;
    perform(async () => {
      const { item } = await api(`/api/media/${encodeURIComponent(id)}`, { method: 'PATCH', body: values });
      const current = state.items.find(value => value.id === item.id) || item;
      updateItem({ ...current, title: item.title, category: item.category, details: item.details });
      if (state.selected?.id !== id || !viewer) return;
      viewer.querySelector('[data-library-title]').textContent = item.title;
      viewer.querySelector('[data-library-meta]').textContent = itemMeta(item);
      viewer.querySelector('[data-library-favorite]').textContent = details(item).favorite ? '★ Favorited' : '☆ Add favorite';
      viewer.querySelector('[data-library-editor]').replaceChildren();
      const sequence = sequenceControls();
      viewer.querySelector('[data-library-sequence]').replaceChildren(...(sequence ? [sequence] : []));
    }, 'view-heading');
  }
  function metadataForm() {
    const item = state.selected, extra = details(item);
    const values = { title: item.title, category: item.category, ...extra };
    const allowed = isPDF(item) ? ['books', 'comics'] : isImage(item) ? ['photos', 'comics'] : ['music', 'audiobooks'].includes(item.category) ? ['music', 'audiobooks'] : [item.category];
    return node('form', { className: 'library-import library-details', onSubmit: event => { event.preventDefault(); saveDetails({ ...values, title: values.title.trim(), collection: values.collection.trim() }); } },
      node('h3', {}, 'Details'),
      node('label', {}, 'Title', node('input', { value: values.title, required: '', maxlength: '100', 'data-focus': 'library-edit-title', onInput: event => { values.title = event.target.value; } })),
      node('label', {}, 'Shelf', node('select', { 'aria-label': 'Item shelf', onChange: event => { values.category = event.target.value; } }, allowed.map(category => node('option', { value: category, ...(category === item.category ? { selected: '' } : {}) }, categories[category])))),
      node('label', {}, 'Collection or album', node('input', { value: extra.collection, maxlength: '80', placeholder: 'For example: Garden comic', 'aria-label': 'Collection or album', onInput: event => { values.collection = event.target.value; } })),
      node('label', {}, 'Order in collection', node('input', { type: 'number', min: '0', max: '9999', step: '1', value: extra.order, 'aria-label': 'Order in collection', onInput: event => { values.order = Number(event.target.value); } })),
      node('p', { className: 'permission-note' }, 'Use the same collection name to group chapters, comic pages, photos or tracks. A lower order comes first.'),
      node('div', { className: 'button-row' }, button('Save details', { type: 'submit', className: 'retro primary' }), button('Cancel details', { onClick: () => viewer.querySelector('[data-library-editor]').replaceChildren() })),
    );
  }
  function sequenceControls() {
    const items = librarySequence(state.items, state.selected), index = items.findIndex(item => item.id === state.selected.id);
    if (index === -1 || items.length < 2) return null;
    return node('div', { className: 'library-sequence' },
      button('Previous item', { disabled: index === 0, onClick: () => { if (index > 0) open(items[index - 1]); } }),
      node('span', {}, `${index + 1} of ${items.length}${details(state.selected).collection ? ` in ${details(state.selected).collection}` : ` ${categories[state.selected.category].toLowerCase()}`}`),
      button('Next item', { disabled: index === items.length - 1, onClick: () => { if (index < items.length - 1) open(items[index + 1]); } }),
    );
  }
  async function renderPdf(content, save = false) {
    const pdf = state.pdf, pageIndex = state.page, generation = ++pdfGeneration;
    pdfRender?.cancel(); pdfRender = null;
    content.replaceChildren(node('p', { role: 'status' }, `Opening page ${pageIndex + 1}…`));
    let page, timer;
    try {
      timer = setTimeout(() => { if (generation === pdfGeneration) { pdfRender?.cancel(); void pdf.destroy(); } }, 20000);
      page = await pdf.document.getPage(pageIndex + 1);
      if (generation !== pdfGeneration) return;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1000 / base.width, 4096 / Math.max(base.width, base.height), Math.sqrt(4 * 1024 * 1024 / (base.width * base.height)));
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('This PDF page has invalid dimensions.');
      const viewport = page.getViewport({ scale });
      const canvas = node('canvas', { className: 'library-pdf-page', width: Math.ceil(viewport.width), height: Math.ceil(viewport.height), role: 'img', 'aria-label': `PDF page ${pageIndex + 1}` });
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport, annotationMode: 0 });
      pdfRender = task;
      await task.promise;
      if (generation !== pdfGeneration) return;
      const text = await page.getTextContent();
      if (generation !== pdfGeneration) return;
      const plain = text.items.map(part => `${part.str || ''}${part.hasEOL ? '\n' : ' '}`).join('').slice(0, 100000);
      content.replaceChildren(canvas,
        node('details', { className: 'pdf-page-text' }, node('summary', {}, 'Read page text'), node('pre', {}, plain || 'This page is an image. It has no selectable text.')),
        node('div', { className: 'book-controls' }, button('Previous page', { disabled: pageIndex === 0, onClick: () => { state.page = pageIndex - 1; void renderPdf(content, true); } }), node('span', { role: 'status' }, `Page ${pageIndex + 1} of ${pdf.document.numPages}`), button('Next page', { disabled: pageIndex === pdf.document.numPages - 1, onClick: () => { state.page = pageIndex + 1; void renderPdf(content, true); } })),
      );
      if (save) queuePosition(pageIndex);
    } catch (error) { if (generation === pdfGeneration) mediaFailure(content, `This PDF page could not be rendered. ${error.message || 'Try opening it again.'}`); }
    finally { clearTimeout(timer); page?.cleanup(); if (generation === pdfGeneration) pdfRender = null; }
  }
  function selectedView() {
    if (viewer) return viewer;
    const item = state.selected;
    const content = node('div', { className: 'media-stage' });
    viewer = node('div', { className: 'media-viewer' },
      node('h2', { tabindex: '-1', 'data-focus': 'view-heading', 'data-library-title': '' }, item.title),
      node('p', { className: 'media-meta', 'data-library-meta': '' }, itemMeta(item)),
      node('div', { className: 'library-item-actions' },
        button(details(item).favorite ? '★ Favorited' : '☆ Add favorite', { 'data-library-favorite': '', onClick: () => { const current = state.selected; saveDetails({ title: current.title, category: current.category, ...details(current), favorite: !details(current).favorite }); } }),
        button('Edit details…', { onClick: () => { viewer.querySelector('[data-library-editor]').replaceChildren(metadataForm()); viewer.querySelector('[data-focus="library-edit-title"]').focus(); } }),
      ),
      node('div', { 'data-library-editor': '' }),
      node('div', { 'data-library-sequence': '' }, sequenceControls()), content,
    );
    if (isPDF(item)) { void renderPdf(content); viewer.append(progressNotice()); }
    else if (isText(item)) { content.append(bookPage()); viewer.append(progressNotice()); }
    else if (isImage(item)) {
      content.append(node('img', { className: 'library-image', src: `/media/${item.id}/content`, alt: item.title, onError: () => mediaFailure(content, 'This picture could not be opened. The file may be missing, damaged or unsupported. Try opening it again to reconnect.') }));
    } else {
      const position = pending.get(item.id) ?? item.progress.position;
      lastQueued = position; playerReady = false;
      player = node(item.category === 'videos' ? 'video' : 'audio', {
        className: 'library-player', controls: '', preload: 'metadata', playsinline: '', 'aria-label': item.title,
        src: `/media/${item.id}/content`,
        onLoadedmetadata: event => {
          if (event.currentTarget !== player) return;
          if (position > 0 && Number.isFinite(player.duration)) player.currentTime = Math.min(position, Math.max(0, player.duration - 0.1));
          playerReady = true;
        },
        onTimeupdate: event => { if (event.currentTarget === player && playerReady && Math.abs(player.currentTime - lastQueued) >= 10) { lastQueued = player.currentTime; capturePlayer(); } },
        onPause: event => { if (event.currentTarget === player) capturePlayer(); },
        onSeeked: event => { if (event.currentTarget === player) capturePlayer(); },
        onEnded: event => { if (event.currentTarget === player) queuePosition(0); },
        onError: event => { if (event.currentTarget !== player) return; playerReady = false; mediaFailure(content, 'This file could not be played. It may be missing, damaged, or use a codec this browser cannot decode. Try opening it again to reconnect.'); },
      });
      content.append(player);
      viewer.append(node('p', { className: 'media-help' }, 'Use the player controls to play, pause or seek. Your place saves while playing and when paused. Leaving or minimizing pauses playback.'), progressNotice());
    }
    return viewer;
  }
  return { refresh, leave, pause,
    snapshot: () => ({ mediaId: state.selected?.id || null }),
    restore: async id => { const item = state.items.find(item => item.id === id); if (item) await loadItem(item); return Boolean(item); },
    hasPending: () => pending.size > 0, isViewing: () => Boolean(state.selected),
    title: () => state.selected?.title || 'Library', view: () => state.selected ? selectedView() : catalog(),
    back: () => { leave(); render('view-heading'); },
  };
}
