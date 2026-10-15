import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

export const SOURCE = '/opt/kidos-usb/source';
export const RECEIPT = '/var/lib/kidos-usb/firstboot.json';
const NODE = '/opt/kidos-node/v24.21.0/bin/node';
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } }).trim();
async function info(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

export function requireBootAuthority({ platform, arch, uid }) {
  if (platform !== 'linux' || arch !== 'x64' || uid !== 0) throw new Error('USB first boot requires root on normally booted Debian x64.');
}
export function bootMode(cmdline, medium) {
  const live = String(cmdline).split(/\s+/).includes('boot=live');
  if (live !== Boolean(medium)) throw new Error('The live boot marker and mounted live medium disagree.');
  if (medium && (!medium.isDirectory() || medium.isSymbolicLink() || medium.uid !== 0)) throw new Error('The live medium must be an ordinary root-owned mount directory.');
  return live ? 'live' : 'installed';
}
// live-config writes /etc/sddm.conf after image drop-ins, selecting the
// highest-priority x-session-manager alternative. pcmanfm-qt recommendations
// install LXQt, whose priority exceeds Plasma X11. Select the installed Plasma
// Wayland session only for the already-validated temporary live account.
export function livePlasmaConfiguration(text) {
  const prefix = '[Autologin]\nUser=kidos-live\nSession=';
  if (text !== `${prefix}lxqt.desktop\n` && text !== `${prefix}plasma.desktop\n`) throw new Error('Unexpected live-config SDDM configuration; inspect it before selecting the live session.');
  return `${prefix}plasma.desktop\n`;
}
function ordinaryUserCommand(user, executable, args) {
  if (!user || user.uid !== 1000 || !Number.isSafeInteger(user.gid) || user.gid < 1 || !/^[a-z_][a-z0-9_-]{0,31}$/.test(user.username || '') || user.username === 'root' || user.homedir !== `/home/${user.username}`) throw new Error('Use the validated ordinary desktop account for user setup.');
  return { executable: '/usr/sbin/runuser', args: ['-u', user.username, '--', executable, ...args] };
}
export function nativeUserSetupCommand(user) {
  return ordinaryUserCommand(user, NODE, ['/opt/kidos-native-session/native-launch.mjs', '--setup-user']);
}
export function liveScreenLockCommands(user, read = false) {
  validateFirstbootUser(user, 'live');
  return ['Autolock', 'LockOnResume'].map(key => ordinaryUserCommand(user, `/usr/bin/${read ? 'kreadconfig6' : 'kwriteconfig6'}`, ['--file', `${user.homedir}/.config/kscreenlockerrc`, '--group', 'Daemon', '--key', key, ...(read ? ['--default', 'true'] : ['--type', 'bool', 'false'])]));
}
export function liveWalletCommands(user, read = false) {
  validateFirstbootUser(user, 'live');
  return [ordinaryUserCommand(user, `/usr/bin/${read ? 'kreadconfig6' : 'kwriteconfig6'}`, ['--file', `${user.homedir}/.config/kwalletrc`, '--group', 'Wallet', '--key', 'Enabled', ...(read ? ['--default', 'true'] : ['--type', 'bool', 'false'])])];
}
export function validateLiveUserPath(value, user, file = false) {
  if (!value || value.isSymbolicLink() || value.uid !== user.uid || value.mode & 0o022 || (file ? !value.isFile() || value.nlink !== 1 || value.size > 64 * 1024 : !value.isDirectory())) throw new Error('Unsafe live desktop settings path.');
}
export function validateFirstbootUser(user, mode) {
  if (user?.uid !== 1000 || (mode === 'live' && (user.username !== 'kidos-live' || user.homedir !== '/home/kidos-live')) || (mode === 'installed' && user?.username === 'kidos-live')) throw new Error('First boot requires the fresh desktop account created by live-config or the graphical installer.');
  return user;
}
export function validateFirstbootReceipt(receipt, expected) {
  if (!receipt || Object.keys(receipt).sort().join(',') !== 'format,mode,release,sourceDigest,user' || receipt.format !== 1 || receipt.mode !== expected.mode || receipt.release !== expected.release || receipt.sourceDigest !== expected.sourceDigest || !receipt.user || Object.keys(receipt.user).sort().join(',') !== 'gid,homedir,uid,username' || ['username', 'uid', 'gid', 'homedir'].some(key => receipt.user[key] !== expected.user[key])) throw new Error('Existing USB first-boot enrollment differs from this source, boot mode or desktop account.');
}
export function validateServiceReceipts(receipt, runtime, release) {
  if (receipt?.release !== release.id || receipt.runtime?.targetKind !== 'linux-pc' || receipt.runtime.arch !== 'x64') throw new Error('Existing kidOS installation differs from this USB source.');
  // installLive records the verified runtime facts in the installation receipt;
  // only runtime.json adds stageOnly:false. Neither a staging receipt nor an
  // installation receipt which claims that extra field is an accepted source.
  if (Object.hasOwn(receipt.runtime, 'stageOnly') || runtime?.stageOnly !== false || !isDeepStrictEqual({ ...receipt.runtime, stageOnly: false }, runtime)) throw new Error('The service runtime receipts disagree.');
}

// This runs before importing any application code from the image. It is a
// publication check, not a way to accept a staging installation as live.
export async function protectedSource(root = SOURCE, { inspect = lstat, children = readdir, canonical = realpath } = {}) {
  if (root !== SOURCE) throw new Error('The USB bootstrap source path is fixed.');
  for (let parent = root; parent !== '/'; parent = dirname(parent)) {
    const value = await inspect(parent);
    if (!value.isDirectory() || value.isSymbolicLink() || value.uid !== 0 || value.mode & 0o022 || await canonical(parent) !== parent) throw new Error('USB source directories must be protected root-owned ordinary directories.');
  }
  let count = 0;
  async function visit(directory) {
    for (const name of await children(directory)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw new Error('Unexpected USB source entry.');
      const path = resolve(directory, name), value = await inspect(path);
      if (++count > 2048 || value.isSymbolicLink() || value.uid !== 0 || value.mode & 0o022) throw new Error('Unsafe USB source ownership, link or size.');
      if (value.isDirectory()) await visit(path);
      else if (!value.isFile() || value.nlink !== 1 || value.size > 4 * 1024 * 1024) throw new Error('Unsafe USB source file.');
    }
  }
  await visit(root);
}

// The orchestration is injectable for isolated fixtures; the command line has
// no target-root, force, chroot, alternate-user or guard-bypass switches.
export async function prepareFirstBoot(effects) {
  const target = await effects.target();
  const mode = bootMode(await effects.cmdline(), await effects.medium());
  const user = validateFirstbootUser(await effects.user(), mode);
  const release = await effects.release();
  const expected = { format: 1, mode, release: release.id, sourceDigest: release.contentDigest, user };
  const previous = await effects.previous();
  if (previous) validateFirstbootReceipt(previous, expected);
  const installed = await effects.installed();
  if (installed) await effects.validateInstalled(installed, release);
  // Debian live-config supplies the temporary account at boot. Do not retain
  // its upstream default login password; the supervised trial uses autologin.
  if (mode === 'live') await effects.lockLiveAccount();
  if (!installed) {
    if (previous) throw new Error('First-boot receipt exists without its service installation.');
    await effects.installService(target);
  }
  const native = await effects.native(user);
  if (!native) {
    if (previous) throw new Error('First-boot receipt exists without its native enrollment.');
    await effects.installNative(user.username);
  }
  // Run the existing guarded filesystem setup as the enrolled ordinary user
  // before a desktop can create .local/share with a group-writable umask.
  await effects.setupNativeUser(user);
  if (mode === 'live') {
    await effects.configureLiveScreenLock(user);
    await effects.configureLiveWallet(user);
    await effects.selectLiveSession();
  }
  if (!previous) await effects.publish(expected);
  return { ready: true, mode, alreadyPrepared: Boolean(previous), release: release.id };
}

async function actualEffects() {
  requireBootAuthority({ platform: process.platform, arch: process.arch, uid: process.getuid?.() });
  await protectedSource();
  const load = path => import(pathToFileURL(`${SOURCE}/${path}`).href);
  const [{ pcTarget, existingDesktopUser }, { verifyRelease, releaseId, hash }, { installLive }, { protectedFile, readRegistration }, { validateRuntime }] = await Promise.all([
    load('os/native-session/target.mjs'), load('os/raspberry-pi/release.mjs'), load('os/raspberry-pi/install-core.mjs'), load('os/native-session/registration.mjs'), load('os/raspberry-pi/check-runtime.mjs'),
  ]);
  const readJson = async path => JSON.parse(await protectedFile(path, { maxBytes: 128 * 1024 }));
  return {
    target: () => pcTarget({ install: true }),
    cmdline: () => readFile('/proc/cmdline', 'utf8'),
    medium: () => info('/run/live/medium'),
    user: async () => {
      const fields = run('/usr/bin/getent', ['passwd', '1000']).split(':');
      if (fields.length !== 7 || fields[2] !== '1000') throw new Error('No unique installer-created desktop account exists at UID 1000.');
      return existingDesktopUser(fields[0]);
    },
    release: async () => { const value = await verifyRelease(SOURCE); return { id: releaseId(value.manifest), contentDigest: value.manifest.contentDigest }; },
    previous: async () => await info(RECEIPT) ? readJson(RECEIPT) : null,
    installed: async () => await info('/opt/kidos/install-receipt.json') ? readJson('/opt/kidos/install-receipt.json') : null,
    validateInstalled: async (receipt, release) => {
      const runtime = await readJson('/opt/kidos/runtime.json');
      validateServiceReceipts(receipt, runtime, release);
      if (await realpath(NODE) !== NODE) throw new Error('The dedicated Node runtime must not be a symbolic link.');
      const executable = await protectedFile(NODE, { executable: true, maxBytes: 256 * 1024 * 1024 });
      validateRuntime(runtime, { platform: process.platform, arch: process.arch, executable: NODE, version: run(NODE, ['--version']), sha256: hash(executable) });
      const installed = await verifyRelease('/opt/kidos/current');
      if (releaseId(installed.manifest) !== release.id) throw new Error('Installed kidOS source differs from the USB source.');
    },
    installService: target => installLive(SOURCE, target),
    lockLiveAccount: async () => {
      if (run('/usr/bin/passwd', ['-S', 'root']).split(/\s+/)[1] !== 'L') throw new Error('The live root password must already be locked.');
      if (run('/usr/bin/passwd', ['-S', 'kidos-live']).split(/\s+/)[1] !== 'L') run('/usr/bin/passwd', ['-l', 'kidos-live']);
      if (run('/usr/bin/passwd', ['-S', 'kidos-live']).split(/\s+/)[1] !== 'L') throw new Error('The temporary live account password could not be locked.');
    },
    setupNativeUser: async user => {
      const command = nativeUserSetupCommand(user);
      run(command.executable, command.args);
    },
    configureLiveScreenLock: async user => {
      // This temporary password-locked trial account uses autologin. Disable
      // automatic/resume locking only here; installed password policy stays put.
      for (const path of [user.homedir, `${user.homedir}/.config`]) validateLiveUserPath(await info(path), user);
      const path = `${user.homedir}/.config/kscreenlockerrc`, before = await info(path);
      if (before) validateLiveUserPath(before, user, true);
      for (const executable of ['/usr/bin/kwriteconfig6', '/usr/bin/kreadconfig6']) await protectedFile(executable, { executable: true, read: false });
      for (const command of liveScreenLockCommands(user)) run(command.executable, command.args);
      validateLiveUserPath(await info(path), user, true);
      for (const command of liveScreenLockCommands(user, true)) if (run(command.executable, command.args) !== 'false') throw new Error('The temporary live account screen-lock policy was not applied.');
    },
    configureLiveWallet: async user => {
      // The ephemeral trial has no login password or persisted credentials.
      // Leave normal installed wallet/password behavior to its chosen account.
      for (const path of [user.homedir, `${user.homedir}/.config`]) validateLiveUserPath(await info(path), user);
      const path = `${user.homedir}/.config/kwalletrc`, before = await info(path);
      if (before) validateLiveUserPath(before, user, true);
      for (const executable of ['/usr/bin/kwriteconfig6', '/usr/bin/kreadconfig6']) await protectedFile(executable, { executable: true, read: false });
      for (const command of liveWalletCommands(user)) run(command.executable, command.args);
      validateLiveUserPath(await info(path), user, true);
      for (const command of liveWalletCommands(user, true)) if (run(command.executable, command.args) !== 'false') throw new Error('The temporary live account wallet policy was not applied.');
    },
    selectLiveSession: async () => {
      const path = '/etc/sddm.conf';
      const current = await protectedFile(path, { maxBytes: 4096 });
      const updated = livePlasmaConfiguration(current.toString('utf8'));
      const session = (await protectedFile('/usr/share/wayland-sessions/plasma.desktop', { maxBytes: 64 * 1024 })).toString('utf8');
      if (!session.includes('\nExec=/usr/lib/x86_64-linux-gnu/libexec/plasma-dbus-run-session-if-needed /usr/bin/startplasma-wayland\n') || !session.includes('\nTryExec=/usr/bin/startplasma-wayland\n')) throw new Error('The supported Plasma Wayland session is unavailable.');
      if (current.toString('utf8') === updated) return;
      const temporary = `${path}.new-${process.pid}`;
      await writeFile(temporary, updated, { flag: 'wx', mode: 0o644 });
      await chmod(temporary, 0o644); await rename(temporary, path);
    },
    native: async user => {
      const registration = await readRegistration(user, { optional: true });
      if (registration && (registration.format !== 3 || registration.targetKind !== 'linux-pc')) throw new Error('USB first boot requires a PC native registration.');
      return registration;
    },
    installNative: async username => { run(NODE, ['/opt/kidos/current/os/linux-pc/native.mjs', '--install', '--desktop-user', username]); },
    publish: async receipt => {
      const directory = dirname(RECEIPT), value = await info(directory);
      if (value && (!value.isDirectory() || value.isSymbolicLink() || value.uid !== 0 || value.mode & 0o077)) throw new Error('Unsafe first-boot receipt directory.');
      if (!value) await mkdir(directory, { mode: 0o700 });
      const temporary = `${RECEIPT}.new-${process.pid}`;
      await writeFile(temporary, json(receipt), { flag: 'wx', mode: 0o600 });
      await chmod(temporary, 0o600); await rename(temporary, RECEIPT);
    },
  };
}
export async function main(args) {
  if (args.length) throw new Error('USB first boot takes no arguments; it only configures the currently booted system.');
  console.log(JSON.stringify(await prepareFirstBoot(await actualEffects())));
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(`kidOS USB first boot stopped: ${error.message}`); process.exitCode = 1; });
