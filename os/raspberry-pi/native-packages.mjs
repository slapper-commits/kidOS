import { spawnSync } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { piPreflight } from './install.mjs';

// Distribution packages supply their own dependency resolution and license notices.
// Never download a private game demo or alter APT sources here.
export const NATIVE_PACKAGES = Object.freeze([
  'kolourpaint', 'pcmanfm-qt', 'gvfs', 'xdg-user-dirs', 'qt6-wayland',
  'breeze-icon-theme', 'qt6-svg-plugins', 'libreoffice-writer', 'libreoffice-qt6',
  'kcalc', 'wlrctl', 'openttd', 'openttd-opengfx', 'openttd-opensfx', 'openttd-openmsx',
  'kpat', 'kmines', 'pinball', 'pinball-data',
  'sgt-puzzles', 'python3-minimal', 'python3-gi', 'gir1.2-gtk-3.0',
]);
export function packageCommands(args) {
  if (args.length !== 1 || args[0] !== '--install-on-this-pi') throw new Error('Choose --install-on-this-pi explicitly. Run this only on the dedicated Raspberry Pi.');
  return [['update'], ['install', '--no-remove', ...NATIVE_PACKAGES]];
}
export async function main(args) {
  const commands = packageCommands(args);
  await piPreflight();
  for (const command of commands) {
    const result = spawnSync('/usr/bin/apt-get', command, { shell: false, stdio: 'inherit', env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', HOME: '/root' } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Package preparation stopped (${result.signal || result.status}). Review APT's output before continuing.`);
  }
  console.log('Native packages installed. Next enroll your ordinary desktop account with os/native-session/install-pi.mjs.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`kidOS package setup stopped: ${error.message}`); process.exitCode = 1; });
}
