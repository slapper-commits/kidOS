// Temporary read-only Debian package transport for the offline VM. Start only
// while provisioning; reach it through an SSH reverse forward on guest loopback.
import { createServer } from 'node:http';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hosts = new Set(['deb.debian.org', 'security.debian.org']);
export const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
export function packageURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !hosts.has(url.hostname) || url.username || url.password || url.port || url.hash || !/^\/(?:debian|debian-security)\//.test(url.pathname)) throw new Error('Only official Debian package repository paths are allowed.');
  url.protocol = 'https:';
  return url;
}
export function startPackageProxy(port = 31281, {
  fetchImpl = fetch,
  maxBytes = MAX_PACKAGE_BYTES,
  log = event => console.log(JSON.stringify(event)),
  logError = error => console.error(`Package proxy: ${error.message}`),
} = {}) {
  // Test callers may lower the ceiling or supply a local stub. The CLI never
  // accepts alternate destinations, an injected fetch, or a higher byte limit.
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PACKAGE_BYTES || typeof fetchImpl !== 'function' || typeof log !== 'function' || typeof logError !== 'function') throw new Error('Invalid package-proxy test options.');
  let active = 0;
  const server = createServer(async (request, response) => {
    const abort = new AbortController();
    let counted = false, upstream, url, bytes = 0, forwardedBytes = 0, completed = false;
    try {
      if (!['GET', 'HEAD'].includes(request.method)) throw new Error('Read-only package proxy.');
      if (active >= 16) { response.writeHead(503); response.end(); return; }
      url = packageURL(request.url);
      active++; counted = true;
      response.on('close', () => { if (!response.writableFinished) abort.abort(); });
      for (let redirects = 0; redirects < 4; redirects++) {
        upstream = await fetchImpl(url, { method: request.method, redirect: 'manual', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]), headers: { 'Accept-Encoding': 'identity' } });
        if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
        const next = upstream.headers.get('location'); await upstream.body?.cancel();
        if (!next) throw new Error('Repository redirect lacks a destination.');
        url = packageURL(new URL(next, url).href);
      }
      if (upstream.status >= 300 && upstream.status < 400) throw new Error('Too many repository redirects.');
      const length = upstream.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maxBytes)) throw new Error('Repository file exceeds the fixture transport limit or has an invalid length.');
      const headers = {};
      for (const name of ['content-type', 'last-modified', 'etag']) if (upstream.headers.has(name)) headers[name] = upstream.headers.get(name);
      // GET framing comes from the bytes actually streamed. A false short
      // length must not let a client mistake a truncated response for success.
      if (request.method === 'HEAD' && length !== null) headers['content-length'] = length;
      response.writeHead(upstream.status, headers);
      if (request.method === 'HEAD' || !upstream.body) { await upstream.body?.cancel(); response.end(); }
      else {
        const limit = new Transform({
          transform(chunk, encoding, callback) {
            bytes += chunk.length;
            if (bytes > maxBytes) { callback(new Error('Repository stream exceeds the fixture transport limit.')); return; }
            forwardedBytes += chunk.length; callback(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(upstream.body), limit, response);
      }
      completed = true;
    } catch (error) {
      abort.abort();
      if (upstream?.body && !upstream.body.locked) await upstream.body.cancel().catch(() => {});
      if (!response.headersSent) { response.writeHead(403, { 'Content-Type': 'text/plain' }); response.end('Package request refused or unavailable.\n'); }
      else response.destroy();
      logError(error);
    } finally {
      if (counted) active--;
      log({ method: request.method, url: url?.href || null, status: response.statusCode, upstreamStatus: upstream?.status || null, bytes, forwardedBytes, completed });
    }
  });
  server.on('connect', (request, socket) => {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    log({ method: request.method, url: null, status: 403, upstreamStatus: null, bytes: 0, forwardedBytes: 0, completed: false });
  });
  server.requestTimeout = 30000;
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveServer(server));
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('This fixture proxy takes no arguments and binds only to 127.0.0.1:31281.');
  const server = await startPackageProxy();
  console.log('Debian package proxy: 127.0.0.1:31281; GET/HEAD official repository paths only.');
  process.on('SIGTERM', () => { server.close(); server.closeAllConnections(); });
  process.on('SIGINT', () => { server.close(); server.closeAllConnections(); });
}
