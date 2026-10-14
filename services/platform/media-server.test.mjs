import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startKidOS } from './server.mjs';
import { MAX_MEDIA_BYTES } from './media.mjs';

const BOOK = Buffer.from('Chapter one\nA local book.\nChapter two\nStill at home.');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
const bookMetadata = { title: 'Our book', category: 'books', filename: 'our-book.txt' };
const importPath = metadata => `/api/media?${new URLSearchParams(metadata)}`;

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kidos-media-http-'));
  let app = await startKidOS({ dataDir, port: 0, runnerPort: 0 });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { get app() { return app; }, dataDir, async restart() { await app.close(); app = await startKidOS({ dataDir, port: 0, runnerPort: 0 }); } };
}
async function session(app) {
  const response = await fetch(`${app.platformOrigin}/api/session`);
  const { token } = await response.json();
  const setCookie = response.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];
  return {
    token, cookie, setCookie,
    api: (path, method = 'GET', body) => fetch(`${app.platformOrigin}${path}`, { method, headers: { 'X-KidOS-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    upload: (metadata = bookMetadata, bytes = BOOK, headers = {}) => fetch(`${app.platformOrigin}${importPath(metadata)}`, { method: 'POST', headers: { 'X-KidOS-Token': token, 'Content-Type': 'application/octet-stream', ...headers }, body: bytes }),
    content: (id, options = {}) => fetch(`${app.platformOrigin}/media/${id}/content`, { ...options, headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin', ...options.headers } }),
  };
}
async function imported(client, metadata, bytes) {
  const response = await client.upload(metadata, bytes);
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).item;
}

test('Library HTTP imports originals, deduplicates, persists bookmarks and reconnects after restart', async t => {
  const f = await fixture(t);
  let client = await session(f.app);
  assert.match(client.setCookie, new RegExp(`^kidos_media_${new URL(f.app.platformOrigin).port}=`));
  assert.match(client.setCookie, /; Path=\/media\/; HttpOnly; SameSite=Strict$/);
  assert.ok(!client.cookie.includes(client.token));
  assert.deepEqual(await (await client.api('/api/media')).json(), { items: [] });
  const item = await imported(client);
  assert.equal(item.title, 'Our book');
  assert.equal(item.filename, 'our-book.txt');
  assert.equal(item.size, BOOK.length);
  assert.equal(item.category, 'books');
  assert.deepEqual((await (await client.api(`/api/media/${item.id}`)).json()).item, item);
  const duplicate = await client.upload({ ...bookMetadata, title: 'Another title' });
  assert.equal(duplicate.status, 201);
  const duplicateResult = await duplicate.json();
  assert.equal(duplicateResult.duplicate, true);
  assert.equal(duplicateResult.item.id, item.id);
  assert.equal(duplicateResult.item.title, 'Our book');
  const progress = await client.api(`/api/media/${item.id}/progress`, 'PATCH', { position: 17 });
  assert.equal(progress.status, 200);
  assert.equal((await progress.json()).item.progress.position, 17);
  const oldCookie = client.cookie;
  const oldToken = client.token;
  await f.restart();
  client = await session(f.app);
  const catalog = await (await client.api('/api/media')).json();
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.items[0].progress.position, 17);
  assert.deepEqual(Buffer.from(await (await client.content(item.id)).arrayBuffer()), BOOK);
  assert.equal((await fetch(`${f.app.platformOrigin}/media/${item.id}/content`, { headers: { Cookie: oldCookie } })).status, 403);
  assert.equal((await fetch(`${f.app.platformOrigin}/api/media`, { headers: { 'X-KidOS-Token': oldToken } })).status, 403);
});

test('Media GET supports complete, open, suffix and clamped byte ranges; HEAD describes the full file', async t => {
  const { app } = await fixture(t);
  const client = await session(app);
  const item = await imported(client);
  const full = await client.content(item.id);
  assert.equal(full.status, 200);
  assert.match(full.headers.get('content-type'), /^text\/plain/);
  assert.equal(full.headers.get('content-length'), String(BOOK.length));
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('cache-control'), 'no-store');
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(full.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(full.headers.get('access-control-allow-origin'), null);
  assert.match(full.headers.get('content-security-policy'), /media-src 'self'/);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), BOOK);
  for (const [range, start, end] of [['bytes=0-0', 0, 0], ['bytes=9-16', 9, 16], ['bytes=5-', 5, BOOK.length - 1], ['bytes=-4', BOOK.length - 4, BOOK.length - 1], ['bytes=7-999', 7, BOOK.length - 1], ['bytes=-999', 0, BOOK.length - 1]]) {
    const response = await client.content(item.id, { headers: { Range: range } });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${BOOK.length}`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), BOOK.subarray(start, end + 1));
  }
  for (const range of [`bytes=${BOOK.length}-`, 'bytes=9-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-5', 'items=0-1', 'bytes=9007199254740992-', 'bytes=a-b']) {
    const response = await client.content(item.id, { headers: { Range: range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get('content-range'), `bytes */${BOOK.length}`);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  const head = await client.content(item.id, { method: 'HEAD', headers: { Range: 'bytes=0-3' } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(BOOK.length));
  assert.equal(head.headers.get('content-range'), null);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const unmatchedValidator = await client.content(item.id, { headers: { Range: 'bytes=0-3', 'If-Range': '"unrecognized"' } });
  assert.equal(unmatchedValidator.status, 200);
  assert.deepEqual(Buffer.from(await unmatchedValidator.arrayBuffer()), BOOK);
});

test('Missing or changed media bytes fail clearly without serving partial bytes or losing catalog entries', async t => {
  const f = await fixture(t);
  let client = await session(f.app);
  const book = await imported(client);
  const photo = await imported(client, { title: 'Pixel', filename: 'pixel.png', category: 'photos' }, PNG);
  await writeFile(join(f.dataDir, 'media', `${book.digest}.blob`), Buffer.alloc(BOOK.length, 120));
  await rm(join(f.dataDir, 'media', `${photo.digest}.blob`));
  for (const item of [book, photo]) {
    const response = await client.content(item.id, { headers: { Range: 'bytes=0-1' } });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /missing|changed|damaged|corrupt|unavailable|integrity/i);
    assert.equal(response.headers.get('content-range'), null);
    assert.equal((await client.content(item.id, { method: 'HEAD' })).status, 503);
  }
  await f.restart(); client = await session(f.app);
  assert.equal((await (await client.api('/api/media')).json()).items.length, 2);
  assert.equal((await client.content(book.id)).status, 503);
  assert.equal((await client.content(photo.id)).status, 503);
  assert.equal((await client.api(`/api/media/${book.id}/progress`, 'PATCH', { position: 1 })).status, 200);
});

test('Media requires desktop authority and never grants library access to app origins or URL tokens', async t => {
  const { app } = await fixture(t);
  const client = await session(app);
  const item = await imported(client);
  const content = `${app.platformOrigin}/media/${item.id}/content`;
  for (const headers of [{}, { 'X-KidOS-Token': client.token }, { Cookie: `${client.cookie}bad` }]) assert.equal((await fetch(content, { headers })).status, 403);
  assert.equal((await fetch(`${content}?token=${client.token}`)).status, 403);
  for (const headers of [{ Origin: 'null' }, { Origin: app.runnerOrigin }, { Origin: 'https://elsewhere.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'none' }]) {
    assert.equal((await client.content(item.id, { headers })).status, 403);
  }
  assert.equal((await client.content(item.id, { headers: { Origin: app.platformOrigin } })).status, 200);
  assert.equal((await client.content(item.id, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${app.runnerOrigin}/media/${item.id}/content`, { headers: { Cookie: client.cookie } })).status, 404);
  for (const [path, method] of [['/api/media', 'GET'], [importPath(bookMetadata), 'POST'], [`/api/media/${item.id}/progress`, 'PATCH']]) {
    assert.equal((await fetch(`${app.platformOrigin}${path}`, { method })).status, 403);
    assert.equal((await fetch(`${app.platformOrigin}${path}`, { method, headers: { 'X-KidOS-Token': client.token, Origin: app.runnerOrigin } })).status, 403);
  }
  const denied = await fetch(`${app.platformOrigin}/api/session`, { headers: { Origin: app.runnerOrigin } });
  assert.equal(denied.headers.get('set-cookie'), null);
});

