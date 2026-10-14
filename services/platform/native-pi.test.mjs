import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { validatePiFacts, validateDesktopUser, parsePasswd, existingDesktopUser, userMatches, VM_USER } from '../../os/native-session/target.mjs';
import { APP_IDS, EXTENSION_ID } from '../../os/native-session/extension/protocol.mjs';
import { FILES, LEGACY_FILES, PRE_THEME_FILES, PRE_SYSTEM_THEME_FILES, PRE_PUZZLE_FILES, PAINT_DESKTOP_ENTRY, ROOT, RECEIPT, HOST_MANIFEST, DESKTOP_ENTRY, desktopEntry, hostManifest, checkPiRegistration, readRegistration, validateRegistration } from '../../os/native-session/registration.mjs';
import { nativePaths, PI_APP_IDS, PUZZLE_BINARIES, piCatalog, piCommandFor, piEnvironment, prepareNativeFiles } from '../../os/native-session/native-launch.mjs';
import { commandFor, listApps, launch } from '../../os/native-session/host.mjs';
import { stageNative, installRegistration } from '../../os/native-session/install-core.mjs';
import { parseOptions, preflightPiApplications } from '../../os/native-session/install-pi.mjs';
import { reopenCommand, reopenEnvironment } from '../../os/native-session/reopen.mjs';

