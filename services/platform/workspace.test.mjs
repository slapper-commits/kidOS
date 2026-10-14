import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, StoreError, MAX_PROJECT_BYTES } from './store.mjs';
import { emptyWorkspace, validateWorkspace } from './workspace.mjs';
import { startKidOS } from './server.mjs';

const bounds = { x: 120, y: 20, width: 640, height: 480 };
const presentation = () => ({ bounds: { ...bounds }, minimized: false, maximized: false, snap: null });
const tool = (route, state = {}) => ({ id: route, kind: 'tool', route, state, ...presentation() });
const PROJECT = 'project-00000000-0000-4000-8000-000000000000';
const installed = (version = '1.0.0', appId = PROJECT) => ({ id: `app:${appId}:${version}`, kind: 'installed', appId, version, ...presentation() });
const game = (gameId = 'moon-hopper') => ({ id: `game:${gameId}`, kind: 'game', gameId, ...presentation() });
const draft = project => ({ projectId: project.id, baseRevision: project.revision, name: project.name, files: { ...project.files, 'script.js': '// a recoverable experiment\n' }, file: 'script.js', version: '1.0.' });
const status = code => error => error instanceof StoreError && error.status === code;
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'kidos-workspace-'));
  let store = await Store.open(directory);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, get store() { return store; }, async reopen() { await store.close(); store = await Store.open(directory); } };
}

test('workspace arrangement and exact unfinished editor draft survive service restart', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.store.getWorkspace(), { revision: 0, windows: [], activeId: null, editorDraft: null });
  const project = await f.store.createProject('My experiments');
  const input = { revision: 0, windows: [tool('stuff', { folder: 'project', projectId: project.id }), installed('1.0.0', project.id), game(), tool('make', { projectId: project.id, file: 'script.js' })], activeId: 'make', editorDraft: { ...draft(project), name: '  ' } };
  input.windows[0].minimized = true;
  input.windows[1].maximized = true;
  input.windows[2].snap = 'right';
  const saved = await f.store.saveWorkspace(input);
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.editorDraft, input.editorDraft);
  input.editorDraft.files['script.js'] = 'mutated caller'; input.windows[0].bounds.x = 999;
  saved.editorDraft.name = 'mutated return';
  await f.reopen();
  const restored = f.store.getWorkspace();
  assert.equal(restored.windows[0].bounds.x, 120);
  assert.equal(restored.editorDraft.name, '  ');
  assert.equal(restored.editorDraft.files['script.js'], '// a recoverable experiment\n');
  assert.equal(restored.editorDraft.version, '1.0.');
  assert.equal(restored.activeId, 'make');
  assert.deepEqual(f.store.getProject(project.id), project);
});

test('workspace revisions serialize competing browsers and reject stale draft replacement', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  const first = { ...emptyWorkspace(), windows: [tool('make', { projectId: project.id, file: 'script.js' })], activeId: 'make', editorDraft: draft(project) };
  const second = { ...structuredClone(first), editorDraft: { ...draft(project), name: 'Another browser' } };
  const results = await Promise.allSettled([f.store.saveWorkspace(first), f.store.saveWorkspace(second)]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.status, 409);
  assert.deepEqual(f.store.getWorkspace().editorDraft, first.editorDraft);
  assert.deepEqual(second.editorDraft.name, 'Another browser');
  await assert.rejects(f.store.saveWorkspace({ ...emptyWorkspace(), editorDraft: null }), status(409));
  await f.reopen(); assert.equal(f.store.getWorkspace().editorDraft.name, project.name);
});