test('Media rejects unsupported imports, unsafe metadata, request size and invalid progress before changing catalog', async t => {
  const { app } = await fixture(t);
  const client = await session(app);
  for (const metadata of [{ ...bookMetadata, filename: '../escape.txt' }, { ...bookMetadata, filename: 'photo.png' }, { ...bookMetadata, category: 'other' }, { ...bookMetadata, title: '' }]) {
    const response = await client.upload(metadata);
    assert.ok([400, 415].includes(response.status), `${JSON.stringify(metadata)}: ${await response.text()}`);
  }
  for (const [metadata, bytes] of [[{ ...bookMetadata, filename: 'app.svg', category: 'photos' }, Buffer.from('<svg></svg>')], [{ ...bookMetadata, filename: 'app.html' }, Buffer.from('<script>alert(1)</script>')], [{ ...bookMetadata, filename: 'fake.png', category: 'photos' }, BOOK], [bookMetadata, Buffer.alloc(0)]]) {
    assert.ok([400, 415].includes((await client.upload(metadata, bytes)).status));
  }
  assert.equal((await client.upload(bookMetadata, BOOK, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await client.upload(bookMetadata, BOOK, { 'Content-Encoding': 'gzip' })).status, 415);
  for (const suffix of ['&title=Twice', '&extra=1', `&${'x'.repeat(2100)}`]) {
    const response = await fetch(`${app.platformOrigin}${importPath(bookMetadata)}${suffix}`, { method: 'POST', headers: { 'X-KidOS-Token': client.token, 'Content-Type': 'application/octet-stream' }, body: BOOK });
    assert.equal(response.status, 400);
  }
  const oversized = await new Promise((resolve, reject) => {
    const req = request(`${app.platformOrigin}${importPath(bookMetadata)}`, { method: 'POST', headers: { 'X-KidOS-Token': client.token, 'Content-Type': 'application/octet-stream', 'Content-Length': MAX_MEDIA_BYTES + 1 } }, res => { res.resume(); res.once('end', () => { resolve(res.statusCode); req.destroy(); }); });
    req.on('error', reject); req.flushHeaders();
  });
  assert.equal(oversized, 413);
  const chunked = await new Promise((resolve, reject) => {
    const req = request(`${app.platformOrigin}${importPath(bookMetadata)}`, { method: 'POST', headers: { 'X-KidOS-Token': client.token, 'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(Buffer.alloc(MAX_MEDIA_BYTES + 1));
  });
  assert.equal(chunked, 413);
  assert.deepEqual((await (await client.api('/api/media')).json()).items, []);
  const book = await imported(client);
  for (const payload of [{}, { position: -1 }, { position: BOOK.length + 1 }, { position: 1.5 }, { position: 1, unapproved: true }]) assert.equal((await client.api(`/api/media/${book.id}/progress`, 'PATCH', payload)).status, 400);
  const photo = await imported(client, { title: 'Pixel', filename: 'pixel.png', category: 'photos' }, PNG);
  assert.equal((await client.api(`/api/media/${photo.id}/progress`, 'PATCH', { position: 1 })).status, 400);
  assert.equal((await client.content('not-an-id')).status, 400);
  assert.equal((await client.content(`media-${'a'.repeat(64)}`)).status, 404);
});

test('Media admission limits bound simultaneous uploads and reads and recover after errors', async t => {
  const { app } = await fixture(t);
  const client = await session(app);
  const item = await imported(client);
  const originalRead = app.store.readMedia.bind(app.store);
  const waiting = [];
  let allEntered;
  const entered = new Promise(resolve => { allEntered = resolve; });
  app.store.readMedia = async id => { await new Promise(resolve => { waiting.push(resolve); if (waiting.length === 2) allEntered(); }); return originalRead(id); };
  const first = client.content(item.id);
  const second = client.content(item.id);
  await entered;
  const busy = await client.content(item.id);
  assert.equal(busy.status, 503);
  assert.match((await busy.json()).error, /already opening/);
  waiting.forEach(resolve => resolve());
  for (const response of await Promise.all([first, second])) assert.deepEqual(Buffer.from(await response.arrayBuffer()), BOOK);
  app.store.readMedia = originalRead;
  assert.equal((await client.content(item.id)).status, 200);
  const originalImport = app.store.importMedia.bind(app.store);
  let importEntered, releaseImport;
  const importing = new Promise(resolve => { importEntered = resolve; });
  const waitImport = new Promise(resolve => { releaseImport = resolve; });
  app.store.importMedia = async (...args) => { importEntered(); await waitImport; return originalImport(...args); };
  const upload = client.upload();
  await importing;
  assert.equal((await client.upload()).status, 503);
  releaseImport();
  assert.equal((await upload).status, 201);
  app.store.importMedia = originalImport;
  assert.equal((await client.upload()).status, 201);
  assert.equal((await client.upload(bookMetadata, BOOK, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await client.upload()).status, 201);
});

test('Aborted media requests retain their admission slots until pending disk reads finish', async t => {
  const { app } = await fixture(t);
  const client = await session(app);
  const item = await imported(client);
  const originalRead = app.store.readMedia.bind(app.store);
  const waiting = [];
  const closedResponses = [];
  let allEntered, allRead;
  let finished = 0;
  const entered = new Promise(resolve => { allEntered = resolve; });
  const completed = new Promise(resolve => { allRead = resolve; });
  app.platform.on('request', (req, res) => {
    if (req.url === `/media/${item.id}/content`) closedResponses.push(new Promise(resolve => res.once('close', resolve)));
  });
  app.store.readMedia = async id => {
    await new Promise(resolve => { waiting.push(resolve); if (waiting.length === 2) allEntered(); });
    const result = await originalRead(id);
    if (++finished === 2) allRead();
    return result;
  };
  const clients = Array.from({ length: 2 }, () => {
    const req = request(`${app.platformOrigin}/media/${item.id}/content`, { headers: { Cookie: client.cookie, 'Sec-Fetch-Site': 'same-origin' } });
    req.on('error', () => {}); req.end(); return req;
  });
  await entered;
  clients.forEach(req => req.destroy());
  await Promise.all(closedResponses);
  assert.equal((await client.content(item.id)).status, 503);
  waiting.forEach(resolve => resolve());
  await completed;
  app.store.readMedia = originalRead;
  const response = await client.content(item.id);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), BOOK);
});
