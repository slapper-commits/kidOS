import { readFile } from 'node:fs/promises';
import { hash } from './release.mjs';
import { PILOT_NODE } from './runtime-pin.mjs';
try {
  const expected = JSON.parse(await readFile('/opt/kidos/runtime.json', 'utf8'));
  if (expected.stageOnly !== false || expected.executable !== PILOT_NODE.executable || process.execPath !== PILOT_NODE.executable || expected.nodeVersion !== PILOT_NODE.version || expected.nodeVersion !== process.version || expected.nodeSha256 !== hash(await readFile(process.execPath)) || process.platform !== 'linux' || process.arch !== 'arm64') throw new Error('The pinned Node runtime changed or this is a staging tree. Revalidate and explicitly reinstall the pilot before starting it.');
} catch (error) { console.error(`kidOS runtime check: ${error.message}`); process.exitCode = 1; }