test('drafts retain the original source revision across source saves, installs and Trash changes', async t => {
  const f = await fixture(t);
  const original = await f.store.createProject();
  const installation = await f.store.installProject(original.id, { revision: 1, version: '1.0.0' });
  const pending = draft(original);
  await f.store.saveWorkspace({ ...emptyWorkspace(), editorDraft: pending });
  const saved = await f.store.saveProject(original.id, { name: 'New source in another window', files: original.files, revision: 1 });
  await assert.rejects(f.store.saveProject(original.id, { name: pending.name, files: pending.files, revision: pending.baseRevision }), status(409));
  await f.store.trashProject(original.id, { revision: saved.revision });
  await f.reopen();
  assert.deepEqual(f.store.getWorkspace().editorDraft, pending);
  assert.deepEqual(f.store.getInstalled(original.id), installation);
  assert.equal(f.store.listTrash()[0].revision, 3);
  await f.store.restoreProject(original.id, { revision: 3 });
  assert.equal(f.store.getWorkspace().editorDraft.baseRevision, 1);
  assert.equal(f.store.getProject(original.id).revision, 4);
});

test('workspace validates bounded exact descriptors and rejects stored URLs or arbitrary capabilities', () => {
  const make = window => ({ ...emptyWorkspace(), windows: [window], activeId: window.id });
  const accepted = [
    tool('stuff', { folder: 'home', projectId: null }), tool('make', { projectId: null, file: null }),
    tool('library', { mediaId: `media-${'a'.repeat(64)}` }), tool('play'), tool('explore'), tool('mail'), tool('appearance'), installed(), game('tiny-racer'),
  ];
  for (const window of accepted) assert.equal(validateWorkspace(make(window)).windows[0], window);
  const badWindows = [
    null, { ...tool('play'), id: 'arbitrary' }, { ...tool('play'), url: 'https://elsewhere.invalid/' },
    { ...tool('play'), kind: 'preview' }, tool('settings'), tool('play', { command: 'run' }),
    tool('stuff', { folder: 'project', projectId: '../outside' }), tool('stuff', { folder: 'home', projectId: PROJECT }),
    tool('make', { projectId: null, file: 'index.html' }), tool('make', { projectId: PROJECT, file: '../secret' }),
    tool('library', { mediaId: '../../media' }), { ...installed(), version: 'https://evil.invalid/' },
    { ...game(), gameId: 'unregistered' }, { ...tool('play'), minimized: 'yes' }, { ...tool('play'), snap: 'center' }, { ...tool('play'), maximized: true, snap: 'left' },
    { ...tool('play'), bounds: { ...bounds, x: -1 } }, { ...tool('play'), bounds: { ...bounds, width: 0 } },
    { ...tool('play'), bounds: { ...bounds, y: Infinity } }, { ...tool('play'), bounds: { ...bounds, height: 32769 } },
    { ...tool('play'), bounds: { ...bounds, url: 'file:///etc/passwd' } },
  ];
  for (const window of badWindows) assert.throws(() => validateWorkspace({ ...emptyWorkspace(), windows: [window] }), status(400));
  for (const workspace of [null, {}, { ...emptyWorkspace(), extra: true }, { ...emptyWorkspace(), revision: -1 }, { ...emptyWorkspace(), revision: 0.5 }, { ...emptyWorkspace(), windows: {} }, { ...emptyWorkspace(), windows: [tool('play'), tool('play')] }, { ...emptyWorkspace(), activeId: 'missing' }, { ...emptyWorkspace(), windows: [{ ...tool('play'), minimized: true }], activeId: 'play' }, { ...emptyWorkspace(), windows: Array.from({ length: 25 }, (_, n) => installed(`1.0.${n}`)) }]) assert.throws(() => validateWorkspace(workspace), status(400));
  assert.equal(validateWorkspace({ ...emptyWorkspace(), windows: Array.from({ length: 24 }, (_, n) => installed(`1.0.${n}`)) }).windows.length, 24);
});

