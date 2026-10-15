import { spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { NATIVE_PACKAGES } from '../raspberry-pi/native-packages.mjs';
import { pcTarget } from '../native-session/target.mjs';

export function packageCommands(args) {
  if (args.length !== 1 || args[0] !== '--install-on-this-pc') throw new Error('Choose --install-on-this-pc explicitly.');
  return [['update'], ['install', '--no-remove', 'chromium', ...NATIVE_PACKAGES]];
}
export async function main(args) {
  const commands = packageCommands(args);
  await pcTarget({ install: true });
  for (const command of commands) {
    const result = spawnSync('/usr/bin/apt-get', command, { shell: false, stdio: 'inherit', env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', HOME: '/root' } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Package preparation stopped (${result.signal || result.status}). Review APT output before continuing.`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
