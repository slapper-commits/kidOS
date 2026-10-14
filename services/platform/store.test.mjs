import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, symlink, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store, StoreError, validateManifest, validateFilePath, MAX_PROJECT_BYTES } from './store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'kidos-store-test-'));
  const directory = path.join(root, 'family');
  let store = await Store.open(directory);
  t.after(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, directory, get store() { return store; }, async reopen() { await store.close(); store = await Store.open(directory); return store; } };
}
const status = code => error => error instanceof StoreError && error.status === code;

test('create, edit, install, edit again and reopen preserves source and immutable installation', async t => {
  const f = await fixture(t);
  const created = await f.store.createProject('My color lab');
  assert.equal(created.revision, 1);
  const summary = f.store.listProjects()[0];
  assert.equal(summary.fileCount, 3);
  assert.equal(summary.id, created.id);
  assert.equal(Object.hasOwn(summary, 'files'), false);
  assert.deepEqual(Object.keys(created.files), ['index.html', 'style.css', 'script.js']);
  const saved = await f.store.saveProject(created.id, { name: 'My blue world', revision: 1, files: { ...created.files, 'style.css': 'body { background: blue; }' } });
  const installed = await f.store.installProject(created.id, { revision: saved.revision, version: '1.0.0' });
  const edited = await f.store.saveProject(created.id, { name: saved.name, revision: saved.revision, files: { ...saved.files, 'style.css': 'body { background: red; }' } });
  assert.equal(installed.sourceRevision, 2);
  assert.equal(installed.manifest.name, 'My blue world');
  assert.equal(installed.digest.length, 64);
  assert.equal(f.store.getInstalled(created.id).files['style.css'], 'body { background: blue; }');
  await f.reopen();
  assert.deepEqual(f.store.getProject(created.id), edited);
  assert.deepEqual(f.store.getInstalled(created.id), installed);
  assert.equal(f.store.listApps()[0].currentVersion, '1.0.0');
  assert.deepEqual(f.store.exportProject(created.id), { schemaVersion: 1, project: edited });
});

test('versions stay identifiable, duplicates conflict, most recently installed becomes current', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  const first = await f.store.installProject(project.id, { revision: 1, version: '2.0.0' });
  await assert.rejects(f.store.installProject(project.id, { revision: 1, version: '2.0.0' }), status(409));
  const second = await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
  assert.deepEqual(f.store.getInstalled(project.id, '2.0.0'), first);
  assert.deepEqual(f.store.getInstalled(project.id), second);
  assert.equal(f.store.listApps()[0].versions.length, 2);
  await assert.rejects(f.store.installProject(project.id, { revision: 1, version: '01.0.0' }), status(400));
  assert.throws(() => f.store.getInstalled(project.id, '__proto__'), status(400));
});

test('optimistic revision checks serialize concurrent changes without losing an edit', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  const results = await Promise.allSettled([
    f.store.saveProject(project.id, { name: 'First edit', files: project.files, revision: 1 }),
    f.store.saveProject(project.id, { name: 'Second edit', files: project.files, revision: 1 })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal(f.store.getProject(project.id).name, 'First edit');
  await assert.rejects(f.store.installProject(project.id, { revision: 1, version: '1.0.0' }), status(409));
  await f.reopen();
  assert.equal(f.store.getProject(project.id).revision, 2);
});

test('rejects traversal, encoded paths, invalid files, oversized content and malformed manifests', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  for (const file of ['../outside', './index.html', '/etc/passwd', 'C:\\file', 'a\\b', 'a/../b', '%2e%2e/secret', 'nested%2fsecret', 'a//b', '__proto__', 'a?b', 'a/#b', '.hidden']) {
    assert.throws(() => validateFilePath(file), status(400), file);
    await assert.rejects(f.store.saveProject(project.id, { name: project.name, revision: 1, files: { ...project.files, [file]: 'bad' } }), status(400));
  }
  assert.equal(validateFilePath('assets/hello-world.css'), 'assets/hello-world.css');
  for (const files of [{ 'style.css': 'missing entry' }, { 'index.html': '\0' }, { 'index.html': '\ud800' }, { 'index.html': 'x'.repeat(MAX_PROJECT_BYTES) }]) {
    await assert.rejects(f.store.saveProject(project.id, { name: project.name, revision: 1, files }), status(400));
  }
  const manifest = (await f.store.installProject(project.id, { revision: 1, version: '1.0.0' })).manifest;
  for (const change of [{ permissions: ['network'] }, { permissions: null }, { runtime: 'node' }, { entryPoint: '../secret' }, { schemaVersion: 2 }, { extra: true }]) {
    assert.throws(() => validateManifest({ ...manifest, ...change }), status(400));
  }
  assert.equal(f.store.getProject(project.id).revision, 1);
});

