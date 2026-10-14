import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { json } from './release.mjs';
import { installLive, stageRelease } from './install-core.mjs';
export { runtimeVersion, stageRelease } from './install-core.mjs';

const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
export function parseOptions(args) {
  if (args.length === 2 && args[0] === '--target-root' && args[1]) return { targetRoot: resolve(args[1]), live: false };
  if (args.length === 1 && args[0] === '--install-on-this-pi') return { targetRoot: '/', live: true };
  throw new Error('Choose exactly one: --target-root EMPTY_DIRECTORY (staging), or --install-on-this-pi (explicit live install).');
}
export async function piPreflight() {
  if (process.platform !== 'linux' || process.arch !== 'arm64' || process.getuid?.() !== 0) throw new Error('Live install requires root on Linux ARM64 Raspberry Pi hardware. Use --target-root for a staging rehearsal.');
  const model = await readFile('/proc/device-tree/model', 'utf8');
  if (!model.startsWith('Raspberry Pi ')) throw new Error('This is not a detected Raspberry Pi.');
  const os = await readFile('/etc/os-release', 'utf8'), issue = await readFile('/etc/rpi-issue', 'utf8');
  if (!/^VERSION_CODENAME=["']?trixie["']?$/m.test(os) || !/Raspberry Pi/.test(issue)) throw new Error('This pilot recipe targets Raspberry Pi OS Trixie 64-bit Desktop.');
  try { await lstat('/usr/bin/chromium'); await lstat('/usr/bin/labwc'); await lstat('/run/systemd/system'); }
  catch { throw new Error('Install requires the Raspberry Pi OS Desktop, Chromium, labwc, and a running systemd.'); }
  return { targetKind: 'raspberry-pi', model: model.replace(/\0/g, '').trim(), osRelease: os };
}
export async function main(args) {
  const options = parseOptions(args);
  const result = options.live ? await installLive(sourceRoot, await piPreflight()) : await stageRelease(sourceRoot, options.targetRoot);
  console.log(json(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`kidOS install stopped: ${error.message}`); process.exitCode = 1; });
}
