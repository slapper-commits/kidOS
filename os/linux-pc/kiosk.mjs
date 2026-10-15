import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runKiosk } from '../raspberry-pi/kiosk-core.mjs';
import { PC_NODE } from '../raspberry-pi/runtime-pin.mjs';
import { checkEnrolledPcUser, checkSession } from '../native-session/registration.mjs';

const command = `${PC_NODE.executable} /opt/kidos/current/os/linux-pc/kiosk.mjs --launch`;
export async function main(args) {
  return runKiosk(args, {
    arch: 'x64', presentation: 'desktop', entry: `${command} &`, desktopAutostartCommand: command,
    targetCheck: user => checkEnrolledPcUser(user),
    // A real Wayland/DBus session is required for this first PC native pilot.
    nativeExtension: async user => { await checkSession(user); return true; },
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(`kidOS PC desktop stopped: ${error.message}`); process.exitCode = 1; });
