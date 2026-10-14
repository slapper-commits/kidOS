import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Store, validateFilePath } from './store.mjs';
import { GAMES, gameInfo, loadGameFiles } from './games.mjs';
import { createExploreHandler, exploreCatalog } from './explore.mjs';
import { MAX_MEDIA_BYTES } from './media.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/desktop.mjs', ['desktop.mjs', 'text/javascript; charset=utf-8']],
  ['/desktop-shortcuts.mjs', ['desktop-shortcuts.mjs', 'text/javascript; charset=utf-8']],
  ['/game-bridge.mjs', ['game-bridge.mjs', 'text/javascript; charset=utf-8']],
  ['/library.mjs', ['library.mjs', 'text/javascript; charset=utf-8']],
  ['/window-manager.mjs', ['window-manager.mjs', 'text/javascript; charset=utf-8']],
  ['/workspace-sync.mjs', ['workspace-sync.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/icons.svg', ['icons.svg', 'image/svg+xml']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const vendor = JSON.parse(await readFile(resolve(ROOT, 'apps/desktop/library-vendor/manifest.json'), 'utf8'));
for (const asset of vendor.assets) STATIC.set(`/${asset.path}`, [asset.path, asset.path.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'application/octet-stream']);
for (const name of ['mail', 'explore', 'explore-request', 'project-tools', 'library-readers', 'native-apps']) STATIC.set(`/${name}.mjs`, [`${name}.mjs`, 'text/javascript; charset=utf-8']);
for (const name of ['mail', 'explore', 'files-extras', 'library-extras']) STATIC.set(`/${name}.css`, [`${name}.css`, 'text/css; charset=utf-8']);
const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml' };
const LIMIT = 2 * 1024 * 1024;
const error = (status, message) => Object.assign(new Error(message), { status });
const permissions = 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), payment=(), display-capture=()';

function respond(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw error(415, 'Send JSON data.');
  if (Number(req.headers['content-length']) > LIMIT) throw error(413, 'Project is too large.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > LIMIT) throw error(413, 'Project is too large.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw error(400, 'Invalid JSON data.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw error(400, 'Expected a JSON object.');
  return value;
}
function desktopRequest(req, origin, { direct = true } = {}) {
  if (req.headers.origin && req.headers.origin !== origin) throw error(403, 'Open kidOS directly to use your files.');
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && !(direct && site === 'none')) throw error(403, 'This request did not come from the desktop.');
}
async function mediaBody(req) {
  if (req.headers['content-type'] !== 'application/octet-stream') throw error(415, 'Send the original file as binary data.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw error(415, 'Compressed uploads are not supported.');
  if (Number(req.headers['content-length']) > MAX_MEDIA_BYTES) throw error(413, 'Choose a file no larger than 64 MiB.');
  let size = 0;
  const chunks = [];
  // Leave the connection readable when rejecting a chunked request so the caller
  // receives a useful HTTP error instead of an abruptly destroyed socket.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_MEDIA_BYTES) { req.resume(); throw error(413, 'Choose a file no larger than 64 MiB.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}
function mediaMetadata(url) {
  const fields = ['title', 'category', 'filename'];
  if (url.search.length > 2048 || [...url.searchParams.keys()].some(key => !fields.includes(key)) || fields.some(key => url.searchParams.getAll(key).length !== 1)) throw error(400, 'Give this import one title, category, and filename.');
  return Object.fromEntries(fields.map(key => [key, url.searchParams.get(key)]));
}
function byteRange(value, size) {
  if (value === undefined) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return false;
  if (first === null) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : false;
  if (first >= size || (last !== null && last < first)) return false;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}
function requestURL(req, origin) {
  if (req.headers.host !== new URL(origin).host) throw error(403, 'Use the local kidOS address.');
  // Check the raw path before URL parsing can normalize traversal segments.
  const raw = req.url?.split('?')[0];
  if (!raw?.startsWith('/') || raw.startsWith('//') || /[\\%\u0000-\u001f]/.test(raw) || raw.split('/').some(p => p === '.' || p === '..')) throw error(400, 'Invalid path.');
  return new URL(req.url, origin);
}
function handleError(res, err) {
  if (res.headersSent || res.destroyed) return;
  const status = Number.isInteger(err.status) ? err.status : 500;
  if (status === 500) console.error('kidOS request failed:', err.message);
  respond(res, status, { error: status === 500 ? 'Something went wrong. Your saved work is still on disk.' : err.message });
}
function listen(server, port) {
  return new Promise((yes, no) => {
    const fail = e => { server.off('listening', done); no(e); };
    const done = () => { server.off('error', fail); yes(); };
    server.once('error', fail).once('listening', done).listen(port, '127.0.0.1');
  });
}
function stop(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}

export async function startKidOS({ dataDir = resolve(ROOT, '.data'), port = 8787, runnerPort = 8788 } = {}) {
  const gameFiles = await loadGameFiles();
  const store = await Store.open(dataDir);
  const token = randomBytes(32).toString('hex');
  const mediaToken = randomBytes(32).toString('hex');
  let mediaCookieName;
  let mediaReads = 0;
  let mediaImports = 0;
  const workspaceWrites = new Set();
  const previews = new Map();
  let platformOrigin;
  let runnerOrigin;
  let exploreHandler;
  const runner = createServer((req, res) => {
    (async () => {
      const url = requestURL(req, runnerOrigin);
      if (!exploreHandler) throw error(503, 'kidOS is still starting. Reload in a moment.');
      if (await exploreHandler(req, res, url)) return;
      if (req.method !== 'GET') throw error(405, 'Only opening app files is supported.');
      const parts = url.pathname.split('/').slice(1);
      let snapshot;
      let file;
      if (parts[0] === 'games' && parts.length >= 3) {
        gameInfo(parts[1]);
        snapshot = { files: gameFiles[parts[1]] };
        file = parts.slice(2).join('/');
      } else if (parts[0] === 'apps' && parts.length >= 4) {
        snapshot = await store.getInstalled(parts[1], parts[2]);
        file = parts.slice(3).join('/');
      } else if (parts[0] === 'previews' && parts.length >= 3) {
        const preview = previews.get(parts[1]);
        if (!preview || preview.expires < Date.now()) { previews.delete(parts[1]); throw error(404, 'Preview expired. Run your project again.'); }
        snapshot = preview;
        file = parts.slice(2).join('/');
      } else throw error(404, 'App file not found.');
      validateFilePath(file);
      if (!Object.hasOwn(snapshot.files, file)) throw error(404, 'App file not found.');
      const csp = `default-src 'none'; script-src 'unsafe-inline' ${runnerOrigin}; style-src 'unsafe-inline' ${runnerOrigin}; img-src data: blob: ${runnerOrigin}; font-src ${runnerOrigin}; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${platformOrigin}; sandbox allow-scripts`;
      res.writeHead(200, {
        'Content-Type': TYPES[file.split('.').pop()] || 'text/plain; charset=utf-8',
        'Content-Security-Policy': csp, 'Permissions-Policy': permissions,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      });
      res.end(snapshot.files[file]);
    })().catch(e => handleError(res, e));
  });
  const platform = createServer((req, res) => {
    (async () => {
      const url = requestURL(req, platformOrigin);
      res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self' ${runnerOrigin}; worker-src 'self'; frame-src ${runnerOrigin}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
      res.setHeader('Permissions-Policy', permissions);
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      if (url.pathname === '/health' && req.method === 'GET') {
        respond(res, 200, { name: 'kidOS', stage: 'day-0', readyForChildUse: false, recoveryNotice: store.recoveryNotice }); return;
      }
      const mediaContent = /^\/media\/([^/]+)\/content$/.exec(url.pathname);
      if (mediaContent) {
        desktopRequest(req, platformOrigin, { direct: false });
        const cookies = (req.headers.cookie || '').split(';').map(value => value.trim());
        if (!cookies.includes(`${mediaCookieName}=${mediaToken}`)) throw error(403, 'Reconnect to kidOS, then open this file again.');
        if (!['GET', 'HEAD'].includes(req.method)) throw error(405, 'Only opening media is supported.');
        if (mediaReads >= 2) throw error(503, 'Two files are already opening. Try again in a moment.');
        mediaReads += 1;
        let released = false;
        let reading = true;
        let responseDone = false;
        const release = () => { if (!reading && responseDone && !released) { released = true; mediaReads -= 1; } };
        const finish = () => { responseDone = true; release(); };
        res.once('finish', finish).once('close', finish);
        try {
          const { item, bytes } = await store.readMedia(mediaContent[1]);
          reading = false;
          // A disconnected client must not free its disk-read slot before the
          // pending read completes, otherwise aborted requests bypass the cap.
          if (res.destroyed) { finish(); return; }
          const headers = { 'Content-Type': item.mimeType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Accept-Ranges': 'bytes' };
          // Range applies only to GET. HEAD describes the complete representation.
          const range = req.method === 'GET' && !req.headers['if-range'] ? byteRange(req.headers.range, bytes.length) : null;
          if (range === false) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${bytes.length}`, 'Content-Length': '0' }); res.end(); return; }
          const output = range ? bytes.subarray(range.start, range.end + 1) : bytes;
          res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': output.length, ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}` } : {}) });
          res.end(req.method === 'HEAD' ? undefined : output); return;
        } catch (err) { reading = false; finish(); throw err; }
      }
      if (url.pathname.startsWith('/api/')) {
        desktopRequest(req, platformOrigin);
        if (url.pathname === '/api/session' && req.method === 'GET') {
          respond(res, 200, { token, runnerOrigin, recoveryNotice: store.recoveryNotice }, { 'Set-Cookie': `${mediaCookieName}=${mediaToken}; Path=/media/; HttpOnly; SameSite=Strict` }); return;
        }
        if (req.headers['x-kidos-token'] !== token) throw error(403, 'Reconnect to kidOS, then try again.');
        if (url.pathname === '/api/explore' && req.method === 'GET') { respond(res, 200, { sites: exploreCatalog() }); return; }
        if (url.pathname === '/api/mail' && req.method === 'GET') { respond(res, 200, { mail: store.getMail() }); return; }
        if (url.pathname === '/api/mail/people' && req.method === 'POST') { respond(res, 201, { person: await store.addMailPerson(await body(req)) }); return; }
        const mailDraft = /^\/api\/mail\/drafts\/([^/]+)(\/send)?$/.exec(url.pathname);
        if (mailDraft && !mailDraft[2] && req.method === 'PUT') { respond(res, 200, { draft: await store.saveMailDraft(mailDraft[1], await body(req)) }); return; }
        if (mailDraft?.[2] && req.method === 'POST') { respond(res, 200, { message: await store.sendMailDraft(mailDraft[1], await body(req)) }); return; }
        const mailMessage = /^\/api\/mail\/messages\/([^/]+)$/.exec(url.pathname);
        if (mailMessage && req.method === 'PATCH') { respond(res, 200, { message: await store.changeMailMessage(mailMessage[1], await body(req)) }); return; }
        if (url.pathname === '/api/workspace') {
          if (req.method === 'GET') {
            // A disconnected PUT may still be reading its body or committing
            // to disk. Recovery reads must observe its final outcome before
            // the desktop decides whether that uncertain write was accepted.
            await Promise.allSettled([...workspaceWrites]);
            respond(res, 200, { workspace: store.getWorkspace() }); return;
          }
          if (req.method === 'PUT') {
            const writing = (async () => store.saveWorkspace(await body(req)))();
            workspaceWrites.add(writing);
            try { respond(res, 200, { workspace: await writing }); }
            finally { workspaceWrites.delete(writing); }
            return;
          }
        }
        if (url.pathname === '/api/media') {
          if (req.method === 'GET') { respond(res, 200, { items: await store.listMedia() }); return; }
          if (req.method === 'POST') {
            const metadata = mediaMetadata(url);
            if (mediaImports >= 1) throw error(503, 'Another file is being imported. Try again when it finishes.');
            mediaImports += 1;
            try { respond(res, 201, await store.importMedia(metadata, await mediaBody(req))); }
            finally { mediaImports -= 1; }
            return;
          }
        }
        const mediaProgress = /^\/api\/media\/([^/]+)\/progress$/.exec(url.pathname);
        if (mediaProgress && req.method === 'PATCH') { respond(res, 200, { item: await store.saveMediaProgress(mediaProgress[1], await body(req)) }); return; }
        const mediaItem = /^\/api\/media\/([^/]+)$/.exec(url.pathname);
        if (mediaItem && req.method === 'PATCH') { respond(res, 200, { item: await store.editMedia(mediaItem[1], await body(req)) }); return; }
        if (mediaItem && req.method === 'GET') { respond(res, 200, { item: await store.getMedia(mediaItem[1]) }); return; }
        if (url.pathname === '/api/games' && req.method === 'GET') {
          respond(res, 200, { games: GAMES.map(game => ({ ...game, progress: store.getGameProgress(game.id) })) }); return;
        }
        const gameMatch = /^\/api\/games\/([^/]+)\/(launch|result|remix)$/.exec(url.pathname);
        if (gameMatch) {
          const [, id, action] = gameMatch;
          const game = gameInfo(id);
          if (action === 'launch' && req.method === 'GET') {
            respond(res, 200, { url: `${runnerOrigin}/games/${id}/index.html`, progress: store.getGameProgress(id) }); return;
          }
          if (action === 'result' && req.method === 'POST') {
            respond(res, 200, { progress: await store.recordGameResult(id, await body(req)) }); return;
          }
          if (action === 'remix' && req.method === 'POST') {
            const input = await body(req);
            if (Object.keys(input).length) throw error(400, 'Game copies do not accept extra fields.');
            respond(res, 201, { project: await store.createProject(`My ${game.name}`, gameFiles[id]) }); return;
          }
        }
        if (url.pathname === '/api/projects/import' && req.method === 'POST') { respond(res, 201, { project: await store.importProject(await body(req)) }); return; }
        if (url.pathname === '/api/projects') {
          if (req.method === 'GET') { respond(res, 200, { projects: await store.listProjects() }); return; }
          if (req.method === 'POST') { const input = await body(req); respond(res, 201, { project: await store.createProject(input.name) }); return; }
        }
        if (url.pathname === '/api/apps' && req.method === 'GET') { respond(res, 200, { apps: await store.listApps() }); return; }
        if (url.pathname === '/api/trash' && req.method === 'GET') { respond(res, 200, { projects: store.listTrash() }); return; }
        const restoreMatch = /^\/api\/trash\/([^/]+)\/restore$/.exec(url.pathname);
        if (restoreMatch && req.method === 'POST') { respond(res, 200, { project: await store.restoreProject(restoreMatch[1], await body(req)) }); return; }
        const projectMatch = /^\/api\/projects\/([^/]+)(?:\/(install|preview|export|trash|duplicate))?$/.exec(url.pathname);
        if (projectMatch) {
          const [, id, action] = projectMatch;
          if (!action && req.method === 'GET') { respond(res, 200, { project: await store.getProject(id) }); return; }
          if (!action && req.method === 'PUT') { respond(res, 200, { project: await store.saveProject(id, await body(req)) }); return; }
          if (action === 'duplicate' && req.method === 'POST') { respond(res, 201, { project: await store.duplicateProject(id, await body(req)) }); return; }
          if (action === 'trash' && req.method === 'POST') { respond(res, 200, { project: await store.trashProject(id, await body(req)) }); return; }
          if (action === 'install' && req.method === 'POST') { respond(res, 201, { app: await store.installProject(id, await body(req)) }); return; }
          if (action === 'export' && req.method === 'GET') { respond(res, 200, await store.exportProject(id), { 'Content-Disposition': `attachment; filename="${id}.kidos.json"` }); return; }
          if (action === 'preview' && req.method === 'POST') {
            const input = await body(req);
            const project = await store.getProject(id);
            if (input.revision !== project.revision) throw error(409, 'This project changed. Reopen it before running.');
            const previewId = randomBytes(24).toString('hex');
            for (const [key, preview] of previews) if (preview.expires < Date.now()) previews.delete(key);
            if (previews.size >= 20) previews.delete(previews.keys().next().value);
            previews.set(previewId, { files: Object.fromEntries(Object.entries(project.files).filter(([file]) => !file.startsWith('recycle-bin/'))), expires: Date.now() + 60 * 60 * 1000 });
            respond(res, 201, { url: `${runnerOrigin}/previews/${previewId}/index.html` }); return;
          }
        }
        const currentApp = /^\/api\/apps\/([^/]+)\/current$/.exec(url.pathname);
        if (currentApp && req.method === 'POST') { respond(res, 200, { app: await store.selectAppVersion(currentApp[1], await body(req)) }); return; }
        const appMatch = /^\/api\/apps\/([^/]+)\/launch$/.exec(url.pathname);
        if (appMatch && req.method === 'GET') {
          const app = await store.getInstalled(appMatch[1], url.searchParams.get('version') || undefined);
          respond(res, 200, { url: `${runnerOrigin}/apps/${app.manifest.id}/${app.manifest.version}/${app.manifest.entryPoint}` }); return;
        }
        throw error(404, 'Not found.');
      }
      if (req.method === 'GET' && STATIC.has(url.pathname)) {
        const [name, type] = STATIC.get(url.pathname);
        const asset = await readFile(resolve(ROOT, 'apps/desktop', name));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(asset); return;
      }
      throw error(404, 'Not found.');
    })().catch(e => handleError(res, e));
  });
  platform.requestTimeout = runner.requestTimeout = 15_000;
  platform.headersTimeout = runner.headersTimeout = 10_000;
  try {
    await listen(runner, runnerPort);
    runnerOrigin = `http://127.0.0.1:${runner.address().port}`;
    await listen(platform, port);
    platformOrigin = `http://127.0.0.1:${platform.address().port}`;
    mediaCookieName = `kidos_media_${platform.address().port}`;
    exploreHandler = createExploreHandler({ platformOrigin, runnerOrigin });
  } catch (e) {
    await Promise.all([stop(runner), stop(platform)]); await store.close(); throw e;
  }
  return { platform, runner, store, platformOrigin, runnerOrigin, async close() { await Promise.all([stop(platform), stop(runner)]); await store.close(); } };
}

async function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    // Installed releases run through /opt/kidos/current, a directory symlink.
    // Canonicalize both sides, including when Node preserves the main symlink.
    return await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url));
  } catch (error) {
    // Imports from stdin/eval may have no real entrypoint file.
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return false;
    throw error;
  }
}
if (await isEntryPoint()) {
  function envPort(name, fallback) {
    if (process.env[name] === undefined) return fallback;
    if (!/^\d+$/.test(process.env[name]) || Number(process.env[name]) < 1 || Number(process.env[name]) > 65535) throw new Error(`${name} must be between 1 and 65535.`);
    return Number(process.env[name]);
  }
  try {
    const app = await startKidOS({ dataDir: process.env.KIDOS_DATA_DIR ? resolve(process.env.KIDOS_DATA_DIR) : undefined, port: envPort('KIDOS_PORT', 8787), runnerPort: envPort('KIDOS_RUNNER_PORT', 8788) });
    console.log(`kidOS desktop: ${app.platformOrigin}\nLocal app runner: ${app.runnerOrigin}\nDevelopment slice — Linux containment and parent setup are not implemented.`);
    if (app.store.recoveryNotice) console.warn(app.store.recoveryNotice);
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (!closing) { closing = true; await app.close(); } });
  } catch (err) { console.error(`kidOS could not start: ${err.message}`); process.exitCode = 1; }
}
