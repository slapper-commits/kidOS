import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseOptions } from '../../os/linux-pc/install.mjs';
import { parseOptions as nativeOptions } from '../../os/linux-pc/native.mjs';
import { packageCommands } from '../../os/linux-pc/native-packages.mjs';
import { validatePcFacts, validatePiFacts } from '../../os/native-session/target.mjs';
import { FILES, LEGACY_FILES, validateRegistration } from '../../os/native-session/registration.mjs';
import { EXTENSION_ID } from '../../os/native-session/extension/protocol.mjs';
import { stageNative } from '../../os/native-session/install-core.mjs';
import { commandFor, listApps, launch } from '../../os/native-session/host.mjs';
import { puzzleSupportFiles, piCatalog, piEnvironment } from '../../os/native-session/native-launch.mjs';
import { reopenCommand } from '../../os/native-session/reopen.mjs';
import { PC_NODE, PILOT_NODE, runtimeFor } from '../../os/raspberry-pi/runtime-pin.mjs';
import { validateRuntime } from '../../os/raspberry-pi/check-runtime.mjs';
import { collectRelease, json, makeTar } from '../../os/raspberry-pi/release.mjs';
import { configureDesktopAutostart } from '../../os/raspberry-pi/kiosk-core.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const user = { username: 'casey', uid: 1001, gid: 1001, homedir: '/home/casey' };
const session = { targetKind: 'linux-pc', user };
const facts = { platform: 'linux', arch: 'x64', uid: 1001, osRelease: 'ID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n' };
const template = { format: 3, targetKind: 'linux-pc', user };
const receipt = { ...template, extensionId: EXTENSION_ID, hashes: Object.fromEntries(FILES.map(path => [path, 'a'.repeat(64)])) };
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kidos-pc-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('PC target accepts Debian x64 with the correct authority without weakening Pi checks', () => {
  validatePcFacts(facts);
  validatePcFacts({ ...facts, uid: 0 }, true);
  for (const change of [{ platform: 'darwin' }, { platform: 'win32' }, { arch: 'arm64' }, { arch: 'ia32' }, { uid: 0 }, { uid: undefined }, { osRelease: facts.osRelease.replace('debian', 'ubuntu') }, { osRelease: facts.osRelease.replace('13', '12') }, { osRelease: facts.osRelease.replace('trixie', 'testing') }]) assert.throws(() => validatePcFacts({ ...facts, ...change }));
  assert.throws(() => validatePcFacts(facts, true));
  assert.throws(() => validatePiFacts({ ...facts, model: 'Raspberry Pi 5', issue: 'Raspberry Pi', virtualization: 'none' }), /ARM64/);
  for (const args of [[], ['--yes'], ['--install-on-this-pc', '--force'], ['--install-on-this-pi']]) assert.throws(() => parseOptions(args));
  assert.deepEqual(parseOptions(['--install-on-this-pc']), { install: true });
  assert.deepEqual(parseOptions(['--check-target']), { check: true });
  assert.deepEqual(nativeOptions(['--install', '--desktop-user', user.username]), { username: user.username });
  assert.throws(() => nativeOptions(['--install', '--desktop-user', 'kid;sh']));
});

test('PC runtime receipts cannot accept ARM binaries, staging receipts or another pin', () => {
  assert.equal(runtimeFor('arm64'), PILOT_NODE);
  assert.equal(runtimeFor('x64'), PC_NODE);
  assert.notEqual(PC_NODE.archiveSha256, PILOT_NODE.archiveSha256);
  assert.throws(() => runtimeFor('ia32'));
  const expected = { targetKind: 'linux-pc', arch: 'x64', stageOnly: false, executable: PC_NODE.executable, nodeVersion: PC_NODE.version, archiveSha256: PC_NODE.archiveSha256, nodeSha256: 'a'.repeat(64) };
  const actual = { platform: 'linux', arch: 'x64', executable: PC_NODE.executable, version: PC_NODE.version, sha256: expected.nodeSha256 };
  validateRuntime(expected, actual);
  for (const change of [{ platform: 'darwin' }, { arch: 'arm64' }, { version: 'v22.0.0' }, { executable: '/usr/bin/node' }, { sha256: 'b'.repeat(64) }]) assert.throws(() => validateRuntime(expected, { ...actual, ...change }));
  for (const change of [{ stageOnly: true }, { arch: 'arm64' }, { archiveSha256: PILOT_NODE.archiveSha256 }, { targetKind: 'raspberry-pi' }]) assert.throws(() => validateRuntime({ ...expected, ...change }, actual));
});

test('PC enrollment is distinct from Pi/VM identities and requires the full source graph', async t => {
  validateRegistration(receipt, user);
  for (const change of [{ format: 2 }, { targetKind: 'raspberry-pi' }, { stageOnly: true }, { user: { ...user, uid: 1002 } }, { hashes: Object.fromEntries(LEGACY_FILES.map(path => [path, 'a'.repeat(64)])) }]) assert.throws(() => validateRegistration({ ...receipt, ...change }, user));
  assert.throws(() => validateRegistration(receipt, '942d9f36-9359-4e3d-89bb-dd2b6a053fe6'));
  const directory = await temporary(t), stage = join(directory, 'native');
  await stageNative(stage, template);
  const staged = JSON.parse(await readFile(join(stage, 'opt/kidos-native-session/install.json')));
  assert.equal(staged.targetKind, 'linux-pc'); assert.equal(staged.stageOnly, true);
  assert.throws(() => validateRegistration(staged, user));
  assert.match(await readFile(join(stage, 'usr/share/applications/kidos.desktop'), 'utf8'), /reopen.sh/);
  await assert.rejects(stageNative(stage, template), /empty ordinary/);
});

