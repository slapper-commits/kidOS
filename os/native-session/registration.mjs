import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { EXTENSION_ID, EXTENSION_ORIGIN, HOST_NAME, keys } from './extension/protocol.mjs';
import { THEME_FILES } from './theme.mjs';
import { existingDesktopUser, piTarget, userMatches, validateDesktopUser, VM_USER } from './target.mjs';

export const ROOT = '/opt/kidos-native-session';
export const RECEIPT = `${ROOT}/install.json`;
export const HOST_MANIFEST = `/etc/chromium/native-messaging-hosts/${HOST_NAME}.json`;
export const LEGACY_FILES = Object.freeze(['extension/manifest.json', 'extension/protocol.mjs', 'extension/worker.mjs', 'extension/content.js', 'host.mjs', 'host-entry.sh', 'registration.mjs', 'reopen.mjs', 'reopen.sh']);
export const PRE_THEME_FILES = Object.freeze([...LEGACY_FILES, 'target.mjs', 'native-launch.mjs']);
export const PRE_PUZZLE_FILES = Object.freeze([...PRE_THEME_FILES, 'theme.mjs', ...THEME_FILES]);
export const PRE_SYSTEM_THEME_FILES = Object.freeze(PRE_PUZZLE_FILES.filter(file => !['theme/files.qss', 'theme/calculator.qss', 'theme/calculator-kcalcrc'].includes(file)));
export const FILES = Object.freeze([...PRE_PUZZLE_FILES, 'puzzlebox.py', 'puzzlebox-catalog.json']);
export const PAINT_DESKTOP_ENTRY = '/usr/share/applications/kidos-paint.desktop';
export const DESKTOP_ENTRY = '/usr/share/applications/kidos.desktop';
export const desktopEntry = () => '[Desktop Entry]\nType=Application\nName=kidOS\nComment=Open the local kidOS desktop\nExec=/opt/kidos-native-session/reopen.sh\nIcon=applications-education\nTerminal=false\nCategories=Education;\n';
export function protectedStat(stat, executable = false, owner = 0) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === owner && !(stat.mode & 0o022) && (!executable || Boolean(stat.mode & 0o111));
}
export async function protectedFile(path, { executable = false, maxBytes = 256 * 1024, owner = 0, read = true } = {}) {
  for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== owner || info.mode & 0o022) throw new Error('Unsafe native application directory.');
  }
  const info = await lstat(path);
  if (!protectedStat(info, executable, owner) || (read && info.size > maxBytes)) throw new Error('Unsafe native application file.');
  if (!read) return info;
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat();
    if (!protectedStat(opened, executable, owner) || opened.size > maxBytes || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('Native application file changed.');
    const bytes = await file.readFile();
    if (bytes.length > maxBytes) throw new Error('Native application file exceeded its bound.');
    return bytes;
  } finally { await file.close(); }
}
export function validateRegistration(value, identity) {
  const fileNames = value?.format === 1 && keys(value.hashes, LEGACY_FILES) ? LEGACY_FILES : keys(value?.hashes, PRE_THEME_FILES) ? PRE_THEME_FILES : keys(value?.hashes, PRE_SYSTEM_THEME_FILES) ? PRE_SYSTEM_THEME_FILES : keys(value?.hashes, PRE_PUZZLE_FILES) ? PRE_PUZZLE_FILES : FILES;
  const hashesValid = keys(value?.hashes, fileNames) && fileNames.every(file => /^[a-f0-9]{64}$/.test(value.hashes[file]));
  let valid = false;
  if (typeof identity === 'string') valid = keys(value, ['format', 'vmId', 'extensionId', 'hashes']) && value.format === 1 && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(identity) && value.vmId === identity;
  else {
    try { validateDesktopUser(value?.user); valid = keys(value, ['format', 'targetKind', 'user', 'extensionId', 'hashes']) && value.format === 2 && value.targetKind === 'raspberry-pi' && userMatches(identity, value.user); } catch {}
  }
  if (!valid || value.extensionId !== EXTENSION_ID || !hashesValid) throw new Error('Invalid native session registration.');
}
export function hostManifest() {
  return { name: HOST_NAME, description: 'Fixed kidOS native application launcher', path: `${ROOT}/host-entry.sh`, type: 'stdio', allowed_origins: [EXTENSION_ORIGIN] };
}
export async function readRegistration(identity, { optional = false, readProtected = protectedFile } = {}) {
  let bytes;
  try { bytes = await readProtected(RECEIPT, { maxBytes: 8192 }); }
  catch (error) { if (optional && error.code === 'ENOENT') return false; throw error; }
  const registration = JSON.parse(bytes);
  validateRegistration(registration, identity);
  for (const file of Object.keys(registration.hashes)) {
    const value = await readProtected(`${ROOT}/${file}`, { executable: file.endsWith('.sh') });
    if (createHash('sha256').update(value).digest('hex') !== registration.hashes[file]) throw new Error('Native session source differs from its installation receipt.');
  }
  const manifest = JSON.parse(await readProtected(HOST_MANIFEST, { maxBytes: 2048 }));
  if (JSON.stringify(manifest) !== JSON.stringify(hostManifest())) throw new Error('Unexpected native messaging host registration.');
  if (registration.format === 2 && (await readProtected(DESKTOP_ENTRY, { maxBytes: 2048 })).toString() !== desktopEntry()) throw new Error('Unexpected kidOS desktop entry.');
  if (Object.hasOwn(registration.hashes, 'theme/kidos-paint.desktop')) {
    const desktop = await readProtected(PAINT_DESKTOP_ENTRY, { maxBytes: 2048 });
    if (createHash('sha256').update(desktop).digest('hex') !== registration.hashes['theme/kidos-paint.desktop']) throw new Error('Unexpected themed Paint file handler.');
  }
  return registration;
}
export async function checkRegistration(vmId, options = {}) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(vmId || '')) throw new Error('Invalid native session VM identity.');
  return Boolean(await readRegistration(vmId, options));
}
export async function checkPiRegistration(user, options = {}) {
  validateDesktopUser({ username: user?.username, uid: user?.uid, gid: user?.gid, homedir: user?.homedir });
  return Boolean(await readRegistration(user, options));
}
export async function checkEnrolledPiUser(user, env = process.env) {
  await piTarget();
  if (env.HOME !== user.homedir) throw new Error('Use the enrolled ordinary desktop user and home.');
  await checkPiRegistration(user);
  const enrolled = await existingDesktopUser(user.username);
  if (!userMatches(user, enrolled)) throw new Error('The enrolled desktop identity changed.');
  const installed = JSON.parse(await protectedFile('/opt/kidos/install-receipt.json', { maxBytes: 128 * 1024 }));
  if (installed.runtime?.targetKind !== 'raspberry-pi') throw new Error('The kidOS service installation does not attest a Pi.');
  return { targetKind: 'raspberry-pi', user: enrolled };
}
export async function checkSession(user, env = process.env) {
  if (process.platform !== 'linux' || process.arch !== 'arm64' || user.uid < 1000 || env.HOME !== user.homedir) throw new Error('Native applications require the enrolled ordinary Linux ARM64 desktop user.');
  const nativeReceipt = JSON.parse(await protectedFile(RECEIPT, { maxBytes: 8192 }));
  let session;
  if (nativeReceipt.format === 2) session = await checkEnrolledPiUser(user, env);
  else {
    if (!userMatches(user, VM_USER)) throw new Error('Native applications require the ordinary disposable VM desktop user.');
    const osRelease = (await protectedFile('/usr/lib/os-release')).toString();
    if (!/^ID=debian$/m.test(osRelease) || !/^VERSION_ID="13"$/m.test(osRelease)) throw new Error('Unsupported native application fixture.');
    const virtualization = execFileSync('/usr/bin/systemd-detect-virt', ['--vm'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin', LANG: 'C' } }).trim();
    if (!['qemu', 'kvm'].includes(virtualization)) throw new Error('Unsupported native application fixture.');
    const marker = await lstat('/etc/kidos-linux-test.json');
    if (!protectedStat(marker) || (marker.mode & 0o7777) !== 0o600) throw new Error('Missing protected VM marker.');
    const receipt = JSON.parse(await protectedFile('/opt/kidos/install-receipt.json', { maxBytes: 128 * 1024 }));
    if (receipt.runtime?.targetKind !== 'disposable-linux-vm' || receipt.runtime.virtualization !== virtualization) throw new Error('Unsupported native application installation.');
    await checkRegistration(receipt.runtime.vmId);
    session = { targetKind: 'disposable-linux-vm', user: VM_USER, vmId: receipt.runtime.vmId };
  }
  const busPattern = new RegExp(`^unix:path=(/(?:tmp|run/user/${user.uid})/[A-Za-z0-9_.\\/-]+)(?:,guid=[a-f0-9]{32})?$`);
  const busMatch = busPattern.exec(env.DBUS_SESSION_BUS_ADDRESS || '');
  if (env.XDG_RUNTIME_DIR !== `/run/user/${user.uid}` || !/^wayland-[0-9]{1,2}$/.test(env.WAYLAND_DISPLAY || '') || !busMatch || busMatch[1].split('/').some(part => part === '..' || part === '.')) throw new Error('The native graphical session is unavailable.');
  const runtime = await lstat(env.XDG_RUNTIME_DIR);
  const socket = await lstat(`${env.XDG_RUNTIME_DIR}/${env.WAYLAND_DISPLAY}`);
  const bus = await lstat(busMatch[1]);
  if (!runtime.isDirectory() || runtime.isSymbolicLink() || runtime.uid !== user.uid || runtime.mode & 0o022 || !socket.isSocket() || socket.uid !== user.uid || !bus.isSocket() || bus.uid !== user.uid) throw new Error('Unsafe graphical runtime.');
  return session;
}
