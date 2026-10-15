# kidOS live USB

This recipe builds a Debian 13 amd64 hybrid ISO for Intel MacBooks and Intel/AMD
PCs. It provides a temporary **Try kidOS** session and a separate, optional
**Install kidOS…** action using Debian's Calamares installer. It is an
experimental supervised preview. Emulated software acceptance and physical
hardware qualification are recorded separately. A prepared recipe or green
source test does not establish that the ISO boots.

## Intended steps for friends

1. Get the USB download components, matching checksums and source components
   from the [pilot.20 release](https://github.com/slapper-commits/kidOS/releases/tag/v0.0.1-pilot.20).
   Follow the [USB guide](../../docs/USB-TRY.md) to reconstruct and verify the
   complete ISO before flashing; individual parts are not bootable images.
   The source checkout does not contain the ISO. Use a disposable USB stick,
   preferably 16 GB or larger. Writing the image erases that USB stick; select
   it carefully in the image-writing tool. No automatic flasher is supplied here.
2. Restart with the USB connected and choose it in the computer's one-time boot
   menu. On an Intel Mac, hold Option at startup. This pilot targets Intel Macs
   without T2 and 64-bit Intel/AMD PCs; newer Apple Silicon/ARM machines are a
   separate track.
3. Choose **Try kidOS**. Test the screen, keyboard, pointer, Wi-Fi and sound, then
   write, draw or play. The default trial uses RAM. Export anything to keep and
   copy native documents/pictures to a removable USB stick before shutdown.
4. To finish trying, shut down, remove the USB and boot normally. The existing
   OS is intended to remain untouched. The corrected image passed an isolated
   Try/Cancel full-drive comparison; real hardware remains unqualified.
5. If you choose a permanent installation, back up the computer first and open
   **Install kidOS…** from the welcome window or the Linux application menu.
   Review the exact target drive, proposed partition changes and final Install
   confirmation. Installation can replace the existing OS and files. Automatic
   dual boot, moving trial work into the installed system and undoing a finished
   installation are not supplied by kidOS; keep recovery media and backups.

A 3.4 GB development ISO has been built and statically audited. Its base system
payload completed BIOS and UEFI native Write save/reopen after normal browser
reload and launch retry. Drive testing then caught an early-boot issue: the original
image's media search temporarily mounted an internal test partition. Read-only
filesystem mounts can still replay journals, so that behavior was unsafe.
That base image must not be distributed for use on real computers. The recipe
now restricts discovery to removable USB media. The corrected image is built and
both BIOS/UEFI reach kidOS after a normal browser reload. Its attached-drive
Try/Cancel test showed no internal mount or swap and passed a full logical 32 GiB
comparison after clean shutdown. The baseline and target hashes were unchanged.
Offline Calamares installation and two installed UEFI boots without the live
medium passed chosen-password login, fresh identity/enrollment, locked service/root
accounts and document persistence. Boot one saved/closed/reopened in kidOS Write;
boot two retained the exact bytes and text, reopened through Dolphin and ordinary
LibreOffice after two kidOS Write shortcut timeouts. The first page needed Ctrl+R.
These are documented workarounds, not automatic-launch reliability certification.
The [pilot.20 release](https://github.com/slapper-commits/kidOS/releases/tag/v0.0.1-pilot.20)
provides that tested ISO as download components, with matching source materials.
Its embedded runtime remains the frozen `0.0.1-pilot.19-ea56e10ebac7` source;
the separate `kidos-0.0.1-pilot.20.tar` is the current portable source bundle,
not a rebuilt USB image. Physical hardware qualification is separate.
See the [USB guide and Documents fallback](../../docs/USB-TRY.md),
[verification scope](../../docs/USB-VERIFICATION.md) and dated
[build record](../../docs/ROADMAP.md).

## Trial behavior

The default live boot uses a read-only SquashFS plus a RAM overlay. Persistence,
automatic GPT discovery/swap and resume are disabled in the live boot arguments.
`live-media=removable-usb` restricts early media discovery to USB devices reported
as removable and fails without scanning internal drives if none is usable. A
specific device or label alone would fall back to unrestricted discovery in the
reviewed live-boot version. Boot from an ordinary removable USB flash stick;
external SSDs/enclosures and sticks reported as fixed are outside this boot path.
Other removable USB storage can still be probed during startup; disconnect it
and remove SD/memory cards in USB readers until the trial desktop is ready.
See the [Debian live-boot manual](https://manpages.debian.org/trixie/live-boot-doc/live-boot.7.en.html).
KDE automatic mounting is disabled; the temporary `kidos-live` account is denied
UDisks operations on drives not reported removable. The graphical installer runs
separately as root only after an explicit choice. These defaults are intended to
avoid automatic writes to an internal drive. The corrected synthetic-drive
Try/Cancel preservation test passed; physical hardware remains unqualified.
These defaults do not restrict an adult using administrative commands. This
remains a supervised preview.

The native welcome dialog defaults to Try. It says that trial files disappear
at shutdown. Export projects and copy native creations to a removable USB stick
before leaving. External USB SSDs reported nonremovable are not enabled for the
trial save path. Automatic persistent storage and transfer of live-session data
to an installation are deliberately absent in this first image.

Calamares extracts the original read-only SquashFS, so current trial browser
profiles, projects, native saves, service data and enrollment are not copied.
Its normal drive selection, proposed-change summary and final install
confirmation remain intact. Service/live usernames are reserved, installed homes
are private and installed automatic login is disabled. The normal installed
account/password is chosen by the adult in Calamares. Closing the installer
before the final confirmation returns to the trial.

The image contains no desktop account, service data, native enrollment, family
content, machine ID, random seed or SSH host keys. An actual first boot creates
the service identity and enrolls the live or installed ordinary desktop user.
The temporary live password is locked; no shared password is shipped. No cloud
account or online setup is required to use the bundled apps and local lessons.

## Prepare a build without touching a drive

Use a full reviewed checkout, Node 22+, and the official pinned Node Linux x64
archive described in [PC setup](../linux-pc/README.md). From the checkout:

```sh
node os/live-usb/prepare.mjs --version 0.0.1-pilot.19 --node-archive /absolute/path/node-v24.21.0-linux-x64.tar.xz --output-dir work/usb-recipe
```

The preparation step checks the archive's reviewed SHA-256 and copies the
portable source allowlist, fixed USB runtime files and two build-only boot-menu
helpers into a new empty directory. It never downloads, mounts, builds or flashes
anything. BUILD.json records the source digest, runtime pin and helper byte hashes
without household or developer identities. The helpers are public source in the
full checkout, separate from the portable runtime allowlist.

Build inside a **separate disposable Debian 13 amd64 QEMU/KVM VM**, with no
shared host folders, physical disks or USB passthrough. Install signed Debian
`live-build`, `debootstrap`, `squashfs-tools`, `xorriso`, `isolinux`, `syslinux-common`,
`grub-pc-bin`, `grub-efi-amd64-bin`, `mtools`, `dosfstools` and `python3`. The
reviewed live-build version is `1:20250505+deb13u1`. Give that disposable guest a
root-owned mode-0600 `/etc/kidos-live-usb-builder.json` containing exactly:

```json
{"format":1,"disposable":true,"purpose":"kidOS live USB builder"}
```

Transfer only the prepared recipe to that guest. Extract it as root with
`tar --no-same-owner` so host UID/GID metadata cannot become image ownership;
omit macOS xattrs/AppleDouble metadata when creating the transfer archive. All
`config/includes.chroot` files/directories must be ordinary and root-owned.
In its recipe directory run `sudo ./build.sh`. The script requires the guest marker, QEMU/KVM, Debian 13
amd64, root and a running systemd. It refuses macOS and ordinary unmarked hosts.
The build uses existing signed Debian repositories and includes the standard
Debian installer media pool needed by offline Calamares bootloader installation.
It builds BIOS and UEFI media and requires signed UEFI packages rather than
silently dropping Secure Boot support. Firmware packages keep their upstream
licenses; inclusion does not guarantee a particular Wi-Fi/GPU model works.
The binary hook checks the reviewed live-build menu templates, removes their
stock `findiso` overrides and separate Debian installer entries, and requires
the removable-USB restriction on every live entry. Unknown templates fail the
build. This runs after boot-menu generation and before live-build computes its
checksums; optional installation uses the kidOS welcome window and Calamares.
This first image uses Debian-packaged firmware from main, non-free and
non-free-firmware. It excludes contrib firmware installers which fetch external
blobs during setup. Broadcom b43/b43legacy Wi-Fi therefore needs separate hardware
qualification; keep a supported Ethernet/USB adapter available for that hardware.

Private builder HTTP-proxy settings may be passed through live-build's normal
configuration/environment inside the disposable guest. They must not be copied
into an image or published as a household configuration. No builder image,
cloud-init, SSH key, guest marker or network configuration is an input to the
live image. Build from clean Debian packages and the prepared source only.

## Artifacts, source and verification

Retain the ISO, adjacent checksums, live-build package manifests, corresponding
source-package tar output and `/usr/share/kidos-usb/installed-packages.tsv`.
`--source true --source-images tar` preserves a source-distribution path; it does
not replace reviewing every binary package's license/source obligations before
public distribution. Package copyright files and Node's LICENSE remain in the
image. The fixed recipe/source output is reproducible; a byte-identical ISO is
not yet claimed because repository versions and full image rebuilds need locking
and comparison.

Software acceptance for an experimental USB preview:

1. Boot BIOS and UEFI from the ISO with no writable disk attached. Confirm Try,
   the real Wayland desktop/native apps and offline local use.
2. Attach an explicitly synthetic target drive with known sentinel bytes. Try
   kidOS, save something, restart and verify the target's bytes did not change.
   Check that no internal swap, persistent overlay or automatic mount was used.
3. Open and cancel installation; prove the target unchanged again.
4. On that designated disposable target only, complete Calamares, remove the ISO
   and boot the installed system. Verify fresh identity/password, empty service
   data and no live trial files, plus native save/reopen and offline restart.

Physical qualification remains separate: test representative 2012-era Intel
MacBook and basic PC hardware, including display, Wi-Fi, sound, keyboard/trackpad,
suspend, USB copy/eject and backup, before declaring those models supported.
An experimental preview must state its emulated test scope and unqualified
hardware limits; it does not complete the hardware or friends-pilot gates.

The current image/build/boot evidence belongs in [ROADMAP.md](../../docs/ROADMAP.md).
Physical USB writing and disk installation always require an expressly selected
disposable target; this repository provides no automatic flash or erase command.