test('returned projects, installations and input objects cannot mutate persisted state', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  const original = project.files['index.html'];
  project.files['index.html'] = 'mutated return';
  assert.equal(f.store.getProject(project.id).files['index.html'], original);
  const files = { 'index.html': 'saved content' };
  const saving = f.store.saveProject(project.id, { name: 'Source', files, revision: 1 });
  files['index.html'] = 'mutated after call';
  await saving;
  const installed = await f.store.installProject(project.id, { revision: 2, version: '1.0.0' });
  installed.files['index.html'] = 'mutated installed return';
  assert.equal(f.store.getInstalled(project.id).files['index.html'], 'saved content');
  f.store.listApps()[0].versions[0].version = '9.9.9';
  assert.equal(f.store.listApps()[0].currentVersion, '1.0.0');
});

test('malformed primary recovers previous complete transaction and preserves corrupt file', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
  await f.store.saveProject(project.id, { name: 'newest change', files: project.files, revision: 1 });
  await f.store.close();
  await writeFile(path.join(f.directory, 'state.json'), '{interrupted');
  await f.reopen();
  assert.match(f.store.recoveryNotice, /Recovered/);
  assert.equal(f.store.getProject(project.id).name, project.name);
  assert.equal(f.store.listApps()[0].currentVersion, '1.0.0');
  const corrupt = (await readdir(f.directory)).find(name => name.startsWith('state.corrupt.'));
  assert.equal(await readFile(path.join(f.directory, corrupt), 'utf8'), '{interrupted');
  await f.reopen();
  assert.equal(f.store.recoveryNotice, null);
});

test('tampered installed content is detected on reopen and recovered from valid backup', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
  await f.store.saveProject(project.id, { name: 'new name', files: project.files, revision: 1 });
  await f.store.close();
  const target = path.join(f.directory, 'state.json');
  const state = JSON.parse(await readFile(target, 'utf8'));
  state.apps[project.id].versions['1.0.0'].files['index.html'] = 'tampered';
  await writeFile(target, JSON.stringify(state));
  await f.reopen();
  assert.match(f.store.recoveryNotice, /Recovered/);
  assert.equal(f.store.getInstalled(project.id).files['index.html'], project.files['index.html']);
});

test('two invalid states fail closed, preserve both files and release the startup lock', async t => {
  const f = await fixture(t);
  await f.store.createProject();
  await f.store.close();
  await writeFile(path.join(f.directory, 'state.json'), 'broken primary');
  await writeFile(path.join(f.directory, 'state.backup.json'), 'broken backup');
  await assert.rejects(Store.open(f.directory), status(503));
  assert.equal(await readFile(path.join(f.directory, 'state.json'), 'utf8'), 'broken primary');
  assert.equal(await readFile(path.join(f.directory, 'state.backup.json'), 'utf8'), 'broken backup');
  assert.equal((await readdir(f.directory)).includes('store.lock'), false);
});

test('unknown disk schemas fail without replacing them with an older backup', async t => {
  const f = await fixture(t);
  await f.store.createProject();
  await f.store.close();
  const newer = JSON.stringify({ schemaVersion: 999, projects: {}, apps: {}, games: {}, trash: {}, media: {} });
  await writeFile(path.join(f.directory, 'state.json'), newer);
  await assert.rejects(Store.open(f.directory), /Unsupported data schema version 999/);
  assert.equal(await readFile(path.join(f.directory, 'state.json'), 'utf8'), newer);
});

