import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, symlink, link, mkdir, stat, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, StoreError } from './store.mjs';
import { MAX_MEDIA_BYTES, MAX_BOOK_BYTES, MAX_MEDIA_TOTAL_BYTES, MAX_MEDIA_ITEMS, prepareMedia, editMediaDetails, validateMediaMap, validateMediaProgress, mediaDetails } from './media.mjs';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
const book = Buffer.from('Chapter one\nA local book. 🌙\n');
const bookInput = { title: 'Moon stories', category: 'books', filename: 'Moon stories.txt' };
const imageInput = { title: 'My photo', category: 'photos', filename: 'photo.png' };
const status = code => error => error instanceof StoreError && error.status === code;
const blobPath = (directory, item) => path.join(directory, 'media', `${item.digest}.blob`);
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kidos-media-'));
  let store = await Store.open(directory);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, get store() { return store; }, async reopen() { await store.close(); store = await Store.open(directory); } };
}
function wav() {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF'); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40);
  return bytes;
}

test('media bytes, catalog and reading/playback positions survive restart without touching project data', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject('Keep my code');
  const installed = await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
  await f.store.trashProject(project.id, { revision: 1 });
  const game = await f.store.recordGameResult('moon-hopper', { roundId: 'a'.repeat(32), score: 42, won: false });
  const result = await f.store.importMedia(bookInput, book);
  assert.equal(result.duplicate, false);
  assert.equal(result.item.textLength, book.toString('utf8').length);
  const photo = (await f.store.importMedia(imageInput, png)).item;
  const audio = (await f.store.importMedia({ title: 'Small sound', category: 'audiobooks', filename: 'tiny.wav' }, wav())).item;
  const reading = await f.store.saveMediaProgress(result.item.id, { position: 13 });
  const playing = await f.store.saveMediaProgress(audio.id, { position: 1.25 });
  assert.deepEqual((await f.store.readMedia(photo.id)).bytes, png);
  assert.equal((await stat(blobPath(f.directory, photo))).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(f.directory, 'media'))).mode & 0o777, 0o700);
  assert.equal(await readFile(blobPath(f.directory, result.item), 'utf8'), book.toString('utf8'));
  await f.reopen();
  assert.deepEqual(f.store.getMedia(result.item.id), reading);
  assert.deepEqual(f.store.getMedia(audio.id), playing);
  assert.deepEqual((await f.store.readMedia(result.item.id)).bytes, book);
  assert.equal(f.store.listMedia().length, 3);
  assert.equal(f.store.listTrash()[0].id, project.id);
  assert.deepEqual(f.store.getInstalled(project.id), installed);
  assert.deepEqual(f.store.getGameProgress('moon-hopper'), game);
  const stateText = await readFile(path.join(f.directory, 'state.json'), 'utf8');
  assert.equal(stateText.includes('Chapter one'), false);
});

test('duplicate bytes serialize to one item and preserve title, category, progress and independent return values', async t => {
  const f = await fixture(t);
  const content = Buffer.from(book);
  const input = { ...bookInput };
  const importing = f.store.importMedia(input, content);
  input.title = 'changed by caller'; content.fill(0);
  const first = await importing;
  await f.store.saveMediaProgress(first.item.id, { position: 7 });
  const results = await Promise.all([
    f.store.importMedia({ ...bookInput, title: 'Duplicate title' }, book),
    f.store.importMedia(bookInput, book),
  ]);
  for (const result of results) {
    assert.equal(result.duplicate, true);
    assert.equal(result.item.title, bookInput.title);
    assert.equal(result.item.progress.position, 7);
  }
  first.item.title = 'mutated return';
  f.store.listMedia()[0].progress.position = 500;
  assert.equal(f.store.getMedia(first.item.id).title, bookInput.title);
  assert.equal(f.store.getMedia(first.item.id).progress.position, 7);
  assert.equal((await readdir(path.join(f.directory, 'media'))).length, 1);
  assert.deepEqual((await f.store.readMedia(first.item.id)).bytes, book);
});

