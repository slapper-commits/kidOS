import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeApps, NATIVE_APPS, NATIVE_ORIGIN, NATIVE_REQUIREMENT, nativeAvailabilityText, nativeEntryStatus } from '../../apps/desktop/native-apps.mjs';
import { APP_IDS, validRequest } from '../../os/native-session/extension/protocol.mjs';
import { GAME_IDS } from './games.mjs';

const NATIVE_GAMES = ['solitaire', 'minesweeper', 'pinball', 'puzzlebox'];

function fixture(t, options = {}) {
  const listeners = new Set();
  const posted = [];
  const changes = [];
  const target = {
    location: { origin: options.origin || NATIVE_ORIGIN },
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
    postMessage: (message, origin) => posted.push({ message, origin }),
  };
  let sequence = 0;
  const client = createNativeApps({ target, catalogTimeout: 25, launchTimeout: 25,
    requestId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    onChange: snapshot => changes.push(snapshot), ...options });
  t.after(() => client.dispose());
  const reply = (request, result, event = {}) => {
    const data = { source: 'kidos-native-v1', type: 'response', requestId: request.requestId, ok: true, result };
    for (const listener of listeners) listener({ source: target, origin: NATIVE_ORIGIN, data, ...event });
  };
  const apps = NATIVE_APPS.map(app => ({ id: app.id, name: app.name, available: true }));
  const ready = async entries => {
    const loading = client.refresh();
    reply(posted.at(-1).message, { apps: entries || apps });
    await loading;
  };
  return { client, target, posted, changes, reply, apps, ready, listeners };
}

test('native entries remain discoverable in a browser preview without sending requests', async t => {
  const f = fixture(t, { origin: 'http://127.0.0.1:8927' });
  assert.deepEqual(NATIVE_APPS.map(app => app.id), APP_IDS, 'desktop and extension must agree on the complete native catalog');
  assert.match(NATIVE_APPS.find(app => app.id === 'puttzoo').name, /demo/);
  assert.equal(NATIVE_APPS.find(app => app.id === 'writer').name, 'Write');
  assert.deepEqual(await f.client.refresh(), { status: 'unavailable', apps: [] });
  for (const appId of ['paint', 'writer', 'calculator', 'documents', 'downloads', ...NATIVE_GAMES]) {
    await assert.rejects(f.client.launch(appId), { code: 'unavailable', message: NATIVE_REQUIREMENT });
    assert.equal(nativeEntryStatus(f.client.snapshot(), appId), NATIVE_REQUIREMENT);
  }
  assert.equal(nativeAvailabilityText(f.client.snapshot()), NATIVE_REQUIREMENT);
  assert.equal(f.posted.length, 0);
});

test('catalog accepts only its own top-window origin, envelope and request ID', async t => {
  const f = fixture(t);
  const loading = f.client.refresh();
  const request = f.posted[0].message;
  const result = { apps: f.apps.map(app => ({ ...app, name: '<untrusted display name>' })) };
  f.reply(request, result, { source: {} });
  f.reply(request, result, { origin: 'http://127.0.0.1:8788' });
  f.reply(request, result, { origin: 'null' });
  f.reply({ ...request, requestId: 'unrelated' }, result);
  f.reply(request, result, { data: { source: 'another-client', type: 'response', requestId: request.requestId, ok: true, result } });
  assert.equal(f.client.snapshot().status, 'checking');
  f.reply(request, result);
  const snapshot = await loading;
  assert.equal(snapshot.status, 'ready');
  assert.deepEqual(snapshot.apps, f.apps.map(({ id, available }) => ({ id, available })));
  assert.equal(f.posted[0].origin, NATIVE_ORIGIN);
  assert.deepEqual(Object.keys(request).sort(), ['method', 'requestId', 'source', 'type']);
  assert.match(nativeAvailabilityText(snapshot), /own windows/);
});

