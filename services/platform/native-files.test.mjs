import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readdir, readFile, writeFile, symlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { launchCommand, launchEnvironment, prepareUserFiles } from '../../os/linux-test/native-files.mjs';

const execute = promisify(execFile);
const helperUrl = new URL('../../os/linux-test/native-files.mjs', import.meta.url).href;

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'kidos-native-files-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

test('native launcher accepts only fixed app and folder choices', () => {
  assert.deepEqual(launchCommand('paint'), { executable: '/usr/bin/kolourpaint', args: ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/paint.qss'], cwd: '/home/kidos-test/Pictures' });
  assert.deepEqual(launchCommand('writer'), {
    executable: '/usr/lib/libreoffice/program/soffice',
    args: ['-env:UserInstallation=file:///home/kidos-test/.local/share/kidos-native-files/config/libreoffice/4', '--writer'],
    cwd: '/home/kidos-test/Documents',
  });
  assert.deepEqual(launchCommand('calculator'), { executable: '/usr/bin/kcalc', args: ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/calculator.qss', '-qwindowtitle', 'Calculator'], cwd: '/home/kidos-test/Documents' });
  assert.deepEqual(launchCommand('solitaire'), { executable: '/usr/games/kpat', args: ['-style', 'Fusion', '-qwindowtitle', 'Solitaire'], cwd: '/home/kidos-test/.local/share/kidos-native-files' });
  assert.deepEqual(launchCommand('minesweeper'), { executable: '/usr/games/kmines', args: ['-style', 'Fusion', '-qwindowtitle', 'Minesweeper'], cwd: '/home/kidos-test/.local/share/kidos-native-files' });
  assert.deepEqual(launchCommand('pinball'), { executable: '/usr/games/pinball', args: [], cwd: '/home/kidos-test/.local/share/kidos-native-files' });
  assert.deepEqual(launchCommand('puzzlebox'), { executable: '/usr/bin/python3.13', args: ['-I', '/opt/kidos-native-session/puzzlebox.py'], cwd: '/home/kidos-test/Documents' });
  const filesStyle = ['-style', 'Fusion', '-stylesheet', '/opt/kidos-native-session/theme/files.qss', '--profile=kidos-files'];
  assert.deepEqual(launchCommand('files').args, [...filesStyle, '/home/kidos-test/Pictures']);
  assert.deepEqual(launchCommand('documents').args, [...filesStyle, '/home/kidos-test/Documents']);
  assert.deepEqual(launchCommand('downloads').args, [...filesStyle, '/home/kidos-test/Downloads']);
  assert.deepEqual(launchCommand('trash').args, [...filesStyle, 'trash:///']);
  for (const action of ['../../bin/sh', 'paint /tmp/input', 'writer --headless', 'calculator;sh', 'documents/../../etc', 'solitaire /tmp/game', 'pinball --exec', 'minesweeper;sh', 'file:///tmp/example.odt', 'sh', '--desktop', '', null]) assert.throws(() => launchCommand(action));
});

test('classic games keep private native settings, force the approved display backends and remove injection hooks', () => {
  const inherited = { WAYLAND_DISPLAY: 'wayland-1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', QT_QPA_PLATFORM: 'evil', SDL_VIDEODRIVER: 'evil', XDG_CONFIG_HOME: '/tmp/other', NODE_OPTIONS: '--inspect', NODE_PATH: '/tmp/modules', LD_PRELOAD: '/tmp/preload', LD_LIBRARY_PATH: '/tmp/libs' };
  for (const id of ['solitaire', 'minesweeper', 'pinball', 'puzzlebox']) {
    const env = launchEnvironment(id, inherited);
    assert.equal(env.XDG_CONFIG_HOME, '/home/kidos-test/.local/share/kidos-native-files/config');
    assert.equal(env.QT_QPA_PLATFORM, 'wayland');
    assert.equal(env.WAYLAND_DISPLAY, 'wayland-1');
    for (const hook of ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH']) assert.equal(env[hook], undefined);
  }
  assert.equal(launchEnvironment('pinball', inherited).SDL_VIDEODRIVER, 'wayland');
  const puzzle = launchEnvironment('puzzlebox', { ...inherited, PYTHONPATH: '/tmp/modules', PYTHONHOME: '/tmp/home', GTK_MODULES: 'evil', GTK_PATH: '/tmp/gtk', GIO_EXTRA_MODULES: '/tmp/gio', GDK_BACKEND: 'x11' });
  assert.equal(puzzle.GDK_BACKEND, 'wayland');
  for (const hook of ['PYTHONPATH', 'PYTHONHOME', 'GTK_MODULES', 'GTK_PATH', 'GIO_EXTRA_MODULES']) assert.equal(puzzle[hook], undefined);
  assert.equal(inherited.SDL_VIDEODRIVER, 'evil');
  assert.throws(() => launchEnvironment('pinball;sh', inherited));
});

test('native setup preserves creations and changed app preferences on rerun', async t => {
  const home = await fixture(t), uid = process.getuid();
  assert.equal((await prepareUserFiles(home, uid)).created.length, 3);
  const config = join(home, '.local/share/kidos-native-files/config/pcmanfm-qt/kidos-files/settings.conf');
  await writeFile(config, 'User changed preferences\n');
  await writeFile(join(home, 'Pictures/keep.png'), 'existing drawing');
  await writeFile(join(home, 'Documents/keep.odt'), 'existing document');
  const writerProfile = join(home, '.local/share/kidos-native-files/config/libreoffice/4');
  await writeFile(join(writerProfile, 'registrymodifications.xcu'), 'Existing Writer preferences\n');
  const result = await prepareUserFiles(home, uid);
  assert.equal(result.created.length, 0);
  assert.equal(result.preserved.length, 3);
  assert.equal(await readFile(config, 'utf8'), 'User changed preferences\n');
  assert.equal(await readFile(join(home, 'Pictures/keep.png'), 'utf8'), 'existing drawing');
  assert.equal(await readFile(join(home, 'Documents/keep.odt'), 'utf8'), 'existing document');
  assert.equal(await readFile(join(writerProfile, 'registrymodifications.xcu'), 'utf8'), 'Existing Writer preferences\n');
  assert.equal((await stat(join(home, 'Pictures'))).mode & 0o777, 0o700);
  assert.equal((await stat(writerProfile)).mode & 0o777, 0o700);
});

test('native setup refuses a linked or writable Writer profile without replacing its contents', async t => {
  const home = await fixture(t), outside = await fixture(t), uid = process.getuid();
  await prepareUserFiles(home, uid);
  const profile = join(home, '.local/share/kidos-native-files/config/libreoffice/4');
  await writeFile(join(outside, 'keep'), 'outside profile');
  await rm(profile, { recursive: true });
  await symlink(outside, profile);
  await assert.rejects(prepareUserFiles(home, uid), /unsafe user directory/);
  assert.equal(await readFile(join(outside, 'keep'), 'utf8'), 'outside profile');
  await rm(profile);
  await prepareUserFiles(home, uid);
  await chmod(profile, 0o777);
  await assert.rejects(prepareUserFiles(home, uid), /unsafe user directory/);
  assert.equal((await stat(profile)).mode & 0o777, 0o777);
});

test('native setup refuses a linked Writer profile parent before creating a profile outside the private config', async t => {
  const home = await fixture(t), outside = await fixture(t), uid = process.getuid();
  await prepareUserFiles(home, uid);
  const parent = join(home, '.local/share/kidos-native-files/config/libreoffice');
  await rm(parent, { recursive: true });
  await symlink(outside, parent);
  await assert.rejects(prepareUserFiles(home, uid), /unsafe user directory/);
  await assert.rejects(stat(join(outside, '4')), { code: 'ENOENT' });
});

test('native wrapper rejects extra arguments and arbitrary command strings before invoking a runtime', async () => {
  const wrapper = fileURLToPath(new URL('../../os/linux-test/native-files-launch.sh', import.meta.url));
  for (const args of [[], ['writer', '/tmp/story.odt'], ['writer --headless'], ['calculator;sh'], ['documents/../../etc'], ['solitaire', '/tmp/game'], ['pinball --exec'], ['minesweeper;sh'], ['puzzlebox', 'flood'], ['puzzlebox --exec']]) {
    await assert.rejects(execute('/bin/sh', [wrapper, ...args], { timeout: 5000 }), error => error.code === 64);
  }
});

test('native app, classic game and folder launches refuse the development host before reading VM receipts', { skip: process.platform === 'linux' && process.arch === 'arm64' }, async () => {
  for (const action of ['writer', 'calculator', 'documents', 'downloads', 'solitaire', 'minesweeper', 'pinball', 'puzzlebox']) {
    await assert.rejects(execute(process.execPath, [fileURLToPath(helperUrl), '--launch', action], { timeout: 5000 }), error => error.code === 1 && /requires the disposable Linux ARM64 VM/.test(error.stderr) && !/ENOENT/.test(error.stderr));
  }
});

test('native setup refuses linked user folders without touching their target', async t => {
  const home = await fixture(t), outside = await fixture(t);
  await symlink(outside, join(home, 'Pictures'));
  await assert.rejects(prepareUserFiles(home, process.getuid()), /unsafe user directory/);
  await assert.rejects(stat(join(outside, 'config')), { code: 'ENOENT' });
});

test('native setup refuses linked preference files', async t => {
  const home = await fixture(t), uid = process.getuid();
  await prepareUserFiles(home, uid);
  const pref = join(home, '.local/share/kidos-native-files/config/mimeapps.list');
  const target = join(home, 'Documents/keep.txt');
  await writeFile(target, 'keep');
  await rm(pref); await symlink(target, pref);
  await assert.rejects(prepareUserFiles(home, uid), /unsafe preference file/);
  assert.equal(await readFile(target, 'utf8'), 'keep');
});

test('interrupted preference write never publishes partial settings and setup can retry', async t => {
  const home = await fixture(t), uid = process.getuid();
  const script = `
    import { prepareUserFiles } from ${JSON.stringify(helperUrl)};
    await prepareUserFiles(process.argv[1], process.getuid(), {
      writeContents: async file => {
        await file.writeFile('[Volume]\\nMountOnStartup=');
        await file.sync();
        process.kill(process.pid, 'SIGKILL');
        await new Promise(() => {});
      }
    });
  `;
  await assert.rejects(execute(process.execPath, ['--input-type=module', '-e', script, home], { timeout: 5000 }), error => error.signal === 'SIGKILL');
  const directory = join(home, '.local/share/kidos-native-files/config/pcmanfm-qt/kidos-files');
  await assert.rejects(stat(join(directory, 'settings.conf')), { code: 'ENOENT' });
  assert.equal((await readdir(directory)).filter(name => name.startsWith('.settings.conf.kidos-new-')).length, 1);
  assert.equal((await prepareUserFiles(home, uid)).created.length, 3);
  const settings = await readFile(join(directory, 'settings.conf'), 'utf8');
  assert.match(settings, /MountOnStartup=false/);
  assert.match(settings, /UseTrash=true/);
  assert.equal((await stat(join(directory, 'settings.conf'))).nlink, 1);
});

test('preference publication does not replace a file created during setup', async t => {
  const home = await fixture(t), uid = process.getuid();
  const target = join(home, '.local/share/kidos-native-files/config/pcmanfm-qt/kidos-files/settings.conf');
  let first = true;
  const result = await prepareUserFiles(home, uid, {
    writeContents: async (file, text) => {
      await file.writeFile(text);
      if (first) { first = false; await writeFile(target, 'Concurrent user preference\n', { flag: 'wx', mode: 0o600 }); }
    },
  });
  assert.equal(result.preserved.length, 1);
  assert.equal(await readFile(target, 'utf8'), 'Concurrent user preference\n');
});

test('native log validation rejects a FIFO without blocking launch', async t => {
  const home = await fixture(t), path = join(home, 'paint.log');
  await execute('/usr/bin/mkfifo', [path]);
  const script = `
    import assert from 'node:assert/strict';
    import { openApplicationLog } from ${JSON.stringify(helperUrl)};
    await assert.rejects(openApplicationLog(process.argv[1], process.getuid()));
  `;
  // Run in a child so a regression that blocks in open() is killed by timeout.
  await execute(process.execPath, ['--input-type=module', '-e', script, path], { timeout: 5000 });
  assert.equal((await stat(path)).isFIFO(), true);
});
