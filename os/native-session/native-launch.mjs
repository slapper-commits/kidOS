import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { validateDesktopUser } from './target.mjs';
import puzzleCatalog from './puzzlebox-catalog.json' with { type: 'json' };

export const PI_APP_IDS = Object.freeze(['paint', 'writer', 'calculator', 'files', 'documents', 'downloads', 'trash', 'openttd', 'solitaire', 'minesweeper', 'pinball', 'puzzlebox']);
export function validatePuzzleCatalog(value) {
  const exact = (item, names) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).sort().join(',') === [...names].sort().join(',');
  if (!exact(value, ['format', 'starters', 'puzzles']) || value.format !== 1 || !Array.isArray(value.puzzles) || value.puzzles.length !== 40) throw new Error('Invalid installed puzzle catalog.');
  const identities = new Set();
  for (const entry of value.puzzles) {
    if (!exact(entry, ['id', 'name', 'description', 'binary']) || typeof entry.id !== 'string' || !/^[a-z]{2,12}$/.test(entry.id) || identities.has(entry.id) || entry.binary !== `/usr/games/sgt-${entry.id}` || typeof entry.name !== 'string' || entry.name.length < 1 || entry.name.length > 40 || typeof entry.description !== 'string' || entry.description.length < 1 || entry.description.length > 100) throw new Error('Invalid installed puzzle catalog.');
    identities.add(entry.id);
  }
  if (!Array.isArray(value.starters) || value.starters.length !== 6 || new Set(value.starters).size !== 6 || !value.starters.every(id => typeof id === 'string' && identities.has(id))) throw new Error('Invalid installed puzzle catalog.');
  return value.puzzles.map(puzzle => puzzle.binary);
}
export const PUZZLE_BINARIES = Object.freeze(validatePuzzleCatalog(puzzleCatalog));
export const PUZZLE_SUPPORT_FILES = Object.freeze(['/usr/lib/python3/dist-packages/gi/__init__.py', '/usr/lib/aarch64-linux-gnu/girepository-1.0/Gtk-3.0.typelib']);
export function puzzleSupportFiles(arch = process.arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('Unsupported native puzzle architecture.');
  return [PUZZLE_SUPPORT_FILES[0], `/usr/lib/${arch === 'x64' ? 'x86_64' : 'aarch64'}-linux-gnu/girepository-1.0/Gtk-3.0.typelib`];
}
export function nativePaths(user) {
  validateDesktopUser(user);
  const base = `${user.homedir}/.local/share/kidos-native`;
  return { base, config: `${base}/config`, cache: `${base}/cache`, data: `${base}/data`, writer: `${base}/config/libreoffice/4`, gameLock: `${base}/openttd.lock` };
}
export function piCatalog(user) {
  const p = nativePaths(user), folder = `${user.homedir}/Documents`;
  return {
    paint: { name: 'Paint', binary: '/usr/bin/kolourpaint', data: ['/usr/share/applications/org.kde.kolourpaint.desktop'], config: p.config, cwd: `${user.homedir}/Pictures` },
    writer: { name: 'Write', binary: '/usr/lib/libreoffice/program/soffice', data: ['/usr/lib/libreoffice/program/soffice.bin', '/usr/lib/libreoffice/program/libvclplug_qt6lo.so', '/usr/share/applications/libreoffice-writer.desktop'], config: p.writer, cwd: folder },
    calculator: { name: 'Calculator', binary: '/usr/bin/kcalc', data: [], config: p.config, cwd: folder },
    files: { name: 'Files', binary: '/usr/bin/pcmanfm-qt', data: [], config: p.config, cwd: `${user.homedir}/Pictures` },
    documents: { name: 'Documents', binary: '/usr/bin/pcmanfm-qt', data: [], config: p.config, cwd: folder },
    downloads: { name: 'Downloads', binary: '/usr/bin/pcmanfm-qt', data: [], config: p.config, cwd: `${user.homedir}/Downloads` },
    trash: { name: 'Trash', binary: '/usr/bin/pcmanfm-qt', data: ['/usr/libexec/gvfsd-trash'], config: p.config, cwd: folder },
    openttd: { name: 'OpenTTD', binary: '/usr/games/openttd', data: ['/usr/share/games/openttd/baseset/opengfx/opengfx.obg', '/usr/share/games/openttd/baseset/opensfx/opensfx.obs', '/usr/share/games/openttd/baseset/openmsx/openmsx.obm'], config: `${p.config}/openttd`, cwd: p.base },
    solitaire: { name: 'Solitaire', binary: '/usr/games/kpat', data: ['/usr/share/applications/org.kde.kpat.desktop'], config: p.config, cwd: p.base },
    minesweeper: { name: 'Minesweeper', binary: '/usr/games/kmines', data: ['/usr/share/applications/org.kde.kmines.desktop'], config: p.config, cwd: p.base },
    pinball: { name: 'Pinball', binary: '/usr/games/pinball', data: ['/usr/share/games/pinball/tux/pinball.pbl', '/usr/share/games/pinball/professor/pinball.pbl'], config: p.config, cwd: p.base },
    puzzlebox: { name: 'Puzzle Box', binary: '/usr/bin/python3.13', data: puzzleSupportFiles(), extraExecutables: PUZZLE_BINARIES, config: p.config, cwd: folder },
  };
}
export function piCommandFor(id, user) {
  const apps = piCatalog(user), app = apps[id], p = nativePaths(user);
  if (!Object.hasOwn(apps, id)) throw new Error('Invalid native application.');
  let args = id === 'paint' ? ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/paint.qss'] : [];
  if (id === 'calculator') args = ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/calculator.qss', '-qwindowtitle', 'Calculator'];
  if (id === 'puzzlebox') args = ['-I', '/opt/kidos-native-session/puzzlebox.py'];
  if (id === 'solitaire' || id === 'minesweeper') args = ['-style', 'Fusion', '-qwindowtitle', app.name];
  if (id === 'writer') args = [`-env:UserInstallation=file://${p.writer}`, '--writer'];
  if (['files', 'documents', 'downloads', 'trash'].includes(id)) args = ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/files.qss', '--profile=kidos-files', id === 'trash' ? 'trash:///' : app.cwd];
  if (id === 'openttd') return { executable: '/usr/bin/flock', args: ['-n', p.gameLock, app.binary, '-v', 'sdl', '-r', '960x640', '-I', 'OpenGFX', '-S', 'OpenSFX', '-M', 'OpenMSX', '-c', `${p.config}/openttd/openttd.cfg`], cwd: app.cwd };
  return { executable: app.binary, args, cwd: app.cwd };
}
export function piEnvironment(user, inherited, id) {
  if (!PI_APP_IDS.includes(id)) throw new Error('Invalid native application.');
  const p = nativePaths(user);
  return { HOME: user.homedir, USER: user.username, LOGNAME: user.username, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_RUNTIME_DIR: `/run/user/${user.uid}`, WAYLAND_DISPLAY: inherited.WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS: inherited.DBUS_SESSION_BUS_ADDRESS, QT_QPA_PLATFORM: 'wayland', SAL_USE_VCLPLUGIN: 'qt6', SDL_VIDEODRIVER: 'wayland', GDK_BACKEND: 'wayland', XDG_CONFIG_HOME: p.config, XDG_CACHE_HOME: p.cache, XDG_DATA_HOME: id === 'openttd' ? p.data : `${user.homedir}/.local/share` };
}
export async function ownedDirectory(path, uid, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || info.mode & 0o022) throw new Error(`Refusing unsafe native user directory: ${path}`);
}
const directories = Object.freeze(['Documents', 'Pictures', 'Downloads', '.local', '.local/share', '.local/share/kidos-native', '.local/share/kidos-native/config', '.local/share/kidos-native/cache', '.local/share/kidos-native/data', '.local/share/kidos-native/config/pcmanfm-qt', '.local/share/kidos-native/config/pcmanfm-qt/kidos-files', '.local/share/kidos-native/config/libreoffice', '.local/share/kidos-native/config/libreoffice/4', '.local/share/kidos-native/config/openttd', '.local/share/kidos-native/data/openttd', '.local/share/kidos-native/data/openttd/save']);
const preferences = Object.freeze({
  'config/pcmanfm-qt/kidos-files/settings.conf': '[System]\nFallbackIconThemeName=breeze\nSuCommand=\nTerminal=\n[Behavior]\nUseTrash=true\nConfirmTrash=true\nConfirmDelete=true\nQuickExec=false\nSingleClick=false\n[Volume]\nMountOnStartup=false\nMountRemovable=false\nAutoRun=false\n',
  'config/mimeapps.list': '[Default Applications]\nimage/png=kidos-paint.desktop;\napplication/vnd.oasis.opendocument.text=libreoffice-writer.desktop;\n',
  'config/user-dirs.dirs': 'XDG_DOCUMENTS_DIR="$HOME/Documents"\nXDG_DOWNLOAD_DIR="$HOME/Downloads"\nXDG_PICTURES_DIR="$HOME/Pictures"\n',
});
async function existingPreference(path, uid) {
  let info;
  try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== uid || info.mode & 0o022) throw new Error('Refusing an unsafe native preference.');
  return true;
}
async function initialPreference(path, text, uid, writeContents) {
  if (await existingPreference(path, uid)) return false;
  const temporary = `${dirname(path)}/.${basename(path)}.new-${randomUUID()}`;
  let file;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await writeContents(file, text); await file.sync(); await file.close(); file = null;
    try { await link(temporary, path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (!await existingPreference(path, uid)) throw new Error('Native preference changed during setup.'); return false; }
    await unlink(temporary);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await directory.sync(); } catch (error) { if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EBADF'].includes(error.code)) throw error; }
    finally { await directory.close(); }
    return true;
  } finally { await file?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
// This filesystem-only helper is also exercised on isolated local fixtures.
// Its CLI first requires the registered ordinary Pi identity; it never chowns
// or replaces existing preferences, native saves or user creations.
export async function prepareNativeFiles(home, uid, { writeContents = (file, text) => file.writeFile(text) } = {}) {
  await ownedDirectory(home, uid);
  for (const relative of directories) await ownedDirectory(`${home}/${relative}`, uid, true);
  const created = [], preserved = [];
  for (const [relative, text] of Object.entries(preferences)) {
    (await initialPreference(`${home}/.local/share/kidos-native/${relative}`, text, uid, writeContents) ? created : preserved).push(relative);
  }
  return { created, preserved };
}
export async function checkNativeFolders(user, id, inspect = lstat) {
  const app = piCatalog(user)[id];
  if (!app) throw new Error('Invalid native application.');
  const p = nativePaths(user);
  const paths = [user.homedir, `${user.homedir}/.local`, `${user.homedir}/.local/share`, p.base, p.config, p.cache, app.config, app.cwd];
  if (id === 'writer' || ['files', 'documents', 'downloads', 'trash'].includes(id)) paths.push(`${p.config}/libreoffice`, p.writer);
  if (id === 'openttd') paths.push(p.data, `${p.data}/openttd`, `${p.data}/openttd/save`);
  for (const path of new Set(paths)) {
    const info = await inspect(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== user.uid || info.mode & 0o022) throw new Error('Native folders are not configured for this user.');
  }
}
async function main(args) {
  if (args.length !== 1 || args[0] !== '--setup-user') throw new Error('Use --setup-user as the enrolled ordinary Pi or PC desktop user.');
  const { checkEnrolledDesktopUser } = await import('./registration.mjs');
  const user = userInfo();
  const session = await checkEnrolledDesktopUser(user);
  process.umask(0o077);
  const folders = await prepareNativeFiles(user.homedir, user.uid);
  const { prepareNativeTheme } = await import('./theme.mjs');
  const theme = await prepareNativeTheme(user.homedir, user.uid, { targetKind: session.targetKind });
  console.log(JSON.stringify({ ...folders, theme }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
