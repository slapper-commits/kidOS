import { constants } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export const MARKER = '/etc/kidos-linux-test.json';
export const RECEIPT = '/opt/kidos/install-receipt.json';
export function checkVmId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error('Provide the exact disposable VM UUID with --disposable-vm-id.');
  return value;
}
export function validateVmFacts({ platform, arch, uid, osRelease, virtualization }, requireRoot) {
  if (platform !== 'linux' || arch !== 'arm64' || (requireRoot ? uid !== 0 : !Number.isInteger(uid) || uid < 1000)) throw new Error(requireRoot ? 'VM install requires root on a disposable Linux ARM64 VM.' : 'VM kiosk requires an ordinary Linux ARM64 desktop user, without sudo.');
  if (!/^ID=["']?debian["']?$/m.test(osRelease) || !/^VERSION_ID=["']?13["']?$/m.test(osRelease) || !/^VERSION_CODENAME=["']?trixie["']?$/m.test(osRelease)) throw new Error('This disposable VM test requires Debian 13 Trixie.');
  if (!['qemu', 'kvm'].includes(virtualization)) throw new Error('This test wrapper requires a detected QEMU or KVM virtual machine.');
}
export function validateMarker(value, vmId) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'disposable,format,vmId' || value.format !== 1 || value.disposable !== true || value.vmId !== checkVmId(vmId)) throw new Error('The private disposable VM marker does not match the explicitly selected VM.');
}
export function validateProtectedFile(info, privateMode, label) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== 0 || (privateMode ? (info.mode & 0o7777) !== 0o600 : Boolean(info.mode & 0o022)) || info.size > (privateMode ? 1024 : 128 * 1024)) throw new Error(`Refusing an unsafe ${label}: requires an ordinary, bounded, root-owned ${privateMode ? '0600 private' : 'protected'} file.`);
}
async function protectedParents(path) {
  for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) {
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || info.mode & 0o022) throw new Error(`Refusing an unsafe test-target directory: ${parent}`);
  }
}
async function protectedFile(path, privateMode, read) {
  await protectedParents(path);
  const info = await lstat(path);
  validateProtectedFile(info, privateMode, path);
  if (!read) return;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    validateProtectedFile(await handle.stat(), privateMode, path);
    const bytes = await handle.readFile();
    if (bytes.length > (privateMode ? 1024 : 128 * 1024)) throw new Error('Test-target file exceeded its read bound.');
    return JSON.parse(bytes.toString('utf8'));
  } finally { await handle.close(); }
}
export function validateReceipt(receipt, vmId, virtualization) {
  const runtime = receipt?.runtime;
  if (!runtime || runtime.targetKind !== 'disposable-linux-vm' || runtime.vmId !== checkVmId(vmId) || runtime.virtualization !== virtualization || !/^\d+\.\d+\.\d+-pilot\.\d+-[a-f0-9]{12}$/.test(receipt.release)) throw new Error('The protected installation receipt does not attest this disposable VM.');
}
export async function vmTarget(vmId, { install = false } = {}) {
  checkVmId(vmId);
  // Fail on other hosts before reading the guest marker or invoking commands.
  const identity = { platform: process.platform, arch: process.arch, uid: process.getuid?.() };
  if (identity.platform !== 'linux' || identity.arch !== 'arm64' || (install ? identity.uid !== 0 : identity.uid < 1000)) throw new Error(install ? 'VM install requires root on a disposable Linux ARM64 VM.' : 'VM kiosk requires an ordinary Linux ARM64 desktop user, without sudo.');
  const osRelease = await readFile('/etc/os-release', 'utf8');
  let virtualization;
  try { virtualization = execFileSync('/usr/bin/systemd-detect-virt', ['--vm'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } }).trim(); }
  catch { throw new Error('This test wrapper requires a detected QEMU or KVM virtual machine.'); }
  validateVmFacts({ ...identity, osRelease, virtualization }, install);
  if (install) validateMarker(await protectedFile(MARKER, true, true), vmId);
  else {
    // The ordinary desktop user cannot read the root-only marker. Its protected
    // stat plus the installer's public, root-protected attestation establish the
    // explicit target without granting that user access to the private marker.
    await protectedFile(MARKER, true, false);
    validateReceipt(await protectedFile(RECEIPT, false, true), vmId, virtualization);
  }
  return { targetKind: 'disposable-linux-vm', vmId, virtualization, osRelease };
}