test('catalog rejects duplicates, missing IDs, unexpected IDs, malformed availability and extra authority', async t => {
  const cases = [
    apps => [...apps.slice(1), apps[1]],
    apps => apps.slice(1),
    apps => apps.map((app, i) => i ? app : { ...app, id: 'terminal' }),
    apps => apps.map((app, i) => i ? app : { ...app, available: 'yes' }),
    apps => apps.map((app, i) => i ? app : { ...app, command: '/bin/sh' }),
  ];
  for (const change of cases) {
    const f = fixture(t);
    const loading = f.client.refresh();
    f.reply(f.posted[0].message, { apps: change(f.apps) });
    const snapshot = await loading;
    assert.equal(snapshot.status, 'unavailable');
    assert.deepEqual(snapshot.apps, []);
    assert.equal(snapshot.error.code, 'invalid-response');
    assert.match(nativeAvailabilityText(snapshot), /unreadable reply/);
    assert.equal(f.posted.length, 1);
  }
});

test('startup discovery retries only once after a timeout and ignores its late reply', async t => {
  const f = fixture(t, { catalogTimeout: 10 });
  const loading = f.client.refresh({ retry: true });
  assert.equal(f.client.refresh(), loading);
  await new Promise(resolve => setTimeout(resolve, 14));
  assert.equal(f.posted.length, 2);
  f.reply(f.posted[0].message, { apps: f.apps });
  assert.equal(f.client.snapshot().status, 'checking');
  f.reply(f.posted[1].message, { apps: f.apps });
  assert.equal((await loading).status, 'ready');
  const absent = fixture(t, { catalogTimeout: 5 });
  const missing = await absent.client.refresh({ retry: true });
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.error.code, 'timeout');
  assert.match(nativeAvailabilityText(missing), /did not respond/);
  assert.notEqual(nativeEntryStatus(missing, 'paint'), NATIVE_REQUIREMENT);
  assert.equal(absent.posted.length, 2);
});

test('catalog failures retain bounded connection diagnostics and clear after recovery', async t => {
  for (const [code, expected] of [['unavailable', /is unavailable/], ['invalid_request', /could not verify/], ['host_rejected', /could not verify this desktop/], ['invalid_response', /unreadable reply/], ['catalog_mismatch', /same app version/], ['timeout', /did not respond/], ['busy', /is busy/], ['HOST_UNAVAILABLE', /is unavailable/]]) {
    const f = fixture(t);
    const loading = f.client.refresh();
    const request = f.posted.at(-1).message;
    f.reply(request, null, { data: { source: 'kidos-native-v1', type: 'response', requestId: request.requestId, ok: false,
      error: { code, message: 'Internal path /private/secret must not become status text.' } } });
    const snapshot = await loading;
    assert.equal(snapshot.status, 'unavailable');
    assert.match(nativeAvailabilityText(snapshot), expected);
    assert.match(nativeEntryStatus(snapshot, 'writer'), expected);
    assert.doesNotMatch(JSON.stringify(snapshot), /private|secret/);
    assert.notEqual(nativeAvailabilityText(snapshot), NATIVE_REQUIREMENT);
    const copy = f.client.snapshot();
    copy.error.code = 'closed';
    assert.notEqual(f.client.snapshot().error.code, 'closed');
    await f.ready();
    assert.equal(f.client.snapshot().status, 'ready');
    assert.equal(f.client.snapshot().error, undefined);
  }
});

test('a failed catalog launch reports the connection failure without claiming Linux is missing', async t => {
  const f = fixture(t);
  const launching = f.client.launch('writer');
  const request = f.posted.at(-1).message;
  f.reply(request, null, { data: { source: 'kidos-native-v1', type: 'response', requestId: request.requestId, ok: false,
    error: { code: 'unavailable', message: 'Native applications are not connected on this computer.' } } });
  await assert.rejects(launching, { code: 'unavailable', message: /connection is unavailable/ });
  assert.equal(f.posted.length, 1, 'a missing connection must never send a launch');
});

test('a native launch is a deduplicated fixed-ID message with no path or shell arguments', async t => {
  const f = fixture(t);
  await f.ready();
  const launching = f.client.launch('paint');
  assert.equal(f.client.launch('paint'), launching);
  const request = f.posted.at(-1).message;
  assert.deepEqual(Object.keys(request).sort(), ['appId', 'method', 'requestId', 'source', 'type']);
  assert.equal(request.appId, 'paint');
  assert.equal(request.method, 'launch');
  assert.equal(f.posted.length, 2);
  f.reply(request, { appId: 'paint', status: 'started' });
  assert.deepEqual(await launching, { appId: 'paint', status: 'started' });
  assert.equal(f.client.snapshot().apps.some(app => Object.hasOwn(app, 'running')), false);
  await assert.rejects(f.client.launch('paint; rm -rf anything'), { code: 'unknown-app' });
  assert.equal(f.posted.length, 2);
});

