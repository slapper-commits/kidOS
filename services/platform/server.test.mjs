import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startKidOS } from './server.mjs';

async function client(origin) {
  const session = await (await fetch(`${origin}/api/session`)).json();
  return async (path, method = 'GET', payload) => {
    const response = await fetch(`${origin}${path}`, { method, headers: { 'X-KidOS-Token': session.token, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
}
async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kidos-http-'));
  let app = await startKidOS({ dataDir, port: 0, runnerPort: 0 });
  t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { get app() { return app; }, dataDir, async restart() { await app.close(); app = await startKidOS({ dataDir, port: 0, runnerPort: 0 }); } };
}
function raw(origin, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${origin}/`, { path, headers }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
}

test('native desktop client ships as a static module without a platform launch endpoint', async t => {
  const { app } = await fixture(t);
  const path = 'apps/desktop/native-apps.mjs';
  const releasePaths = JSON.parse(await readFile(new URL('../../os/raspberry-pi/source-files.json', import.meta.url), 'utf8'));
  assert.ok(releasePaths.includes(path));
  const response = await fetch(`${app.platformOrigin}/native-apps.mjs`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.equal(await response.text(), await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'));
  assert.equal((await fetch(`${app.runnerOrigin}/native-apps.mjs`)).status, 404);
  const api = await client(app.platformOrigin);
  for (const method of ['GET', 'POST']) {
    assert.equal((await api('/api/native/launch', method, method === 'POST' ? { appId: 'paint' } : undefined)).status, 404);
  }
  const page = await fetch(app.platformOrigin);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-eval|unsafe-inline/);
});

test('create → edit → install → launch → edit again → restart preserves both source and installed bytes', async t => {
  const f = await fixture(t);
  let api = await client(f.app.platformOrigin);
  const created = await api('/api/projects', 'POST', { name: 'My color lab' });
  assert.equal(created.status, 201);
  let project = created.data.project;
  const firstFiles = { ...project.files, 'index.html': '<!doctype html><link rel="stylesheet" href="style.css"><h1>Installed original</h1><script src="script.js"></script>' };
  project = (await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: project.revision, files: firstFiles })).data.project;
  const installed = await api(`/api/projects/${project.id}/install`, 'POST', { revision: project.revision, version: '1.0.0' });
  assert.equal(installed.status, 201);
  assert.deepEqual(installed.data.app.manifest.permissions, []);
  assert.equal(installed.data.app.manifest.runtime, 'web');
  const digest = installed.data.app.digest;
  const launch = await api(`/api/apps/${project.id}/launch`);
  const launched = await fetch(launch.data.url);
  assert.equal(await launched.text(), firstFiles['index.html']);
  assert.match(launched.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.doesNotMatch(launched.headers.get('content-security-policy'), /allow-same-origin/);
  assert.match(launched.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.notEqual(new URL(launch.data.url).origin, f.app.platformOrigin);
  const changedFiles = { ...firstFiles, 'index.html': '<h1>Working copy after install</h1>' };
  project = (await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: project.revision, files: changedFiles })).data.project;
  assert.equal(await (await fetch(launch.data.url)).text(), firstFiles['index.html']);
  assert.equal((await api(`/api/projects/${project.id}/install`, 'POST', { revision: project.revision, version: '1.0.0' })).status, 409);
  assert.equal((await api(`/api/projects/${project.id}/install`, 'POST', { revision: project.revision, version: '1.0.1' })).status, 201);
  const exportResult = await api(`/api/projects/${project.id}/export`);
  assert.equal(exportResult.data.project.files['index.html'], changedFiles['index.html']);
  assert.match(exportResult.headers.get('content-disposition'), /attachment/);
  await f.restart(); api = await client(f.app.platformOrigin);
  assert.deepEqual((await api(`/api/projects/${project.id}`)).data.project.files, changedFiles);
  const apps = (await api('/api/apps')).data.apps;
  assert.equal(apps[0].currentVersion, '1.0.1');
  assert.equal(apps[0].versions.length, 2);
  assert.equal(apps[0].versions.find(v => v.version === '1.0.0').digest, digest);
  const oldLaunch = (await api(`/api/apps/${project.id}/launch?version=1.0.0`)).data.url;
  assert.equal(await (await fetch(oldLaunch)).text(), firstFiles['index.html']);
  const newLaunch = (await api(`/api/apps/${project.id}/launch`)).data.url;
  assert.equal(await (await fetch(newLaunch)).text(), changedFiles['index.html']);
});

test('API validates requests, stale revisions, paths, permissions, local host and browser origin', async t => {
  const { app } = await fixture(t);
  const api = await client(app.platformOrigin);
  const health = await (await fetch(`${app.platformOrigin}/health`)).json();
  assert.equal(health.readyForChildUse, false);
  assert.equal((await fetch(`${app.platformOrigin}/api/projects`)).status, 403);
  for (const headers of [{ Origin: 'null' }, { Origin: app.runnerOrigin }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal((await fetch(`${app.platformOrigin}/api/session`, { headers })).status, 403);
  }
  assert.equal(await raw(app.platformOrigin, '/api/session', { Host: 'attacker.example' }), 403);
  for (const path of ['/../../etc/passwd', '/%2e%2e/README.md', '/design/kid-os-desktop.fragment.html', '/.data/state.json', '/services/platform/server.mjs']) assert.ok([400, 404].includes(await raw(app.platformOrigin, path)));
  const { project } = (await api('/api/projects', 'POST', { name: 'Validation' })).data;
  const stale = await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, files: project.files, revision: 0 });
  assert.ok([400, 409].includes(stale.status));
  for (const filename of ['../escape.html', '/tmp/escape.html', 'nested/../escape.html', '%2e%2e/escape.html', 'a\\escape.html', '__proto__/evil.js']) {
    const result = await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: project.revision, files: { ...project.files, [filename]: 'bad' } });
    assert.equal(result.status, 400, filename);
  }
  assert.equal((await api(`/api/projects/${project.id}/install`, 'POST', { revision: project.revision, version: '../bad' })).status, 400);
  assert.equal((await api(`/api/projects/${project.id}/preview`, 'POST', { revision: 999 })).status, 409);
  const session = await (await fetch(`${app.platformOrigin}/api/session`)).json();
  assert.equal((await fetch(`${app.platformOrigin}/api/projects`, { method: 'POST', headers: { 'X-KidOS-Token': session.token, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(`${app.platformOrigin}/api/projects`, { method: 'POST', headers: { 'X-KidOS-Token': session.token, 'Content-Type': 'application/json' }, body: '{oops' })).status, 400);
  assert.equal((await fetch(`${app.platformOrigin}/api/projects`, { method: 'POST', headers: { 'X-KidOS-Token': session.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024) }) })).status, 413);
  assert.equal((await fetch(`${app.runnerOrigin}/api/session`)).status, 404);
});

test('preview is a saved snapshot and runner cannot read arbitrary filesystem or accept writes', async t => {
  const { app } = await fixture(t);
  const api = await client(app.platformOrigin);
  const { project } = (await api('/api/projects', 'POST', { name: 'Preview' })).data;
  const { url } = (await api(`/api/projects/${project.id}/preview`, 'POST', { revision: project.revision })).data;
  assert.equal(await (await fetch(url)).text(), project.files['index.html']);
  await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: project.revision, files: { ...project.files, 'index.html': '<h1>Changed</h1>' } });
  assert.equal(await (await fetch(url)).text(), project.files['index.html']);
  const scriptURL = new URL('script.js', url);
  assert.equal(await (await fetch(scriptURL)).text(), project.files['script.js']);
  assert.match((await fetch(scriptURL)).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal(await raw(app.runnerOrigin, new URL(url).pathname.replace('index.html', '../../state.json')), 400);
  assert.equal((await fetch(`${app.platformOrigin}/`)).status, 200);
  for (const file of ['desktop.mjs', 'styles.css', 'icons.svg', 'favicon.svg']) assert.equal((await fetch(`${app.platformOrigin}/${file}`)).status, 200);
});

async function startChild(dataDir) {
  const entry = new URL('./server.mjs', import.meta.url).href;
  const program = `import { startKidOS } from ${JSON.stringify(entry)}; const app = await startKidOS({dataDir: process.argv[1],port:0,runnerPort:0}); console.log(JSON.stringify({origin:app.platformOrigin})); process.on('SIGTERM', async()=>{await app.close();});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, dataDir], { stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = await new Promise((resolve, reject) => {
    let output = '', errors = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Service startup timed out: ${errors}`)); }, 8000);
    child.stderr.on('data', d => { errors += d; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Service exited ${code}: ${errors}`)); });
    child.stdout.on('data', d => { output += d; if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0]).origin); } });
  });
  return { child, origin };
}
async function killChild(child, signal) { const exited = once(child, 'exit'); child.kill(signal); await exited; }

