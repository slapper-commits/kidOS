import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SOURCE, bootMode, livePlasmaConfiguration, liveScreenLockCommands, liveWalletCommands, nativeUserSetupCommand, validateLiveUserPath, main, prepareFirstBoot, protectedSource, requireBootAuthority, validateFirstbootReceipt, validateFirstbootUser, validateServiceReceipts } from '../../os/live-usb/firstboot.mjs';
import { PC_NODE } from '../../os/raspberry-pi/runtime-pin.mjs';
import { validateRuntime } from '../../os/raspberry-pi/check-runtime.mjs';
import { collectRelease, json } from '../../os/raspberry-pi/release.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const user = { username: 'casey', uid: 1000, gid: 1000, homedir: '/home/casey' };
const release = { id: '0.0.1-pilot.19-123456abcdef', contentDigest: 'a'.repeat(64) };
const directory = (change = {}) => ({ isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false, uid: 0, mode: 0o755, ...change });
const file = (change = {}) => directory({ isDirectory: () => false, isFile: () => true, mode: 0o644, nlink: 1, size: 10, ...change });
function fixture(change = {}) {
  const calls = [], state = { receipt: null, service: null, native: null };
  const effects = {
    target: async () => { calls.push('target'); return { targetKind: 'linux-pc', arch: 'x64' }; },
    cmdline: async () => 'quiet', medium: async () => null, user: async () => user,
    release: async () => release, previous: async () => state.receipt,
    installed: async () => state.service,
    validateInstalled: async value => { calls.push('validate'); assert.equal(value.release, release.id); },
    installService: async target => { assert.equal(target.targetKind, 'linux-pc'); calls.push('service'); state.service = { release: release.id }; },
    lockLiveAccount: async () => { calls.push('lock-live'); },
    setupNativeUser: async value => { assert.equal(value.uid, 1000); calls.push('user-setup'); },
    configureLiveScreenLock: async value => { assert.equal(value.username, 'kidos-live'); calls.push('live-lock'); },
    configureLiveWallet: async value => { assert.equal(value.username, 'kidos-live'); calls.push('live-wallet'); },
    selectLiveSession: async () => { calls.push('plasma-live'); },
    native: async () => state.native,
    installNative: async name => { assert.equal(name, user.username); calls.push('native'); state.native = { enrolled: true }; },
    publish: async value => { calls.push('receipt'); state.receipt = value; },
    ...change,
  };
  return { effects, calls, state };
}

test('USB first boot refuses unsupported hosts, ambiguous live boots and inherited live users', async () => {
  requireBootAuthority({ platform: 'linux', arch: 'x64', uid: 0 });
  for (const change of [{ platform: 'darwin' }, { platform: 'win32' }, { arch: 'arm64' }, { uid: 1000 }, { uid: undefined }]) assert.throws(() => requireBootAuthority({ platform: 'linux', arch: 'x64', uid: 0, ...change }));
  assert.equal(bootMode('boot=live quiet nopersistence', directory()), 'live');
  assert.equal(bootMode('quiet', null), 'installed');
  for (const [cmdline, medium] of [['boot=live', null], ['quiet', directory()], ['boot=live', directory({ uid: 1000 })], ['boot=live', directory({ isSymbolicLink: () => true })]]) assert.throws(() => bootMode(cmdline, medium));
  assert.throws(() => validateFirstbootUser({ ...user, uid: 1001 }, 'installed'));
  assert.throws(() => validateFirstbootUser({ ...user, username: 'kidos-live', homedir: '/home/kidos-live' }, 'installed'));
  assert.throws(() => validateFirstbootUser(user, 'live'));
  validateFirstbootUser({ ...user, username: 'kidos-live', homedir: '/home/kidos-live' }, 'live');
  await assert.rejects(main(['--target-root', '/tmp/example']), /no arguments/);
});

test('USB source is protected before any imported application code can execute', async () => {
  const options = { inspect: async path => path.endsWith('entry.mjs') ? file() : directory(), children: async path => path === SOURCE ? ['entry.mjs'] : [], canonical: async path => path };
  await protectedSource(SOURCE, options);
  for (const bad of [{ uid: 1000 }, { mode: 0o666 }, { nlink: 2 }, { size: 4 * 1024 * 1024 + 1 }, { isSymbolicLink: () => true }, { isFile: () => false }]) await assert.rejects(protectedSource(SOURCE, { ...options, inspect: async path => path.endsWith('entry.mjs') ? file(bad) : directory() }));
  await assert.rejects(protectedSource('/tmp/source', options), /fixed/);
  await assert.rejects(protectedSource(SOURCE, { ...options, children: async () => ['../escape'] }), /Unexpected/);
  await assert.rejects(protectedSource(SOURCE, { ...options, canonical: async () => '/different' }), /protected/);
  await assert.rejects(protectedSource(SOURCE, { ...options, inspect: async path => path === '/opt' ? directory({ mode: 0o777 }) : path.endsWith('entry.mjs') ? file() : directory() }), /protected/);
});

