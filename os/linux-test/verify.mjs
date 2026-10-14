// Synthetic API verification for an explicitly provisioned disposable Linux VM.
// It never stops services, changes networking, or copies/restores host data.
import { constants } from 'node:fs';
import { open, readFile, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkVmId, vmTarget } from './target.mjs';

export const NAMESPACE = 'kidos-linux-synthetic-verification/v1';
const MAX_RECEIPT = 2 * 1024 * 1024;
const projectId = /^project-[0-9a-f-]{36}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => hash(JSON.stringify(canonical(value)));
const same = (actual, expected, label) => {
  if (digest(actual) !== digest(expected)) throw new Error(`${label} differs from the synthetic baseline (expected ${digest(expected)}, received ${digest(actual)}).`);
};
const check = (condition, message) => { if (!condition) throw new Error(message); };
const readOptional = async path => {
  try { return (await readFile(path, 'utf8')).replace(/\0/g, '').trim(); }
  catch (error) { if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) return null; throw error; }
};
const assetPaths = ['/', '/desktop.mjs', '/window-manager.mjs', '/workspace-sync.mjs', '/library.mjs', '/game-bridge.mjs', '/styles.css', '/icons.svg'];

export function loopbackOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an explicit http://127.0.0.1:PORT loopback URL without credentials or a path.');
  return url.origin;
}
export function parseOptions(args) {
  const [phase, ...rest] = args;
  if (!['seed', 'check', 'mutate'].includes(phase)) throw new Error('Choose seed, check, or mutate.');
  const options = { phase, label: phase, requireNewBoot: false };
  const seen = new Set();
  for (let i = 0; i < rest.length; i++) {
    const option = rest[i];
    if (seen.has(option)) throw new Error(`Duplicate option: ${option}`);
    seen.add(option);
    if (option === '--require-new-boot') { options.requireNewBoot = true; continue; }
    if (!['--url', '--state-file', '--label', '--disposable-vm-id'].includes(option) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Unknown or incomplete option: ${option}`);
    const value = rest[++i];
    options[{ '--url': 'url', '--state-file': 'stateFile', '--label': 'label', '--disposable-vm-id': 'vmId' }[option]] = value;
  }
  if (!options.url || !options.stateFile || !isAbsolute(options.stateFile)) throw new Error('Supply --url and an explicit absolute --state-file path outside the service data directory.');
  options.url = loopbackOrigin(options.url);
  options.vmId = checkVmId(options.vmId);
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$/.test(options.label)) throw new Error('Use a short plain report label.');
  if (options.requireNewBoot && phase !== 'check') throw new Error('--require-new-boot is only supported with check.');
  return options;
}
export async function assertReceiptOutsideData(stateFile, dataDirectory = '/var/lib/kidos') {
  const data = await realpath(dataDirectory);
  const receipt = resolve(await realpath(dirname(stateFile)), basename(stateFile));
  const within = relative(data, receipt);
  check(within !== '' && (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)), 'The test-state file must be outside the service data directory, including symlinked ancestors.');
}
async function environment(guardVM, vmId) {
  const target = guardVM ? await vmTarget(vmId, { install: true }) : {};
  const bootId = await readOptional('/proc/sys/kernel/random/boot_id');
  const systemVendor = await readOptional('/sys/class/dmi/id/sys_vendor');
  const productName = await readOptional('/sys/class/dmi/id/product_name');
  const deviceTreeModel = await readOptional('/proc/device-tree/model');
  const evidence = [systemVendor, productName, deviceTreeModel].filter(Boolean);
  const qemu = evidence.some(value => /QEMU|KVM|linux,dummy-virt/i.test(value));
  if (guardVM && !bootId) throw new Error('The designated Linux VM must have a readable boot ID.');
  return { ...target, platform: process.platform, architecture: process.arch, node: process.version, bootId, systemVendor, productName, deviceTreeModel, qemuDetected: Boolean(target.virtualization) || qemu, scope: guardVM ? 'explicitly designated disposable Linux VM; not physical Raspberry Pi' : 'isolated local API fixture; VM guard disabled by test caller' };
}

export function syntheticFiles(fixtureId) {
  return {
    'index.html': `<!doctype html><html lang="en"><meta charset="utf-8"><title>Synthetic Linux fixture</title><link rel="stylesheet" href="style.css"><main id="fixture">Synthetic fixture ${fixtureId}: installed baseline</main><script src="script.js"></script></html>\n`,
    'style.css': 'body { font: 18px sans-serif; background: #dde9d0; color: #172216; }\n',
    'script.js': '// Original synthetic fixture. This is served to a browser, never executed on the server.\ndocument.getElementById("fixture").dataset.loaded = "yes";\n',
  };
}
export function syntheticMedia(fixtureId) {
  const text = Buffer.from(`Original synthetic Linux verification book ${fixtureId}.\n\n${'A small moon lights the quiet garden. Every page belongs to this disposable test. 🌙\n\n'.repeat(40)}`, 'utf8');
  const samples = 8000, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(samples, 24); wav.writeUInt32LE(samples * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / samples) * 1200), 44 + i * 2);
  return [
    { metadata: { title: 'Synthetic Linux book', category: 'books', filename: 'synthetic-linux-book.txt' }, bytes: text, position: 123 },
    { metadata: { title: 'Synthetic Linux tone', category: 'audiobooks', filename: 'synthetic-linux-tone.wav' }, bytes: wav, position: 0.375 },
  ];
}
async function client(origin) {
  const request = async (url, options = {}) => fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const sessionResponse = await request(`${origin}/api/session`);
  check(sessionResponse.ok, `Cannot establish a local session (${sessionResponse.status}).`);
  const session = await sessionResponse.json();
  check(typeof session.token === 'string' && session.token.length >= 32, 'Session lacks a valid token.');
  const runnerOrigin = loopbackOrigin(session.runnerOrigin);
  check(runnerOrigin !== origin, 'The app runner must have its own origin.');
  const cookie = sessionResponse.headers.get('set-cookie')?.split(';')[0];
  check(cookie?.startsWith('kidos_media_'), 'Session lacks the native-media cookie.');
  const api = async (path, { method = 'GET', body, binary } = {}) => {
    const response = await request(`${origin}${path}`, { method, headers: { 'X-KidOS-Token': session.token, ...(binary ? { 'Content-Type': 'application/octet-stream' } : body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(binary ? { body: binary } : body === undefined ? {} : { body: JSON.stringify(body) }) });
    check(response.ok, `${method} ${path.split('?')[0]} returned ${response.status}.`);
    return response.json();
  };
  return { origin, runnerOrigin, request, api,
    async content(id, headers = {}, method = 'GET') {
      const response = await request(`${origin}/media/${id}/content`, { method, headers: { Cookie: cookie, ...headers } });
      return { response, bytes: Buffer.from(await response.arrayBuffer()) };
    },
  };
}
async function catalogs(connection) {
  const values = await Promise.all(['/api/projects', '/api/trash', '/api/apps', '/api/games', '/api/media', '/api/workspace'].map(path => connection.api(path)));
  return { projects: values[0].projects, trash: values[1].projects, apps: values[2].apps, games: values[3].games, media: values[4].items, workspace: values[5].workspace };
}
async function clean(connection) {
  const current = await catalogs(connection);
  check(current.projects.length === 0 && current.trash.length === 0 && current.apps.length === 0 && current.media.length === 0 && current.games.every(game => game.progress.rounds === 0 && game.progress.wins === 0 && game.progress.best === 0 && game.progress.last === 0 && game.progress.updatedAt === null && game.progress.recentRounds.length === 0) && current.workspace.revision === 0 && current.workspace.windows.length === 0 && current.workspace.activeId === null && current.workspace.editorDraft === null, 'Seed requires a completely unused disposable store. Existing data was not changed.');
}
async function readReceipt(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    check(info.isFile() && info.nlink === 1 && info.size <= MAX_RECEIPT, 'The test-state file must be a bounded ordinary file without links.');
    const receipt = JSON.parse(await file.readFile('utf8'));
    check(receipt.namespace === NAMESPACE && receipt.status === 'complete' && /^[0-9a-f-]{36}$/.test(receipt.fixtureId) && projectId.test(receipt.expected?.project?.id), 'This is not a completed synthetic verification baseline.');
    check(receipt.expected.project.name === `Linux synthetic ${receipt.fixtureId.slice(0, 8)}`, 'The baseline project lacks its synthetic namespace.');
    check(receipt.expected.catalogs.projects.length === 1 && receipt.expected.catalogs.trash.length === 1 && receipt.expected.catalogs.apps.length === 1 && receipt.expected.catalogs.media.length === 2, 'The baseline contains unexpected data.');
    same(receipt.installedFiles, syntheticFiles(receipt.fixtureId), 'Synthetic installed source');
    same(receipt.expected.project.files, { ...receipt.installedFiles, 'index.html': receipt.installedFiles['index.html'].replace('installed baseline', 'edited saved source') }, 'Synthetic saved source');
    same(receipt.expected.catalogs.media.map(item => item.id).sort(), syntheticMedia(receipt.fixtureId).map(item => `media-${hash(item.bytes)}`).sort(), 'Synthetic media identities');
    check(digest(receipt.expected) === receipt.expectedDigest, 'The baseline record is damaged.');
    return receipt;
  } finally { await file.close(); }
}
async function verifyContent(connection, receipt, checks) {
  const current = await catalogs(connection);
  same(current, receipt.expected.catalogs, 'Durable catalogs, workspace, scores and positions');
  const { project } = await connection.api(`/api/projects/${receipt.expected.project.id}`);
  same(project, receipt.expected.project, 'Saved source project');
  checks.push('exact durable project, installed metadata, trash, game progress, media metadata and workspace draft');
  const { url } = await connection.api(`/api/apps/${project.id}/launch?version=1.0.0`);
  const launch = new URL(url);
  check(launch.origin === connection.runnerOrigin && launch.pathname === `/apps/${project.id}/1.0.0/index.html`, 'Unexpected launch destination.');
  for (const [name, expected] of Object.entries(receipt.installedFiles)) {
    const response = await connection.request(new URL(name, url));
    check(response.ok, `Installed ${name} was not served.`);
    check(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(expected)), `Installed ${name} bytes changed.`);
    check(response.headers.get('content-security-policy')?.includes('sandbox allow-scripts'), 'Runner response lacks its sandbox policy.');
  }
  check(project.files['index.html'] !== receipt.installedFiles['index.html'], 'The fixture no longer proves installed snapshot independence.');
  checks.push('installed runner serves every original byte after source edits; no server execution of child code');
  for (const fixture of syntheticMedia(receipt.fixtureId)) {
    const id = `media-${hash(fixture.bytes)}`;
    const { response, bytes } = await connection.content(id);
    check(response.status === 200 && bytes.equals(fixture.bytes), `Imported ${fixture.metadata.filename} bytes changed.`);
    const ranged = await connection.content(id, { Range: 'bytes=3-19' });
    check(ranged.response.status === 206 && ranged.bytes.equals(fixture.bytes.subarray(3, 20)), 'Native media range returned different bytes.');
    const head = await connection.content(id, {}, 'HEAD');
    check(head.response.ok && Number(head.response.headers.get('content-length')) === fixture.bytes.length && head.bytes.length === 0, 'Native media HEAD differs from the full file.');
  }
  checks.push('exact original book/WAV bytes, authenticated media ranges and HEAD');
  const assets = {};
  for (const path of assetPaths) {
    const response = await connection.request(`${connection.origin}${path}`);
    check(response.ok, `Local desktop asset ${path} is unavailable.`);
    assets[path] = hash(Buffer.from(await response.arrayBuffer()));
  }
  same(assets, receipt.assetHashes, 'Desktop source assets');
  checks.push('all measured desktop assets available locally with unchanged bytes');
}
async function verifyBoundary(connection, checks) {
  const denied = await connection.request(`${connection.origin}/api/workspace`);
  check(denied.status === 403, 'Workspace accepted a request without desktop authority.');
  const runner = await connection.request(`${connection.runnerOrigin}/api/workspace`);
  check(runner.status === 404, 'Runner unexpectedly exposes the platform workspace API.');
  const health = await connection.request(`${connection.origin}/health`);
  const status = await health.json();
  check(health.ok && status.name === 'kidOS' && status.readyForChildUse === false, 'Unexpected health or child-readiness declaration.');
  checks.push('loopback service health and API/runner authority separation');
}
async function seed(connection, stateFile, environmentInfo, checks) {
  await clean(connection);
  const file = await open(stateFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const fixtureId = randomUUID();
  try {
    await file.writeFile(JSON.stringify({ namespace: NAMESPACE, status: 'incomplete', fixtureId }));
    await file.sync();
    const installedFiles = syntheticFiles(fixtureId), name = `Linux synthetic ${fixtureId.slice(0, 8)}`;
    let { project } = await connection.api('/api/projects', { method: 'POST', body: { name } });
    ({ project } = await connection.api(`/api/projects/${project.id}`, { method: 'PUT', body: { name, revision: project.revision, files: installedFiles } }));
    await connection.api(`/api/projects/${project.id}/install`, { method: 'POST', body: { revision: project.revision, version: '1.0.0' } });
    ({ project } = await connection.api(`/api/projects/${project.id}`, { method: 'PUT', body: { name, revision: project.revision, files: { ...installedFiles, 'index.html': installedFiles['index.html'].replace('installed baseline', 'edited saved source') } } }));
    const trashed = (await connection.api('/api/projects', { method: 'POST', body: { name: `Linux synthetic trash ${fixtureId.slice(0, 8)}` } })).project;
    await connection.api(`/api/projects/${trashed.id}/trash`, { method: 'POST', body: { revision: trashed.revision } });
    await connection.api('/api/games/moon-hopper/result', { method: 'POST', body: { roundId: hash(fixtureId).slice(0, 32), score: 321, won: true } });
    const media = syntheticMedia(fixtureId);
    for (const fixture of media) {
      const { item } = await connection.api(`/api/media?${new URLSearchParams(fixture.metadata)}`, { method: 'POST', binary: fixture.bytes });
      await connection.api(`/api/media/${item.id}/progress`, { method: 'PATCH', body: { position: fixture.position } });
    }
    const shape = { bounds: { x: 60, y: 40, width: 620, height: 440 }, minimized: false, maximized: false, snap: null };
    await connection.api('/api/workspace', { method: 'PUT', body: {
      revision: 0,
      windows: [
        // Match a real desktop snapshot: geometry keys first, active window at
        // the top of stacking order, above the visible maximized app.
        { id: 'library', ...shape, minimized: true, kind: 'tool', route: 'library', state: { mediaId: `media-${hash(media[0].bytes)}` } },
        { id: `app:${project.id}:1.0.0`, ...shape, maximized: true, kind: 'installed', appId: project.id, version: '1.0.0' },
        { id: 'make', ...shape, snap: 'left', kind: 'tool', route: 'make', state: { projectId: project.id, file: 'style.css' } },
      ], activeId: 'make',
      editorDraft: { projectId: project.id, baseRevision: project.revision, name, files: { ...project.files, 'style.css': `${project.files['style.css']}/* Synthetic UNSAVED recovery draft ${fixtureId}. */\n` }, file: 'style.css', version: '1.1.0' },
    } });
    const assetHashes = {};
    for (const path of assetPaths) {
      const response = await connection.request(`${connection.origin}${path}`);
      check(response.ok, `Local desktop asset ${path} is unavailable.`);
      assetHashes[path] = hash(Buffer.from(await response.arrayBuffer()));
    }
    const expected = { catalogs: await catalogs(connection), project };
    const receipt = { namespace: NAMESPACE, status: 'complete', fixtureId, seededAt: new Date().toISOString(), seedEnvironment: environmentInfo, expected, expectedDigest: digest(expected), installedFiles, assetHashes };
    await verifyContent(connection, receipt, checks);
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    for (let offset = 0; offset < bytes.length;) {
      const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, offset);
      check(bytesWritten > 0, 'The synthetic baseline receipt could not be written completely.'); offset += bytesWritten;
    }
    await file.truncate(bytes.length); await file.sync();
    checks.push('unused store seeded only with namespaced synthetic fixtures; exclusive baseline receipt synced');
    return receipt;
  } finally { await file.close(); }
}

export async function runVerification({ phase, url, stateFile, label = phase, requireNewBoot = false, guardVM = true, vmId }) {
  check(['seed', 'check', 'mutate'].includes(phase), 'Choose seed, check, or mutate.');
  check(isAbsolute(stateFile), 'The test-state file path must be absolute.');
  const origin = loopbackOrigin(url), environmentInfo = await environment(guardVM, vmId), checks = [];
  if (guardVM) await assertReceiptOutsideData(stateFile);
  let receipt = phase === 'seed' ? null : await readReceipt(stateFile);
  if (receipt && guardVM) check(receipt.seedEnvironment.vmId === vmId, 'The synthetic baseline belongs to a different designated VM.');
  if (requireNewBoot) {
    check(phase === 'check' && environmentInfo.bootId && receipt.seedEnvironment.bootId && environmentInfo.bootId !== receipt.seedEnvironment.bootId, 'Expected a different Linux boot ID from the seeded baseline.');
    checks.push('Linux boot ID changed since seed');
  }
  const connection = await client(origin);
  await verifyBoundary(connection, checks);
  if (phase === 'seed') receipt = await seed(connection, stateFile, environmentInfo, checks);
  else await verifyContent(connection, receipt, checks);
  if (phase === 'mutate') {
    const project = receipt.expected.project;
    await connection.api(`/api/projects/${project.id}`, { method: 'PUT', body: { revision: project.revision, name: project.name, files: { ...project.files, 'index.html': `${project.files['index.html']}<!-- Synthetic post-backup mutation ${receipt.fixtureId}. -->\n` } } });
    const audio = syntheticMedia(receipt.fixtureId)[1];
    await connection.api(`/api/media/media-${hash(audio.bytes)}/progress`, { method: 'PATCH', body: { position: 0.875 } });
    const workspace = receipt.expected.catalogs.workspace;
    await connection.api('/api/workspace', { method: 'PUT', body: { ...workspace, windows: workspace.windows.map(window => ({ ...window, minimized: true })), activeId: null } });
    checks.push('only verified synthetic project, media position and workspace deliberately diverged; baseline receipt unchanged');
  }
  return { namespace: NAMESPACE, phase, label, result: 'passed', recordedAt: new Date().toISOString(), environment: environmentInfo, fixtureId: receipt.fixtureId, baselineDigest: receipt.expectedDigest, checks, limits: ['API and served-byte verification only; no browser interaction, audible playback or physical Pi certification.', 'Backup copying, service stop/start, reboot and network isolation must be performed and evidenced separately in the designated VM.', 'Checks do not certify Linux child-code containment.'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let options;
  try { options = parseOptions(process.argv.slice(2)); console.log(JSON.stringify(await runVerification(options), null, 2)); }
  catch (error) {
    console.log(JSON.stringify({ namespace: NAMESPACE, phase: options?.phase || process.argv[2] || null, label: options?.label || null, result: 'failed', recordedAt: new Date().toISOString(), error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
