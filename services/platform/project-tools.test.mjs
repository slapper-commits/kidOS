import test from 'node:test';
import assert from 'node:assert/strict';
import { changeSourceFile, projectChanged, parseProjectImport, filterAndSort, validateSourceFiles } from '../../apps/desktop/project-tools.mjs';
const files = () => ({ 'index.html': '<p>mine</p>', 'style.css': 'p {color:red}', 'pages/story.txt': 'Hello 👋' });
const exported = () => ({ schemaVersion: 1, project: { id: 'project-8f9c9fb8-5412-45ec-97d0-1ee236ed7d6a', name: 'My project', revision: 3, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T01:00:00.000Z', files: files() } });

test('source operations preserve originals and recycle/restore exact text without overwriting', () => {
  const original = files();
  const added = changeSourceFile(original, 'new', null, 'scripts/new.js');
  assert.equal(added.files['scripts/new.js'], '');
  assert.deepEqual(original, files());
  const renamed = changeSourceFile(added.files, 'rename', 'pages/story.txt', 'pages/hello.txt');
  assert.equal(renamed.files['pages/hello.txt'], 'Hello 👋');
  assert.equal(Object.hasOwn(renamed.files, 'pages/story.txt'), false);
  const binned = changeSourceFile(renamed.files, 'remove', 'pages/hello.txt');
  assert.equal(binned.file, 'recycle-bin/pages/hello.txt');
  assert.equal(binned.files[binned.file], 'Hello 👋');
  const restored = changeSourceFile(binned.files, 'restore', binned.file);
  assert.deepEqual(restored.files, renamed.files);
  assert.throws(() => changeSourceFile({ ...binned.files, 'pages/hello.txt': 'newer work' }, 'restore', binned.file), /already uses/);
  assert.equal(binned.files[binned.file], 'Hello 👋');
});

test('source operations reject traversal, collisions, invalid text, reserved bin and entry point moves', () => {
  for (const name of ['../outside.txt', '/tmp/file', 'a//b', '%2e%2e/a', 'a\\b', 'recycle-bin/new.js', '__proto__']) assert.throws(() => changeSourceFile(files(), 'new', null, name));
  assert.throws(() => changeSourceFile(files(), 'new', null, 'style.css'), /already exists/);
  assert.throws(() => changeSourceFile(files(), 'rename', 'style.css', 'index.html'));
  assert.throws(() => changeSourceFile(files(), 'remove', 'index.html'), /Keep index/);
  assert.throws(() => changeSourceFile(files(), 'rename', 'index.html', 'home.html'), /Keep index/);
  assert.throws(() => validateSourceFiles({ 'index.html': '\ud800' }), /valid text/);
  assert.throws(() => validateSourceFiles({ 'index.html': 'x'.repeat(1024 * 1024) }), /1 MiB/);
  const many = { 'index.html': '' }; for (let i = 0; i < 31; i++) many[`file${i}.txt`] = '';
  assert.throws(() => changeSourceFile(many, 'new', null, 'extra.txt'), /1–32/);
  assert.equal(Object.keys(changeSourceFile(many, 'remove', 'file0.txt').files).length, 32);
  const deep = { 'index.html': '', 'a/b/c/d/e/f/g/h.txt': 'safe' };
  assert.throws(() => changeSourceFile(deep, 'remove', 'a/b/c/d/e/f/g/h.txt'));
  assert.equal(deep['a/b/c/d/e/f/g/h.txt'], 'safe');
});

test('dirty comparison notices removal as well as edits, names and new files', () => {
  const editor = { name: 'Story', files: files(), saved: { name: 'Story', files: files() } };
  assert.equal(projectChanged(editor), false);
  delete editor.files['style.css']; assert.equal(projectChanged(editor), true);
  editor.files = files(); editor.name = 'New name'; assert.equal(projectChanged(editor), true);
  editor.name = 'Story'; editor.files['script.js'] = ''; assert.equal(projectChanged(editor), true);
});

test('import parser accepts actual export and recovery formats without executing source', () => {
  const normal = exported(); normal.project.files['script.js'] = 'throw new Error("not executed")';
  const result = parseProjectImport(JSON.stringify(normal));
  assert.equal(result.name, 'My project'); assert.equal(result.fileCount, 4); assert.deepEqual(result.envelope, normal);
  const draft = { format: 'kidos-recovery-draft', version: 1, projectId: normal.project.id, baseRevision: 3, name: 'Recovered', files: files() };
  assert.deepEqual(parseProjectImport(JSON.stringify(draft)).envelope, draft);
  for (const data of [{ ...normal, extra: true }, { ...normal, schemaVersion: 2 }, { project: normal.project }, { ...draft, version: 2 }, { ...draft, name: ' bad ' }, { ...draft, files: { '../bad': '', 'index.html': '' } }]) assert.throws(() => parseProjectImport(JSON.stringify(data)));
  assert.throws(() => parseProjectImport('<script>bad()</script>'), /not valid JSON/);
  assert.throws(() => parseProjectImport(' '.repeat(2 * 1024 * 1024 + 1)), /smaller than/);
});

test('search and sort are case-insensitive and do not mutate catalogs', () => {
  const catalog = [{ name: 'Zebra', updatedAt: '2026-10-08' }, { name: 'apple', updatedAt: '2026-10-01' }, { name: 'Apricot', updatedAt: '2026-10-03' }];
  assert.deepEqual(filterAndSort(catalog, ' AP ').map(item => item.name), ['apple', 'Apricot']);
  assert.deepEqual(filterAndSort(catalog, '', 'recent').map(item => item.name), ['Zebra', 'Apricot', 'apple']);
  assert.equal(catalog[0].name, 'Zebra');
});