test('USB first boot generates service/native enrollments on the real boot and leaves repeats intact', async () => {
  const { effects, calls, state } = fixture();
  const first = await prepareFirstBoot(effects);
  assert.equal(first.alreadyPrepared, false);
  assert.deepEqual(calls, ['target', 'service', 'native', 'user-setup', 'receipt']);
  assert.deepEqual(state.receipt.user, user);
  calls.length = 0;
  assert.equal((await prepareFirstBoot(effects)).alreadyPrepared, true);
  assert.deepEqual(calls, ['target', 'validate', 'user-setup']);
});

test('firstboot accepts the distinct receipt shapes actually written by installLive and rejects staging or changed runtime facts', () => {
  // These are installLive's exact two publication shapes, including its target
  // facts and the absence of stageOnly on install-receipt.json.runtime.
  const runtimeFacts = { targetKind: 'linux-pc', arch: 'x64', osRelease: 'ID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n', nodeVersion: PC_NODE.version, executable: PC_NODE.executable, archiveSha256: PC_NODE.archiveSha256, nodeSha256: 'b'.repeat(64) };
  const receipt = { release: release.id, previousRelease: null, installedAt: '2026-10-15T00:00:00.000Z', runtime: runtimeFacts };
  const runtime = { ...runtimeFacts, stageOnly: false };
  validateServiceReceipts(receipt, runtime, release);
  validateRuntime(runtime, { platform: 'linux', arch: 'x64', executable: PC_NODE.executable, version: PC_NODE.version, sha256: runtimeFacts.nodeSha256 });
  // JSON key order carries no meaning; the complete facts still must match.
  validateServiceReceipts(receipt, { stageOnly: false, ...runtimeFacts }, release);
  for (const stageOnly of [true, false]) assert.throws(() => validateServiceReceipts({ ...receipt, runtime: { ...runtimeFacts, stageOnly } }, runtime, release), /disagree/);
  for (const change of [{ stageOnly: true }, { stageOnly: undefined }, { executable: '/usr/bin/node' }, { arch: 'arm64' }, { nodeSha256: 'c'.repeat(64) }, { extra: true }]) assert.throws(() => validateServiceReceipts(receipt, { ...runtime, ...change }, release), /disagree/);
  assert.throws(() => validateServiceReceipts({ ...receipt, release: 'other' }, runtime, release), /differs/);
});

test('interrupted first boot resumes without overwriting a verified existing service or its data', async () => {
  const { effects, calls, state } = fixture();
  state.service = { release: release.id };
  await prepareFirstBoot(effects);
  assert.deepEqual(calls, ['target', 'validate', 'native', 'user-setup', 'receipt']);
  const failed = fixture({ installNative: async () => { throw new Error('package unavailable'); } });
  await assert.rejects(prepareFirstBoot(failed.effects), /package unavailable/);
  assert.equal(failed.state.receipt, null);
  assert.deepEqual(failed.calls, ['target', 'service']);
});

test('temporary live accounts lose the distro default password; installed credentials are untouched', async () => {
  const { effects, calls } = fixture({ cmdline: async () => 'boot=live nopersistence', medium: async () => directory(), user: async () => ({ ...user, username: 'kidos-live', homedir: '/home/kidos-live' }), installNative: async name => { assert.equal(name, 'kidos-live'); calls.push('native'); } });
  await prepareFirstBoot(effects);
  assert.deepEqual(calls, ['target', 'lock-live', 'service', 'native', 'user-setup', 'live-lock', 'live-wallet', 'plasma-live', 'receipt']);
  const failed = fixture({ cmdline: async () => 'boot=live', medium: async () => directory(), user: async () => ({ ...user, username: 'kidos-live', homedir: '/home/kidos-live' }), lockLiveAccount: async () => { throw new Error('root is unlocked'); } });
  await assert.rejects(prepareFirstBoot(failed.effects), /root is unlocked/);
  assert.deepEqual(failed.calls, ['target']);
});

