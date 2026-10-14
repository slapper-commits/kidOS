import { constants } from 'node:fs';
import { link, lstat, mkdir, open, rename, rm, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = '/opt/kidos-native-session';
const MAX_ASSET_BYTES = 256 * 1024;
const paintIcons = ['check', 'check-light', 'close', 'down', 'down-disabled', 'left', 'minus', 'radio', 'restore', 'right', 'right-light', 'up', 'up-disabled'];
const WRITER_FILES = Object.freeze([
  'registrymodifications.xcu',
  'config/soffice.cfg/modules/swriter/toolbar/standardbar.xml',
  'config/soffice.cfg/modules/swriter/toolbar/textobjectbar.xml',
  ...['sc', 'lc', 'xc'].map(size => `config/soffice.cfg/modules/swriter/images/${size}_imagelist.xml`),
  ...['sc', 'lc', 'xc'].map(size => `config/soffice.cfg/modules/swriter/images/Bitmaps/${size}_userimages.png`),
]);
export const THEME_FILES = Object.freeze([
  'theme/paint.qss', 'theme/paint-kdeglobals', ...paintIcons.map(name => `theme/paint/${name}.svg`),
  'theme/kidos-paint.desktop', 'theme/paint-app.svg', 'theme/labwc.themerc',
  'theme/files.qss', 'theme/calculator.qss', 'theme/calculator-kcalcrc',
  ...WRITER_FILES.map(path => `theme/writer/${path}`),
]);

export function themePaths(home, targetKind = 'raspberry-pi', { writerPreview = false } = {}) {
  if (typeof home !== 'string' || !home.startsWith('/') || home === '/' || resolve(home) !== home || /[\0\r\n]/.test(home)) throw new Error('Use a normal absolute home directory.');
  if (!['raspberry-pi', 'disposable-linux-vm'].includes(targetKind) || typeof writerPreview !== 'boolean' || (writerPreview && targetKind !== 'disposable-linux-vm')) throw new Error('Invalid native theme target or Writer preview selection.');
  const base = `${home}/.local/share/${targetKind === 'raspberry-pi' ? 'kidos-native' : 'kidos-native-files'}`;
  const config = `${base}/config`, writer = `${config}/${writerPreview ? 'writer-theme-preview' : 'libreoffice'}/4`;
  return { base, config, palette: `${config}/kdeglobals`, calculator: `${config}/kcalcrc`, labwc: `${home}/.config/labwc/themerc-override`, writer, writerUser: `${writer}/user` };
}
async function info(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function safeDirectory(value, uid) {
  return value?.isDirectory() && !value.isSymbolicLink() && value.uid === uid && !(value.mode & 0o022);
}
function safeFile(value, uid) {
  return value?.isFile() && !value.isSymbolicLink() && value.nlink === 1 && value.uid === uid && !(value.mode & 0o022);
}
async function directory(path, uid, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  if (!safeDirectory(await info(path), uid)) throw new Error(`Refusing unsafe native theme directory: ${path}`);
}
async function existingFile(path, uid) {
  const value = await info(path);
  if (!value) return false;
  if (!safeFile(value, uid)) throw new Error(`Refusing unsafe native theme preference: ${path}`);
  return true;
}
async function writerState(paths, uid) {
  const user = await info(paths.writerUser);
  if (user) {
    if (!safeDirectory(user, uid)) throw new Error('Refusing unsafe Writer profile.');
    return 'existing-profile';
  }
  return await existingFile(`${paths.writer}/.lock`, uid) ? 'locked' : 'absent';
}
async function readInstalledAsset(path) {
  if (!THEME_FILES.includes(path)) throw new Error('Unknown native theme asset.');
  // Defer this import: registration.mjs includes THEME_FILES in its fixed receipt.
  const { protectedFile } = await import('./registration.mjs');
  return protectedFile(`${ROOT}/${path}`, { maxBytes: MAX_ASSET_BYTES });
}
async function asset(path, readAsset) {
  const value = await readAsset(path), bytes = Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value) : null;
  if (!bytes || bytes.length === 0 || bytes.length > MAX_ASSET_BYTES) throw new Error('Native theme asset must be nonempty and bounded.');
  return bytes;
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await file.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EBADF'].includes(error.code)) throw error; }
  finally { await file.close(); }
}
async function writeComplete(path, bytes, writeContents) {
  const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await writeContents(file, bytes); await file.sync(); }
  finally { await file.close(); }
}
async function seedPreference(path, bytes, uid, writeContents) {
  if (await existingFile(path, uid)) return false;
  const temporary = `${dirname(path)}/.${basename(path)}.theme-${randomUUID()}`;
  try {
    await writeComplete(temporary, bytes, writeContents);
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!await existingFile(path, uid)) throw new Error('The native theme preference changed during setup.');
      return false;
    }
    await unlink(temporary); await syncDirectory(dirname(path));
    return true;
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function seedWriter(paths, sources, uid, writeContents) {
  const initial = await writerState(paths, uid);
  if (initial !== 'absent') return initial;
  const staging = `${paths.writer}/.kidos-theme-${randomUUID()}`;
  await mkdir(staging, { mode: 0o700 });
  try {
    const directories = new Set([staging]);
    for (const [relative, bytes] of sources) {
      let parent = staging;
      for (const part of dirname(relative).split('/').filter(part => part !== '.')) {
        parent += `/${part}`;
        if (!directories.has(parent)) { await directory(parent, uid, true); directories.add(parent); }
      }
      await writeComplete(`${staging}/${relative}`, bytes, writeContents);
    }
    for (const path of [...directories].reverse()) await syncDirectory(path);
    const current = await writerState(paths, uid);
    if (current !== 'absent') return current;
    // Publish the complete seed in one operation. POSIX rename cannot replace
    // a populated profile; a profile created concurrently always keeps its data.
    try { await rename(staging, paths.writerUser); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      const state = await writerState(paths, uid);
      if (state === 'absent') throw error;
      return state;
    }
    await syncDirectory(paths.writer);
    return 'seeded';
  } finally { await rm(staging, { recursive: true, force: true }); }
}

