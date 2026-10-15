import { constants, createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sourcePaths from '../raspberry-pi/source-files.json' with { type: 'json' };
import { CALAMARES_SETTINGS_VERSION, patchCalamares } from './calamares.mjs';

const SOURCE = '/opt/kidos-usb/source/';
const MAX_ISO = 8 * 1024 ** 3;
const runtimeFiles = ['firstboot.mjs', 'session.mjs', 'welcome.py', 'calamares.mjs', 'firstboot.service'];
const fixedFiles = [
  '/etc/passwd', '/etc/shadow', '/etc/machine-id',
  '/etc/systemd/system/kidos-usb-firstboot.service',
  '/opt/kidos-node/v24.21.0/LICENSE', '/usr/share/kidos-usb/NODE-LICENSE',
  '/etc/calamares/settings.conf', '/etc/calamares/modules/users.conf', '/etc/calamares/modules/unpackfs.conf',
  ...runtimeFiles.map(name => `/opt/kidos-usb/${name}`),
  `${SOURCE}RELEASE.json`,
];
const requiredArgs = ['boot=live', 'live-media=removable-usb', 'nopersistence', 'noresume', 'systemd.gpt_auto=0', 'rd.systemd.gpt_auto=0', 'systemd.swap=0'];
const fixedAssignments = requiredArgs.filter(arg => arg.includes('=')).map(arg => arg.slice(0, arg.indexOf('=') + 1));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sameKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function insist(value, message) { if (!value) throw new Error(message); }

// Numeric listing from Debian's unsquashfs -lln. No archive object is extracted
// or executed; only fixed-name ordinary files are read with -cat below.
export function parseListing(text) {
  insist(typeof text === 'string' && Buffer.byteLength(text) <= 64 * 1024 ** 2, 'SquashFS listing is missing or too large.');
  const entries = new Map();
  for (const line of text.split('\n')) {
    insist(line.length <= 16384, 'A SquashFS listing record exceeds the audit bound.');
    if (!line.includes(' squashfs-root')) continue;
    const match = /^([dlcbps-][rwxstST-]{9})\s+(\d+)\/(\d+)\s+.+?\s+(squashfs-root(?:\/.*)?)$/.exec(line);
    insist(match, 'Unexpected SquashFS listing format.');
    const raw = match[4].split(' -> ')[0];
    const path = raw === 'squashfs-root' ? '/' : raw.slice('squashfs-root'.length);
    insist(path.startsWith('/') && !/[\0\r]/.test(path) && !path.split('/').some(part => part === '.' || part === '..') && !entries.has(path), 'Unsafe or duplicate SquashFS path.');
    entries.set(path, { type: match[1][0], mode: match[1], uid: Number(match[2]), gid: Number(match[3]) });
    insist(entries.size <= 500000, 'SquashFS file count exceeds the audit bound.');
  }
  insist(entries.size > 10 && entries.has('/etc/passwd'), 'SquashFS listing is incomplete.');
  return entries;
}

function bytesFor(files, path, limit = 128 * 1024) {
  const value = files instanceof Map ? files.get(path) : files?.[path];
  const bytes = Buffer.isBuffer(value) ? value : typeof value === 'string' ? Buffer.from(value) : null;
  insist(bytes && bytes.length <= limit, 'A required image file is missing or exceeds its audit bound.');
  return bytes;
}
function ordinary(entries, path) {
  const entry = entries.get(path);
  insist(entry?.type === '-' && entry.uid === 0 && !/[wstST]/.test(entry.mode.slice(5)) && !/[stST]/.test(entry.mode), 'A required image file has unsafe ownership, permissions or type.');
  for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) {
    const directory = entries.get(parent);
    insist(directory?.type === 'd' && directory.uid === 0 && !/[wstST]/.test(directory.mode.slice(5)), 'A required image directory has unsafe ownership, permissions or type.');
  }
}
function validateSource(entries, files, paths) {
  let manifest;
  try { manifest = JSON.parse(bytesFor(files, `${SOURCE}RELEASE.json`).toString('utf8')); }
  catch { throw new Error('The image source release manifest is invalid.'); }
  insist(sameKeys(manifest, ['format', 'version', 'runtime', 'contentDigest', 'files']) && manifest.format === 1 && /^\d+\.\d+\.\d+-pilot\.\d+$/.test(manifest.version) && sameKeys(manifest.runtime, ['minimumNodeMajor', 'bundled']) && manifest.runtime.minimumNodeMajor === 22 && manifest.runtime.bundled === false && /^[a-f0-9]{64}$/.test(manifest.contentDigest) && Array.isArray(manifest.files), 'The image source release format is unsupported.');
  const expected = [...paths].sort();
  insist(expected.length > 0 && expected.length <= 512 && new Set(expected).size === expected.length && expected.every(path => /^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(path) && !path.split('/').some(part => part.startsWith('.'))), 'The trusted source allowlist is invalid.');
  insist(manifest.files.length === expected.length, 'The image source allowlist differs from the reviewed recipe.');
  const actual = [];
  for (let index = 0; index < expected.length; index++) {
    const path = expected[index], entry = manifest.files[index];
    insist(sameKeys(entry, ['path', 'size', 'sha256', 'mode']) && entry.path === path && Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= 4 * 1024 ** 2 && entry.mode === 0o644 && /^[a-f0-9]{64}$/.test(entry.sha256), 'The image source entries differ from the reviewed recipe.');
    ordinary(entries, `${SOURCE}${path}`);
    insist(entries.get(`${SOURCE}${path}`).mode === '-rw-r--r--', 'Image source modes differ from the reviewed release.');
    const bytes = bytesFor(files, `${SOURCE}${path}`, 4 * 1024 ** 2);
    insist(bytes.length === entry.size && sha256(bytes) === entry.sha256, 'An image source file differs from its release digest.');
    actual.push(entry);
  }
  insist(sha256(json(actual)) === manifest.contentDigest, 'The image source content digest does not match.');
  const sourceEntries = [...entries.keys()].filter(path => path.startsWith(SOURCE) && entries.get(path).type !== 'd').map(path => path.slice(SOURCE.length)).sort();
  insist(JSON.stringify(sourceEntries) === JSON.stringify([...expected, 'RELEASE.json'].sort()), 'The image source contains unreviewed files or identities.');
  return { version: manifest.version, contentDigest: manifest.contentDigest, files: expected.length };
}