test('USB mismatched receipts, sources, users and missing enrolled components fail before repair writes', async () => {
  const expected = { format: 1, mode: 'installed', release: release.id, sourceDigest: release.contentDigest, user };
  for (const change of [{ format: 2 }, { mode: 'live' }, { release: 'other' }, { sourceDigest: 'b'.repeat(64) }, { user: { ...user, uid: 1001 } }, { stageOnly: true }]) {
    assert.throws(() => validateFirstbootReceipt({ ...expected, ...change }, expected));
    const { effects, calls, state } = fixture(); state.receipt = { ...expected, ...change };
    await assert.rejects(prepareFirstBoot(effects), /differs/);
    assert.deepEqual(calls, ['target']);
  }
  const missingService = fixture(); missingService.state.receipt = expected;
  await assert.rejects(prepareFirstBoot(missingService.effects), /without its service/);
  assert.deepEqual(missingService.calls, ['target']);
  const missingNative = fixture(); missingNative.state.receipt = expected; missingNative.state.service = { release: release.id };
  await assert.rejects(prepareFirstBoot(missingNative.effects), /without its native/);
  assert.deepEqual(missingNative.calls, ['target', 'validate']);
  const badService = fixture({ validateInstalled: async () => { throw new Error('staging runtime'); } }); badService.state.service = { release: release.id };
  await assert.rejects(prepareFirstBoot(badService.effects), /staging runtime/);
  assert.deepEqual(badService.calls, ['target']);
});

test('firstboot unit waits for live-config and completes before desktop login, without enabling autologin itself', async () => {
  const text = await readFile(new URL('../../os/live-usb/firstboot.service', import.meta.url), 'utf8');
  assert.match(text, /After=local-fs.target live-config.service/);
  assert.match(text, /Before=display-manager.service/);
  assert.match(text, /ExecStart=\/opt\/kidos-node\/v24\.21\.0\/bin\/node \/opt\/kidos-usb\/firstboot.mjs/);
  assert.match(text, /^UMask=0022$/m);
  assert.doesNotMatch(text, /DefaultDependencies=no|autologin|password|--force|--target-root/);
});

