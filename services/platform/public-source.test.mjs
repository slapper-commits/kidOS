import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPublicBytes, checkPublicPath, checkPublicSource } from '../../scripts/check-public-source.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('public-source guard rejects sensitive paths and credentials without disclosing their values', () => {
  for (const path of ['work/family.json', '.data/state.json', '.ssh/id_ed25519', '.env', 'a/../README.md', 'vm.qcow2', 'secret.pem']) {
    assert.throws(() => checkPublicPath(path), /unsafe/);
  }
  assert.equal(checkPublicPath('.github/workflows/ci.yml'), '.github/workflows/ci.yml');
  const token = ['ghp_', 'x'.repeat(36)].join('');
  assert.throws(() => checkPublicBytes('sample.txt', Buffer.from(token)), error => {
    assert.match(error.message, /Possible credential/); assert.equal(error.message.includes(token), false); return true;
  });
  assert.throws(() => checkPublicBytes('sample.txt', Buffer.from(['-----BEGIN ', 'OPENSSH PRIVATE KEY-----'].join(''))), /Possible credential/);
  checkPublicBytes('sample.txt', Buffer.from('Obtain a per-process token at runtime.'));
});

test('public-source guard detects unreviewed files, tracked ignored data, links and missing runtime notices', async t => {
  const fixture = await mkdtemp(join(tmpdir(), 'kidos-public-source-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const files = JSON.parse(await readFile(join(root, 'scripts/public-source-files.json')));
  for (const path of files) await cp(join(root, path), join(fixture, path), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: fixture });
  assert.equal((await checkPublicSource(fixture)).files, files.length);
  await writeFile(join(fixture, 'unreviewed.txt'), 'Accidental family content');
  await assert.rejects(checkPublicSource(fixture), /Unreviewed: unreviewed.txt/);
  await rm(join(fixture, 'unreviewed.txt'));
  await writeFile(join(fixture, '.env'), 'SYNTHETIC=fixture');
  execFileSync('git', ['add', '-f', '.env'], { cwd: fixture });
  await assert.rejects(checkPublicSource(fixture), /Unreviewed: .env/);
  execFileSync('git', ['rm', '--cached', '-q', '.env'], { cwd: fixture });
  await rm(join(fixture, 'README.md'));
  await symlink('LICENSE', join(fixture, 'README.md'));
  await assert.rejects(checkPublicSource(fixture), /Unsafe public-source file/);
  await rm(join(fixture, 'README.md')); await cp(join(root, 'README.md'), join(fixture, 'README.md'));
  const runtimePath = join(fixture, 'os/raspberry-pi/source-files.json');
  const runtime = JSON.parse(await readFile(runtimePath));
  await writeFile(runtimePath, JSON.stringify(runtime.filter(path => path !== 'LICENSE')));
  await assert.rejects(checkPublicSource(fixture), /Required portable release notice missing: LICENSE/);
});
