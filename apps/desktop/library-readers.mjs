// Offline readers. Archive contents never become host paths or executable DOM.
export const EPUB_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, entries: 512, expanded: 32 * 1024 * 1024, entry: 8 * 1024 * 1024, text: 2 * 1024 * 1024, chapters: 256 });
export const PDF_PAGE_LIMIT = 1000;

export function archivePath(name) {
  if (typeof name !== 'string' || !name || name.length > 512 || /[\\\x00-\x1f\x7f:]/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..')) throw new Error('This book has an unsafe archive path.');
  return name;
}
export function resolveBookPath(base, href) {
  if (typeof href !== 'string' || !href || /[\\\x00-\x1f\x7f]/.test(href)) throw new Error('This book has an invalid chapter reference.');
  const origin = 'https://kidos-epub.invalid';
  const url = new URL(href, `${origin}/${base}`);
  if (url.origin !== origin || url.search || url.username || url.password) throw new Error('This book references a file outside its archive.');
  let resolved;
  try { resolved = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Error('This book has an invalid chapter path.'); }
  return archivePath(resolved);
}

export async function openEpubArchive(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > EPUB_LIMITS.bytes) throw new Error('This EPUB exceeds the 64 MB limit.');
  await import('./library-vendor/zipjs/zip-native.mjs');
  const zip = globalThis.zip;
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(bytes), { useWebWorkers: false, strictness: 'strict', checkCrc32: true, checkOverlappingEntry: true });
  const entries = new Map();
  let count = 0, total = 0;
  try {
    for await (const entry of reader.getEntriesGenerator({ filenameValidation: 'strict' })) {
      if (++count > EPUB_LIMITS.entries) throw new Error('This EPUB contains more than 512 archive entries.');
      archivePath(entry.filename);
      if (entries.has(entry.filename)) throw new Error('This EPUB contains duplicate archive paths.');
      if (entry.encrypted || ![0, 8].includes(entry.compressionMethod)) throw new Error('Encrypted or unusually compressed EPUB files are not supported.');
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > EPUB_LIMITS.entry || (total += entry.uncompressedSize) > EPUB_LIMITS.expanded) throw new Error('This EPUB expands beyond the reading limit (8 MB per entry, 32 MB total).');
      if (entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * 200)) throw new Error('This EPUB has an unusually large compression ratio.');
      entries.set(entry.filename, entry);
    }
    if (entries.has('META-INF/encryption.xml')) throw new Error('Encrypted EPUBs and protected fonts are not supported.');
    const read = async (name, limit = EPUB_LIMITS.text) => {
      const entry = entries.get(archivePath(name));
      if (!entry || entry.directory) throw new Error(`A required book file is missing: ${name}`);
      if (entry.uncompressedSize > limit) throw new Error('A book chapter exceeds the reading limit.');
      const chunks = []; let length = 0;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('This book file took too long to decompress.')), 15000);
      try {
        await entry.getData({ writable: new WritableStream({ write(chunk) {
          length += chunk.length;
          if (length > limit || length > entry.uncompressedSize) throw new Error('A book chapter expands beyond its declared size.');
          chunks.push(new Uint8Array(chunk));
        } }) }, { signal: controller.signal, useWebWorkers: false, strictness: 'strict', checkCrc32: true, checkOverlappingEntry: true });
        const result = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
        if (length !== entry.uncompressedSize) throw new Error('A book chapter has a damaged size.');
        return new TextDecoder('utf-8', { fatal: true }).decode(result);
      } finally { clearTimeout(timeout); }
    };
    if (await read('mimetype', 20) !== 'application/epub+zip') throw new Error('This archive is not an EPUB book.');
    return { read, close: () => reader.close() };
  } catch (error) { await reader.close(); throw error; }
}
export function safeBookXML(text) {
  // EPUB 3 commonly declares HTML's inert doctype. Remove only that exact
  // leading form; never admit external identifiers or an internal entity set.
  text = text.replace(/^(\s*(?:<\?xml[^?]*\?>\s*)?)<!DOCTYPE\s+html\s*>\s*/i, '$1');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Books with custom XML entities are not supported.');
  return text;
}
function xml(text) {
  const result = new DOMParser().parseFromString(safeBookXML(text), 'application/xml');
  if (result.getElementsByTagName('parsererror').length) throw new Error('This book contains damaged XML.');
  return result;
}
function elements(parent, name) { return [...parent.getElementsByTagNameNS('*', name)]; }
export function chapterText(root) {
  const blocks = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'section', 'article', 'tr']);
  const suppressed = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'head', 'noscript']);
  let text = '';
  function append(value) { text += value; if (text.length > EPUB_LIMITS.text) throw new Error('This book has more than 2 MB of readable text.'); }
  function visit(node) {
    if (node.nodeType === 3) { append(node.nodeValue.replace(/\s+/g, ' ')); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName.toLowerCase();
    if (suppressed.has(tag) || node.getAttribute('hidden') !== null) return;
    if (tag === 'br') { append('\n'); return; }
    if (tag === 'img') { const alt = node.getAttribute('alt'); if (alt) append(` [${alt}] `); return; }
    if (blocks.has(tag)) append('\n\n');
    for (const child of node.childNodes) visit(child);
    if (blocks.has(tag)) append('\n\n');
  }
  visit(root);
  return text.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export async function readEpub(bytes) {
  const archive = await openEpubArchive(bytes);
  try {
    const container = xml(await archive.read('META-INF/container.xml'));
    const roots = elements(container, 'rootfile').filter(value => value.getAttribute('media-type') === 'application/oebps-package+xml');
    if (roots.length !== 1) throw new Error('Choose an EPUB with one readable book package.');
    const packagePath = archivePath(roots[0].getAttribute('full-path'));
    const packageXML = xml(await archive.read(packagePath));
    const manifests = elements(packageXML, 'manifest');
    const spines = elements(packageXML, 'spine');
    if (manifests.length !== 1 || spines.length !== 1) throw new Error('This EPUB has no single reading order.');
    const manifest = new Map();
    for (const entry of elements(manifests[0], 'item')) {
      const id = entry.getAttribute('id');
      if (!id || manifest.has(id)) throw new Error('This EPUB has duplicate or missing chapter identifiers.');
      manifest.set(id, entry);
    }
    const reading = elements(spines[0], 'itemref').filter(value => value.getAttribute('linear') !== 'no');
    if (!reading.length || reading.length > EPUB_LIMITS.chapters) throw new Error('An EPUB must have between 1 and 256 readable chapters.');
    let text = ''; const chapters = [];
    for (const ref of reading) {
      const item = manifest.get(ref.getAttribute('idref'));
      if (!item || item.getAttribute('media-type') !== 'application/xhtml+xml') throw new Error('This EPUB uses an unsupported chapter format.');
      const doc = xml(await archive.read(resolveBookPath(packagePath, item.getAttribute('href'))));
      const body = elements(doc, 'body')[0];
      if (!body) throw new Error('A book chapter has no readable text.');
      const chapter = chapterText(body);
      if (!chapter) continue;
      const heading = ['h1', 'h2', 'h3'].flatMap(name => elements(body, name))[0];
      chapters.push({ title: (heading?.textContent.trim() || `Chapter ${chapters.length + 1}`).slice(0, 100), start: text.length });
      text += `${chapter}\n\n`;
      if (text.length > EPUB_LIMITS.text) throw new Error('This book has more than 2 MB of readable text.');
    }
    if (!text.trim()) throw new Error('This EPUB has no readable text. Illustrated-only and fixed-layout books need a different reader.');
    return { text, chapters };
  } finally { await archive.close(); }
}

export async function openPdf(bytes) {
  const pdfjs = await import('./library-vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/library-vendor/pdfjs/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: true, useWasm: false, cMapUrl: '/library-vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/library-vendor/pdfjs/standard_fonts/', maxImageSize: 16 * 1024 * 1024, canvasMaxAreaInBytes: 16 * 1024 * 1024, stopAtErrors: true });
  task.onPassword = () => { void task.destroy(); };
  const timer = setTimeout(() => { void task.destroy(); }, 20000);
  try {
    const document = await task.promise;
    if (document.numPages > PDF_PAGE_LIMIT) { await task.destroy(); throw new Error('PDF books can have at most 1000 pages.'); }
    return { document, destroy: () => task.destroy() };
  } catch (error) { await task.destroy(); throw new Error(`This PDF could not be opened. Password-protected or damaged PDFs are not supported. ${error.message || ''}`); }
  finally { clearTimeout(timer); }
}
