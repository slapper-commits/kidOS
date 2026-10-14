import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseOptions as installOptions } from '../../os/linux-test/install.mjs';
import { parseOptions as kioskOptions, autostartEntry, checkNativeImportFiles } from '../../os/linux-test/kiosk.mjs';
import { checkVmId, validateVmFacts, validateMarker, validateProtectedFile, validateReceipt } from '../../os/linux-test/target.mjs';
import { installLive } from '../../os/raspberry-pi/install-core.mjs';
import { runKiosk, autostartText } from '../../os/raspberry-pi/kiosk-core.mjs';
import { collectRelease } from '../../os/raspberry-pi/release.mjs';
import { PILOT_NODE } from '../../os/raspberry-pi/runtime-pin.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const vmId = '942d9f36-9359-4e3d-89bb-dd2b6a053fe6';
const facts = { platform: 'linux', arch: 'arm64', uid: 0, osRelease: 'ID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n', virtualization: 'qemu' };
const marker = { format: 1, vmId, disposable: true };
const file = { isFile: () => true, isSymbolicLink: () => false, uid: 0, nlink: 1, mode: 0o100600, size: 96 };

test('VM commands require both explicit extracted release and canonical disposable UUID', () => {
  assert.deepEqual(installOptions(['--release-root', '/tmp/pilot', '--disposable-vm-id', vmId]), { releaseRoot: '/tmp/pilot', vmId });
  for (const args of [[], ['--install-on-this-pi'], ['--release-root', '/tmp/pilot'], ['--release-root', '/tmp/pilot', '--disposable-vm-id', vmId, '--force']]) assert.throws(() => installOptions(args), /Choose/);
  for (const value of [undefined, '', '../../device', `${vmId}\n`, `${vmId}; touch /tmp/unsafe`, vmId.toUpperCase()]) assert.throws(() => checkVmId(value), /UUID/);
  for (const action of ['--launch', '--enable-autostart', '--disable-autostart']) assert.deepEqual(kioskOptions([action, '--disposable-vm-id', vmId]), { action, vmId });
  for (const args of [[], ['--launch'], ['--launch', '--disposable-vm-id', vmId, '--no-sandbox']]) assert.throws(() => kioskOptions(args), /Choose/);
});

test('VM guard rejects physical hosts, containers, other operating systems and wrong privilege', () => {
  validateVmFacts(facts, true);
  validateVmFacts({ ...facts, virtualization: 'kvm', uid: 1000 }, false);
  for (const change of [{ platform: 'darwin' }, { arch: 'x64' }, { uid: 1000 }, { virtualization: 'none' }, { virtualization: 'docker' }, { virtualization: 'apple' }, { osRelease: 'ID=raspbian\nVERSION_ID=13\nVERSION_CODENAME=trixie\n' }, { osRelease: facts.osRelease.replace('13', '12') }, { osRelease: facts.osRelease.replace('trixie', 'bookworm') }]) assert.throws(() => validateVmFacts({ ...facts, ...change }, true));
  for (const uid of [0, 999, undefined]) assert.throws(() => validateVmFacts({ ...facts, uid }, false), /ordinary/);
});

test('VM designation requires exact marker contents and root-only ordinary marker file', () => {
  validateMarker(marker, vmId);
  validateProtectedFile(file, true, 'marker');
  for (const invalid of [null, [], { ...marker, disposable: false }, { ...marker, format: 2 }, { ...marker, vmId: '01234567-89ab-cdef-0123-456789abcdef' }, { ...marker, extra: true }]) assert.throws(() => validateMarker(invalid, vmId), /marker/);
  for (const change of [{ uid: 1000 }, { mode: 0o100644 }, { mode: 0o100660 }, { mode: 0o104600 }, { nlink: 2 }, { size: 1025 }, { isFile: () => false }, { isSymbolicLink: () => true }]) assert.throws(() => validateProtectedFile({ ...file, ...change }, true, 'marker'), /unsafe/);
});

test('ordinary kiosk requires protected receipt attesting its exact VM identity', () => {
  const receipt = { release: '0.0.1-pilot.1-abcdef012345', runtime: { targetKind: 'disposable-linux-vm', vmId, virtualization: 'qemu' } };
  validateReceipt(receipt, vmId, 'qemu');
  validateProtectedFile({ ...file, mode: 0o100644 }, false, 'receipt');
  for (const runtime of [{ ...receipt.runtime, targetKind: 'raspberry-pi' }, { ...receipt.runtime, vmId: '01234567-89ab-cdef-0123-456789abcdef' }, { ...receipt.runtime, virtualization: 'kvm' }, {}]) assert.throws(() => validateReceipt({ ...receipt, runtime }, vmId, 'qemu'), /receipt/);
  assert.throws(() => validateReceipt({ ...receipt, release: '../unexpected' }, vmId, 'qemu'), /receipt/);
  for (const change of [{ uid: 1000 }, { mode: 0o100664 }, { isSymbolicLink: () => true }, { nlink: 2 }, { size: 128 * 1024 + 1 }]) assert.throws(() => validateProtectedFile({ ...file, ...change }, false, 'receipt'), /unsafe/);
});

