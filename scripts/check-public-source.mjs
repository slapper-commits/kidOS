import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const notices = [
  'LICENSE', 'SECURITY.md', 'docs/PROVENANCE.md',
  'apps/desktop/library-vendor/pdfjs/LICENSE',
  'apps/desktop/library-vendor/pdfjs/cmaps/LICENSE',
  'apps/desktop/library-vendor/pdfjs/standard_fonts/LICENSE_FOXIT',
  'apps/desktop/library-vendor/pdfjs/standard_fonts/LICENSE_LIBERATION',
  'apps/desktop/library-vendor/zipjs/LICENSE',
];

export function checkPublicPath(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
      path.split('/').some(part => ['.', '..', '.git', '.data', '.ssh', '.aws', 'work', 'node_modules'].includes(part)) ||
      /(?:^|\/)(?:\.env(?:\..*)?|id_(?:rsa|ed25519)|known_hosts|state(?:\.backup)?\.json)$/.test(path) ||
      /\.(?:pem|key|p12|pfx|img|qcow2|iso|tar|tgz|zip|log)$/i.test(path)) {
    throw new Error(`Private or unsafe public-source path: ${path}`);
  }
  return path;
}

export function checkPublicBytes(path, bytes) {
  const text = bytes.toString('utf8');
  const patterns = [
    /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/,
  ];
  if (patterns.some(pattern => pattern.test(text))) throw new Error(`Possible credential in ${path}; inspect locally (value withheld).`);
}

export async function checkPublicSource(directory = root) {
  directory = await realpath(directory);
  const files = JSON.parse(await readFile(resolve(directory, 'scripts/public-source-files.json'), 'utf8'));
  if (!Array.isArray(files) || files.length < 10 || new Set(files).size !== files.length) throw new Error('Invalid public-source allowlist.');
  files.forEach(checkPublicPath);
  const candidates = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: directory, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
  const expected = [...files].sort();
  const unexpected = candidates.filter(path => !files.includes(path));
  const missing = expected.filter(path => !candidates.includes(path));
  if (unexpected.length || missing.length) throw new Error(`Public-source allowlist mismatch. Unreviewed: ${unexpected.join(', ') || 'none'}. Missing: ${missing.join(', ') || 'none'}.`);
  for (const path of expected) {
    const absolute = resolve(directory, path), info = await lstat(absolute);
    if (!info.isFile() || info.nlink !== 1 || await realpath(absolute) !== absolute || info.size > 4 * 1024 * 1024) throw new Error(`Unsafe public-source file: ${path}`);
    checkPublicBytes(path, await readFile(absolute));
  }
  const runtime = JSON.parse(await readFile(resolve(directory, 'os/raspberry-pi/source-files.json'), 'utf8'));
  for (const path of [...runtime, ...notices]) if (!files.includes(path)) throw new Error(`Required public source/notice missing: ${path}`);
  for (const path of notices) if (!runtime.includes(path)) throw new Error(`Required portable release notice missing: ${path}`);
  return { files: files.length, runtimeFiles: runtime.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkPublicSource().then(result => console.log(`Public-source check passed: ${result.files} reviewed files; ${result.runtimeFiles} portable release files.`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
