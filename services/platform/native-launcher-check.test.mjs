import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, lstat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { QA_PROFILE, validateCaller, checkImportFiles, chromiumArguments, chromiumEnvironment, prepareProfile } from '../../os/linux-test/native-launcher-check.mjs';

const user = { username: 'kidos-test', uid: 1000, gid: 1000, homedir: '/home/kidos-test' };
const facts = { platform: 'linux', arch: 'arm64', uid: 1000, user, home: user.homedir };
test('native check has no arguments and requires the exact ordinary VM identity', () => {
  validateCaller([], facts);
  for (const args of [['--profile=/tmp/other'], ['--no-sandbox'], ['http://elsewhere/']]) assert.throws(() => validateCaller(args, facts), /no arguments/);
  for (const changed of [{ platform: 'darwin' }, { arch: 'x64' }, { uid: 0 }, { user: { ...user, uid: 1001 } }, { user: { ...user, gid: 1001 } }, { user: { ...user, username: 'other' } }, { home: '/tmp' }]) assert.throws(() => validateCaller([], { ...facts, ...changed }), /ordinary Linux ARM64/);
  assert.equal(QA_PROFILE, '/home/kidos-test/.local/share/kidos-browser-native-qa');
  const args = chromiumArguments();
  assert.ok(args.includes(`--user-data-dir=${QA_PROFILE}`));
  assert.ok(args.includes('--load-extension=/opt/kidos-native-session/extension'));
  assert.ok(args.includes('--app=http://127.0.0.1:8787/'));
  assert.equal(args.some(value => /no-sandbox|remote-debugging|kidos-browser$/.test(value)), false);
});
test('native check validates the registration import closure before loading it', async () => {
  const seen = [];
  const inspect = async path => { seen.push(path); return { isDirectory: () => !path.endsWith('.mjs'), isFile: () => path.endsWith('.mjs'), isSymbolicLink: () => false, uid: 0, mode: 0o755, nlink: 1, size: 2048 }; };
  await checkImportFiles(inspect);
  assert.ok(seen.includes('/opt/kidos-native-session/target.mjs'));
  assert.ok(seen.includes('/opt/kidos-native-session/theme.mjs'));
  for (const file of ['target.mjs', 'theme.mjs']) for (const changed of [{ uid: 1000 }, { mode: 0o777 }, { isSymbolicLink: () => true }, { nlink: 2 }, { size: 1024 * 1024 }]) await assert.rejects(checkImportFiles(async path => ({ ...await inspect(path), ...(path.endsWith(`/${file}`) ? changed : {}) })), /Unsafe/);
});
test('native check preserves Wayland selection without inheriting X11 or process injection settings', () => {
  const env = chromiumEnvironment({ WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_SESSION_TYPE: 'x11', DISPLAY: ':99', HOME: '/wrong', NODE_OPTIONS: '--inspect', LD_PRELOAD: '/tmp/other' });
  assert.equal(env.XDG_SESSION_TYPE, 'wayland');
  assert.equal(env.WAYLAND_DISPLAY, 'wayland-0');
  assert.equal(env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/run/user/1000/bus');
  assert.equal(env.HOME, user.homedir);
  assert.equal(env.DISPLAY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.LD_PRELOAD, undefined);
});
test('native check profile preserves existing browser data and refuses linked profile paths', async t => {
  const home = await mkdtemp(join(tmpdir(), 'kidos-native-check-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await prepareProfile(home, process.getuid());
  const profile = `${home}/.local/share/kidos-browser-native-qa`, file = `${profile}/existing-session`;
  await writeFile(file, 'preserve');
  await prepareProfile(home, process.getuid());
  assert.equal(await readFile(file, 'utf8'), 'preserve');
  assert.equal((await lstat(profile)).mode & 0o777, 0o700);
  await rm(profile, { recursive: true });
  await symlink(home, profile);
  await assert.rejects(prepareProfile(home, process.getuid()), /unsafe/);
});
test('native check CLI refuses the development host before installed imports or profile writes', { skip: process.platform === 'linux' && process.arch === 'arm64' }, () => {
  const path = fileURLToPath(new URL('../../os/linux-test/native-launcher-check.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [path], { encoding: 'utf8', stdio: 'pipe' }), error => /ordinary Linux ARM64/.test(error.stderr) && !/ENOENT/.test(error.stderr));
});
