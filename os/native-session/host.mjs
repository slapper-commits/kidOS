import { lstat } from 'node:fs/promises';
import { userInfo, endianness } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, APP_IDS, EXTENSION_ORIGIN, validNativeRequest, success, failure } from './extension/protocol.mjs';
import { protectedFile, checkSession } from './registration.mjs';
import { VM_SESSION } from './target.mjs';
import { nativePaths, piCatalog, piCommandFor, piEnvironment, checkNativeFolders, PUZZLE_BINARIES, PUZZLE_SUPPORT_FILES } from './native-launch.mjs';

const BASE = '/home/kidos-test/.local/share/kidos-native-demos';
const FILES_BASE = '/home/kidos-test/.local/share/kidos-native-files';
const WRAPPERS = Object.freeze({ files: '/opt/kidos-linux-test/native-files-launch.sh', games: '/opt/kidos-linux-test/native-game-launch.sh' });
const catalog = Object.freeze({
  paint: { name: 'Paint', binary: '/usr/bin/kolourpaint', group: 'files', data: ['/usr/share/applications/org.kde.kolourpaint.desktop'], config: `${FILES_BASE}/config` },
  writer: { name: 'Write', binary: '/usr/lib/libreoffice/program/soffice', group: 'files', data: ['/usr/lib/libreoffice/program/soffice.bin', '/usr/lib/libreoffice/program/libvclplug_qt6lo.so'], config: `${FILES_BASE}/config/libreoffice/4` },
  calculator: { name: 'Calculator', binary: '/usr/bin/kcalc', group: 'files', data: [], config: `${FILES_BASE}/config` },
  files: { name: 'Files', binary: '/usr/bin/pcmanfm-qt', group: 'files', data: [], config: `${FILES_BASE}/config` },
  documents: { name: 'Documents', binary: '/usr/bin/pcmanfm-qt', group: 'files', data: [], config: '/home/kidos-test/Documents' },
  downloads: { name: 'Downloads', binary: '/usr/bin/pcmanfm-qt', group: 'files', data: [], config: '/home/kidos-test/Downloads' },
  trash: { name: 'Trash', binary: '/usr/bin/pcmanfm-qt', group: 'files', data: ['/usr/libexec/gvfsd-trash'], config: `${FILES_BASE}/config` },
  puttzoo: { name: 'Putt-Putt Saves the Zoo — demo', binary: '/usr/games/scummvm', group: 'games', data: Array.from({ length: 5 }, (_, i) => `/opt/kidos-linux-test/game-data/puttzoo/ZOODEMO.HE${i}`), config: `${BASE}/puttzoo-saves` },
  openttd: { name: 'OpenTTD', binary: '/usr/games/openttd', group: 'games', data: ['/usr/share/games/openttd/baseset/opengfx/opengfx.obg', '/usr/share/games/openttd/baseset/opensfx/opensfx.obs', '/usr/share/games/openttd/baseset/openmsx/openmsx.obm'], config: `${BASE}/config/openttd` },
  solitaire: { name: 'Solitaire', binary: '/usr/games/kpat', group: 'files', data: ['/usr/share/applications/org.kde.kpat.desktop'], config: `${FILES_BASE}/config` },
  minesweeper: { name: 'Minesweeper', binary: '/usr/games/kmines', group: 'files', data: ['/usr/share/applications/org.kde.kmines.desktop'], config: `${FILES_BASE}/config` },
  pinball: { name: 'Pinball', binary: '/usr/games/pinball', group: 'files', data: ['/usr/share/games/pinball/tux/pinball.pbl', '/usr/share/games/pinball/professor/pinball.pbl'], config: `${FILES_BASE}/config` },
  puzzlebox: { name: 'Puzzle Box', binary: '/usr/bin/python3.13', group: 'files', data: PUZZLE_SUPPORT_FILES, extraExecutables: PUZZLE_BINARIES, config: `${FILES_BASE}/config` },
});
export function commandFor(id, session = VM_SESSION) {
  if (session.targetKind === 'raspberry-pi') return piCommandFor(id, session.user);
  if (session.targetKind !== 'disposable-linux-vm') throw new Error('Invalid native target.');
  if (!Object.hasOwn(catalog, id)) throw new Error('Invalid native application.');
  return { executable: WRAPPERS[catalog[id].group], args: [id] };
}
export function activationMatches(id) {
  if (id === 'puttzoo') return ['app_id:scummvm', 'app_id:org.scummvm.scummvm'];
  if (id === 'openttd') return ['app_id:openttd', 'app_id:org.openttd.OpenTTD'];
  throw new Error('Only approved games have fixed activation matches.');
}
export async function listApps({ checkFile = protectedFile, inspect = lstat, uid = 1000, session = VM_SESSION } = {}) {
  const isPi = session.targetKind === 'raspberry-pi';
  if (!isPi && session.targetKind !== 'disposable-linux-vm') throw new Error('Invalid native target.');
  const selected = isPi ? piCatalog(session.user) : catalog;
  return Promise.all(APP_IDS.map(async id => {
    const app = selected[id];
    // The protocol has a stable catalog across targets; the proprietary demo
    // is never a Pi command or provisioning dependency.
    if (!app) return { id, name: catalog[id].name, available: false, reason: 'not-installed' };
    try {
      for (const path of new Set([app.binary, commandFor(id, session).executable])) await checkFile(path, { executable: true, read: false });
      for (const path of app.extraExecutables || []) await checkFile(path, { executable: true, read: false });
      if (!isPi && app.group === 'files') {
        await checkFile('/opt/kidos-linux-test/native-files.mjs', { read: false });
        await checkFile('/opt/kidos-linux-test/target.mjs', { read: false });
      }
      for (const path of app.data) await checkFile(path, { read: false });
    } catch { return { id, name: app.name, available: false, reason: 'not-installed' }; }
    try {
      if (isPi) await checkNativeFolders(session.user, id, inspect);
      else {
        const info = await inspect(app.config);
        if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || info.mode & 0o022) throw new Error('not configured');
      }
    } catch { return { id, name: app.name, available: false, reason: 'not-configured' }; }
    return { id, name: app.name, available: true };
  }));
}
export function encodeFrame(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Native response is too large.');
  const header = Buffer.alloc(4);
  if (endianness() === 'LE') header.writeUInt32LE(bytes.length); else header.writeUInt32BE(bytes.length);
  return Buffer.concat([header, bytes]);
}
export function readFrame(input, timeoutMs = 1500) {
  return new Promise((resolveFrame, reject) => {
    let header = Buffer.alloc(4), headerAt = 0, body = null, bodyAt = 0, done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      input.off('data', data); input.off('end', end); input.off('error', fail); input.pause();
      error ? reject(error) : resolveFrame(value);
    };
    const fail = error => finish(error);
    const end = () => finish(new Error('Truncated native request.'));
    const timer = setTimeout(() => finish(new Error('Native request timed out.')), timeoutMs);
    const data = chunk => {
      let at = 0;
      if (headerAt < 4) {
        const count = Math.min(4 - headerAt, chunk.length);
        chunk.copy(header, headerAt, 0, count); headerAt += count; at += count;
        if (headerAt < 4) return;
        const size = endianness() === 'LE' ? header.readUInt32LE() : header.readUInt32BE();
        if (size < 2 || size > MAX_BYTES) return finish(new Error('Invalid native request length.'));
        body = Buffer.alloc(size);
      }
      if (chunk.length - at > body.length - bodyAt) return finish(new Error('Only one native request is allowed.'));
      chunk.copy(body, bodyAt, at); bodyAt += chunk.length - at;
      if (bodyAt === body.length) {
        try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))); }
        catch { finish(new Error('Malformed native JSON.')); }
      }
    };
    input.on('data', data); input.once('end', end); input.once('error', fail);
  });
}
export async function launch(id, { spawnProcess = spawn, checkLock = execFileSync, checkFile = protectedFile, inspect = lstat, env = process.env, session = VM_SESSION } = {}) {
  const command = commandFor(id, session), isPi = session.targetKind === 'raspberry-pi';
  const cleanEnv = isPi ? piEnvironment(session.user, env, id) : { HOME: '/home/kidos-test', USER: 'kidos-test', LOGNAME: 'kidos-test', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_RUNTIME_DIR: '/run/user/1000', WAYLAND_DISPLAY: env.WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS };
  if (isPi) {
    const app = piCatalog(session.user)[id];
    for (const path of new Set([app.binary, command.executable])) await checkFile(path, { executable: true, read: false });
    for (const path of app.extraExecutables || []) await checkFile(path, { executable: true, read: false });
    for (const path of app.data) await checkFile(path, { read: false });
    await checkNativeFolders(session.user, id, inspect);
  }
  if (id === 'openttd' || id === 'puttzoo') {
    const lock = isPi ? nativePaths(session.user).gameLock : `${BASE}/${id}.lock`;
    try { checkLock('/usr/bin/flock', ['-n', lock, '/usr/bin/true'], { timeout: 500, stdio: 'ignore', env: cleanEnv }); }
    catch (error) {
      if (error.status !== 1) throw error;
      try {
        await checkFile('/usr/bin/wlrctl', { executable: true, read: false });
        const options = { timeout: 500, stdio: 'ignore', env: cleanEnv };
        // Try each fixed alternative separately; no dependence on a compositor
        // tool's repeated-filter semantics and never an unfiltered focus.
        for (const match of activationMatches(id)) {
          try {
            checkLock('/usr/bin/wlrctl', ['toplevel', 'find', match], options);
            checkLock('/usr/bin/wlrctl', ['toplevel', 'focus', match], options);
            return 'focused';
          } catch {}
        }
        return 'already-running';
      } catch { return 'already-running'; }
    }
  }
  return new Promise((resolveLaunch, reject) => {
    const child = spawnProcess(command.executable, command.args, { cwd: command.cwd || '/home/kidos-test', env: cleanEnv, shell: false, detached: true, stdio: 'ignore' });
    let done = false;
    const finish = (error, status) => {
      if (done) return;
      done = true; clearTimeout(timer);
      child.unref(); error ? reject(error) : resolveLaunch(status);
    };
    const timer = setTimeout(() => finish(null, 'started'), 450);
    child.once('error', () => finish(new Error('Native launch failed.')));
    child.once('exit', code => finish(code === 0 ? null : new Error('Native launch failed.'), 'started'));
  });
}
export async function handleRequest(envelope, { apps = listApps, start = launch } = {}) {
  if (!validNativeRequest(envelope)) return failure(null, 'invalid_request');
  const request = envelope.request;
  const available = await apps();
  if (request.method === 'listApps') return success(request.requestId, { apps: available });
  if (!available.find(app => app.id === request.appId)?.available) return failure(request.requestId, 'not_installed');
  try { return success(request.requestId, { appId: request.appId, status: await start(request.appId) }); }
  catch { return failure(request.requestId, 'launch_failed'); }
}
export async function main(args) {
  if (args.length !== 1 || args[0] !== EXTENSION_ORIGIN) throw new Error('Unexpected native messaging caller.');
  const session = await checkSession(userInfo());
  process.umask(0o077);
  const envelope = await readFrame(process.stdin);
  const response = await handleRequest(envelope, { apps: () => listApps({ session }), start: id => launch(id, { session }) });
  await new Promise((resolveWrite, reject) => process.stdout.write(encodeFrame(response), error => error ? reject(error) : resolveWrite()));
  process.stdin.destroy();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deadline = setTimeout(() => process.exit(1), 4500);
  main(process.argv.slice(2)).catch(() => { process.exitCode = 1; }).finally(() => clearTimeout(deadline));
}