test('VM autostart uses fixed external wrapper, is reversible and cannot contain shell arguments from an ID', () => {
  const entry = autostartEntry(PILOT_NODE.executable, vmId), original = '# Existing setup\nwaybar &\n';
  assert.equal(entry, `${PILOT_NODE.executable} /opt/kidos-linux-test/kiosk.mjs --launch --disposable-vm-id ${vmId} &`);
  const enabled = autostartText(original, true, entry);
  assert.equal(autostartText(enabled, true, entry), enabled);
  assert.equal(autostartText(enabled, false, entry), original);
  assert.throws(() => autostartEntry(PILOT_NODE.executable, `${vmId};whoami`), /UUID/);
  assert.throws(() => autostartEntry('/usr/bin/node;whoami', vmId), /pinned/);
  assert.throws(() => autostartText('', true, 'first\nsecond'), /single/);
});

test('Pi archive includes shared cores but no VM-specific guard or wrapper', async () => {
  const release = await collectRelease(repository, '0.0.1-pilot.1');
  const paths = release.files.map(file => file.path);
  assert.ok(paths.includes('os/raspberry-pi/install-core.mjs'));
  assert.ok(paths.includes('os/raspberry-pi/kiosk-core.mjs'));
  assert.equal(paths.some(path => path.startsWith('os/linux-test/')), false);
  const piInstall = await readFile(new URL('../../os/raspberry-pi/install.mjs', import.meta.url), 'utf8');
  assert.match(piInstall, /\/proc\/device-tree\/model/);
  assert.match(piInstall, /\/etc\/rpi-issue/);
  assert.doesNotMatch(piInstall, /disposable-vm-id|linux-test/);
});

test('VM kiosk protects new theme/target imports before execution while accepting the old import closure', async () => {
  const seen = [];
  const inspect = async path => { seen.push(path); return { isDirectory: () => !path.endsWith('.mjs'), isFile: () => path.endsWith('.mjs'), isSymbolicLink: () => false, uid: 0, mode: 0o755, nlink: 1, size: 2048 }; };
  await checkNativeImportFiles(inspect);
  for (const file of ['target.mjs', 'theme.mjs']) {
    assert.ok(seen.includes(`/opt/kidos-native-session/${file}`));
    for (const changed of [{ uid: 1000 }, { mode: 0o777 }, { isSymbolicLink: () => true }, { nlink: 2 }, { isFile: () => false }, { size: 1024 * 1024 }]) await assert.rejects(checkNativeImportFiles(async path => ({ ...await inspect(path), ...(path.endsWith(`/${file}`) ? changed : {}) })), /Unsafe/);
  }
  const absent = Object.assign(new Error('absent'), { code: 'ENOENT' });
  await checkNativeImportFiles(async path => { if (/\/(?:target|theme)\.mjs$/.test(path)) throw absent; return inspect(path); });
  await assert.rejects(checkNativeImportFiles(async path => { if (path.endsWith('/registration.mjs')) throw absent; return inspect(path); }), { code: 'ENOENT' });
  await assert.rejects(checkNativeImportFiles(async path => { if (path.endsWith('/theme.mjs')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return inspect(path); }), { code: 'EACCES' });
});

test('VM live entry points and shared privileged core reject the development host before mutation', { skip: process.platform === 'linux' && process.arch === 'arm64' }, async () => {
  for (const [file, args] of [['install.mjs', ['--release-root', '/does-not-exist', '--disposable-vm-id', vmId]], ['kiosk.mjs', ['--enable-autostart', '--disposable-vm-id', vmId]]]) {
    assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL(`../../os/linux-test/${file}`, import.meta.url)), ...args], { encoding: 'utf8', stdio: 'pipe' }), error => {
      assert.match(error.stderr, /requires (root on a disposable|an ordinary) Linux ARM64/);
      assert.doesNotMatch(error.stderr, /ENOENT/);
      return true;
    });
  }
  await assert.rejects(installLive('/does-not-exist', { targetKind: 'disposable-linux-vm' }), /requires root on Linux ARM64/);
  let targetCalled = false;
  await assert.rejects(runKiosk(['--enable-autostart'], { entry: 'unused', targetCheck: () => { targetCalled = true; } }), /ordinary desktop user/);
  assert.equal(targetCalled, false);
});

test('guest shell fixtures parse and refuse the development host before provisioning or login changes', { skip: process.platform === 'linux' && process.arch === 'arm64' }, () => {
  for (const file of ['provision-guest.sh', 'desktop-session.sh']) {
    const path = fileURLToPath(new URL(`../../os/linux-test/${file}`, import.meta.url));
    execFileSync('/bin/bash', ['-n', path], { stdio: 'pipe' });
    assert.throws(() => execFileSync('/bin/bash', [path], { encoding: 'utf8', stdio: 'pipe' }), error => {
      assert.match(error.stderr, /Use --disposable-vm-id/); return true;
    });
    for (const phase of file === 'provision-guest.sh' ? [[], ['--check-target'], ['--enable-desktop-session']] : [[]]) {
      assert.throws(() => execFileSync('/bin/bash', [path, '--disposable-vm-id', vmId, ...phase], { encoding: 'utf8', stdio: 'pipe' }), error => {
        assert.match(error.stderr, /requires (root on a disposable Linux ARM64 VM|its ordinary Linux ARM64 test user)/);
        assert.doesNotMatch(error.stdout, /Pinned Node verified|packages and pinned runtime|login and labwc/);
        return true;
      });
    }
  }
});
