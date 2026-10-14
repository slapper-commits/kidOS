import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExploreHandler, exploreCatalog } from './explore.mjs';
import { exploreLocation, exploreURL, inspectExploreRequest } from '../../apps/desktop/explore-request.mjs';
import { startKidOS } from './server.mjs';

const desktop = 'http://127.0.0.1:8877';
async function fixture(t) {
  let handler, origin;
  const server = createServer(async (req, res) => {
    try {
      if (!await handler(req, res, new URL(req.url, origin))) { res.writeHead(404); res.end(); }
    } catch (error) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  handler = createExploreHandler({ platformOrigin: desktop, runnerOrigin: origin });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { origin, get: (path, options = {}) => fetch(`${origin}${path}`, options) };
}

test('Explore serves six linked local lessons with opaque frames and no external dependencies', async t => {
  const f = await fixture(t);
  const sites = exploreCatalog();
  assert.equal(sites.length, 6);
  assert.deepEqual(new Set(sites.map(site => site.id)), new Set(['science', 'space', 'nature', 'newspaper', 'workshop', 'personal']));
  for (const site of sites) {
    const response = await f.get(site.path);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, new RegExp(site.name));
    assert.match(page, /method="post"/);
    for (const match of page.matchAll(/(?:href|src|action)="([^"]+)"/g)) assert.ok(match[1].startsWith('/explore/'), match[1]);
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /sandbox allow-scripts allow-forms$/);
    assert.doesNotMatch(csp, /allow-same-origin|unsafe-inline|unsafe-eval/);
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  for (const asset of ['/explore/site.css', '/explore/location.js']) assert.equal((await f.get(asset)).status, 200);
  const personal = await (await f.get('/explore/sites/personal/')).text();
  assert.match(personal, /invented character/);
  const newspaper = await (await f.get('/explore/sites/newspaper/')).text();
  assert.match(newspaper, /not live news/);
});

test('Explore search returns matching real pages and rejects ambiguous or oversized queries', async t => {
  const f = await fixture(t);
  const response = await f.get('/explore/api/search?q=moon', { headers: { Origin: desktop } });
  const result = await response.json();
  assert.ok(result.sites.some(site => site.id === 'space'));
  assert.ok(!result.sites.some(site => site.id === 'nature'));
  assert.equal(result.saved, false);
  assert.equal(response.headers.get('access-control-allow-origin'), desktop);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.deepEqual(exploreCatalog('a-phrase-that-is-not-present'), []);
  for (const query of ['?q=x&q=y', '?next=https://example.com', `?q=${'x'.repeat(81)}`, '?q=%00']) assert.equal((await f.get(`/explore/api/search${query}`)).status, 400);
});

test('opaque frames can load only the fixed stylesheet and location script with Origin:null', async t => {
  const f = await fixture(t);
  for (const [path, type] of [['/explore/site.css', 'text/css'], ['/explore/location.js', 'text/javascript']]) {
    const direct = await f.get(path);
    const frame = await f.get(path, { headers: { Origin: 'null' } });
    assert.equal(frame.status, 200);
    assert.ok(frame.headers.get('content-type').startsWith(type));
    assert.equal(await frame.text(), await direct.text());
    assert.equal(frame.headers.get('access-control-allow-credentials'), null);
    assert.equal(frame.headers.get('access-control-allow-origin'), null);
    assert.equal((await f.get(path, { headers: { Origin: 'https://example.com' } })).status, 403);
    assert.equal((await f.get(path, { method: 'POST', headers: { Origin: 'null' } })).status, 403);
    assert.equal((await f.get(`${path}?next=anything`, { headers: { Origin: 'null' } })).status, 400);
  }
  for (const path of ['/explore/api/moon', '/explore/api/search', '/explore/sites/space/', '/explore/unknown.js']) {
    assert.equal((await f.get(path, { headers: { Origin: 'null' } })).status, 403, path);
  }
});

test('every lesson form accepts only its fixed choices and returns nonpersistent HTML', async t => {
  const f = await fixture(t);
  const choices = { science: 'evaporation', space: 'sun', nature: 'visits', newspaper: 'opinion', workshop: 'GET', personal: 'maker' };
  for (const [id, choice] of Object.entries(choices)) {
    const response = await f.get(`/explore/sites/${id}/answer`, { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ choice }) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /This response is not saved/);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  for (const body of ['choice=__proto__', 'choice=constructor', 'choice=evaporation&choice=condensation', 'name=evaporation', 'choice=%3Cscript%3E']) {
    assert.equal((await f.get('/explore/sites/science/answer', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })).status, 400);
  }
  assert.equal((await f.get('/explore/sites/science/answer')).status, 405);
});