test('writing tools and folders launch through requests accepted by the fixed extension protocol', async t => {
  const f = fixture(t);
  await f.ready();
  for (const appId of ['writer', 'calculator', 'documents', 'downloads']) {
    const launching = f.client.launch(appId);
    const request = f.posted.at(-1).message;
    assert.equal(validRequest(request), true, `${appId} request must cross the extension without widening its schema`);
    assert.deepEqual(Object.keys(request).sort(), ['appId', 'method', 'requestId', 'source', 'type']);
    assert.equal(request.appId, appId);
    f.reply(request, { appId, status: 'started' });
    assert.deepEqual(await launching, { appId, status: 'started' });
  }
  for (const appId of ['Documents', '/home/child/Documents', 'writer --headless', 'downloads/../']) {
    await assert.rejects(f.client.launch(appId), { code: 'unknown-app' });
  }
  assert.equal(f.posted.length, 5, 'path and command variants must never reach the extension');
});

test('native games stay distinct from browser games and launch through the fixed extension protocol', async t => {
  const f = fixture(t);
  await f.ready();
  for (const appId of NATIVE_GAMES) {
    const app = NATIVE_APPS.find(item => item.id === appId);
    assert.equal(GAME_IDS.includes(appId), false, `${appId} must not route through the browser game runner`);
    assert.equal(app.game, true, `${appId} belongs in Play`);
    assert.equal(app.shortcut, true, `${appId} belongs on the desktop when there is room`);
    assert.equal(Boolean(app.folderOnly), false, `${appId} belongs in Applications and Start`);
    assert.equal(nativeEntryStatus(f.client.snapshot(), appId), '');
    const launching = f.client.launch(appId);
    assert.equal(f.client.launch(appId), launching, 'rapid repeated clicks must share one launch');
    const request = f.posted.at(-1).message;
    assert.equal(request.appId, appId);
    assert.equal(validRequest(request), true, `${appId} request must pass the native extension`);
    assert.deepEqual(Object.keys(request).sort(), ['appId', 'method', 'requestId', 'source', 'type']);
    if (appId === 'puzzlebox') {
      assert.equal(app.name, 'Puzzle Box');
      assert.equal(validRequest({ ...request, gameId: 'solo' }), false, 'the native chooser owns individual puzzle selection');
      assert.equal(validRequest({ ...request, args: ['--generate', '100'] }), false, 'the browser cannot supply puzzle command arguments');
    }
    f.reply(request, { appId, status: 'started' });
    assert.deepEqual(await launching, { appId, status: 'started' });
  }
  for (const appId of ['kpat', 'kmines', 'pinball --table', '/usr/games/pinball', 'puzzlebox solo', '/usr/games/sgt-solo', 'solo']) {
    await assert.rejects(f.client.launch(appId), { code: 'unknown-app' });
  }
  assert.equal(f.posted.length, NATIVE_GAMES.length + 1, 'only the catalog and fixed-ID launches reach the extension');
});

test('missing native game packages remain visible as unavailable without blocking installed games', async t => {
  const f = fixture(t);
  await f.ready(f.apps.map(app => NATIVE_GAMES.includes(app.id) ? { ...app, available: false, reason: 'not-installed' } : app));
  assert.equal(f.client.snapshot().status, 'ready');
  for (const appId of NATIVE_GAMES) {
    assert.equal(nativeEntryStatus(f.client.snapshot(), appId), 'Not installed on this computer.');
    await assert.rejects(f.client.launch(appId), { code: 'not-installed', message: /Not installed/ });
  }
  assert.equal(f.posted.length, 1, 'unavailable games must never send a launch');
  const launching = f.client.launch('openttd');
  f.reply(f.posted.at(-1).message, { appId: 'openttd', status: 'started' });
  assert.equal((await launching).status, 'started');
  assert.equal(f.posted.length, 2);
});

test('launch validates matching app ID, accepted status and response shape', async t => {
  for (const result of [{ appId: 'files', status: 'started' }, { appId: 'paint', status: 'visible' }, { appId: 'paint', status: 'started', url: 'file:///tmp' }]) {
    const f = fixture(t);
    await f.ready();
    const launching = f.client.launch('paint');
    f.reply(f.posted.at(-1).message, result);
    await assert.rejects(launching, { code: 'invalid-response' });
  }
});

