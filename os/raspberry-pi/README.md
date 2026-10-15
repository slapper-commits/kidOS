# Raspberry Pi developer pilot

The selected target is **Pi 5 / 8 GB**; physical acceptance is still pending.
Use the current source-install steps below. The [original installation checklist](SUNDAY.md)
records the earlier October 11 plan and its pending hardware workflows; its old
candidate version is historical. See [all installation options](../../docs/INSTALL.md)
for the separate amd64 USB preview and existing-OS browser preview.

kidOS now has a source-only release archive, an installer that can be rehearsed in an empty directory, a systemd service, and an optional Chromium desktop launcher. This is a concrete route to using the current desktop on a dedicated Pi before the remaining product features are finished.

**Packaging/staging are verified on macOS. The shared installer, pinned runtime, service recovery/persistence and real labwc/Chromium autostart have also run in an isolated Debian ARM64 VM. Physical Pi behavior and performance remain unverified.** See the separate [VM recipe and evidence](../linux-test/README.md) in the full checkout; the VM fixture is excluded from this Pi source archive and does not satisfy Pi hardware acceptance. The first intended hardware target is a Raspberry Pi 5 with 8 GB RAM. Storage and peripheral acceptance remain pending. No bootable image was produced. This is a supervised developer pilot, not a child containment boundary or a giftable appliance.

## Target and prerequisites