test('bootstrap umask leaves published code traversable while explicitly private service data stays private', async t => {
  const unit = await readFile(new URL('../../os/live-usb/firstboot.service', import.meta.url), 'utf8');
  const mask = Number.parseInt(unit.match(/^UMask=([0-7]{4})$/m)?.[1], 8);
  assert.equal(mask, 0o022);
  const directory = await mkdtemp(join(tmpdir(), 'kidos-usb-permissions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source'), target = join(directory, 'stage');
  const release = await collectRelease(root, '0.0.1-pilot.19');
  for (const entry of release.files) {
    const path = join(source, entry.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.bytes);
  }
  await writeFile(join(source, 'RELEASE.json'), json(release.manifest));
  const installer = new URL('../../os/raspberry-pi/install-core.mjs', import.meta.url).href;
  // Apply the unit's real mask in a child; the parent test process keeps its
  // own permissions. Staging exercises the shared install directory writer.
  execFileSync(process.execPath, ['--input-type=module', '-e', `process.umask(${mask}); const {stageRelease}=await import(${JSON.stringify(installer)}); await stageRelease(${JSON.stringify(source)},${JSON.stringify(target)},${JSON.stringify(PC_NODE.version)},'x64');`], { stdio: 'pipe' });
  const releasePath = `opt/kidos/releases/${release.manifest.version}-${release.manifest.contentDigest.slice(0, 12)}`;
  for (const path of ['opt', 'opt/kidos', 'opt/kidos/releases', releasePath, `${releasePath}/services`, `${releasePath}/services/platform`]) assert.equal((await stat(join(target, path))).mode & 0o777, 0o755, path);
  assert.equal((await stat(join(target, `${releasePath}/services/platform/server.mjs`))).mode & 0o777, 0o644);
  assert.equal((await stat(join(target, 'var/lib/kidos'))).mode & 0o777, 0o700);
});

test('real firstboot CLI rejects the development host before source or target reads', { skip: process.platform === 'linux' && process.arch === 'x64' && process.getuid?.() === 0 }, () => {
  assert.throws(() => execFileSync(process.execPath, [`${root}/os/live-usb/firstboot.mjs`], { encoding: 'utf8', stdio: 'pipe' }), error => { assert.match(error.stderr, /requires root/); assert.doesNotMatch(error.stderr, /ENOENT/); return true; });
});


test('live-config highest-precedence root config selects installed Plasma Wayland without changing users or accepting extra settings', () => {
  const upstream = '[Autologin]\nUser=kidos-live\nSession=lxqt.desktop\n';
  const expected = '[Autologin]\nUser=kidos-live\nSession=plasma.desktop\n';
  assert.equal(livePlasmaConfiguration(upstream), expected);
  assert.equal(livePlasmaConfiguration(expected), expected);
  for (const changed of [upstream.replace('kidos-live', 'casey'), upstream.replace('lxqt.desktop', 'plasmax11.desktop'), upstream+'Relogin=true\n', upstream.replace('\nUser=', '\n[General]\nUser='), upstream.replace('lxqt.desktop', '/tmp/session.desktop'), upstream.replace('User=kidos-live\n', ''), upstream.replace('Session=', 'Session ='), upstream+'[Autologin]\nUser=root\n']) assert.throws(() => livePlasmaConfiguration(changed), /Unexpected/);
});

test('live session selection follows successful enrollment on each restart and installed boots do not change their login policy', async () => {
  const liveUser = { ...user, username: 'kidos-live', homedir: '/home/kidos-live' };
  const live = fixture({ cmdline: async () => 'boot=live', medium: async () => directory(), user: async () => liveUser, installNative: async name => { assert.equal(name, 'kidos-live'); live.calls.push('native'); live.state.native = { enrolled: true }; } });
  await prepareFirstBoot(live.effects);
  assert.deepEqual(live.calls, ['target', 'lock-live', 'service', 'native', 'user-setup', 'live-lock', 'live-wallet', 'plasma-live', 'receipt']);
  live.calls.length = 0;
  await prepareFirstBoot(live.effects);
  assert.deepEqual(live.calls, ['target', 'validate', 'lock-live', 'user-setup', 'live-lock', 'live-wallet', 'plasma-live']);
  const installed = fixture({ selectLiveSession: async () => { throw new Error('installed login policy touched'); } });
  await prepareFirstBoot(installed.effects);
  assert.deepEqual(installed.calls, ['target', 'service', 'native', 'user-setup', 'receipt']);
  const failed = fixture({ cmdline: async () => 'boot=live', medium: async () => directory(), user: async () => liveUser, installNative: async () => { throw new Error('enrollment failed'); } });
  await assert.rejects(prepareFirstBoot(failed.effects), /enrollment failed/);
  assert.deepEqual(failed.calls, ['target', 'lock-live', 'service']);
  assert.equal(failed.state.receipt, null);
});


test('pre-desktop filesystem setup drops to the enrolled ordinary identity through fixed runuser argv', () => {
  const command = nativeUserSetupCommand(user);
  assert.deepEqual(command, { executable: '/usr/sbin/runuser', args: ['-u', 'casey', '--', '/opt/kidos-node/v24.21.0/bin/node', '/opt/kidos-native-session/native-launch.mjs', '--setup-user'] });
  for (const change of [{ uid: 0 }, { uid: 1001 }, { gid: 0 }, { username: 'root' }, { username: 'casey;id' }, { username: '--preserve-environment' }, { homedir: '/root' }]) assert.throws(() => nativeUserSetupCommand({ ...user, ...change }), /ordinary/);
  assert.doesNotMatch(JSON.stringify(command), /shell|preserve-environment|--login|chmod|chown|--force/);
});

test('user setup failures retain prior native content and prevent session selection or firstboot receipt', async () => {
  const failed = fixture({ setupNativeUser: async () => { throw new Error('unsafe inherited .local mode'); } });
  await assert.rejects(prepareFirstBoot(failed.effects), /unsafe inherited/);
  assert.deepEqual(failed.calls, ['target', 'service', 'native']);
  assert.equal(failed.state.receipt, null);
  const liveUser = { ...user, username: 'kidos-live', homedir: '/home/kidos-live' };
  const lockFailed = fixture({ cmdline: async () => 'boot=live', medium: async () => directory(), user: async () => liveUser, installNative: async () => { lockFailed.calls.push('native'); }, configureLiveScreenLock: async () => { throw new Error('live lock policy unavailable'); } });
  await assert.rejects(prepareFirstBoot(lockFailed.effects), /live lock policy unavailable/);
  assert.deepEqual(lockFailed.calls, ['target', 'lock-live', 'service', 'native', 'user-setup']);
  assert.equal(lockFailed.state.receipt, null);
});

test('automatic screen lock settings target only the temporary live home and keep normal installed password policy', () => {
  const liveUser = { ...user, username: 'kidos-live', homedir: '/home/kidos-live' };
  const commands = liveScreenLockCommands(liveUser);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands.map(c => c.args), ['Autolock', 'LockOnResume'].map(key => ['-u', 'kidos-live', '--', '/usr/bin/kwriteconfig6', '--file', '/home/kidos-live/.config/kscreenlockerrc', '--group', 'Daemon', '--key', key, '--type', 'bool', 'false']));
  assert.ok(commands.every(c => c.executable === '/usr/sbin/runuser'));
  assert.deepEqual(liveScreenLockCommands(liveUser, true)[0].args.slice(-2), ['--default', 'true']);
  assert.throws(() => liveScreenLockCommands(user), /fresh desktop/);
  assert.throws(() => liveScreenLockCommands({ ...liveUser, uid: 0 }), /fresh desktop/);
  for (const stat of [directory({ uid: 1000 }), directory({ uid: 1000, mode: 0o700 })]) validateLiveUserPath(stat, liveUser);
  validateLiveUserPath(file({ uid: 1000 }), liveUser, true);
  for (const change of [{ uid: 0 }, { mode: 0o775 }, { isSymbolicLink: () => true }, { isDirectory: () => false }]) assert.throws(() => validateLiveUserPath(directory({ uid: 1000, ...change }), liveUser), /Unsafe/);
  for (const change of [{ uid: 0 }, { mode: 0o664 }, { nlink: 2 }, { size: 64 * 1024 + 1 }, { isSymbolicLink: () => true }]) assert.throws(() => validateLiveUserPath(file({ uid: 1000, ...change }), liveUser, true), /Unsafe/);
});