test('symbolic-link roots, state files and backup files are rejected without touching targets', async t => {
  const f = await fixture(t);
  await f.store.close();
  const rootLink = path.join(f.root, 'linked-family');
  await symlink(f.directory, rootLink);
  await assert.rejects(Store.open(rootLink), status(503));
  const outside = path.join(f.root, 'outside.json');
  await writeFile(outside, 'do not touch');
  for (const filename of ['state.json', 'state.backup.json', 'store.lock']) {
    const target = path.join(f.directory, filename);
    await rm(target, { force: true });
    await symlink(outside, target);
    await assert.rejects(Store.open(f.directory), status(503));
    assert.equal(await readFile(outside, 'utf8'), 'do not touch');
    await rm(target);
    if (filename === 'state.json') await writeFile(target, JSON.stringify({ schemaVersion: 1, projects: {}, apps: {} }));
  }
});

test('live stores exclude a second process and stale process locks can recover', async t => {
  const f = await fixture(t);
  await assert.rejects(Store.open(f.directory), status(503));
  await f.store.close();
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(child.status, 0);
  await writeFile(path.join(f.directory, 'store.lock'), JSON.stringify({ pid: child.pid, token: 'test-dead-process' }));
  await f.reopen();
  const project = await f.store.createProject();
  assert.equal(f.store.getProject(project.id).revision, 1);
});

test('failed atomic writes preserve primary and require restart before further mutation', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  const before = await readFile(path.join(f.directory, 'state.json'), 'utf8');
  await rm(path.join(f.directory, 'state.backup.json'));
  await mkdir(path.join(f.directory, 'state.backup.json'));
  await assert.rejects(f.store.saveProject(project.id, { name: 'cannot commit', files: project.files, revision: 1 }), status(503));
  assert.equal(await readFile(path.join(f.directory, 'state.json'), 'utf8'), before);
  await assert.rejects(f.store.createProject(), status(503));
  await rm(path.join(f.directory, 'state.backup.json'), { recursive: true });
  await f.reopen();
  assert.equal(f.store.getProject(project.id).name, project.name);
});

