import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { endianness } from 'node:os';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_IDS, DOCUMENT_URL, ORIGIN, SOURCE, EXTENSION_ID, EXTENSION_ORIGIN, HOST_NAME, MAX_BYTES, validRequest, validSender, validNativeRequest, validResponse, success, failure } from '../../os/native-session/extension/protocol.mjs';
import { registerWorker, responseFailure } from '../../os/native-session/extension/worker.mjs';
import { commandFor, activationMatches, listApps, readFrame, encodeFrame, launch, handleRequest } from '../../os/native-session/host.mjs';
import { FILES, protectedStat, validateRegistration, hostManifest } from '../../os/native-session/registration.mjs';
import { parseOptions } from '../../os/native-session/install-vm.mjs';

const id = '1795adce-a313-49d1-997e-5bb2beca3158';
const vmId = '11111111-2222-4333-8444-555555555555';
const request = (appId) => ({ source: SOURCE, type: 'request', requestId: id, method: appId ? 'launch' : 'listApps', ...(appId ? { appId } : {}) });
const sender = () => ({ id: EXTENSION_ID, frameId: 0, origin: ORIGIN, url: DOCUMENT_URL, tab: { id: 1, url: DOCUMENT_URL } });
const envelope = (r = request()) => ({ request: r, context: { origin: ORIGIN, url: DOCUMENT_URL, frameId: 0 } });
const apps = () => APP_IDS.map(id => ({ id, name: id, available: true }));
const header = size => { const b = Buffer.alloc(4); endianness() === 'LE' ? b.writeUInt32LE(size) : b.writeUInt32BE(size); return b; };

test('extension key pins only the expected native host caller and minimal permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../os/native-session/extension/manifest.json', import.meta.url)));
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  assert.equal([...digest].map(c => String.fromCharCode(97 + parseInt(c, 16))).join(''), EXTENSION_ID);
  assert.deepEqual(manifest.permissions, ['nativeMessaging']);
  assert.equal(manifest.version, '1.2.0', 'Puzzle Box requires a new extension deployment version and explicit reload');
  const workerSource = await readFile(new URL('../../os/native-session/extension/worker.mjs', import.meta.url), 'utf8');
  assert.ok(workerSource.includes(`from './protocol.mjs?v=${manifest.version}'`), 'the worker must fetch the protocol version matching its manifest');
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
  assert.equal(manifest.content_scripts[0].all_frames, false);
  assert.equal(manifest.content_scripts[0].match_about_blank, false);
  assert.equal(manifest.content_scripts[0].match_origin_as_fallback, false);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.deepEqual(hostManifest().allowed_origins, [EXTENSION_ORIGIN]);
});

test('request boundary refuses unknown operations, argument injection and wrong frame/origin/document', () => {
  assert.ok(validRequest(request()));
  for (const app of APP_IDS) assert.ok(validRequest(request(app)));
  for (const r of [null, [], { ...request(), method: 'exec' }, { ...request('paint'), args: ['x'] }, { ...request('paint'), appId: '../paint' }, { ...request(), requestId: 'x'.repeat(5000) }]) assert.equal(validRequest(r), false);
  const altered = [
    { ...sender(), id: 'other' }, { ...sender(), frameId: 1 }, { ...sender(), origin: 'null' },
    { ...sender(), origin: 'http://127.0.0.1:8788' }, { ...sender(), url: `${DOCUMENT_URL}runner` },
    { ...sender(), url: `${DOCUMENT_URL}?frame=1` }, { ...sender(), url: `${DOCUMENT_URL}#route` },
    { ...sender(), tab: { id: 1, url: `${DOCUMENT_URL}wrong` } }, { ...sender(), tab: { id: 1 } },
    { ...sender(), tab: { id: -1, url: DOCUMENT_URL } },
  ];
  assert.ok(validSender(sender()));
  for (const s of altered) assert.equal(validSender(s), false);
  assert.equal(validSender(sender(), 'wrong-runtime'), false);
  for (const context of [{ ...envelope().context, origin: 'null' }, { ...envelope().context, frameId: 1 }, { ...envelope().context, url: `${DOCUMENT_URL}explore` }, { ...envelope().context, command: 'anything' }]) assert.equal(validNativeRequest({ request: request(), context }), false);
  assert.equal(validNativeRequest({ ...envelope(), executable: '/bin/sh' }), false);
});