test('draft validation preserves incomplete text while rejecting invalid files and oversized recovery data', () => {
  const base = { projectId: PROJECT, baseRevision: 1, name: '', files: { 'index.html': '<unfinished', 'notes.txt': '🌙' }, file: 'notes.txt', version: '' };
  assert.deepEqual(validateWorkspace({ ...emptyWorkspace(), editorDraft: base }).editorDraft, base);
  for (const change of [
    { projectId: 'wrong' }, { baseRevision: 0 }, { baseRevision: '1' }, { name: 'x'.repeat(61) }, { name: '\ud800' },
    { version: 'x'.repeat(65) }, { version: '\n' }, { file: 'missing.js' }, { file: '../outside' },
    { files: { 'index.html': '\0' } }, { files: { 'index.html': '\ud800' } }, { files: { 'index.html': 'x'.repeat(MAX_PROJECT_BYTES + 1) } },
    { files: { 'index.html': '', '../outside': 'bad' } }, { extra: 'unsupported' },
  ]) assert.throws(() => validateWorkspace({ ...emptyWorkspace(), editorDraft: { ...base, ...change } }), status(400));
});

test('well-shaped stale identities remain inert saved descriptors for the desktop to resolve safely', async t => {
  const f = await fixture(t);
  const input = { ...emptyWorkspace(), windows: [installed(), tool('stuff', { folder: 'project', projectId: PROJECT }), tool('library', { mediaId: `media-${'b'.repeat(64)}` })], activeId: 'library' };
  await f.store.saveWorkspace(input); await f.reopen();
  assert.equal(f.store.getWorkspace().windows.length, 3);
  assert.deepEqual(f.store.listProjects(), []); assert.deepEqual(f.store.listApps(), []); assert.deepEqual(f.store.listMedia(), []);
});

test('schema 4 migration retains exact prior bytes, every prior data map and media contents', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject('Before workspace recovery');
  await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
  await f.store.trashProject(project.id, { revision: 1 });
  await f.store.recordGameResult('tiny-racer', { roundId: 'a'.repeat(32), score: 88, won: true });
  const media = await f.store.importMedia({ title: 'A saved book', filename: 'book.txt', category: 'books' }, Buffer.from('Keep my book.'));
  await f.store.saveMediaProgress(media.item.id, { position: 3 }); await f.store.close();
  const file = path.join(f.directory, 'state.json');
  const previous = JSON.parse(await readFile(file, 'utf8')); previous.schemaVersion = 4; delete previous.workspace; delete previous.mail;
  const original = JSON.stringify(previous, null, 2);
  await writeFile(file, original); await writeFile(path.join(f.directory, 'state.pre-v4.older.json'), 'retain older archive');
  await f.reopen();
  const current = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(current, { ...previous, schemaVersion: 6, mail: { people: {}, drafts: {}, messages: {} }, workspace: emptyWorkspace() });
  const archive = (await readdir(f.directory)).find(name => name.startsWith('state.pre-v6.'));
  assert.equal(await readFile(path.join(f.directory, archive), 'utf8'), original);
  assert.equal(await readFile(path.join(f.directory, 'state.backup.json'), 'utf8'), original);
  assert.equal((await f.store.readMedia(media.item.id)).bytes.toString(), 'Keep my book.');
  await f.store.saveWorkspace({ ...emptyWorkspace(), windows: [tool('play')], activeId: 'play' }); await f.reopen();
  assert.equal(await readFile(path.join(f.directory, archive), 'utf8'), original);
  assert.equal(await readFile(path.join(f.directory, 'state.pre-v4.older.json'), 'utf8'), 'retain older archive');
});

test('invalid on-disk workspace recovers previous valid draft rather than trusting an injected URL', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  const first = await f.store.saveWorkspace({ ...emptyWorkspace(), editorDraft: draft(project) });
  await f.store.saveWorkspace({ ...first, windows: [tool('play')], activeId: 'play' }); await f.store.close();
  const file = path.join(f.directory, 'state.json');
  const state = JSON.parse(await readFile(file, 'utf8')); state.workspace.windows[0].url = 'https://not-approved.invalid/';
  await writeFile(file, JSON.stringify(state)); await f.reopen();
  assert.match(f.store.recoveryNotice, /Recovered/);
  assert.deepEqual(f.store.getWorkspace(), first);
});

