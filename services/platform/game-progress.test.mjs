import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from './store.mjs';
const result = (n, score = n, won = false) => ({ roundId: n.toString(16).padStart(32, '0'), score, won });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'kidos-games-'));
  let store = await Store.open(dir);
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, get store() { return store; }, async reopen() { await store.close(); store = await Store.open(dir); } };
}
test('schema 1 upgrades preserve exact source and installation, retaining the original file', async t => {
  const f = await fixture(t);
  const project = await f.store.createProject('Existing project');
  const installed = await f.store.installProject(project.id, { revision: 1, version: '1.0.0' });
  await f.store.close();
  const old = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8')); old.schemaVersion = 1; delete old.games; delete old.trash; delete old.media; delete old.workspace; delete old.mail;
  const original = JSON.stringify(old, null, 2);
  await writeFile(join(f.dir, 'state.json'), original); await f.reopen();
  assert.deepEqual(f.store.getProject(project.id), project); assert.deepEqual(f.store.getInstalled(project.id), installed);
  assert.equal(JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8')).schemaVersion, 6);
  const archive = (await readdir(f.dir)).find(name => name.startsWith('state.pre-v6.'));
  assert.equal(await readFile(join(f.dir, archive), 'utf8'), original);
  assert.equal(await readFile(join(f.dir, 'state.backup.json'), 'utf8'), original);
  await f.reopen(); assert.equal((await readdir(f.dir)).filter(name => name.startsWith('state.pre-v6.')).length, 1);
});
test('game results survive restart, deduplicate retries, keep the best and stay separate', async t => {
  const f = await fixture(t);
  assert.equal(f.store.getGameProgress('moon-hopper').rounds, 0);
  await Promise.all([f.store.recordGameResult('moon-hopper', result(1, 85, true)), f.store.recordGameResult('moon-hopper', result(2, 12))]);
  await f.store.recordGameResult('moon-hopper', result(1, 999, true));
  await f.store.recordGameResult('tiny-racer', result(1, 30));
  const moon = f.store.getGameProgress('moon-hopper');
  assert.deepEqual([moon.best, moon.last, moon.rounds, moon.wins], [85, 12, 2, 1]);
  moon.best = 1000; assert.equal(f.store.getGameProgress('moon-hopper').best, 85);
  await f.reopen(); assert.equal(f.store.getGameProgress('moon-hopper').best, 85);
  assert.equal(f.store.getGameProgress('tiny-racer').best, 30);
  await f.store.recordGameResult('moon-hopper', result(2)); assert.equal(f.store.getGameProgress('moon-hopper').rounds, 2);
});
test('invalid score records cannot enter storage; corrupt progress recovers the previous commit', async t => {
  const f = await fixture(t);
  for (const bad of [null, [], { ...result(1), score: -1 }, { ...result(1), score: 100001 }, { ...result(1), score: 1.2 }, { ...result(1), won: 'yes' }, { ...result(1), extra: true }, { ...result(1), roundId: '../path' }]) await assert.rejects(f.store.recordGameResult('moon-hopper', bad));
  await assert.rejects(f.store.recordGameResult('__proto__', result(1)));
  await f.store.recordGameResult('moon-hopper', result(1, 50));
  await f.store.recordGameResult('moon-hopper', result(2, 60));
  await f.store.close();
  const state = JSON.parse(await readFile(join(f.dir, 'state.json'), 'utf8')); state.games['moon-hopper'].wins = 999;
  await writeFile(join(f.dir, 'state.json'), JSON.stringify(state)); await f.reopen();
  assert.match(f.store.recoveryNotice, /Recovered/); assert.equal(f.store.getGameProgress('moon-hopper').best, 50);
});
