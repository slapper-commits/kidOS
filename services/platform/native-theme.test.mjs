import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THEME_FILES, themePaths, prepareNativeTheme } from '../../os/native-session/theme.mjs';

const uid = process.getuid();
const options = { readAsset: async path => Buffer.from(`source:${path}`) };
async function temporary(t) {
  const path = await mkdtemp(join(tmpdir(), 'kidos-native-theme-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
test('native theme catalog is fixed and preview is confined to the disposable VM', () => {
  assert.equal(new Set(THEME_FILES).size, THEME_FILES.length);
  assert.ok(THEME_FILES.every(path => path.startsWith('theme/') && !path.includes('..')));
  assert.ok(THEME_FILES.includes('theme/paint.qss'));
  assert.ok(THEME_FILES.includes('theme/writer/registrymodifications.xcu'));
  assert.equal(themePaths('/home/casey').writer, '/home/casey/.local/share/kidos-native/config/libreoffice/4');
  assert.equal(themePaths('/home/kidos-test', 'disposable-linux-vm', { writerPreview: true }).writer, '/home/kidos-test/.local/share/kidos-native-files/config/writer-theme-preview/4');
  for (const home of ['/', '../home', '/home/../root', '/home/test\0', '/home/test/']) assert.throws(() => themePaths(home));
  for (const target of ['other', null]) assert.throws(() => themePaths('/home/test', target));
  assert.throws(() => themePaths('/home/test', 'raspberry-pi', { writerPreview: true }));
  assert.throws(() => themePaths('/home/test', 'disposable-linux-vm', { writerPreview: '/tmp' }));
});
test('fresh theme setup publishes a complete Writer seed and is idempotent without overwriting preferences or creations', async t => {
  const home = await temporary(t), paths = themePaths(home);
  const first = await prepareNativeTheme(home, uid, options);
  assert.equal(first.created.length, 4); assert.equal(first.writerSeeded, true);
  for (const source of THEME_FILES.filter(path => path.startsWith('theme/writer/'))) {
    const target = `${paths.writerUser}/${source.slice('theme/writer/'.length)}`;
    assert.equal(await readFile(target, 'utf8'), `source:${source}`);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
  }
  await writeFile(paths.palette, 'custom palette');
  await writeFile(paths.calculator, 'custom calculator history and constants');
  await writeFile(paths.labwc, 'custom titlebars');
  await writeFile(`${paths.writerUser}/registrymodifications.xcu`, 'custom registry and recovery markers');
  await mkdir(`${paths.writerUser}/backup`); await writeFile(`${paths.writerUser}/backup/story.odt`, 'recovery');
  await mkdir(`${home}/Documents`); await writeFile(`${home}/Documents/story.odt`, 'creation');
  const again = await prepareNativeTheme(home, uid, { readAsset: async () => assert.fail('existing preferences must not need seed reads') });
  assert.equal(again.created.length, 0); assert.equal(again.writerStatus, 'existing-profile');
  assert.equal(await readFile(paths.palette, 'utf8'), 'custom palette');
  assert.equal(await readFile(paths.calculator, 'utf8'), 'custom calculator history and constants');
  assert.equal(await readFile(paths.labwc, 'utf8'), 'custom titlebars');
  assert.equal(await readFile(`${paths.writerUser}/registrymodifications.xcu`, 'utf8'), 'custom registry and recovery markers');
  assert.equal(await readFile(`${paths.writerUser}/backup/story.odt`, 'utf8'), 'recovery');
  assert.equal(await readFile(`${home}/Documents/story.odt`, 'utf8'), 'creation');
});
test('an existing or locked Writer profile gets no partial toolbar or registry customization', async t => {
  for (const locked of [false, true]) {
    const home = await temporary(t), paths = themePaths(home);
    await mkdir(paths.writer, { recursive: true, mode: 0o700 });
    if (locked) await writeFile(`${paths.writer}/.lock`, 'active', { mode: 0o600 });
    else { await mkdir(paths.writerUser, { mode: 0o700 }); await writeFile(`${paths.writerUser}/custom`, 'preserve', { mode: 0o600 }); }
    const result = await prepareNativeTheme(home, uid, options);
    assert.equal(result.writerStatus, locked ? 'locked' : 'existing-profile');
    if (locked) await assert.rejects(stat(paths.writerUser), { code: 'ENOENT' });
    else assert.deepEqual(await readdir(paths.writerUser), ['custom']);
  }
});
test('theme setup refuses linked/writable preference paths and never writes outside the selected home', async t => {
  const home = await temporary(t), outside = await temporary(t), paths = themePaths(home);
  await mkdir(paths.config, { recursive: true, mode: 0o700 });
  await symlink(outside, `${paths.config}/libreoffice`);
  await assert.rejects(prepareNativeTheme(home, uid, options), /unsafe/);
  assert.deepEqual(await readdir(outside), []);
  await rm(`${paths.config}/libreoffice`);
  await symlink(`${outside}/palette`, paths.palette);
  await assert.rejects(prepareNativeTheme(home, uid, options), /unsafe/);
  assert.deepEqual(await readdir(outside), []);
  await rm(paths.palette); await chmod(paths.config, 0o777);
  await assert.rejects(prepareNativeTheme(home, uid, options), /unsafe/);
});
test('interrupted writes never publish incomplete preferences or Writer profiles and setup can retry', async t => {
  for (const failureAt of [1, 2, 3, 5]) {
    const home = await temporary(t), paths = themePaths(home);
    let writes = 0;
    await assert.rejects(prepareNativeTheme(home, uid, { ...options, writeContents: async (file, bytes) => {
      if (++writes === failureAt) { await file.writeFile(bytes.subarray(0, 3)); throw new Error('interrupted'); }
      await file.writeFile(bytes);
    } }), /interrupted/);
    await assert.rejects(stat(paths.writerUser), { code: 'ENOENT' });
    if (failureAt <= 3) await assert.rejects(stat([paths.palette, paths.calculator, paths.labwc][failureAt - 1]), { code: 'ENOENT' });
    assert.equal((await readdir(paths.config)).some(name => name.includes('.theme-')), false);
    assert.equal((await readdir(`${home}/.config/labwc`)).some(name => name.includes('.theme-')), false);
    assert.equal((await readdir(paths.writer)).some(name => name.startsWith('.kidos-theme-')), false);
    assert.equal((await prepareNativeTheme(home, uid, options)).writerSeeded, true);
  }
});
test('the published theme catalog names real bounded assets and seeds their exact bytes', async t => {
  const readAsset = path => readFile(new URL(`../../os/native-session/${path}`, import.meta.url));
  for (const path of THEME_FILES) { const bytes = await readAsset(path); assert.ok(bytes.length > 0 && bytes.length <= 256 * 1024, path); }
  const home = await temporary(t), paths = themePaths(home);
  await prepareNativeTheme(home, uid, { readAsset });
  assert.deepEqual(await readFile(paths.palette), await readAsset('theme/paint-kdeglobals'));
  assert.deepEqual(await readFile(paths.calculator), await readAsset('theme/calculator-kcalcrc'));
  assert.deepEqual(await readFile(paths.labwc), await readAsset('theme/labwc.themerc'));
  for (const path of THEME_FILES.filter(path => path.startsWith('theme/writer/'))) assert.deepEqual(await readFile(`${paths.writerUser}/${path.slice('theme/writer/'.length)}`), await readAsset(path));
});
test('concurrent preferences win without replacement while source failures publish no preferences', async t => {
  const home = await temporary(t), paths = themePaths(home); let writerRace = true;
  const result = await prepareNativeTheme(home, uid, { ...options, writeContents: async (file, bytes) => {
    await file.writeFile(bytes);
    const target = { 'source:theme/paint-kdeglobals': paths.palette, 'source:theme/calculator-kcalcrc': paths.calculator, 'source:theme/labwc.themerc': paths.labwc }[bytes.toString()];
    if (target) await writeFile(target, 'concurrent preference', { flag: 'wx', mode: 0o600 });
    else if (writerRace) { writerRace = false; await mkdir(paths.writerUser, { mode: 0o700 }); await writeFile(`${paths.writerUser}/registrymodifications.xcu`, 'concurrent Writer registry', { mode: 0o600 }); }
  } });
  assert.equal(result.created.length, 0);
  for (const path of [paths.palette, paths.calculator, paths.labwc]) assert.equal(await readFile(path, 'utf8'), 'concurrent preference');
  assert.deepEqual(await readdir(paths.writerUser), ['registrymodifications.xcu']);
  const fresh = await temporary(t), freshPaths = themePaths(fresh);
  await assert.rejects(prepareNativeTheme(fresh, uid, { readAsset: async path => path.endsWith('.png') ? Buffer.alloc(256 * 1024 + 1) : 'seed' }), /bounded/);
  for (const path of [freshPaths.palette, freshPaths.calculator, freshPaths.labwc]) await assert.rejects(stat(path), { code: 'ENOENT' });
  await assert.rejects(stat(freshPaths.writerUser), { code: 'ENOENT' });
});

test('labwc seeds the same bytes on Pi and VM, preserves ordinary config, and requires safe parents', async t => {
  for (const targetKind of ['raspberry-pi', 'disposable-linux-vm']) {
    const home = await temporary(t), paths = themePaths(home, targetKind);
    await mkdir(`${home}/.config/labwc`, { recursive: true, mode: 0o755 });
    await writeFile(`${home}/.config/labwc/rc.xml`, 'existing compositor settings');
    await prepareNativeTheme(home, uid, { ...options, targetKind });
    assert.equal(await readFile(paths.labwc, 'utf8'), 'source:theme/labwc.themerc');
    assert.equal((await stat(paths.labwc)).mode & 0o777, 0o600);
    assert.equal(await readFile(`${home}/.config/labwc/rc.xml`, 'utf8'), 'existing compositor settings');
  }
  for (const unsafe of ['.config', '.config/labwc', '.config/labwc/themerc-override', '.local/share/kidos-native/config/kcalcrc']) {
    const home = await temporary(t), outside = await temporary(t), paths = themePaths(home);
    const parent = unsafe.includes('/') ? unsafe.slice(0, unsafe.lastIndexOf('/')) : '';
    if (parent) await mkdir(`${home}/${parent}`, { recursive: true, mode: 0o700 });
    await symlink(outside, `${home}/${unsafe}`);
    await assert.rejects(prepareNativeTheme(home, uid, options), /unsafe/);
    assert.deepEqual(await readdir(outside), []);
    await assert.rejects(stat(paths.palette), { code: 'ENOENT' });
  }
  const home = await temporary(t), paths = themePaths(home);
  await mkdir(`${home}/.config/labwc`, { recursive: true, mode: 0o700 });
  await chmod(`${home}/.config/labwc`, 0o777);
  await assert.rejects(prepareNativeTheme(home, uid, options), /unsafe/);
  await assert.rejects(stat(paths.labwc), { code: 'ENOENT' });
});
test('VM Writer preview uses a separate fixed profile and preserves the original profile byte for byte', async t => {
  const home = await temporary(t), original = themePaths(home, 'disposable-linux-vm');
  await mkdir(original.writerUser, { recursive: true, mode: 0o700 });
  await writeFile(`${original.writerUser}/registrymodifications.xcu`, 'original preferences and recovery');
  const result = await prepareNativeTheme(home, uid, { ...options, targetKind: 'disposable-linux-vm', writerPreview: true });
  assert.equal(result.writerSeeded, true); assert.notEqual(result.writerProfile, original.writer);
  assert.equal(await readFile(`${original.writerUser}/registrymodifications.xcu`, 'utf8'), 'original preferences and recovery');
});
