import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectRelease, json, releaseId } from '../raspberry-pi/release.mjs';
import { NATIVE_PACKAGES } from '../raspberry-pi/native-packages.mjs';
import { PC_NODE } from '../raspberry-pi/runtime-pin.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const epoch = 1791936000; // 2026-10-14 00:00:00 UTC; stable source/recipe timestamps.
export const BUILD_MARKER = Object.freeze({ format: 1, purpose: 'kidOS live USB build' });
// live-boot's removable-usb branch fails closed without probing internal
// filesystems. A particular device/label alone falls back to a general scan.
export const LIVE_ARGS = 'boot=live components live-media=removable-usb username=kidos-live hostname=kidos-live nopersistence noresume systemd.gpt_auto=0 rd.systemd.gpt_auto=0 systemd.swap=0';
export const IMAGE_PACKAGES = Object.freeze([...new Set([
  'live-boot', 'live-config', 'live-config-systemd', 'kde-plasma-desktop',
  'sddm', 'kwin-wayland', 'plasma-nm', 'plasma-pa', 'powerdevil',
  'systemsettings', 'pipewire-audio', 'desktop-base', 'plymouth', 'fonts-dejavu-core',
  'calamares', 'calamares-settings-debian=13.0.13-1', 'chromium', 'kdialog',
  'sudo', 'polkitd', 'pkexec', 'xz-utils', 'udisks2', 'network-manager', 'firmware-linux',
  'firmware-iwlwifi', 'firmware-realtek', 'firmware-brcm80211', ...NATIVE_PACKAGES,
])]);
export const RUNTIME_FILES = Object.freeze(['firstboot.mjs', 'firstboot.service', 'session.mjs', 'welcome.py', 'calamares.mjs', 'build-hook.sh']);
export const BUILD_HELPERS = Object.freeze(['boot-policy.py', 'build-boot-policy.py']);

