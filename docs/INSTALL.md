# Install or try kidOS

kidOS is a local-first Linux desktop with no cloud-account requirement. Choose
the route that fits your computer. These are supervised developer previews;
physical hardware qualification and finished child/parent controls are pending.

| What you want | Choose this | What is available |
| --- | --- | --- |
| Try kidOS without installing it | [USB preview](USB-TRY.md) | Bundled Linux, kidOS and native apps. Trial files live in RAM; shutting down and removing the USB returns to the existing OS. |
| Turn a spare Intel MacBook or PC into a kidOS computer | [Optional installation from that USB](USB-TRY.md#optional-installation) | Separate graphical installer with explicit drive selection. Installation can replace the selected drive's OS and files. |
| Add kidOS to an existing Debian computer | [Debian 13 amd64 developer guide](../os/linux-pc/README.md) | Guarded service installer, native-app setup and optional launch after normal login. Linux must already be installed. |
| Use a Raspberry Pi | [Pi developer guide](../os/raspberry-pi/README.md) | Raspberry Pi 5 / 8 GB target, Raspberry Pi OS Trixie 64-bit Desktop. Source installation; no Pi image. Physical acceptance is pending. |
| Keep using macOS, Windows or another Linux desktop | [Source browser preview](#source-browser-preview) | Local browser desktop and service. Native Linux apps are unavailable in this route. |
| Work on Linux integration in an isolated VM | [Debian ARM64 VM fixture](../os/linux-test/README.md) | Developer recipe for QEMU on Apple Silicon macOS; not a family appliance or Pi hardware qualification. |

Get the portable source bundle and USB download components from the
[pilot.20 release page](https://github.com/slapper-commits/kidOS/releases/tag/v0.0.1-pilot.20).
The portable `kidos-0.0.1-pilot.20.tar` includes the guarded Pi and PC installers
and `RELEASE.json`. It does not include Linux, Node.js or native application
binaries. GitHub's automatic source ZIP/tar downloads contain the full checkout
and are not interchangeable with that portable installer bundle.

## USB computer target

Start with Intel MacBooks from 2012–2017 without Apple's T2 chip, or ordinary
64-bit Intel/AMD PCs. Start with 4 GB RAM; 8 GB is preferable. Use an ordinary
removable USB stick, preferably 16 GB or larger. These are provisional targets,
not measured minimums or a promise that every model works. Apple Silicon Macs,
T2 Macs, ARM Windows devices and 32-bit PCs are outside this preview.

The corrected USB image passed emulated BIOS/UEFI boot, Try/Cancel drive
preservation, offline installation and document persistence across two installed
boots. Real Mac/PC graphics, input, Wi-Fi, sound, suspend, USB behavior and Secure
Boot remain unqualified. The first page needed Ctrl+R in tests; native-app
requests also timed out. Read the [guide and tested fallback](USB-TRY.md) and
[verification scope](USB-VERIFICATION.md) before trying it.

The trial stores files/settings in RAM and does not automatically retain them
on its boot USB. Export or copy creations to separate removable storage before
shutting down. Optional installation uses a clean system; it does not transfer
trial data. There is no automatic dual boot or undo for a completed installation.

## Source browser preview

On a compatible macOS, Windows or Linux host, install Node.js 22 or 24 and use a
modern browser. An old MacBook's ability to boot Linux does not establish support
for current Node/browser versions on its original macOS.

```sh
git clone https://github.com/slapper-commits/kidOS.git
cd kidOS
npm test
npm start
```

Open **http://127.0.0.1:8787**. No npm dependency download or cloud account is
required. Stop the service with Ctrl+C. Development services bind to loopback;
native Linux apps need the separate Linux installation/session setup.

Local projects, media, letters and workspace state default to `.data/` beside
the source. Keep that directory when changing source versions and stop the
service before backing it up. See [storage and recovery](ARCHITECTURE.md#storage-and-recovery).

## Planned existing-OS applications

A packaged macOS/Windows edition is a later track. There is currently no kidOS
`.dmg`, `.exe` or `.msi`, and no verified native-app integration for those hosts.
The source browser preview above is the current way to keep those operating
systems. Updates are manual and optional; a signed device updater, complete
recovery and [giftable-device acceptance](GIFTABLE.md) remain pending.