test('supported containers are signature checked without claiming to decode their tracks', () => {
  const webp = Buffer.from('524946460c000000574542505650382000000000', 'hex');
  const mp4 = Buffer.from('000000146674797069736f6d0000000069736f6d', 'hex');
  const webm = Buffer.from('1a45dfa300004282847765626d00000000', 'hex');
  const cases = [
    ['photo.jpg', 'photos', Buffer.from('ffd8ffffd9', 'hex'), 'image/jpeg'],
    ['page.PNG', 'comics', png, 'image/png'],
    ['photo.webp', 'photos', webp, 'image/webp'],
    ['music.mp3', 'music', Buffer.from('49443304000000000000', 'hex'), 'audio/mpeg'],
    ['audio.wav', 'audiobooks', wav(), 'audio/wav'],
    ['video.mp4', 'videos', mp4, 'video/mp4'],
    ['video.webm', 'videos', webm, 'video/webm'],
    ['book.txt', 'books', book, 'text/plain'],
  ];
  for (const [filename, category, bytes, mimeType] of cases) assert.equal(prepareMedia({ title: 'Example', filename, category }, bytes).mimeType, mimeType);
});

test('imports reject path-like names, invalid metadata, unsupported active formats and mismatched signatures', async t => {
  const f = await fixture(t);
  for (const filename of ['../book.txt', '/book.txt', 'a\\book.txt', '.hidden.txt', 'a%2fbook.txt', 'C:book.txt', 'book\0.txt', 'book.html', 'book.svg', 'book.pdf', 'book.epub', 'book.zip', 'no-extension']) {
    await assert.rejects(f.store.importMedia({ ...bookInput, filename }, book), status(400), filename);
  }
  for (const input of [null, {}, { ...bookInput, extra: true }, { ...bookInput, category: 'photos' }, { ...bookInput, title: ' ' }, { ...bookInput, title: '\ud800' }, { ...bookInput, filename: '\ud800.txt' }]) await assert.rejects(f.store.importMedia(input, book), status(400));
  for (const bytes of [Buffer.alloc(0), Buffer.from([0xff, 0xff]), Buffer.from('binary\0text')]) await assert.rejects(f.store.importMedia(bookInput, bytes), status(400));
  await assert.rejects(f.store.importMedia(imageInput, book), status(400));
  await assert.rejects(f.store.importMedia(bookInput, 'not a buffer'), status(400));
  await assert.rejects(f.store.importMedia(bookInput, Buffer.alloc(MAX_BOOK_BYTES + 1, 65)), status(413));
  await assert.rejects(f.store.importMedia(imageInput, Buffer.alloc(MAX_MEDIA_BYTES + 1)), status(413));
  assert.deepEqual(f.store.listMedia(), []);
  assert.equal((await readdir(f.directory)).includes('media'), false);
});

test('progress validates item kind and bounded exact positions', async t => {
  const f = await fixture(t);
  const item = (await f.store.importMedia(bookInput, book)).item;
  const image = (await f.store.importMedia(imageInput, png)).item;
  const audio = (await f.store.importMedia({ title: 'Sound', category: 'music', filename: 'a.wav' }, wav())).item;
  for (const input of [null, {}, { position: -1 }, { position: NaN }, { position: Infinity }, { position: '1' }, { position: 0.5 }, { position: item.textLength + 1 }, { position: 1, extra: true }]) await assert.rejects(f.store.saveMediaProgress(item.id, input), status(400));
  await assert.rejects(f.store.saveMediaProgress(image.id, { position: 0 }), status(400));
  await assert.rejects(f.store.saveMediaProgress(audio.id, { position: 604801 }), status(400));
  await assert.rejects(f.store.saveMediaProgress('../outside', { position: 0 }), status(400));
  await assert.rejects(f.store.readMedia(`media-${'0'.repeat(64)}`), status(404));
  await f.store.saveMediaProgress(item.id, { position: item.textLength });
  await f.store.saveMediaProgress(audio.id, { position: 604800 });
  assert.equal(f.store.getMedia(item.id).progress.position, item.textLength);
});

