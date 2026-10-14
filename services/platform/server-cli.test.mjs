import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function ports() {
  const sockets = [createServer(), createServer()];
  try {
    for (const socket of sockets) await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
    return sockets.map(socket => socket.address().port);
  } finally { await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve)))); }
}
function childProcess(args, options = {}) {
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  const exit = once(child, 'exit');
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  return { child, exit, get stdout() { return stdout; }, get stderr() { return stderr; } };
}
async function ready(process) {
  if (process.stdout.includes('kidOS desktop:')) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new Error(`CLI startup timed out: ${process.stderr}`)), 8000);
    const cleanup = () => { clearTimeout(timer); process.child.stdout.off('data', inspect); process.child.off('exit', exited); process.child.off('error', fail); };
    const fail = error => { cleanup(); reject(error); };
    const inspect = () => { if (process.stdout.includes('kidOS desktop:')) { cleanup(); resolve(); } };
    const exited = (code, signal) => fail(new Error(`CLI exited before startup (${code}, ${signal}): ${process.stderr}`));
    process.child.stdout.on('data', inspect); process.child.once('exit', exited); process.child.once('error', fail);
  });
}

test('actual CLI starts through current → release directory symlink and stops gracefully', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'kidos-cli-release-'));
  let running;
  t.after(async () => {
    if (running && running.child.exitCode === null && running.child.signalCode === null) { running.child.kill('SIGKILL'); await running.exit; }
    await rm(directory, { recursive: true, force: true });
  });
  const release = join(directory, 'releases', 'pilot'), current = join(directory, 'current'), data = join(directory, 'private-data');
  await mkdir(release, { recursive: true });
  for (const name of ['apps', 'services', 'packages', 'content']) await cp(join(root, name), join(release, name), { recursive: true });
  await symlink(join('releases', 'pilot'), current);
  for (const flags of [[], ['--preserve-symlinks-main']]) {
    const [platformPort, runnerPort] = await ports();
    running = childProcess([...flags, join(current, 'services/platform/server.mjs')], { cwd: current, env: { ...process.env, NODE_OPTIONS: '', KIDOS_DATA_DIR: data, KIDOS_PORT: String(platformPort), KIDOS_RUNNER_PORT: String(runnerPort) } });
    await ready(running);
    const origin = `http://127.0.0.1:${platformPort}`;
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000) });
    assert.equal(health.status, 200); assert.equal((await health.json()).name, 'kidOS');
    const desktop = await fetch(`${origin}/desktop.mjs`, { signal: AbortSignal.timeout(3000) });
    assert.equal(desktop.status, 200); assert.equal(await desktop.text(), await readFile(join(release, 'apps/desktop/desktop.mjs'), 'utf8'));
    const session = await (await fetch(`${origin}/api/session`)).json();
    assert.equal(session.runnerOrigin, `http://127.0.0.1:${runnerPort}`);
    assert.equal((await fetch(`${session.runnerOrigin}/api/session`)).status, 404);
    assert.equal(running.child.exitCode, null); assert.equal(running.child.signalCode, null);
    assert.equal((await stat(join(data, 'store.lock'))).isFile(), true);
    running.child.kill('SIGTERM');
    assert.deepEqual(await running.exit, [0, null]); assert.equal(running.stderr, '');
    await assert.rejects(stat(join(data, 'store.lock')), { code: 'ENOENT' });
    await assert.rejects(fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) }));
    await assert.rejects(fetch(`${session.runnerOrigin}/api/session`, { signal: AbortSignal.timeout(1000) }));
  }
});

test('module imports from eval and stdin-style argv do not start a service or fail on missing argv files', { timeout: 10000 }, async t => {
  const children = [];
  t.after(async () => {
    for (const process of children) if (process.child.exitCode === null && process.child.signalCode === null) { process.child.kill('SIGKILL'); await process.exit; }
  });
  for (const setup of ['delete process.argv[1];', 'process.argv[1] = "-";', 'process.argv[1] = "/nonexistent-kidos-import-entry/entry.mjs";']) {
    const source = `${setup} const server = await import(${JSON.stringify(new URL('./server.mjs', import.meta.url).href)}); console.log(typeof server.startKidOS);`;
    // Imports must not validate service settings or open any store/listener.
    const imported = childProcess(['--input-type=module', '--eval', source], { env: { ...process.env, NODE_OPTIONS: '', KIDOS_PORT: '0', KIDOS_RUNNER_PORT: '0' } });
    children.push(imported);
    assert.deepEqual(await imported.exit, [0, null]); assert.equal(imported.stdout, 'function\n'); assert.equal(imported.stderr, '');
  }
});
