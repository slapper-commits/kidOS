import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { patchCalamares } from '../../os/live-usb/calamares.mjs';

// Debian calamares-settings-debian 13.0.13 source, ISC license (Jonathan Carter).
// Content transcribed from the fixed upstream import commit:
// https://browse.dgit.debian.org/calamares-settings-debian.git/commit/?id=438cb1938e7b831b2e2c9dd24384ff30dfbea8db
const users = `---
userGroup: users
defaultGroups:
  - cdrom
  - floppy
  - sudo
  - audio
  - dip
  - video
  - plugdev
  - netdev
  - lpadmin
  - scanner
  - bluetooth
autologinGroup: autologin
sudoersGroup: sudo
setRootPassword: false

passwordRequirements:
    nonempty: true
    minLength: -1 # Password at least this many characters
    maxLength: -1 # Password at most this many characters
    libpwquality:
      - minlen=0
      - minclass=0
`;
// Stock sequence and modes with explanatory comments omitted. Package files are
// always read from the pinned Debian package; these are isolated test fixtures.
const settings = `---
modules-search: [ local, /usr/lib/calamares/modules ]
oem-setup: false
disable-cancel: false
disable-cancel-during-exec: false
quit-at-end: false
sequence:
- show:
  - welcome
  - locale
  - keyboard
  - partition
  - users
  - summary
- exec:
  - partition
  - mount
  - unpackfs
  - luksbootkeyfile
  - dpkg-unsafe-io
  - sources-media
  - machineid
  - fstab
  - locale
  - keyboard
  - localecfg
  - users
  - displaymanager
  - networkcfg
  - hwclock
  - services-systemd
  - bootloader-config
  - grubcfg
  - bootloader
  - packages
  - plymouthcfg
  - initramfscfg
  - initramfs
  - dpkg-unsafe-io-undo
  - sources-media-unmount
  - sources-final
  - umount
- show:
  - finished
branding: debian
prompt-install: false
dont-chroot: false
`;
const unpackfs = `---
unpack:
  - source: "/run/live/medium/live/filesystem.squashfs"
    sourcefs: "squashfs"
    destination: ""
`;
const stock = { version: '13.0.13-1', users, settings, unpackfs };

test('reviewed Debian installer preserves clean source and disk workflow while reserving identities', () => {
  const actual = patchCalamares(stock);
  assert.equal(actual.unpackfs, unpackfs);
  assert.equal(actual.settings.replace('prompt-install: true', 'prompt-install: false'), settings);
  assert.ok(actual.users.startsWith(users));
  assert.match(actual.users, /forbidden_names: \[root, nobody, kidos, kidos-live\]/);
  assert.match(actual.users, /home_permissions: "o700"/);
  assert.match(actual.users, /\ndoAutologin: false\ndisplayAutologin: false\n$/);
  assert.match(actual.users, /sudoersGroup: sudo/); // Existing supervised admin policy.
  assert.match(actual.users, /nonempty: true/);
});
test('upstream drift or unsafe installer modes stop before producing modified config', () => {
  for (const version of ['13.0.11-1', '14.0.2-1', '', null]) assert.throws(() => patchCalamares({ ...stock, version }), /review/);
  for (const changed of [users + 'user:\n  home_permissions: "o777"\n', users.replace('nonempty: true', 'nonempty: false'), users.replace('    nonempty:', 'nonempty:')]) assert.throws(() => patchCalamares({ ...stock, users: changed }));
  for (const changed of [settings.replace('  - summary\n', ''), settings.replace('dont-chroot: false', 'dont-chroot: true'), settings.replace('oem-setup: false', 'oem-setup: true'), settings + 'prompt-install: false\n', settings.replace('  - machineid\n', '')]) assert.throws(() => patchCalamares({ ...stock, settings: changed }));
  for (const changed of [unpackfs.replace('/run/live/medium/live/filesystem.squashfs', '/'), unpackfs.replace('"squashfs"', '"rsync"'), unpackfs + '  - source: "/home"\n']) assert.throws(() => patchCalamares({ ...stock, unpackfs: changed }));
});
test('unknown bytes and a second application fail closed', () => {
  for (const changed of [users + '\0', users + '\r', users + '\t']) assert.throws(() => patchCalamares({ ...stock, users: changed }));
  assert.throws(() => patchCalamares({ ...stock, ...patchCalamares(stock) }));
});
test('Calamares build CLI cannot accept disk paths or run on the development host', () => {
  const path = new URL('../../os/live-usb/calamares.mjs', import.meta.url);
  const invalid = spawnSync(process.execPath, [path.pathname, '--configure-image', '/dev/sda'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /marked kidOS USB build chroot/);
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid?.() !== 0) {
    const guarded = spawnSync(process.execPath, [path.pathname, '--configure-image'], { encoding: 'utf8' });
    assert.equal(guarded.status, 1); assert.match(guarded.stderr, /root Debian amd64 image build/);
  }
});