The first target is **Raspberry Pi OS Trixie, 64-bit, with Desktop**. It needs a normal enrolled desktop user whose username is not `kidos` (reserved for the locked service account), Chromium, labwc, systemd, and the dedicated Node.js runtime described below. The official [Pi OS download page](https://www.raspberrypi.com/software/operating-systems/) listed a 64-bit Trixie Desktop release dated 6 October 2026 when checked on 8 October 2026. The installer checks the Pi model, Linux ARM64, Trixie, desktop executables, and systemd before live changes.

Choose the hardware and explicitly designate disposable installation media before using [Raspberry Pi Imager](https://www.raspberrypi.com/documentation/computers/getting-started.html#install-an-operating-system). Enroll an ordinary desktop account with its own credentials through normal Pi setup. This Pi recipe does not flash media, create desktop accounts, set shared passwords, enable automatic login, or configure SSH/networking. The separate disposable VM fixture creates its own test account and guest-only login/network setup; none of those settings bypass the Pi hardware guard or enter the Pi archive.

## Set up the dedicated runtime on the Pi

The pilot pins the official **Node.js v24.21.0 Linux ARM64** distribution at `/opt/kidos-node/v24.21.0/bin/node`. It does not use or replace the OS `nodejs` package or depend on a personal version manager. The [runtime provenance record](RUNTIME.md) lists the official archive, checksum and license source. No Node binary is bundled in the kidOS archive.

On the **dedicated Pi**, run this block from your ordinary desktop account. It downloads only the pinned official archive, checks its published SHA-256 before extraction, retains the complete distribution and its license notices, and refuses an existing runtime directory. The enclosing subshell stops on any failed check. These Linux setup commands have been reviewed but have **not** been executed on a Pi or this development host.

```sh
(
  set -eu
  test "$(uname -s)" = Linux
  test "$(uname -m)" = aarch64
  grep -q '^Raspberry Pi ' /proc/device-tree/model
  /usr/bin/chromium --version
  umask 077
  mkdir node-runtime-v24.21.0
  cd node-runtime-v24.21.0
  curl --fail --location --proto '=https' --tlsv1.2 \
    --output node-v24.21.0-linux-arm64.tar.xz \
    https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz
  printf '%s  %s\n' \
    '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2' \
    'node-v24.21.0-linux-arm64.tar.xz' | sha256sum --check --strict -
  test -d /opt
  test ! -L /opt
  test "$(stat -c %u /opt)" = 0
  test "$((0$(stat -c %a /opt) & 022))" -eq 0
  test ! -L /opt/kidos-node
  if test ! -e /opt/kidos-node; then sudo mkdir -m 0755 /opt/kidos-node; fi
  test -d /opt/kidos-node
  test "$(stat -c %u /opt/kidos-node)" = 0
  test "$((0$(stat -c %a /opt/kidos-node) & 022))" -eq 0
  test ! -e /opt/kidos-node/v24.21.0
  test ! -L /opt/kidos-node/v24.21.0
  sudo mkdir -m 0755 /opt/kidos-node/v24.21.0
  sudo tar --extract --xz --file "$PWD/node-v24.21.0-linux-arm64.tar.xz" \
    --directory /opt/kidos-node/v24.21.0 --strip-components=1 \
    --no-same-owner --same-permissions
  sudo chmod -R go-w /opt/kidos-node/v24.21.0
  /opt/kidos-node/v24.21.0/bin/node --version
)
```

The final command must print `v24.21.0`. Retain the verified archive with your installation records. If setup stops after creating the destination, inspect it before attempting recovery; do not overwrite it with another archive. The kidOS installer never downloads software, runs package managers, or changes package sources. It checks the exact runtime version, Linux ARM64, root ownership, protected parent directories and the retained `LICENSE` file. Another Node version requires an explicit recipe and service-path update.

## Build and rehearse

From the repository root, after tests pass:

```sh
node scripts/build-pilot-release.mjs --version 0.0.1-pilot.20 --output-dir work/releases/preview
mkdir -p work/pilot-extracted
tar -xf work/releases/preview/kidos-0.0.1-pilot.20.tar -C work/pilot-extracted
node work/pilot-extracted/os/raspberry-pi/install.mjs --target-root work/pi-stage
```

Use fresh output/extraction/staging directories for another rehearsal. The builder refuses to overwrite an archive. The installer requires an explicit **empty** staging directory or the separate live-install flag; no arguments never mean “install here.” Staging writes only under its target, without creating a host account, setting Linux ownership, starting services, installing packages, or changing host configuration. `STAGING-ONLY.txt` records these limits, and the staged runtime receipt cannot start a live service. Do not copy the staging tree over `/`; run the guarded installer on the Pi.

The uncompressed tar uses deterministic sorted regular-file entries, fixed timestamps, modes and numeric ownership. The exact [source allowlist](source-files.json) includes the installer itself and excludes `.data`, `.env`, `.git`, `work`, family media, generated fixtures, browser profiles and device identities. New runtime modules must be added to that list. Linked inputs and unsafe paths are rejected. `RELEASE.json` records every source SHA-256, size, release version and content digest; the adjacent `.tar.sha256` checks transfer integrity. Checksums are not authenticity signatures: transfer from your trusted build machine.

This reproduces the **app archive** for identical source inputs and a chosen version. It does not reproduce or bundle the OS, Node, Chromium, firmware, or a full device image. No runtime npm dependencies are downloaded. The live receipt records the expected official archive checksum, exact installed Node version and executable digest, OS release and Pi model. Archive verification happens in the manual setup above; the installer hashes the installed executable. The service refuses to start after its Node binary changes until you revalidate and explicitly reinstall the pilot. Keep OS security updates current; a Node security update requires reviewing and updating the pin rather than holding an old runtime indefinitely.

## Install on the dedicated Pi

Get the portable `kidos-0.0.1-pilot.20.tar` and its checksum from the
[release page](https://github.com/slapper-commits/kidOS/releases/tag/v0.0.1-pilot.20),
or use your verified build above. Copy both together to the Pi. GitHub's automatic
source archives do not include the required portable `RELEASE.json`. In that directory:

```sh
(
  set -eu
  sha256sum -c kidos-0.0.1-pilot.20.tar.sha256
  mkdir kidos-pilot
  tar -xf kidos-0.0.1-pilot.20.tar -C kidos-pilot
  cd kidos-pilot
  /opt/kidos-node/v24.21.0/bin/node os/raspberry-pi/install.mjs --target-root ../kidos-stage
  sudo /opt/kidos-node/v24.21.0/bin/node os/raspberry-pi/install.mjs --install-on-this-pi
)
```

The block stops on a failed checksum, extraction or staging check. Only the final installer command performs a live installation. It validates release bytes, creates a locked non-login system account named `kidos`, and installs/enables the service. Unexpected account or directory ownership/structure causes failure. It waits for the local health endpoint; failures retain files and the receipt for inspection without automatically reverting data.

| Location | Purpose |
| --- | --- |
| `/opt/kidos/releases/<version>-<digest>/` | Versioned, root-owned source |
| `/opt/kidos/current` | Selected release link |
| `/opt/kidos-node/v24.21.0/` | Dedicated official Node distribution and complete license notices |
| `/opt/kidos/runtime.json` | Exact dedicated Node version, expected archive checksum and installed binary digest |
| `/opt/kidos/install-receipt.json` | Installed/previous release and target evidence |
| `/var/lib/kidos/` | Private service-owned projects, apps, media, scores and workspace |
| `/etc/systemd/system/kidos.service` | Supervision and service restrictions |
| `~/.local/share/kidos-browser/` | Private profile created only by the optional desktop-user launcher |

The platform and runner share one supervised Node process and bind to `127.0.0.1:8787` and `127.0.0.1:8788`. The [service unit](kidos.service) uses a non-login account, private state, read-only system/home access, no new privileges and an empty capability set, based on [systemd execution controls](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml). This protects the service environment; it does not contain arbitrary child browser code or enforce internet isolation. No firewall, DNS, trust store, bootloader, or network settings are changed.

Inspect the service, then open **http://127.0.0.1:8787/** in Chromium on the Pi:

```sh
sudo systemctl status kidos.service
sudo journalctl -u kidos.service -n 80 --no-pager
curl http://127.0.0.1:8787/health
```

`readyForChildUse: false` is intentional. Parent authentication, controlled imports, child isolation, private DNS/HTTPS, family messages, signed updates, device enrollment and reset remain unfinished.

## Optional desktop login startup

First verify the ordinary browser workflow. Then, in the enrolled user's graphical desktop terminal, **without sudo**:

```sh
/opt/kidos-node/v24.21.0/bin/node /opt/kidos/current/os/raspberry-pi/kiosk.mjs --launch
```

The Pi launcher waits for the service and starts a maximized Chromium app window with its sandbox enabled and a private profile. The Pi panel remains available for switching native windows, volume and shutdown. A separately enrolled native-session bridge is verified before enabling the fixed extension; absent enrollment leaves native apps unavailable. It never adds `--no-sandbox` or disables browser security. Exit with normal desktop/browser controls (for example Alt+F4). This supervised desktop is not a security boundary.

To opt into launching after that user's normal desktop login:

```sh
/opt/kidos-node/v24.21.0/bin/node /opt/kidos/current/os/raspberry-pi/kiosk.mjs --enable-autostart
```

It creates only its managed `~/.config/autostart/kidos.desktop` entry, preserving Pi’s labwc configuration and existing startup applications. A minimal user labwc autostart file can hide system startup helpers, so the Pi path does not create one. Login/password settings remain unchanged. Remove only the kidOS entry with:

```sh
/opt/kidos-node/v24.21.0/bin/node /opt/kidos/current/os/raspberry-pi/kiosk.mjs --disable-autostart
```

## Updates, backup and stopping

Before installing another release or changing Node, stop the service and copy the **entire** `/var/lib/kidos` directory to separate private storage. JSON alone omits media. Close Writer, Paint, Files, games and Chromium after saving their work. Also back up `~/Documents`, `~/Pictures`, `~/Downloads`, all of `~/.local/share/kidos-native` (native preferences and game saves), and `~/.local/share/Trash` (files and recovery metadata together). Back up the closed browser profile separately for browser-only preferences. A full copy of the desktop home also covers files and normal app profiles used outside kidOS; see the [Sunday backup checklist](SUNDAY.md). Keep the service stopped while copying:

```sh
sudo systemctl stop kidos.service
# Copy /var/lib/kidos to your chosen private backup destination now.
sudo systemctl start kidos.service
```

Build a new pilot version and repeat verification/install. Prior source directories remain, and the receipt records the previous release. Migrations can make older software unable to read newer state: retaining old code is **not** a tested rollback. Recovery needs a compatible whole-directory backup and an explicit restore plan. No reset, data deletion, downgrade migration or automatic rollback is performed.

When native-session sources change, rerun their guarded registration from the new release, then [reload the kidOS native extension and the desktop page](../native-session/README.md#reload-the-bridge-after-an-update) in the existing dedicated browser profile. An increased extension version or browser restart alone does not verify that its new worker is running. Preserve that profile and confirm an actual launch from **Applications**.

For a Node update, review its official release and checksum, update `runtime-pin.mjs`, the service paths, this setup recipe and tests together, and install into a new version directory. Preserve its full license notices. Rebuild and reinstall kidOS, then refresh the optional desktop autostart entry so it uses the new runtime. Existing system packages remain separate.

Stop automatic service startup while retaining code and family data with:

```sh
sudo systemctl disable --now kidos.service
```

## Verification and first-device acceptance

At the earlier macOS packaging checkpoint on 8 October 2026, eight targeted tests passed on macOS/Node 22.22.3: deterministic archive metadata and secret exclusion; tamper/path/link rejection; staging safety/layout/private data; importing the staged server's module graph; non-Pi live-install refusal; preserved/idempotent autostart edits; and service/browser configuration contracts. Run `node --test services/platform/pi-pilot.test.mjs`. The pilot.2 archive was also built, extracted and staged using the documented CLI. Its staged server was started on temporary loopback ports on macOS: it began with no projects/apps/media/workspace, served all desktop assets, created/installed/launched a project and restored an exact recovery draft after restart without modifying the saved source. A fresh rebuild was byte-identical. Those checks used host Node 22.22.3 and were staging-only evidence; Linux execution had not yet been performed at that checkpoint.

The subsequent disposable Debian 13 ARM64 VM run used QEMU 11.1.1/HVF and the exact Node v24.21.0 distribution. Pilot.4 started the shared systemd service after fixing entry-point handling through `/opt/kidos/current`. Exact synthetic source/installed/media/workspace checks passed after restart, supervised service-crash recovery, whole-directory restore and a browser-disabled offline reboot with a new boot ID. Actual tty1/logind → DRM labwc → Chromium autostart was visually confirmed. The window gesture/focus correction passed actual guest dragging and corner resizing; task switching and F5 workspace/draft restoration were also checked. The corrected synthetic fixture passed exact state checks after graphical boot. Broader browser, audio and physical Pi acceptance are not implied. Final full-suite logs record 145 macOS passes and 141 Linux passes with four host-rejection tests skipped on Linux, including that independently reviewed UI correction. Pilot.5 was then installed and a whole-directory comparison confirmed the update retained every baseline data file before further browser testing. Earlier 144/140-pass runs remain historical evidence. Local evidence is under `work/linux-vm/evidence/`; the [VM record](../linux-test/README.md) separates successful checks, retained failed attempts and remaining limits.

The common service/kiosk implementation is exercised without pretending the VM is a Pi. Pi-specific model/OS guards remain mandatory; VM wrappers are separate and excluded from the Pi source allowlist.

On the dedicated Pi, record the model, RAM, power supply, storage, exact OS image/hash, Node archive/hash and installed binary digest, Chromium version and input devices, then verify:

1. Boot, normal login, service and optional kiosk; both listeners stay on loopback.
2. Create/edit/install/run a project; multiple windows and saved workspace after service/device restart.
3. Games and scores; representative images, books, audio and video with audible output and seeking.
4. Offline use, input devices, storage and representative workload performance.
5. Service failures and backup restoration with designated test data. Destructive power-loss, flashing or reset drills require a separately designated disposable target.

All five hardware acceptance items remain open. A Pi image would need pinned full
inputs, unique household/device identities and OS/browser/runtime licenses; no
Pi image is supplied. Original kidOS code, artwork and documentation use the
[MIT license](../../LICENSE); third-party components retain their own notices.
This source archive remains a supervised developer pilot. See the repository's
[giftable-device requirements](../../docs/GIFTABLE.md) for the separate readiness work.
