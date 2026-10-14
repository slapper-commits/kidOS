import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PILOT_NODE } from './runtime-pin.mjs';
import { autostartText as renderAutostart, runKiosk } from './kiosk-core.mjs';
import { checkPiRegistration } from '../native-session/registration.mjs';

const command = `${PILOT_NODE.executable} /opt/kidos/current/os/raspberry-pi/kiosk.mjs --launch`;
const entry = `${command} &`;
export function autostartText(existing, enable) { return renderAutostart(existing, enable, entry); }
async function piDesktop() {
  const model = await readFile('/proc/device-tree/model', 'utf8');
  if (!model.startsWith('Raspberry Pi ')) throw new Error('Kiosk setup is only for the dedicated Pi.');
}
export async function main(args) {
  return runKiosk(args, { targetCheck: piDesktop, entry, presentation: 'desktop', desktopAutostartCommand: command, nativeExtension: user => checkPiRegistration(user, { optional: true }) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`kidOS kiosk stopped: ${error.message}`); process.exitCode = 1; });
}
