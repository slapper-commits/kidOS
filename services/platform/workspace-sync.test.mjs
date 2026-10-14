import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceSync } from '../../apps/desktop/workspace-sync.mjs';
const initial = () => ({ revision: 0, windows: [], activeId: null, editorDraft: null });
const fixture = api => {
  let value = initial(); const statuses = [];
  const sync = createWorkspaceSync({ api, snapshot: () => value, onStatus: state => statuses.push(state), delay: 100000 });
  sync.start(initial());
  return { sync, statuses, set: next => { value = next; sync.schedule(); } };
};
const changed = label => ({ windows: [{ id: label }], activeId: label, editorDraft: null });
test('recovery writes are serialized and a newer draft remains queued behind its predecessor', async t => {
  let release; const calls = [];
  const f = fixture(async (_path, options) => { calls.push(options.body); if (calls.length === 1) await new Promise(resolve => { release = resolve; }); return { workspace: { ...options.body, revision: options.body.revision + 1 } }; });
  t.after(f.sync.stop); f.set(changed('first')); const saving = f.sync.flush();
  f.set(changed('latest')); assert.equal(calls.length, 1); release(); await saving;
  assert.equal(calls.length, 2); assert.equal(calls[1].revision, 1); assert.equal(calls[1].activeId, 'latest');
  assert.equal(f.sync.hasPending(), false); assert.equal(f.sync.matchesCurrent(), true);
});
test('unchanged state does not write, and an unavailable service retains pending work for retry', async t => {
  let fails = true, writes = 0, server = initial();
  const f = fixture(async (_path, options) => {
    if (!options) return { workspace: server };
    writes++; if (fails) throw new Error('offline'); server = { ...options.body, revision: 1 }; return { workspace: server };
  });
  t.after(f.sync.stop); f.set(initial()); await f.sync.flush(); assert.equal(writes, 0);
  f.set(changed('draft')); await f.sync.flush(); assert.equal(f.sync.hasPending(), true); assert.equal(f.statuses.at(-1).error, 'offline');
  fails = false; await f.sync.retry(); assert.equal(f.sync.matchesCurrent(), true); assert.equal(writes, 2);
});
test('a revision conflict does not overwrite another browser or silently rebase a recovery draft', async t => {
  const calls = [];
  const f = fixture(async (_path, options) => { calls.push(options?.body); if (options) throw Object.assign(new Error('stale'), { status: 409 }); return { workspace: { ...changed('other'), revision: 5 } }; });
  t.after(f.sync.stop); f.set(changed('mine')); await f.sync.flush();
  assert.equal(f.statuses.at(-1).conflict, true); assert.equal(f.sync.hasPending(), true);
  await f.sync.retry(); f.set(changed('newer-mine')); await f.sync.flush(); assert.equal(calls.length, 2);
});
test('a lost response is recovered only when the server payload exactly matches our last attempt', async t => {
  let server = initial(), first = true;
  const f = fixture(async (_path, options) => {
    if (!options) return { workspace: server };
    if (options.body.revision !== server.revision) throw Object.assign(new Error('stale'), { status: 409 });
    server = { ...options.body, revision: server.revision + 1 };
    if (first) { first = false; throw new Error('lost response'); }
    return { workspace: server };
  });
  t.after(f.sync.stop); f.set(changed('mine')); await f.sync.flush(); assert.equal(f.sync.hasPending(), true);
  await f.sync.retry(); assert.equal(f.sync.matchesCurrent(), true); assert.equal(server.revision, 1);
});
test('a failed pending write cannot be mistaken for a durable recovery copy', async t => {
  const f = fixture(async () => { throw new Error('disk full'); }); t.after(f.sync.stop);
  f.set({ ...changed('make'), editorDraft: { files: { 'index.html': 'recover me' }, baseRevision: 7 } });
  await f.sync.flush(); assert.equal(f.sync.matchesCurrent(), false); assert.equal(f.sync.hasPending(), true);
});
test('lost responses preserve acknowledgement evidence when newer edits arrive before retry', async t => {
  for (const editWhileRunning of [true, false]) {
    let server = initial(), first = true, release;
    const revisions = [];
    const f = fixture(async (_path, options) => {
      if (!options) return { workspace: server };
      revisions.push(options.body.revision);
      if (options.body.revision !== server.revision) throw Object.assign(new Error('stale'), { status: 409 });
      server = { ...options.body, revision: server.revision + 1 };
      if (first) { first = false; if (editWhileRunning) await new Promise(resolve => { release = resolve; }); throw new Error('lost response'); }
      return { workspace: server };
    });
    t.after(f.sync.stop);
    f.set(changed('first draft')); const writing = f.sync.flush();
    if (editWhileRunning) { f.set(changed('latest draft')); release(); }
    await writing;
    if (!editWhileRunning) f.set(changed('latest draft'));
    await f.sync.retry();
    assert.deepEqual(revisions, [0, 1]);
    assert.equal(server.revision, 2); assert.equal(server.activeId, 'latest draft');
    assert.equal(f.sync.matchesCurrent(), true); assert.equal(f.statuses.at(-1).conflict, false);
  }
});
test('uncertain writes do not authorize overwriting a later browser revision even with matching content', async t => {
  let server = initial(), first = true;
  const f = fixture(async (_path, options) => {
    if (!options) return { workspace: server };
    if (first) { first = false; server = { ...options.body, revision: 1 }; throw new Error('lost response'); }
    throw Object.assign(new Error('stale'), { status: 409 });
  });
  t.after(f.sync.stop);
  f.set(changed('first draft')); await f.sync.flush();
  server.revision = 2; // Another browser wrote after the uncertain commit.
  f.set(changed('latest draft')); await f.sync.retry();
  assert.equal(f.statuses.at(-1).conflict, true);
  assert.equal(f.sync.hasPending(), true); assert.equal(f.sync.matchesCurrent(), false);
  assert.equal(server.activeId, 'first draft');
});
test('retry after an uncertain write can recover when edits return to the acknowledged arrangement', async t => {
  let server = initial(), first = true;
  const f = fixture(async (_path, options) => {
    if (!options) return { workspace: server };
    if (options.body.revision !== server.revision) throw Object.assign(new Error('stale'), { status: 409 });
    server = { ...options.body, revision: server.revision + 1 };
    if (first) { first = false; throw new Error('lost response'); }
    return { workspace: server };
  });
  t.after(f.sync.stop);
  f.set(changed('first draft')); await f.sync.flush();
  f.set(initial());
  await f.sync.retry();
  assert.equal(server.activeId, null);
  assert.equal(server.revision, 2);
  assert.equal(f.sync.matchesCurrent(), true);
});
test('repeated transport loss does not replace uncertainty evidence with newer unsent drafts', async t => {
  let server = initial(), first = true, failRead = true;
  const calls = [];
  const f = fixture(async (_path, options) => {
    if (!options) {
      calls.push('GET');
      if (failRead) { failRead = false; throw new Error('retry response lost'); }
      return { workspace: server };
    }
    calls.push(`PUT ${options.body.activeId}@${options.body.revision}`);
    if (options.body.revision !== server.revision) throw Object.assign(new Error('stale'), { status: 409 });
    server = { ...options.body, revision: server.revision + 1 };
    if (first) { first = false; throw new Error('first response lost after commit'); }
    return { workspace: server };
  });
  t.after(f.sync.stop);
  f.set(changed('A')); await f.sync.flush();
  f.set(changed('B')); await f.sync.retry();
  assert.equal(f.sync.hasPending(), true); assert.equal(f.statuses.at(-1).conflict, false);
  f.set(changed('C')); await f.sync.retry();
  assert.deepEqual(calls, ['PUT A@0', 'GET', 'GET', 'PUT C@1']);
  assert.equal(server.activeId, 'C'); assert.equal(server.revision, 2); assert.equal(f.sync.matchesCurrent(), true);
});
test('an uncommitted attempt followed by another lost committed attempt recovers later typing', async t => {
  let server = initial(), writes = 0;
  const f = fixture(async (_path, options) => {
    if (!options) return { workspace: server };
    writes++;
    if (writes === 1) throw new Error('A never reached the server');
    if (options.body.revision !== server.revision) throw Object.assign(new Error('stale'), { status: 409 });
    server = { ...options.body, revision: server.revision + 1 };
    if (writes === 2) throw new Error('B committed but its response was lost');
    return { workspace: server };
  });
  t.after(f.sync.stop);
  f.set(changed('A')); await f.sync.flush();
  f.set(changed('B')); await f.sync.retry();
  assert.equal(server.activeId, 'B'); assert.equal(server.revision, 1);
  f.set(changed('C')); await f.sync.retry();
  assert.equal(server.activeId, 'C'); assert.equal(server.revision, 2);
  assert.equal(f.sync.matchesCurrent(), true); assert.equal(f.statuses.at(-1).conflict, false);
});
