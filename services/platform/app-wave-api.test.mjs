import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startKidOS } from './server.mjs';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kidos-app-wave-'));
  let app = await startKidOS({ dataDir, port: 0, runnerPort: 0 });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  const session = async () => {
    const response = await fetch(`${app.platformOrigin}/api/session`);
    const { token } = await response.json(); const cookie = response.headers.get('set-cookie').split(';')[0];
    return { token, cookie,
      api: (path, method = 'GET', body, headers = {}) => fetch(`${app.platformOrigin}${path}`, { method, headers: { 'X-KidOS-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    };
  };
  return { dataDir, get app() { return app; }, session, async restart(whileStopped = async () => {}) { await app.close(); await whileStopped(); app = await startKidOS({ dataDir, port: 0, runnerPort: 0 }); } };
}
async function json(response, expected = 200) { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }

test('project HTTP imports export and recovery draft as fresh identities and rejects stale duplication', async t => {
  const f = await fixture(t); const client = await f.session();
  let { project } = await json(await client.api('/api/projects', 'POST', { name: 'Original project' }), 201);
  const saved = await json(await client.api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: project.revision, files: { ...project.files, 'notes.txt': 'My exact note.' } })); project = saved.project;
  const exported = await json(await client.api(`/api/projects/${project.id}/export`));
  const imported = (await json(await client.api('/api/projects/import', 'POST', exported), 201)).project;
  assert.notEqual(imported.id, project.id); assert.equal(imported.revision, 1); assert.deepEqual(imported.files, project.files);
  const draft = { format: 'kidos-recovery-draft', version: 1, projectId: project.id, baseRevision: project.revision, name: 'Recovered draft', files: { ...project.files, 'notes.txt': 'Unsaved words from an exported draft.' } };
  const recovered = (await json(await client.api('/api/projects/import', 'POST', draft), 201)).project;
  assert.notEqual(recovered.id, project.id); assert.notEqual(recovered.id, imported.id); assert.equal(recovered.revision, 1); assert.deepEqual(recovered.files, draft.files);
  assert.deepEqual((await json(await client.api(`/api/projects/${project.id}`))).project, project);
  assert.equal((await client.api(`/api/projects/${project.id}/duplicate`, 'POST', { revision: project.revision - 1, name: 'Stale copy' })).status, 409);
  const duplicate = (await json(await client.api(`/api/projects/${project.id}/duplicate`, 'POST', { revision: project.revision, name: 'My new copy' }), 201)).project;
  assert.notEqual(duplicate.id, project.id); assert.deepEqual(duplicate.files, project.files); assert.equal(duplicate.name, 'My new copy');
  assert.equal((await client.api('/api/projects/import', 'POST', { ...draft, files: { 'index.html': '', '../escape.txt': 'bad' } })).status, 400);
  await f.restart(); const reopened = await f.session();
  assert.deepEqual((await json(await reopened.api(`/api/projects/${recovered.id}`))).project.files, draft.files);
});

test('switching installed versions preserves snapshots and runner denies project-bin files', async t => {
  const f = await fixture(t); let client = await f.session();
  let { project } = await json(await client.api('/api/projects', 'POST', { name: 'Version experiment' }), 201);
  project = (await json(await client.api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: 1, files: { ...project.files, 'recycle-bin/old.js': 'window.deletedFileExecuted = true;' } }))).project;
  const first = (await json(await client.api(`/api/projects/${project.id}/install`, 'POST', { revision: project.revision, version: '1.0.0' }), 201)).app;
  const firstURL = (await json(await client.api(`/api/apps/${project.id}/launch`))).url;
  assert.equal(await (await fetch(firstURL)).text(), first.files['index.html']);
  assert.equal((await fetch(firstURL.replace('/index.html', '/recycle-bin/old.js'))).status, 404);
  const preview = (await json(await client.api(`/api/projects/${project.id}/preview`, 'POST', { revision: project.revision }), 201)).url;
  assert.equal((await fetch(preview.replace('/index.html', '/recycle-bin/old.js'))).status, 404);
  project = (await json(await client.api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: project.revision, files: { ...project.files, 'index.html': '<!doctype html><h1>Version two</h1>' } }))).project;
  const second = (await json(await client.api(`/api/projects/${project.id}/install`, 'POST', { revision: project.revision, version: '2.0.0' }), 201)).app;
  assert.notEqual(first.digest, second.digest);
  await json(await client.api(`/api/apps/${project.id}/current`, 'POST', { version: '1.0.0' }));
  assert.equal((await json(await client.api(`/api/apps/${project.id}/launch`))).url, firstURL);
  assert.equal(await (await fetch(firstURL)).text(), first.files['index.html']);
  assert.equal((await client.api(`/api/apps/${project.id}/current`, 'POST', { version: '9.9.9' })).status, 404);
  for (const payload of [{ version: null }, {}, { version: 1 }, { version: '01.0.0' }, { version: '../1.0.0' }]) assert.equal((await client.api(`/api/apps/${project.id}/current`, 'POST', payload)).status, 400);
  await f.restart(); client = await f.session();
  const apps = (await json(await client.api('/api/apps'))).apps;
  assert.equal(apps[0].currentVersion, '1.0.0'); assert.deepEqual(apps[0].versions.map(value => value.digest), [first.digest, second.digest]);
});

