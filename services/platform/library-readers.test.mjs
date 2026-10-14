import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openEpubArchive, archivePath, resolveBookPath, chapterText, safeBookXML, EPUB_LIMITS } from '../../apps/desktop/library-readers.mjs';
import { bookPageStarts } from '../../apps/desktop/library.mjs';
import '../../apps/desktop/library-vendor/zipjs/zip-native.mjs';
const zip = globalThis.zip;
async function archive(extra = [], options = {}) {
  const writer = new zip.ZipWriter(new zip.Uint8ArrayWriter(), { useWebWorkers: false, zip64: false, dataDescriptor: false });
  await writer.add('mimetype', new zip.TextReader('application/epub+zip'), { level: 0 });
  for (const [name, text] of extra) await writer.add(name, new zip.TextReader(text), { level: 0, ...options });
  return writer.close();
}
const text = value => ({ nodeType: 3, nodeValue: value });
const element = (localName, children = [], attributes = {}) => ({ nodeType: 1, localName, childNodes: children, getAttribute: key => attributes[key] ?? null });

test('offline vendor assets match their pinned manifest including licenses', async () => {
  const root = new URL('../../apps/desktop/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('library-vendor/manifest.json', root)));
  for (const asset of manifest.assets) {
    const bytes = await readFile(new URL(asset.path, root));
    assert.equal(bytes.length, asset.size, asset.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.path);
  }
  assert.equal(manifest.packages.length, 2);
  assert.ok(manifest.assets.some(asset => asset.path === 'library-vendor/pdfjs/LICENSE'));
  assert.ok(manifest.assets.some(asset => asset.path === 'library-vendor/zipjs/LICENSE'));
});

test('EPUB archive reader reads stored and deflated Unicode text with CRC checks', async () => {
  for (const options of [{}, { level: 6 }]) {
    const content = 'A 🌙 chapter with small paragraphs.\n'.repeat(500);
    const reader = await openEpubArchive(await archive([['Books/chapter.xhtml', content]], options));
    try { assert.equal(await reader.read('Books/chapter.xhtml'), content); }
    finally { await reader.close(); }
  }
});

test('EPUB rejects unsafe paths, external chapter references, encryption and too many entries', async () => {
  for (const unsafe of ['../chapter.xhtml', '/chapter.xhtml', 'a/../b', 'a\\b', 'C:book', 'a\0b']) assert.throws(() => archivePath(unsafe));
  for (const href of ['https://remote.example/book', '//remote.example/book', 'javascript:run()', 'data:text/html,hello', 'page.xhtml?remote=yes']) assert.throws(() => resolveBookPath('EPUB/book.opf', href));
  assert.equal(resolveBookPath('EPUB/book.opf', 'chapters/one.xhtml#beginning'), 'EPUB/chapters/one.xhtml');
  assert.equal(resolveBookPath('EPUB/package/book.opf', '../chapter%20one.xhtml'), 'EPUB/chapter one.xhtml');
  await assert.rejects(openEpubArchive(await archive([['META-INF/encryption.xml', '<encrypted/>']])), /Encrypted/);
  const many = Array.from({ length: EPUB_LIMITS.entries }, (_, i) => [`entry${i}.txt`, '']);
  await assert.rejects(openEpubArchive(await archive(many)), /512/);
});

test('EPUB rejects oversized expansion metadata and a corrupted compressed entry', async () => {
  const bytes = await archive([['chapter.xhtml', 'A readable chapter.']]);
  const badSize = new Uint8Array(bytes);
  const view = new DataView(badSize.buffer);
  let patched = false;
  for (let i = 0; i < badSize.length - 46; i++) {
    if (view.getUint32(i, true) === 0x02014b50 && view.getUint16(i + 28, true) === 'chapter.xhtml'.length) { view.setUint32(i + 24, EPUB_LIMITS.entry + 1, true); patched = true; break; }
  }
  assert.equal(patched, true);
  await assert.rejects(openEpubArchive(badSize), /expands/);
  const damaged = new Uint8Array(bytes);
  const index = Buffer.from(damaged).indexOf('A readable chapter.'); assert.ok(index > 0); damaged[index] ^= 1;
  const reader = await openEpubArchive(damaged);
  try { await assert.rejects(reader.read('chapter.xhtml'), /CRC|signature/i); }
  finally { await reader.close(); }
});

test('EPUB read applies actual output bounds and missing-file errors', async () => {
  const reader = await openEpubArchive(await archive([['chapter.xhtml', 'A longer chapter.']]));
  try {
    await assert.rejects(reader.read('chapter.xhtml', 2), /limit/);
    await assert.rejects(reader.read('missing.xhtml'), /missing/);
  } finally { await reader.close(); }
});

test('EPUB chapter text never reproduces executable nodes, embedded HTML or CSS', () => {
  const body = element('body', [element('h1', [text('Moon garden')]), element('script', [text('stealSecrets()')]), element('style', [text('body{display:none}')]), element('p', [text('Look '), element('b', [text('up')]), text(' at the moon.')]), element('img', [], { src: 'https://remote.invalid/', onerror: 'run()', alt: 'A round moon' }), element('iframe', [text('external')]), element('p', [text('Invisible')], { hidden: '' })]);
  const result = chapterText(body);
  assert.match(result, /Moon garden/); assert.match(result, /Look up at the moon/); assert.match(result, /\[A round moon\]/);
  for (const forbidden of ['stealSecrets', 'display:none', 'external', 'Invisible', 'https:', '<img']) assert.equal(result.includes(forbidden), false);
});

test('EPUB chapter selection has an exact page start even for short chapters', () => {
  const first = 'Chapter one\nA very short chapter.\n\n';
  const second = 'Chapter two\nAnother short chapter.\n\n';
  const starts = bookPageStarts(first + second, [0, first.length]);
  assert.deepEqual(starts, [0, first.length]);
  const selectedPage = starts.findLastIndex(start => start <= first.length);
  assert.equal((first + second).slice(starts[selectedPage]), second);
  assert.equal([0, first.length].findLastIndex(start => start <= starts[selectedPage]), 1);
});

test('EPUB permits the plain HTML doctype but rejects external or custom entity declarations', () => {
  const document = '<?xml version="1.0"?>\n<!DOCTYPE html>\n<html><body>Words</body></html>';
  assert.equal(safeBookXML(document), '<?xml version="1.0"?>\n<html><body>Words</body></html>');
  for (const bad of ['<!DOCTYPE html SYSTEM "https://example.invalid/x.dtd"><html/>', '<!DOCTYPE html [<!ENTITY x "expanded">]><html/>', '<!ENTITY x "stuff"><html/>']) assert.throws(() => safeBookXML(bad), /custom XML/);
});
