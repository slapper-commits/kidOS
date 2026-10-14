import { lstat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { keys } from './extension/protocol.mjs';

export const VM_USER = Object.freeze({ username: 'kidos-test', uid: 1000, gid: 1000, homedir: '/home/kidos-test' });
export const VM_SESSION = Object.freeze({ targetKind: 'disposable-linux-vm', user: VM_USER });
export function validateDesktopUser(user) {
  if (!keys(user, ['username', 'uid', 'gid', 'homedir']) || !/^[a-z_][a-z0-9_-]{0,31}$/.test(user.username || '') ||
      !Number.isSafeInteger(user.uid) || user.uid < 1000 || user.uid > 2147483647 ||
      !Number.isSafeInteger(user.gid) || user.gid < 1 || user.gid > 2147483647 ||
      !/^\/home\/[a-z_][a-z0-9_-]{0,31}$/.test(user.homedir || '')) throw new Error('Choose one existing ordinary desktop user with a normal /home directory.');
  return user;
}
export function userMatches(actual, expected) {
  validateDesktopUser(expected);
  return ['username', 'uid', 'gid', 'homedir'].every(key => actual?.[key] === expected[key]);
}
export function parsePasswd(text, name) {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name || '') || typeof text !== 'string' || text.trim().split('\n').length !== 1) throw new Error('Invalid desktop user record.');
  const fields = text.trim().split(':');
  if (fields.length !== 7 || fields[0] !== name || !/^\d+$/.test(fields[2]) || !/^\d+$/.test(fields[3]) || !['/bin/bash', '/usr/bin/bash', '/bin/sh', '/usr/bin/sh', '/bin/zsh', '/usr/bin/zsh', '/usr/bin/fish'].includes(fields[6])) throw new Error('The selected account must be an existing login user.');
  return validateDesktopUser({ username: fields[0], uid: Number(fields[2]), gid: Number(fields[3]), homedir: fields[5] });
}
export function validatePiFacts({ platform, arch, uid, model, osRelease, issue, virtualization }, install = false) {
  if (platform !== 'linux' || arch !== 'arm64' || (install ? uid !== 0 : !Number.isSafeInteger(uid) || uid < 1000)) throw new Error('Native Pi setup requires Linux ARM64 and the correct root/ordinary-user authority.');
  if (typeof model !== 'string' || !/^Raspberry Pi [^\r\n\0]+\0?$/.test(model.trim()) || virtualization !== 'none') throw new Error('Native Pi setup requires physical Raspberry Pi hardware.');
  if (!/^ID=["']?(?:debian|raspbian)["']?$/m.test(osRelease || '') || !/^VERSION_ID=["']?13["']?$/m.test(osRelease || '') || !/^VERSION_CODENAME=["']?trixie["']?$/m.test(osRelease || '') || !/Raspberry Pi/.test(issue || '')) throw new Error('Native Pi setup requires Raspberry Pi OS Trixie 64-bit.');
}
export async function piTarget({ install = false } = {}) {
  const identity = { platform: process.platform, arch: process.arch, uid: process.getuid?.() };
  // Refuse the development host before looking up users, invoking commands or
  // reading any device-specific files.
  if (identity.platform !== 'linux' || identity.arch !== 'arm64' || (install ? identity.uid !== 0 : identity.uid < 1000)) throw new Error('Native Pi setup requires Linux ARM64 and the correct root/ordinary-user authority.');
  let virtualization;
  try { virtualization = execFileSync('/usr/bin/systemd-detect-virt', [], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C' } }).trim(); }
  catch (error) { if (error.status === 1 && String(error.stdout).trim() === 'none') virtualization = 'none'; else throw new Error('Could not verify the physical Pi target.'); }
  const [model, osRelease, issue] = await Promise.all([readFile('/proc/device-tree/model', 'utf8'), readFile('/etc/os-release', 'utf8'), readFile('/etc/rpi-issue', 'utf8')]);
  validatePiFacts({ ...identity, model, osRelease, issue, virtualization }, install);
  return { targetKind: 'raspberry-pi', model: model.replace(/\0/g, '').trim() };
}
export async function existingDesktopUser(name, { run = execFileSync, inspect = lstat } = {}) {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(name || '')) throw new Error('Invalid desktop user name.');
  const user = parsePasswd(run('/usr/bin/getent', ['passwd', name], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C' } }), name);
  const parent = await inspect('/home'), home = await inspect(user.homedir);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || parent.mode & 0o022 || !home.isDirectory() || home.isSymbolicLink() || home.uid !== user.uid || home.mode & 0o022) throw new Error('The desktop home must exist, belong to the selected user and have protected parent directories.');
  return user;
}
