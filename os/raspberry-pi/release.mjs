import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

export const FORMAT = 1;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => `${JSON.stringify(value, null, 2)}\n`;
export function checkVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+-pilot\.\d+$/.test(version)) throw new Error('Use a pilot version such as 0.0.1-pilot.1.');
  return version;
}
export function checkPath(path) {
  if (typeof path !== 'string' || path.length > 99 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/.test(path) || path.split('/').some(part => part.startsWith('.'))) throw new Error(`Unsafe release path: ${path}`);
  return path;
}
export async function readSource(root, path) {
  checkPath(path);
  const absolute = resolve(root, path);
  if (relative(root, absolute).startsWith(`..${sep}`) || absolute === root) throw new Error('Release path escapes the source directory.');
  const info = await lstat(absolute);
  if (!info.isFile() || info.nlink !== 1 || await realpath(absolute) !== absolute) throw new Error(`Release inputs must be ordinary files without links: ${path}`);
  if (info.size > 4 * 1024 * 1024) throw new Error(`Unexpectedly large source file: ${path}`);
  return readFile(absolute);
}
export async function allowedFiles(root) {
  const paths = JSON.parse(await readSource(root, 'os/raspberry-pi/source-files.json'));
  if (!Array.isArray(paths) || paths.length < 10 || paths.length > 512 || new Set(paths).size !== paths.length) throw new Error('Invalid source allowlist.');
  return paths.map(checkPath).sort();
}
export async function collectRelease(sourceRoot, version) {
  const root = await realpath(sourceRoot), files = [];
  for (const path of await allowedFiles(root)) {
    const bytes = await readSource(root, path);
    files.push({ path, size: bytes.length, sha256: hash(bytes), mode: 0o644, bytes });
  }
  const entries = files.map(({ bytes, ...entry }) => entry);
  const manifest = { format: FORMAT, version: checkVersion(version), runtime: { minimumNodeMajor: 22, bundled: false }, contentDigest: hash(json(entries)), files: entries };
  return { root, manifest, files };
}
export async function verifyRelease(sourceRoot) {
  const root = await realpath(sourceRoot);
  const manifest = JSON.parse(await readSource(root, 'RELEASE.json'));
  if (manifest.format !== FORMAT) throw new Error('Unsupported pilot release format.');
  checkVersion(manifest.version);
  const expected = await collectRelease(root, manifest.version);
  if (json(expected.manifest) !== json(manifest)) throw new Error('Release verification failed: files or manifest changed.');
  return expected;
}
export function releaseId(manifest) { return `${manifest.version}-${manifest.contentDigest.slice(0, 12)}`; }

// Portable ustar: sorted files only, fixed modes, uid/gid/mtime zero, no host
// names, directory records, links, extended attributes, or incidental files.
export function makeTar(release) {
  const files = [...release.files.map(({ path, bytes }) => ({ path, bytes })), { path: 'RELEASE.json', bytes: Buffer.from(json(release.manifest)) }].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const blocks = [];
  for (const { path, bytes } of files) {
    const header = Buffer.alloc(512);
    header.write(path, 0, 100, 'ascii');
    const octal = (value, offset, length) => header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(bytes.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