test('Library HTTP metadata editing preserves original bytes and progress across restart', async t => {
  const f = await fixture(t); let client = await f.session();
  const bytes = Buffer.from('A local book with a saved page.\n');
  const response = await fetch(`${f.app.platformOrigin}/api/media?${new URLSearchParams({ title: 'Before', category: 'books', filename: 'before.txt' })}`, { method: 'POST', headers: { 'X-KidOS-Token': client.token, 'Content-Type': 'application/octet-stream' }, body: bytes });
  const imported = (await json(response, 201)).item;
  const progress = (await json(await client.api(`/api/media/${imported.id}/progress`, 'PATCH', { position: 12 }))).item.progress;
  const changed = (await json(await client.api(`/api/media/${imported.id}`, 'PATCH', { title: 'My favorite story', category: 'books', favorite: true, collection: 'Bedtime', order: 3 }))).item;
  assert.deepEqual(changed.progress, progress); assert.equal(changed.filename, 'before.txt'); assert.equal(changed.digest, imported.digest);
  assert.deepEqual(await readFile(join(f.dataDir, 'media', `${changed.digest}.blob`)), bytes);
  assert.equal((await client.api(`/api/media/${imported.id}`, 'PATCH', { title: 'Bad shelf', category: 'videos', favorite: true, collection: '', order: 0 })).status, 400);
  assert.equal((await fetch(`${f.app.platformOrigin}/api/media/${imported.id}`, { method: 'PATCH', headers: { Origin: f.app.runnerOrigin, 'X-KidOS-Token': client.token, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  await f.restart(); client = await f.session();
  assert.deepEqual((await json(await client.api(`/api/media/${imported.id}`))).item, changed);
  const content = await fetch(`${f.app.platformOrigin}/media/${imported.id}/content`, { headers: { Cookie: client.cookie, 'Sec-Fetch-Site': 'same-origin' } });
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes);
});

test('legacy installed snapshots retain byte-identical formerly valid recycle-bin assets', async t => {
  const f = await fixture(t); let client = await f.session();
  const { project } = await json(await client.api('/api/projects', 'POST', { name: 'Older installed app' }), 201);
  const installed = (await json(await client.api(`/api/projects/${project.id}/install`, 'POST', { revision: 1, version: '1.0.0' }), 201)).app;
  const legacyBytes = 'window.oldReleaseAsset = "still part of this immutable app";';
  const legacy = { ...installed, files: { ...installed.files, 'recycle-bin/legacy.js': legacyBytes } };
  const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  legacy.digest = createHash('sha256').update(canonical({ manifest: legacy.manifest, files: legacy.files })).digest('hex');
  await f.restart(async () => {
    const file = join(f.dataDir, 'state.json'); const state = JSON.parse(await readFile(file, 'utf8'));
    state.apps[project.id].versions['1.0.0'] = legacy;
    state.schemaVersion = 5; delete state.mail;
    await writeFile(file, JSON.stringify(state));
  });
  client = await f.session();
  const launched = (await json(await client.api(`/api/apps/${project.id}/launch`))).url;
  const response = await fetch(launched.replace('/index.html', '/recycle-bin/legacy.js'));
  assert.equal(response.status, 200); assert.equal(await response.text(), legacyBytes);
  assert.equal((await json(await client.api('/api/apps'))).apps[0].versions[0].digest, legacy.digest);
});

test('Mailbox HTTP requires desktop authority and durably sends one copy between local mailboxes', async t => {
  const f = await fixture(t); let client = await f.session();
  for (const path of ['/api/mail', '/api/mail/people', `/api/mail/drafts/letter-${randomUUID()}`]) {
    assert.equal((await fetch(`${f.app.platformOrigin}${path}`)).status, 403);
    assert.equal((await client.api(path, 'GET', undefined, { Origin: f.app.runnerOrigin })).status, 403);
    assert.equal((await client.api(path, 'GET', undefined, { Origin: 'null' })).status, 403);
  }
  const from = (await json(await client.api('/api/mail/people', 'POST', { name: 'Parent', color: 'green' }), 201)).person;
  const to = (await json(await client.api('/api/mail/people', 'POST', { name: 'Kid', color: 'purple' }), 201)).person;
  const id = `letter-${randomUUID()}`;
  const draft = (await json(await client.api(`/api/mail/drafts/${id}`, 'PUT', { revision: 0, from: from.id, to: to.id, subject: 'Garden note', body: 'A local hello. 🌱', replyTo: null, trashed: false }))).draft;
  const message = (await json(await client.api(`/api/mail/drafts/${id}/send`, 'POST', { revision: draft.revision }))).message;
  assert.equal(message.body, 'A local hello. 🌱');
  assert.deepEqual((await json(await client.api(`/api/mail/drafts/${id}/send`, 'POST', { revision: draft.revision }))).message, message);
  const read = (await json(await client.api(`/api/mail/messages/${id}`, 'PATCH', { personId: to.id, action: 'read' }))).message;
  assert.ok(read.readAt);
  await f.restart(); client = await f.session();
  const mail = (await json(await client.api('/api/mail'))).mail;
  assert.equal(Object.keys(mail.messages).length, 1); assert.equal(Object.keys(mail.drafts).length, 0); assert.deepEqual(mail.messages[id], read);
  assert.equal((await fetch(`${f.app.runnerOrigin}/api/mail`, { headers: { 'X-KidOS-Token': client.token } })).status, 404);
});

test('Explore catalog and sandboxed real form routes remain separate from desktop authority', async t => {
  const f = await fixture(t); const client = await f.session();
  const catalog = (await json(await client.api('/api/explore'))).sites;
  assert.equal(catalog.length, 6);
  for (const site of catalog) {
    const page = await fetch(`${f.app.runnerOrigin}${site.path}`);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /sandbox allow-scripts allow-forms/);
    assert.match(await page.text(), /<form method="post"/);
  }
  const result = await fetch(`${f.app.runnerOrigin}/explore/sites/science/answer`, { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'choice=evaporation' });
  assert.equal(result.status, 200); assert.match(await result.text(), /POST received/); assert.equal(result.headers.get('access-control-allow-origin'), null);
  const denied = await fetch(`${f.app.runnerOrigin}/explore/sites/science/answer`, { method: 'POST', headers: { Origin: 'https://unrelated.invalid', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'choice=evaporation' });
  assert.equal(denied.status, 403);
  const prediction = await fetch(`${f.app.runnerOrigin}/explore/api/prediction`, { method: 'POST', headers: { Origin: f.app.platformOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ change: 'evaporation' }) });
  assert.equal(prediction.headers.get('access-control-allow-origin'), f.app.platformOrigin); assert.equal((await json(prediction)).saved, false);
  assert.equal((await fetch(`${f.app.runnerOrigin}/explore/api/prediction`, { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, body: '{"change":"evaporation"}' })).status, 403);
});

test('Library reader modules and every pinned asset are available locally and packaged', async t => {
  const f = await fixture(t);
  const manifest = JSON.parse(await readFile(new URL('../../apps/desktop/library-vendor/manifest.json', import.meta.url)));
  const releasePaths = new Set(JSON.parse(await readFile(new URL('../../os/raspberry-pi/source-files.json', import.meta.url))));
  const paths = ['library.mjs', 'library-readers.mjs', 'library-extras.css', ...manifest.assets.map(asset => asset.path)];
  for (const path of paths) {
    assert.ok(releasePaths.has(`apps/desktop/${path}`), `included in release: ${path}`);
    const response = await fetch(`${f.app.platformOrigin}/${path}`);
    assert.equal(response.status, 200, path);
    if (path.endsWith('.mjs')) assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal((await response.arrayBuffer()).byteLength > 0, true);
  }
  assert.ok(releasePaths.has('apps/desktop/library-vendor/manifest.json'));
  const desktop = await fetch(f.app.platformOrigin);
  assert.match(desktop.headers.get('content-security-policy'), /worker-src 'self'/);
  assert.doesNotMatch(desktop.headers.get('content-security-policy'), /unsafe-eval/);
});