// Filesystem-only setup. Its caller must verify the enrolled ordinary session
// first. Existing profiles are never merged, replaced or reset, even in preview.
export async function prepareNativeTheme(home, uid, { targetKind = 'raspberry-pi', writerPreview = false, readAsset = readInstalledAsset, writeContents = (file, bytes) => file.writeFile(bytes) } = {}) {
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error('Invalid native theme user.');
  const paths = themePaths(home, targetKind, { writerPreview });
  await directory(home, uid);
  for (const path of [`${home}/.local`, `${home}/.local/share`, paths.base, paths.config, dirname(paths.writer), paths.writer, `${home}/.config`, dirname(paths.labwc)]) await directory(path, uid, true);
  const preferences = [
    { path: paths.palette, source: 'theme/paint-kdeglobals' },
    { path: paths.calculator, source: 'theme/calculator-kcalcrc' },
    { path: paths.labwc, source: 'theme/labwc.themerc' },
  ];
  for (const preference of preferences) preference.exists = await existingFile(preference.path, uid);
  const state = await writerState(paths, uid);
  // Read every required source before publishing any new preference set.
  for (const preference of preferences) preference.bytes = preference.exists ? null : await asset(preference.source, readAsset);
  const writer = state === 'absent' ? await Promise.all(WRITER_FILES.map(async path => [path, await asset(`theme/writer/${path}`, readAsset)])) : [];
  const created = [], preserved = [];
  for (const { path, bytes } of preferences) (bytes && await seedPreference(path, bytes, uid, writeContents) ? created : preserved).push(path);
  const writerStatus = writer.length ? await seedWriter(paths, writer, uid, writeContents) : state;
  (writerStatus === 'seeded' ? created : preserved).push(paths.writerUser);
  return { created, preserved, writerSeeded: writerStatus === 'seeded', writerStatus, writerProfile: paths.writer };
}
