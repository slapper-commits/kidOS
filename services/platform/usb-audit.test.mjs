import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { auditExtractedData, parseListing, parseOptions } from '../../os/live-usb/audit.mjs';
import { patchCalamares } from '../../os/live-usb/calamares.mjs';

const SOURCE = '/opt/kidos-usb/source/';
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const trialArgs = 'boot=live components live-media=removable-usb nopersistence noresume systemd.gpt_auto=0 rd.systemd.gpt_auto=0 systemd.swap=0';
const unit = '[Unit]\nBefore=display-manager.service\n[Service]\nExecStart=/opt/kidos-node/v24.21.0/bin/node /opt/kidos-usb/firstboot.mjs\n';
const runtime = new Map([['calamares.mjs', 'Reviewed fixture helper bytes\n'], ['firstboot.mjs', 'Reviewed fixture firstboot bytes\n'], ['firstboot.service', unit], ['session.mjs', 'Reviewed fixture session bytes\n'], ['welcome.py', 'Reviewed fixture welcome bytes\n']]);
const source = new Map([['LICENSE', Buffer.from('Example source license\n')], ['image.png', Buffer.from([137, 80, 78, 71, 255, 0, 128])], ...[...runtime].map(([path, bytes]) => [`os/live-usb/${path}`, Buffer.from(bytes)])]);
const calamares = patchCalamares({ version: '13.0.13-1', users: [
  '---', 'userGroup: users', 'defaultGroups:', ...['cdrom', 'floppy', 'sudo', 'audio', 'dip', 'video', 'plugdev', 'netdev', 'lpadmin', 'scanner', 'bluetooth'].map(group => `  - ${group}`),
  'autologinGroup: autologin', 'sudoersGroup: sudo', 'setRootPassword: false', 'passwordRequirements:', '    nonempty: true', '    minLength: -1', '    maxLength: -1', '    libpwquality:', '      - minlen=0', '      - minclass=0', '',
].join('\n'), settings: [
  '---', 'modules-search: [ local, /usr/lib/calamares/modules ]', 'oem-setup: false', 'disable-cancel: false', 'disable-cancel-during-exec: false', 'quit-at-end: false',
  'sequence:', '- show:', ...['welcome', 'locale', 'keyboard', 'partition', 'users', 'summary'].map(module => `  - ${module}`),
  '- exec:', ...['partition', 'mount', 'unpackfs', 'luksbootkeyfile', 'dpkg-unsafe-io', 'sources-media', 'machineid', 'fstab', 'locale', 'keyboard', 'localecfg', 'users', 'displaymanager', 'networkcfg', 'hwclock', 'services-systemd', 'bootloader-config', 'grubcfg', 'bootloader', 'packages', 'plymouthcfg', 'initramfscfg', 'initramfs', 'dpkg-unsafe-io-undo', 'sources-media-unmount', 'sources-final', 'umount'].map(module => `  - ${module}`),
  '- show:', '  - finished', 'branding: debian', 'prompt-install: false', 'dont-chroot: false', '',
].join('\n'), unpackfs: '---\nunpack:\n  - source: "/run/live/medium/live/filesystem.squashfs"\n    sourcefs: "squashfs"\n    destination: ""\n' });
function fixture() {
  const files = new Map([
    ['/etc/passwd', 'root:x:0:0:root:/root:/bin/bash\nnobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin\n'],
    ['/etc/shadow', 'root:!:20000:0:99999:7:::\nnobody:*:20000:0:99999:7:::\n'],
    ['/etc/machine-id', ''],
    ['/etc/systemd/system/kidos-usb-firstboot.service', unit],
    ['/opt/kidos-node/v24.21.0/LICENSE', 'Preserved Node license and upstream notices.\n'.repeat(6)],
    ['/usr/share/kidos-usb/NODE-LICENSE', 'Preserved Node license and upstream notices.\n'.repeat(6)],
    ['/etc/calamares/settings.conf', calamares.settings], ['/etc/calamares/modules/users.conf', calamares.users], ['/etc/calamares/modules/unpackfs.conf', calamares.unpackfs],
    ...[...runtime].map(([path, bytes]) => [`/opt/kidos-usb/${path}`, bytes]),
  ]);
  const manifestFiles = [...source].map(([path, bytes]) => ({ path, size: bytes.length, sha256: digest(bytes), mode: 0o644 }));
  files.set(`${SOURCE}RELEASE.json`, json({ format: 1, version: '0.0.1-pilot.99', runtime: { minimumNodeMajor: 22, bundled: false }, contentDigest: digest(json(manifestFiles)), files: manifestFiles }));
  for (const [path, bytes] of source) files.set(`${SOURCE}${path}`, bytes);
  const directories = new Set(['/']);
  for (const path of files.keys()) {
    let directory = path.slice(0, path.lastIndexOf('/'));
    while (directory) { directories.add(directory); directory = directory.slice(0, directory.lastIndexOf('/')); }
  }
  const listing = [...directories].sort().map(path => `drwxr-xr-x 0/0 0 2026-10-14 00:00 squashfs-root${path === '/' ? '' : path}`).concat([...files.keys()].map(path => `-rw-r--r-- 0/0 0 2026-10-14 00:00 squashfs-root${path}`)).join('\n');
  return { listing, files, bootConfigs: { grub: `linux /live/vmlinuz ${trialArgs}\n`, syslinux: `append initrd=/live/initrd.img ${trialArgs}\n` }, bootReport: 'El Torito boot img :   1  BIOS  y   none  0x0000 0x00 4 1234\nEl Torito boot img :   2  UEFI  y   none  0x0000 0x00 4 5678\n' };
}
const expectedSourceDigest = JSON.parse(fixture().files.get(`${SOURCE}RELEASE.json`)).contentDigest;
const audit = data => auditExtractedData(data, { expectedSourcePaths: [...source.keys()], expectedSourceDigest });

