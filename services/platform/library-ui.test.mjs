import test from 'node:test';
import assert from 'node:assert/strict';
import { createLibrary, librarySequence } from '../../apps/desktop/library.mjs';

// This event/DOM fixture checks UI state and asynchronous save ordering. It does
// not emulate browser codecs, native controls, layout, or accessibility behavior.
class Element {
  constructor(tag, attributes = {}, children = []) {
    this.tag = tag; this.attributes = attributes; this.children = [];
    Object.assign(this, attributes);
    this.currentTime = 0; this.duration = 100; this.ended = false;
    this.append(...children.flat(Infinity));
  }
  append(...children) {
    for (const child of children.filter(value => value !== null && value !== undefined && value !== false)) {
      this.children.push(child); if (child instanceof Element) child.parent = this;
    }
  }
  replaceChildren(...children) { this.children = []; this.append(...children.map(child => child === null || child === undefined ? String(child) : child)); }
  replaceWith(element) {
    const index = this.parent.children.indexOf(this);
    this.parent.children[index] = element; element.parent = this.parent;
  }
  get textContent() { return this.children.map(child => child instanceof Element ? child.textContent : String(child)).join(''); }
  set textContent(text) { this.children = [text]; }
  matches(selector) {
    if (selector.startsWith('.')) return this.attributes.className?.split(' ').includes(selector.slice(1));
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) return Object.hasOwn(this.attributes, attribute[1]) && (attribute[2] === undefined || this.attributes[attribute[1]] === attribute[2]);
    return this.tag === selector;
  }
  all(predicate) {
    return this.children.flatMap(child => child instanceof Element ? [...(predicate(child) ? [child] : []), ...child.all(predicate)] : []);
  }
  querySelectorAll(selector) { return this.all(element => element.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  emit(name, extra = {}) { return this.attributes[name]?.({ currentTarget: this, target: this, preventDefault() {}, ...extra }); }
  focus() { this.focused = true; }
  pause() { queueMicrotask(() => this.emit('onPause')); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const item = (id, category = 'books') => ({ id, title: id, category, filename: `${id}.${category === 'books' ? 'txt' : 'wav'}`, size: 10000, progress: { position: 0, updatedAt: null } });
const story = 'The night garden has silver leaves and a little moon. 🌙\n\n'.repeat(150);

async function fixture(t, { items = [item('Book')], text = story, patch, upload } = {}) {
  let busy = false, mounted, lastWork;
  const errors = [], writes = [], uploads = [], edits = [];
  const saved = new Map(items.map(value => [value.id, structuredClone(value)]));
  const previousDocument = globalThis.document;
  globalThis.document = { querySelectorAll: selector => mounted?.querySelectorAll(selector) || [] };
  t.after(() => { globalThis.document = previousDocument; });
  const node = (tag, attributes, ...children) => new Element(tag, attributes, children);
  const api = async (path, options = {}) => {
    if (options.method === 'POST') {
      uploads.push({ path, options });
      return upload(path, options);
    }
    if (options.method === 'PATCH') {
      if (!path.endsWith('/progress')) {
        const id = decodeURIComponent(path.split('/')[3]);
        const { title, category, ...details } = options.body;
        edits.push({ id, ...options.body });
        const value = saved.get(id); Object.assign(value, { title, category, details });
        return { item: structuredClone(value) };
      }
      const id = decodeURIComponent(path.split('/')[3]), position = options.body.position;
      writes.push({ id, position });
      if (patch) await patch(id, position, writes.length);
      const value = saved.get(id); value.progress = { position, updatedAt: '2026-10-08T10:00:00.000Z' };
      return { item: structuredClone(value) };
    }
    if (path === '/api/session') return {};
    if (path === '/api/media') return { items: [...saved.values()].map(value => structuredClone(value)) };
    if (path.startsWith('/media/')) return { text: async () => text };
    return { item: structuredClone(saved.get(decodeURIComponent(path.split('/')[3]))) };
  };
  const render = () => { mounted = library.view(); };
  const perform = work => {
    if (busy) return;
    busy = true; render();
    lastWork = Promise.resolve().then(work).catch(error => errors.push(error)).finally(() => { busy = false; render(); });
  };
  const library = createLibrary({ node, button: (label, attributes = {}) => node('button', { disabled: busy, ...attributes }, label), icon: name => node('svg', {}, name), api, perform, render, isBusy: () => busy });
  await library.refresh(); render();
  const findButton = label => mounted.all(element => element.tag === 'button' && (element.textContent === label || element.attributes['aria-label'] === label))[0];
  return {
    library, saved, writes, uploads, edits, errors, render, findButton,
    get mounted() { return mounted; },
    async click(label) { const target = findButton(label); assert.ok(target, `Button exists: ${label}`); target.emit('onClick'); await lastWork; await tick(); },
    async submit() { mounted.querySelector('form').emit('onSubmit'); await lastWork; await tick(); },
  };
}

test('Library serializes saves and commits the newest reading position after an in-flight save', async t => {
  const first = deferred(), second = deferred();
  const f = await fixture(t, { patch: (_, __, count) => count === 1 ? first.promise : second.promise });
  await f.click('Open Book');
  const firstEnd = f.mounted.querySelector('.book-paper').textContent.length;
  await f.click('Next page');
  const secondEnd = firstEnd + f.mounted.querySelector('.book-paper').textContent.length;
  await f.click('Next page');
  assert.deepEqual(f.writes, [{ id: 'Book', position: firstEnd }]);
  assert.equal(f.library.hasPending(), true);
  first.resolve(); await tick();
  assert.deepEqual(f.writes, [{ id: 'Book', position: firstEnd }, { id: 'Book', position: secondEnd }]);
  assert.equal(f.library.hasPending(), true);
  second.resolve(); await tick();
  assert.equal(f.saved.get('Book').progress.position, secondEnd);
  assert.equal(f.library.hasPending(), false);
});

test('Library favorite and detail edits preserve a connected native player and saved place', async t => {
  const f = await fixture(t, { items: [item('Song', 'music')] });
  await f.click('Open Song');
  const player = f.mounted.querySelector('audio'); player.emit('onLoadedmetadata'); player.currentTime = 12; player.emit('onSeeked'); await tick();
  await f.click('☆ Add favorite');
  assert.equal(f.saved.get('Song').details.favorite, true);
  assert.equal(f.mounted.querySelector('[data-library-sequence]').textContent, '');
  assert.equal(f.mounted.querySelector('audio'), player);
  assert.equal(f.saved.get('Song').progress.position, 12);
  await f.click('Edit details…');
  const title = f.mounted.querySelector('[data-focus="library-edit-title"]'); title.value = 'A chapter'; title.emit('onInput');
  const collection = f.mounted.querySelector('[aria-label="Collection or album"]'); collection.value = 'Evening stories'; collection.emit('onInput');
  const order = f.mounted.querySelector('[aria-label="Order in collection"]'); order.value = '2'; order.emit('onInput');
  const shelf = f.mounted.querySelector('[aria-label="Item shelf"]'); shelf.value = 'audiobooks'; shelf.emit('onChange');
  await f.submit();
  assert.equal(f.library.title(), 'A chapter');
  assert.equal(f.saved.get('Song').category, 'audiobooks');
  assert.deepEqual(f.saved.get('Song').details, { favorite: true, collection: 'Evening stories', order: 2 });
  assert.equal(f.mounted.querySelector('audio'), player);
});

test('opening fresh details replaces a stale catalog before progress and favorite saves', async t => {
  const f = await fixture(t);
  // Simulate a second tab changing metadata after this Library loaded its list.
  f.saved.get('Book').title = 'Renamed elsewhere';
  f.saved.get('Book').details = { favorite: false, collection: 'New collection', order: 4 };
  await f.click('Open Book');
  assert.equal(f.library.title(), 'Renamed elsewhere');
  await f.click('Next page'); await tick();
  assert.equal(f.library.title(), 'Renamed elsewhere');
  await f.click('☆ Add favorite');
  assert.equal(f.saved.get('Book').title, 'Renamed elsewhere');
  assert.deepEqual(f.saved.get('Book').details, { favorite: true, collection: 'New collection', order: 4 });
});

test('Library filters favorites and unfinished items and searches collection names', async t => {
  const first = { ...item('Book'), details: { favorite: true, collection: 'Garden', order: 1 } };
  const second = { ...item('Other'), progress: { position: 80, updatedAt: '2026-10-08T10:00:00.000Z' } };
  const f = await fixture(t, { items: [first, second] });
  await f.click('Favorites'); assert.ok(f.findButton('Open Book')); assert.equal(f.findButton('Open Other'), undefined);
  await f.click('Continue'); assert.ok(f.findButton('Open Other')); assert.equal(f.findButton('Open Book'), undefined);
  await f.click('Everything');
  const input = f.mounted.querySelector('[data-focus="library-search"]'); input.value = 'Garden'; input.emit('onInput');
  assert.ok(f.findButton('Open Book')); assert.equal(f.findButton('Open Other'), undefined);
});

test('Comic and album navigation follows numeric collection order without autoplay', async t => {
  const pages = [10, 2, 1].map(order => ({ ...item(`Page ${order}`, 'comics'), mimeType: 'image/png', details: { favorite: false, collection: 'Moon comic', order } }));
  const outsider = { ...item('Other', 'comics'), mimeType: 'image/png' };
  assert.deepEqual(librarySequence([...pages, outsider], pages[0]).map(value => value.title), ['Page 1', 'Page 2', 'Page 10']);
  const f = await fixture(t, { items: pages });
  await f.click('Open Page 1'); await f.click('Next item'); assert.equal(f.library.title(), 'Page 2');
  await f.click('Previous item'); assert.equal(f.library.title(), 'Page 1');
  assert.equal(f.findButton('Previous item').disabled, true);
});

test('Library keeps the latest failed position through navigation and retries it explicitly', async t => {
  const first = deferred();
  const f = await fixture(t, { patch: (_, __, count) => count === 1 ? first.promise : undefined });
  await f.click('Open Book');
  const firstEnd = f.mounted.querySelector('.book-paper').textContent.length;
  await f.click('Next page');
  const secondEnd = firstEnd + f.mounted.querySelector('.book-paper').textContent.length;
  await f.click('Next page');
  const latestPage = f.mounted.querySelector('.book-paper').textContent;
  first.reject(new Error('Disk unavailable')); await tick();
  assert.equal(f.library.hasPending(), true);
  assert.match(f.mounted.textContent, /Position not saved: Disk unavailable/);
  f.library.back(); await f.click('Open Book');
  assert.equal(f.mounted.querySelector('.book-paper').textContent, latestPage);
  assert.match(f.mounted.textContent, /Page 3 of /);
  await f.click('Retry positions');
  assert.equal(f.saved.get('Book').progress.position, secondEnd);
  assert.equal(f.library.hasPending(), false);
  assert.equal(f.findButton('Retry positions').hidden, true);
});

test('book pages preserve every character without splitting words and reopen old offsets on the containing page', async t => {
  const f = await fixture(t);
  await f.click('Open Book');
  const pages = [];
  while (true) {
    pages.push(f.mounted.querySelector('.book-paper').textContent);
    assert.ok(pages.length < 20, 'Pagination must make progress');
    if (f.findButton('Next page').disabled) break;
    await f.click('Next page');
  }
  assert.ok(pages.length > 2);
  assert.equal(pages.join(''), story);
  for (let index = 1; index < pages.length; index++) {
    assert.ok(/\s$/.test(pages[index - 1]) || /^\s/.test(pages[index]), 'Words remain together at a page boundary');
  }
  f.library.back();
  f.saved.get('Book').progress.position = pages[0].length + 55;
  await f.click('Open Book');
  assert.equal(f.mounted.querySelector('.book-paper').textContent, pages[1]);
  await f.click('Previous page');
  assert.equal(f.saved.get('Book').progress.position, 0);
});

test('fallback pagination keeps surrogate pairs intact even when a long token crosses the size limit', async t => {
  const text = `${'a'.repeat(2199)}🌙${'b'.repeat(2199)}🪴${'c'.repeat(2600)}`;
  const f = await fixture(t, { text });
  await f.click('Open Book');
  const pages = [];
  while (true) {
    const page = f.mounted.querySelector('.book-paper').textContent;
    assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(page), 'A page cannot start/end with half a surrogate pair');
    pages.push(page);
    assert.ok(pages.length < 20, 'Pagination must make progress');
    if (f.findButton('Next page').disabled) break;
    await f.click('Next page');
  }
  assert.equal(pages.join(''), text);
});

test('finished playback stays reset when the viewer is left or paused', async t => {
  const f = await fixture(t, { items: [item('Song', 'music')] });
  await f.click('Open Song');
  const player = f.mounted.querySelector('audio');
  player.emit('onLoadedmetadata'); player.currentTime = 100; player.ended = true; player.emit('onEnded');
  await tick(); f.library.pause(); f.library.leave(); await tick();
  assert.ok(f.writes.length > 0);
  assert.ok(f.writes.every(write => write.position === 0));
  assert.equal(f.saved.get('Song').progress.position, 0);
});

test('leaving saves the last playback position and ignores a detached player error', async t => {
  const f = await fixture(t, { items: [item('First', 'music'), item('Second', 'music')] });
  await f.click('Open First');
  const first = f.mounted.querySelector('audio');
  first.emit('onLoadedmetadata'); first.currentTime = 12.34;
  f.library.back(); await tick();
  assert.equal(f.saved.get('First').progress.position, 12.3);
  await f.click('Open Second');
  const second = f.mounted.querySelector('audio'); second.emit('onLoadedmetadata');
  first.emit('onError'); second.currentTime = 22; second.emit('onTimeupdate'); await tick();
  assert.equal(f.saved.get('Second').progress.position, 22);
  assert.equal(f.library.hasPending(), false);
});

test('failed imports keep the chosen bytes, title, and shelf for a retry', async t => {
  const imported = item('Imported', 'audiobooks');
  let attempt = 0;
  const f = await fixture(t, { upload: async () => { if (++attempt === 1) throw new Error('Storage unavailable'); return { item: imported, duplicate: false }; } });
  await f.click('Add file…');
  const file = { name: 'story.wav', size: 2400 };
  const input = f.mounted.all(element => element.tag === 'input' && element.type === 'file')[0];
  input.files = [file]; input.emit('onChange');
  const title = f.mounted.querySelector('[data-focus="media-title"]'); title.value = 'Evening story'; title.emit('onInput');
  const shelf = f.mounted.querySelector('form').querySelector('select'); shelf.value = 'audiobooks'; shelf.emit('onChange');
  await f.submit();
  assert.match(f.errors[0].message, /Storage unavailable/);
  assert.equal(f.mounted.querySelector('[data-focus="media-title"]').value, 'Evening story');
  assert.match(f.mounted.textContent, /Selected: story.wav/);
  await f.submit();
  assert.equal(f.uploads.length, 2);
  for (const upload of f.uploads) {
    assert.equal(upload.options.binary, file);
    const query = new URL(upload.path, 'http://localhost').searchParams;
    assert.equal(query.get('title'), 'Evening story'); assert.equal(query.get('category'), 'audiobooks');
  }
  assert.equal(f.mounted.querySelector('form'), undefined);
  assert.match(f.mounted.textContent, /Added “Imported”/);
});
