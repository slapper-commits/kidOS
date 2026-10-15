import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existingDesktopUser, piTarget } from './target.mjs';
import { protectedFile } from './registration.mjs';
import { PI_APP_IDS, piCatalog, piCommandFor } from './native-launch.mjs';
import { installRegistration, stageNative } from './install-core.mjs';

const NODE = '/opt/kidos-node/v24.21.0/bin/node';
export function parseOptions(args) {
  if (args.length === 3 && args[0] === '--install' && args[1] === '--desktop-user' && /^[a-z_][a-z0-9_-]{0,31}$/.test(args[2])) return { install: true, username: args[2] };
  if (args.length === 2 && args[0] === '--stage' && args[1]) return { install: false, directory: resolve(args[1]) };
  throw new Error('Use --install --desktop-user NAME on the Pi, or --stage EMPTY_DIRECTORY for a local rehearsal.');
}
export async function preflightPiApplications(user, { checkFile = protectedFile, desktopExecutables = ['/usr/bin/chromium', '/usr/bin/labwc'] } = {}) {
  const catalog = piCatalog(user), files = new Map();
  for (const id of PI_APP_IDS) {
    const app = catalog[id];
    files.set(app.binary, true); files.set(piCommandFor(id, user).executable, true);
    for (const path of app.extraExecutables || []) files.set(path, true);
    for (const path of app.data) if (!files.has(path)) files.set(path, false);
  }
  for (const path of desktopExecutables) files.set(path, true);
  for (const [path, executable] of files) await checkFile(path, { executable, read: false });
  return [...files.keys()];
}
export async function install(username) {
  await piTarget({ install: true });
  const user = await existingDesktopUser(username);
  const installed = JSON.parse(await protectedFile('/opt/kidos/install-receipt.json', { maxBytes: 128 * 1024 }));
  const runtime = JSON.parse(await protectedFile('/opt/kidos/runtime.json', { maxBytes: 128 * 1024 }));
  if (installed.runtime?.targetKind !== 'raspberry-pi' || runtime.targetKind !== 'raspberry-pi' || runtime.stageOnly !== false || runtime.nodeVersion !== 'v24.21.0' || runtime.executable !== NODE || await realpath(NODE) !== NODE) throw new Error('Install the guarded kidOS Pi service and pinned runtime first.');
  const node = await protectedFile(NODE, { executable: true, maxBytes: 256 * 1024 * 1024 });
  if (createHash('sha256').update(node).digest('hex') !== runtime.nodeSha256) throw new Error('The pinned native-session runtime changed.');
  await preflightPiApplications(user);
  return installRegistration({ format: 2, targetKind: 'raspberry-pi', user });
}
export async function main(args) {
  const options = parseOptions(args);
  const result = options.install ? await install(options.username) : await stageNative(options.directory, { format: 2, targetKind: 'raspberry-pi', user: { username: 'kidos-stage', uid: 1000, gid: 1000, homedir: '/home/kidos-stage' } });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