function worker({ timeoutMs = 50, native } = {}) {
  let listener; const calls = [];
  const api = { runtime: { id: EXTENSION_ID, onMessage: { addListener(fn) { listener = fn; } }, sendNativeMessage(host, value, callback) { calls.push({ host, value, callback }); native?.(callback); } } };
  registerWorker(api, { timeoutMs, clock: () => 100 });
  return { api, calls, send: (...args) => listener(...args) };
}
test('worker independently rejects invalid senders and forwards only validated context', () => {
  const w = worker(); const responses = [];
  for (const s of [{ ...sender(), origin: 'null' }, { ...sender(), frameId: 2 }, { ...sender(), url: `${DOCUMENT_URL}explore` }, { ...sender(), tab: {} }]) assert.equal(w.send(request('paint'), s, r => responses.push(r)), false);
  assert.equal(w.send({ ...request('paint'), path: '/tmp/x' }, sender(), r => responses.push(r)), false);
  assert.equal(w.calls.length, 0);
  assert.equal(w.send(request('paint'), sender(), r => responses.push(r)), true);
  assert.equal(w.calls[0].host, HOST_NAME);
  assert.deepEqual(w.calls[0].value, envelope(request('paint')));
  w.calls[0].callback(success(id, { appId: 'paint', status: 'focused' }));
  assert.equal(responses[0].result.status, 'focused');
});
test('worker bounds concurrency, sanitizes native failures and expires unanswered calls', async () => {
  const w = worker({ timeoutMs: 15 }); const responses = [];
  for (let i = 0; i < 5; i++) w.send(request(), sender(), r => responses.push(r));
  assert.equal(w.calls.length, 4); assert.equal(responses[0].error.code, 'busy');
  w.calls[0].callback({ ...success(id, { apps: apps() }), secret: 'not forwarded' });
  w.api.runtime.lastError = { message: 'sensitive host detail' }; w.calls[1].callback(); delete w.api.runtime.lastError;
  w.calls[2].callback(success(id, { apps: apps() }));
  await new Promise(r => setTimeout(r, 25));
  assert.deepEqual(responses.map(r => r.ok ? 'ok' : r.error.code), ['busy', 'invalid_response', 'unavailable', 'ok', 'timeout']);
  const before = responses.length; w.calls[3].callback(success(id, { apps: apps() })); assert.equal(responses.length, before);
});
test('worker diagnostics distinguish host rejection, catalog mismatch and malformed replies without accepting any of them', () => {
  const listing = request();
  assert.equal(responseFailure(success(id, { apps: apps() }), listing), null);
  assert.equal(responseFailure(failure(null, 'invalid_request'), listing), 'host_rejected');
  assert.equal(responseFailure(success(id, { apps: apps().slice(0, 9) }), listing), 'catalog_mismatch');
  assert.equal(responseFailure(success(id, { apps: apps().toReversed() }), listing), 'catalog_mismatch');
  assert.equal(responseFailure(success(id, { apps: apps().map((app, i) => i ? app : { ...app, available: 'yes' }) }), listing), 'invalid_response');
  for (const malformed of [null, undefined]) assert.equal(responseFailure(success(id, { apps: apps().map((app, i) => i ? app : malformed) }), listing), 'invalid_response');
  assert.equal(responseFailure({ ...failure(null, 'invalid_request'), command: '/bin/sh' }, listing), 'invalid_response');
  assert.equal(responseFailure(failure(id, 'unavailable'), listing), null, 'valid native failures keep their fixed error code');
  for (const raw of [failure(null, 'invalid_request'), success(id, { apps: apps().slice(0, 9) }), success(id, { apps: apps().map((app, i) => i ? app : null) }), { ...success(id, { apps: apps() }), secret: 'not forwarded' }]) {
    const w = worker(); let reply;
    w.send(listing, sender(), value => { reply = value; });
    w.calls[0].callback(raw);
    assert.equal(reply.ok, false);
    assert.equal(validResponse(reply, listing), true);
    assert.equal(reply.error.code, responseFailure(raw, listing));
    assert.equal(Object.hasOwn(reply, 'secret'), false);
  }
});
test('worker caps sequential request rate even when each request finishes quickly', () => {
  const w = worker({ native: callback => callback(success(id, { apps: apps() })) }); const responses = [];
  for (let i = 0; i < 17; i++) w.send(request(), sender(), r => responses.push(r));
  assert.equal(w.calls.length, 16); assert.equal(responses.at(-1).error.code, 'busy');
});

