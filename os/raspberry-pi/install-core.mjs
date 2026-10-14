import { chmod, chown, lstat, mkdir, readFile, readdir, readlink, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hash, json, releaseId, verifyRelease } from './release.mjs';
import { PILOT_NODE } from './runtime-pin.mjs';

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } }).trim();
const exists = async path => { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const serviceBytes = release => {
  const file = release.files.find(entry => entry.path === 'os/raspberry-pi/kidos.service');
  if (!file) throw new Error('The release is missing its service unit.');
  return file.bytes;
};
export function runtimeVersion(version) {
  if (version !== PILOT_NODE.version) throw new Error(`Install the pinned Node.js ${PILOT_NODE.version} runtime at ${PILOT_NODE.executable} first. The installer never downloads a runtime.`);
  return version;
}
async function safeDirectory(path, mode = 0o755, ownerCheck = false) {
  const info = await exists(path);
  if (info) {
    if (!info.isDirectory() || info.isSymbolicLink() || (ownerCheck && (info.uid !== 0 || info.mode & 0o022))) throw new Error(`Refusing unsafe installation directory: ${path}`);
  } else await mkdir(path, { mode });
}
async function newFile(path, bytes, mode = 0o644) {
  await writeFile(path, bytes, { flag: 'wx', mode });
  await chmod(path, mode);
}
async function atomicFile(path, bytes, mode = 0o644) {
  const info = await exists(path);
  if (info && (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 || info.mode & 0o022)) throw new Error(`Refusing unsafe installation file: ${path}`);
  const temporary = `${path}.new-${process.pid}`;
  await newFile(temporary, bytes, mode);
  await rename(temporary, path);
}
async function copyRelease(release, destination) {
  await mkdir(destination, { mode: 0o755 });
  const made = new Set([destination]);
  for (const { path, bytes } of release.files) {
    const pieces = path.split('/'); pieces.pop();
    let directory = destination;
    for (const piece of pieces) {
      directory = resolve(directory, piece);
      if (!made.has(directory)) { await mkdir(directory, { mode: 0o755 }); made.add(directory); }
    }
    await newFile(resolve(destination, path), bytes);
  }
  await newFile(resolve(destination, 'RELEASE.json'), json(release.manifest));
}

export async function stageRelease(root, targetRoot, nodeVersion = PILOT_NODE.version) {
  const release = await verifyRelease(root);
  const unit = serviceBytes(release);
  runtimeVersion(nodeVersion);
  const target = resolve(targetRoot);
  if (target === '/') throw new Error('Staging requires an explicit empty target directory, never /.');
  if (!await exists(target)) await mkdir(target, { recursive: true, mode: 0o755 });
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(target)).length) throw new Error('Staging target must be an empty ordinary directory.');
  const canonical = await realpath(target), id = releaseId(release.manifest);
  for (const path of ['opt', 'opt/kidos', 'opt/kidos/releases', 'etc', 'etc/systemd', 'etc/systemd/system', 'var', 'var/lib']) await safeDirectory(resolve(canonical, path));
  await safeDirectory(resolve(canonical, 'var/lib/kidos'), 0o700);
  await copyRelease(release, resolve(canonical, 'opt/kidos/releases', id));
  await symlink(`releases/${id}`, resolve(canonical, 'opt/kidos/current'));
  await newFile(resolve(canonical, 'opt/kidos/runtime.json'), json({ nodeVersion, executable: PILOT_NODE.executable, archiveSha256: PILOT_NODE.archiveSha256, stageOnly: true }));
  await newFile(resolve(canonical, 'etc/systemd/system/kidos.service'), unit);
  await newFile(resolve(canonical, 'STAGING-ONLY.txt'), 'Staging only: ownership is the staging user. No service account was created and no service was enabled. Run the guarded installer on the Pi; do not copy this tree over /.\n');
  return { id, target: canonical, staged: true };
}

