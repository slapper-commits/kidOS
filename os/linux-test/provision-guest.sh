#!/bin/bash
# Guest-only fixture bootstrap. Never include this in a Pi release.
set -euo pipefail
umask 022
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH
if [[ $# -lt 2 || $# -gt 3 || $1 != --disposable-vm-id ]]; then
  echo 'Use --disposable-vm-id UUID [--enable-desktop-session|--check-target].' >&2; exit 1
fi
vm_id=$2
phase=${3:---provision}
case "$phase" in --provision|--enable-desktop-session|--check-target) ;; *) echo 'Unknown provisioning phase.' >&2; exit 1 ;; esac

# This bootstrap precedes the pinned Node runtime, so use Debian's existing
# Python only for local guard/installation operations; never execute app code.
/usr/bin/python3 - "$vm_id" <<'PY'
import json, os, pathlib, platform, re, stat, subprocess, sys
vm_id = sys.argv[1]
if os.getuid() != 0 or platform.system() != 'Linux' or platform.machine() != 'aarch64':
    raise SystemExit('Guest provisioning requires root on a disposable Linux ARM64 VM.')
if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', vm_id):
    raise SystemExit('Provide the exact disposable VM UUID.')
os_release = pathlib.Path('/etc/os-release').read_text()
for key, value in [('ID', 'debian'), ('VERSION_ID', '13'), ('VERSION_CODENAME', 'trixie')]:
    if not re.search(r'^' + key + r'=[\"\x27]?' + value + r'[\"\x27]?$', os_release, re.M):
        raise SystemExit('This fixture requires Debian 13 Trixie.')
virt = subprocess.check_output(['/usr/bin/systemd-detect-virt', '--vm'], text=True).strip()
if virt not in ('qemu', 'kvm'): raise SystemExit('A detected QEMU or KVM guest is required.')
parent = os.lstat('/etc')
if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022:
    raise SystemExit('Unsafe guest marker directory.')
fd = os.open('/etc/kidos-linux-test.json', os.O_RDONLY | os.O_NOFOLLOW)
with os.fdopen(fd, 'rb') as marker_file:
    info = os.fstat(marker_file.fileno())
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 1024:
        raise SystemExit('The VM marker must be a bounded root-owned 0600 ordinary file.')
    marker = json.loads(marker_file.read(1025))
if marker != {'format': 1, 'vmId': vm_id, 'disposable': True} or type(marker.get('format')) is not int or type(marker.get('disposable')) is not bool:
    raise SystemExit('The private VM marker does not match the explicitly selected disposable VM.')
print('Verified disposable Debian ARM64 ' + virt + ' VM ' + vm_id)
PY
if [[ $phase == --check-target ]]; then exit 0; fi

if [[ $phase == --provision ]]; then
  /usr/bin/python3 - <<'PY'
import hashlib, json, os, pathlib, shutil, stat, subprocess, tarfile, tempfile
version = 'v24.21.0'
archive_name = 'node-v24.21.0-linux-arm64.tar.xz'
archive_sha = '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2'
root = pathlib.Path('/opt/kidos-node')
destination = root / version
def directory(path, mode=0o755):
    if path.exists() or path.is_symlink():
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022: raise SystemExit('Unsafe fixture directory: ' + str(path))
    else: path.mkdir(mode=mode)
def digest(path):
    with path.open('rb') as source: return hashlib.file_digest(source, 'sha256').hexdigest()
def protected_tree(path):
    for item in [path, *path.rglob('*')]:
        info = item.lstat()
        if info.st_uid != 0 or (not item.is_symlink() and info.st_mode & 0o022): raise SystemExit('Unprotected runtime file: ' + str(item))
        if item.is_symlink() and not item.resolve().is_relative_to(path): raise SystemExit('Runtime link escapes its directory.')
def verify_runtime(path):
    protected_tree(path)
    node, license_file, receipt_file = path / 'bin/node', path / 'LICENSE', path / '.kidos-runtime-receipt.json'
    for item in (node, license_file, receipt_file):
        info = item.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1: raise SystemExit('Runtime identity files must be ordinary files.')
    receipt = json.loads(receipt_file.read_text())
    if receipt != {'format': 1, 'version': version, 'archiveSha256': archive_sha, 'nodeSha256': digest(node)}: raise SystemExit('Existing runtime lacks a matching protected hash receipt.')
    env = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'}
    if subprocess.check_output([str(node), '--version'], env=env, text=True).strip() != version: raise SystemExit('Runtime version differs from the pin.')
    if subprocess.check_output([str(node), '-p', 'process.platform + "/" + process.arch'], env=env, text=True).strip() != 'linux/arm64': raise SystemExit('Runtime architecture differs from the pin.')