const capturedUsers = "---\nuserGroup:       users\ndefaultGroups:\n    - cdrom\n    - floppy\n    - sudo\n    - audio\n    - dip\n    - video\n    - plugdev\n    - netdev\n    - lpadmin\n    - scanner\n    - bluetooth\nautologinGroup:  autologin\nsudoersGroup:    sudo\nsetRootPassword: false\n\npasswordRequirements:\n    nonempty: true\n    minLength: -1  # Password at least this many characters\n    maxLength: -1  # Password at most this many characters\n    libpwquality:\n        - minlen=0\n        - minclass=0\n\n";
test('exact signed Debian users.conf padding is accepted while preserving its original bytes', () => {
  const actual = patchCalamares({...stock, users: capturedUsers});
  assert.ok(actual.users.startsWith(capturedUsers.replace(/\n*$/, '\n')));
  assert.equal(actual.unpackfs, unpackfs);
  assert.equal(actual.settings.replace('prompt-install: true', 'prompt-install: false'), settings);
  assert.match(actual.users, /userGroup:       users/);
  assert.match(actual.users, /sudoersGroup:    sudo/);
  assert.match(actual.users, /\ndoAutologin: false\ndisplayAutologin: false\n$/);
});
test('only ASCII mapping separator padding is ignored, with field ordering and security values exact', () => {
  const padded = capturedUsers.replace('userGroup:       users', 'userGroup:                  users').replace('nonempty: true', 'nonempty:        true');
  assert.ok(patchCalamares({...stock, users: padded}).users.startsWith(padded.replace(/\n*$/, '\n')));
  for (const changed of [
    capturedUsers.replace('userGroup:       users', 'userGroup:       root'),
    capturedUsers.replace('sudoersGroup:    sudo', 'sudoersGroup:    admin'),
    capturedUsers.replace('setRootPassword: false', 'setRootPassword:      true'),
    capturedUsers.replace('nonempty: true', 'nonempty:      false'),
    capturedUsers.replace('userGroup:       users', 'userGroup :       users'),
    capturedUsers.replace('userGroup:       users', 'userGroup:\u00a0users'),
    capturedUsers.replace('userGroup:       users', 'userGroup:\tusers'),
    capturedUsers.replace('userGroup:       users', 'userGroup:       users: sudo'),
    capturedUsers.replace('autologinGroup:  autologin\nsudoersGroup:    sudo', 'sudoersGroup:    sudo\nautologinGroup:  autologin'),
    capturedUsers + 'user:\n  home_permissions: o777\n'
  ]) assert.throws(() => patchCalamares({...stock, users: changed}));
});
test('spacing normalization cannot hide changed top-level or password policy nesting', () => {
  for (const changed of [
    capturedUsers.replace('userGroup:       users', '  userGroup:       users'),
    capturedUsers.replace('    nonempty: true', 'nonempty:        true'),
    capturedUsers.replace('    libpwquality:', 'libpwquality:'),
    capturedUsers.replace('        - minlen=0', '    - minlen=0')
  ]) assert.throws(() => patchCalamares({...stock, users: changed}), /nesting/);
});

