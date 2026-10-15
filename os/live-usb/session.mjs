import { spawnSync, spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';

const NODE = '/opt/kidos-node/v24.21.0/bin/node';
export function sessionCommands({ platform, arch, uid, args }) {
  if (platform !== 'linux' || arch !== 'x64' || !Number.isSafeInteger(uid) || uid < 1000 || !Array.isArray(args) || args.length) throw new Error('Open kidOS as the ordinary Linux desktop user. This launcher takes no arguments.');
  return [
    { executable: NODE, args: ['/opt/kidos-native-session/native-launch.mjs', '--setup-user'] },
    { executable: '/usr/bin/python3', args: ['-I', '/opt/kidos-usb/welcome.py', '--startup'] },
  ];
}
export async function main(args) {
  const commands = sessionCommands({ platform: process.platform, arch: process.arch, uid: process.getuid?.(), args });
  const user = userInfo();
  if (process.env.HOME !== user.homedir) throw new Error('Use the ordinary desktop home.');
  // Verify the guarded enrollment before any user preference writes or UI launch.
  const registration = '/opt/kidos-native-session/registration.mjs';
  for (const path of ['/opt', '/opt/kidos-native-session', registration]) {
    const info = await lstat(path);
    if (info.uid !== 0 || info.mode & 0o022 || info.isSymbolicLink()) throw new Error('USB session source is not protected.');
  }
  const { checkEnrolledPcUser } = await import(pathToFileURL(registration));
  await checkEnrolledPcUser(user);
  const setup = spawnSync(commands[0].executable, commands[0].args, { shell: false, stdio: 'inherit' });
  if (setup.error || setup.status !== 0) throw new Error('kidOS could not prepare the native application folders.');
  const child = spawn(commands[1].executable, commands[1].args, { shell: false, stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => {
  console.error(`kidOS USB session stopped: ${error.message}`);
  if (process.platform === 'linux' && process.getuid?.() >= 1000 && (process.env.WAYLAND_DISPLAY || process.env.DISPLAY)) {
    spawnSync('/usr/bin/kdialog', ['--title', 'kidOS', '--error', 'kidOS could not start. You can keep using the Linux desktop. Check USB help and choose a Plasma (Wayland) login before trying again.'], { shell: false, stdio: 'ignore' });
  }
  process.exitCode = 1;
});