function requireLinuxRoot() {
  if (process.platform !== 'linux' || process.arch !== 'arm64' || process.getuid?.() !== 0) throw new Error('Live installation requires root on Linux ARM64.');
}
async function runtimePreflight() {
  requireLinuxRoot();
  if (!await exists('/usr/bin/chromium') || !await exists('/usr/bin/labwc') || !await exists('/run/systemd/system')) throw new Error('Install requires Chromium, labwc, and a running systemd.');
  const node = await realpath(PILOT_NODE.executable);
  if (node !== PILOT_NODE.executable) throw new Error('The dedicated Node runtime must not be a symbolic link.');
  for (const path of ['/opt', '/opt/kidos-node', PILOT_NODE.directory, `${PILOT_NODE.directory}/bin`, node]) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || info.uid !== 0 || info.mode & 0o022 || (path === node ? !info.isFile() || !(info.mode & 0o111) : !info.isDirectory())) throw new Error('The dedicated Node runtime and its parent directories must be root-owned and not writable by other users.');
  }
  const version = runtimeVersion(run(node, ['--version']));
  if (run(node, ['-p', 'process.platform + "/" + process.arch']) !== 'linux/arm64') throw new Error('The dedicated Node runtime must be Linux ARM64.');
  const license = await lstat(`${PILOT_NODE.directory}/LICENSE`);
  if (!license.isFile() || license.isSymbolicLink() || license.uid !== 0 || license.mode & 0o022) throw new Error('Keep the official Node distribution LICENSE file with the dedicated runtime.');
  return { nodeVersion: version, executable: node, archiveSha256: PILOT_NODE.archiveSha256, nodeSha256: hash(await readFile(node)) };
}
async function serviceIdentity() {
  let passwd = '';
  try { passwd = run('/usr/bin/getent', ['passwd', 'kidos']); } catch {}
  if (!passwd) {
    run('/usr/sbin/useradd', ['--system', '--user-group', '--home-dir', '/var/lib/kidos', '--no-create-home', '--shell', '/usr/sbin/nologin', 'kidos']);
    passwd = run('/usr/bin/getent', ['passwd', 'kidos']);
  }
  const [name, , uid, gid, , home, shell] = passwd.split(':');
  const group = run('/usr/bin/getent', ['group', 'kidos']).split(':');
  if (name !== 'kidos' || Number(uid) < 1 || Number(uid) >= 1000 || home !== '/var/lib/kidos' || shell !== '/usr/sbin/nologin' || group[2] !== gid || group[3]) throw new Error('An existing kidos account/group does not match the dedicated non-login service identity.');
  const passwordStatus = run('/usr/bin/passwd', ['-S', 'kidos']).split(/\s+/)[1];
  if (passwordStatus !== 'L') throw new Error('The kidos service account must have a locked password.');
  const groups = [...new Set(run('/usr/bin/id', ['-G', 'kidos']).split(/\s+/))];
  if (groups.length !== 1 || groups[0] !== gid) throw new Error('The kidos service identity must not belong to supplementary groups.');
  return { uid: Number(uid), gid: Number(gid) };
}
async function rejectServiceOverrides() {
  for (const base of ['/etc/systemd/system', '/run/systemd/system', '/usr/local/lib/systemd/system', '/usr/lib/systemd/system', '/lib/systemd/system']) {
    for (const name of ['kidos.service.d', 'service.d']) {
      const path = `${base}/${name}`, info = await exists(path);
      if (info && (!info.isDirectory() || info.isSymbolicLink() || (await readdir(path)).length)) throw new Error(`Existing systemd overrides could change the kidOS service; inspect them first: ${path}`);
    }
  }
  if (run('/usr/bin/systemctl', ['show', 'kidos.service', '--property=DropInPaths', '--value'])) throw new Error('Loaded systemd overrides could change the kidOS service; inspect them first.');
}
// Callers must perform their own target identity checks before entering this
// common privileged path. This module has no live CLI or target bypass flag.
export async function installLive(root, target) {
  requireLinuxRoot();
  if (!target || !['raspberry-pi', 'disposable-linux-vm'].includes(target.targetKind)) throw new Error('A validated installation target is required.');
  const release = await verifyRelease(root), runtime = { ...target, ...await runtimePreflight() }, id = releaseId(release.manifest);
  const unit = serviceBytes(release);
  await rejectServiceOverrides();
  for (const path of ['/opt', '/opt/kidos', '/opt/kidos/releases', '/etc/systemd', '/etc/systemd/system', '/var/lib']) await safeDirectory(path, 0o755, true);
  const identity = await serviceIdentity(), data = await exists('/var/lib/kidos');
  if (data && (!data.isDirectory() || data.isSymbolicLink() || data.uid !== identity.uid || data.gid !== identity.gid || data.mode & 0o077)) throw new Error('Existing /var/lib/kidos must be a private directory owned by the kidos service account.');
  if (!data) { await mkdir('/var/lib/kidos', { mode: 0o700 }); await chown('/var/lib/kidos', identity.uid, identity.gid); }
  const destination = `/opt/kidos/releases/${id}`;
  if (await exists(destination)) {
    const existing = await verifyRelease(destination);
    if (existing.manifest.contentDigest !== release.manifest.contentDigest) throw new Error('Installed release differs from the incoming release.');
    for (const entry of [...existing.files, { path: 'RELEASE.json' }]) {
      const absolute = resolve(destination, entry.path), info = await lstat(absolute);
      if (info.uid !== 0 || info.mode & 0o022) throw new Error(`Installed code is not protected from ordinary-user writes: ${entry.path}`);
      let parent = dirname(absolute);
      while (parent !== '/opt/kidos/releases') { await safeDirectory(parent, 0o755, true); parent = dirname(parent); }
    }
  } else {
    const temporary = `/opt/kidos/releases/.incoming-${process.pid}`;
    await copyRelease(release, temporary);
    await rename(temporary, destination);
  }
  const current = await exists('/opt/kidos/current');
  if (current && (!current.isSymbolicLink() || !/^releases\/\d+\.\d+\.\d+-pilot\.\d+-[a-f0-9]{12}$/.test(await readlink('/opt/kidos/current')))) throw new Error('Existing /opt/kidos/current is not a pilot release link.');
  const previous = current ? await readlink('/opt/kidos/current') : null;
  const installedUnit = await exists('/etc/systemd/system/kidos.service');
  if (installedUnit) run('/usr/bin/systemctl', ['stop', 'kidos.service']);
  await atomicFile('/opt/kidos/runtime.json', json({ ...runtime, stageOnly: false }));
  await atomicFile('/etc/systemd/system/kidos.service', unit);
  const link = `/opt/kidos/.current-${process.pid}`;
  await symlink(`releases/${id}`, link); await rename(link, '/opt/kidos/current');
  await atomicFile('/opt/kidos/install-receipt.json', json({ release: id, previousRelease: previous, installedAt: new Date().toISOString(), runtime }));
  run('/usr/bin/systemctl', ['daemon-reload']);
  await rejectServiceOverrides();
  for (const [property, expected] of [['FragmentPath', '/etc/systemd/system/kidos.service'], ['User', 'kidos'], ['Group', 'kidos']]) {
    if (run('/usr/bin/systemctl', ['show', 'kidos.service', `--property=${property}`, '--value']) !== expected) throw new Error('The effective systemd service differs from the verified pilot unit. Inspect it before starting.');
  }
  run('/usr/bin/systemctl', ['enable', '--now', 'kidos.service']);
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(1000) });
      healthy = response.ok && (await response.json()).name === 'kidOS';
    } catch {}
    if (healthy) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  run('/usr/bin/systemctl', ['is-active', '--quiet', 'kidos.service']);
  if (!healthy) throw new Error('The service did not become healthy. Inspect journalctl -u kidos.service; the receipt and previous release were retained.');
  return { id, installed: true, url: 'http://127.0.0.1:8787/' };
}
