import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installLive, stageRelease } from '../raspberry-pi/install-core.mjs';
import { PC_NODE } from '../raspberry-pi/runtime-pin.mjs';
import { pcTarget } from '../native-session/target.mjs';
import { collectHardware } from './hardware.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export function parseOptions(args) {
  if (args.length === 2 && args[0] === '--target-root' && args[1]) return { stage: resolve(args[1]) };
  if (args.length === 1 && args[0] === '--install-on-this-pc') return { install: true };
  if (args.length === 1 && args[0] === '--check-target') return { check: true };
  if (args.length === 1 && args[0] === '--check-hardware') return { hardware: true };
  throw new Error('Choose --check-hardware, --check-target, --target-root EMPTY_DIRECTORY, or --install-on-this-pc. This installs kidOS onto existing Debian; it never partitions a disk.');
}
export async function main(args) {
  const options = parseOptions(args);
  if (options.hardware) {
    console.log(JSON.stringify(await collectHardware(), null, 2));
    return;
  }
  const result = options.stage ? await stageRelease(root, options.stage, PC_NODE.version, 'x64') : options.check ? await pcTarget() : await installLive(root, await pcTarget({ install: true }));
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(`kidOS PC setup stopped: ${error.message}`); process.exitCode = 1; });
