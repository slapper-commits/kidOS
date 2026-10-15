import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { hash } from './release.mjs';
import { runtimeFor } from './runtime-pin.mjs';

export function validateRuntime(expected, actual) {
  const arch = expected?.targetKind === 'linux-pc' ? 'x64' : 'arm64';
  const pin = runtimeFor(arch);
  if (expected?.stageOnly !== false || expected.executable !== pin.executable || actual.executable !== pin.executable || expected.nodeVersion !== pin.version || actual.version !== pin.version || expected.nodeSha256 !== actual.sha256 || actual.platform !== 'linux' || actual.arch !== arch || (arch === 'x64' && (expected.arch !== arch || expected.archiveSha256 !== pin.archiveSha256))) throw new Error('The pinned Node runtime changed or this is a staging tree. Revalidate and explicitly reinstall the pilot before starting it.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  try {
    validateRuntime(JSON.parse(await readFile('/opt/kidos/runtime.json', 'utf8')), { executable: process.execPath, version: process.version, sha256: hash(await readFile(process.execPath)), platform: process.platform, arch: process.arch });
  } catch (error) { console.error(`kidOS runtime check: ${error.message}`); process.exitCode = 1; }
}
