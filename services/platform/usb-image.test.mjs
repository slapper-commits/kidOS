import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoConfig, buildScript, IMAGE_PACKAGES, LIVE_ARGS, parseOptions, prepare } from '../../os/live-usb/prepare.mjs';
import { sessionCommands } from '../../os/live-usb/session.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'kidos-usb-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('live image defaults to volatile trial and retains mature offline installation/firmware paths', () => {
  for (const arg of ['boot=live', 'live-media=removable-usb', 'nopersistence', 'noresume', 'systemd.gpt_auto=0', 'rd.systemd.gpt_auto=0', 'systemd.swap=0']) assert.ok(LIVE_ARGS.split(' ').includes(arg));
  assert.equal(LIVE_ARGS.split(' ').includes('swap=true'), false);
  const config = autoConfig();
  for (const expected of ['--debian-installer live', '--source true', '--source-images tar', '--uefi-secure-boot enable', '--binary-image iso-hybrid', '--bootloaders "syslinux grub-efi"']) assert.ok(config.includes(expected));
  assert.ok(IMAGE_PACKAGES.includes('calamares-settings-debian=13.0.13-1'));
  assert.ok(IMAGE_PACKAGES.includes('kde-plasma-desktop'));
  assert.equal(IMAGE_PACKAGES.includes('task-kde-desktop'), false);
  for (const name of ['chromium', 'kolourpaint', 'libreoffice-writer', 'firmware-brcm80211', 'polkitd', 'pkexec', 'xz-utils']) assert.ok(IMAGE_PACKAGES.includes(name));
  assert.equal(IMAGE_PACKAGES.includes('policykit-1'), false);
  assert.equal(IMAGE_PACKAGES.some(name => /ssh|password/.test(name)), false);
  execFileSync('/bin/sh', ['-n'], { input: config });
  execFileSync('/bin/sh', ['-n'], { input: buildScript() });
  execFileSync('/bin/sh', ['-n', join(root, 'os/live-usb/build-hook.sh')]);
});

test('recipe preparation validates runtime before output and contains only identity-free source inputs', async t => {
  const dir = await temporary(t), archive = join(dir, 'node-fixture.tar.xz'), bytes = Buffer.from('isolated runtime fixture');
  await writeFile(archive, bytes);
  const directory = join(dir, 'recipe');
  await assert.rejects(prepare({ version: '0.0.1-pilot.19', nodeArchive: archive, directory }), /SHA-256/);
  await assert.rejects(readdir(directory), { code: 'ENOENT' });
  const expectedNodeSha256 = createHash('sha256').update(bytes).digest('hex');
  const result = await prepare({ version: '0.0.1-pilot.19', nodeArchive: archive, directory }, { expectedNodeSha256 });
  assert.equal(result.imageBuilt, false); assert.equal(result.driveWritten, false);
  const manifest = JSON.parse(await readFile(join(directory, 'BUILD.json')));
  assert.equal(manifest.isoVerified, false);
  assert.deepEqual(manifest.buildHelpers.map(row => row.path), ['config/build-helpers/boot-policy.py', 'config/build-helpers/build-boot-policy.py']);
  for (const row of manifest.buildHelpers) {
    const helper = await readFile(join(directory, row.path));
    assert.equal(helper.length, row.size);
    assert.equal(createHash('sha256').update(helper).digest('hex'), row.sha256);
    assert.equal(row.mode, 0o644);
  }
  const binaryHook = await readFile(join(directory, 'config/hooks/live/0950-kidos-boot-policy.hook.binary'), 'utf8');
  execFileSync('/bin/sh', ['-n'], { input: binaryHook });
  assert.ok(binaryHook.includes('exec /usr/bin/python3 -I ../config/build-helpers/build-boot-policy.py'));
  const includes = join(directory, 'config/includes.chroot');
  await assert.rejects(readFile(join(includes, 'opt/kidos-usb/boot-policy.py')), { code: 'ENOENT' });
  await assert.rejects(readdir(join(includes, 'home')), { code: 'ENOENT' });
  await assert.rejects(readdir(join(includes, 'var/lib/kidos')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(includes, 'opt/kidos-native-session/install.json')), { code: 'ENOENT' });
  assert.ok((await readdir(join(includes, 'opt/kidos-usb/source'))).includes('RELEASE.json'));
  assert.equal((await readFile(join(directory, 'config/hooks/live/0900-kidos.hook.chroot'))).includes(Buffer.from('firstboot.service')), true);
  await assert.rejects(prepare({ version: '0.0.1-pilot.19', nodeArchive: archive, directory }, { expectedNodeSha256 }), /empty ordinary/);
  for (const args of [[], ['--version', '0.0.1-pilot.19', '--output-dir', '/dev/disk0'], ['--flash', '/dev/disk0']]) assert.throws(() => parseOptions(args));
});

