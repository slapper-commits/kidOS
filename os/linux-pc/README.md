# kidOS on Intel MacBooks and PCs

This is an **experimental dedicated-computer installation**, using Debian 13
Trixie amd64 and a Wayland desktop. It targets Intel MacBooks from 2012 onward
and ordinary 64-bit Intel/AMD laptops and desktops. A model/year is a candidate,
not a compatibility guarantee. No physical MacBook or PC has passed kidOS
acceptance yet. Apple Silicon, Apple T2 models, ARM Windows machines and 32-bit
PCs are outside this first target. The Pi installer remains separate.

The `os/linux-pc` entry points supply a guarded service installer, native-app
enrollment and an optional login launcher for existing Debian installations.
They do not install Linux, partition disks or configure drivers. The separate
[kidOS live USB](../live-usb/README.md) provides a bundled trial and optional
Calamares installation. The macOS/Windows app edition is a second planned track;
keeping the existing OS currently means using the source browser preview,
without the native Linux app bridge.

See [all installation options](../../docs/INSTALL.md), or the [friend-facing USB
guide](../../docs/USB-TRY.md) for the bundled Try/install path.

## Hardware target and USB trial

Target a 64-bit dual-core processor, at least 4 GB RAM (8 GB preferred), 64 GB
storage with room for creations, and an 8 GB or larger USB drive for Debian's
live image. These are provisional kidOS engineering targets, not measured
minimums. An SSD is preferable. Installation/package preparation needs internet;
the installed desktop and local content can then be used offline.

