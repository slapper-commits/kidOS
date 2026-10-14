// Host-side, explicitly disposable Linux fixture. No host mounts, TAP/vmnet,
// system daemons, firewall, DNS, trust-store or boot configuration changes.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const inputs = JSON.parse(await readFile(new URL('./vm-inputs.json', import.meta.url)));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', ...options });
const usage = 'vm.mjs prepare --directory EMPTY_DIRECTORY --image VERIFIED_QCOW2 [--ssh-port 22222] | start --directory DIRECTORY [--display none|cocoa] [--audio none|coreaudio] | trust-host|status|stop --directory DIRECTORY';
const privateFile = (path, value) => writeFile(path, value, { flag: 'wx', mode: 0o600 });
async function digest(path) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function argumentsFor(argv) {
  const [command, ...args] = argv, options = {};
  if (!['prepare', 'start', 'trust-host', 'status', 'stop'].includes(command) || args.length % 2) throw new Error(usage);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--directory', '--image', '--ssh-port', '--display', '--audio'].includes(args[i]) || Object.hasOwn(options, args[i])) throw new Error(usage);
    options[args[i]] = args[i + 1];
  }
  if (!options['--directory']) throw new Error(usage);
  if (Object.hasOwn(options, '--audio') && command !== 'start') throw new Error('--audio is only supported by start.');
  if (Object.hasOwn(options, '--audio') && !['none', 'coreaudio'].includes(options['--audio'])) throw new Error('Audio must be none or coreaudio.');
  if (options['--audio'] === 'coreaudio' && process.platform !== 'darwin') throw new Error('Core Audio playback requires a macOS host.');
  return { command, options, directory: resolve(options['--directory']) };
}
async function prepare(directory, options) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This VM host recipe currently targets Apple Silicon macOS with QEMU/HVF.');
  const image = await realpath(options['--image'] || '');
  const imageInfo = await lstat(image);
  if (!imageInfo.isFile() || await digest(image) !== inputs.imageSha512) throw new Error('The Debian image SHA-512 does not match the pinned official image.');
  const info = JSON.parse(run('qemu-img', ['info', '--output=json', image]));
  if (info.format !== 'qcow2' || info['backing-filename']) throw new Error('Expected a standalone qcow2 base image.');
  const sshPort = Number(options['--ssh-port'] || 22222);
  if (!Number.isInteger(sshPort) || sshPort < 1024 || sshPort > 65535) throw new Error('Choose a non-privileged SSH forwarding port.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink() || (await readdir(directory)).length) throw new Error('VM preparation requires an empty ordinary directory.');
  await chmod(directory, 0o700);
  const qemu = run('which', ['qemu-system-aarch64']).trim();
  const qemuReal = await realpath(qemu);
  const firmwareRoot = resolve(dirname(qemuReal), '../share/qemu');
  const code = resolve(firmwareRoot, 'edk2-aarch64-code.fd');
  const vars = resolve(firmwareRoot, 'edk2-arm-vars.fd');
  await copyFile(vars, resolve(directory, 'uefi-vars.fd'));
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'kidos-disposable-linux-test', '-f', resolve(directory, 'id_ed25519')]);
  const publicKey = (await readFile(resolve(directory, 'id_ed25519.pub'), 'utf8')).trim();
  const vmId = randomUUID(), seed = resolve(directory, 'seed');
  await mkdir(seed, { mode: 0o700 });
  const marker = JSON.stringify({ format: 1, vmId, disposable: true });
  await privateFile(resolve(seed, 'meta-data'), `instance-id: kidos-linux-test-${vmId}\nlocal-hostname: kidos-linux-test\n`);
  await privateFile(resolve(seed, 'network-config'), `version: 2\nethernets:\n  kidos0:\n    match:\n      macaddress: "52:54:00:95:00:01"\n    set-name: kidos0\n    dhcp4: false\n    dhcp6: false\n    addresses: [10.0.2.15/24]\n`);
  await privateFile(resolve(seed, 'user-data'), `#cloud-config
ssh_pwauth: false
disable_root: true
ssh_deletekeys: true
ssh_genkeytypes: [ed25519]
package_update: false
package_upgrade: false
users:
  - name: kidos-test
    uid: 1000
    shell: /bin/bash
    lock_passwd: true
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - ${publicKey}
write_files:
  - path: /etc/kidos-linux-test.json
    owner: root:root
    permissions: '0600'
    content: '${marker}'
  - path: /etc/ssh/sshd_config.d/90-kidos-test.conf
    owner: root:root
    permissions: '0644'
    content: |
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      PermitRootLogin no
      AllowAgentForwarding no
      X11Forwarding no
      GatewayPorts no
runcmd:
  - [sh, -c, 'printf "KIDOS_TEST_SSH_KEY "; cat /etc/ssh/ssh_host_ed25519_key.pub']
  - [sh, -c, 'printf "KIDOS_TEST_READY ${vmId}\\n"']
`);
  run('hdiutil', ['makehybrid', '-quiet', '-o', resolve(directory, 'seed.iso'), seed, '-iso', '-joliet', '-default-volume-name', 'CIDATA']);
  run('qemu-img', ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', image, resolve(directory, 'disk.qcow2'), `${inputs.diskGiB}G`]);
  const config = { format: 1, disposable: true, vmId, image, imageSha512: inputs.imageSha512, firmware: code, qemu, sshPort, memoryMiB: inputs.memoryMiB, cpus: inputs.cpus };
  await privateFile(resolve(directory, 'vm.json'), `${JSON.stringify(config, null, 2)}\n`);
  console.log(JSON.stringify({ prepared: true, vmId, directory, sshPort, isolatedNetwork: true }));
}
async function configFor(directory) {
  const path = resolve(directory, 'vm.json'), stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid()) throw new Error('VM configuration must be a private file owned by this user.');
  const config = JSON.parse(await readFile(path));
  if (config.format !== 1 || config.disposable !== true || !/^[a-f0-9-]{36}$/.test(config.vmId) || config.imageSha512 !== inputs.imageSha512) throw new Error('Not a recognized disposable kidOS VM.');
  return config;
}
async function qmp(directory, command) {
  // Relative sockets avoid macOS's small Unix socket path limit.
  process.chdir(directory);
  return new Promise((resolveResult, reject) => {
    const socket = createConnection({ path: 'qmp.sock' });
    let pending = '', stage = 0, done = false;
    const fail = error => { if (done) return; done = true; socket.destroy(); reject(error); };
    socket.setTimeout(5000, () => fail(new Error('QEMU monitor timed out.')));
    socket.on('error', fail);
    socket.on('close', () => { if (!done) fail(new Error('QEMU monitor closed before acknowledging the command.')); });
    socket.on('data', bytes => {
      pending += bytes;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        let item; try { item = JSON.parse(line); } catch { continue; }
        if (item.QMP && stage === 0) { stage = 1; socket.write('{"execute":"qmp_capabilities"}\n'); }
        else if (item.error) fail(new Error(JSON.stringify(item.error)));
        else if (Object.hasOwn(item, 'return')) {
          if (stage === 1) { stage = 2; socket.write(`${JSON.stringify({ execute: command })}\n`); }
          else { done = true; socket.end(); resolveResult(item.return); }
        }
      }
    });
  });
}
async function main() {
  process.umask(0o077);
  const { command, options, directory } = argumentsFor(process.argv.slice(2));
  if (command === 'prepare') return prepare(directory, options);
  const config = await configFor(directory);
  if (command === 'trust-host') {
    const log = await readFile(resolve(directory, 'serial.log'), 'utf8');
    const match = /KIDOS_TEST_SSH_KEY (ssh-ed25519 [A-Za-z0-9+/=]+)/.exec(log);
    if (!log.includes(`KIDOS_TEST_READY ${config.vmId}`) || !match) throw new Error('Cloud-init has not published this VM host key and ready marker yet.');
    await privateFile(resolve(directory, 'known_hosts'), `[127.0.0.1]:${config.sshPort} ${match[1]}\n`);
    console.log('Recorded the guest host key observed on this VM serial console in its private known_hosts file.');
    return;
  }
  if (command === 'status' || command === 'stop') {
    if (command === 'status') { console.log(JSON.stringify(await qmp(directory, 'query-status'))); return; }
    const pid = Number((await readFile(resolve(directory, 'qemu.pid'), 'utf8')).trim());
    if (!Number.isSafeInteger(pid) || pid < 2) throw new Error('Invalid VM process receipt.');
    await qmp(directory, 'system_powerdown');
    const deadline = Date.now() + 50000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); }
      catch (error) {
        if (error.code !== 'ESRCH') throw error;
        console.log(JSON.stringify({ stopped: true, vmId: config.vmId, pid, method: 'guest ACPI shutdown' })); return;
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 250));
    }
    throw new Error('Guest shutdown was requested, but QEMU has not exited. The VM was not forcibly killed; inspect its serial log.');
  }
  const display = options['--display'] || 'none';
  const audio = options['--audio'] || 'none';
  if (!['none', 'cocoa'].includes(display)) throw new Error('Display must be none or cocoa.');
  try {
    await qmp(directory, 'query-status');
    throw new Error('This VM is already running; stop it before starting another display session.');
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
  }
  if (await digest(config.image) !== inputs.imageSha512) throw new Error('The pinned Debian backing image changed; refusing to boot.');
  const args = ['-name', 'kidOS disposable Linux test', '-uuid', config.vmId, '-L', dirname(config.firmware), '-machine', 'virt', '-accel', 'hvf', '-cpu', 'host', '-smp', String(config.cpus), '-m', String(config.memoryMiB), '-nodefaults',
    '-drive', `if=pflash,unit=0,format=raw,readonly=on,file=${config.firmware}`,
    '-drive', 'if=pflash,unit=1,format=raw,file=uefi-vars.fd',
    '-drive', 'if=none,id=disk,format=qcow2,file=disk.qcow2', '-device', 'virtio-blk-pci,drive=disk',
    '-drive', 'if=none,id=seed,format=raw,readonly=on,file=seed.iso', '-device', 'virtio-blk-pci,drive=seed',
    '-netdev', `user,id=net0,restrict=on,ipv6=off,hostfwd=tcp:127.0.0.1:${config.sshPort}-10.0.2.15:22`,
    '-device', 'virtio-net-pci,netdev=net0,mac=52:54:00:95:00:01',
    '-device', 'virtio-gpu-pci', '-device', 'qemu-xhci', '-device', 'usb-kbd', '-device', 'usb-tablet',
    '-display', display, '-chardev', 'file,id=serial0,path=serial.log,append=on', '-serial', 'chardev:serial0', '-qmp', 'unix:qmp.sock,server=on,wait=off', '-pidfile', 'qemu.pid'];
  // Core Audio is playback-only; the virtual codec exposes no recording device.
  // Omit the device entirely by default, preserving the original silent fixture.
  if (audio === 'coreaudio') args.push('-audiodev', 'coreaudio,id=kidos-output', '-device', 'intel-hda', '-device', 'hda-output,audiodev=kidos-output');
  console.log(JSON.stringify({ vmId: config.vmId, display, audio, sshPort: config.sshPort, network: 'restricted; loopback SSH only', hostFolders: 'none' }));
  const child = spawn(config.qemu, args, { cwd: directory, stdio: 'inherit' });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code || 0; });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