test('missing, changed, symlinked and hardlinked blobs fail while catalog and other work stay available', async t => {
  const f = await fixture(t);
  const item = (await f.store.importMedia(bookInput, book)).item;
  const file = blobPath(f.directory, item);
  await rm(file);
  await assert.rejects(f.store.readMedia(item.id), error => status(503)(error) && /missing/.test(error.message));
  await assert.rejects(f.store.importMedia(bookInput, book), status(503));
  await writeFile(file, Buffer.alloc(book.length, 65));
  await assert.rejects(f.store.readMedia(item.id), error => status(503)(error) && /integrity/.test(error.message));
  await rm(file);
  const outside = path.join(f.directory, 'outside.txt');
  await writeFile(outside, book);
  await symlink(outside, file);
  await assert.rejects(f.store.readMedia(item.id), status(503));
  await rm(file);
  await link(outside, file);
  await assert.rejects(f.store.readMedia(item.id), status(503));
  await rm(file);
  await writeFile(file, book);
  await f.reopen();
  assert.deepEqual(f.store.getMedia(item.id), item);
  assert.deepEqual((await f.store.readMedia(item.id)).bytes, book);
  assert.equal((await f.store.createProject('Still available')).name, 'Still available');
});

test('symlinked blob directory and unsafe unrelated entries cannot redirect import writes', async t => {
  const f = await fixture(t);
  const outside = path.join(f.directory, 'outside'); await mkdir(outside);
  const directory = path.join(f.directory, 'media'); await symlink(outside, directory);
  await assert.rejects(f.store.importMedia(bookInput, book), status(503));
  assert.deepEqual(await readdir(outside), []);
  await rm(directory); await mkdir(directory);
  await symlink(outside, path.join(directory, 'redirect'));
  await assert.rejects(f.store.importMedia(bookInput, book), status(503));
  assert.deepEqual(f.store.listMedia(), []);
});

test('physical quota counts interrupted orphan files and rejects before writing a blob or catalog entry', async t => {
  const f = await fixture(t);
  const directory = path.join(f.directory, 'media'); await mkdir(directory);
  const orphan = path.join(directory, '.interrupted.tmp'); await writeFile(orphan, '');
  await truncate(orphan, MAX_MEDIA_TOTAL_BYTES); // Sparse capacity fixture, no 1 GiB allocation.
  const before = await readFile(path.join(f.directory, 'state.json'), 'utf8');
  await assert.rejects(f.store.importMedia(bookInput, book), status(409));
  assert.deepEqual(await readdir(directory), ['.interrupted.tmp']);
  assert.equal(await readFile(path.join(f.directory, 'state.json'), 'utf8'), before);
});

test('catalog item limit is checked before writing bytes and duplicates remain usable at capacity', async t => {
  const f = await fixture(t);
  const existing = (await f.store.importMedia(bookInput, book)).item;
  await f.store.close();
  const file = path.join(f.directory, 'state.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  for (let n = 1; n < MAX_MEDIA_ITEMS; n++) {
    const item = prepareMedia({ ...bookInput, title: `Book ${n}` }, Buffer.from(`Story ${n}`));
    state.media[item.id] = item;
  }
  await writeFile(file, JSON.stringify(state)); await f.reopen();
  await assert.rejects(f.store.importMedia(bookInput, Buffer.from('One more')), status(409));
  assert.equal((await f.store.importMedia(bookInput, book)).item.id, existing.id);
  assert.equal((await readdir(path.join(f.directory, 'media'))).length, 1);
});