directory(pathlib.Path('/opt')); directory(root)
if destination.exists() or destination.is_symlink():
    verify_runtime(destination)
else:
    # Copy first into a private root-owned directory, then hash that exact copy,
    # so the SSH user's source archive cannot change between verify and extract.
    with tempfile.TemporaryDirectory(prefix='.incoming-', dir=root) as temporary:
        temporary = pathlib.Path(temporary)
        source = pathlib.Path('/home/kidos-test') / archive_name
        fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as incoming, (temporary / archive_name).open('xb') as copied:
            info = os.fstat(incoming.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 256 * 1024 * 1024: raise SystemExit('Unsafe uploaded Node archive.')
            total = 0
            while chunk := incoming.read(1024 * 1024):
                total += len(chunk)
                if total > 256 * 1024 * 1024: raise SystemExit('Uploaded Node archive exceeded its copy bound.')
                copied.write(chunk)
        archive = temporary / archive_name
        if digest(archive) != archive_sha: raise SystemExit('The Node archive hash differs from the reviewed official release.')
        # The exact official archive was verified above. Reject an unexpected
        # top-level layout as well; tar preserves the complete distribution.
        with tarfile.open(archive) as tar:
            for entry in tar.getmembers():
                pieces = pathlib.PurePosixPath(entry.name).parts
                if not pieces or pieces[0] != 'node-v24.21.0-linux-arm64' or '..' in pieces: raise SystemExit('Unexpected runtime archive layout.')
        subprocess.run(['/usr/bin/tar', '-xJf', str(archive), '-C', str(temporary), '--no-same-owner'], check=True)
        extracted = temporary / 'node-v24.21.0-linux-arm64'
        subprocess.run(['/usr/bin/chmod', '-R', 'go-w', str(extracted)], check=True)
        receipt = {'format': 1, 'version': version, 'archiveSha256': archive_sha, 'nodeSha256': digest(extracted / 'bin/node')}
        (extracted / '.kidos-runtime-receipt.json').write_text(json.dumps(receipt) + '\n')
        verify_runtime(extracted)
        extracted.rename(destination)
fixture = pathlib.Path('/var/lib/kidos-linux-test')
directory(pathlib.Path('/var/lib')); directory(fixture)
for name in ('apt-sources', 'apt-lists', 'apt-archives'): directory(fixture / name)
sources = fixture / 'apt-sources' / 'debian.sources'
expected = '''Types: deb
URIs: http://deb.debian.org/debian
Suites: trixie trixie-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg

Types: deb
URIs: http://deb.debian.org/debian-security
Suites: trixie-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
'''
for item in (fixture / 'apt-sources').iterdir():
    info = item.lstat()
    if item != sources or not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or item.read_text() != expected: raise SystemExit('Unexpected fixture apt source; inspect it before continuing.')
if not sources.exists():
    with sources.open('x') as out: out.write(expected)
print('Pinned Node verified; separate signed Debian fixture sources prepared.')
PY
  apt_options=(
    -oDir::Etc::sourcelist=/dev/null
    -oDir::Etc::sourceparts=/var/lib/kidos-linux-test/apt-sources
    -oDir::State::lists=/var/lib/kidos-linux-test/apt-lists
    -oDir::Cache::archives=/var/lib/kidos-linux-test/apt-archives
    -oAcquire::http::Proxy=http://127.0.0.1:3128
    -oAcquire::Languages=none -oAcquire::Retries=2 -oAcquire::http::Timeout=60
  )
  /usr/bin/apt-get "${apt_options[@]}" update
  DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get "${apt_options[@]}" install -y --no-install-recommends \
    labwc chromium chromium-sandbox dbus-user-session fonts-dejavu-core seatd xwayland grim \
    libpam-systemd libgl1-mesa-dri libegl-mesa0 wayland-utils
  echo 'Guest packages and pinned runtime are ready. Install kidOS, then use --enable-desktop-session.'
  exit 0
fi

# A receipt exists only after the guarded kidOS installer has installed the
# actual shared service. Configure startup through its ordinary-user kiosk API.
/usr/sbin/runuser -u kidos-test -- /opt/kidos-node/v24.21.0/bin/node --input-type=module - "$vm_id" <<'JS'
import { vmTarget } from '/opt/kidos-linux-test/target.mjs';
await vmTarget(process.argv[2]);
JS
/usr/bin/python3 - "$vm_id" <<'PY'
import os, pathlib, pwd, stat, sys, tempfile
vm_id = sys.argv[1]
user = pwd.getpwnam('kidos-test')
if user.pw_uid != 1000 or user.pw_dir != '/home/kidos-test' or user.pw_shell != '/bin/bash': raise SystemExit('Expected the cloud-seeded ordinary kidos-test account.')
def protected(path, directory=False):
    info = path.lstat()
    if (not stat.S_ISDIR(info.st_mode) if directory else not stat.S_ISREG(info.st_mode) or info.st_nlink != 1) or info.st_uid != 0 or info.st_mode & 0o022: raise SystemExit('Unprotected fixture code/config: ' + str(path))
for path in ['/opt', '/opt/kidos-linux-test', '/etc', '/etc/systemd', '/etc/systemd/system']:
    protected(pathlib.Path(path), True)
for name in ['provision-guest.sh', 'desktop-session.sh', 'target.mjs', 'kiosk.mjs']:
    protected(pathlib.Path('/opt/kidos-linux-test') / name)
home = pathlib.Path(user.pw_dir)
info = home.lstat()
if not stat.S_ISDIR(info.st_mode) or info.st_uid != user.pw_uid: raise SystemExit('Unsafe desktop home.')
profile = home / '.bash_profile'
existing = ''
if profile.exists() or profile.is_symlink():
    info = profile.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != user.pw_uid or info.st_size > 1024 * 1024: raise SystemExit('Unsafe existing login profile.')
    existing = profile.read_text()
else: existing = 'if [ -r "$HOME/.profile" ]; then . "$HOME/.profile"; fi\n'
start, end = '# BEGIN kidOS disposable VM session', '# END kidOS disposable VM session'
if existing.count(start) != existing.count(end) or existing.count(start) > 1 or (start in existing and existing.index(end) < existing.index(start)): raise SystemExit('Malformed fixture login block.')
if start in existing:
    begin = existing.index(start); after = existing.index(end) + len(end)
    if existing[after:after+1] == '\n': after += 1
    existing = existing[:begin] + existing[after:]
block = f'''{start}
if [ "$(tty)" = /dev/tty1 ] && [ -z "${{DISPLAY:-}}${{WAYLAND_DISPLAY:-}}" ]; then
  exec /opt/kidos-linux-test/desktop-session.sh --disposable-vm-id {vm_id}
fi
{end}
'''
dropins = pathlib.Path('/etc/systemd/system/getty@tty1.service.d')
if dropins.exists() or dropins.is_symlink(): protected(dropins, True)
else: dropins.mkdir(mode=0o755)
dropin = dropins / 'kidos-linux-test.conf'
for item in dropins.iterdir():
    protected(item)
    if item != dropin: raise SystemExit('Existing tty1 drop-in requires inspection.')
def replace(path, text, uid=0, gid=0, mode=0o644):
    fd, temporary = tempfile.mkstemp(prefix='.kidos-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(text); out.flush(); os.fsync(out.fileno()); os.fchown(out.fileno(), uid, gid); os.fchmod(out.fileno(), mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
replace(profile, existing + ('' if existing.endswith('\n') else '\n') + block, user.pw_uid, user.pw_gid, 0o600)
replace(dropin, f'''# Disposable VM fixture only; guarded again before every automatic login.
[Service]
ExecStartPre=/opt/kidos-linux-test/provision-guest.sh --disposable-vm-id {vm_id} --check-target
ExecStart=
ExecStart=-/sbin/agetty --autologin kidos-test --noclear %I $TERM
''')
PY
/usr/sbin/runuser -u kidos-test -- /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/kiosk.mjs --enable-autostart --disposable-vm-id "$vm_id"
/usr/bin/systemctl daemon-reload
/usr/bin/systemctl enable getty@tty1.service
echo 'Real tty1 login and labwc autostart configured. Reboot or restart getty@tty1 to activate; no headless fallback is configured.'