const execute = promisify(execFile);
const user = Object.freeze({ username: 'casey', uid: 1002, gid: 1002, homedir: '/home/casey' });
const session = { targetKind: 'raspberry-pi', user };
const template = { format: 2, targetKind: 'raspberry-pi', user };
const osRelease = 'ID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n';
const facts = { platform: 'linux', arch: 'arm64', uid: 1002, model: 'Raspberry Pi 5 Model B Rev 1.0\0', osRelease, issue: 'Raspberry Pi reference 2026', virtualization: 'none' };
const ordinaryDirectory = (uid = user.uid) => ({ isDirectory: () => true, isSymbolicLink: () => false, uid, mode: 0o700 });
async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'kidos-native-pi-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('Pi target requires physical ARM64 Raspberry Pi OS Trixie and the correct authority', () => {
  validatePiFacts(facts);
  validatePiFacts({ ...facts, uid: 0 }, true);
  for (const change of [{ platform: 'darwin' }, { arch: 'x64' }, { uid: 0 }, { uid: 999 }, { virtualization: 'qemu' }, { virtualization: 'docker' }, { model: 'QEMU ARM Virtual Machine' }, { osRelease: osRelease.replace('trixie', 'bookworm') }, { osRelease: osRelease.replace('13', '12') }, { issue: 'Debian ARM64' }]) assert.throws(() => validatePiFacts({ ...facts, ...change }));
  assert.throws(() => validatePiFacts(facts, true));
});
test('enrollment accepts one existing normal login user and rejects shell/path/identity substitutions', async () => {
  assert.deepEqual(parsePasswd('casey:x:1002:1002:Example:/home/casey:/bin/bash\n', 'casey'), user);
  assert.ok(userMatches({ ...user, shell: '/bin/bash' }, user));
  assert.equal(userMatches({ ...user, uid: 1003 }, user), false);
  for (const change of [{ uid: 0 }, { gid: 0 }, { homedir: '/var/lib/kidos' }, { homedir: '/home/casey/../root' }, { username: 'casey;sh' }, { executable: '/bin/sh' }]) assert.throws(() => validateDesktopUser({ ...user, ...change }));
  for (const line of ['casey:x:1002:1002::/home/casey:/usr/sbin/nologin', 'casey:x:1002:1002::/home/casey:/bin/false', 'other:x:1002:1002::/home/casey:/bin/bash', 'casey:x:1002:1002::/home/casey:/bin/bash\nother:x:1003:1003::/home/other:/bin/bash']) assert.throws(() => parsePasswd(line, 'casey'));
  const seen = [];
  const deps = { run(bin, args) { seen.push([bin, args]); return 'casey:x:1002:1002::/home/casey:/bin/bash'; }, inspect: async path => ordinaryDirectory(path === '/home' ? 0 : user.uid) };
  assert.deepEqual(await existingDesktopUser('casey', deps), user);
  assert.deepEqual(seen, [['/usr/bin/getent', ['passwd', 'casey']]]);
  await assert.rejects(existingDesktopUser('--system', deps)); assert.equal(seen.length, 1);
  await assert.rejects(existingDesktopUser('casey', { ...deps, inspect: async () => ({ ...ordinaryDirectory(), isSymbolicLink: () => true }) }), /home/);
});
test('Pi commands derive only known folders and approved executables from the enrolled identity', () => {
  assert.deepEqual(PI_APP_IDS, ['paint', 'writer', 'calculator', 'files', 'documents', 'downloads', 'trash', 'openttd', 'solitaire', 'minesweeper', 'pinball', 'puzzlebox']);
  assert.equal(commandFor('writer', session).executable, '/usr/lib/libreoffice/program/soffice');
  assert.deepEqual(piCommandFor('writer', user).args, ['-env:UserInstallation=file:///home/casey/.local/share/kidos-native/config/libreoffice/4', '--writer']);
  assert.deepEqual(piCommandFor('calculator', user).args, ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/calculator.qss', '-qwindowtitle', 'Calculator']);
  assert.deepEqual(piCommandFor('solitaire', user), { executable: '/usr/games/kpat', args: ['-style', 'Fusion', '-qwindowtitle', 'Solitaire'], cwd: '/home/casey/.local/share/kidos-native' });
  assert.deepEqual(piCommandFor('minesweeper', user), { executable: '/usr/games/kmines', args: ['-style', 'Fusion', '-qwindowtitle', 'Minesweeper'], cwd: '/home/casey/.local/share/kidos-native' });
  assert.deepEqual(piCommandFor('pinball', user), { executable: '/usr/games/pinball', args: [], cwd: '/home/casey/.local/share/kidos-native' });
  assert.deepEqual(piCommandFor('puzzlebox', user), { executable: '/usr/bin/python3.13', args: ['-I', '/opt/kidos-native-session/puzzlebox.py'], cwd: '/home/casey/Documents' });
  const filesStyle = ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/files.qss', '--profile=kidos-files'];
  assert.deepEqual(piCommandFor('files', user).args, [...filesStyle, '/home/casey/Pictures']);
  assert.deepEqual(piCommandFor('documents', user).args, [...filesStyle, '/home/casey/Documents']);
  assert.deepEqual(piCommandFor('downloads', user).args, [...filesStyle, '/home/casey/Downloads']);
  assert.deepEqual(piCommandFor('trash', user).args, [...filesStyle, 'trash:///']);
  const game = piCommandFor('openttd', user);
  assert.equal(game.executable, '/usr/bin/flock'); assert.equal(game.args[2], '/usr/games/openttd');
  assert.ok(game.args.includes('/home/casey/.local/share/kidos-native/config/openttd/openttd.cfg'));
  for (const id of ['puttzoo', 'writer /tmp/input', 'paint;sh', 'pinball --exec', 'solitaire /tmp/game', 'minesweeper;sh', '/bin/sh', 'file:///tmp/anything', '__proto__']) assert.throws(() => piCommandFor(id, user));
  for (const id of PI_APP_IDS) assert.ok(!JSON.stringify(piCommandFor(id, user)).includes('kidos-linux-test'));
  assert.throws(() => commandFor('paint', { targetKind: 'anything' }), /target/);
});
test('Pi launch environment shares Files/Writer settings without inheriting interpreter or preload hooks', () => {
  const inherited = { WAYLAND_DISPLAY: 'wayland-1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1002/bus', HOME: '/root', PATH: '/evil', NODE_OPTIONS: '--inspect', LD_PRELOAD: '/evil', PYTHONPATH: '/evil', SAL_USE_VCLPLUGIN: 'gen', DISPLAY: ':9' };
  const writer = piEnvironment(user, inherited, 'writer'), files = piEnvironment(user, inherited, 'files');
  assert.deepEqual(writer, files);
  assert.equal(writer.XDG_CONFIG_HOME, '/home/casey/.local/share/kidos-native/config');
  assert.equal(writer.SAL_USE_VCLPLUGIN, 'qt6'); assert.equal(writer.QT_QPA_PLATFORM, 'wayland');
  assert.equal(writer.HOME, user.homedir); assert.equal(writer.XDG_RUNTIME_DIR, '/run/user/1002');
  for (const name of ['NODE_OPTIONS', 'LD_PRELOAD', 'PYTHONPATH', 'DISPLAY']) assert.equal(writer[name], undefined);
  assert.equal(piEnvironment(user, inherited, 'openttd').XDG_DATA_HOME, '/home/casey/.local/share/kidos-native/data');
  assert.equal(piEnvironment(user, { ...inherited, SDL_VIDEODRIVER: 'evil' }, 'pinball').SDL_VIDEODRIVER, 'wayland');
});
test('Pi package preflight uses protected fixed package paths and never requires VM or proprietary assets', async () => {
  const seen = [];
  await preflightPiApplications(user, { checkFile: async (path, options) => seen.push({ path, options }) });
  assert.ok(seen.some(({ path, options }) => path === '/usr/games/openttd' && options.executable));
  for (const game of ['kpat', 'kmines', 'pinball']) assert.ok(seen.some(({ path, options }) => path === `/usr/games/${game}` && options.executable));
  for (const binary of ['/usr/bin/python3.13', ...PUZZLE_BINARIES]) assert.ok(seen.some(({ path, options }) => path === binary && options.executable));
  for (const table of ['tux', 'professor']) assert.ok(seen.some(({ path, options }) => path === `/usr/share/games/pinball/${table}/pinball.pbl` && !options.executable));
  assert.ok(seen.some(({ path }) => path.endsWith('/libvclplug_qt6lo.so')));
  assert.ok(seen.every(({ path, options }) => path.startsWith('/usr/') && !path.includes('puttzoo') && options.read === false));
  await assert.rejects(preflightPiApplications(user, { checkFile: async path => { if (path === '/usr/bin/kcalc') throw new Error('missing calculator'); } }), /missing calculator/);
});
test('Pi availability preserves stable protocol order but excludes the optional VM demo', async () => {
  const checks = [], inspect = async () => ordinaryDirectory();
  const available = await listApps({ session, inspect, checkFile: async path => checks.push(path) });
  assert.deepEqual(available.map(app => app.id), APP_IDS);
  assert.equal(available.find(app => app.id === 'writer').name, 'Write');
  assert.equal(available.find(app => app.id === 'puttzoo').reason, 'not-installed');
  assert.ok(available.filter(app => app.id !== 'puttzoo').every(app => app.available));
  assert.ok(checks.every(path => !path.includes('kidos-linux-test') && !path.includes('scummvm')));
  const wrongOwner = await listApps({ session, inspect: async () => ordinaryDirectory(1000), checkFile: async () => {} });
  assert.equal(wrongOwner.find(app => app.id === 'writer').reason, 'not-configured');
  const missing = await listApps({ session, inspect, checkFile: async path => { if (path.endsWith('soffice.bin')) throw new Error('missing'); } });
  assert.equal(missing.find(app => app.id === 'writer').reason, 'not-installed');
  const missingTable = await listApps({ session, inspect, checkFile: async path => { if (path === '/usr/share/games/pinball/professor/pinball.pbl') throw new Error('missing'); } });
  assert.equal(missingTable.find(app => app.id === 'pinball').reason, 'not-installed');
});
test('Pi launch independently rechecks packages/folders and spawns direct fixed commands without a shell', async () => {
  let observed;
  const deps = { session, checkFile: async () => {}, inspect: async () => ordinaryDirectory(), env: { WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1002/bus', LD_PRELOAD: '/evil' }, spawnProcess(executable, args, options) { observed = { executable, args, options }; const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('exit', 0)); return child; } };
  assert.equal(await launch('writer', deps), 'started');
  assert.equal(observed.executable, '/usr/lib/libreoffice/program/soffice'); assert.equal(observed.options.cwd, '/home/casey/Documents');
  assert.equal(observed.options.shell, false); assert.equal(observed.options.stdio, 'ignore'); assert.equal(observed.options.env.LD_PRELOAD, undefined);
  let started = false;
  await assert.rejects(launch('writer', { ...deps, inspect: async () => ({ ...ordinaryDirectory(), isSymbolicLink: () => true }), spawnProcess() { started = true; } }));
  assert.equal(started, false);
  await assert.rejects(launch('puttzoo', deps), /Invalid/);
});
test('Pi user setup preserves existing documents, game saves and private app preferences on rerun', async t => {
  const home = await temporary(t), uid = process.getuid();
  const first = await prepareNativeFiles(home, uid); assert.equal(first.created.length, 3);
  const base = `${home}/.local/share/kidos-native`, writer = `${base}/config/libreoffice/4`;
  await mkdir(`${writer}/user`, { mode: 0o700 });
  await writeFile(`${writer}/user/registrymodifications.xcu`, 'existing Writer settings');
  await writeFile(`${base}/config/mimeapps.list`, 'existing associations');
  await writeFile(`${base}/data/openttd/save/story.sav`, 'existing game');
  await writeFile(`${home}/Documents/story.odt`, 'existing document');
  const again = await prepareNativeFiles(home, uid); assert.equal(again.created.length, 0); assert.equal(again.preserved.length, 3);
  for (const [path, expected] of [[`${writer}/user/registrymodifications.xcu`, 'existing Writer settings'], [`${base}/config/mimeapps.list`, 'existing associations'], [`${base}/data/openttd/save/story.sav`, 'existing game'], [`${home}/Documents/story.odt`, 'existing document']]) assert.equal(await readFile(path, 'utf8'), expected);
  assert.equal((await stat(base)).mode & 0o777, 0o700);
});
test('Pi user setup refuses links/writable profile parents and does not publish partial preferences', async t => {
  const home = await temporary(t), outside = await temporary(t), uid = process.getuid();
  await prepareNativeFiles(home, uid);
  const config = `${home}/.local/share/kidos-native/config`;
  await rm(`${config}/libreoffice`, { recursive: true }); await symlink(outside, `${config}/libreoffice`);
  await assert.rejects(prepareNativeFiles(home, uid)); assert.deepEqual(await readdir(outside), []);
  await rm(`${config}/libreoffice`); await prepareNativeFiles(home, uid); await chmod(`${config}/libreoffice`, 0o777);
  await assert.rejects(prepareNativeFiles(home, uid));
  const fresh = await temporary(t);
  await assert.rejects(prepareNativeFiles(fresh, uid, { writeContents: async file => { await file.writeFile('partial'); throw new Error('interruption'); } }), /interruption/);
  await assert.rejects(stat(`${fresh}/.local/share/kidos-native/config/pcmanfm-qt/kidos-files/settings.conf`), { code: 'ENOENT' });
  assert.equal((await prepareNativeFiles(fresh, uid)).created.length, 3);
});
test('Pi preference publication preserves a concurrent settings file', async t => {
  const home = await temporary(t), target = `${home}/.local/share/kidos-native/config/pcmanfm-qt/kidos-files/settings.conf`;
  let first = true;
  const result = await prepareNativeFiles(home, process.getuid(), { writeContents: async (file, text) => { await file.writeFile(text); if (first) { first = false; await writeFile(target, 'concurrent settings', { flag: 'wx', mode: 0o600 }); } } });
  assert.equal(result.preserved.length, 1); assert.equal(await readFile(target, 'utf8'), 'concurrent settings');
});

function registrationFixture() {
  const source = Buffer.from('protected source\n'), hashes = Object.fromEntries(FILES.map(file => [file, createHash('sha256').update(source).digest('hex')]));
  const registration = { ...template, extensionId: EXTENSION_ID, hashes };
  const files = new Map(FILES.map(file => [`${ROOT}/${file}`, source]));
  files.set(RECEIPT, Buffer.from(JSON.stringify(registration))); files.set(HOST_MANIFEST, Buffer.from(JSON.stringify(hostManifest()))); files.set(DESKTOP_ENTRY, Buffer.from(desktopEntry()));
  files.set(PAINT_DESKTOP_ENTRY, files.get(`${ROOT}/theme/kidos-paint.desktop`));
  const readProtected = async path => { if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(path); };
  return { registration, files, readProtected };
}
test('Pi registration accepts userInfo shape but rejects another identity, changed source, manifest or desktop entry', async () => {
  const f = registrationFixture();
  assert.equal(await checkPiRegistration({ ...user, shell: '/bin/bash' }, f), true);
  await assert.rejects(checkPiRegistration({ ...user, uid: 1003 }, f), /registration/);
  for (const path of [`${ROOT}/host.mjs`, HOST_MANIFEST, DESKTOP_ENTRY, PAINT_DESKTOP_ENTRY]) {
    const previous = f.files.get(path); f.files.set(path, Buffer.from(path === HOST_MANIFEST ? '{}' : 'changed'));
    await assert.rejects(checkPiRegistration(user, f)); f.files.set(path, previous);
  }
  const extra = { ...f.registration, hashes: { ...f.registration.hashes, 'extra.mjs': 'a'.repeat(64) } };
  assert.throws(() => validateRegistration(extra, user), /registration/);
  assert.throws(() => validateRegistration({ ...f.registration, user: { ...user, command: '/bin/sh' } }, user), /registration/);
});
test('optional Pi registration allows absence only and legacy VM receipts keep their exact file set', async () => {
  const f = registrationFixture(); f.files.delete(RECEIPT);
  assert.equal(await checkPiRegistration(user, { ...f, optional: true }), false);
  const broken = registrationFixture(); broken.files.delete(`${ROOT}/host.mjs`);
  await assert.rejects(checkPiRegistration(user, { ...broken, optional: true }));
  const vmId = '11111111-2222-4333-8444-555555555555';
  const legacy = { format: 1, vmId, extensionId: EXTENSION_ID, hashes: Object.fromEntries(LEGACY_FILES.map(file => [file, 'a'.repeat(64)])) };
  validateRegistration(legacy, vmId); assert.throws(() => validateRegistration(legacy, user));
  const previous = Object.fromEntries(PRE_THEME_FILES.map(file => [file, 'a'.repeat(64)]));
  validateRegistration({ ...legacy, hashes: previous }, vmId);
  validateRegistration({ ...template, extensionId: EXTENSION_ID, hashes: previous }, user);
});
test('the first themed 39-file installation can upgrade while partial catalogs and changed assets remain invalid', async () => {
  assert.equal(PRE_SYSTEM_THEME_FILES.length, 39);
  const f = registrationFixture();
  const hashes = Object.fromEntries(PRE_SYSTEM_THEME_FILES.map(file => [file, f.registration.hashes[file]]));
  const receipt = { ...f.registration, hashes };
  f.files.set(RECEIPT, Buffer.from(JSON.stringify(receipt)));
  for (const file of FILES.filter(file => !PRE_SYSTEM_THEME_FILES.includes(file))) f.files.delete(`${ROOT}/${file}`);
  assert.equal(await checkPiRegistration(user, f), true);
  const vmId = '11111111-2222-4333-8444-555555555555';
  validateRegistration({ format: 1, vmId, extensionId: EXTENSION_ID, hashes }, vmId);
  const partial = { ...hashes }; delete partial['theme/paint.qss'];
  for (const changed of [partial, { ...hashes, 'theme/files.qss': 'a'.repeat(64) }, { ...hashes, 'extra.mjs': 'a'.repeat(64) }]) assert.throws(() => validateRegistration({ ...receipt, hashes: changed }, user), /registration/);
  f.files.set(`${ROOT}/theme/writer/registrymodifications.xcu`, Buffer.from('changed old theme'));
  await assert.rejects(checkPiRegistration(user, f), /differs/);
});
test('the exact pre-Puzzle Box 42-file receipt upgrades while partial additions and tampering fail', async () => {
  assert.equal(PRE_PUZZLE_FILES.length, 42); assert.equal(FILES.length, 44);
  const f = registrationFixture();
  const hashes = Object.fromEntries(PRE_PUZZLE_FILES.map(file => [file, f.registration.hashes[file]]));
  const receipt = { ...f.registration, hashes };
  f.files.set(RECEIPT, Buffer.from(JSON.stringify(receipt)));
  for (const file of ['puzzlebox.py', 'puzzlebox-catalog.json']) f.files.delete(`${ROOT}/${file}`);
  assert.equal(await checkPiRegistration(user, f), true);
  const vmId = '11111111-2222-4333-8444-555555555555';
  validateRegistration({ format: 1, vmId, extensionId: EXTENSION_ID, hashes }, vmId);
  for (const file of ['puzzlebox.py', 'puzzlebox-catalog.json']) assert.throws(() => validateRegistration({ ...receipt, hashes: { ...hashes, [file]: 'a'.repeat(64) } }, user), /registration/);
  f.files.set(`${ROOT}/host.mjs`, Buffer.from('tampered old host'));
  await assert.rejects(checkPiRegistration(user, f), /differs/);
  const current = registrationFixture();
  current.files.set(`${ROOT}/puzzlebox-catalog.json`, Buffer.from('tampered puzzle catalog'));
  await assert.rejects(checkPiRegistration(user, current), /differs/);
});
test('native Pi staging records source hashes, writes a fixed desktop entry and cannot masquerade as enrollment', async t => {
  const target = await temporary(t);
  const result = await stageNative(target, template);
  assert.equal(result.installable, false);
  const receipt = JSON.parse(await readFile(`${target}${RECEIPT}`, 'utf8'));
  assert.equal(receipt.stageOnly, true); assert.throws(() => validateRegistration(receipt, user), /registration/);
  for (const file of FILES) {
    const bytes = await readFile(`${target}${ROOT}/${file}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.hashes[file]);
    assert.ok(!/from ['"]\.\.\/linux-test\//.test(bytes.toString()));
  }
  assert.equal(await readFile(`${target}${DESKTOP_ENTRY}`, 'utf8'), desktopEntry());
  assert.deepEqual(await readFile(`${target}${PAINT_DESKTOP_ENTRY}`), await readFile(`${target}${ROOT}/theme/kidos-paint.desktop`));
  assert.equal((await stat(`${target}${ROOT}/host-entry.sh`)).mode & 0o777, 0o755);
  await assert.rejects(stageNative(target, template), /empty/);
});
test('native staging refuses linked output and leaves invalid source targets untouched', async t => {
  const home = await temporary(t), target = `${home}/staged`, outside = await temporary(t);
  await symlink(outside, target); await assert.rejects(stageNative(target, template), /empty/); assert.deepEqual(await readdir(outside), []);
  await assert.rejects(stageNative(`${home}/not-created`, template, { root: outside }));
  await assert.rejects(stat(`${home}/not-created`), { code: 'ENOENT' });
});
test('Pi installer CLI works through a selected-release symlink in staging', async t => {
  const home = await temporary(t), link = `${home}/installer.mjs`, destination = `${home}/stage`;
  await symlink(fileURLToPath(new URL('../../os/native-session/install-pi.mjs', import.meta.url)), link);
  const result = await execute(process.execPath, [link, '--stage', destination], { timeout: 5000 });
  assert.equal(JSON.parse(result.stdout).staged, true);
  assert.ok(await stat(`${destination}${DESKTOP_ENTRY}`));
});
test('Pi install options and argument-free reopen preserve target separation', () => {
  assert.deepEqual(parseOptions(['--install', '--desktop-user', 'casey']), { install: true, username: 'casey' });
  for (const args of [[], ['--install'], ['--install', '--desktop-user', 'root;sh'], ['--install', '--desktop-user', 'casey', '--force'], ['--stage', '/', '--install']]) assert.throws(() => parseOptions(args));
  assert.deepEqual(reopenCommand(session), ['/opt/kidos/current/os/raspberry-pi/kiosk.mjs', '--launch']);
  const vmId = '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(reopenCommand({ targetKind: 'disposable-linux-vm', user: VM_USER, vmId }), ['/opt/kidos-linux-test/kiosk.mjs', '--launch', '--disposable-vm-id', vmId]);
  assert.throws(() => reopenCommand({ targetKind: 'other', user }));
});
test('desktop reopen carries the verified Wayland session type to the new Chromium launcher', () => {
  for (const selected of [session, { targetKind: 'disposable-linux-vm', user: VM_USER }]) {
    const env = reopenEnvironment(selected, { WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${selected.user.uid}/bus`, XDG_SESSION_TYPE: 'x11', DISPLAY: ':99', NODE_OPTIONS: '--inspect', LD_PRELOAD: '/tmp/other' });
    assert.equal(env.XDG_SESSION_TYPE, 'wayland');
    assert.equal(env.WAYLAND_DISPLAY, 'wayland-0');
    assert.equal(env.XDG_RUNTIME_DIR, `/run/user/${selected.user.uid}`);
    assert.equal(env.DBUS_SESSION_BUS_ADDRESS, `unix:path=/run/user/${selected.user.uid}/bus`);
    assert.equal(env.HOME, selected.user.homedir);
    assert.equal(env.DISPLAY, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.LD_PRELOAD, undefined);
  }
});
test('Pi live install and user setup refuse the development host before host mutation', { skip: process.platform === 'linux' && process.arch === 'arm64' }, async () => {
  const installer = fileURLToPath(new URL('../../os/native-session/install-pi.mjs', import.meta.url));
  const setup = fileURLToPath(new URL('../../os/native-session/native-launch.mjs', import.meta.url));
  for (const [path, args] of [[installer, ['--install', '--desktop-user', 'casey']], [setup, ['--setup-user']]]) await assert.rejects(execute(process.execPath, [path, ...args], { timeout: 5000 }), error => error.code === 1 && /Linux ARM64/.test(error.stderr));
  await assert.rejects(installRegistration(template), /Linux ARM64/);
});
