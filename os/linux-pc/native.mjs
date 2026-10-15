import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existingDesktopUser, pcTarget } from '../native-session/target.mjs';
import { protectedFile } from '../native-session/registration.mjs';
import { preflightPiApplications } from '../native-session/install-pi.mjs';
import { installRegistration, stageNative } from '../native-session/install-core.mjs';
import { PC_NODE } from '../raspberry-pi/runtime-pin.mjs';

export function parseOptions(args) {
  if (args.length === 3 && args[0] === '--install' && args[1] === '--desktop-user' && /^[a-z_][a-z0-9_-]{0,31}$/.test(args[2])) return { username: args[2] };
  if (args.length === 2 && args[0] === '--stage' && args[1]) return { stage: resolve(args[1]) };
  throw new Error('Choose --install --desktop-user NAME or --stage EMPTY_DIRECTORY.');
}
export async function install(username) {
  await pcTarget({ install: true });
  const user = await existingDesktopUser(username);
  const installed = JSON.parse(await protectedFile('/opt/kidos/install-receipt.json', { maxBytes: 128 * 1024 }));
  const runtime = JSON.parse(await protectedFile('/opt/kidos/runtime.json', { maxBytes: 128 * 1024 }));
  if (installed.runtime?.targetKind !== 'linux-pc' || installed.runtime.arch !== 'x64' || runtime.targetKind !== 'linux-pc' || runtime.arch !== 'x64' || runtime.stageOnly !== false || runtime.nodeVersion !== PC_NODE.version || runtime.executable !== PC_NODE.executable || await realpath(PC_NODE.executable) !== PC_NODE.executable) throw new Error('Install the guarded kidOS PC service and pinned x64 runtime first.');
  const node = await protectedFile(PC_NODE.executable, { executable: true, maxBytes: 256 * 1024 * 1024 });
  if (createHash('sha256').update(node).digest('hex') !== runtime.nodeSha256) throw new Error('The pinned native-session runtime changed.');
  await preflightPiApplications(user, { desktopExecutables: ['/usr/bin/chromium'] });
  return installRegistration({ format: 3, targetKind: 'linux-pc', user });
}
export async function main(args) {
  const options = parseOptions(args);
  const result = options.stage ? await stageNative(options.stage, { format: 3, targetKind: 'linux-pc', user: { username: 'kidos-stage', uid: 1000, gid: 1000, homedir: '/home/kidos-stage' } }) : await install(options.username);
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
