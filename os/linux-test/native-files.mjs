import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { vmTarget } from './target.mjs';

const USER_HOME = '/home/kidos-test';
const BASE = `${USER_HOME}/.local/share/kidos-native-files`;
const ACTIONS = new Set(['paint', 'writer', 'calculator', 'files', 'documents', 'downloads', 'trash', 'solitaire', 'minesweeper', 'pinball', 'puzzlebox']);
// Match LibreOffice's Linux default beneath our private XDG_CONFIG_HOME so
// the distro MIME handler used by Files opens the same preferences/recovery.
const WRITER_PROFILE = `${BASE}/config/libreoffice/4`;
const preferences = {
  'config/pcmanfm-qt/kidos-files/settings.conf': `[System]
FallbackIconThemeName=breeze
SuCommand=
Terminal=
[Behavior]
UseTrash=true
ConfirmTrash=true
ConfirmDelete=true
QuickExec=false
SingleClick=false
[Volume]
MountOnStartup=false
MountRemovable=false
AutoRun=false
[Window]
LastWindowWidth=900
LastWindowHeight=600
ShowMenuBar=true
SidePaneMode=places
`,
  'config/mimeapps.list': `[Default Applications]
image/png=kidos-paint.desktop;
`,
  'config/user-dirs.dirs': `XDG_DOCUMENTS_DIR="$HOME/Documents"
XDG_DOWNLOAD_DIR="$HOME/Downloads"
XDG_PICTURES_DIR="$HOME/Pictures"
`,
};

async function ownedDirectory(path, uid, create = false) {
  if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || info.mode & 0o022) throw new Error(`Refusing unsafe user directory: ${path}`);
}

async function existingPreference(path, uid) {
  let info;
  try { info = await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== uid || info.mode & 0o022) throw new Error(`Refusing unsafe preference file: ${path}`);
  return true;
}

async function createPreference(path, text, uid, writeContents) {
  if (await existingPreference(path, uid)) return false;
  const temporary = `${dirname(path)}/.${basename(path)}.kidos-new-${randomUUID()}`;
  let file;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await writeContents(file, text);
    await file.sync(); await file.close(); file = null;
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!await existingPreference(path, uid)) throw new Error(`The preference changed during setup: ${path}`);
      return false;
    }
    // link() publishes complete bytes without replacing a concurrently created
    // preference. A crash before publication leaves only an ignored temp file.
    await unlink(temporary);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await directory.sync(); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EBADF'].includes(error.code)) throw error; }
    finally { await directory.close(); }
    return true;
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

// Existing preferences may have been changed by their applications. Preserve
// them on rerun; this setup never replaces or repairs user-created files.
// writeContents is a fault-injection seam; the CLI always uses FileHandle.writeFile.
export async function prepareUserFiles(userHome, uid, { writeContents = (file, text) => file.writeFile(text) } = {}) {
  await ownedDirectory(userHome, uid);
  for (const suffix of ['Documents', 'Pictures', 'Downloads', '.local', '.local/share', '.local/share/kidos-native-files', '.local/share/kidos-native-files/config', '.local/share/kidos-native-files/config/pcmanfm-qt', '.local/share/kidos-native-files/config/pcmanfm-qt/kidos-files', '.local/share/kidos-native-files/cache', '.local/share/kidos-native-files/config/libreoffice', '.local/share/kidos-native-files/config/libreoffice/4']) {
    await ownedDirectory(`${userHome}/${suffix}`, uid, true);
  }
  const base = `${userHome}/.local/share/kidos-native-files`;
  const created = [], preserved = [];
  for (const [suffix, text] of Object.entries(preferences)) {
    const path = `${base}/${suffix}`;
    (await createPreference(path, text, uid, writeContents) ? created : preserved).push(suffix);
  }
  return { created, preserved };
}

export async function openApplicationLog(path, uid) {
  // O_NONBLOCK prevents an existing FIFO from waiting for a reader before stat.
  const file = await open(path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== uid || info.mode & 0o022) throw new Error('Refusing an unsafe native application log.');
    return file;
  } catch (error) { await file.close(); throw error; }
}

