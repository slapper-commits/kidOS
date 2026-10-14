# Disposable Linux VM verification

This fixture runs kidOS on Debian 13 ARM64 in QEMU on an Apple Silicon Mac. It exercises the same shared installer, pinned Node runtime, systemd unit, kiosk launcher and Chromium arguments used by the Pi pilot. It does not emulate Raspberry Pi identity or certify physical Pi operation.

**The bounded Linux foundation checks passed on 8 October 2026.** The verification table below distinguishes actual guest evidence from remaining product and hardware acceptance. The fixture is a developer machine: its disposable `kidos-test` account has passwordless sudo and can be configured for automatic login. Neither setting belongs in a child appliance or the Pi installer.

## Boundaries and inputs

- Host prerequisites: Apple Silicon macOS, Node.js 22+, an existing QEMU installation with HVF, ARM64 EDK2 firmware, `qemu-img`, SSH, `hdiutil`, and enough disk space. The recorded QEMU version is 11.1.1; the launcher does not install or enforce that version. Record the actual version on every run.
- Each preparation creates a fresh UUID, SSH key, cloud-init seed and writable qcow2 overlay. The downloaded base image is a read-only backing input. The guest marker is `/etc/kidos-linux-test.json`, root-owned mode `0600`, with exactly `{format:1,vmId,disposable:true}`.
- Guest provisioning requires that marker and matching `--disposable-vm-id`, root, Linux ARM64, Debian 13/Trixie and detected QEMU/KVM. The ordinary kiosk checks the protected marker metadata and a root-protected install receipt attesting that same VM.
- The Pi CLI still requires actual Raspberry Pi hardware and Raspberry Pi OS. VM entry points live separately in `/opt/kidos-linux-test`; they are excluded from the Pi source archive. The shared `install-core.mjs`, `kiosk-core.mjs`, unit and runtime pin remain in that archive.
- There are no host shared folders, TAP/vmnet interfaces or host system-service changes. The recipe does not change the host firewall, DNS, trust store, network settings or boot disk. SSH uses fixture-local keys and `known_hosts`, not the personal SSH configuration.
- QEMU user networking uses `restrict=on,ipv6=off` and only a loopback SSH forwarding rule. The guest has static `10.0.2.15/24`, no gateway, no configured upstream DNS and no DHCP. Temporary package access is described separately below. These fixture controls do not implement kidOS child-app containment.

The machine-readable OS pin is [vm-inputs.json](vm-inputs.json). The runtime pin and third-party license guidance are in [runtime-pin.mjs](../raspberry-pi/runtime-pin.mjs) and [RUNTIME.md](../raspberry-pi/RUNTIME.md).

