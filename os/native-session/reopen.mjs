import { spawn, execFileSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { userInfo } from 'node:os';
import { checkSession, protectedFile } from './registration.mjs';
import { validateDesktopUser } from './target.mjs';

export function reopenCommand(session) {
  validateDesktopUser(session.user);
  if (session.targetKind === 'raspberry-pi') return ['/opt/kidos/current/os/raspberry-pi/kiosk.mjs', '--launch'];
  if (session.targetKind === 'linux-pc') return ['/opt/kidos/current/os/linux-pc/kiosk.mjs', '--launch'];
  if (session.targetKind === 'disposable-linux-vm' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(session.vmId || '')) return ['/opt/kidos-linux-test/kiosk.mjs', '--launch', '--disposable-vm-id', session.vmId];
  throw new Error('Invalid native desktop target.');
}
export function reopenEnvironment(session, inherited) {
  validateDesktopUser(session.user);
  // checkSession has verified the real Wayland socket before this is used.
  // Retain its session type even when removing unrelated inherited variables.
  return { HOME: session.user.homedir, USER: session.user.username, LOGNAME: session.user.username, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', XDG_RUNTIME_DIR: `/run/user/${session.user.uid}`, XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: inherited.WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS: inherited.DBUS_SESSION_BUS_ADDRESS };
}
export async function main(args) {
  if (args.length) throw new Error('The desktop reopen command takes no arguments.');
  const session = await checkSession(userInfo()), command = reopenCommand(session);
  const env = reopenEnvironment(session, process.env);
  // A Pi also has its stock browser; Chromium's dedicated profile handoff is
  // more precise there than focusing an arbitrary Chromium toplevel.
  try {
    if (session.targetKind !== 'disposable-linux-vm') throw new Error('Use the dedicated Pi browser profile.');
    await protectedFile('/usr/bin/wlrctl', { executable: true, read: false });
    for (const match of ['app_id:chromium', 'app_id:chromium-browser', 'app_id:org.chromium.Chromium']) {
      try {
        execFileSync('/usr/bin/wlrctl', ['toplevel', 'find', match], { env, timeout: 500, stdio: 'ignore' });
        execFileSync('/usr/bin/wlrctl', ['toplevel', 'focus', match], { env, timeout: 500, stdio: 'ignore' });
        return;
      } catch {}
    }
  } catch {}
  const source = await realpath(command[0]);
  if (session.targetKind === 'raspberry-pi' && !/^\/opt\/kidos\/releases\/\d+\.\d+\.\d+-pilot\.\d+-[a-f0-9]{12}\/os\/raspberry-pi\/kiosk\.mjs$/.test(source)) throw new Error('Unexpected installed Pi kiosk source.');
  if (session.targetKind === 'linux-pc' && !/^\/opt\/kidos\/releases\/\d+\.\d+\.\d+-pilot\.\d+-[a-f0-9]{12}\/os\/linux-pc\/kiosk\.mjs$/.test(source)) throw new Error('Unexpected installed PC kiosk source.');
  await protectedFile(source, { read: false });
  const child = spawn('/opt/kidos-node/v24.21.0/bin/node', command, { shell: false, env, stdio: 'inherit' });
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