function validateCalamares(files) {
  const users = bytesFor(files, '/etc/calamares/modules/users.conf').toString('utf8');
  const settings = bytesFor(files, '/etc/calamares/settings.conf').toString('utf8');
  const unpackfs = bytesFor(files, '/etc/calamares/modules/unpackfs.conf').toString('utf8');
  // Reverse only our precise, reviewed changes, then have this trusted checkout's
  // helper validate the stock sequence / clean source and reproduce the result.
  // Never import or run the helper copied inside the image under examination.
  const additions = '\n# kidOS: reserve service/live identities; require normal installed login.\nuser:\n  forbidden_names: [root, nobody, kidos, kidos-live]\n  home_permissions: "o700"\ndoAutologin: false\ndisplayAutologin: false\n';
  insist(users.endsWith(additions) && [...settings.matchAll(/^prompt-install: true\s*$/gm)].length === 1, 'The image installer lacks reviewed account defaults or explicit installation confirmation.');
  let patched;
  try { patched = patchCalamares({ version: CALAMARES_SETTINGS_VERSION, users: users.slice(0, -additions.length), settings: settings.replace(/^prompt-install: true\s*$/m, 'prompt-install: false'), unpackfs }); }
  catch { throw new Error('The image installer sequence, account defaults or clean SquashFS source differs from the reviewed configuration.'); }
  insist(patched.users === users && patched.settings === settings && patched.unpackfs === unpackfs, 'The image installer differs from its reviewed configuration.');
}