export function parseOptions(args) {
  if (args.length !== 6 || args[0] !== '--version' || args[2] !== '--node-archive' || args[4] !== '--output-dir' || !args[1] || !args[3] || !args[5]) throw new Error('Use --version X.Y.Z-pilot.N --node-archive VERIFIED_NODE_X64_TAR_XZ --output-dir EMPTY_DIRECTORY. This prepares files only; it never builds, mounts or flashes a disk.');
  return { version: args[1], nodeArchive: resolve(args[3]), directory: resolve(args[5]) };
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function put(base, path, bytes, mode = 0o644) {
  const file = join(base, path);
  await mkdir(dirname(file), { recursive: true, mode: 0o755 });
  await writeFile(file, bytes, { flag: 'wx', mode });
  await chmod(file, mode);
}
export function autoConfig() {
  return [
    '#!/bin/sh', 'set -eu', `export SOURCE_DATE_EPOCH=${epoch}`,
    `lb config noauto --ignore-system-defaults --mode debian --architecture amd64 --distribution trixie --security true --mirror-chroot-security http://deb.debian.org/debian-security --mirror-binary-security http://deb.debian.org/debian-security --parent-mirror-chroot-security http://deb.debian.org/debian-security --parent-mirror-binary-security http://deb.debian.org/debian-security --binary-image iso-hybrid --bootloaders "syslinux grub-efi" --uefi-secure-boot enable --debian-installer live --debian-installer-gui true --archive-areas "main non-free non-free-firmware" --parent-archive-areas "main non-free non-free-firmware" --firmware-chroot true --firmware-binary true --apt-recommends true --source true --source-images tar --memtest none --iso-volume KIDOS_TRY --iso-publisher "kidOS developer preview" --bootappend-live "${LIVE_ARGS}" --bootappend-live-failsafe "${LIVE_ARGS} nomodeset" "$@"`,
    '',
  ].join('\n');
}
export function buildScript() {
  return `#!/bin/sh
set -eu
# Only run inside a deliberately disposable, normally booted Debian amd64 builder.
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] && [ "$(id -u)" = 0 ] || { echo 'Use root inside a disposable Debian 13 amd64 build VM.' >&2; exit 1; }
case "$(systemd-detect-virt --vm)" in qemu|kvm) ;; *) echo 'Use a disposable QEMU/KVM builder.' >&2; exit 1 ;; esac
python3 -I - <<'PY'
import json, os, stat
p = '/etc/kidos-live-usb-builder.json'
s = os.lstat(p)
assert stat.S_ISREG(s.st_mode) and s.st_uid == 0 and stat.S_IMODE(s.st_mode) == 0o600
assert json.load(open(p)) == {'format': 1, 'disposable': True, 'purpose': 'kidOS live USB builder'}
PY
[ -f BUILD.json ] && [ -f config/includes.chroot/etc/kidos-usb-build.json ] || { echo 'Not a prepared kidOS image recipe.' >&2; exit 1; }
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ] || exit 1
[ -d /run/systemd/system ] || { echo 'Use a normally booted build VM.' >&2; exit 1; }
export SOURCE_DATE_EPOCH=${epoch}
lb config
lb build
printf '%s\n' 'Image build finished. Keep binary.* source/license outputs and package manifests with the ISO. No USB drive was written.'
`;
}
export async function prepare({ version, nodeArchive, directory }, { sourceRoot = root, expectedNodeSha256 = PC_NODE.archiveSha256 } = {}) {
  // All inputs are verified before creating the output directory.
  const release = await collectRelease(sourceRoot, version);
  const node = await lstat(nodeArchive);
  if (!node.isFile() || node.isSymbolicLink() || node.nlink !== 1 || node.size > 128 * 1024 * 1024 || await digest(nodeArchive) !== expectedNodeSha256) throw new Error('Node archive does not match the reviewed official Linux x64 SHA-256.');
  const assets = await Promise.all(RUNTIME_FILES.map(async name => {
    const path = join(sourceRoot, 'os/live-usb', name), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 256 * 1024) throw new Error('Unsafe USB runtime source.');
    return { name, bytes: await readFile(path) };
  }));
  const buildHelpers = await Promise.all(BUILD_HELPERS.map(async name => {
    const path = join(sourceRoot, 'os/live-usb', name), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 64 * 1024) throw new Error('Unsafe USB build helper; prepare from the full checkout.');
    return { name, bytes: await readFile(path) };
  }));
  directory = resolve(directory);
  if (directory === '/') throw new Error('Choose an empty ordinary recipe directory, never /.');
  let info;
  try { info = await lstat(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (info && (!info.isDirectory() || info.isSymbolicLink() || (await readdir(directory)).length)) throw new Error('Recipe output must be an empty ordinary directory.');
  if (!info) await mkdir(directory, { recursive: true, mode: 0o755 });
  directory = await realpath(directory);
  const includes = 'config/includes.chroot';
  for (const file of release.files) await put(directory, `${includes}/opt/kidos-usb/source/${file.path}`, file.bytes);
  await put(directory, `${includes}/opt/kidos-usb/source/RELEASE.json`, json(release.manifest));
  for (const { name, bytes } of assets.filter(asset => asset.name !== 'build-hook.sh')) await put(directory, `${includes}/opt/kidos-usb/${name}`, bytes, name.endsWith('.py') ? 0o755 : 0o644);
  await put(directory, `${includes}/etc/kidos-usb-build.json`, json(BUILD_MARKER));
  await put(directory, 'config/package-lists/kidos.list.chroot', `${IMAGE_PACKAGES.join('\n')}\n`);
  await put(directory, 'config/hooks/live/0900-kidos.hook.chroot', assets.find(asset => asset.name === 'build-hook.sh').bytes, 0o755);
  for (const { name, bytes } of buildHelpers) await put(directory, `config/build-helpers/${name}`, bytes);
  await put(directory, 'config/hooks/live/0950-kidos-boot-policy.hook.binary', '#!/bin/sh\nset -eu\nexec /usr/bin/python3 -I ../config/build-helpers/build-boot-policy.py\n', 0o755);
  await put(directory, 'auto/config', autoConfig(), 0o755);
  await put(directory, 'build.sh', buildScript(), 0o755);
  await put(directory, 'BUILD.json', json({ format: 1, target: 'debian-trixie-amd64-live', release: releaseId(release.manifest), sourceDigest: release.manifest.contentDigest, nodeArchive: PC_NODE.archive, nodeSha256: expectedNodeSha256, sourceDateEpoch: epoch, diskWrites: false, isoVerified: false, buildHelpers: buildHelpers.map(({ name, bytes }) => ({ path: `config/build-helpers/${name}`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mode: 0o644 })) }));
  const cachedNode = join(directory, includes, 'opt/kidos-usb', PC_NODE.archive);
  await copyFile(nodeArchive, cachedNode);
  if (await digest(cachedNode) !== expectedNodeSha256) throw new Error('Node archive changed while preparing the recipe. Discard this incomplete recipe.');
  await chmod(cachedNode, 0o644);
  return { prepared: true, directory, release: releaseId(release.manifest), imageBuilt: false, driveWritten: false };
}
export async function main(args) { console.log(JSON.stringify(await prepare(parseOptions(args)))); }
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) main(process.argv.slice(2)).catch(error => { console.error(`kidOS USB preparation stopped: ${error.message}`); process.exitCode = 1; });
