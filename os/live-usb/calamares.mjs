import { constants } from 'node:fs';
import { chmod, lstat, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CALAMARES_SETTINGS_VERSION = '13.0.13-1';
export const CALAMARES_SOURCE = 'https://browse.dgit.debian.org/calamares-settings-debian.git/commit/?id=438cb1938e7b831b2e2c9dd24384ff30dfbea8db';

// Reviewed Debian 13 settings, ISC licensed; upstream attribution remains in the
// installed package's /usr/share/doc/calamares-settings-debian/copyright.
// Compare the supported YAML subset rather than depending on a YAML runtime.
const stockUsers = [
  '---', 'userGroup: users', 'defaultGroups:', '- cdrom', '- floppy', '- sudo',
  '- audio', '- dip', '- video', '- plugdev', '- netdev', '- lpadmin', '- scanner',
  '- bluetooth', 'autologinGroup: autologin', 'sudoersGroup: sudo',
  'setRootPassword: false', 'passwordRequirements:', 'nonempty: true',
  'minLength: -1', 'maxLength: -1', 'libpwquality:', '- minlen=0', '- minclass=0',
];
const sequence = [
  'sequence:', '- show:', '- welcome', '- locale', '- keyboard', '- partition',
  '- users', '- summary', '- exec:', '- partition', '- mount', '- unpackfs',
  '- luksbootkeyfile', '- dpkg-unsafe-io', '- sources-media', '- machineid',
  '- fstab', '- locale', '- keyboard', '- localecfg', '- users', '- displaymanager',
  '- networkcfg', '- hwclock', '- services-systemd', '- bootloader-config',
  '- grubcfg', '- bootloader', '- packages', '- plymouthcfg', '- initramfscfg',
  '- initramfs', '- dpkg-unsafe-io-undo', '- sources-media-unmount',
  '- sources-final', '- umount', '- show:', '- finished',
];
const userAdditions = '\n# kidOS: reserve service/live identities; require normal installed login.\nuser:\n  forbidden_names: [root, nobody, kidos, kidos-live]\n  home_permissions: "o700"\ndoAutologin: false\ndisplayAutologin: false\n';

function lines(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 64 * 1024 || /[\0\r\t]/.test(text)) throw new Error('Unexpected Calamares configuration bytes.');
  // Stock mapping padding is presentation. Normalize only ASCII separator
  // spaces for comparison; preserve the raw output bytes and nesting checks.
  return text.split('\n').map(raw => ({ indent: raw.length - raw.trimStart().length, value: raw.replace(/\s+#.*$/, '').trim().replace(/^([A-Za-z][A-Za-z0-9_-]*:) +/, '$1 ') })).filter(line => line.value && !line.value.startsWith('#'));
}
const same = (actual, expected) => actual.length === expected.length && actual.every((item, index) => item === expected[index]);
function exactlyOne(text, pattern, message) {
  if ([...text.matchAll(pattern)].length !== 1) throw new Error(message);
}
export function patchCalamares({ version, users, settings, unpackfs }) {
  if (version !== CALAMARES_SETTINGS_VERSION) throw new Error('The Calamares settings package needs a new independent review.');
  const parsedUsers = lines(users), parsedSettings = lines(settings);
  // Only this frozen sequence mapping permits stock padding after the dash.
  const parsedUnpackfs = lines(unpackfs).map(line => ({ ...line, value: line.value.replace(/^- +source: +/, '- source: ') }));
  if (!same(parsedUsers.map(line => line.value), stockUsers)) throw new Error('Unexpected Debian users.conf; preserve upstream account policy and review changes.');
  // Mapping fields must retain their stock top-level / nested relationship.
  const nested = new Set(['nonempty: true', 'minLength: -1', 'maxLength: -1', 'libpwquality:']);
  const children = parsedUsers.filter(line => nested.has(line.value));
  if (children.some(line => line.indent < 1 || line.indent !== children[0].indent) || parsedUsers.some(line => !line.value.startsWith('- ') && !nested.has(line.value) && line.indent !== 0)) throw new Error('Unexpected Debian account configuration nesting.');
  const quality = parsedUsers.filter(line => /^- min(?:len|class)=/.test(line.value));
  if (quality.some(line => line.indent <= children[0].indent || line.indent !== quality[0].indent)) throw new Error('Unexpected Debian password configuration nesting.');
  const first = parsedSettings.findIndex(line => line.value === 'sequence:');
  const expectedSettings = ['---', 'modules-search: [ local, /usr/lib/calamares/modules ]', 'oem-setup: false', 'disable-cancel: false', 'disable-cancel-during-exec: false', 'quit-at-end: false', ...sequence, 'branding: debian', 'prompt-install: false', 'dont-chroot: false'];
  if (first < 0 || !same(parsedSettings.map(line => line.value), expectedSettings)) throw new Error('Unexpected Calamares install sequence or mode; disk selection and summary must be reviewed.');
  const sequenceLines = parsedSettings.slice(first, first + sequence.length);
  if (sequenceLines.some(line => line.indent !== (line.value === 'sequence:' || /^- (?:show|exec):$/.test(line.value) ? 0 : 2)) || parsedSettings.some((line, index) => (index < first || index >= first + sequence.length) && line.indent !== 0)) throw new Error('Unexpected Calamares install sequence nesting.');
  // Do not install from the running overlay, which contains trial creations and
  // enrollment. Debian's read-only SquashFS source must remain byte-for-byte.
  if (!same(parsedUnpackfs.map(line => line.value), ['---', 'unpack:', '- source: "/run/live/medium/live/filesystem.squashfs"', 'sourcefs: "squashfs"', 'destination: ""'])) throw new Error('Calamares must install the clean read-only live filesystem.');
  const sourceMapping = /^ +- +source: +/m.exec(unpackfs);
  const mappingColumn = sourceMapping?.[0].indexOf('source:');
  if (!sourceMapping || parsedUnpackfs[0].indent !== 0 || parsedUnpackfs[1].indent !== 0 || parsedUnpackfs[2].indent < 1 || parsedUnpackfs[3].indent !== mappingColumn || parsedUnpackfs[4].indent !== mappingColumn) throw new Error('Unexpected Calamares clean filesystem mapping nesting.');
  exactlyOne(settings, /^prompt-install: false\s*$/gm, 'Unexpected install confirmation setting.');
  return { users: `${users.replace(/\n*$/, '\n')}${userAdditions}`, settings: settings.replace(/^prompt-install: false\s*$/m, 'prompt-install: true'), unpackfs };
}

async function protectedConfig(path, maxBytes = 64 * 1024) {
  for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) {
    const stat = await lstat(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.mode & 0o022) throw new Error('Unsafe Calamares configuration directory.');
  }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== 0 || stat.mode & 0o022 || stat.size > maxBytes) throw new Error('Unsafe Calamares configuration file.');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > maxBytes) throw new Error('Calamares configuration changed.');
    const text = await file.readFile('utf8');
    if (Buffer.byteLength(text) > maxBytes) throw new Error('Calamares configuration exceeded its bound.');
    return { text, mode: stat.mode & 0o777 };
  } finally { await file.close(); }
}
async function replaceConfig(path, text, mode) {
  const temporary = `${path}.kidos-${randomUUID()}`;
  let file;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
    await file.writeFile(text); await file.sync(); await file.close(); file = null;
    await chmod(temporary, mode); await rename(temporary, path);
  } finally { await file?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function main(args) {
  // This CLI is a chroot-build operation only. There is no target-root option,
  // disk argument, runtime privilege grant, or way to invoke an installer.
  if (args.length !== 1 || args[0] !== '--configure-image') throw new Error('Use --configure-image only in the marked kidOS USB build chroot.');
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid?.() !== 0) throw new Error('Calamares configuration requires the root Debian amd64 image build.');
  const marker = JSON.parse((await protectedConfig('/etc/kidos-usb-build.json', 1024)).text);
  if (JSON.stringify(Object.keys(marker).sort()) !== '["format","purpose"]' || marker.format !== 1 || marker.purpose !== 'kidOS live USB build') throw new Error('Missing protected kidOS USB build marker.');
  const osRelease = await readFile('/usr/lib/os-release', 'utf8');
  if (!/^ID=["']?debian["']?$/m.test(osRelease) || !/^VERSION_ID=["']?13["']?$/m.test(osRelease) || !/^VERSION_CODENAME=["']?trixie["']?$/m.test(osRelease)) throw new Error('The image build requires Debian 13 Trixie.');
  const version = execFileSync('/usr/bin/dpkg-query', ['-W', '-f=${Version}', 'calamares-settings-debian'], { encoding: 'utf8', timeout: 1000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } }).trim();
  const base = '/etc/calamares', usersPath = `${base}/modules/users.conf`, settingsPath = `${base}/settings.conf`, unpackfsPath = `${base}/modules/unpackfs.conf`;
  const [users, settings, unpackfs] = await Promise.all([protectedConfig(usersPath), protectedConfig(settingsPath), protectedConfig(unpackfsPath)]);
  const patched = patchCalamares({ version, users: users.text, settings: settings.text, unpackfs: unpackfs.text });
  await replaceConfig(usersPath, patched.users, users.mode);
  await replaceConfig(settingsPath, patched.settings, settings.mode);
  console.log('Prepared reviewed Calamares account defaults and explicit install confirmation.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(`kidOS USB installer configuration stopped: ${error.message}`); process.exitCode = 1; });