test('content script accepts only its own exact top document and rechecks before replying', async () => {
  const script = await readFile(new URL('../../os/native-session/extension/content.js', import.meta.url), 'utf8');
  const location = { href: DOCUMENT_URL }; const calls = [], replies = []; let listener;
  const window = { addEventListener(type, fn) { listener = fn; }, postMessage(...args) { replies.push(args); } }; window.top = window;
  const chrome = { runtime: { sendMessage(r, callback) { calls.push({ r, callback }); } } };
  runInNewContext(script, { window, location, chrome });
  const event = data => ({ data, origin: ORIGIN, source: window });
  for (const e of [{ ...event(request()), source: {} }, { ...event(request()), origin: 'null' }, { ...event(request()), origin: 'http://127.0.0.1:8788' }, event({ ...request(), args: [] })]) listener(e);
  assert.equal(calls.length, 0);
  listener(event(request('paint'))); calls[0].callback(success(id, { appId: 'paint', status: 'started' }));
  assert.equal(replies.length, 1); assert.equal(replies[0][1], ORIGIN);
  listener(event(request('paint'))); location.href = `${DOCUMENT_URL}untrusted`; calls[1].callback(success(id, { appId: 'paint', status: 'started' }));
  listener(event(request())); assert.equal(calls.length, 2); assert.equal(replies.length, 1);
  let childListener = false; const child = { top: {}, addEventListener() { childListener = true; } };
  runInNewContext(script, { window: child, location: { href: DOCUMENT_URL }, chrome }); assert.equal(childListener, false);
});

test('content script forwards every approved app through the worker and returns its launch reply', async () => {
  const script = await readFile(new URL('../../os/native-session/extension/content.js', import.meta.url), 'utf8');
  const calls = [], replies = []; let listener;
  const window = { addEventListener(type, fn) { listener = fn; }, postMessage(...args) { replies.push(args); } }; window.top = window;
  const w = worker();
  const chrome = { runtime: { sendMessage(value, callback) {
    calls.push(value);
    assert.equal(w.send(value, sender(), callback), true);
    w.calls.at(-1).callback(success(value.requestId, { appId: value.appId, status: 'started' }));
  } } };
  runInNewContext(script, { window, location: { href: DOCUMENT_URL }, chrome });
  const event = data => ({ data, origin: ORIGIN, source: window });
  for (const appId of APP_IDS) {
    const before = calls.length;
    listener(event(request(appId)));
    assert.equal(calls.length, before + 1, `${appId} must reach the worker`);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), request(appId));
    assert.deepEqual(replies.at(-1), [success(id, { appId, status: 'started' }), ORIGIN]);
  }
  assert.equal(w.calls.length, APP_IDS.length);
  assert.equal(replies.length, APP_IDS.length);
  for (const invalid of [request('unknown'), { ...request('writer'), args: ['--anything'] }, { ...request('documents'), path: '/tmp' }]) listener(event(invalid));
  assert.equal(calls.length, APP_IDS.length);
});

test('native framing assembles partial header/body and bounds output', async () => {
  const input = new PassThrough(), frame = encodeFrame(envelope()); const result = readFrame(input);
  for (const byte of frame) input.write(Buffer.from([byte]));
  assert.deepEqual(await result, envelope());
  assert.throws(() => encodeFrame({ value: 'x'.repeat(MAX_BYTES) }), /too large/);
});
test('native framing rejects oversized headers, truncation, invalid JSON/UTF8 and multiple frames', async () => {
  const cases = [header(MAX_BYTES + 1), header(1), Buffer.concat([header(2), Buffer.from('{x')]), Buffer.concat([header(2), Buffer.from([0xc0, 0xaf])]), Buffer.concat([encodeFrame({}), encodeFrame({})])];
  for (const bytes of cases) { const input = new PassThrough(); const result = readFrame(input); input.end(bytes); await assert.rejects(result); }
  for (const bytes of [Buffer.from([1]), Buffer.concat([header(20), Buffer.from('{}')])]) { const input = new PassThrough(); const result = readFrame(input); input.end(bytes); await assert.rejects(result, /Truncated/); }
  await assert.rejects(readFrame(new PassThrough(), 5), /timed out/);
});