test('a verified focus reply is distinct from a new process or an unraised existing window', async t => {
  const f = fixture(t);
  await f.ready();
  const launching = f.client.launch('openttd');
  f.reply(f.posted.at(-1).message, { appId: 'openttd', status: 'focused' });
  assert.deepEqual(await launching, { appId: 'openttd', status: 'focused' });
});

test('launch timeouts never retry automatically and stale replies cannot complete a later launch', async t => {
  const f = fixture(t, { launchTimeout: 10 });
  await f.ready();
  const launching = f.client.launch('puttzoo');
  const first = f.posted.at(-1).message;
  await assert.rejects(launching, { code: 'timeout', message: /Check whether the app is already open/ });
  assert.equal(f.posted.length, 2);
  const next = f.client.launch('puttzoo');
  const second = f.posted.at(-1).message;
  assert.notEqual(first.requestId, second.requestId);
  f.reply(first, { appId: 'puttzoo', status: 'started' });
  f.reply(second, { appId: 'puttzoo', status: 'already-running' });
  assert.equal((await next).status, 'already-running');
  assert.equal(f.posted.length, 3);
});

test('missing apps and fixed host failures surface without a false launch', async t => {
  const f = fixture(t);
  await f.ready(f.apps.map(app => ({ ...app, available: app.id !== 'openttd', ...(app.id === 'openttd' ? { reason: 'not-installed' } : {}) })));
  await assert.rejects(f.client.launch('openttd'), { code: 'not-installed', message: /Not installed/ });
  assert.equal(f.posted.length, 1);
  assert.match(nativeAvailabilityText(f.client.snapshot()), /Some apps are not installed/);
  const launching = f.client.launch('files');
  const request = f.posted.at(-1).message;
  f.reply(request, null, { data: { source: 'kidos-native-v1', type: 'response', requestId: request.requestId, ok: false,
    error: { code: 'HOST_UNAVAILABLE', message: 'The desktop app connection is unavailable.' } } });
  await assert.rejects(launching, { code: 'HOST_UNAVAILABLE', message: 'The desktop app connection is unavailable.' });
});

test('an unavailable optional demo does not block tools, and folder setup failures recover after a fresh catalog', async t => {
  const f = fixture(t);
  await f.ready(f.apps.map(app => app.id === 'puttzoo' ? { ...app, available: false, reason: 'not-installed' }
    : app.id === 'documents' ? { ...app, available: false, reason: 'not-configured' } : app));
  assert.equal(nativeEntryStatus(f.client.snapshot(), 'puttzoo'), 'Not installed on this computer.');
  assert.equal(nativeEntryStatus(f.client.snapshot(), 'documents'), 'Not ready on this computer.');
  assert.equal(nativeEntryStatus(f.client.snapshot(), 'writer'), '');
  await assert.rejects(f.client.launch('documents'), { code: 'not-installed', message: /Documents: Not ready/ });
  await assert.rejects(f.client.launch('puttzoo'), { code: 'not-installed', message: /Putt-Putt \(demo\): Not installed/ });
  assert.equal(f.posted.length, 1, 'unavailable entries do not send launch requests');
  const writing = f.client.launch('writer');
  f.reply(f.posted.at(-1).message, { appId: 'writer', status: 'started' });
  assert.equal((await writing).status, 'started');
  await f.ready(f.apps.map(app => app.id === 'puttzoo' ? { ...app, available: false, reason: 'not-installed' } : app));
  assert.equal(nativeEntryStatus(f.client.snapshot(), 'documents'), '');
  assert.equal(f.client.snapshot().apps.find(app => app.id === 'documents').reason, undefined);
  const opening = f.client.launch('documents');
  f.reply(f.posted.at(-1).message, { appId: 'documents', status: 'started' });
  assert.equal((await opening).appId, 'documents');
});

test('disposing the connection removes the listener and rejects in-flight launches', async t => {
  const f = fixture(t);
  await f.ready();
  const launching = f.client.launch('trash');
  f.client.dispose();
  assert.equal(f.listeners.size, 0);
  await assert.rejects(launching, { code: 'closed' });
  await assert.rejects(f.client.launch('paint'), { code: 'closed' });
});
