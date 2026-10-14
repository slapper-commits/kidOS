import { realpath, lstat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { checkVmId, vmTarget } from './target.mjs';

export function parseOptions(args) {
  if (args.length !== 3 || !['--launch', '--enable-autostart', '--disable-autostart'].includes(args[0]) || args[1] !== '--disposable-vm-id') throw new Error('Choose --launch, --enable-autostart, or --disable-autostart followed by --disposable-vm-id UUID.');
  return { action: args[0], vmId: checkVmId(args[2]) };
}
export function autostartEntry(executable, vmId) {
  checkVmId(vmId);
  if (!/^\/opt\/kidos-node\/v\d+\.\d+\.\d+\/bin\/node$/.test(executable)) throw new Error('Use the dedicated pinned Node runtime.');
  return `${executable} /opt/kidos-linux-test/kiosk.mjs --launch --disposable-vm-id ${vmId} &`;
}
export async function nativeBridgeEnabled(vmId) {
  const root = '/opt/kidos-native-session';
  try { await lstat(root); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  await checkNativeImportFiles();
  const { checkRegistration } = await import(`${root}/registration.mjs`);
  return checkRegistration(vmId);
}
export async function checkNativeImportFiles(inspect = lstat) {
  const root = '/opt/kidos-native-session';
  // Validate the transitive import closure before loading the installed opt-in.
  // Older verified registrations predate target/theme; absence is permitted
  // for those two modules, but any module present must already be protected.
  for (const [path, directory, optional] of [
    ['/opt', true], [root, true], [`${root}/extension`, true],
    [`${root}/registration.mjs`, false], [`${root}/extension/protocol.mjs`, false],
    [`${root}/target.mjs`, false, true], [`${root}/theme.mjs`, false, true],
  ]) {
    let info;
    try { info = await inspect(path); } catch (error) { if (optional && error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink() || info.uid !== 0 || info.mode & 0o022 || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size > 256 * 1024)) throw new Error('Unsafe native session registration code.');
  }
}
export async function main(args) {
  const options = parseOptions(args);
  await vmTarget(options.vmId);
  const { runKiosk } = await import('/opt/kidos/current/os/raspberry-pi/kiosk-core.mjs');
  const { PILOT_NODE } = await import('/opt/kidos/current/os/raspberry-pi/runtime-pin.mjs');
  const nativeExtension = options.action === '--launch' ? await nativeBridgeEnabled(options.vmId) : false;
  return runKiosk([options.action], { targetCheck: () => vmTarget(options.vmId), entry: autostartEntry(PILOT_NODE.executable, options.vmId), nativeExtension, presentation: 'desktop' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(`kidOS VM kiosk stopped: ${error.message}`); process.exitCode = 1; });
}