export function launchCommand(action) {
  if (!ACTIONS.has(action)) throw new Error('Choose a fixed native application or folder.');
  if (action === 'paint') return { executable: '/usr/bin/kolourpaint', args: ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/paint.qss'], cwd: `${USER_HOME}/Pictures` };
  if (action === 'writer') return {
    // Use the packaged real launcher, not the /usr/bin/libreoffice symlink.
    executable: '/usr/lib/libreoffice/program/soffice',
    args: [`-env:UserInstallation=file://${WRITER_PROFILE}`, '--writer'],
    cwd: `${USER_HOME}/Documents`,
  };
  if (action === 'calculator') return { executable: '/usr/bin/kcalc', args: ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/calculator.qss', '-qwindowtitle', 'Calculator'], cwd: `${USER_HOME}/Documents` };
  if (action === 'solitaire') return { executable: '/usr/games/kpat', args: ['-style', 'Fusion', '-qwindowtitle', 'Solitaire'], cwd: BASE };
  if (action === 'minesweeper') return { executable: '/usr/games/kmines', args: ['-style', 'Fusion', '-qwindowtitle', 'Minesweeper'], cwd: BASE };
  if (action === 'pinball') return { executable: '/usr/games/pinball', args: [], cwd: BASE };
  if (action === 'puzzlebox') return { executable: '/usr/bin/python3.13', args: ['-I', '/opt/kidos-native-session/puzzlebox.py'], cwd: `${USER_HOME}/Documents` };
  const folder = action === 'documents' ? 'Documents' : action === 'downloads' ? 'Downloads' : 'Pictures';
  return { executable: '/usr/bin/pcmanfm-qt', args: ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/files.qss', '--profile=kidos-files', action === 'trash' ? 'trash:///' : `${USER_HOME}/${folder}`], cwd: `${USER_HOME}/${folder}` };
}

export function launchEnvironment(action, inherited) {
  if (!ACTIONS.has(action)) throw new Error('Choose a fixed native application or folder.');
  const env = { ...inherited, PATH: '/usr/bin:/bin', QT_QPA_PLATFORM: 'wayland', SAL_USE_VCLPLUGIN: 'qt6', XDG_CONFIG_HOME: `${BASE}/config`, XDG_CACHE_HOME: `${BASE}/cache`, XDG_DATA_HOME: `${USER_HOME}/.local/share` };
  if (action === 'pinball') env.SDL_VIDEODRIVER = 'wayland';
  if (action === 'puzzlebox') env.GDK_BACKEND = 'wayland';
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'PYTHONPATH', 'PYTHONHOME', 'GTK_MODULES', 'GTK_PATH', 'GIO_EXTRA_MODULES']) delete env[key];
  return env;
}

async function requireFixtureUser(vmId) {
  const user = userInfo();
  if (process.platform !== 'linux' || process.arch !== 'arm64' || user.username !== 'kidos-test' || user.uid !== 1000 || user.homedir !== USER_HOME || process.env.HOME !== USER_HOME) throw new Error('Use the ordinary kidos-test account in the disposable Linux ARM64 VM.');
  await vmTarget(vmId);
  return user;
}

async function main(args) {
  if (args.length === 3 && args[0] === '--setup' && args[1] === '--disposable-vm-id') {
    const user = await requireFixtureUser(args[2]);
    console.log(JSON.stringify(await prepareUserFiles(user.homedir, user.uid)));
    return;
  }
  if (args.length !== 2 || args[0] !== '--launch') throw new Error('Use --setup --disposable-vm-id UUID or --launch followed by a fixed application ID.');
  const command = launchCommand(args[1]);
  // Fail on the host before touching the guest receipt.
  if (process.platform !== 'linux' || process.arch !== 'arm64') throw new Error('Native Files requires the disposable Linux ARM64 VM.');
  const receipt = JSON.parse(await readFile('/opt/kidos/install-receipt.json', 'utf8'));
  const user = await requireFixtureUser(receipt.runtime?.vmId);
  if (args[1] === 'puzzlebox') {
    // The argument-free Python chooser and its catalog are covered by the
    // protected shared receipt, including launches from the native VM menu.
    const { checkSession } = await import('/opt/kidos-native-session/registration.mjs');
    await checkSession(user);
  }
  if (process.env.XDG_RUNTIME_DIR !== '/run/user/1000' || !process.env.WAYLAND_DISPLAY || !process.env.DBUS_SESSION_BUS_ADDRESS) throw new Error('Launch from the actual logged-in labwc session with Wayland and D-Bus.');
  await ownedDirectory('/run/user/1000', user.uid);
  for (const path of [USER_HOME, `${USER_HOME}/.local`, `${USER_HOME}/.local/share`, BASE, `${BASE}/config`, `${BASE}/cache`, command.cwd]) await ownedDirectory(path, user.uid);
  // File-manager MIME launches inherit this same profile, so validate it for
  // every entry point instead of checking only a direct Writer launch.
  for (const path of [dirname(WRITER_PROFILE), WRITER_PROFILE]) await ownedDirectory(path, user.uid);
  const executable = await lstat(command.executable);
  if (!executable.isFile() || executable.isSymbolicLink() || executable.uid !== 0 || executable.mode & 0o022) throw new Error('The approved application executable must be root-owned and protected.');
  const env = launchEnvironment(args[1], process.env);
  process.umask(0o077);
  const log = await openApplicationLog(`${BASE}/${args[1]}.log`, user.uid);
  try {
    const child = spawn(command.executable, command.args, { cwd: command.cwd, env, stdio: ['ignore', log.fd, log.fd] });
    child.on('error', error => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  } finally { await log.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