test('incomplete temporary files are ignored and user data uses private permissions', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  await f.store.close();
  await writeFile(path.join(f.directory, '.state.json.interrupted.tmp'), 'incomplete');
  await f.reopen();
  assert.equal(f.store.getProject(project.id).name, project.name);
  assert.equal((await stat(path.join(f.directory, 'state.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(f.directory)).mode & 0o777, 0o700);
});

test('close drains already accepted writes and rejects newly submitted work', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  const saving = f.store.saveProject(project.id, { name: 'Saved before shutdown', files: project.files, revision: 1 });
  const closing = f.store.close();
  await assert.rejects(f.store.createProject(), status(503));
  await saving;
  await closing;
  await f.reopen();
  assert.equal(f.store.getProject(project.id).name, 'Saved before shutdown');
});

test('missing schema metadata is corrupt state and recovers, unlike unsupported numeric versions', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  await f.store.saveProject(project.id, { name: 'latest', files: project.files, revision: 1 });
  await f.store.close();
  await writeFile(path.join(f.directory, 'state.json'), '{}');
  await f.reopen();
  assert.match(f.store.recoveryNotice, /Recovered/);
  assert.equal(f.store.getProject(project.id).name, project.name);
});

test('reopening validates source paths and registry types, not only installed digests', async t => {
  for (const corrupt of [
    state => { state.projects[Object.keys(state.projects)[0]].files['../escaped'] = 'unsafe'; },
    state => { state.apps[Object.keys(state.apps)[0]].currentVersion = ['1.0.0']; }
  ]) {
    const f = await fixture(t);
    const project = await f.store.createProject();
    await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
    await f.store.saveProject(project.id, { name: 'latest', files: project.files, revision: 1 });
    await f.store.close();
    const target = path.join(f.directory, 'state.json');
    const state = JSON.parse(await readFile(target, 'utf8'));
    corrupt(state);
    await writeFile(target, JSON.stringify(state));
    await f.reopen();
    assert.match(f.store.recoveryNotice, /Recovered/);
    assert.equal(f.store.listApps()[0].currentVersion, '1.0.0');
    assert.equal(Object.hasOwn(f.store.getProject(project.id).files, '../escaped'), false);
  }
});

test('project Trash preserves every source file, installed version and score across restart and restore', async t => {
  const f = await fixture(t);
  const original = await f.store.createProject('Keep my work');
  const installed = await f.store.installProject(original.id, { revision: 1, version: '1.0.0' });
  const saved = await f.store.saveProject(original.id, { name: 'Changed source', revision: 1, files: { ...original.files, 'notes.txt': 'Keep this too' } });
  await f.store.recordGameResult('moon-hopper', { roundId: 'a'.repeat(32), score: 42, won: false });
  const trashed = await f.store.trashProject(original.id, { revision: saved.revision });
  assert.equal(trashed.revision, 3);
  assert.deepEqual(trashed.files, saved.files);
  assert.deepEqual(f.store.listProjects(), []);
  assert.equal(f.store.listTrash()[0].fileCount, 4);
  assert.equal(f.store.listTrash()[0].trashedAt, trashed.updatedAt);
  assert.equal(Object.hasOwn(f.store.listTrash()[0], 'files'), false);
  f.store.listTrash()[0].name = 'mutated return';
  assert.equal(f.store.listTrash()[0].name, saved.name);
  assert.throws(() => f.store.getProject(original.id), status(409));
  assert.throws(() => f.store.exportProject(original.id), status(409));
  await assert.rejects(f.store.saveProject(original.id, { name: saved.name, revision: 3, files: saved.files }), status(409));
  await assert.rejects(f.store.installProject(original.id, { revision: 3, version: '1.0.1' }), status(409));
  assert.deepEqual(f.store.getInstalled(original.id), installed);
  await f.reopen();
  assert.equal(f.store.listTrash()[0].revision, 3);
  assert.equal(f.store.listApps()[0].currentVersion, '1.0.0');
  assert.deepEqual(f.store.getInstalled(original.id), installed);
  assert.equal(f.store.getGameProgress('moon-hopper').best, 42);
  const restored = await f.store.restoreProject(original.id, { revision: 3 });
  assert.equal(restored.id, original.id);
  assert.equal(restored.revision, 4);
  assert.deepEqual(restored.files, saved.files);
  assert.equal(restored.name, saved.name);
  assert.equal(restored.createdAt, original.createdAt);
  assert.deepEqual(f.store.listTrash(), []);
  assert.deepEqual(f.store.exportProject(original.id), { schemaVersion: 1, project: restored });
  await f.reopen();
  assert.deepEqual(f.store.getProject(original.id), restored);
  assert.deepEqual(f.store.getInstalled(original.id), installed);
});

test('revision checks serialize save/trash/restore races and reject stale requests after repeated moves', async t => {
  const f = await fixture(t);
  for (const first of ['save', 'trash']) {
    const project = await f.store.createProject(first);
    const actions = {
      save: () => f.store.saveProject(project.id, { name: 'Newer work', files: project.files, revision: 1 }),
      trash: () => f.store.trashProject(project.id, { revision: 1 }),
    };
    const results = await Promise.allSettled([actions[first](), actions[first === 'save' ? 'trash' : 'save']()]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.status, 409);
    if (first === 'save') {
      assert.equal(f.store.getProject(project.id).name, 'Newer work');
      await f.store.trashProject(project.id, { revision: 2 });
    }
    const trashedRevision = f.store.listTrash().find(item => item.id === project.id).revision;
    const restores = await Promise.allSettled([
      f.store.restoreProject(project.id, { revision: trashedRevision }),
      f.store.restoreProject(project.id, { revision: trashedRevision }),
    ]);
    assert.equal(restores[0].status, 'fulfilled');
    assert.equal(restores[1].reason.status, 409);
    await assert.rejects(actions.save(), status(409));
    const retrash = await f.store.trashProject(project.id, { revision: restores[0].value.revision });
    await assert.rejects(f.store.restoreProject(project.id, { revision: trashedRevision }), status(409));
    assert.equal(f.store.listTrash().find(item => item.id === project.id).revision, retrash.revision);
  }
});

test('Trash mutations validate exact revision payloads and cannot bypass the total project limit', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  for (const input of [null, [], {}, { revision: 0 }, { revision: '1' }, { revision: 1, permanent: true }]) {
    await assert.rejects(f.store.trashProject(project.id, input), status(400));
    await assert.rejects(f.store.restoreProject(project.id, input), status(400));
  }
  await assert.rejects(f.store.trashProject('../unsafe', { revision: 1 }), status(400));
  await assert.rejects(f.store.restoreProject(project.id, { revision: 1 }), status(409));
  for (let n = 1; n < 128; n++) await f.store.createProject(`Project ${n}`, { 'index.html': '' });
  await f.store.trashProject(project.id, { revision: 1 });
  assert.equal(f.store.listProjects().length, 127);
  await assert.rejects(f.store.createProject('One too many'), /including projects in Trash/);
  await f.store.restoreProject(project.id, { revision: 2 });
  assert.equal(f.store.listProjects().length, 128);
});

