import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { collectRelease, makeTar, hash, json, releaseId, verifyRelease } from '../../os/raspberry-pi/release.mjs';
import { parseOptions, runtimeVersion, stageRelease } from '../../os/raspberry-pi/install.mjs';
import { autostartText } from '../../os/raspberry-pi/kiosk.mjs';
import { chromiumArguments } from '../../os/raspberry-pi/kiosk-core.mjs';
import { PILOT_NODE } from '../../os/raspberry-pi/runtime-pin.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kidos-pi-pilot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'source'); await mkdir(source);
  const release = await collectRelease(repository, '0.0.1-pilot.1');
  for (const { path, bytes } of release.files) {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), bytes);
  }
  await writeFile(join(source, 'RELEASE.json'), json(release.manifest));
  return { directory, source, release };
}
function tarEntries(bytes) {
  const entries = [];
  for (let offset = 0; bytes[offset];) {
    const header = bytes.subarray(offset, offset + 512);
    const read = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/, '');
    const size = parseInt(read(124, 12), 8), path = read(0, 100);
    const expectedChecksum = parseInt(read(148, 8), 8), check = Buffer.from(header); check.fill(32, 148, 156);
    assert.equal(check.reduce((sum, byte) => sum + byte, 0), expectedChecksum);
    entries.push({ path, size, type: read(156, 1), mode: parseInt(read(100, 8), 8), mtime: parseInt(read(136, 12), 8), bytes: bytes.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test('pilot archive is deterministic and contains only the exact source allowlist', async t => {
  const f = await fixture(t), before = makeTar(await collectRelease(f.source, '0.0.1-pilot.1'));
  for (const path of ['.data', 'work', '.git', '.env', 'apps/desktop/accidental-family.txt']) {
    const destination = join(f.source, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, 'FAMILY-SECRET-MUST-NOT-SHIP');
  }
  await chmod(join(f.source, 'package.json'), 0o600);
  await utimes(join(f.source, 'package.json'), new Date(0), new Date(999999));
  const after = makeTar(await collectRelease(f.source, '0.0.1-pilot.1'));
  assert.deepEqual(before, after);
  assert.equal(after.includes(Buffer.from('FAMILY-SECRET-MUST-NOT-SHIP')), false);
  const entries = tarEntries(after);
  assert.deepEqual(entries.map(entry => entry.path).sort(), [...f.release.files.map(entry => entry.path), 'RELEASE.json'].sort());
  for (const entry of entries) {
    assert.equal(entry.type, '0'); assert.equal(entry.mode, 0o644); assert.equal(entry.mtime, 0);
    if (entry.path !== 'RELEASE.json') assert.equal(hash(entry.bytes), f.release.manifest.files.find(file => file.path === entry.path).sha256);
  }
});

test('staging installs verified code and a private empty data directory without host service actions', async t => {
  const f = await fixture(t), target = join(f.directory, 'stage');
  const result = await stageRelease(f.source, target);
  const id = releaseId(f.release.manifest), installed = join(target, 'opt/kidos/releases', id);
  assert.equal(result.staged, true);
  assert.equal(await readlink(join(target, 'opt/kidos/current')), `releases/${id}`);
  assert.deepEqual((await verifyRelease(installed)).manifest, f.release.manifest);
  assert.deepEqual(await readdir(join(target, 'var/lib/kidos')), []);
  assert.equal((await lstat(join(target, 'var/lib/kidos'))).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(await readFile(join(target, 'opt/kidos/runtime.json'))), {
    nodeVersion: PILOT_NODE.version, executable: PILOT_NODE.executable, archiveSha256: PILOT_NODE.archiveSha256, stageOnly: true,
  });
  assert.equal(hash(await readFile(join(target, 'etc/systemd/system/kidos.service'))), f.release.manifest.files.find(file => file.path === 'os/raspberry-pi/kidos.service').sha256);
  assert.match(await readFile(join(target, 'STAGING-ONLY.txt'), 'utf8'), /No service account was created/);
  assert.equal(typeof (await import(pathToFileURL(join(installed, 'services/platform/server.mjs')))).startKidOS, 'function');
  assert.equal(typeof (await import(pathToFileURL(join(installed, 'os/raspberry-pi/kiosk.mjs')))).main, 'function');
  assert.equal(typeof (await import(pathToFileURL(join(installed, 'os/raspberry-pi/native-packages.mjs')))).main, 'function');
  // Rehearse the exact installed symlink path, not the checkout. This catches
  // missing native modules and entry-point guards that silently skip setup.
  const nativeStage = join(f.directory, 'native-stage');
  const nativeResult = JSON.parse(execFileSync(process.execPath, [join(target, 'opt/kidos/current/os/native-session/install-pi.mjs'), '--stage', nativeStage], { encoding: 'utf8' }));
  assert.equal(nativeResult.staged, true);
  assert.equal(nativeResult.installable, false);
  assert.match(await readFile(join(nativeStage, 'STAGING-ONLY.txt'), 'utf8'), /not a live Pi registration/);
  assert.equal(f.release.files.some(file => file.path.startsWith('os/linux-test/') || file.path === 'os/native-session/install-vm.mjs'), false);
  const before = await readFile(join(target, 'opt/kidos/runtime.json'));
  await assert.rejects(stageRelease(f.source, target), /empty ordinary directory/);
  assert.deepEqual(await readFile(join(target, 'opt/kidos/runtime.json')), before);
});

test('modified release bytes and manifest traversal fail before creating a staging tree', async t => {
  const f = await fixture(t), target = join(f.directory, 'stage');
  await writeFile(join(f.source, 'apps/desktop/index.html'), '<script>unexpected change</script>');
  await assert.rejects(stageRelease(f.source, target), /verification failed/);
  await assert.rejects(lstat(target), { code: 'ENOENT' });
  const manifest = structuredClone(f.release.manifest); manifest.files[0].path = '../../outside';
  await writeFile(join(f.source, 'RELEASE.json'), json(manifest));
  await assert.rejects(stageRelease(f.source, target), /verification failed/);
  await assert.rejects(lstat(target), { code: 'ENOENT' });
});

test('release collection rejects symlinked inputs and unsafe allowlist paths', async t => {
  const f = await fixture(t), target = join(f.source, 'apps/desktop/index.html');
  await rm(target); await symlink(join(f.source, 'README.md'), target);
  await assert.rejects(collectRelease(f.source, '0.0.1-pilot.1'), /ordinary files without links/);
  const paths = JSON.parse(await readFile(join(f.source, 'os/raspberry-pi/source-files.json')));
  paths.push('.data/family.json');
  await writeFile(join(f.source, 'os/raspberry-pi/source-files.json'), json(paths));
  await assert.rejects(collectRelease(f.source, '0.0.1-pilot.1'), /Unsafe release path/);
});

test('installer requires an explicit target and refuses linked or nonempty staging targets', async t => {
  for (const args of [[], ['--target-root'], ['--install-on-this-pi', '--target-root', '/'], ['--yes']]) assert.throws(() => parseOptions(args), /Choose exactly one/);
  assert.deepEqual(parseOptions(['--install-on-this-pi']), { targetRoot: '/', live: true });
  assert.equal(runtimeVersion(PILOT_NODE.version), PILOT_NODE.version);
  for (const version of ['v20.20.0', 'v22.22.3', 'v24.20.0', 'v26.0.0', 'v24.21.0; anything']) assert.throws(() => runtimeVersion(version), /pinned Node/);
  const f = await fixture(t), destination = join(f.directory, 'target'), link = join(f.directory, 'linked-target');
  await mkdir(destination); await symlink(destination, link);
  await assert.rejects(stageRelease(f.source, '/'), /never \//);
  await assert.rejects(stageRelease(f.source, link), /empty ordinary directory/);
  await writeFile(join(destination, 'keep.txt'), 'Keep this');
  await assert.rejects(stageRelease(f.source, destination), /empty ordinary directory/);
  assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'Keep this');
});

test('live install refuses this non-Pi development host before installing', { skip: process.platform === 'linux' && process.arch === 'arm64' }, async t => {
  const f = await fixture(t);
  assert.throws(() => execFileSync(process.execPath, [join(f.source, 'os/raspberry-pi/install.mjs'), '--install-on-this-pi'], { encoding: 'utf8', stdio: 'pipe' }), error => {
    assert.match(error.stderr, /Live install requires root on Linux ARM64 Raspberry Pi hardware/); return true;
  });
});

test('kiosk autostart is opt-in, idempotent, and preserves unrelated desktop startup commands', () => {
  const original = '# Existing desktop preferences\nwaybar &\n';
  const enabled = autostartText(original, true);
  assert.equal(autostartText(enabled, true), enabled);
  assert.equal(autostartText(enabled, false), original);
  assert.equal(autostartText(original, false), original);
  assert.ok(enabled.includes(`${PILOT_NODE.executable} /opt/kidos/current/os/raspberry-pi/kiosk.mjs --launch &`));
  assert.throws(() => autostartText('# BEGIN kidOS supervised pilot\n', true), /malformed/);
});

test('pilot service separates code and state and keeps the browser sandbox enabled', async () => {
  const unit = await readFile(resolve(repository, 'os/raspberry-pi/kidos.service'), 'utf8');
  for (const value of ['User=kidos', 'Group=kidos', 'StateDirectoryMode=0700', 'NoNewPrivileges=true', 'ProtectSystem=strict', 'ProtectHome=true', 'KIDOS_DATA_DIR=/var/lib/kidos']) assert.ok(unit.includes(value), value);
  assert.ok(unit.includes(`ExecStart=${PILOT_NODE.executable} /opt/kidos/current/services/platform/server.mjs`));
  assert.ok(unit.includes(`ExecStartPre=${PILOT_NODE.executable} /opt/kidos/current/os/raspberry-pi/check-runtime.mjs`));
  assert.doesNotMatch(unit, /User=root|PrivateNetwork=true/);
  const args = chromiumArguments('/ordinary/browser');
  assert.deepEqual(args, chromiumArguments('/ordinary/browser', false));
  assert.equal(args[0], '--user-data-dir=/ordinary/browser');
  assert.equal(args.at(-1), 'http://127.0.0.1:8787/');
  assert.equal(args.some(arg => arg.startsWith('--load-extension')), false);
  const optedIn = chromiumArguments('/ordinary/browser', true);
  assert.deepEqual(optedIn.filter(arg => !arg.startsWith('--load-extension=')), args);
  assert.ok(optedIn.includes('--load-extension=/opt/kidos-native-session/extension'));
  for (const arg of optedIn) assert.doesNotMatch(arg, /no-sandbox|disable-web-security|disable-setuid-sandbox/);
  for (const value of ['yes', '/arbitrary/extension', 1, null]) assert.throws(() => chromiumArguments('/ordinary/browser', value), /explicit/);
});