test('actual process crash and fresh process preserve saved source and installed version', { timeout: 20000 }, async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kidos-process-'));
  let running;
  t.after(async () => { if (running?.child.exitCode === null && running?.child.signalCode === null) await killChild(running.child, 'SIGTERM'); await rm(dataDir, { recursive: true, force: true }); });
  running = await startChild(dataDir);
  let api = await client(running.origin);
  let { project } = (await api('/api/projects', 'POST', { name: 'Restart proof' })).data;
  project = (await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: project.revision, files: { ...project.files, 'index.html': '<h1>Saved before crash</h1>' } })).data.project;
  const installed = await api(`/api/projects/${project.id}/install`, 'POST', { revision: project.revision, version: '1.0.0' });
  assert.equal(installed.status, 201);
  assert.equal((await api('/api/games/moon-hopper/result', 'POST', { roundId: 'a'.repeat(32), score: 77, won: true })).status, 200);
  const trashSource = (await api('/api/projects', 'POST', { name: 'Trash survives crash' })).data.project;
  assert.equal((await api(`/api/projects/${trashSource.id}/trash`, 'POST', { revision: 1 })).status, 200);
  await killChild(running.child, 'SIGKILL');
  running = await startChild(dataDir); api = await client(running.origin);
  assert.equal((await api('/api/games/moon-hopper/launch')).data.progress.best, 77);
  assert.deepEqual((await api(`/api/projects/${project.id}`)).data.project.files, project.files);
  const launch = await api(`/api/apps/${project.id}/launch?version=1.0.0`);
  assert.equal(await (await fetch(launch.data.url)).text(), project.files['index.html']);
  assert.equal((await api('/api/apps')).data.apps[0].versions[0].digest, installed.data.app.digest);
  assert.equal((await api('/api/trash')).data.projects[0].id, trashSource.id);
  const restored = await api(`/api/trash/${trashSource.id}/restore`, 'POST', { revision: 2 });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.data.project.files, trashSource.files);
  assert.equal(restored.data.project.revision, 3);
});