test('pre-desktop user setup creates safe ancestors before desktop umask and preserves existing preferences and unsafe modes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'kidos-user-prewarm-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'fresh'), unsafeHome = join(root, 'unsafe');
  await mkdir(home, { mode: 0o700 }); await mkdir(unsafeHome, { mode: 0o700 });
  const module = new URL('../../os/native-session/native-launch.mjs', import.meta.url).href;
  const script = `process.umask(0o002); const {prepareNativeFiles}=await import(${JSON.stringify(module)}); const fs=await import('node:fs/promises'); const home=${JSON.stringify(home)}, unsafeHome=${JSON.stringify(unsafeHome)}, uid=process.getuid(); await prepareNativeFiles(home,uid); const pref=home+'/.local/share/kidos-native/config/mimeapps.list'; await fs.writeFile(pref,'existing user preference\\n'); await fs.mkdir(home+'/.local/share',{recursive:true,mode:0o777}); await prepareNativeFiles(home,uid); await fs.mkdir(unsafeHome+'/.local',{mode:0o775}); await fs.chmod(unsafeHome+'/.local',0o775); let refused=false; try{await prepareNativeFiles(unsafeHome,uid);}catch(e){refused=/unsafe native user directory/.test(e.message);} console.log(JSON.stringify({localMode:(await fs.stat(home+'/.local')).mode&0o777,shareMode:(await fs.stat(home+'/.local/share')).mode&0o777,preference:await fs.readFile(pref,'utf8'),refused,unsafeMode:(await fs.stat(unsafeHome+'/.local')).mode&0o777}));`;
  const facts = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.deepEqual(facts, { localMode: 0o700, shareMode: 0o700, preference: 'existing user preference\n', refused: true, unsafeMode: 0o775 });
});


test('wallet prompts are disabled only for the password-locked live trial before desktop login', async () => {
  const liveUser = { ...user, username: 'kidos-live', homedir: '/home/kidos-live' };
  assert.deepEqual(liveWalletCommands(liveUser), [{ executable: '/usr/sbin/runuser', args: ['-u', 'kidos-live', '--', '/usr/bin/kwriteconfig6', '--file', '/home/kidos-live/.config/kwalletrc', '--group', 'Wallet', '--key', 'Enabled', '--type', 'bool', 'false'] }]);
  assert.deepEqual(liveWalletCommands(liveUser, true)[0].args.slice(-2), ['--default', 'true']);
  assert.throws(() => liveWalletCommands(user), /fresh desktop/);
  assert.throws(() => liveWalletCommands({ ...liveUser, uid: 0 }), /fresh desktop/);
  const installed = fixture({ configureLiveWallet: async () => { throw new Error('installed wallet policy touched'); } });
  await prepareFirstBoot(installed.effects);
  assert.deepEqual(installed.calls, ['target', 'service', 'native', 'user-setup', 'receipt']);
  const failed = fixture({ cmdline: async () => 'boot=live', medium: async () => directory(), user: async () => liveUser, installNative: async () => { failed.calls.push('native'); }, configureLiveWallet: async () => { throw new Error('wallet policy readback differs'); } });
  await assert.rejects(prepareFirstBoot(failed.effects), /wallet policy readback differs/);
  assert.deepEqual(failed.calls, ['target', 'lock-live', 'service', 'native', 'user-setup', 'live-lock']);
  assert.equal(failed.state.receipt, null);
});