test('JSON request lab has strict methods, choices, content types, size and CORS', async t => {
  const f = await fixture(t);
  const post = (body, extra = {}) => f.get('/explore/api/prediction', { method: 'POST', headers: { Origin: desktop, 'Content-Type': 'application/json', ...extra }, body });
  let response = await post(JSON.stringify({ change: 'evaporation' }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).received, { change: 'evaporation' });
  assert.equal(response.headers.get('x-kidos-request-protocol'), 'HTTP/1.1');
  for (const body of ['null', '[]', '{}', '{broken', '{"change":"__proto__"}', '{"change":"evaporation","filename":"/tmp/a"}']) assert.equal((await post(body)).status, 400);
  assert.equal((await post('x'.repeat(1025))).status, 413);
  assert.equal((await post('{}', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('{}', { 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal((await post('{"change":"evaporation"}', { Origin: 'null' })).status, 403);
  assert.equal((await post('{"change":"evaporation"}', { Origin: 'https://example.com' })).status, 403);
  response = await f.get('/explore/api/prediction', { method: 'OPTIONS', headers: { Origin: desktop, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), desktop);
  assert.equal((await f.get('/explore/api/prediction', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })).status, 403);
  assert.equal((await f.get('/explore/api/moon', { method: 'DELETE' })).status, 405);
});

test('raw traversal, encoded paths, host aliases and unknown routes cannot leave Explore', async t => {
  const f = await fixture(t);
  async function raw(path, host) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(f.origin, { path, headers: host ? { Host: host } : {} }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      req.on('error', reject); req.end();
    });
  }
  for (const path of ['/explore/%2e%2e/api/session', '/explore/sites/../api/moon', '/explore/sites/%73cience/', '/explore/./site.css']) assert.equal(await raw(path), 400, path);
  assert.equal(await raw('/explore/api/moon', 'localhost'), 403);
  for (const path of ['/explore/api/session', '/explore/api/projects', '/explore/sites/unknown/', '/explore/sites/science/secret.txt']) assert.equal((await f.get(path)).status, 404);
});

test('request inspector reads actual HTTP responses and strips all ambient credentials', async t => {
  const f = await fixture(t);
  const seen = [];
  const fetchImpl = (url, options) => { seen.push({ url, options }); return fetch(url, { ...options, headers: { ...options.headers, Origin: desktop } }); };
  const response = await inspectExploreRequest({ origin: f.origin, path: '/explore/api/moon', fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(response.protocol, 'HTTP/1.1');
  assert.equal(JSON.parse(response.text).name, 'Moon');
  assert.equal(response.bytes, Buffer.byteLength(response.text));
  assert.ok(response.milliseconds >= 0);
  const prediction = await inspectExploreRequest({ origin: f.origin, path: '/explore/api/prediction', method: 'POST', body: { change: 'condensation' }, fetchImpl });
  assert.equal(JSON.parse(prediction.text).saved, false);
  for (const { options } of seen) {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.ok(!Object.keys(options.headers || {}).some(key => /token|cookie|authorization/i.test(key)));
  }
});

test('browser helper rejects external, encoded, traversal and capability URLs before fetching', async () => {
  for (const origin of ['https://example.com', 'http://localhost:8788', 'http://127.0.0.1:8788/', 'http://user@127.0.0.1:8788']) assert.throws(() => exploreURL(origin, '/explore/api/moon'));
  for (const path of ['//example.com', '/api/session', '/explore/../api/session', '/explore/x/../api/search', '/explore/%2e%2e/api/search', '/explore/sites/science/#x', '/explore/api/moon?next=x']) assert.throws(() => exploreURL('http://127.0.0.1:8788', path), path);
  let called = false;
  await assert.rejects(inspectExploreRequest({ origin: 'http://127.0.0.1:8788', path: '/explore/api/moon', method: 'POST', fetchImpl: () => { called = true; } }));
  assert.equal(called, false);
  const source = {}, frame = { contentWindow: source };
  const event = { source, origin: 'null', data: { type: 'kidos:explore-location', path: '/explore/sites/space/' } };
  assert.deepEqual(exploreLocation(event, frame), { siteId: 'space', path: '/explore/sites/space/' });
  for (const variant of [{ source: {} }, { origin: 'http://127.0.0.1:8788' }, { data: { ...event.data, token: 'bad' } }, { data: { ...event.data, path: '/api/session' } }]) assert.equal(exploreLocation({ ...event, ...variant }, frame), null);
});

test('request inspector bounds response bodies and reports transport failures without fabricated results', async () => {
  const options = { origin: 'http://127.0.0.1:8788', path: '/explore/api/moon' };
  await assert.rejects(inspectExploreRequest({ ...options, fetchImpl: async () => new Response('a'.repeat(32769)) }), /larger/);
  await assert.rejects(inspectExploreRequest({ ...options, fetchImpl: async () => { throw new Error('Connection refused'); } }), /Connection refused/);
});

test('sandboxed website requests cannot obtain desktop sessions or use project APIs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'kidos-explore-'));
  const app = await startKidOS({ dataDir: dir, port: 0, runnerPort: 0 });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  for (const origin of ['null', app.runnerOrigin]) {
    const response = await fetch(`${app.platformOrigin}/api/session`, { headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(response.status, 403);
    const project = await fetch(`${app.platformOrigin}/api/projects`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"name":"Not permitted"}' });
    assert.equal(project.status, 403);
  }
});