test('generated auto/config executes lb with real argument boundaries and optional private transport', async t => {
  const dir = await temporary(t), bin = join(dir, 'bin'), capture = join(dir, 'args');
  await mkdir(bin);
  await writeFile(join(bin, 'lb'), '#!/bin/sh\nprintf "%s\\0" "$@" > "$KIDOS_LB_CAPTURE"\n', { mode: 0o755 });
  const config = join(dir, 'config.sh');
  await writeFile(config, autoConfig());
  execFileSync('/bin/sh', [config, '--apt-http-proxy', 'http://127.0.0.1:3128'], { env: { PATH: `${bin}:/usr/bin:/bin`, KIDOS_LB_CAPTURE: capture } });
  const args = (await readFile(capture, 'utf8')).split('\0').slice(0, -1);
  assert.deepEqual(args.slice(0, 3), ['config', 'noauto', '--ignore-system-defaults']);
  assert.equal(args[args.indexOf('--bootappend-live') + 1], LIVE_ARGS);
  for (const flag of ['--mirror-chroot-security', '--mirror-binary-security', '--parent-mirror-chroot-security', '--parent-mirror-binary-security']) assert.equal(args[args.indexOf(flag) + 1], 'http://deb.debian.org/debian-security');
  assert.equal(args[args.indexOf('--security') + 1], 'true');
  for (const flag of ['--archive-areas', '--parent-archive-areas']) assert.equal(args[args.indexOf(flag) + 1], 'main non-free non-free-firmware');
  for (const flag of ['--firmware-chroot', '--firmware-binary']) assert.equal(args[args.indexOf(flag) + 1], 'true');
  assert.deepEqual(args.slice(-2), ['--apt-http-proxy', 'http://127.0.0.1:3128']);
});

test('actual image UDisks rule denies unknown/internal drives while preserving root installer and removable saves', async () => {
  const hook = await readFile(join(root, 'os/live-usb/build-hook.sh'), 'utf8');
  const policy = /<<'POLICY'\n([\s\S]*?)\nPOLICY/.exec(hook)?.[1];
  assert.ok(policy);
  let rule;
  runInNewContext(policy, { polkit: { addRule: value => { rule = value; }, Result: { NO: 'denied' } } });
  const action = removable => ({ id: 'org.freedesktop.udisks2.filesystem-mount-system', lookup: key => key === 'drive.removable' ? removable : undefined });
  assert.equal(rule(action('false'), { user: 'kidos-live' }), 'denied');
  assert.equal(rule(action(undefined), { user: 'kidos-live' }), 'denied');
  assert.equal(rule(action('true'), { user: 'kidos-live' }), undefined);
  assert.equal(rule(action('false'), { user: 'root' }), undefined);
  assert.equal(rule(action('false'), { user: 'parent' }), undefined);
});

test('USB launch keeps native setup outside browser authority and accepts no arbitrary arguments', () => {
  const caller = { platform: 'linux', arch: 'x64', uid: 1000, args: [] };
  const commands = sessionCommands(caller);
  assert.deepEqual(commands[0].args, ['/opt/kidos-native-session/native-launch.mjs', '--setup-user']);
  assert.deepEqual(commands[1].args, ['-I', '/opt/kidos-usb/welcome.py', '--startup']);
  for (const change of [{ uid: 0 }, { platform: 'darwin' }, { arch: 'arm64' }, { args: ['/bin/sh'] }]) assert.throws(() => sessionCommands({ ...caller, ...change }));
});

test('native Try/install chooser never supplies a drive, force option or shell command', () => {
  const path = join(root, 'os/live-usb/welcome.py');
  const script = `import runpy\nm=runpy.run_path(${JSON.stringify(path)})\nassert not m['live_trial']('boot=live', False)\nassert not m['live_trial']('', True)\nassert m['live_trial']('quiet boot=live nopersistence', True)\nassert m['launch_command']('try', True) == ['/opt/kidos-node/v24.21.0/bin/node','/opt/kidos/current/os/linux-pc/kiosk.mjs','--launch']\nassert m['launch_command']('install', True) == ['/usr/bin/calamares-install-debian']\nfor action,live in [('install',False),('/bin/sh',True)]:\n try: m['launch_command'](action,live); raise AssertionError('accepted')\n except ValueError: pass\n`;
  execFileSync('python3', ['-I', '-c', script]);
});