const capturedSettings = "# Configuration file for Calamares\n# Syntax is YAML 1.2\n---\n\n# \"local\" is LIBDIR/calamares/modules with settings in SHARE/calamares/modules\nmodules-search: [ local, /usr/lib/calamares/modules ]\n\n# If this is set to true, Calamares refers to itself as a \"setup program\"\n# rather than an \"installer\". Defaults to the value of dont-chroot, but\n# Calamares will complain if this is not explicitly set.\noem-setup: false\n\n# If this is set to true, the \"Cancel\" button will be disabled entirely.\n# The button is also hidden from view.\n#\n# This can be useful if when e.g. Calamares is used as a post-install\n# configuration tool and you require the user to go through all the\n# configuration steps.\n#\n# Default is false, but Calamares will complain if this is not explicitly set.\n#\n# YAML: boolean.\ndisable-cancel: false\n\n# If this is set to true, the \"Cancel\" button will be disabled once\n# you start the 'Installation', meaning there won't be a way to cancel\n# the Installation until it has finished or installation has failed.\n#\n# Default is false, but Calamares will complain if this is not explicitly set.\n#\n# YAML: boolean.\ndisable-cancel-during-exec: false\n\n# If this is set to true, then once the end of the sequence has\n# been reached, the quit (done) button is clicked automatically\n# and Calamares will close. Default is false: the user will see\n# that the end of installation has been reached, and that things are ok.\n#\n#\nquit-at-end: false\n\nsequence:\n# Phase 1 - prepare.\n# View modules are shown as UI pages, jobs from job modules\n# are executed immediately in the background.\n# Jobs should be executed sparingly (if at all) in this phase.\n- show:\n  - welcome\n  - locale\n  - keyboard\n  - partition\n  - users\n  - summary\n\n# Phase 2 - install.\n# View modules are not shown. Only the view modules shown\n# in the previous phase are allowed, their names should be\n# added here as placeholders to specify the order in which\n# view module jobs should be enqueued. Job modules are\n# also allowed.\n- exec:\n  - partition\n  - mount\n  - unpackfs\n  - luksbootkeyfile\n  - dpkg-unsafe-io\n  - sources-media\n  - machineid\n  - fstab\n  - locale\n  - keyboard\n  - localecfg\n  - users\n  - displaymanager\n  - networkcfg\n  - hwclock\n  - services-systemd\n  - bootloader-config\n  - grubcfg\n  - bootloader\n  - packages\n  - plymouthcfg\n  - initramfscfg\n  - initramfs\n  - dpkg-unsafe-io-undo\n  - sources-media-unmount\n  - sources-final\n  - umount\n\n# Phase 3 - postinstall.\n# View modules are shown as UI pages, jobs from job modules are\n# executed immediately in the background.\n# Jobs should be executed sparingly (if at all) in this phase.\n- show:\n  - finished\n\n# A branding component is a directory, either in\n# SHARE/calamares/branding or in /etc/calamares/branding\n# (the latter takes precedence). The directory must contain a\n# YAML file branding.desc which may reference additional resources\n# (such as images) as paths relative to the current directory.\n# Only the name of the branding component (directory) should be\n# specified here, Calamares then takes care of finding it and\n# loading the contents.\nbranding: debian\n\n# If this is set to true, Calamares will show an \"Are you sure?\" prompt right\n# before each execution phase, i.e. at points of no return. If this is set to\n# false, no prompt is shown. Default is false.\n#\n# YAML: boolean.\nprompt-install: false\n\n# If this is set to true, Calamares will execute all target environment\n# commands in the current environment, without chroot. This setting should\n# only be used when setting up Calamares as a post-install configuration tool,\n# as opposed to a full operating system installer.\n#\n# Some official Calamares modules are not expected to function with this\n# setting. (e.g. partitioning seems like a bad idea, since that is expected to\n# have been done already)\n#\n# Default is false (for a normal installer).\n#\n# YAML: boolean.\ndont-chroot: false\n\n";
const capturedUnpackfs = "---\nunpack:\n    -   source: \"/run/live/medium/live/filesystem.squashfs\"\n        sourcefs: \"squashfs\"\n        destination: \"\"\n";
test('all three exact pinned-package configs retain disk sequence, clean SquashFS and original account bytes', () => {
  const exact = {version: '13.0.13-1', users: capturedUsers, settings: capturedSettings, unpackfs: capturedUnpackfs};
  const actual = patchCalamares(exact);
  assert.ok(actual.users.startsWith(capturedUsers.replace(/\n*$/, '\n')));
  assert.equal(actual.unpackfs, capturedUnpackfs);
  const nonblank = text => text.split('\n').filter(line => line.trim()).join('\n');
  assert.equal(nonblank(actual.settings.replace('prompt-install: true', 'prompt-install: false')), nonblank(capturedSettings));
  for (const [field, changed] of [
    ['users', capturedUsers.replace('setRootPassword: false', 'setRootPassword:     true')],
    ['users', capturedUsers.replace('    nonempty: true', 'nonempty:        true')],
    ['settings', capturedSettings.replace('dont-chroot: false', 'dont-chroot: true')],
    ['settings', capturedSettings.replace('  - summary\n', '')],
    ['unpackfs', capturedUnpackfs.replace('/run/live/medium/live/filesystem.squashfs', '/')]
  ]) assert.throws(() => patchCalamares({...exact, [field]: changed}));
});
test('actual padded SquashFS sequence mapping retains aligned keys and rejects malformed nesting', () => {
  const exact = {version: '13.0.13-1', users: capturedUsers, settings: capturedSettings, unpackfs: capturedUnpackfs};
  const padded = capturedUnpackfs.replace('-   source:', '-     source:').replace('        sourcefs:', '          sourcefs:').replace('        destination:', '          destination:');
  assert.equal(patchCalamares({...exact, unpackfs: padded}).unpackfs, padded);
  for (const changed of [
    capturedUnpackfs.replace('unpack:', '  unpack:'),
    capturedUnpackfs.replace('    -   source:', '-   source:'),
    capturedUnpackfs.replace('        sourcefs:', '    sourcefs:'),
    capturedUnpackfs.replace('        destination:', '      destination:'),
    capturedUnpackfs.replace('-   source:', '-     source:')
  ]) assert.throws(() => patchCalamares({...exact, unpackfs: changed}), /nesting/);
  assert.throws(() => patchCalamares({...exact, unpackfs: capturedUnpackfs.replace('"squashfs"', '"rsync"')}), /clean read-only/);
});