test('catalog checks installed executable/data and ordinary-user configuration separately', async () => {
  const seen = [];
  const inspect = async () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 1000, mode: 0o700 });
  const all = await listApps({ inspect, checkFile: async (path, options) => { seen.push({ path, options }); } });
  assert.deepEqual(all.map(a => a.id), APP_IDS); assert.ok(all.every(a => a.available));
  assert.equal(all.find(app => app.id === 'writer').name, 'Write');
  assert.ok(seen.some(c => c.path.endsWith('/ZOODEMO.HE4')));
  assert.ok(seen.some(c => c.path.endsWith('/openmsx.obm')));
  for (const table of ['tux', 'professor']) assert.ok(seen.some(c => c.path === `/usr/share/games/pinball/${table}/pinball.pbl` && c.options.read === false));
  for (const binary of ['/usr/games/kpat', '/usr/games/kmines', '/usr/games/pinball']) assert.ok(seen.some(c => c.path === binary && c.options.executable));
  const missing = await listApps({ inspect, checkFile: async path => { if (path.endsWith('/ZOODEMO.HE2')) throw new Error('missing'); } });
  assert.equal(missing.find(a => a.id === 'puttzoo').reason, 'not-installed');
  assert.ok(missing.find(a => a.id === 'paint').available);
  const missingTable = await listApps({ inspect, checkFile: async path => { if (path === '/usr/share/games/pinball/tux/pinball.pbl') throw new Error('missing'); } });
  assert.equal(missingTable.find(app => app.id === 'pinball').reason, 'not-installed');
  for (const [appId, binary] of [['solitaire', '/usr/games/kpat'], ['minesweeper', '/usr/games/kmines'], ['pinball', '/usr/games/pinball'], ['puzzlebox', '/usr/bin/python3.13'], ['puzzlebox', '/usr/games/sgt-flood'], ['puzzlebox', '/usr/lib/python3/dist-packages/gi/__init__.py']]) {
    const withoutGame = await listApps({ inspect, checkFile: async path => { if (path === binary) throw new Error('missing'); } });
    assert.equal(withoutGame.find(app => app.id === appId).reason, 'not-installed');
    assert.ok(withoutGame.filter(app => app.id !== appId).every(app => app.available));
    assert.deepEqual(commandFor(appId), { executable: '/opt/kidos-linux-test/native-files-launch.sh', args: [appId] });
  }
  const unsafe = await listApps({ inspect: async () => ({ isDirectory: () => true, isSymbolicLink: () => true, uid: 1000, mode: 0o700 }), checkFile: async () => {} });
  assert.ok(unsafe.every(a => !a.available && a.reason === 'not-configured'));
});