test('static image evidence checks identity, clean source including binary files, and both boot catalogs', () => {
  const report = audit(fixture());
  assert.equal(report.result, 'static-audit-only'); assert.equal(report.passed, true);
  assert.equal(report.bootVerified, false); assert.equal(report.installationVerified, false); assert.equal(report.hardwareAccepted, false);
  assert.equal(report.source.files, 7);
  assert.equal(report.expectedSourceDigest, expectedSourceDigest);
  assert.equal(report.checks.activeBootstrapMatchesSource, true); assert.equal(report.checks.reviewedCalamaresConfiguration, true);
  assert.doesNotMatch(JSON.stringify(report), /root:x|20000|nobody|Preserved Node/);
});
test('baked user, password hash, machine identity and household paths fail without echoing their content', () => {
  const cases = [
    ['/etc/passwd', fixture().files.get('/etc/passwd') + 'secret-family:x:1000:1000:Private Name:/home/secret-family:/bin/bash\n'],
    ['/etc/shadow', 'root:$6$PRIVATE-HASH:20000:0:99999:7:::\n'],
    ['/etc/machine-id', 'SECRET-DEVICE-ID'],
  ];
  for (const [path, text] of cases) { const data = fixture(); data.files.set(path, text); assert.throws(() => audit(data), error => !/PRIVATE|SECRET|secret-family|Private Name/.test(error.message)); }
  for (const path of ['/home/private-family/story.txt', '/var/lib/kidos/state.json', '/opt/kidos-native-session/install.json', '/etc/ssh/ssh_host_ed25519_key', '/var/lib/systemd/random-seed', '/etc/kidos-usb-build.json']) {
    const data = fixture(); data.listing += `\n-rw------- 0/0 0 2026-10-14 00:00 squashfs-root${path}`;
    assert.throws(() => audit(data), /contains household data/);
  }
});
function withEmptyRootSsh() {
  const data = fixture();
  data.listing += '\ndrwx------ 0/0 3 2026-10-14 00:00 squashfs-root/root\ndrwx------ 0/0 3 2026-10-14 00:00 squashfs-root/root/.ssh';
  return data;
}
test('absent or exact empty protected root SSH directory contains no baked credentials', () => {
  assert.equal(audit(fixture()).passed, true);
  assert.equal(audit(withEmptyRootSsh()).passed, true);
});
test('every root SSH descendant remains forbidden including private keys, public keys and host records', () => {
  for (const name of ['id_ed25519', 'id_ed25519.pub', 'known_hosts', 'authorized_keys', 'config', 'nested/anything']) {
    const data = withEmptyRootSsh();
    data.listing += `\n-rw------- 0/0 1 2026-10-14 00:00 squashfs-root/root/.ssh/${name}`;
    data.files.set(`/root/.ssh/${name}`, 'PRIVATE-CREDENTIAL-FIXTURE');
    assert.throws(() => audit(data), error => /contains household data/.test(error.message) && !/PRIVATE-CREDENTIAL/.test(error.message));
  }
  const directory = withEmptyRootSsh();
  directory.listing += '\ndrwx------ 0/0 3 2026-10-14 00:00 squashfs-root/root/.ssh/empty-child';
  assert.throws(() => audit(directory), /contains household data/);
});
test('root SSH directory and its parents require ordinary protected root ownership and exact SSH mode', () => {
  const ssh = 'drwx------ 0/0 3 2026-10-14 00:00 squashfs-root/root/.ssh';
  for (const replacement of [
    'lrwxrwxrwx 0/0 3 2026-10-14 00:00 squashfs-root/root/.ssh -> /private',
    '-rwx------ 0/0 3 2026-10-14 00:00 squashfs-root/root/.ssh',
    ssh.replace('drwx------', 'drwxr-xr-x'), ssh.replace('drwx------', 'drwxrwx---'),
    ssh.replace('0/0', '1000/0'), ssh.replace('0/0', '0/1000'),
  ]) {
    const data = withEmptyRootSsh(); data.listing = data.listing.replace(ssh, replacement);
    assert.throws(() => audit(data), /root SSH directory/);
  }
  const parent = 'drwx------ 0/0 3 2026-10-14 00:00 squashfs-root/root\n';
  for (const replacement of ['', parent.replace('0/0', '1000/0'), parent.replace('0/0', '0/1000'), parent.replace('drwx------', 'drwxrwxrwx'), parent.replace('drwx------', 'lrwxrwxrwx')]) {
    const data = withEmptyRootSsh(); data.listing = data.listing.replace(parent, replacement);
    assert.throws(() => audit(data), /unsafe parent/);
  }
  const root = withEmptyRootSsh(); root.listing = root.listing.replace('drwxr-xr-x 0/0 0 2026-10-14 00:00 squashfs-root\n', 'drwxrwxrwx 0/0 0 2026-10-14 00:00 squashfs-root\n');
  assert.throws(() => audit(root), /unsafe parent/);
});
test('missing boot safety arguments, resumed disks, missing BIOS or UEFI all fail', () => {
  for (const arg of ['live-media=removable-usb', 'nopersistence', 'noresume', 'systemd.gpt_auto=0', 'rd.systemd.gpt_auto=0', 'systemd.swap=0']) {
    const data = fixture(); data.bootConfigs.grub = data.bootConfigs.grub.replace(arg, ''); assert.throws(() => audit(data), /temporary-trial/);
  }
  for (const unsafe of ['persistence', 'swap=true', 'resume=/dev/sda', 'todisk=/dev/sda', 'live-media=/dev/disk/by-label/KIDOS_TRY', 'bootfrom=/dev/sda', 'findiso=/old.iso', 'fromiso=/dev/sda/old.iso', 'systemd.gpt_auto=1', 'rd.systemd.gpt_auto=1', 'systemd.swap=1', 'boot=local']) {
    const data = fixture(); data.bootConfigs.syslinux += `append ${trialArgs} ${unsafe}\n`; assert.throws(() => audit(data), /temporary-trial/);
  }
  for (const type of ['BIOS', 'UEFI']) { const data = fixture(); data.bootReport = data.bootReport.split('\n').filter(line => !line.includes(type)).join('\n'); assert.throws(() => audit(data), /BIOS and UEFI/); }
});
test('source byte changes, injected source files, linked files and writable parent directories fail', () => {
  const changed = fixture(); changed.files.set(`${SOURCE}image.png`, Buffer.from('changed')); assert.throws(() => audit(changed), /release digest/);
  const extra = fixture(); extra.listing += `\n-rw-r--r-- 0/0 0 2026-10-14 00:00 squashfs-root${SOURCE}family.json`; assert.throws(() => audit(extra), /unreviewed/);
  const linked = fixture(); linked.listing = linked.listing.replace(`-rw-r--r-- 0/0 0 2026-10-14 00:00 squashfs-root${SOURCE}LICENSE`, `lrwxrwxrwx 0/0 0 2026-10-14 00:00 squashfs-root${SOURCE}LICENSE -> /root/private`); assert.throws(() => audit(linked), /unsafe/);
  const writable = fixture(); writable.listing = writable.listing.replace('drwxr-xr-x 0/0 0 2026-10-14 00:00 squashfs-root/opt\n', 'drwxrwxrwx 0/0 0 2026-10-14 00:00 squashfs-root/opt\n'); assert.throws(() => audit(writable), /directory/);
  assert.throws(() => parseListing('not a SquashFS listing'), /incomplete/);
  assert.throws(() => auditExtractedData(fixture(), { expectedSourcePaths: [...source.keys()], expectedSourceDigest: 'a'.repeat(64) }), /trusted prepared recipe/);
  assert.throws(() => auditExtractedData(fixture()), /trusted prepared BUILD/);
});
test('audit CLI has no drive or mount flags and refuses macOS/root execution before tool use', () => {
  assert.throws(() => parseOptions(['--mount', '/dev/sda']), /never mounts/);
  if (process.platform !== 'linux' || process.getuid?.() < 1000) {
    const result = spawnSync(process.execPath, [new URL('../../os/live-usb/audit.mjs', import.meta.url).pathname, '--iso', '/dev/sda', '--output-dir', '/', '--expected-source-digest', expectedSourceDigest], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.match(result.stderr, /ordinary Linux user/);
  }
});
test('actual bootstrap and installed unit must equal their trusted source copies', () => {
  for (const name of runtime.keys()) {
    const data = fixture(); data.files.set(`/opt/kidos-usb/${name}`, 'Changed active bootstrap'); assert.throws(() => audit(data), /bootstrap file/);
  }
  const data = fixture(); data.files.set('/etc/systemd/system/kidos-usb-firstboot.service', `${unit}After=network.target\n`); assert.throws(() => audit(data), /unit differs/);
});
test('actual installer retains private account defaults, explicit confirmation, sequence and clean source', () => {
  const changes = [
    ['/etc/calamares/settings.conf', calamares.settings.replace('prompt-install: true', 'prompt-install: false')],
    ['/etc/calamares/settings.conf', calamares.settings.replace('  - summary\n', '')],
    ['/etc/calamares/settings.conf', calamares.settings.replace('dont-chroot: false', 'dont-chroot: true')],
    ['/etc/calamares/modules/users.conf', calamares.users.replace('"o700"', '"o777"')],
    ['/etc/calamares/modules/users.conf', calamares.users.replace('doAutologin: false', 'doAutologin: true')],
    ['/etc/calamares/modules/users.conf', calamares.users.replace('kidos, kidos-live', 'some-other-name')],
    ['/etc/calamares/modules/unpackfs.conf', calamares.unpackfs.replace('/run/live/medium/live/filesystem.squashfs', '/')],
  ];
  for (const [path, bytes] of changes) { const data = fixture(); data.files.set(path, bytes); assert.throws(() => audit(data), /installer/); }
});