test('failed workspace disk commit preserves previous workspace and does not acknowledge the new draft', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject();
  const first = await f.store.saveWorkspace({ ...emptyWorkspace(), editorDraft: draft(project) });
  const before = await readFile(path.join(f.directory, 'state.json'), 'utf8');
  await rm(path.join(f.directory, 'state.backup.json')); await mkdir(path.join(f.directory, 'state.backup.json'));
  await assert.rejects(f.store.saveWorkspace({ ...first, editorDraft: { ...draft(project), name: 'Not committed' } }), status(503));
  assert.equal(await readFile(path.join(f.directory, 'state.json'), 'utf8'), before);
  await rm(path.join(f.directory, 'state.backup.json'), { recursive: true }); await f.reopen();
  assert.deepEqual(f.store.getWorkspace(), first);
});

test('workspace API requires desktop authority and returns exact saved revisions and useful conflicts', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'kidos-workspace-http-'));
  const app = await startKidOS({ dataDir, port: 0, runnerPort: 0 });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const { token } = await (await fetch(`${app.platformOrigin}/api/session`)).json();
  const api = (method = 'GET', body, headers = {}) => fetch(`${app.platformOrigin}/api/workspace`, { method, headers: { 'X-KidOS-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await fetch(`${app.platformOrigin}/api/workspace`)).status, 403);
  assert.equal((await api('GET', undefined, { Origin: app.runnerOrigin })).status, 403);
  assert.deepEqual(await (await api()).json(), { workspace: emptyWorkspace() });
  const input = { ...emptyWorkspace(), windows: [tool('play')], activeId: 'play' };
  const saved = await api('PUT', input); assert.equal(saved.status, 200);
  const { workspace } = await saved.json(); assert.equal(workspace.revision, 1);
  const stale = await api('PUT', input); assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /another window/);
  assert.equal((await api('PUT', { ...workspace, url: 'https://not-approved.invalid/' })).status, 400);
  assert.equal((await api('PUT', { ...workspace, editorDraft: { text: 'x'.repeat(2 * 1024 * 1024) } })).status, 413);
  assert.deepEqual((await (await api()).json()).workspace, workspace);
  assert.equal((await api('PUT', workspace, { Origin: 'null' })).status, 403);
  assert.equal((await api('PUT', workspace, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${app.runnerOrigin}/api/workspace`)).status, 404);
});

test('workspace GET waits for an earlier disconnected PUT to finish before reconciling its revision', async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'kidos-workspace-pending-http-'));
  const app = await startKidOS({ dataDir, port: 0, runnerPort: 0 });
  let releaseWrite;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  t.after(async () => { releaseWrite(); await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const { token } = await (await fetch(`${app.platformOrigin}/api/session`)).json();
  let writeEntered;
  const entered = new Promise(resolve => { writeEntered = resolve; });
  const originalSave = app.store.saveWorkspace.bind(app.store);
  app.store.saveWorkspace = async input => { writeEntered(); await gate; return originalSave(input); };
  const controller = new AbortController();
  const input = { ...emptyWorkspace(), windows: [tool('play')], activeId: 'play' };
  const writing = fetch(`${app.platformOrigin}/api/workspace`, { method: 'PUT', signal: controller.signal, headers: { 'X-KidOS-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }).catch(error => error);
  await entered; controller.abort(); await writing;
  let getEntered, responseFinished = false;
  const readingStarted = new Promise(resolve => { getEntered = resolve; });
  app.platform.on('request', (req, res) => {
    if (req.method === 'GET' && req.url === '/api/workspace') { res.once('finish', () => { responseFinished = true; }); getEntered(); }
  });
  const reading = fetch(`${app.platformOrigin}/api/workspace`, { headers: { 'X-KidOS-Token': token } });
  await readingStarted;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(responseFinished, false, 'GET must not report the old revision while its predecessor can still commit');
  assert.equal((await fetch(`${app.platformOrigin}/health`)).status, 200, 'unrelated service checks stay available');
  releaseWrite();
  const response = await reading;
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).workspace, { ...input, revision: 1 });
});
