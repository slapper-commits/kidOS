import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, cp, readFile, writeFile, readdir, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startKidOS } from './server.mjs';
import { NAMESPACE, assertReceiptOutsideData, loopbackOrigin, parseOptions, runVerification, syntheticFiles, syntheticMedia } from '../../os/linux-test/verify.mjs';
const vmId = '89f41525-9016-4829-83b3-4cd959c8423a';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kidos-linux-harness-'));
  let app;
  const dataDir = join(root, 'data'), stateFile = join(root, 'synthetic-receipt.json');
  t.after(async () => { if (app) await app.close(); await rm(root, { recursive: true, force: true }); });
  return {
    root, dataDir, stateFile,
    get app() { return app; },
    async start(directory = dataDir) { app = await startKidOS({ dataDir: directory, port: 0, runnerPort: 0 }); },
    async stop() { if (app) { await app.close(); app = null; } },
    async run(phase, extra = {}) { return runVerification({ phase, url: app.platformOrigin, stateFile, guardVM: false, ...extra }); },
  };
}
async function hashes(directory) {
  const result = {};
  async function visit(prefix = '') {
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      const relative = join(prefix, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else {
        assert.equal(entry.isFile(), true, `Only ordinary fixture files: ${relative}`);
        result[relative] = createHash('sha256').update(await readFile(join(directory, relative))).digest('hex');
      }
    }
  }
  await visit(); return result;
}
async function createProject(app, name) {
  const { token } = await (await fetch(`${app.platformOrigin}/api/session`)).json();
  const response = await fetch(`${app.platformOrigin}/api/projects`, { method: 'POST', headers: { 'X-KidOS-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  assert.equal(response.status, 201); return response.json();
}

test('Linux harness CLI accepts only explicit loopback scope and bounded phase options', () => {
  assert.deepEqual(parseOptions(['check', '--url', 'http://127.0.0.1:8787/', '--state-file', '/tmp/synthetic.json', '--label', 'after reboot', '--require-new-boot', '--disposable-vm-id', vmId]), { phase: 'check', url: 'http://127.0.0.1:8787', stateFile: '/tmp/synthetic.json', label: 'after reboot', requireNewBoot: true, vmId });
  for (const url of ['https://127.0.0.1:8787', 'http://localhost:8787', 'http://192.168.1.2:8787', 'http://127.0.0.1', 'http://user@127.0.0.1:8787', 'http://127.0.0.1:8787/api', 'http://127.0.0.1:8787/?x=1']) assert.throws(() => loopbackOrigin(url));
  const base = ['seed', '--url', 'http://127.0.0.1:8787', '--state-file', '/tmp/synthetic.json', '--disposable-vm-id', vmId];
  for (const args of [[...base, '--require-new-boot'], [...base, '--label', 'bad\nlabel'], [...base, '--url', 'http://127.0.0.1:8788'], [...base, '--unknown'], ['seed', '--url', 'http://127.0.0.1:8787', '--state-file', 'relative.json']]) assert.throws(() => parseOptions(args));
  assert.throws(() => parseOptions(base.slice(0, -2)), /disposable VM UUID/);
});

test('receipt cannot live in service data even through a symlinked ancestor', async t => {
  const f = await fixture(t); await mkdir(f.dataDir);
  const child = join(f.dataDir, 'subfolder'); await mkdir(child);
  const linked = join(f.root, 'alias'); await symlink(child, linked);
  await assertReceiptOutsideData(f.stateFile, f.dataDir);
  for (const path of [f.dataDir, join(f.dataDir, 'receipt.json'), join(child, 'receipt.json'), join(linked, 'receipt.json')]) await assert.rejects(assertReceiptOutsideData(path, f.dataDir), /outside the service data directory/);
});

test('synthetic API baseline survives service restart and detects mutation before exact stopped-data backup restore', { timeout: 30000 }, async t => {
  const f = await fixture(t); await f.start();
  const seeded = await f.run('seed');
  assert.equal(seeded.namespace, NAMESPACE); assert.equal(seeded.result, 'passed');
  assert.match(seeded.environment.scope, /VM guard disabled/);
  const receiptBytes = await readFile(f.stateFile), receipt = JSON.parse(receiptBytes);
  const { token } = await (await fetch(`${f.app.platformOrigin}/api/session`)).json();
  assert.equal(receiptBytes.includes(Buffer.from(token)), false);
  assert.equal((await stat(f.stateFile)).mode & 0o777, 0o600);
  assert.deepEqual(receipt.installedFiles, syntheticFiles(receipt.fixtureId));
  assert.equal(receipt.expected.catalogs.workspace.windows.at(-1).id, receipt.expected.catalogs.workspace.activeId, 'The active editor must be above the visible maximized app.');
  assert.equal(receipt.expected.catalogs.workspace.editorDraft.files['style.css'].includes('UNSAVED recovery'), true);
  assert.equal(receipt.expected.catalogs.games.find(game => game.id === 'moon-hopper').progress.best, 321);
  assert.deepEqual(receipt.expected.catalogs.media.map(item => item.progress.position).sort((a, b) => a - b), [0.375, 123]);
  await f.stop();
  const before = await hashes(f.dataDir), backupDir = join(f.root, 'backup'), restoreDir = join(f.root, 'restored');
  await cp(f.dataDir, backupDir, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(await hashes(backupDir), before);
  await f.start();
  const restarted = await f.run('check', { label: 'service restart' });
  assert.equal(restarted.baselineDigest, seeded.baselineDigest); assert.equal(restarted.label, 'service restart');
  await assert.rejects(f.run('check', { requireNewBoot: true }), /different Linux boot ID/);
  assert.equal((await f.run('mutate')).result, 'passed');
  assert.deepEqual(await readFile(f.stateFile), receiptBytes);
  await assert.rejects(f.run('check'), /differs from the synthetic baseline/);
  await assert.rejects(f.run('mutate'), /differs from the synthetic baseline/);
  await f.stop();
  assert.notDeepEqual(await hashes(f.dataDir), before);
  await cp(backupDir, restoreDir, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(await hashes(restoreDir), before);
  await f.start(restoreDir);
  const restored = await f.run('check', { label: 'backup restored' });
  assert.equal(restored.result, 'passed'); assert.equal(restored.baselineDigest, seeded.baselineDigest);
  await f.stop(); assert.deepEqual(await hashes(restoreDir), before);
});

test('seed refuses existing data and existing receipt without modifying either', async t => {
  const f = await fixture(t); await f.start();
  const initialState = await readFile(join(f.dataDir, 'state.json'));
  await writeFile(f.stateFile, 'existing receipt sentinel', { flag: 'wx' });
  await assert.rejects(f.run('seed'), /EEXIST/);
  assert.deepEqual(await readFile(join(f.dataDir, 'state.json')), initialState);
  await createProject(f.app, 'Existing synthetic safety fixture');
  const stateBytes = await readFile(join(f.dataDir, 'state.json'));
  await assert.rejects(f.run('seed', { stateFile: join(f.root, 'new-receipt.json') }), /unused disposable store/);
  assert.deepEqual(await readFile(join(f.dataDir, 'state.json')), stateBytes);
  assert.equal(await readFile(f.stateFile, 'utf8'), 'existing receipt sentinel');
  await assert.rejects(stat(join(f.root, 'new-receipt.json')), { code: 'ENOENT' });
});

test('receipt scope, source bytes, and links are checked before any mutation', async t => {
  const f = await fixture(t); await f.start(); await f.run('seed');
  const receipt = JSON.parse(await readFile(f.stateFile)), stateBytes = await readFile(join(f.dataDir, 'state.json'));
  const wrong = join(f.root, 'wrong.json');
  await writeFile(wrong, JSON.stringify({ ...receipt, namespace: 'some-other-data' }));
  await assert.rejects(f.run('mutate', { stateFile: wrong }), /completed synthetic/);
  await writeFile(wrong, JSON.stringify({ ...receipt, installedFiles: { ...receipt.installedFiles, 'script.js': 'unrecognized content' } }));
  await assert.rejects(f.run('mutate', { stateFile: wrong }), /Synthetic installed source/);
  const linked = join(f.root, 'linked.json'); await symlink(f.stateFile, linked);
  await assert.rejects(f.run('mutate', { stateFile: linked }), { code: 'ELOOP' });
  assert.deepEqual(await readFile(join(f.dataDir, 'state.json')), stateBytes);
});

test('served media-byte corruption is detected even when durable JSON still matches', async t => {
  const f = await fixture(t); await f.start(); await f.run('seed'); await f.stop();
  const receipt = JSON.parse(await readFile(f.stateFile));
  const id = receipt.expected.catalogs.media.find(item => item.category === 'audiobooks').id;
  const files = await readdir(join(f.dataDir, 'media'));
  const filename = files.find(file => file.includes(id.slice('media-'.length)));
  assert.ok(filename);
  const bytes = syntheticMedia(receipt.fixtureId)[1].bytes;
  bytes[44] ^= 1; await writeFile(join(f.dataDir, 'media', filename), bytes);
  await f.start(); await assert.rejects(f.run('check'), /bytes changed/);
});

test('normal CLI verification refuses a non-Linux host before contacting the service', { skip: process.platform === 'linux' }, async () => {
  await assert.rejects(runVerification({ phase: 'seed', url: 'http://127.0.0.1:1', stateFile: '/tmp/not-created-kidos-state.json', vmId }), /root on a disposable Linux ARM64 VM/);
});