test('schema 2 upgrade archives exact previous bytes and preserves projects, installs and game progress', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject('Before Trash');
  const installed = await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
  const progress = await f.store.recordGameResult('tiny-racer', { roundId: 'b'.repeat(32), score: 80, won: true });
  await f.store.close();
  const previous = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
  previous.schemaVersion = 2; delete previous.trash; delete previous.media; delete previous.workspace; delete previous.mail;
  const original = JSON.stringify(previous, null, 2);
  await writeFile(path.join(f.directory, 'state.json'), original);
  await writeFile(path.join(f.directory, 'state.pre-v2.older.json'), 'older preserved archive');
  await f.reopen();
  assert.deepEqual(f.store.getProject(project.id), project);
  assert.deepEqual(f.store.getInstalled(project.id), installed);
  assert.deepEqual(f.store.getGameProgress('tiny-racer'), progress);
  assert.deepEqual(f.store.listTrash(), []);
  const migrated = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
  assert.deepEqual(migrated, { ...previous, schemaVersion: 6, mail: { people: {}, drafts: {}, messages: {} }, trash: {}, media: {}, workspace: { revision: 0, windows: [], activeId: null, editorDraft: null } });
  const archive = (await readdir(f.directory)).find(name => name.startsWith('state.pre-v6.'));
  assert.equal(await readFile(path.join(f.directory, archive), 'utf8'), original);
  assert.equal(await readFile(path.join(f.directory, 'state.backup.json'), 'utf8'), original);
  await f.store.trashProject(project.id, { revision: 1 });
  await f.reopen();
  assert.equal(await readFile(path.join(f.directory, archive), 'utf8'), original);
  assert.equal(await readFile(path.join(f.directory, 'state.pre-v2.older.json'), 'utf8'), 'older preserved archive');
  assert.equal((await readdir(f.directory)).filter(name => name.startsWith('state.pre-v6.')).length, 1);
});