test('concurrent imports serialize physical capacity checks and cannot overfill the blob directory', async t => {
  const f = await fixture(t);
  const directory = path.join(f.directory, 'media'); await mkdir(directory);
  const orphan = path.join(directory, '.interrupted.tmp'); await writeFile(orphan, '');
  await truncate(orphan, MAX_MEDIA_TOTAL_BYTES - book.length - 1);
  const results = await Promise.allSettled([
    f.store.importMedia(bookInput, book),
    f.store.importMedia(bookInput, Buffer.from('A second different story.')),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.status, 409);
  assert.equal(f.store.listMedia().length, 1);
  assert.equal((await readdir(directory)).length, 2);
});

test('failed catalog commit leaves a recoverable unreferenced blob and no advertised missing file', async t => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.directory, 'state.json'), 'utf8');
  await mkdir(path.join(f.directory, 'state.backup.json'));
  await assert.rejects(f.store.importMedia(bookInput, book), status(503));
  assert.equal(await readFile(path.join(f.directory, 'state.json'), 'utf8'), before);
  assert.equal((await readdir(path.join(f.directory, 'media'))).length, 1);
  await rm(path.join(f.directory, 'state.backup.json'), { recursive: true }); await f.reopen();
  assert.deepEqual(f.store.listMedia(), []);
  const imported = await f.store.importMedia(bookInput, book);
  assert.equal(imported.duplicate, false);
  assert.deepEqual((await f.store.readMedia(imported.item.id)).bytes, book);
});

test('schema 3 migration preserves exact prior bytes, Trash, installations, scores and older archives', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject('Before Library');
  const installed = await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
  await f.store.trashProject(project.id, { revision: 1 });
  const game = await f.store.recordGameResult('tiny-racer', { roundId: 'b'.repeat(32), score: 75, won: true });
  await f.store.close();
  const file = path.join(f.directory, 'state.json');
  const previous = JSON.parse(await readFile(file, 'utf8')); previous.schemaVersion = 3; delete previous.media; delete previous.workspace; delete previous.mail;
  const original = JSON.stringify(previous, null, 2);
  await writeFile(file, original); await writeFile(path.join(f.directory, 'state.pre-v3.older.json'), 'previous archive');
  await f.reopen();
  assert.deepEqual(f.store.getInstalled(project.id), installed);
  assert.equal(f.store.listTrash()[0].id, project.id);
  assert.deepEqual(f.store.getGameProgress('tiny-racer'), game);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ...previous, schemaVersion: 6, media: {}, workspace: { revision: 0, windows: [], activeId: null, editorDraft: null }, mail: { people: {}, drafts: {}, messages: {} } });
  const archive = (await readdir(f.directory)).find(name => name.startsWith('state.pre-v6.'));
  assert.equal(await readFile(path.join(f.directory, archive), 'utf8'), original);
  await f.store.importMedia(bookInput, book); await f.reopen();
  assert.equal(await readFile(path.join(f.directory, archive), 'utf8'), original);
  assert.equal(await readFile(path.join(f.directory, 'state.pre-v3.older.json'), 'utf8'), 'previous archive');
});

test('Library details preserve file identity and progress through edit, duplicate import and restart', async t => {
  const f = await fixture(t);
  const imported = (await f.store.importMedia({ title: 'Tiny song', category: 'music', filename: 'tiny.wav' }, wav())).item;
  assert.deepEqual(mediaDetails(imported), { favorite: false, collection: '', order: 0 });
  await f.store.saveMediaProgress(imported.id, { position: 7.5 });
  const updated = await f.store.editMedia(imported.id, { title: 'Chapter 2', category: 'audiobooks', favorite: true, collection: 'Moon stories', order: 2 });
  assert.equal(updated.progress.position, 7.5);
  assert.equal(updated.filename, imported.filename); assert.equal(updated.digest, imported.digest);
  const duplicate = await f.store.importMedia({ title: 'Another title', category: 'music', filename: 'different.wav' }, wav());
  assert.deepEqual(duplicate.item, updated);
  await f.reopen();
  assert.deepEqual(f.store.getMedia(imported.id), updated);
  assert.deepEqual((await f.store.readMedia(imported.id)).bytes, wav());
});