test('launch uses fixed wrapper/arguments, clean environment and isolated child stdio', async () => {
  let observed; const child = new EventEmitter(); child.unref = () => {};
  const status = launch('paint', { env: { WAYLAND_DISPLAY: 'wayland-0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/bus', NODE_OPTIONS: '--inspect', LD_PRELOAD: '/evil' }, spawnProcess(executable, args, options) { observed = { executable, args, options }; queueMicrotask(() => child.emit('exit', 0)); return child; } });
  assert.equal(await status, 'started'); assert.equal(observed.executable, '/opt/kidos-linux-test/native-files-launch.sh'); assert.deepEqual(observed.args, ['paint']);
  assert.equal(observed.options.stdio, 'ignore'); assert.equal(observed.options.shell, false); assert.equal(observed.options.detached, true);
  assert.equal(observed.options.env.NODE_OPTIONS, undefined); assert.equal(observed.options.env.LD_PRELOAD, undefined);
  assert.equal(observed.options.env.HOME, '/home/kidos-test');
  assert.throws(() => commandFor('paint;sh'), /Invalid/);
  for (const event of ['error', 'exit']) await assert.rejects(launch('files', { spawnProcess() { const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit(event, event === 'exit' ? 1 : new Error('private path'))); return child; } }), /launch failed/);
});
test('locked games focus only individually allowlisted toplevel IDs, with an honest fallback', async () => {
  const calls = [];
  const checkLock = (bin, args, options) => {
    calls.push({ bin, args, options });
    if (bin === '/usr/bin/flock') throw Object.assign(new Error(), { status: 1 });
    if (args.includes('app_id:scummvm')) throw Object.assign(new Error(), { status: 1 });
  };
  assert.equal(await launch('puttzoo', { checkLock, checkFile: async () => {}, spawnProcess() { assert.fail('must not duplicate game'); } }), 'focused');
  assert.deepEqual(calls.filter(c => c.bin.endsWith('wlrctl')).map(c => c.args), [['toplevel', 'find', 'app_id:scummvm'], ['toplevel', 'find', 'app_id:org.scummvm.scummvm'], ['toplevel', 'focus', 'app_id:org.scummvm.scummvm']]);
  assert.ok(calls.every(c => c.options.timeout === 500));
  assert.equal(await launch('openttd', { checkLock() { throw Object.assign(new Error(), { status: 1 }); }, checkFile: async () => {} }), 'already-running');
  assert.throws(() => activationMatches('paint'), /approved games/);
});
test('native dispatch never starts malformed, unavailable or unknown apps; launch errors are bounded', async () => {
  let starts = 0; const deps = { apps: async () => apps(), start: async () => { starts++; return 'started'; } };
  assert.equal((await handleRequest({ ...envelope(), args: [] }, deps)).error.code, 'invalid_request');
  assert.equal(starts, 0);
  assert.equal((await handleRequest(envelope(request('paint')), { ...deps, apps: async () => apps().map(a => ({ ...a, available: false })) })).error.code, 'not_installed');
  assert.equal(starts, 0);
  assert.equal((await handleRequest(envelope(request('paint')), deps)).result.status, 'started'); assert.equal(starts, 1);
  assert.equal((await handleRequest(envelope(request('paint')), { ...deps, start() { throw new Error('sensitive details'); } })).error.code, 'launch_failed');
  assert.ok(validResponse(await handleRequest(envelope(), deps), request()));
});

test('protected source receipt requires every fixed file, identity and safe metadata', () => {
  const stat = { isFile: () => true, isSymbolicLink: () => false, nlink: 1, uid: 0, mode: 0o755 };
  assert.ok(protectedStat(stat, true));
  for (const change of [{ uid: 1000 }, { mode: 0o777 }, { mode: 0o644 }, { nlink: 2 }, { isSymbolicLink: () => true }, { isFile: () => false }]) assert.equal(protectedStat({ ...stat, ...change }, true), false);
  const receipt = { format: 1, vmId, extensionId: EXTENSION_ID, hashes: Object.fromEntries(FILES.map(file => [file, 'a'.repeat(64)])) };
  validateRegistration(receipt, vmId); assert.ok(FILES.includes('reopen.sh')); assert.ok(FILES.includes('reopen.mjs'));
  for (const change of [{ vmId: id }, { extensionId: 'x' }, { hashes: {} }, { hashes: { ...receipt.hashes, 'unexpected.sh': 'a'.repeat(64) } }]) assert.throws(() => validateRegistration({ ...receipt, ...change }, vmId), /registration/);
  assert.equal(parseOptions(['--install', '--disposable-vm-id', vmId]), vmId);
  for (const args of [[], ['--install'], ['--install', '--disposable-vm-id', '../../x'], ['--install', '--disposable-vm-id', vmId, '--force']]) assert.throws(() => parseOptions(args));
});
test('native installer refuses the development host before system mutation', { skip: process.platform === 'linux' && process.arch === 'arm64' }, () => {
  const path = fileURLToPath(new URL('../../os/native-session/install-vm.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [path, '--install', '--disposable-vm-id', vmId], { stdio: 'pipe', encoding: 'utf8' }), error => /Linux ARM64/.test(error.stderr));
});
