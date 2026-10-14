import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { MAX_PACKAGE_BYTES, packageURL, startPackageProxy } from '../../os/linux-test/package-proxy.mjs';

const packagePath = 'http://deb.debian.org/debian/pool/main/test.deb';
async function fixture(t, fetchImpl, options = {}) {
  const events = new EventEmitter(), logs = [], errors = [];
  const server = await startPackageProxy(0, { fetchImpl, ...options, log: entry => { logs.push(entry); events.emit('log', entry); }, logError: error => errors.push(error) });
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  return { server, logs, errors, port: server.address().port, nextLog: () => once(events, 'log').then(([entry]) => entry) };
}
function readProxy(port, { method = 'GET', path = packagePath } = {}) {
  return new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port, method, path }, response => {
      const chunks = [];
      const result = error => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks), error });
      response.on('data', bytes => chunks.push(bytes));
      response.on('end', () => result(null));
      response.on('error', result);
    });
    req.on('error', error => resolve({ status: null, body: Buffer.alloc(0), error }));
    req.end();
  });
}

test('VM package proxy permits official repository reads through HTTPS only', () => {
  assert.equal(packageURL('http://deb.debian.org/debian/dists/trixie/InRelease').href, 'https://deb.debian.org/debian/dists/trixie/InRelease');
  assert.equal(packageURL('https://security.debian.org/debian-security/dists/trixie-security/InRelease').hostname, 'security.debian.org');
  for (const url of ['http://127.0.0.1/debian/foo', 'http://deb.debian.org.evil.example/debian/foo', 'http://deb.debian.org:8888/debian/foo', 'http://user:secret@deb.debian.org/debian/foo', 'file:///debian/foo', 'https://deb.debian.org/private', 'http://deb.debian.org/debian/../private']) assert.throws(() => packageURL(url));
  assert.throws(() => startPackageProxy(0, { maxBytes: MAX_PACKAGE_BYTES + 1 }), /Invalid/);
});

test('package proxy refuses POST and CONNECT before any upstream request', { timeout: 5000 }, async t => {
  let fetched = 0;
  const f = await fixture(t, () => { fetched++; throw new Error('Must not fetch'); });
  assert.equal((await readProxy(f.port, { method: 'POST' })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: f.port, method: 'CONNECT', path: 'deb.debian.org:443' });
    req.on('connect', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 403); assert.equal(fetched, 0);
  assert.deepEqual(f.logs.map(entry => [entry.method, entry.bytes]), [['POST', 0], ['CONNECT', 0]]);
});

test('package proxy validates redirects before following and cancels forbidden redirect bodies', { timeout: 5000 }, async t => {
  const calls = []; let cancelled = false;
  const f = await fixture(t, async (url, options) => {
    calls.push(url.href); assert.equal(options.redirect, 'manual');
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { location: 'http://127.0.0.1:9999/private' } });
  });
  const response = await readProxy(f.port);
  assert.equal(response.status, 403); assert.equal(cancelled, true);
  assert.deepEqual(calls, ['https://deb.debian.org/debian/pool/main/test.deb']);
  assert.equal(f.logs[0].bytes, 0); assert.equal(f.logs[0].completed, false);
});

test('package proxy logs actual bytes and does not trust a short declared GET length', { timeout: 5000 }, async t => {
  const body = Buffer.from('This is an original synthetic package fixture.');
  const f = await fixture(t, async () => new Response(body, { headers: { 'content-length': '1', 'content-type': 'application/octet-stream' } }), { maxBytes: 128 });
  const logged = f.nextLog(), response = await readProxy(f.port), entry = await logged;
  assert.equal(response.status, 200); assert.equal(response.error, null); assert.deepEqual(response.body, body);
  assert.equal(response.headers['content-length'], undefined);
  assert.equal(entry.bytes, body.length); assert.equal(entry.forwardedBytes, body.length); assert.equal(entry.completed, true);
});

test('package proxy bounds streamed bytes and cancels overflow with absent or dishonest size headers', { timeout: 5000 }, async t => {
  for (const length of [null, '1']) {
    let produced = 0, cancelled = false, signal;
    const f = await fixture(t, async (url, options) => {
      signal = options.signal;
      const body = new ReadableStream({
        pull(controller) { produced++; controller.enqueue(new Uint8Array(16)); if (produced === 10000) controller.close(); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 });
      return new Response(body, { headers: length === null ? {} : { 'content-length': length } });
    }, { maxBytes: 32 });
    const logged = f.nextLog(), response = await readProxy(f.port), entry = await logged;
    assert.ok(response.error, 'An overflow must not finish as a successful complete response.');
    assert.ok(response.body.length <= 32); assert.equal(entry.bytes, 48); assert.equal(entry.forwardedBytes, 32);
    assert.equal(entry.completed, false); assert.equal(cancelled, true); assert.equal(signal.aborted, true);
    assert.ok(produced < 10, `Stopped the source promptly after ${produced} chunks.`);
    assert.match(f.errors[0].message, /stream exceeds/);
  }
});

test('package proxy rejects oversized declared files without reading or forwarding them', { timeout: 5000 }, async t => {
  let produced = 0, cancelled = false;
  const f = await fixture(t, async () => new Response(new ReadableStream({ pull() { produced++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 }), { headers: { 'content-length': '33' } }), { maxBytes: 32 });
  const response = await readProxy(f.port);
  assert.equal(response.status, 403); assert.equal(produced, 0); assert.equal(cancelled, true);
  assert.equal(f.logs[0].bytes, 0); assert.equal(f.logs[0].forwardedBytes, 0);
});

test('package proxy cancels upstream when its local client disconnects', { timeout: 5000 }, async t => {
  let cancelled = false, signal;
  const f = await fixture(t, async (url, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; } }));
  });
  const logged = f.nextLog();
  await new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: f.port, path: packagePath }, response => {
      response.once('data', () => { response.destroy(); resolve(); });
      response.on('error', () => {});
    });
    req.on('error', reject); req.end();
  });
  const entry = await logged;
  assert.equal(signal.aborted, true); assert.equal(cancelled, true); assert.equal(entry.completed, false); assert.equal(entry.bytes, 16);
});