Start with the official [Debian amd64 live KDE image](https://www.debian.org/CD/live/).
Debian's live mode can try the hardware without installing onto the internal
drive, and includes the Calamares graphical installer. Verify the image using
[Debian's instructions](https://www.debian.org/CD/verify). Preparing a USB erases
that USB; select a deliberately disposable drive. Use the computer's one-time
boot menu (Option on an Intel Mac; the manufacturer's boot key on PCs).

Before choosing Install, try the actual keyboard, trackpad/mouse, readable
display, brightness, Wi-Fi, sound, headphone output, suspend/resume and USB.
MacBook Wi-Fi and switchable graphics can require model-specific firmware or
drivers. Follow [Debian's hardware guidance](https://www.debian.org/releases/trixie/amd64/ch02s01.en.html);
do not assume all 2012 or later models behave alike. The stock Debian image does
not include kidOS; use the separate kidOS image for its bundled trial. Stop if
essential hardware does not work.

Exact model details are not needed to continue development. Sean's 2026-10-14
planning assumption is an unspecified post-2012 MacBook and a basic Windows PC.
The initial dedicated-computer track still requires Intel/AMD x64 hardware;
[T2-equipped Intel Macs](https://support.apple.com/en-us/103265) and Apple Silicon
remain separate targets. An increasingly new model is not automatically eligible.

Once a compatible Node runtime is available, run this read-only report without
sudo from the extracted bundle or checkout:

```sh
node os/linux-pc/install.mjs --check-hardware
```

It prints local JSON containing architecture, visible RAM and, on Linux, the
manufacturer/model and Debian version check. It reads no serials, device UUIDs,
network addresses, usernames or disk inventory, and uploads/saves nothing. Missing
facts stay unknown. Its provisional 4 GB screen allows for reserved RAM. Every
result keeps `hardwareAccepted: false`: booting the live desktop and trying the
actual devices is still necessary. On macOS/Windows it directs you to the Linux
trial; it does not certify their drivers. This command cannot take a drive/path
argument or install anything. The separate kidOS USB has passed emulated boot,
Try/Cancel drive preservation, Calamares installation and first installed login;
two installed boots retained the same document bytes/text and device identity.
The first page needed Ctrl+R, and boot two reopened the document through Dolphin
and ordinary LibreOffice after kidOS shortcut timeouts. Physical hardware and
automatic launcher reliability remain unqualified.

When the owner deliberately chooses a dedicated Linux installation, back up the
old OS/data and retain its recovery method. Use Debian's graphical installer,
review its disk summary, create an ordinary desktop account with a private
`/home/NAME`, and select **Plasma (Wayland)** at login. Dual boot and automated
disk changes are outside this pilot. Leave the normal Linux panel, settings and
power controls available. No firmware/security-setting changes are performed by
kidOS. This procedure has not been executed on the development host.

## Add kidOS to installed Debian

These are developer-assisted pilot steps, not the finished friend-facing wizard.
Use the portable `kidos-0.0.1-pilot.20.tar` and its adjacent checksum from the
[release page](https://github.com/slapper-commits/kidOS/releases/tag/v0.0.1-pilot.20).
Check the checksum before extracting. GitHub's automatic source archives have no
`RELEASE.json` and cannot be used directly with the guarded service installer;
pilot.17 also predates PC support. From a checkout, a developer can build a bundle
with `npm run release:verify -- --version 0.0.1-pilot.20 --output-dir work/pc-candidate`
(on one line). That does not publish a release.
Extract the bundle and open a terminal in its directory. Never carry over
another household's `.data`, `/var/lib/kidos`, home, browser profile or receipts.

1. Download the [official Node.js v24.21.0 Linux x64 runtime](https://nodejs.org/en/blog/release/v24.21.0#shasums)
   as your ordinary user and check the pinned archive before extracting:

   ```sh
   curl -fLO https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
   echo 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6  node-v24.21.0-linux-x64.tar.xz' | sha256sum --check --strict
   ```

   Continue only after `OK`. Preserve Node's bundled LICENSE. On a fresh target,
   install into the dedicated root-owned directory; do not overlay an existing
   runtime or substitute the ARM64 archive:

   ```sh
   sudo mkdir -p /opt/kidos-node
   sudo mkdir /opt/kidos-node/v24.21.0
   sudo tar -xJf node-v24.21.0-linux-x64.tar.xz --strip-components=1 --no-same-owner -C /opt/kidos-node/v24.21.0
   ```

2. Check the target without changing it, then prepare the fixed signed-distro
   packages and install the verified release. The package helper uses existing
   APT sources and refuses package removals; it does not add repositories or
   install hardware drivers:

   ```sh
   /opt/kidos-node/v24.21.0/bin/node os/linux-pc/install.mjs --check-target
   sudo /opt/kidos-node/v24.21.0/bin/node os/linux-pc/native-packages.mjs --install-on-this-pc
   sudo /opt/kidos-node/v24.21.0/bin/node os/linux-pc/install.mjs --install-on-this-pc
   sudo /opt/kidos-node/v24.21.0/bin/node /opt/kidos/current/os/linux-pc/native.mjs --install --desktop-user "$(id -un)"
   ```

   Run from the ordinary user's terminal so `id -un` expands before sudo. The
   locked `kidos` service user is separate from this account. Service data lives
   at `/var/lib/kidos`; code lives under `/opt/kidos/releases`. The service binds
   only to `127.0.0.1:8787` and `127.0.0.1:8788`, with its existing systemd home,
   device and write restrictions. Installation of an update stops/restarts that
   service: save work and back up first.

3. In that user's real Wayland desktop, without sudo, prepare missing native
   preferences and open kidOS:

   ```sh
   /opt/kidos-node/v24.21.0/bin/node /opt/kidos-native-session/native-launch.mjs --setup-user
   /opt/kidos-node/v24.21.0/bin/node /opt/kidos/current/os/linux-pc/kiosk.mjs --launch
   ```

   To open kidOS after normal login, run the same launcher with
   `--enable-autostart`; reverse with `--disable-autostart`. This never enables
   automatic login. The system menu also has **kidOS**. Chromium uses its own
   kidOS profile with sandboxing enabled. Follow the [extension reload steps](../native-session/README.md#reload-the-bridge-after-an-update)
   after updating an existing bridge. Existing files/preferences are preserved.

If native apps report unavailable, inspect the package/enrollment error instead
of bypassing it. An X11-only machine can use the ordinary browser preview, but
this initial native PC bridge requires Wayland. KDE does not provide labwc's
window-decoration rules or wlrctl activation protocol: shared application styles
remain available, and an already-running game may need the normal window
switcher. Native kidOS taskbar coordination remains pending.

## Physical qualification and remaining acceptance

The USB's isolated x64 installation and two-boot document-persistence checks have
passed with the [recorded workarounds and limits](../../docs/USB-VERIFICATION.md).
Physical qualification still needs an actual 2012 Intel MacBook and an entry-level
Intel/AMD PC. Record model, CPU/RAM,
graphics/Wi-Fi, Debian version, release digest and results; keep device identities
and family content out of public artifacts. Verify USB boot, setup without a
developer, offline restart, writing/drawing/save/reopen, native launches, audio,
keyboard/trackpad, brightness, battery/lid/suspend, USB copy/eject and complete
backup/restore. Verify a clean install and a manual upgrade preserving creations.
No physical row is complete yet. See [the rollout gates](../../docs/PC-INSTALL.md).

Local rehearsal on any supported development host:

```sh
node os/linux-pc/install.mjs --target-root EMPTY_DIRECTORY
node os/linux-pc/native.mjs --stage ANOTHER_EMPTY_DIRECTORY
```

The first command needs an extracted portable release. Staged trees are marked
non-installable, contain no live identity, and must never be copied over `/`.
They prove source packaging and filesystem behavior, not boot/driver support.
Backups must include the whole stopped `/var/lib/kidos` plus the ordinary user's
documents, pictures, downloads, native saves/preferences and closed browser
profile. Code rollback alone cannot undo data-schema changes. This remains a
supervised preview until the existing parent-authority and containment gates
also pass.
