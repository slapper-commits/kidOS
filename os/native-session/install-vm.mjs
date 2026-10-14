import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVmId, vmTarget } from '../linux-test/target.mjs';
import { installRegistration } from './install-core.mjs';

export function parseOptions(args) {
  if (args.length !== 3 || args[0] !== '--install' || args[1] !== '--disposable-vm-id') throw new Error('Use --install --disposable-vm-id UUID.');
  return checkVmId(args[2]);
}
export async function install(vmId) {
  await vmTarget(vmId, { install: true });
  return installRegistration({ format: 1, vmId });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  install(parseOptions(process.argv.slice(2))).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
