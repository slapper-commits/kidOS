import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { StoreError, exactKeys, isRecord } from '../../packages/app-contract/manifest.mjs';

export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
export const MAX_BOOK_BYTES = 2 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 1000;
export const MAX_EPUB_TEXT = 2 * 1024 * 1024;
export const MAX_MEDIA_ITEMS = 512;
export const MAX_MEDIA_TOTAL_BYTES = 1024 * 1024 * 1024;
export const MEDIA_CATEGORIES = ['photos', 'comics', 'music', 'audiobooks', 'videos', 'books'];
const MEDIA_ID = /^media-[a-f0-9]{64}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const formats = {
  jpg: ['image/jpeg', ['photos', 'comics']], jpeg: ['image/jpeg', ['photos', 'comics']],
  png: ['image/png', ['photos', 'comics']], webp: ['image/webp', ['photos', 'comics']],
  mp3: ['audio/mpeg', ['music', 'audiobooks']], wav: ['audio/wav', ['music', 'audiobooks']],
  mp4: ['video/mp4', ['videos']], webm: ['video/webm', ['videos']], txt: ['text/plain', ['books']],
  pdf: ['application/pdf', ['books', 'comics']], epub: ['application/epub+zip', ['books']],
};
const isoDate = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const invalidUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateMediaId(id) {
  if (typeof id !== 'string' || !MEDIA_ID.test(id)) throw new StoreError('Invalid Library item ID.');
}
function validateMetadata(input) {
  if (typeof input.title !== 'string' || input.title !== input.title.trim() || input.title.length < 1 || input.title.length > 100 || /[\x00-\x1f\x7f]/.test(input.title) || invalidUnicode.test(input.title)) throw new StoreError('Use a Library title of 1–100 characters without control characters.');
  if (typeof input.filename !== 'string' || input.filename !== input.filename.trim() || input.filename.length < 1 || input.filename.length > 180 || /[\x00-\x1f\x7f/\\:%]/.test(input.filename) || input.filename.startsWith('.') || invalidUnicode.test(input.filename)) throw new StoreError('Use a plain local filename without paths, encoded characters, or control characters.');
  const extension = input.filename.split('.').at(-1).toLowerCase();
  const format = Object.hasOwn(formats, extension) ? formats[extension] : null;
  if (!format || !format[1].includes(input.category)) throw new StoreError('This file format is not supported on that shelf. Use JPEG/PNG/WebP images, MP3/WAV audio, MP4/WebM video, or TXT/PDF/EPUB books.');
  return format[0];
}
function sniff(bytes, mimeType) {
  const ascii = (start, end) => bytes.toString('ascii', start, end);
  if (mimeType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (mimeType === 'image/png') return bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && ascii(12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
  if (mimeType === 'image/webp') return bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && bytes.readUInt32LE(4) === bytes.length - 8;
  if (mimeType === 'audio/wav') return bytes.length >= 44 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE' && bytes.readUInt32LE(4) === bytes.length - 8;
  if (mimeType === 'audio/mpeg') return bytes.length >= 10 && (ascii(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0 && (bytes[2] & 0xf0) !== 0xf0 && (bytes[2] & 0x0c) !== 0x0c));
  if (mimeType === 'video/mp4') return bytes.length >= 20 && ascii(4, 8) === 'ftyp' && bytes.readUInt32BE(0) >= 16 && bytes.readUInt32BE(0) <= bytes.length;
  if (mimeType === 'video/webm') return bytes.length >= 16 && bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) && bytes.subarray(4, Math.min(bytes.length, 4096)).includes(Buffer.from('webm'));
  if (mimeType === 'application/pdf') return /^%PDF-(?:1\.[0-7]|2\.0)/.test(ascii(0, 8)) && bytes.subarray(Math.max(0, bytes.length - 1024)).includes(Buffer.from('%%EOF'));
  // EPUB's first ZIP member must be its uncompressed, unencrypted mimetype.
  // This is a container signature check only: the browser performs bounded ZIP
  // and package validation before reading. The service never decompresses it.
  if (mimeType === 'application/epub+zip') return bytes.length >= 58 && bytes.readUInt32LE(0) === 0x04034b50 && (bytes.readUInt16LE(6) & 9) === 0 && bytes.readUInt16LE(8) === 0 && bytes.readUInt32LE(18) === 20 && bytes.readUInt32LE(22) === 20 && bytes.readUInt16LE(26) === 8 && bytes.readUInt16LE(28) === 0 && ascii(30, 38) === 'mimetype' && ascii(38, 58) === 'application/epub+zip';
  return false;
}
export function mediaProgressKind(item) {
  if (item.mimeType === 'application/pdf') return 'page';
  if (item.mimeType === 'text/plain' || item.mimeType === 'application/epub+zip') return 'text';
  if (item.mimeType.startsWith('image/')) return 'none';
  return 'time';
}
export function mediaDetails(item) { return item.details || { favorite: false, collection: '', order: 0 }; }
function validateDetails(details) {
  exactKeys(details, ['favorite', 'collection', 'order'], 'Library details');
  if (typeof details.favorite !== 'boolean' || typeof details.collection !== 'string' || details.collection !== details.collection.trim() || details.collection.length > 80 || /[\x00-\x1f\x7f]/.test(details.collection) || invalidUnicode.test(details.collection) || !Number.isSafeInteger(details.order) || details.order < 0 || details.order > 9999) throw new StoreError('Use a collection name of up to 80 characters and an order from 0 to 9999.');
}
export function editMediaDetails(item, input) {
  exactKeys(input, ['title', 'category', 'favorite', 'collection', 'order'], 'Library details change');
  const next = { ...item, title: input.title, category: input.category, details: { favorite: input.favorite, collection: input.collection, order: input.order } };
  if (validateMetadata(next) !== item.mimeType) throw new StoreError('Changing details cannot change the file format.');
  validateDetails(next.details);
  return next;
}
export function prepareMedia(input, bytes) {
  exactKeys(input, ['title', 'category', 'filename'], 'Library import');
  const mimeType = validateMetadata(input);
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new StoreError('Choose a nonempty local file.');
  if (bytes.length > MAX_MEDIA_BYTES || (mimeType === 'text/plain' && bytes.length > MAX_BOOK_BYTES)) throw new StoreError(mimeType === 'text/plain' ? 'Text books can be at most 2 MiB.' : 'A Library file can be at most 64 MiB.', 413);
  let textLength = null;
  if (mimeType === 'text/plain') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new StoreError('Books must be valid UTF-8 plain text.'); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new StoreError('Books must be plain text without binary control characters.');
    textLength = text.length;
  } else if (!sniff(bytes, mimeType)) throw new StoreError('The file contents do not match its supported format.');
  const digest = hash(bytes);
  return { id: `media-${digest}`, title: input.title, category: input.category, filename: input.filename, mimeType, size: bytes.length, digest, importedAt: new Date().toISOString(), textLength, progress: { position: 0, updatedAt: null } };
}
export function validateMediaProgress(item, input) {
  exactKeys(input, ['position'], 'Library progress');
  const position = input.position;
  const kind = mediaProgressKind(item);
  if (kind === 'none') throw new StoreError('Images do not have playback or reading progress.');
  const maximum = kind === 'page' ? MAX_DOCUMENT_PAGES - 1 : kind === 'text' ? item.mimeType === 'text/plain' ? item.textLength : MAX_EPUB_TEXT : 7 * 24 * 60 * 60;
  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || (kind !== 'time' && !Number.isSafeInteger(position)) || position > maximum) throw new StoreError('Invalid playback or reading position.');
}
export function validateMediaMap(media) {
  if (!isRecord(media) || Object.keys(media).length > MAX_MEDIA_ITEMS) throw new StoreError('Invalid Library catalog.');
  let total = 0;
  for (const [id, item] of Object.entries(media)) {
    exactKeys(item, ['id', 'title', 'category', 'filename', 'mimeType', 'size', 'digest', 'importedAt', 'textLength', 'progress', ...(Object.hasOwn(item, 'details') ? ['details'] : [])], 'Library item');
    if (Object.hasOwn(item, 'details')) validateDetails(item.details);
    validateMediaId(id);
    if (item.id !== id || typeof item.digest !== 'string' || !DIGEST.test(item.digest) || id !== `media-${item.digest}` || item.mimeType !== validateMetadata(item) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > MAX_MEDIA_BYTES || !isoDate(item.importedAt)) throw new StoreError('Invalid Library metadata.');
    if (item.mimeType === 'text/plain' ? item.size > MAX_BOOK_BYTES || !Number.isSafeInteger(item.textLength) || item.textLength < 0 || item.textLength > item.size : item.textLength !== null) throw new StoreError('Invalid book metadata.');
    exactKeys(item.progress, ['position', 'updatedAt'], 'Library progress');
    if (item.progress.updatedAt !== null && (!isoDate(item.progress.updatedAt) || item.progress.updatedAt < item.importedAt)) throw new StoreError('Invalid Library progress date.');
    if (mediaProgressKind(item) === 'none') {
      if (item.progress.position !== 0 || item.progress.updatedAt !== null) throw new StoreError('Invalid image progress.');
    } else validateMediaProgress(item, { position: item.progress.position });
    if (item.progress.updatedAt === null && item.progress.position !== 0) throw new StoreError('Invalid unsaved Library progress.');
    total += item.size;
  }
  if (total > MAX_MEDIA_TOTAL_BYTES) throw new StoreError('The Library catalog exceeds its 1 GiB capacity.');
}

