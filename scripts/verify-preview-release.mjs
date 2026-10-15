import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVersion, collectRelease, hash, makeTar, verifyRelease } from '../os/raspberry-pi/release.mjs';
import { stageRelease } from '../os/raspberry-pi/install-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 4 || args[0] !== '--version' || args[2] !== '--output-dir')) {
  throw new Error('Usage: npm run release:verify -- --version 0.0.1-pilot.17 --output-dir work/public-release');
}
const version = checkVersion(args[1] || '0.0.1-pilot.17');
const output = resolve(args[3] || 'work/public-release');
const temp = await mkdtemp(join(tmpdir(), 'kidos-release-'));
try {
  const release = await collectRelease(root, version), bytes = makeTar(release);
  assert.deepEqual(makeTar(await collectRelease(root, version)), bytes, 'Two builds must be byte-identical.');
  const archive = join(temp, 'release.tar'), extracted = join(temp, 'source');
  await writeFile(archive, bytes); await mkdir(extracted);
  execFileSync('tar', ['-xf', archive, '-C', extracted]);
  assert.deepEqual((await verifyRelease(extracted)).manifest, release.manifest);
  await stageRelease(extracted, join(temp, 'staging'));
  // Exercise the PC CLI from the extracted artifact, including native imports
  // through the selected-release symlink. Never invoke a live install in CI.
  const pcStage = join(temp, 'pc-staging');
  const hardware = JSON.parse(execFileSync(process.execPath, [join(extracted, 'os/linux-pc/install.mjs'), '--check-hardware'], { encoding: 'utf8' }));
  assert.equal(hardware.hardwareAccepted, false, 'A code-only hardware report must not certify this build host.');
  execFileSync(process.execPath, [join(extracted, 'os/linux-pc/install.mjs'), '--target-root', pcStage]);
  execFileSync(process.execPath, [join(pcStage, 'opt/kidos/current/os/linux-pc/native.mjs'), '--stage', join(temp, 'pc-native')]);
  const name = `kidos-${version}.tar`;
  await mkdir(output, { recursive: true });
  await writeFile(join(output, name), bytes, { flag: 'wx' });
  await writeFile(join(output, `${name}.sha256`), `${hash(bytes)}  ${name}\n`, { flag: 'wx' });
  console.log(`Verified repeatable build, extracted manifest and staging: ${name}\nSHA-256: ${hash(bytes)}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
