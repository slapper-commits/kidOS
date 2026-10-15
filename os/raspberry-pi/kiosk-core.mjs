import { lstat, mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const start = '# BEGIN kidOS supervised pilot', end = '# END kidOS supervised pilot';
export function autostartText(existing, enable, entry) {
  const from = existing.indexOf(start), to = existing.indexOf(end);
  if ((from < 0) !== (to < 0) || (from >= 0 && (to < from || existing.indexOf(start, from + 1) >= 0 || existing.indexOf(end, to + 1) >= 0))) throw new Error('The existing kidOS autostart block is malformed; inspect it before continuing.');
  let preserved = existing;
  if (from >= 0) {
    const after = to + end.length + (existing[to + end.length] === '\n' ? 1 : 0);
    preserved = existing.slice(0, from) + existing.slice(after);
  }
  if (!enable) return preserved;
  if (typeof entry !== 'string' || !entry || /[\r\n]/.test(entry)) throw new Error('A single autostart command is required.');
  return `${preserved}${preserved && !preserved.endsWith('\n') ? '\n' : ''}${start}\n${entry}\n${end}\n`;
}
async function info(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function userDirectory(path, uid, privateMode = false) {
  const details = await info(path);
  if (details && (!details.isDirectory() || details.isSymbolicLink() || details.uid !== uid)) throw new Error(`Refusing a linked or differently owned desktop directory: ${path}`);
  if (!details) await mkdir(path, { mode: 0o700 });
  if (privateMode) await chmod(path, 0o700);
}
async function desktopUser(arch) {
  const user = userInfo();
  if (process.platform !== 'linux' || process.arch !== arch || user.uid < 1000 || process.getuid?.() === 0) throw new Error('Run kiosk setup as your already-enrolled ordinary desktop user, without sudo.');
  return user;
}
export function chromiumArguments(profile, nativeExtension = false, presentation = 'kiosk') {
  if (typeof nativeExtension !== 'boolean') throw new Error('Native extension selection must be explicit.');
  if (!['kiosk', 'desktop'].includes(presentation)) throw new Error('Choose the desktop or kiosk presentation.');
  return [`--user-data-dir=${profile}`, ...(nativeExtension ? ['--load-extension=/opt/kidos-native-session/extension'] : []), '--no-first-run', '--no-default-browser-check', ...(presentation === 'desktop' ? ['--start-maximized', '--app=http://127.0.0.1:8787/'] : ['--kiosk', 'http://127.0.0.1:8787/'])];
}
export function desktopAutostartText(command) {
  if (typeof command !== 'string' || !/^\/opt\/kidos-node\/v[0-9.]+\/bin\/node \/opt\/kidos\/current\/os\/(?:raspberry-pi|linux-pc)\/kiosk\.mjs --launch$/.test(command)) throw new Error('Unexpected Pi/PC desktop startup command.');
  return `[Desktop Entry]\nType=Application\nName=kidOS\nComment=Open the kidOS desktop\nExec=${command}\nIcon=computer\nTerminal=false\nX-kidOS-Managed=true\n`;
}
export async function configureDesktopAutostart(user, enable, command) {
  const desired = desktopAutostartText(command);
  const config = resolve(user.homedir, '.config'), directory = resolve(config, 'autostart'), path = resolve(directory, 'kidos.desktop');
  await userDirectory(user.homedir, user.uid);
  if (!enable && (!(await info(config)) || !(await info(directory)))) return;
  await userDirectory(config, user.uid); await userDirectory(directory, user.uid);
  const details = await info(path);
  if (details) {
    if (!details.isFile() || details.isSymbolicLink() || details.uid !== user.uid || details.nlink !== 1) throw new Error('Refusing an unsafe kidOS desktop startup file.');
    const existing = await readFile(path, 'utf8');
    // Only replace our exact generated format, including an older runtime pin.
    const previous = existing.match(/^Exec=(.+)$/m)?.[1];
    if (!previous || desktopAutostartText(previous) !== existing) throw new Error('An unrelated kidOS desktop startup file already exists. Preserve it and choose another name before setup.');
  }
  if (!enable) { if (details) await unlink(path); return; }
  const temporary = `${path}.kidos-${process.pid}`;
  await writeFile(temporary, desired, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
export async function runKiosk(args, { targetCheck, entry, nativeExtension = false, presentation = 'kiosk', desktopAutostartCommand, arch = 'arm64' }) {
  if (args.length !== 1 || !['--launch', '--enable-autostart', '--disable-autostart'].includes(args[0])) throw new Error('Choose --launch, --enable-autostart, or --disable-autostart.');
  const user = await desktopUser(arch);
  await targetCheck(user);
  await userDirectory(user.homedir, user.uid);
  if (args[0] !== '--launch') {
    if (desktopAutostartCommand) {
      await configureDesktopAutostart(user, args[0] === '--enable-autostart', desktopAutostartCommand);
      console.log(args[0] === '--enable-autostart' ? 'kidOS will open after your next normal desktop login. The Pi panel and login settings were kept.' : 'Removed only the kidOS desktop startup entry. Your browser profile and family data were kept.');
      return;
    }
    const config = resolve(user.homedir, '.config'), labwc = resolve(config, 'labwc'), path = resolve(labwc, 'autostart');
    await userDirectory(config, user.uid); await userDirectory(labwc, user.uid);
    const details = await info(path);
    if (details && (!details.isFile() || details.isSymbolicLink() || details.uid !== user.uid || details.nlink !== 1)) throw new Error('Refusing an unsafe labwc autostart file.');
    const existing = details ? await readFile(path, 'utf8') : '';
    const temporary = `${path}.kidos-${process.pid}`;
    await writeFile(temporary, autostartText(existing, args[0] === '--enable-autostart', entry), { flag: 'wx', mode: details ? details.mode & 0o777 : 0o700 });
    await rename(temporary, path);
    console.log(args[0] === '--enable-autostart' ? 'kidOS will open after your next normal desktop login. Login settings were not changed.' : 'Removed only the kidOS autostart block. Your browser profile and family data were kept.');
    return;
  }
  if (!process.env.WAYLAND_DISPLAY && !process.env.DISPLAY) throw new Error('Open the kiosk from your logged-in graphical desktop session.');
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(1000) }); healthy = response.ok; } catch {}
    if (healthy) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  if (!healthy) throw new Error('The kidOS service is not ready. Check sudo systemctl status kidos.service.');
  const local = resolve(user.homedir, '.local'), share = resolve(local, 'share'), profile = resolve(share, 'kidos-browser');
  await userDirectory(local, user.uid); await userDirectory(share, user.uid); await userDirectory(profile, user.uid, true);
  // Chromium's sandbox remains enabled. Never run the browser as root, use
  // --no-sandbox, or point it at the service account's private family data.
  const extensionEnabled = typeof nativeExtension === 'function' ? await nativeExtension(user) : nativeExtension;
  const child = spawn('/usr/bin/chromium', chromiumArguments(profile, extensionEnabled, presentation), { stdio: 'inherit' });
  child.on('error', error => { console.error(`Chromium could not start: ${error.message}`); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
}