export function auditExtractedData({ listing, files, bootConfigs, bootReport }, { expectedSourcePaths = sourcePaths, expectedSourceDigest } = {}) {
  insist(typeof expectedSourceDigest === 'string' && /^[a-f0-9]{64}$/.test(expectedSourceDigest), 'Provide the trusted prepared BUILD.json source digest.');
  const entries = parseListing(listing);
  for (const path of fixedFiles.filter(path => path !== '/etc/machine-id')) ordinary(entries, path);
  const passwd = bytesFor(files, '/etc/passwd').toString('utf8').trim().split('\n').map(line => line.split(':'));
  insist(passwd.length > 0 && passwd.every(fields => fields.length === 7 && /^\d+$/.test(fields[2])) && new Set(passwd.map(fields => fields[0])).size === passwd.length && passwd.filter(fields => fields[0] === 'root' && fields[2] === '0').length === 1 && !passwd.some(fields => fields[2] === '0' && fields[0] !== 'root') && !passwd.some(fields => Number(fields[2]) >= 1000 && !(fields[0] === 'nobody' && fields[2] === '65534')), 'The image contains an ordinary desktop account or invalid account records.');
  const shadow = bytesFor(files, '/etc/shadow').toString('utf8').trim().split('\n').map(line => line.split(':'));
  insist(shadow.some(fields => fields[0] === 'root') && shadow.every(fields => fields.length === 9 && /^[!*]+$/.test(fields[1])), 'The image contains an unlocked account or password material.');
  if (entries.has('/etc/machine-id')) { ordinary(entries, '/etc/machine-id'); insist(bytesFor(files, '/etc/machine-id').length === 0, 'The image contains a machine identity.'); }
  if (entries.has('/root/.ssh')) {
    const directory = entries.get('/root/.ssh');
    insist(directory.type === 'd' && directory.uid === 0 && directory.gid === 0 && directory.mode === 'drwx------', 'The image root SSH directory has unsafe ownership, permissions or type.');
    for (const path of ['/root', '/']) {
      const parent = entries.get(path);
      insist(parent?.type === 'd' && parent.uid === 0 && parent.gid === 0 && !/[wstST]/.test(parent.mode.slice(5)) && !/[stST]/.test(parent.mode), 'The image root SSH directory has an unsafe parent.');
    }
  }
  const forbidden = [...entries.keys()].some(path => /^\/home\/.+/.test(path) || /^\/(?:var\/lib\/kidos(?:\/|$)|var\/lib\/kidos-usb(?:\/|$)|opt\/kidos(?:\/|$)|opt\/kidos-native-session(?:\/|$)|root\/\.ssh\/)/.test(path) || /^\/etc\/ssh\/ssh_host_.+_key(?:\.pub)?$/.test(path) || ['/etc/kidos-usb-build.json', '/var/lib/systemd/random-seed', '/var/lib/urandom/random-seed'].includes(path));
  insist(!forbidden, 'The image contains household data, enrollment, build markers, credentials or random seeds.');
  const unit = bytesFor(files, '/etc/systemd/system/kidos-usb-firstboot.service').toString('utf8');
  insist(/^ExecStart=\/opt\/kidos-node\/v24\.21\.0\/bin\/node \/opt\/kidos-usb\/firstboot\.mjs$/m.test(unit) && /^Before=display-manager\.service$/m.test(unit), 'The image first-boot service is missing its reviewed entry point or ordering.');
  const nodeLicense = bytesFor(files, '/opt/kidos-node/v24.21.0/LICENSE', 1024 * 1024);
  insist(nodeLicense.length > 100 && nodeLicense.equals(bytesFor(files, '/usr/share/kidos-usb/NODE-LICENSE', 1024 * 1024)), 'The image Node license notices are missing or inconsistent.');
  const source = validateSource(entries, files, expectedSourcePaths);
  insist(source.contentDigest === expectedSourceDigest, 'The image source digest differs from the trusted prepared recipe.');
  for (const name of runtimeFiles) {
    const path = `/opt/kidos-usb/${name}`;
    insist(expectedSourcePaths.includes(`os/live-usb/${name}`) && bytesFor(files, path).equals(bytesFor(files, `${SOURCE}os/live-usb/${name}`)), 'An active image bootstrap file differs from the trusted packaged source.');
  }
  insist(bytesFor(files, '/etc/systemd/system/kidos-usb-firstboot.service').equals(bytesFor(files, '/opt/kidos-usb/firstboot.service')), 'The installed first-boot unit differs from the trusted bootstrap unit.');
  validateCalamares(files);
  insist(bootConfigs && typeof bootConfigs.grub === 'string' && typeof bootConfigs.syslinux === 'string', 'Both GRUB and Syslinux configurations are required.');
  for (const config of Object.values(bootConfigs)) {
    insist(Buffer.byteLength(config) <= 256 * 1024 && !/[\0\r]/.test(config), 'A boot configuration is invalid or too large.');
    const liveLines = config.split('\n').filter(line => /^\s*(?:linux(?:efi)?|append)\s/i.test(line) && line.split(/\s+/).includes('boot=live'));
    insist(liveLines.length > 0 && liveLines.every(line => {
      const words = line.trim().split(/\s+/);
      return requiredArgs.every(arg => words.includes(arg)) &&
        fixedAssignments.every(prefix => words.filter(word => word.startsWith(prefix)).length === 1) &&
        !words.some(word => word === 'persistence' || /^(?:swap|resume|todisk|bootfrom|findiso|fromiso)=/.test(word));
    }), 'A live boot entry lacks the reviewed temporary-trial settings.');
  }
  insist(typeof bootReport === 'string' && /^El Torito boot img\s*:\s*\d+\s+BIOS\s+y\b/m.test(bootReport) && /^El Torito boot img\s*:\s*\d+\s+UEFI\s+y\b/m.test(bootReport), 'The ISO does not report both bootable BIOS and UEFI entries.');
  return { format: 1, result: 'static-audit-only', passed: true, expectedSourceDigest, source, checks: { noBakedAccountsOrSecrets: true, cleanServiceData: true, freshMachineIdentity: true, sourceAllowlistAndDigests: true, trustedPreparedSourceDigest: true, nodeLicense: true, firstBootUnit: true, activeBootstrapMatchesSource: true, reviewedCalamaresConfiguration: true, temporaryTrialBootArguments: true, biosAndUefiCatalogEntries: true }, bootVerified: false, installationVerified: false, hardwareAccepted: false };
}

