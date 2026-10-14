import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromiumArguments, configureDesktopAutostart } from '../../os/raspberry-pi/kiosk-core.mjs';
import { packageCommands, NATIVE_PACKAGES } from '../../os/raspberry-pi/native-packages.mjs';
import { PILOT_NODE } from '../../os/raspberry-pi/runtime-pin.mjs';

const command = `${PILOT_NODE.executable} /opt/kidos/current/os/raspberry-pi/kiosk.mjs --launch`;
async function userFixture(t) {
  const homedir = await mkdtemp(join(tmpdir(), 'kidos-pi-desktop-'));
  t.after(() => rm(homedir, { recursive: true, force: true }));
  return { homedir, uid: process.getuid() };
}
test('Pi startup preserves the existing panel configuration and unrelated login applications', async t => {
  const user = await userFixture(t), config = join(user.homedir, '.config');
  await mkdir(join(config, 'labwc'), { recursive: true });
  await mkdir(join(config, 'autostart'));
  await writeFile(join(config, 'labwc/autostart'), 'wf-panel-pi &\npcmanfm --desktop &\n');
  await writeFile(join(config, 'autostart/other.desktop'), '[Desktop Entry]\nName=Keep me\n');
  await configureDesktopAutostart(user, true, command);
  const once = await readFile(join(config, 'autostart/kidos.desktop'), 'utf8');
  await configureDesktopAutostart(user, true, command);
  assert.equal(await readFile(join(config, 'autostart/kidos.desktop'), 'utf8'), once);
  assert.match(once, /^Exec=\/opt\/kidos-node\/.+ --launch$/m);
  assert.equal(await readFile(join(config, 'labwc/autostart'), 'utf8'), 'wf-panel-pi &\npcmanfm --desktop &\n');
  await configureDesktopAutostart(user, false, command);
  await assert.rejects(lstat(join(config, 'autostart/kidos.desktop')), { code: 'ENOENT' });
  assert.equal(await readFile(join(config, 'autostart/other.desktop'), 'utf8'), '[Desktop Entry]\nName=Keep me\n');
});
test('Pi login setup never creates a labwc file that shadows system desktop startup', async t => {
  const user = await userFixture(t);
  await configureDesktopAutostart(user, true, command);
  await assert.rejects(lstat(join(user.homedir, '.config/labwc')), { code: 'ENOENT' });
});
test('Pi login setup refuses linked directories and unrelated entries without changing their bytes', async t => {
  const user = await userFixture(t), config = join(user.homedir, '.config');
  await mkdir(config); await mkdir(join(user.homedir, 'other'));
  await symlink('../other', join(config, 'autostart'));
  await assert.rejects(configureDesktopAutostart(user, true, command), /linked/);
  await rm(join(config, 'autostart')); await mkdir(join(config, 'autostart'));
  const path = join(config, 'autostart/kidos.desktop'), original = '[Desktop Entry]\nExec=my-personal-command\n';
  await writeFile(path, original);
  await assert.rejects(configureDesktopAutostart(user, true, command), /Unexpected|unrelated/);
  await assert.rejects(configureDesktopAutostart(user, false, command), /Unexpected|unrelated/);
  assert.equal(await readFile(path, 'utf8'), original);
});
test('Pi app window keeps desktop switching available while VM kiosk remains unchanged', () => {
  const args = chromiumArguments('/home/kid/profile', true, 'desktop');
  assert.ok(args.includes('--app=http://127.0.0.1:8787/'));
  assert.ok(args.includes('--start-maximized'));
  assert.ok(!args.includes('--kiosk'));
  assert.ok(args.includes('--load-extension=/opt/kidos-native-session/extension'));
  assert.ok(chromiumArguments('/home/kid/profile').includes('--kiosk'));
  assert.throws(() => chromiumArguments('/home/kid/profile', false, 'unrecognized'), /presentation/);
  assert.equal(args.some(value => /no-sandbox|disable-web-security/.test(value)), false);
});
test('native package preparation requires an explicit Pi operation and fixed distribution packages', () => {
  for (const args of [[], ['--install'], ['--install-on-this-pi', '--extra'], ['--install-on-this-pi', 'curl']]) assert.throws(() => packageCommands(args), /explicitly/);
  const commands = packageCommands(['--install-on-this-pi']);
  assert.deepEqual(commands, [['update'], ['install', '--no-remove', ...NATIVE_PACKAGES]]);
  for (const packageName of ['libreoffice-writer', 'libreoffice-qt6', 'kcalc', 'kolourpaint', 'pcmanfm-qt', 'openttd-opengfx', 'openttd-opensfx', 'openttd-openmsx', 'kpat', 'kmines', 'pinball', 'pinball-data', 'sgt-puzzles', 'python3-minimal', 'python3-gi', 'gir1.2-gtk-3.0']) assert.ok(NATIVE_PACKAGES.includes(packageName));
});
test('native package setup refuses this non-Pi host before invoking APT', { skip: process.platform === 'linux' && process.arch === 'arm64' }, () => {
  assert.throws(() => execFileSync(process.execPath, ['os/raspberry-pi/native-packages.mjs', '--install-on-this-pi'], { encoding: 'utf8', stdio: 'pipe' }), error => {
    assert.match(error.stderr, /Live install requires root on Linux ARM64 Raspberry Pi hardware/); return true;
  });
});