test('an upgrade that exceeds the state limit preserves primary and backup without falling back or rewriting recovery files', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kidos-upgrade-limit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const limit = 64 * 1024 * 1024;
  const previous = { schemaVersion: 2, projects: {}, apps: {}, games: {} };
  const timestamp = '2026-10-08T00:00:00.000Z';
  let last;
  for (let n = 0; n < 64; n++) {
    const id = `project-${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
    last = previous.projects[id] = {
      id, name: `Near the limit ${n}`, revision: 1, createdAt: timestamp, updatedAt: timestamp,
      files: { 'index.html': 'x'.repeat(MAX_PROJECT_BYTES - 'index.html'.length) },
    };
  }
  // Keep every project within its own limit and leave less room than the new
  // added fields need in the previously valid serialized state.
  const excess = Buffer.byteLength(JSON.stringify(previous)) - (limit - 5);
  last.files['index.html'] = last.files['index.html'].slice(excess);
  const original = JSON.stringify(previous);
  assert.equal(Buffer.byteLength(original), limit - 5);
  assert.ok(Buffer.byteLength(JSON.stringify({ ...previous, schemaVersion: 6, mail: { people: {}, drafts: {}, messages: {} }, trash: {}, media: {}, workspace: { revision: 0, windows: [], activeId: null, editorDraft: null } })) > limit);
  const smallBackup = JSON.stringify({ schemaVersion: 2, projects: {}, apps: {}, games: {} });
  for (const [primary, backup] of [[original, smallBackup], ['broken primary', original]]) {
    await writeFile(path.join(directory, 'state.json'), primary);
    await writeFile(path.join(directory, 'state.backup.json'), backup);
    await assert.rejects(async () => {
      const opened = await Store.open(directory);
      await opened.close();
    }, error => error instanceof StoreError && error.status === 503 && /Upgrading.*64 MiB.*No saved files were changed/.test(error.message));
    assert.equal(await readFile(path.join(directory, 'state.json'), 'utf8'), primary);
    assert.equal(await readFile(path.join(directory, 'state.backup.json'), 'utf8'), backup);
    assert.deepEqual((await readdir(directory)).sort(), ['state.backup.json', 'state.json']);
  }
});

test('invalid Trash state recovers the prior commit without losing the saved project', async t => {
  for (const corrupt of [
    (state, project) => { state.trash[project.id].trashedAt = 'not a date'; },
    (state, project) => { state.trash[project.id].permanent = true; },
    state => { state.trash['project-00000000-0000-4000-8000-000000000000'] = { trashedAt: new Date().toISOString() }; },
  ]) {
    const f = await fixture(t);
    const project = await f.store.createProject('Recover my project');
    await f.store.trashProject(project.id, { revision: 1 });
    await f.store.close();
    const file = path.join(f.directory, 'state.json');
    const state = JSON.parse(await readFile(file, 'utf8'));
    corrupt(state, project);
    await writeFile(file, JSON.stringify(state));
    await f.reopen();
    assert.match(f.store.recoveryNotice, /Recovered/);
    assert.deepEqual(f.store.getProject(project.id), project);
    assert.deepEqual(f.store.listTrash(), []);
  }
});

test('recovery from an older backup archives its exact bytes before migration and later writes', async t => {
  for (const version of [1, 2, 3, 4, 5]) {
    const f = await fixture(t);
    const project = await f.store.createProject('Recovered old work');
    await f.store.close();
    const previous = JSON.parse(await readFile(path.join(f.directory, 'state.json'), 'utf8'));
    previous.schemaVersion = version; delete previous.mail;
    if (version < 5) delete previous.workspace;
    if (version < 4) delete previous.media;
    if (version < 3) delete previous.trash;
    if (version === 1) delete previous.games;
    const original = JSON.stringify(previous, null, 2);
    await writeFile(path.join(f.directory, 'state.backup.json'), original);
    await writeFile(path.join(f.directory, 'state.json'), 'broken primary');
    await f.reopen();
    assert.match(f.store.recoveryNotice, /Recovered/);
    assert.deepEqual(f.store.getProject(project.id), project);
    const archive = (await readdir(f.directory)).find(name => name.startsWith('state.pre-v6.'));
    assert.equal(await readFile(path.join(f.directory, archive), 'utf8'), original);
    await f.store.trashProject(project.id, { revision: 1 });
    await f.store.restoreProject(project.id, { revision: 2 });
    await f.reopen();
    assert.equal(await readFile(path.join(f.directory, archive), 'utf8'), original);
    assert.equal(f.store.getProject(project.id).revision, 3);
  }
});
