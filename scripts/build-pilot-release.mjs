import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRelease, makeTar, hash } from '../os/raspberry-pi/release.mjs';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--version' || args[2] !== '--output-dir') {
  console.error('Usage: node scripts/build-pilot-release.mjs --version 0.0.1-pilot.1 --output-dir work/releases');
  process.exitCode = 1;
} else {
  try {
    const release = await collectRelease(fileURLToPath(new URL('../', import.meta.url)), args[1]);
    const bytes = makeTar(release), name = `kidos-${release.manifest.version}.tar`, directory = resolve(args[3]);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, name), bytes, { flag: 'wx', mode: 0o644 });
    await writeFile(resolve(directory, `${name}.sha256`), `${hash(bytes)}  ${name}\n`, { flag: 'wx', mode: 0o644 });
    console.log(`Built ${resolve(directory, name)}\nSHA-256: ${hash(bytes)}\n${release.files.length} allowlisted source files; no runtime, image, or family data.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