export function parseOptions(args) {
  if (args.length !== 6 || args[0] !== '--iso' || args[2] !== '--output-dir' || args[4] !== '--expected-source-digest' || !args[1] || !args[3] || !/^[a-f0-9]{64}$/.test(args[5] || '')) throw new Error('Use --iso ORDINARY_ISO_FILE --output-dir EMPTY_PRIVATE_DIRECTORY --expected-source-digest SHA256_FROM_TRUSTED_BUILD_JSON. This never mounts, boots, installs or writes a drive.');
  return { iso: resolve(args[1]), directory: resolve(args[3]), expectedSourceDigest: args[5] };
}
function run(command, args, maxBuffer = 1024 * 1024, encoding = 'utf8') {
  try { return execFileSync(command, args, { encoding, maxBuffer, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } }); }
  catch { throw new Error('An image inspection tool failed; no tool output or image secrets were printed.'); }
}
async function ordinaryInput(path, maxBytes) {
  const stat = await lstat(path);
  insist(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size > 0 && stat.size <= maxBytes && await realpath(path) === path, 'Audit input must be a bounded ordinary file without links; devices are forbidden.');
  return stat;
}
export async function auditImage({ iso, directory, expectedSourceDigest }) {
  insist(process.platform === 'linux' && process.getuid?.() >= 1000, 'Run the image audit as an ordinary Linux user in the disposable builder; root is refused.');
  insist(typeof expectedSourceDigest === 'string' && /^[a-f0-9]{64}$/.test(expectedSourceDigest), 'Provide the trusted prepared BUILD.json source digest.');
  iso = resolve(iso); directory = resolve(directory);
  await ordinaryInput(iso, MAX_ISO);
  insist(directory !== '/', 'Use an empty private audit directory.');
  for (let parent = dirname(directory); parent !== '/'; parent = dirname(parent)) { const stat = await lstat(parent); insist(stat.isDirectory() && !stat.isSymbolicLink(), 'Audit output parents must be ordinary directories without links.'); }
  let exists = false;
  try { const stat = await lstat(directory); exists = true; insist(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (await readdir(directory)).length === 0, 'Audit output must be an empty directory owned by the current user.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!exists) await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  insist(await realpath(directory) === directory, 'Audit output must not traverse links.');
  const extract = async (source, name, maxBytes) => {
    const path = join(directory, name);
    run('/usr/bin/xorriso', ['-no_rc', '-abort_on', 'FAILURE', '-indev', iso, '-osirrox', 'on', '-extract_single', source, path, '-rollback_end']);
    await ordinaryInput(path, maxBytes); await chmod(path, 0o600);
    return path;
  };
  const squash = await extract('/live/filesystem.squashfs', 'filesystem.squashfs', MAX_ISO);
  const grub = await extract('/boot/grub/grub.cfg', 'grub.cfg', 256 * 1024);
  const syslinux = await extract('/isolinux/live.cfg', 'syslinux-live.cfg', 256 * 1024);
  const listing = run('/usr/bin/unsquashfs', ['-lln', '-no-progress', squash], 64 * 1024 ** 2);
  const entries = parseListing(listing), files = new Map();
  // All source paths come from this trusted checkout, never from image code.
  for (const path of [...fixedFiles, ...sourcePaths.map(path => `${SOURCE}${path}`)]) {
    if (path === '/etc/machine-id' && !entries.has(path)) continue;
    ordinary(entries, path);
    const limit = path.startsWith(SOURCE) ? 4 * 1024 ** 2 : 1024 * 1024;
    files.set(path, run('/usr/bin/unsquashfs', ['-no-progress', '-no-wildcards', '-cat', squash, path.slice(1)], limit, null));
  }
  const bootReport = run('/usr/bin/xorriso', ['-no_rc', '-indev', iso, '-report_el_torito', 'plain', '-rollback_end']);
  const report = auditExtractedData({ listing, files, bootConfigs: { grub: await readFile(grub, 'utf8'), syslinux: await readFile(syslinux, 'utf8') }, bootReport }, { expectedSourceDigest });
  // Digest the ISO as data only; never run programs or hooks from it.
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(iso)) hash.update(bytes);
  report.isoSha256 = hash.digest('hex');
  const output = await open(join(directory, 'audit.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await output.writeFile(json(report)); await output.sync(); } finally { await output.close(); }
  return report;
}
export async function main(args) { console.log(json(await auditImage(parseOptions(args)))); }
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(`kidOS USB static audit stopped: ${error.message}`); process.exitCode = 1; });