test('Play serves local games, persists scores, and copies source into independently installed projects', async t => {
  const f = await fixture(t); let api = await client(f.app.platformOrigin);
  const catalog = await api('/api/games'); assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.data.games.map(g => g.id), ['moon-hopper', 'tiny-racer']);
  assert.equal((await fetch(`${f.app.platformOrigin}/api/games`)).status, 403);
  const round = { roundId: 'f'.repeat(32), score: 120, won: true };
  for (const id of ['moon-hopper', 'tiny-racer']) {
    const launch = await api(`/api/games/${id}/launch`); assert.equal(launch.status, 200);
    const game = await fetch(launch.data.url); assert.equal(game.status, 200);
    assert.match(game.headers.get('content-security-policy'), /sandbox allow-scripts/);
    const html = await game.text();
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.equal((await fetch(new URL(match[1], launch.data.url))).status, 200);
    const original = await (await fetch(new URL('script.js', launch.data.url))).text();
    const copied = await api(`/api/games/${id}/remix`, 'POST', {}); assert.equal(copied.status, 201);
    let { project } = copied.data; assert.equal(project.files['script.js'], original);
    assert.equal(Object.keys(project.files).length, 6);
    const installed = await api(`/api/projects/${project.id}/install`, 'POST', { revision: 1, version: '1.0.0' });
    assert.equal(installed.status, 201); assert.deepEqual(installed.data.app.manifest.permissions, []);
    const files = { ...project.files, 'script.js': original.replace('"speed":', '"speedBeforeRemix":') };
    project = (await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, revision: 1, files })).data.project;
    assert.equal(project.files['script.js'], files['script.js']);
    assert.equal(await (await fetch(new URL('script.js', launch.data.url))).text(), original);
    const installedLaunch = (await api(`/api/apps/${project.id}/launch`)).data.url;
    assert.equal(await (await fetch(new URL('script.js', installedLaunch))).text(), original);
    assert.equal((await api(`/api/games/${id}/result`, 'POST', round)).status, 200);
    assert.equal((await api(`/api/games/${id}/result`, 'POST', round)).data.progress.rounds, 1);
  }
  assert.equal((await api('/api/games/missing/launch')).status, 404);
  assert.equal((await api('/api/games/moon-hopper/remix', 'POST', { files: {} })).status, 400);
  assert.equal((await api('/api/games/moon-hopper/result', 'POST', { ...round, score: -1 })).status, 400);
  assert.equal(await raw(f.app.runnerOrigin, '/games/moon-hopper/../../state.json'), 400);
  assert.equal((await fetch(`${f.app.runnerOrigin}/games/moon-hopper/state.json`)).status, 404);
  assert.equal((await fetch(`${f.app.platformOrigin}/game-bridge.mjs`)).status, 200);
  await f.restart(); api = await client(f.app.platformOrigin);
  for (const game of (await api('/api/games')).data.games) {
    assert.equal(game.progress.best, 120); assert.equal(game.progress.wins, 1); assert.equal(game.progress.rounds, 1);
  }
  assert.equal((await api('/api/projects')).data.projects.length, 2);
  assert.equal((await api('/api/apps')).data.apps.length, 2);
});

