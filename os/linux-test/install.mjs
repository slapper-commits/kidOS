import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkVmId, vmTarget } from './target.mjs';

export function parseOptions(args) {
  if (args.length !== 4 || args[0] !== '--release-root' || !args[1] || args[2] !== '--disposable-vm-id') throw new Error('Choose --release-root EXTRACTED_PILOT --disposable-vm-id UUID for an explicit disposable VM install.');
  return { releaseRoot: resolve(args[1]), vmId: checkVmId(args[3]) };
}
export async function main(args) {
  const options = parseOptions(args), target = await vmTarget(options.vmId, { install: true });
  // This is explicitly supplied, trusted release code. The Pi bundle does not
  // include this VM wrapper or any alternate hardware-identity CLI flag.
  const root = await realpath(options.releaseRoot);
  const { installLive } = await import(pathToFileURL(resolve(root, 'os/raspberry-pi/install-core.mjs')));
  console.log(JSON.stringify(await installLive(root, target), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`kidOS VM install stopped: ${error.message}`); process.exitCode = 1; });
}