test('Library details reject incompatible shelves, extra fields and malformed collection metadata', () => {
  const original = prepareMedia(bookInput, book);
  const values = { title: 'A title', category: 'books', favorite: true, collection: 'Series', order: 1 };
  for (const change of [{ category: 'music' }, { filename: '../outside.txt' }, { title: ' bad ' }, { favorite: 'yes' }, { collection: 'x\0' }, { collection: 'x'.repeat(81) }, { order: -1 }, { order: 10000 }, { order: 0.5 }]) assert.throws(() => editMediaDetails(original, { ...values, ...change }), StoreError);
  validateMediaMap({ [original.id]: original });
  const edited = editMediaDetails(original, values);
  validateMediaMap({ [edited.id]: edited });
  assert.equal(Object.hasOwn(original, 'details'), false);
  assert.throws(() => validateMediaMap({ [edited.id]: { ...edited, details: { ...edited.details, authority: true } } }), StoreError);
});

test('PDF and EPUB have bounded format-specific positions and retain their original bytes', async t => {
  const f = await fixture(t);
  const pdfBytes = Buffer.from('%PDF-1.7\nSynthetic signature fixture, not a rendered PDF.\n%%EOF\n');
  const pdf = (await f.store.importMedia({ title: 'Picture story', category: 'comics', filename: 'story.pdf' }, pdfBytes)).item;
  assert.equal(pdf.mimeType, 'application/pdf'); assert.equal(pdf.textLength, null);
  await f.store.saveMediaProgress(pdf.id, { position: 7 });
  for (const position of [-1, 0.5, 1000]) assert.throws(() => validateMediaProgress(pdf, { position }), StoreError);
  const epubBytes = Buffer.alloc(58); epubBytes.writeUInt32LE(0x04034b50); epubBytes.writeUInt32LE(20, 18); epubBytes.writeUInt32LE(20, 22); epubBytes.writeUInt16LE(8, 26); epubBytes.write('mimetypeapplication/epub+zip', 30);
  const epub = (await f.store.importMedia({ title: 'Text story', category: 'books', filename: 'story.epub' }, epubBytes)).item;
  assert.equal(epub.mimeType, 'application/epub+zip'); assert.equal(epub.textLength, null);
  await f.store.saveMediaProgress(epub.id, { position: 2000 });
  assert.throws(() => validateMediaProgress(epub, { position: MAX_BOOK_BYTES + 1 }), StoreError);
  await f.reopen();
  assert.equal(f.store.getMedia(pdf.id).progress.position, 7); assert.equal(f.store.getMedia(epub.id).progress.position, 2000);
  assert.deepEqual((await f.store.readMedia(pdf.id)).bytes, pdfBytes);
  const compressedMimetype = Buffer.from(epubBytes); compressedMimetype.writeUInt16LE(8, 8);
  assert.throws(() => prepareMedia({ title: 'Bad', category: 'books', filename: 'bad.epub' }, compressedMimetype), StoreError);
});

test('invalid catalog metadata recovers prior state without trusting forged host paths', async t => {
  for (const corrupt of [item => { item.filename = '../outside.txt'; }, item => { item.digest = '../outside'; }, item => { item.progress.position = item.textLength + 1; }, item => { item.mimeType = 'text/html'; }]) {
    const f = await fixture(t);
    const item = (await f.store.importMedia(bookInput, book)).item;
    await f.store.saveMediaProgress(item.id, { position: 3 }); await f.store.close();
    const file = path.join(f.directory, 'state.json');
    const state = JSON.parse(await readFile(file, 'utf8')); corrupt(state.media[item.id]);
    await writeFile(file, JSON.stringify(state)); await f.reopen();
    assert.match(f.store.recoveryNotice, /Recovered/);
    assert.equal(f.store.getMedia(item.id).progress.position, 0);
    assert.deepEqual((await f.store.readMedia(item.id)).bytes, book);
  }
});