test('Trash API hides and restores source projects while installed versions keep launching', async t => {
  const f = await fixture(t);
  let api = await client(f.app.platformOrigin);
  const { project } = (await api('/api/projects', 'POST', { name: 'Reversible folder' })).data;
  const installed = await api(`/api/projects/${project.id}/install`, 'POST', { revision: 1, version: '1.0.0' });
  const trashed = await api(`/api/projects/${project.id}/trash`, 'POST', { revision: 1 });
  assert.equal(trashed.status, 200);
  assert.equal(trashed.data.project.revision, 2);
  assert.deepEqual(trashed.data.project.files, project.files);
  assert.equal((await api('/api/projects')).data.projects.length, 0);
  const trash = (await api('/api/trash')).data.projects;
  assert.equal(trash[0].id, project.id);
  assert.equal(trash[0].revision, 2);
  assert.equal(trash[0].trashedAt, trashed.data.project.updatedAt);
  for (const action of ['', '/export']) {
    const result = await api(`/api/projects/${project.id}${action}`);
    assert.equal(result.status, 409);
    assert.match(result.data.error, /Restore/);
  }
  assert.equal((await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, files: project.files, revision: 2 })).status, 409);
  assert.equal((await api(`/api/projects/${project.id}/install`, 'POST', { revision: 2, version: '1.0.1' })).status, 409);
  assert.equal((await api(`/api/projects/${project.id}/preview`, 'POST', { revision: 2 })).status, 409);
  assert.equal((await api(`/api/projects/${project.id}/trash`, 'POST', { revision: 2 })).status, 409);
  assert.equal((await api(`/api/trash/${project.id}/restore`, 'POST', { revision: 1 })).status, 409);
  await f.restart(); api = await client(f.app.platformOrigin);
  assert.equal((await api('/api/trash')).data.projects[0].revision, 2);
  const launched = (await api(`/api/apps/${project.id}/launch`)).data.url;
  assert.equal(await (await fetch(launched)).text(), project.files['index.html']);
  assert.equal((await api('/api/apps')).data.apps[0].versions[0].digest, installed.data.app.digest);
  const restored = await api(`/api/trash/${project.id}/restore`, 'POST', { revision: 2 });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.project.revision, 3);
  assert.deepEqual(restored.data.project.files, project.files);
  assert.deepEqual((await api('/api/trash')).data.projects, []);
  assert.equal((await api('/api/projects')).data.projects[0].id, project.id);
  assert.equal((await api(`/api/projects/${project.id}`, 'PUT', { name: project.name, files: project.files, revision: 1 })).status, 409);
  assert.deepEqual((await api(`/api/projects/${project.id}/export`)).data, { schemaVersion: 1, project: restored.data.project });
});

test('Trash endpoints enforce tokens, browser origins, revision payloads and supported operations', async t => {
  const { app } = await fixture(t);
  const api = await client(app.platformOrigin);
  const { project } = (await api('/api/projects', 'POST', { name: 'Protected work' })).data;
  const session = await (await fetch(`${app.platformOrigin}/api/session`)).json();
  for (const endpoint of ['/api/trash', `/api/projects/${project.id}/trash`, `/api/trash/${project.id}/restore`]) {
    const method = endpoint === '/api/trash' ? 'GET' : 'POST';
    assert.equal((await fetch(`${app.platformOrigin}${endpoint}`, { method })).status, 403);
    assert.equal((await fetch(`${app.platformOrigin}${endpoint}`, { method, headers: { 'X-KidOS-Token': session.token, Origin: app.runnerOrigin } })).status, 403);
  }
  for (const input of [{}, { revision: '1' }, { revision: 0 }, { revision: 1, permanent: true }]) {
    assert.equal((await api(`/api/projects/${project.id}/trash`, 'POST', input)).status, 400);
    assert.equal((await api(`/api/trash/${project.id}/restore`, 'POST', input)).status, 400);
  }
  assert.equal((await api(`/api/projects/${project.id}/trash`, 'DELETE', { revision: 1 })).status, 404);
  assert.equal((await api('/api/trash', 'DELETE', {})).status, 404);
  assert.equal((await api(`/api/trash/${project.id}/restore`, 'POST', { revision: 1 })).status, 409);
  assert.equal((await api(`/api/projects/${project.id}`)).data.project.revision, 1);
});
