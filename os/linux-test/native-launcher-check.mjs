import { lstat, mkdir, realpath } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HOME = '/home/kidos-test';
const ROOT = '/opt/kidos-native-session';
export const QA_PROFILE = `${HOME}/.local/share/kidos-browser-native-qa`;

export function validateCaller(args, { platform, arch, uid, user, home }) {
  if (args.length) throw new Error('The native launcher check takes no arguments.');
  if (platform !== 'linux' || arch !== 'arm64' || uid !== 1000 || user.username !== 'kidos-test' || user.uid !== 1000 || user.gid !== 1000 || user.homedir !== HOME || home !== HOME) throw new Error('Native launcher checks require the ordinary Linux ARM64 disposable VM session.');
}
export async function checkImportFiles(inspect = lstat) {
  // Check the full import closure before executing separately installed code.
  for (const [path, directory] of [
    ['/opt', true], [ROOT, true], [`${ROOT}/extension`, true],
    [`${ROOT}/registration.mjs`, false], [`${ROOT}/target.mjs`, false], [`${ROOT}/theme.mjs`, false], [`${ROOT}/extension/protocol.mjs`, false],
  ]) {
    const info = await inspect(path);
    if (info.isSymbolicLink() || info.uid !== 0 || info.mode & 0o022 || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size > 256 * 1024)) throw new Error('Unsafe native launcher registration code.');
  }
}
export function chromiumArguments() {
  return [`--user-data-dir=${QA_PROFILE}`, `--load-extension=${ROOT}/extension`, '--no-first-run', '--no-default-browser-check', '--start-maximized', '--app=http://127.0.0.1:8787/'];
}
export function chromiumEnvironment(inherited) {
  // Called only after checkSession verifies the ordinary user's Wayland socket.
  return { HOME, USER: 'kidos-test', LOGNAME: 'kidos-test', PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_RUNTIME_DIR: '/run/user/1000', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: inherited.WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS: inherited.DBUS_SESSION_BUS_ADDRESS };
}
export async function prepareProfile(home, uid) {
  for (const [path, create, privateMode] of [[home, false, false], [`${home}/.local`, true, false], [`${home}/.local/share`, true, false], [`${home}/.local/share/kidos-browser-native-qa`, true, true]]) {
    if (create) await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || info.mode & 0o022 || (privateMode && (info.mode & 0o777) !== 0o700)) throw new Error('Refusing an unsafe native launcher check profile.');
  }
}
export async function main(args) {
  const user = userInfo();
  validateCaller(args, { platform: process.platform, arch: process.arch, uid: process.getuid?.(), user, home: process.env.HOME });
  await checkImportFiles();
  const { checkSession, protectedFile } = await import(`${ROOT}/registration.mjs`);
  const session = await checkSession(user);
  if (session.targetKind !== 'disposable-linux-vm') throw new Error('Native launcher checks require the disposable VM.');
  await protectedFile('/usr/bin/chromium', { executable: true, read: false });
  const parent = await lstat('/home');
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || parent.mode & 0o022) throw new Error('Unsafe VM home directory.');
  const response = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('The kidOS service is not ready.');
  process.umask(0o077);
  await prepareProfile(HOME, user.uid);
  const env = chromiumEnvironment(process.env);
  // Chromium keeps its sandbox and uses a separate profile. No existing browser
  // or native application is signalled, closed, or given new startup flags.
  const child = spawn('/usr/bin/chromium', chromiumArguments(), { shell: false, env, stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`Native launcher check stopped: ${error.message}`); process.exitCode = 1; });
}
