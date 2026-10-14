import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT, FILES, PAINT_DESKTOP_ENTRY, HOST_MANIFEST, DESKTOP_ENTRY, desktopEntry, hostManifest, protectedFile, readRegistration, validateRegistration } from './registration.mjs';
import { EXTENSION_ID } from './extension/protocol.mjs';

const sourceRoot = fileURLToPath(new URL('./', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const identityFor = template => template.format === 1 ? template.vmId : template.user;
async function info(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function directory(path, owner = 0) {
  if (!await info(path)) await mkdir(path, { mode: 0o755 });
  const value = await lstat(path);
  if (!value.isDirectory() || value.isSymbolicLink() || value.uid !== owner || value.mode & 0o022) throw new Error('Unsafe native installation directory.');
}
async function newFile(path, bytes, mode = 0o644) {
  await writeFile(path, bytes, { flag: 'wx', mode }); await chmod(path, mode);
}
async function readSources(root) {
  const sources = [], hashes = {};
  for (const path of FILES) {
    const source = resolve(root, path), value = await lstat(source);
    if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || value.size > 256 * 1024) throw new Error('Unsafe native source input.');
    const bytes = await readFile(source);
    if (bytes.length > 256 * 1024) throw new Error('Native source exceeded its size bound.');
    hashes[path] = createHash('sha256').update(bytes).digest('hex'); sources.push({ path, bytes });
  }
  return { sources, hashes };
}
function receiptFor(template, hashes) {
  const receipt = { ...template, extensionId: EXTENSION_ID, hashes };
  validateRegistration(receipt, identityFor(template));
  return receipt;
}
async function writeSources(root, sources, receipt) {
  for (const path of new Set(sources.map(source => dirname(source.path)).filter(path => path !== '.'))) await mkdir(`${root}/${path}`, { recursive: true, mode: 0o755 });
  for (const { path, bytes } of sources) await newFile(`${root}/${path}`, bytes, path.endsWith('.sh') ? 0o755 : 0o644);
  await newFile(`${root}/install.json`, json(receipt));
}
export async function stageNative(targetRoot, template, { root = sourceRoot } = {}) {
  const { sources, hashes } = await readSources(root), receipt = receiptFor(template, hashes), target = resolve(targetRoot);
  if (target === '/') throw new Error('Use an empty ordinary staging directory, never /.');
  if (!await info(target)) await mkdir(target, { recursive: true, mode: 0o700 });
  const value = await lstat(target);
  if (!value.isDirectory() || value.isSymbolicLink() || (await readdir(target)).length) throw new Error('Native staging target must be an empty ordinary directory.');
  const canonical = await realpath(target), owner = process.getuid();
  const paths = ['opt', 'opt/kidos-native-session', 'etc', 'etc/chromium', 'etc/chromium/native-messaging-hosts', 'usr', 'usr/share', 'usr/share/applications'];
  for (const path of paths) await directory(`${canonical}/${path}`, owner);
  // The extra stageOnly field deliberately prevents this receipt from being
  // accepted as a live registration, even if someone copies it to a Pi.
  await writeSources(`${canonical}${ROOT}`, sources, { ...receipt, stageOnly: true });
  await newFile(`${canonical}${HOST_MANIFEST}`, json(hostManifest()));
  await newFile(`${canonical}${PAINT_DESKTOP_ENTRY}`, sources.find(source => source.path === 'theme/kidos-paint.desktop').bytes);
  if (template.format === 2) await newFile(`${canonical}${DESKTOP_ENTRY}`, desktopEntry());
  await newFile(`${canonical}/STAGING-ONLY.txt`, 'Native-session staging only. Synthetic enrollment and staging ownership are not a live Pi registration. Run the guarded installer on the target.\n');
  return { staged: true, installable: false, target: canonical, files: FILES.length };
}
async function existingSystemFile(path, expected) {
  try {
    if ((await protectedFile(path, { maxBytes: 2048 })).toString() !== expected) throw new Error('An existing system registration belongs to another installation.');
    return true;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
// Target-specific entry points must complete hardware/user/package checks
// first. This shared publication function has no live command-line bypass.
export async function installRegistration(template) {
  if (process.platform !== 'linux' || process.arch !== 'arm64' || process.getuid?.() !== 0) throw new Error('Native registration installation requires root on Linux ARM64.');
  const { sources, hashes } = await readSources(sourceRoot), receipt = receiptFor(template, hashes);
  const manifestBytes = json(hostManifest());
  const manifestExists = await existingSystemFile(HOST_MANIFEST, manifestBytes);
  const paintDesktop = sources.find(source => source.path === 'theme/kidos-paint.desktop').bytes.toString();
  const paintDesktopExists = await existingSystemFile(PAINT_DESKTOP_ENTRY, paintDesktop);
  const desktopExists = template.format === 2 ? await existingSystemFile(DESKTOP_ENTRY, desktopEntry()) : false;
  const previous = Boolean(await info(ROOT));
  if (previous) await readRegistration(identityFor(template));
  for (const path of ['/opt', '/etc', '/etc/chromium', '/etc/chromium/native-messaging-hosts', '/usr', '/usr/share', '/usr/share/applications']) await directory(path);
  const staging = `/opt/.kidos-native-session-${randomUUID()}`;
  await directory(staging); await writeSources(staging, sources, receipt);
  const backup = previous ? `${ROOT}.previous-${randomUUID()}` : null;
  if (backup) await rename(ROOT, backup);
  try { await rename(staging, ROOT); }
  catch (error) { if (backup) await rename(backup, ROOT); throw error; }
  if (!manifestExists) await newFile(HOST_MANIFEST, manifestBytes);
  if (!paintDesktopExists) await newFile(PAINT_DESKTOP_ENTRY, paintDesktop);
  if (template.format === 2 && !desktopExists) await newFile(DESKTOP_ENTRY, desktopEntry());
  await readRegistration(identityFor(template));
  return { installed: true, targetKind: template.format === 2 ? 'raspberry-pi' : 'disposable-linux-vm', extensionId: EXTENSION_ID, root: ROOT, backup, browserRestartRequired: true, processesStopped: false, userSetupRequired: template.format === 2 };
}
