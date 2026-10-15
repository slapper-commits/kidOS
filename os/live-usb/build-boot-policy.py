"""Build-only hook: patch three fixed ordinary files before binary checksums.

No path arguments, image programs, mounts, package changes, or device access.
live-build invokes this from the prepared recipe's binary/ directory.
"""
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import types

POLICY_SHA256 = 'e94afa67475ed4d0d7bdb4786f4748ea5e428db3cbf763213d258dd115ef9b43'
NODE_SHA256 = 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6'
RECEIPTS = ('config', 'bootstrap', 'binary_rootfs', 'binary_grub_cfg', 'binary_syslinux', 'binary_grub-efi')


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def protected(path, *, directory=False, maximum=256 * 1024):
    info = path.lstat()
    assert path.resolve() == path and info.st_uid == info.st_gid == 0
    assert stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    assert not info.st_mode & 0o022
    if not directory: assert info.st_nlink == 1 and 0 <= info.st_size <= maximum
    for parent in path.parents:
        value = parent.lstat()
        assert parent.resolve() == parent and stat.S_ISDIR(value.st_mode) and value.st_uid == 0
        assert not value.st_mode & 0o022 or (parent == pathlib.Path('/var/tmp') and value.st_mode & stat.S_ISVTX)
    return info


def read_fixed(path, maximum=256 * 1024):
    before = protected(path, maximum=maximum)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        assert identity(os.fstat(stream.fileno())) == identity(before)
        raw = stream.read(maximum + 1)
        assert identity(os.fstat(stream.fileno())) == identity(before)
    assert len(raw) == before.st_size and identity(protected(path, maximum=maximum)) == identity(before)
    return raw, before


def validate_build(value):
    assert set(value) == {'format', 'target', 'release', 'sourceDigest', 'nodeArchive', 'nodeSha256', 'sourceDateEpoch', 'diskWrites', 'isoVerified', 'buildHelpers'}
    assert type(value['format']) is int and value['format'] == 1 and value['target'] == 'debian-trixie-amd64-live'
    assert re.fullmatch(r'[0-9a-f]{64}', value['sourceDigest'])
    assert re.fullmatch(r'\d+\.\d+\.\d+-pilot\.\d+-' + value['sourceDigest'][:12], value['release'])
    assert value['nodeArchive'] == 'node-v24.21.0-linux-x64.tar.xz' and value['nodeSha256'] == NODE_SHA256
    assert type(value['sourceDateEpoch']) is int and value['sourceDateEpoch'] >= 0
    assert value['diskWrites'] is False and value['isoVerified'] is False
    rows = value['buildHelpers']
    assert isinstance(rows, list) and len(rows) == 2
    assert [row['path'] for row in rows] == ['config/build-helpers/boot-policy.py', 'config/build-helpers/build-boot-policy.py']
    for row in rows:
        assert set(row) == {'path', 'size', 'sha256', 'mode'} and row['mode'] == 0o644
        assert type(row['size']) is int and 0 < row['size'] <= 64 * 1024
        assert isinstance(row['sha256'], str) and re.fullmatch(r'[0-9a-f]{64}', row['sha256'])
    assert rows[0]['sha256'] == POLICY_SHA256


def replace_fixed(path, raw, before):
    assert identity(protected(path)) == identity(before)
    fd, name = tempfile.mkstemp(prefix='.kidos-boot-policy-', dir=path.parent)
    temporary = pathlib.Path(name)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(raw); output.flush(); os.fchmod(output.fileno(), stat.S_IMODE(before.st_mode)); os.fsync(output.fileno())
        assert identity(protected(path)) == identity(before)
        os.replace(temporary, path)
        assert read_fixed(path)[0] == raw
        directory = os.open(path.parent, os.O_RDONLY | os.O_NOFOLLOW)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.lexists(temporary): temporary.unlink()


def main():
    assert sys.platform == 'linux' and os.uname().machine == 'x86_64' and os.getuid() == os.getgid() == 0
    assert sys.flags.isolated == 1 and sys.flags.optimize == 0 and len(sys.argv) == 1
    script = pathlib.Path(__file__).resolve()
    root = script.parents[2]
    assert script == root / 'config/build-helpers/build-boot-policy.py'
    assert pathlib.Path.cwd() == root / 'binary'
    protected(root, directory=True); protected(root / 'binary', directory=True); protected(root / '.build', directory=True)
    script_bytes = read_fixed(script, 64 * 1024)[0]
    marker, info = read_fixed(pathlib.Path('/etc/kidos-live-usb-builder.json'), 1023)
    assert stat.S_IMODE(info.st_mode) == 0o600
    assert json.loads(marker) == {'format': 1, 'disposable': True, 'purpose': 'kidOS live USB builder'}
    result = subprocess.run(['/usr/bin/systemd-detect-virt', '--vm'], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5, check=True, env={'PATH': '/usr/bin:/bin', 'LANG': 'C'})
    assert result.stdout.strip() in (b'qemu', b'kvm')
    assert pathlib.Path('/run/systemd/system').is_dir()
    release = pathlib.Path('/etc/os-release').read_text()
    assert re.search(r'^ID=debian$', release, re.M) and re.search(r'^VERSION_ID="?13"?$', release, re.M)
    build = json.loads(read_fixed(root / 'BUILD.json', 4096)[0]); validate_build(build)
    assert build['buildHelpers'][1]['size'] == len(script_bytes)
    assert build['buildHelpers'][1]['sha256'] == hashlib.sha256(script_bytes).hexdigest()
    marker = json.loads(read_fixed(root / 'config/includes.chroot/etc/kidos-usb-build.json', 1023)[0])
    assert marker == {'format': 1, 'purpose': 'kidOS live USB build'}
    source = json.loads(read_fixed(root / 'config/includes.chroot/opt/kidos-usb/source/RELEASE.json')[0])
    assert source['format'] == 1 and source['contentDigest'] == build['sourceDigest']
    for name in RECEIPTS: assert protected(root / '.build' / name, maximum=0).st_size == 0
    for name in ('binary_hooks', 'binary_checksums', 'binary_iso'):
        assert not os.path.lexists(root / '.build' / name), 'Boot policy must run before checksum/image receipts'
    module_path = root / 'config/build-helpers/boot-policy.py'
    code = read_fixed(module_path, 64 * 1024)[0]
    assert hashlib.sha256(code).hexdigest() == POLICY_SHA256
    assert build['buildHelpers'][0]['size'] == len(code)
    policy = types.ModuleType('reviewed_build_boot_policy')
    exec(compile(code, str(module_path), 'exec'), policy.__dict__)
    inputs = {name: read_fixed(root / 'binary' / name.lstrip('/')) for name in policy.PATHS}
    assert all(stat.S_IMODE(value[1].st_mode) == 0o644 for value in inputs.values())
    output = policy.patch_configs({name: value[0] for name, value in inputs.items()})
    assert set(output) == set(inputs)
    for name, (raw, before) in inputs.items():
        if output[name] != raw: replace_fixed(root / 'binary' / name.lstrip('/'), output[name], before)
    assert policy.patch_configs({name: read_fixed(root / 'binary' / name.lstrip('/'))[0] for name in policy.PATHS}) == output
    print(json.dumps({'format': 1, 'purpose': 'kidOS generated boot-menu policy', 'sourceDigest': build['sourceDigest'], 'paths': list(policy.PATHS), 'liveMedia': 'removable-usb', 'stockFindisoRemoved': True, 'stockInstallerMenusRemoved': True, 'checksumsGenerated': False, 'imageBuilt': False, 'driveWritten': False}))


if __name__ == '__main__': main()