test('PC catalog uses fixed native commands and architecture-specific GTK files', async () => {
  assert.equal(puzzleSupportFiles('x64')[1], '/usr/lib/x86_64-linux-gnu/girepository-1.0/Gtk-3.0.typelib');
  assert.equal(puzzleSupportFiles('arm64')[1], '/usr/lib/aarch64-linux-gnu/girepository-1.0/Gtk-3.0.typelib');
  assert.throws(() => puzzleSupportFiles('ia32'));
  for (const id of Object.keys(piCatalog(user))) assert.deepEqual(commandFor(id, session), commandFor(id, { targetKind: 'raspberry-pi', user }));
  assert.throws(() => commandFor('puttzoo', session));
  assert.throws(() => commandFor('/bin/sh', session));
  assert.deepEqual(reopenCommand(session), ['/opt/kidos/current/os/linux-pc/kiosk.mjs', '--launch']);
  const inspect = async () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: user.uid, mode: 0o700 });
  const apps = await listApps({ session, inspect, checkFile: async () => {} });
  assert.equal(apps.find(app => app.id === 'writer').available, true);
  assert.equal(apps.find(app => app.id === 'puttzoo').available, false);
  let started = false;
  await assert.rejects(launch('writer', { session, inspect, checkFile: async () => { throw new Error('missing'); }, spawnProcess: () => { started = true; } }), /missing/);
  assert.equal(started, false);
  assert.equal(piEnvironment(user, { LD_PRELOAD: 'unsafe' }, 'paint').LD_PRELOAD, undefined);
  const commands = packageCommands(['--install-on-this-pc']);
  assert.ok(commands[1].includes('--no-remove')); assert.ok(commands[1].includes('chromium'));
  assert.throws(() => packageCommands(['--install-on-this-pc', 'curl']));
});

test('PC archive stages through its installed release symlink with a private empty data directory', async t => {
  const directory = await temporary(t), source = join(directory, 'source');
  await mkdir(source);
  const release = await collectRelease(root, '0.0.1-pilot.18'), archive = join(directory, 'source.tar');
  await writeFile(archive, makeTar(release));
  execFileSync('tar', ['-xf', archive, '-C', source]);
  const stage = join(directory, 'stage');
  const result = JSON.parse(execFileSync(process.execPath, [join(source, 'os/linux-pc/install.mjs'), '--target-root', stage], { encoding: 'utf8' }));
  assert.equal(result.staged, true);
  const runtime = JSON.parse(await readFile(join(stage, 'opt/kidos/runtime.json')));
  assert.equal(runtime.archiveSha256, PC_NODE.archiveSha256); assert.equal(runtime.stageOnly, true);
  assert.deepEqual(await readdir(join(stage, 'var/lib/kidos')), []);
  const installedNative = join(stage, 'opt/kidos/current/os/linux-pc/native.mjs');
  const nativeResult = JSON.parse(execFileSync(process.execPath, [installedNative, '--stage', join(directory, 'native')], { encoding: 'utf8' }));
  assert.equal(nativeResult.installable, false);
});

test('PC login startup is optional and reversible without replacing unrelated desktop entries', async t => {
  const homedir = await temporary(t), localUser = { ...user, uid: process.getuid(), homedir };
  const command = `${PC_NODE.executable} /opt/kidos/current/os/linux-pc/kiosk.mjs --launch`;
  await configureDesktopAutostart(localUser, true, command);
  const path = join(homedir, '.config/autostart/kidos.desktop'), first = await readFile(path);
  await configureDesktopAutostart(localUser, true, command); assert.deepEqual(await readFile(path), first);
  await configureDesktopAutostart(localUser, false, command); await assert.rejects(readFile(path), { code: 'ENOENT' });
  await writeFile(path, '[Desktop Entry]\nName=Keep this\n');
  await assert.rejects(configureDesktopAutostart(localUser, true, command), /unrelated/);
  assert.match(await readFile(path, 'utf8'), /Keep this/);
});

test('PC live entry points refuse non-x64-Linux hosts before reading or changing installation files', { skip: process.platform === 'linux' && process.arch === 'x64' }, () => {
  for (const [file, args] of [['install.mjs', ['--install-on-this-pc']], ['native-packages.mjs', ['--install-on-this-pc']], ['native.mjs', ['--install', '--desktop-user', user.username]], ['kiosk.mjs', ['--enable-autostart']]]) {
    assert.throws(() => execFileSync(process.execPath, [join(root, 'os/linux-pc', file), ...args], { encoding: 'utf8', stdio: 'pipe' }), error => {
      assert.match(error.stderr, /Linux x64|ordinary desktop user/); assert.doesNotMatch(error.stderr, /ENOENT/); return true;
    });
  }
});