async function mediaDirectory(root, create = false) {
  const directory = path.join(root, 'media');
  if (create) await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new StoreError('The Library data directory is unsafe. Preserve it and restore a known-good backup.', 503);
  } catch (error) {
    if (error.code === 'ENOENT') throw new StoreError('The Library file is missing. Restore the complete data directory from your backup.', 503);
    throw error;
  }
  return directory;
}
async function readBlob(directory, item) {
  let file;
  try {
    file = await open(path.join(directory, `${item.digest}.blob`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== item.size || stat.size > MAX_MEDIA_BYTES) throw new StoreError('The Library file is damaged or unsafe. Restore it from your backup.', 503);
    // A file growing after stat must not turn this bounded read into an
    // unbounded allocation. One extra byte detects growth before returning data.
    const buffer = Buffer.allocUnsafe(item.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const bytes = buffer.subarray(0, length);
    if (length !== item.size || hash(bytes) !== item.digest) throw new StoreError('The Library file failed its integrity check. Restore it from your backup.', 503);
    return bytes;
  } catch (error) {
    if (error.code === 'ENOENT') throw new StoreError('The Library file is missing. Restore the complete data directory from your backup.', 503);
    if (error.code === 'ELOOP') throw new StoreError('The Library file is an unsafe symbolic link.', 503);
    throw error;
  } finally { await file?.close(); }
}
export async function readMediaBlob(root, item) { return readBlob(await mediaDirectory(root), item); }
async function syncDirectory(directory) {
  const file = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EBADF'].includes(error.code)) throw error; }
  finally { await file.close(); }
}
export async function writeMediaBlob(root, item, bytes) {
  const directory = await mediaDirectory(root, true);
  let total = 0;
  let exists = false;
  const entries = await readdir(directory);
  if (entries.length > MAX_MEDIA_ITEMS + 1024) throw new StoreError('The Library directory needs inspection before more files can be imported.', 503);
  for (const name of entries) {
    const stat = await lstat(path.join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new StoreError('The Library directory contains an unsafe entry. Preserve it and inspect the data directory.', 503);
    total += stat.size; // Interrupted/unreferenced files still consume the physical quota.
    if (name === `${item.digest}.blob`) exists = true;
  }
  if (total + (exists ? 0 : bytes.length) > MAX_MEDIA_TOTAL_BYTES) throw new StoreError('The Library is full (1 GiB, including interrupted imports). Back up the entire data directory before inspecting it.', 409);
  if (exists) { await readBlob(directory, item); return; }
  const temporary = path.join(directory, `.${item.digest}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
    // Imports are serialized by Store's writer queue. Never use supplied filenames.
    const target = path.join(directory, `${item.digest}.blob`);
    try { await lstat(target); throw new StoreError('The Library file changed during import. Retry after inspecting its data directory.', 503); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(temporary, target);
    await syncDirectory(directory);
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