| Input | Pin and provenance |
| --- | --- |
| Debian image | `debian-13-generic-arm64-20261001-2618.qcow2`, [official image](https://cloud.debian.org/images/cloud/trixie/20261001-2618/debian-13-generic-arm64-20261001-2618.qcow2), [publisher metadata](https://cloud.debian.org/images/cloud/trixie/20261001-2618/debian-13-generic-arm64-20261001-2618.json), [checksum listing](https://cloud.debian.org/images/cloud/trixie/20261001-2618/SHA512SUMS) |
| Debian SHA-512 | `001e742c14a69f3f506c1663b271b4aeed7fa766f7471a13d49ee22d338b8a637b5206a75bf994435af7b26ce3794a255dcf22e312b0d4b8d7b7f96076fe925f` |
| Node distribution | `node-v24.21.0-linux-arm64.tar.xz`, [official archive](https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz), [release/checksum source](https://nodejs.org/en/blog/release/v24.21.0#shasums) |
| Node SHA-256 | `6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2` |
| Guest capacity | 2 virtual CPUs, 4096 MiB memory, 16 GiB writable disk overlay |
| Display | QEMU `virtio-gpu-pci`, USB keyboard and tablet; labwc DRM/libinput backend with software pixman rendering |

Use the **generic** Debian image named above; do not substitute `genericcloud`. This is an exact OS/Node-input recipe, not a bit-for-bit full-system build: APT uses current signed Trixie repositories. Save package versions and logs with the results. Debian package license notices remain in `/usr/share/doc/<package>/copyright`; keep the complete Node distribution and `LICENSE`. No third-party binary is added to the kidOS source archive, and this fixture is not a distributable family image.

## Prepare the host fixture

Run management commands from the full repository root in one shell. The following names describe a **new disposable run**; do not reuse a directory containing another VM or family data. Additional foreground terminals are called out below.

```sh
kid_vm_dir="$PWD/work/linux-vm/repro"
kid_inputs="$PWD/work/linux-vm/downloads"
kid_evidence="$PWD/work/linux-vm/evidence-repro"
mkdir -p "$kid_inputs" "$kid_evidence"
qemu-system-aarch64 --version > "$kid_evidence/qemu-version.txt"

curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$kid_inputs/debian-13-generic-arm64-20261001-2618.qcow2" \
  https://cloud.debian.org/images/cloud/trixie/20261001-2618/debian-13-generic-arm64-20261001-2618.qcow2
printf '%s  %s\n' \
  001e742c14a69f3f506c1663b271b4aeed7fa766f7471a13d49ee22d338b8a637b5206a75bf994435af7b26ce3794a255dcf22e312b0d4b8d7b7f96076fe925f \
  "$kid_inputs/debian-13-generic-arm64-20261001-2618.qcow2" | shasum -a 512 -c -

curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$kid_inputs/node-v24.21.0-linux-arm64.tar.xz" \
  https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz
printf '%s  %s\n' \
  6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2 \
  "$kid_inputs/node-v24.21.0-linux-arm64.tar.xz" | shasum -a 256 -c -

node os/linux-test/vm.mjs prepare --directory "$kid_vm_dir" \
  --image "$kid_inputs/debian-13-generic-arm64-20261001-2618.qcow2" --ssh-port 22222
kid_vm_id=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).vmId' "$kid_vm_dir/vm.json")
```

Stop if any download or checksum fails. `prepare` verifies the image again and requires an empty ordinary target directory. Do not move or modify its backing image while retaining the overlay.

In a separate terminal at the repository root, start QEMU in the foreground. Use `cocoa` from the beginning for a visible virtual display; `none` is useful during API provisioning and does not remove the virtual GPU.

```sh
node os/linux-test/vm.mjs start --directory work/linux-vm/repro --display cocoa
```

Back in the management shell, wait until the serial log contains this VM's `KIDOS_TEST_READY` line, then record the SSH public host key observed on that same serial console:

```sh
rg 'KIDOS_TEST_READY|KIDOS_TEST_SSH_KEY' "$kid_vm_dir/serial.log"
node os/linux-test/vm.mjs trust-host --directory "$kid_vm_dir"

kid_ssh() {
  ssh -F /dev/null -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o GlobalKnownHostsFile=/dev/null -o "UserKnownHostsFile=$kid_vm_dir/known_hosts" \
    -i "$kid_vm_dir/id_ed25519" -p 22222 kidos-test@127.0.0.1 "$@"
}
kid_scp() {
  scp -F /dev/null -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o GlobalKnownHostsFile=/dev/null -o "UserKnownHostsFile=$kid_vm_dir/known_hosts" \
    -i "$kid_vm_dir/id_ed25519" -P 22222 "$@"
}
kid_ssh 'id; uname -a; systemd-detect-virt --vm; ip route; ip -6 route; cat /etc/resolv.conf'
```

`trust-host` creates its file exclusively. On subsequent boots use the existing file. Investigate a changed key or missing matching ready marker; do not bypass SSH verification. The VM directory contains a private SSH key and unique identity. Keep it private and out of releases.

## Provision through the temporary package channel

Upload the verified Node archive and fixture code through SSH. First run the guest marker guard from the uploaded script, before root installation-directory changes:

```sh
kid_ssh 'install -d -m 0700 /home/kidos-test/bootstrap'
kid_scp "$kid_inputs/node-v24.21.0-linux-arm64.tar.xz" kidos-test@127.0.0.1:/home/kidos-test/
kid_scp os/linux-test/{install,kiosk,target,verify}.mjs \
  os/linux-test/{provision-guest,desktop-session}.sh kidos-test@127.0.0.1:/home/kidos-test/bootstrap/
kid_ssh "sudo bash /home/kidos-test/bootstrap/provision-guest.sh --disposable-vm-id '$kid_vm_id' --check-target"
kid_ssh 'sudo install -d -o root -g root -m 0755 /opt/kidos-linux-test'
kid_ssh 'sudo install -o root -g root -m 0644 /home/kidos-test/bootstrap/*.mjs /opt/kidos-linux-test/'
kid_ssh 'sudo install -o root -g root -m 0755 /home/kidos-test/bootstrap/*.sh /opt/kidos-linux-test/'
```

Start the read-only package proxy in another host terminal at the repository root:

```sh
node os/linux-test/package-proxy.mjs
```

In another host terminal, create its temporary reverse SSH forwarding channel:

```sh
ssh -F /dev/null -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o GlobalKnownHostsFile=/dev/null -o UserKnownHostsFile=work/linux-vm/repro/known_hosts \
  -i work/linux-vm/repro/id_ed25519 -p 22222 -N -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:3128:127.0.0.1:31281 kidos-test@127.0.0.1
```

The proxy listens only on host `127.0.0.1:31281`. The SSH listener is only guest `127.0.0.1:3128`. It allows GET/HEAD to official `deb.debian.org` or `security.debian.org` paths under `/debian/` or `/debian-security/`, fetches via HTTPS, checks redirects, rejects CONNECT and other methods, and limits active requests and transferred bytes. It is temporary package transport, not a general guest internet route.

Run provisioning from the management shell. Save the output, and check its exit status rather than treating a log file as success:

```sh
kid_ssh "sudo /opt/kidos-linux-test/provision-guest.sh --disposable-vm-id '$kid_vm_id'" \
  > "$kid_evidence/provision.log" 2>&1
```

The script makes a private root-owned copy of the uploaded Node archive, verifies the pinned hash, preserves its complete distribution and notices, and installs `/opt/kidos-node/v24.21.0`. A pre-existing runtime must have matching version/architecture, protected files, and the protected archive/binary hash receipt. It never replaces `/usr/bin/node` or uses npm to install the application.

APT sources, package lists and archive cache are confined to `/var/lib/kidos-linux-test/apt-sources`, `apt-lists` and `apt-archives`. Each APT invocation specifies `Dir::Etc::sourcelist=/dev/null`, that fixture source directory and `Acquire::http::Proxy=http://127.0.0.1:3128`. Sources use Debian's existing archive keyring and signature verification. Default APT sources, gateway, DNS and network configuration remain unchanged. Guest package installation changes the guest package database and system files as expected.

Installed packages include labwc, Chromium and `chromium-sandbox`, D-Bus user sessions, logind/PAM support, fonts, seatd, Xwayland, Mesa, grim and Wayland tools. **Stop both the reverse-forwarding SSH command and package proxy with Ctrl+C once provisioning finishes.** Keep them stopped for offline acceptance and subsequent reboots. Record exact versions:

```sh
kid_ssh 'dpkg-query -W; /opt/kidos-node/v24.21.0/bin/node --version; chromium --version; labwc --version' \
  > "$kid_evidence/guest-versions.txt"
kid_ssh 'ip route; ip -6 route; cat /etc/resolv.conf; ss -lnt' \
  > "$kid_evidence/offline-network.txt"
```

## Install the same kidOS service

Build a fresh trusted source archive from the full checkout. The example version is arbitrary but must match throughout; output and extraction directories must be new. Release hashes establish integrity, not publisher signatures.

```sh
node scripts/build-pilot-release.mjs --version 0.0.1-pilot.3 --output-dir work/releases/linux-repro
kid_scp work/releases/linux-repro/kidos-0.0.1-pilot.3.tar \
  work/releases/linux-repro/kidos-0.0.1-pilot.3.tar.sha256 kidos-test@127.0.0.1:/home/kidos-test/
kid_ssh 'cd /home/kidos-test && sha256sum -c kidos-0.0.1-pilot.3.tar.sha256 && mkdir kidos-pilot && tar -xf kidos-0.0.1-pilot.3.tar -C kidos-pilot'
kid_ssh '/opt/kidos-node/v24.21.0/bin/node /home/kidos-test/kidos-pilot/os/raspberry-pi/install.mjs --target-root /home/kidos-test/pilot-stage'
kid_ssh "sudo /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/install.mjs --release-root /home/kidos-test/kidos-pilot --disposable-vm-id '$kid_vm_id'" \
  > "$kid_evidence/install.json"
```

The VM wrapper validates the real VM and then calls the shared installer. It installs the exact archived unit, creates the locked non-login `kidos` service identity, protects source/runtime directories and keeps state private in `/var/lib/kidos`. Runtime and install receipts record `targetKind: "disposable-linux-vm"`, the actual virtualization result and UUID. The ordinary desktop account remains separate from the service identity.

```sh
kid_ssh 'sudo systemctl is-active kidos.service; sudo systemctl show kidos.service -p User -p Group -p FragmentPath -p DropInPaths -p NoNewPrivileges -p ProtectSystem -p ProtectHome -p CapabilityBoundingSet; sudo ss -lntp' \
  > "$kid_evidence/service.txt"
kid_ssh 'sudo journalctl -u kidos.service -n 100 --no-pager' > "$kid_evidence/service-journal.txt"
kid_ssh 'sudo cat /opt/kidos/install-receipt.json' > "$kid_evidence/install-receipt.json"
```

Require service listeners only on `127.0.0.1:8787` and `127.0.0.1:8788`, `User=Group=kidos`, no unexpected drop-ins, and the recorded service restrictions. Startup uses the pinned runtime check. `readyForChildUse: false` remains intentional.

Service activation can precede HTTP readiness. Define this bounded readiness check in the management shell and use it after every service start/restart, once SSH is available:

```sh
kid_ready() {
  kid_ssh '/opt/kidos-node/v24.21.0/bin/node --input-type=module' <<'JS'
let ready = false;
for (let attempt = 0; attempt < 30 && !ready; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:8787/health', { signal: AbortSignal.timeout(1000) });
    ready = response.ok && (await response.json()).name === 'kidOS';
  } catch {}
  if (!ready) await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw new Error('kidOS did not become ready; inspect the service journal.');
JS
}
kid_ready
```

## Synthetic restart, reboot and backup checks

Run these before interactive desktop changes. The API harness accepts only a completely unused store for `seed`; do not empty an existing store to make it pass. It creates explicitly synthetic source, an immutable installed app, Trash, game progress, a generated book/WAV, media positions and an unsaved editor draft. JavaScript app content is stored/served, never executed as Node.

```sh
kid_ssh "sudo /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/verify.mjs seed --url http://127.0.0.1:8787 --state-file /var/lib/kidos-linux-test/fixture.json --disposable-vm-id '$kid_vm_id'" \
  > "$kid_evidence/api-seed.json"
kid_ssh 'sudo systemctl restart kidos.service'
kid_ready
kid_ssh "sudo /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/verify.mjs check --url http://127.0.0.1:8787 --state-file /var/lib/kidos-linux-test/fixture.json --label service-restart --disposable-vm-id '$kid_vm_id'" \
  > "$kid_evidence/api-restart.json"
kid_ssh 'sudo reboot'
```

SSH disconnecting during reboot is expected. Wait for SSH and `kidos.service` to return; use the existing verified host key. Confirm a new boot ID and exact baseline state:

```sh
kid_ready
kid_ssh "sudo /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/verify.mjs check --url http://127.0.0.1:8787 --state-file /var/lib/kidos-linux-test/fixture.json --label offline-reboot --require-new-boot --disposable-vm-id '$kid_vm_id'" \
  > "$kid_evidence/api-reboot.json"
```

For a whole-data-directory recovery rehearsal, use only this designated synthetic VM. Keep all copies; the following commands preserve the intentionally changed state rather than deleting it. The fixture receipt stays outside service data. Check every command before proceeding:

```sh
kid_ssh "sudo /opt/kidos-linux-test/provision-guest.sh --disposable-vm-id '$kid_vm_id' --check-target"
kid_ssh 'sudo systemctl stop kidos.service && sudo test ! -e /var/lib/kidos-linux-test/baseline-data && sudo cp -a /var/lib/kidos /var/lib/kidos-linux-test/baseline-data && sudo systemctl start kidos.service'
kid_ready
kid_ssh "sudo /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/verify.mjs mutate --url http://127.0.0.1:8787 --state-file /var/lib/kidos-linux-test/fixture.json --disposable-vm-id '$kid_vm_id'" \
  > "$kid_evidence/api-mutate.json"
kid_ssh 'sudo systemctl stop kidos.service && sudo test ! -e /var/lib/kidos-linux-test/post-mutation-data && sudo mv /var/lib/kidos /var/lib/kidos-linux-test/post-mutation-data && sudo cp -a /var/lib/kidos-linux-test/baseline-data /var/lib/kidos && sudo systemctl start kidos.service'
kid_ready
kid_ssh "sudo /opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/verify.mjs check --url http://127.0.0.1:8787 --state-file /var/lib/kidos-linux-test/fixture.json --label whole-directory-restore --disposable-vm-id '$kid_vm_id'" \
  > "$kid_evidence/api-restored.json"
```

The harness checks exact catalogs/source/draft and installed bytes, media hashes/ranges/HEAD, desktop asset hashes and platform/runner API separation. It does not measure browser behavior, audible playback, device durability or power-loss recovery. Its baseline checks will intentionally fail after unrelated interactive edits; retain that distinction in results.

## Real login, compositor and kiosk

After service/API checks, opt into this VM's automatic tty1 login:

```sh
kid_ssh "sudo /opt/kidos-linux-test/provision-guest.sh --disposable-vm-id '$kid_vm_id' --enable-desktop-session"
kid_ssh 'sudo reboot'
```

The command validates the protected installation receipt before modifying the desktop login profile and guest getty drop-in. The drop-in rechecks the private VM marker before every automatic login. PAM/logind creates the ordinary `kidos-test` session, its managed profile executes [desktop-session.sh](desktop-session.sh), and that script requires active seat0, `/dev/tty1`, a private logind runtime directory and a connected DRM output. It starts `dbus-run-session -- labwc` with `WLR_BACKENDS=drm,libinput` and `WLR_RENDERER=pixman`. Labwc then runs the shared kiosk path through its actual autostart file. This is a real virtual-display session with software rendering, not a headless or nested compositor. See the upstream [agetty autologin behavior](https://manpages.debian.org/trixie/util-linux/agetty.8.en.html) and [labwc configuration/autostart documentation](https://manpages.debian.org/trixie/labwc/labwc-config.5.en.html).

If the VM started with `--display none`, shut it down cleanly and restart with the Cocoa display before visual inspection:

```sh
node os/linux-test/vm.mjs stop --directory "$kid_vm_dir"
node os/linux-test/vm.mjs start --directory "$kid_vm_dir" --display cocoa
```

`stop` asks the guest to shut down through ACPI and waits for QEMU to exit. A timeout is an inspection task, not authorization to force-kill or reset. `start` refuses an already running VM. The new `start` remains in the foreground; use the management shell elsewhere for SSH checks.

Require a visible kidOS desktop after login without manually launching Chromium. Collect the actual session/process evidence:

```sh
kid_ssh 'loginctl list-sessions; sudo journalctl -u getty@tty1.service -b --no-pager; ps -eo user,pid,ppid,args' \
  > "$kid_evidence/graphical-session.txt"
```

Confirm labwc and Chromium run as `kidos-test`, the profile is `~/.local/share/kidos-browser`, and the browser arguments do not disable its sandbox. Inspect `chrome://sandbox` and an actual renderer's `/proc/<pid>/status` and namespace identities; the absence of `--no-sandbox` alone is not sufficient evidence. Keep any diagnostic page/screenshot separate from the normal kiosk startup result. Use normal browser/window controls; the kiosk is not a lock-down boundary.

For a compositor screenshot, inspect the existing sockets under `/run/user/1000` and use the actual Wayland socket name with `grim` as `kidos-test` through SSH. For example, **only if `wayland-0` was observed**:

```sh
kid_ssh 'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 grim /home/kidos-test/desktop.png'
kid_scp kidos-test@127.0.0.1:/home/kidos-test/desktop.png "$kid_evidence/desktop.png"
```

Exercise windows, source editing, browser preview, installed app launch, games, text/image viewing and native media decoding. Reload and reboot to inspect workspace/draft recovery. The current QEMU recipe does not configure an audio device; visible player progress does not prove audible output. Physical Pi graphics, audio, Bluetooth/USB peripherals and performance still require a Pi.

To remove kiosk autostart, run the ordinary-user VM wrapper with `--disable-autostart --disposable-vm-id UUID`. That preserves the browser profile and service data, and does not remove the VM-only automatic-login configuration. Stopping this disposable VM is sufficient when testing is finished; do not distribute its overlay, seed, private key or sudo-enabled account as a kidOS image.

## Verification record

Run: local `work/linux-vm/instance`, 8 October 2026 (some logs are dated 9 October in UTC). Debian 13 ARM64 image `20261001-2618`, kernel `6.12.111+deb13-arm64`, Node v24.21.0, Chromium `154.0.8037.92-1~deb13u1`, labwc `0.8.3-1`, systemd `257.13-1~deb13u1`, QEMU 11.1.1/HVF. Evidence paths below are relative to ignored `work/linux-vm/evidence/`; private VM identities and keys are not checked in.

Final full automated suite: **145 passed on macOS/Node 22.22.3; 141 passed and 4 platform-specific host-refusal tests skipped on Linux/Node 24.21.0; zero failures**. See `tests-final-macos.txt` and `install-focus-and-tests-linux.txt`. Independent review covered the shared installation/kiosk code, target guards, proxy, harness and fixes. These counts include local isolated API tests; the guest systemd/UI checks below are additional evidence.

| Check | Status | Collected evidence |
| --- | --- | --- |
| Guarded provisioning and exact runtime | Passed | `provision.log`, `packages-and-isolation.txt`, protected runtime/install receipts recorded in `offline-reboot.txt` |
| Shared systemd service and loopback listeners | Passed | `install-fixed.log`, `service-configuration.txt`, `recovery.log`, `offline-reboot.txt`; dedicated service user and only 127.0.0.1:8787/8788 |
| Synthetic source/install/media/workspace round trip | Passed | `api-seed.json` and `final-release-seed.txt`; exact catalog, original installed source bytes, book/WAV hashes, ranges and draft |
| Service restart and supervised crash recovery | Passed | `recovery.log`; changed service PID after controlled SIGKILL, exact data afterward |
| Offline reboot persistence | Passed | `offline-reboot.txt` before browser startup; `final-graphical-boot-api.json` also passed after a later graphical reboot, both with changed boot IDs and package channel stopped |
| Whole-directory backup restoration | Passed | `recovery.log`; service stopped for copies, deliberate mutations detected, originals restored exactly and all copies retained |
| Source release update retains data | Passed | `final-release-seed.txt`; whole-directory comparison excluding the live process lock after installing pilot.5 |
| Actual tty1 login → labwc → kiosk autostart | Passed | `reboot-and-graphical.txt`, `final-processes.txt` and `work/verification/linux-desktop.jpg`; real virtual DRM display, ordinary UID 1000 |
| Chromium renderer sandbox mechanisms | Passed for inspected processes | `browser-sandbox.json`; NoNewPrivs=1, Seccomp=2, no effective capabilities, separate user/PID namespaces from browser, no sandbox-disabling launch flags; no claim of complete kidOS child isolation |
| Targeted interactive workspace | Passed | Installed snapshot visible; text reader and recovered unsaved draft; app-frame focus → task switch → titlebar drag and upper-corner resize; minimization; F5 restored modified geometry, open windows and draft. Screenshots: `work/verification/linux-desktop.jpg`, `linux-workspace-reload.jpg` |
| Full browser/media/input acceptance | Pending | Representative codec playback, games and complete app workflows still need broader guest and hardware checks |
| Physical Pi, audible output, peripherals and performance | Pending | No Pi owned/selected; virtual display has no audio device; hardware testing cannot be replaced by VM results |

Retained failed attempts are diagnostic evidence, not passing results. The pilot.3 service exited cleanly without listening because its CLI check did not resolve the `current` release symlink; pilot.4 fixed it and passed actual startup. An early browser-enabled strict baseline mismatch was traced to an inconsistent synthetic stacking order and JSON key order; the fixture was corrected and its subsequent graphical-boot check passed. A real drag focus issue kept DOM focus on an old iframe; the accepted-gesture focus transfer passed its guest retest. These changes have dedicated regressions. The first sandbox probe assumed NUL-separated Chromium arguments; Chromium rewrites its process title, so the successful probe identifies the executable through `/proc/<pid>/exe` and records actual process restrictions.

For native macOS display automation in this run, a private `.app` wrapper inside the ignored VM directory contained an exact byte copy of the installed QEMU executable and an `Info.plist`; the original executable path was retained in `vm-original.json`. No application was installed into `/Applications`. The launcher supplies QEMU's original firmware resource directory with `-L`. Ordinary manual reproduction can use the original installed QEMU executable directly. The wrapper follows Apple's [application bundle layout](https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle).

The package proxy and reverse tunnel were stopped before offline tests. Final ACPI shutdown completed and QEMU exited; `shutdown.txt` and `cleanup.txt` confirm the temporary host listeners on 22222/31281/8787/8788 are closed. The private test disk and receipts remain for follow-up; Homebrew QEMU remains installed. The existing macOS preview was not stopped.

Local guard/staging tests can be run with `node --test services/platform/pi-pilot.test.mjs services/platform/linux-test.test.mjs`. The API harness also has isolated local tests. These tests do not replace the guest checks above. Parent authentication, child process/network containment, private-web services, secure enrollment, signed updates and a giftable image remain outside this fixture.


The foundation milestone’s source-only archive was `work/releases/ready-linux-final/kidos-0.0.1-pilot.7.tar`, SHA-256 `7ea34c7696f4e6792c6664c2155c0069f083748989a0d0160e2cc1a470a16738`. Two builds were byte-identical. Its 51 allowlisted files exclude the VM fixture, binaries, private identities and user data. The exact transferred archive passed checksum, fresh Linux staging, guarded shared live installation, health and whole-data comparison before shutdown (`final-pilot7-install.txt`). This is an installable source archive, not a flashable SD-card image. Earlier intermediate archives under `work/linux-vm/` are test checkpoints.

## Application expansion regression and pilot.8 — 8 October 2026

The existing designated VM was restarted with its Cocoa display, without reprovisioning or reopening the package proxy. Its boot ID for this run is `de547b71-e41e-427f-86eb-f29f8c815258`. It remained Debian 13 ARM64, kernel `6.12.111+deb13-arm64`, pinned Node.js v24.21.0 and QEMU/HVF. No host configuration or guest package/network changes were made. The guest still had no default route; its systemd-resolved loopback stub is not an upstream DNS connection.

The final application source and tests ran in a new ordinary-user directory, `/home/kidos-test/apps-wave-final.8E2gHV`, separate from the installed release and `/var/lib/kidos`. **193 tests: 189 passed, zero failed, four platform-specific host-refusal tests skipped.** The source archive hash was `8f023f5f95cacf9738920f7de2131f04e5041eb782515a2f005d4a70db25db21`; all 65 checked non-vendor code/test/config files matched the host checkout at completion. The test log is `work/linux-vm/evidence/apps-wave-linux-tests.txt`; snapshot and environment records are `apps-wave-linux-final-input.json` and `apps-wave-linux-environment.txt`. Earlier passing runs remain separately labeled initial/intermediate because Library fixes were still in progress.

The application checkpoint's source-only pilot bundle is `work/releases/ready-app-wave/kidos-0.0.1-pilot.8.tar`, **SHA-256 `c6f340acb615ed8341f0fcea00bc85a6cf609cf4bc1f5a00e28c869b6b7e4d5e`**. Two independent builds were byte-identical: 4,744,704 bytes, 258 allowlisted files, release ID `0.0.1-pilot.8-f7888df847cc`. This bundle adds the application code, original Explore content, and pinned local PDF.js/zip.js reader assets with their licenses. It contains no Node/OS executable, VM fixture, VM identity, family content, data directory or development test fixture. It is an installable source archive, not a flashable OS image. The later pilot.9 below corrects a Chromium-specific Explore asset failure.

The exact archive was transferred, checksum-verified and staged in a fresh Linux directory, then installed through the existing guarded VM wrapper with `--release-root` and this VM’s explicit UUID. Before installation, the graphical login and kidOS service were stopped; after Chromium finished shutting down, the entire private data directory and original install/runtime receipts were copied into fresh `/var/lib/kidos-linux-test/before-pilot8.8j2qRJ/`. The stopped data copy passed an exact directory-content comparison. It remains available; no prior data or release was deleted.

With the browser still closed, the installed service passed these checks:

- Real schema 5 → 6 migration; the exact former primary became both `state.backup.json` and new `state.pre-v6.83120b9f-4902-49b6-acbe-662f3865f881.json`, SHA-256 `cb08adc57ba5e1e5262216c323c1a1953acc009fc46210d8b78338676e79d87b`.
- Exact preservation of projects, immutable installed apps, games, project Trash and media maps; workspace equality allowing only the documented empty Explore-state normalization; newly empty local Mailbox state.
- Exact hashes, sizes, ownership and permissions for all prior non-state files, including both original media blobs; every prior installed snapshot file remained byte-identical when served.
- Successful installed-service HTTP responses for all six Explore websites and the desktop’s local reader/application modules, including the PDF worker. Read-only acceptance requests did not change the saved state.
- Active shared systemd service as `kidos`, with the existing service restrictions and loopback-only application listeners on 8787/8788.

Evidence: `apps-wave-pilot8-build.json`, `apps-wave-pilot8-stage.txt`, `apps-wave-pilot8-install.txt`, `apps-wave-pilot8-migration.json`, `apps-wave-pilot8-stop-and-backup.txt`, and `apps-wave-pilot8-service-and-desktop.txt` under `work/linux-vm/evidence/`. The stage log retains an initial rejected invocation with an unsupported extra option; the corrected documented CLI exited successfully and created the fresh stage. The first shutdown process check observed Chromium finishing its graceful exit; a subsequent check confirmed it absent before backup and migration acceptance.

The ordinary tty1 graphical login was restarted only after those checks passed. labwc and Chromium started again as `kidos-test`, with the existing kiosk profile and no sandbox-disabling flag. The VM is left running for the application milestone’s visual acceptance. This record proves regression tests, packaging, installed HTTP availability and preservation through this schema upgrade; final packaged GUI/game/media acceptance and physical Pi behavior must be recorded separately after observation.

### Post-package browser checks for the app wave

After the pilot.8 packaging checkpoint, targeted macOS browser checks also completed the following paths against separate synthetic data: import an exact API project export through the file picker and confirmation into a new project; Duplicate into an independent project; Moon Hopper round completion with the saved-score message, replay, pause/resume and the on-screen jump control; Tiny Racer start, left/right controls and pause; and compact Tablet/TV layout switching with the live paused game retained. These add to the Mailbox, Library, Explore and file/version checks recorded in the packaged README. The browser export button displayed success, but the browser download tool did not return the downloaded bytes, so the API export supplied the import fixture. No user data was used in these QA fixtures.

On the installed pilot.8 Linux graphical session, the pre-upgrade windows and unsaved recovery draft reappeared, and the new editor file controls and Library favorite/detail controls rendered. These observations verify updated graphical startup and retention; they do not certify all media codecs, complete game playability under Linux, physical input devices or Raspberry Pi performance.

## Explore Chromium correction and pilot.9 — 8 October 2026

The installed Chromium 154 lesson rendered without its stylesheet. A bounded loopback observation, emitting only Explore method/path/Origin/status, identified the cause: the document GET returned 200, but Chromium sent `Origin: null` for `/explore/site.css` and `/explore/location.js`, and both returned 403. An independent read-only CSS request without Origin returned 200 with the correct `text/css` MIME type. The diagnostic stopped automatically; installed source, service configuration and saved data were unchanged during capture. See `apps-wave-pilot8-explore-diagnostic.json`.

The handler now accepts opaque-origin GETs for exactly those two fixed assets. Foreign origins, mutation methods, address parameters, JSON APIs and desktop authority remain rejected; no CORS, credential, sandbox or CSP permission was added. The new regression test checks the original failure and these boundaries. Independent review found no remaining defect in the patch.

The final full suites passed **194/194 on macOS** and **190 passed, zero failed, four platform-specific skips out of 194 on Debian ARM64**. Logs are `apps-wave-pilot9-macos-tests.txt` and `apps-wave-pilot9-linux-tests.txt`. The first Linux source transfer omitted the `packages` and `design` directories; its missing-input failures remain in `apps-wave-pilot9-linux-incomplete-source.txt`. The corrected complete snapshot in `/home/kidos-test/apps-wave-pilot9.xY9xfL` passed. Subsequent changes only updated verification prose and explicitly uninstalled content candidates; no runtime or test code changed.

The current source-only bundle is **`work/releases/ready-app-wave-current/kidos-0.0.1-pilot.9.tar`**, SHA-256 **`e5284565eb477cbb1d170fb1b7ef06053fed1af9d0ebcb2511ea697417256ee3`**, release ID **`0.0.1-pilot.9-34e969895bbd`**. Two final builds were byte-identical: 4,753,408 bytes and 258 allowlisted files. Earlier pilot.9 candidate archives preceded the final prose/provenance freeze and are not the installed bundle. No proposed third-party content or application was added, and no family data, VM identity, runtime binary or VM fixture is in this archive. It remains an installable source bundle, not a flashable image.

Before the guarded upgrade, tty1 and Chromium exited and the kidOS service stopped. The complete data directory and existing receipts were copied to fresh `/var/lib/kidos-linux-test/before-pilot9.nWP0o1/`; the stopped-data comparison passed. The final archive passed its transferred checksum, fresh Linux staging and the VM install wrapper's target check. After installation, all five saved files had identical bytes, size, ownership and mode; schema 6 was unchanged. The primary state SHA-256 remained `740fba25074d3e07c9ca464fdbb3cbbe9ecc83f85f980995b93b05f4873aa4de`. The old release and both upgrade backups remain available.

The installed service returned 200 for both fixed assets with `Origin: null`, while opaque requests for Explore JSON and the desktop session still returned 403. Service authority remained `kidos`, with `NoNewPrivileges`, strict system protection, protected homes/private devices and no capabilities. The kiosk restarted after these checks. Evidence is in `apps-wave-pilot9-build.json`, `apps-wave-pilot9-stage.txt`, `apps-wave-pilot9-install.txt`, `apps-wave-pilot9-backup.txt`, `apps-wave-pilot9-preservation.json`, and `apps-wave-pilot9-service-and-desktop.txt` under `work/linux-vm/evidence/`.

After the macOS screen was unlocked by the user, the native CUA walkthrough verified the installed Moon Post lesson's violet header, serif heading, uppercase eyebrow and intended spacing. The saved windows and recovery draft remained visible. Submitting the fixed “Reflected sunlight” choice returned the styled answer with `POST received · HTTP 200`; the desktop's local address automatically changed to `/explore/sites/space/answer`, also verifying the location script. Proof images are `work/verification/apps-wave-linux-explore.jpg` and `work/verification/apps-wave-linux-form.jpg`. The release-included prose was frozen before these final observations; this excluded VM record is the later acceptance evidence.

The VM then shut down cleanly through guest ACPI and QEMU exited (PID 21775); see `apps-wave-pilot9-shutdown.txt`. There are no remaining listeners on VM port 22222 or the isolated diagnostic preview ports 8967/8968, and its browser tab is closed. The user's main preview on 8917 remains running with its existing data. The private VM disk, identities, prior release and data backups are retained for future work. No additional packages, host system settings or guest network configuration were changed by the pilot.9 correction.

## Native-game demonstration — 8 October 2026

The same preserved VM was subsequently restarted for Sean's authorized game demonstration. Signed Debian ScummVM/OpenTTD and open OpenTTD assets were installed, along with separately verified official Zoo demo data. A fixed labwc F8 menu launches the native windows; F9 returns to kidOS and F10 lists existing windows. Both return/switch controls were verified through the real GUI, as was OpenTTD's save, exit, relaunch and load of the same paused world. The temporary package channel was closed before offline acceptance. An opt-in output-only CoreAudio/HDA device booted successfully with one playback PCM and no capture PCM; audible output remains unverified. The existing kidOS data passed exact stopped-service comparisons before and after game package setup, and the shared service authority was unchanged.

See [the full native-game input, launch, preservation and acceptance record](NATIVE-GAMES.md). This later fixture is left running for supervised use; the earlier pilot.9 shutdown record above remains historical. Native games are not yet launched by the browser desktop, and neither game binaries nor proprietary demo data were added to its source release.

The subsequently authorized [native Files/Paint slice](NATIVE-FILES.md) adds ordinary Pictures/Documents/Downloads folders and a fixed native menu entry for each application. Real GUI checks saved a PNG, found and reopened it from Files, moved it to native Trash and restored identical bytes. Its separate launcher guard tests passed 7/7 on macOS and 7/7 on Debian ARM64. These programs run as the ordinary disposable VM user; they are not yet integrated into the browser taskbar or a restricted child account. The later package channels were also closed before offline acceptance, and service restrictions remain intact.

## Visible native launcher — 9 October 2026

The current source-only release is `work/releases/native-launcher-final/kidos-0.0.1-pilot.10.tar`, SHA-256 `128643a7e963bba5ef6f50ba9aa73f3555ae0852e7e511bb5b40c2789bf15f60`, release ID `0.0.1-pilot.10-6fa6e8e855f1`. Two builds matched exactly: 4,785,664 bytes and 260 allowlisted sources. Clean staging and isolated startup/persistence checks passed. It adds the catalog client and native-launcher documentation; OS binaries, the separately installed VM host/extension, game data, profiles and identities remain excluded. The earlier pilot.10 candidate was superseded by this documentation-frozen bundle.

Paint, Files, Trash, Putt-Putt (demo) and OpenTTD now appear in Applications and Start. Paint, Files and both games also have desktop shortcuts; Play includes both native games. The macOS preview explicitly reports that native apps require the Linux desktop. Both existing preview services were gracefully restarted with their original data paths; port8917 data matched exactly, while port8907 migrated to schema6 with all prior projects/apps/games/Trash/media/workspace unchanged and a new empty Mailbox record. Private before-update backups remain under ignored `work/preview-backups/native-launcher/`.

The reviewed [Native Messaging bridge](../native-session/README.md) is separately installed at `/opt/kidos-native-session`, with root-owned receipts and fixed extension identity. Actual host catalog checks report all five applications available. The existing combined F8 menu is preserved, including the parallel Writer/Calculator work, with **Open kidOS** added first. F9 includes a no-browser fallback. Only signed Debian `wlrctl` 0.2.2-2 was added for this bridge; the temporary proxy/tunnel is closed and the guest still has no default route. There is no new platform HTTP launch endpoint or change to the `kidos` service authority.

The complete macOS suite passed **230/230**; the complete Debian ARM64 suite passed **224/230 with six platform-specific skips and zero failures**. Independent behavioral review covered sender/frame/origin checks, bounded framing, fixed launch commands and environment, missing apps/errors, game focus fallback and receipt integrity. Evidence is in `work/verification/native-launcher-macos-tests.txt` and `work/linux-vm/evidence/native-bridge-linux-full-tests.txt`.

Both candidate and final VM updates preserved stopped service data exactly against their private backups. The final backup is `/var/backups/kidos-native-launcher-before-final`. Labwc713, Chromium735 and the user's unsaved Paint5102 remain running. The saved PNG SHA-256 remains `ad8b08084e1309073ec1732fa76f0f424fe63e10da3b3132bfc0892875fbedfe`; the OpenTTD save remains `1b80e03cea337b5a6b944697c95087355901bd925a0dae68ed597c915b75b13b`. Effective protections remain User/Group `kidos`, protected homes/private devices, strict system protection and no-new-privileges.

**Final graphical launch acceptance is pending.** Native CUA could refresh the Linux page with F5 and visually verify the new catalog (`work/verification/native-launcher-linux-catalog.jpg`), but pointer input reported no available window and modifier shortcuts did not close Chromium. The user was asked to unlock/show the Mac VM window. Chromium has not yet restarted to load the extension. Do not claim desktop-button→native-window or repeat-game-focus acceptance from the host availability/tests alone. Finish those checks through the real GUI; preserve the unsaved Paint process and do not restart the session. The preview shortcut evidence is `work/verification/native-launcher-preview.jpg`. Complete native taskbar integration, Pi provisioning, physical Pi and child-account containment remain pending.


## Native launcher resumed — 2026-10-09

The resumed check found the VM already stopped: no QEMU process, SSH or QMP listener and no disk user. Before boot, an APFS clone of `disk.qcow2`, UEFI variables and VM metadata was saved under `work/linux-vm/before-launcher-resume-20261009/`. This does not preserve native memory that had already ceased before the check. Boot used the existing guarded VM and real Cocoa/DRM desktop, with no host network change. Pointer control worked again.

Actual CUA clicks on Applications launched KolourPaint (PID 1000) and OpenTTD (PID 1493). A repeated OpenTTD button request visibly focused the same process. Review then found a real pilot.11 bug: content.js still accepted only five app IDs, silently dropping Writer/Calculator/Documents/Downloads while the other layers accepted nine. The corrected source has a regression traversing the actual content script and worker for all nine IDs, while retaining unknown-ID/extra-field rejection.

To preserve the running original browser and apps, the VM-only `native-launcher-check` helper opens the fixed corrected extension in a separate private browser profile through an F8 menu entry. It verifies the ordinary disposable-VM session, protected import closure, native receipt and graphical socket before launch. Its first actual launch failed because the sanitized environment omitted XDG_SESSION_TYPE; the guest console recorded “Missing X server or $DISPLAY.” The helper and shared reopen path now explicitly select the already-verified Wayland session. Chromium's sandbox remains enabled. The helper is excluded from Pi release files; it neither signals existing browsers nor reconstructs a graphical session from SSH.

The corrected browser (PID 1953) discovered the native catalog. Applications → Calculator opened KCalc (PID 2152); pointer input produced 7 + 3 = 10. Applications → Writer opened LibreOffice (PID 2202), which offered recovery of two previous documents. Recover Selected opened both, including the earlier ODT showing “The kite” and “kit”; both were left open. This is bounded launch/recovery evidence, not the complete formatted-story/save/reopen/PDF workflow. Screenshots are `work/verification/native-launcher-calculator.jpg` and `native-launcher-writer.jpg`. F9 selected the older kiosk; F10's distinct “kidOS” window entry returned to the new app window. This extra browser is a test-only preservation measure, not the Pi's normal startup design.

The Mac locked before the Documents button check. A user unlock request is pending; Documents/Pictures/Downloads, Trash and the demo's browser-button graphical acceptance remain open. The original kiosk, corrected verification window, Paint, game, Calculator and recovered Writer documents remain running. The temporary F8 “kidOS launcher check” item remains for completion, with exact prior menu saved as `~/.config/labwc/menu.xml.before-launcher-check-20261009`. No browser/compositor was closed during the resumed upgrades.

The final code suite passed 262/262 on macOS (Node v22.22.3) and 253 passed/9 platform skips/0 failed out of 262 on Debian ARM64 (pinned Node v24.21.0). The initial sandboxed Mac run failed because loopback listening was prohibited; its log is retained, and the permitted rerun passed. Evidence: `work/verification/native-launcher-final-macos-permitted-tests.txt` and `work/linux-vm/evidence/native-launcher-final-linux-tests.txt`. Independent review covered fixed app IDs, browser/host boundaries and the separate-profile helper. Final prose changes did not alter runtime or tests.

The current archive is `work/releases/pi5-sunday-current/kidos-0.0.1-pilot.12.tar`, SHA-256 `e93871950fbe23d570edb25325d37fcdf45bcd28077ec0be57b8b6f91a4a3304`, release ID `0.0.1-pilot.12-87c66c3ca73a`. Two builds were byte-identical with 277 allowlisted files. Exact archive staging and smoke checks passed on Mac and Linux: empty initial workspace, loopback listeners, desktop/native assets, create/install/launch, and exact project/installed digest after restart. Private media, VM identity/fixtures, QA helper, runtime binaries and family data remain excluded. Pilot.11 and intermediate pilot.12 archives are superseded; the adjacent VERIFICATION.json is the current bounded evidence.

The final VM update used the guarded install wrapper after copying stopped service data to `/var/backups/kidos-before-launcher-current-12`; a complete comparison excluding the transient store.lock passed. Earlier stopped backups remain retained. Paint, OpenTTD, both browsers, Calculator and Writer stayed running. The saved Pictures/kidos.png remains SHA-256 `ad8b08084e1309073ec1732fa76f0f424fe63e10da3b3132bfc0892875fbedfe`; the existing OpenTTD demo.sav remains `1b80e03cea337b5a6b944697c95087355901bd925a0dae68ed597c915b75b13b`. Service identity is still kidos with ProtectHome, PrivateDevices, ProtectSystem=strict and NoNewPrivileges. See `native-launcher-current-install.txt` and `native-launcher-current-release-rehearsal.txt` under `work/linux-vm/evidence/`.

Physical Pi installation, hardware/input/audio/USB, complete native taskbar integration, broader story workflow, backup/restore and independent child containment remain unverified. The Sunday guide describes a supervised Pi5/8GB source installation; it is not a bootable or giftable image.

## Native classics and normal-profile recovery — 2026-10-09

The installed source release is **`0.0.1-pilot.14-c938616290ee`**, from `work/releases/native-classics-final/kidos-0.0.1-pilot.14.tar`, SHA-256 **`5e401c96bcd465f8e962ac7eec69df0b139031592a7d1f4a3b345cd2b7417b88`**. Two builds were byte-identical: 5,059,072 bytes and 314 allowlisted source files. Earlier pilot.14 archives remain preserved as superseded checkpoints. The final bundle includes extension 1.1.1, the malformed catalog-entry guard and explicit extension-reload instructions. It contains no installed game binaries, family data, browser profile, VM identity or runtime binary.

The final source suite passed **282/282 on macOS ARM64** with Node v22.22.3, and **273 passed, 9 platform-specific skips, 0 failed out of 282 on Debian ARM64** with pinned Node v24.21.0. The exact archive passed checksum verification, fresh staging and a synthetic release smoke check on both systems: clean initial state, loopback listeners, desktop/native assets, project installation and launch, and persistence through service restart. Logs are `work/verification/native-classics-final-macos-tests.txt`, `work/verification/native-classics-final-release.json`, `work/linux-vm/evidence/native-classics-final-linux-tests.txt`, and `native-classics-final14-tests-and-native-install.txt`.

Signed Debian packages provide KPat/KMines `4:25.04.0-1` and Pinball/Pinball data `0.3.20230219-3`. Package setup added 24 packages and changed no existing package versions; binary/data presence, linked libraries and retained package copyright notices are recorded in `work/linux-vm/evidence/native-classics-package-verification.json`. The temporary package tunnel was closed, and the guest had no default route at the recorded cleanup check (`native-classics-controls-and-cleanup.json`). The later graphical QA cleanup also removed the temporary connection-settings menu item and F11 close binding, with exact comparison to their pre-test settings and a configuration reload. The ordinary F8 menu was visually checked afterward; evidence is `work/linux-vm/evidence/native-classics-final-cleanup.json`.

The guarded final service installation retained an exact stopped-data backup comparison and preserved User/Group `kidos`, `PrivateDevices=yes`, `ProtectHome=yes`, `ProtectSystem=strict` and `NoNewPrivileges=yes`. The installed current release is the ID above. The final native registration verified all 42 protected source files, including the null-entry response guard. Evidence: `work/linux-vm/evidence/native-classics-final-service-install.txt` and `native-classics-final14-tests-and-native-install.txt`.

The normal kidOS browser profile initially kept an older native-extension worker after source updates and browser restarts, even while direct host checks returned the current catalog. The actual Chromium extension page was used to reload **kidOS native applications**. Reloading with Developer mode off disabled this unpacked extension; enabling Developer mode restored it and showed version 1.1.1. The final installed extension was reloaded again with a visible **Reloaded** confirmation. The existing profile was retained; origin, native-host and request validation were not widened. Automatic refresh of an existing profile during upgrades remains unimplemented; use [the documented extension and page reload steps](../native-session/README.md#reload-the-bridge-after-an-update).

Actual controls in the **normal browser desktop** then launched all three classics:

- **Solitaire:** KPat's game chooser opened, followed by a dealt Klondike game numbered `1482242189`. Evidence: `work/verification/solitaire-desktop-linux.jpg` and `solitaire-klondike-linux.jpg`.
- **Minesweeper:** KMines opened a fresh board. Evidence: `work/verification/minesweeper-desktop-linux.jpg`.
- **Pinball:** the native main menu and Professor 3D table rendered; the Enter prompt disappeared after input. Evidence: `work/verification/pinball-desktop-linux.jpg` and `pinball-professor-desktop-linux.jpg`.

These observations establish desktop-to-native launch and initial game rendering. They do **not** establish a full game, card movement, mine reveal/flag behavior, working flippers, audible sound, game save/reopen, reboot persistence or physical Raspberry Pi operation. The broader everyday-computer, parent-control and independent-child containment acceptance remains open. This excluded VM record adds later evidence without changing or rebuilding the frozen release archive.

The final installed desktop also launched **Write** with its cream toolbar/navy title bar and **Calculator** with its matching native style; keyboard entry produced `7 + 3 = 10`. Screenshots: `work/verification/write-desktop-final-linux.jpg` and `calculator-desktop-final-linux.jpg`. A later Solitaire reopen returned to its game chooser after the zero-move test deal, so restored game progress is not claimed. The extra Pinball QA window exited through its own Exit menu. The final desktop was left open with no icon scrollbars (`native-classics-final-desktop-linux.jpg`), while the earlier saved document and other existing native windows were preserved.

## Puzzle Box pilot.15 — 2026-10-10

The installed release is **`0.0.1-pilot.15-956f7ef4d5ee`**, from `work/releases/puzzlebox-final/kidos-0.0.1-pilot.15.tar`, SHA-256 **`6e3120b11c831cd7b7b5d9a0dbf9d6587a828746b4a64bb474fd8cd43a9eb954`**. Two builds were byte-identical with 316 allowlisted source files. The full content digest is `956f7ef4d5ee5c29eb8fff635db5046366113795677bfe655e28bee1055a18f2`. The archive contains the original GTK3 chooser and fixed catalog, extension 1.2.0 and integration code; installed puzzle binaries, private profiles, creations, VM identities and fixture tools remain excluded.

The frozen suite passed **289/289 on macOS/Node v22.22.3** and **280 passed, 9 expected development-host refusal skips, 0 failed out of 289 on Debian ARM64/Node v24.21.0**. The fresh Linux full-source copy matched every release file before tests. Exact-archive staging and synthetic smoke checks passed on both systems, covering clean initial data, loopback listeners, desktop/native assets and project install/launch/restart persistence. Evidence: `work/verification/puzzlebox-final-macos-tests.txt`, `puzzlebox-macos-smoke.json`, `puzzlebox-linux-source-identity.json`, and `work/linux-vm/evidence/puzzlebox-final-linux-tests.txt` plus `puzzlebox-service-install.txt`.

Signed Debian provisioning installed `sgt-puzzles` `20230410.71cf891-2+b2`, `python3-gi` `3.50.0-4+b1` and `gir1.2-gtk-3.0` `3.24.49-3`: 13 new packages with no upgrades/removals, no prior package-version changes, and an empty `dpkg --audit`. All 40 protected puzzle executables and their linked dependencies were checked; isolated system Python imported Gtk 3.24.49 successfully. The collection's Expat/MIT notice and separate binding/toolkit notices were retained. A stale guest clock after host sleep initially caused normal signature rejection; only the disposable guest clock was corrected to verified UTC, then the signed refresh passed. No signature bypass or host clock/network change occurred. The package tunnel/proxy were removed and the VM retained no default routes. Exact package, backup, license and cleanup evidence is recorded in the `puzzle-box-*` files under `work/linux-vm/evidence/` and [the package record](../../docs/NATIVE-CLASSICS.md#puzzle-box-package-preparation--2026-10-10).

The guarded native update verified all **44 installed source hashes**, installed the fixed VM wrappers and replaced the normal menu after preserving `menu.xml.before-puzzlebox15`. Native installation left the service PID/start timestamp, saved creations and private data unchanged; its verified live backup is `/var/lib/kidos-linux-test/before-puzzlebox15.o9mp7ss6`. The previous native installation remains at `/opt/kidos-native-session.previous-7bb99e22-f77a-4ad5-8c42-999587e5ad30`. The subsequent separate guarded platform installation selected the release above and retained User/Group `kidos`, `PrivateDevices=yes`, `ProtectHome=yes`, `ProtectSystem=strict` and `NoNewPrivileges=yes`. Evidence: `puzzlebox15-tests-and-native-install.txt`, `puzzlebox15-install-preservation.json` and `puzzlebox-service-install.txt`.

Actual interaction in the **normal Chromium profile** reloaded extension **1.2.0**, with the visible **Reloaded** confirmation, then reopened normal kidOS. Its new **Puzzle Box** desktop icon opened the themed native chooser. Keyboard Tab/Return opened Flood; Right/Return changed the displayed move count from `0/25` to `1/25`, **U** restored `0/25`, and **R** restored `1/25`. **Game → Save** defaulted to Documents and saved `flood15.sav` (355 bytes, owner `kidos-test`, mode `0600`). After quitting Flood with **Q**, reopening from the chooser produced a different `0/24` board. **Game → Load** selected the saved file and restored the original board at `1/25`. Searching the full 40-game collection for `solo` returned the correct single Solo result. Screenshots: `work/verification/puzzlebox-native-linux.jpg`, `puzzlebox-flood-move-linux.jpg`, `puzzlebox-flood-reloaded-linux.jpg` and `puzzlebox-search-linux.jpg`.

Temporary GUI-test controls were then removed: the menu was restored byte-for-byte to its normal pre-test version, F11 was removed, the temporary F12 substitution was restored to the original F10 binding, and labwc 738 reloaded its configuration. The ordinary F8 menu visibly included Puzzle Box with no connection-settings helper; F10 again showed the existing window list. The earlier Aces Up deal `744850082`, Minesweeper, Pinball, Pictures, Write's `kite13.odt` and Calculator windows remained visible. Evidence: `work/linux-vm/evidence/puzzlebox-ui-cleanup.json` and `work/verification/puzzlebox-menu-cleanup-linux.jpg`.

The final saved Flood file has SHA-256 `86f78d0c5775c07f0023880ab0bfa3f7e71e0854b2e09bf425d304d4a75f6356`. Existing `kite13.odt`, `kite13.pdf` and `kidos.png` still match their earlier hashes exactly; see `work/linux-vm/evidence/puzzlebox-gui-save-and-preservation.txt`. After cleanup, **F8 → Puzzle Box** reopened the chooser successfully. The six-starter chooser was left visible for supervised use, with no further GUI operations planned.

This verifies normal-desktop launch, chooser search and one real Flood move/undo/redo/save/quit/reopen/load path. It does not certify gameplay across all 40 puzzles, puzzle completion, reboot persistence, audio, accessibility, touch/controller input or physical Raspberry Pi operation. The GTK import reported a nonfatal missing accessibility-bus warning; accessibility acceptance remains open. This excluded VM record adds later acceptance evidence without changing or rebuilding the frozen release source.

## Desktop stacking correction — 2026-10-14

The existing VM now runs portable release `0.0.1-pilot.16-444bd3ff4252`. Its separately installed `kiosk.mjs` requests `presentation: 'desktop'` (maximized Chromium app mode). `native-games-rc.xml` now matches the actual app identity `chrome-127.0.0.1__-Default`, removes its outer decorations, maximizes it and places it on labwc's always-on-bottom layer. Match by this identity at first map, not by the asynchronously populated page title. The F9 rule now targets the same identity. These changes are for this VM fixture only; the Pi desktop panel policy is unchanged.

Before applying this template to another existing fixture, compare its current configuration and preserve custom entries; never overwrite unrelated labwc settings. The active fixture's previous compositor config, launcher, install receipt and stopped service-data copy are under `/home/kidos-test/desktop-fixes-20261014/`. Only the kidOS Chromium process was restarted; existing native applications were retained. The service data remained identical except for the new live `store.lock`. F10 continues to provide the native window list. Native windows remain above browser-hosted tools, and the browser taskbar does not control them yet.

Linux verification passed 281 tests with nine expected platform skips. The release archive SHA-256 is `50c79345de7d1a686b1e3cdc188649667d3f08e824ef3caaeda154b336e2f200`, identical to the macOS build. UI evidence verifies keyboard launching Paint from the desktop with Files and Solitaire retained, stable shortcut position, desktop activation without covering those windows, and removal of the persistent notification strip. Pointer automation returned `noWindowsAvailable`; no new mouse-drag acceptance is claimed. See `docs/WINDOWS.md` for the complete scope and local evidence paths.
