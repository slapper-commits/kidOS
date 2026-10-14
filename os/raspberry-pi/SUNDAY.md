# Sunday 11 October 2026: kidOS on Raspberry Pi 5

Target: Sean's **Raspberry Pi 5, 8 GB**, running **Raspberry Pi OS Trixie 64-bit with Desktop**, with the `0.0.1-pilot.15` kidOS candidate. This is the installation and acceptance plan for supervised use. Actual Pi installation, native launch buttons, audio, input, USB and performance are **pending verification**. The existing Linux VM results do not certify this device. This is a source release installed on normal Pi OS, not a bootable kidOS image or a giftable child-safe appliance.

The corrected candidate's automated suite passed 262/262 on macOS and 253 passed/9 skipped/0 failed on Debian ARM64 with pinned Node v24.21.0. Actual VM Applications buttons opened Paint, OpenTTD, Calculator and Writer; repeat OpenTTD launch focused the existing game. Pilot.12 supersedes pilot.11, correcting its five-versus-nine application-ID mismatch and Wayland browser reopen setting. Remaining folder/demo graphical checks and physical-Pi acceptance are separate; see the [native verification record](../../docs/NATIVE-APPS.md#verification-and-limits).

## Have these ready

- The Pi and an explicitly designated installation microSD card, **at least 32 GB**; additional space is useful for books, videos and backups. Identify the exact card before any flashing. A card reader is needed on the computer running Imager. The [official setup guide](https://www.raspberrypi.com/documentation/computers/getting-started.html#boot-media) recommends at least 32 GB for Pi OS Desktop.
- The **official 27 W USB-C power supply**. Raspberry Pi recommends it for Pi 5; lower-current supplies restrict peripheral power. See the [official power guidance](https://www.raspberrypi.com/documentation/computers/getting-started.html#power-supply).
- A keyboard, mouse, display and **micro-HDMI-to-HDMI** cable. Use the port marked HDMI0 for the first display. Plan audible sound through the display's HDMI audio or a USB audio device. See [Pi display and audio setup](https://www.raspberrypi.com/documentation/computers/getting-started.html#equipment).
- Optional but recommended for sustained desktop use: suitable active cooling, such as the [official Pi 5 Active Cooler](https://www.raspberrypi.com/products/active-cooler/), whose temperature-controlled fan is designed for heavy loads. Choose an enclosure that accommodates the selected cooler.
- A separate, designated backup destination. Keep the install card and the only copy of family work separate.

These hardware references were checked on 9 October 2026. Do not flash, format or repurpose any storage until Sean has identified that exact disposable installation target. No host firewall, DNS, trust store, boot disk or network changes are part of this recipe.

## 1. Prepare normal Raspberry Pi OS

Use official [Raspberry Pi Imager](https://www.raspberrypi.com/software/) after the target card is designated. Select **Raspberry Pi OS (64-bit), Trixie, with Desktop**. Do not choose Lite, Legacy/Bookworm, 32-bit, or the PC/Mac Raspberry Pi Desktop image. The [official download page](https://www.raspberrypi.com/software/operating-systems/) listed the Trixie Desktop image dated 6 October 2026 when checked on 9 October. Record the actual image date and checksum used.

Enroll a normal desktop username **other than `kidos`**. The name `kidos` is reserved for the locked, non-login platform service. Use personal credentials created during setup, and retain Chromium when choosing the desktop's software. Keep normal graphical login; this recipe does not enable automatic login or replace the Pi panel or labwc configuration.

Boot the Pi, complete its normal setup, and check keyboard, mouse, display and sound before installing kidOS. Installation needs access to the official runtime and configured signed Pi OS package repositories. Configure any Pi connectivity through normal Pi setup; there is no need to change the development computer's network settings.

Open a terminal in that ordinary Pi desktop session. Confirm:

```sh
uname -m
cat /etc/os-release
id -un
/usr/bin/chromium --version
```

Expect `aarch64`, Debian 13/Trixie, the enrolled username rather than `root` or `kidos`, and installed Chromium. Stop if these do not match; do not bypass the installer checks.

## 2. Install the pinned runtime and kidOS service

First follow **[Set up the dedicated runtime on the Pi](README.md#set-up-the-dedicated-runtime-on-the-pi)**. It verifies the official Node.js v24.21.0 ARM64 archive before installing `/opt/kidos-node/v24.21.0/`. Keep the checksum and full license notices. Do not substitute the Pi's system Node package or a personal version manager.

Transfer these two files from the trusted build machine into one directory on the Pi:

- `kidos-0.0.1-pilot.15.tar`
- `kidos-0.0.1-pilot.15.tar.sha256`

From that directory, run the following as the ordinary desktop user. Use new extraction and staging directories; the commands intentionally stop if the named extraction directory already exists.

```sh
(
  set -eu
  sha256sum --check --strict kidos-0.0.1-pilot.15.tar.sha256
  mkdir kidos-pilot-15
  tar -xf kidos-0.0.1-pilot.15.tar -C kidos-pilot-15
  cd kidos-pilot-15
  /opt/kidos-node/v24.21.0/bin/node os/raspberry-pi/install.mjs \
    --target-root ../kidos-pilot-15-stage
  sudo /opt/kidos-node/v24.21.0/bin/node os/raspberry-pi/install.mjs \
    --install-on-this-pi
)
```

Only the last command installs the service on the Pi. The guard verifies the target, pinned runtime and release bytes. It creates the separate locked `kidos` account, private `/var/lib/kidos`, versioned source under `/opt/kidos`, and the supervised loopback service. Do not copy the staging directory over the real system. A checksum proves transfer integrity, not the identity of an untrusted sender.

Check:

```sh
sudo systemctl status kidos.service --no-pager
curl --fail http://127.0.0.1:8787/health
```

The service must be active and health must respond. `readyForChildUse: false` is intentional. Open [the local desktop](http://127.0.0.1:8787/) in Chromium to check the browser tools; native apps need the next steps.

## 3. Install the fixed native applications

On the Pi, use the guarded fixed-package installer from the installed release. It checks the Pi target and required desktop before using the Pi's existing signed package repositories. Review the displayed package plan before accepting. No full office-suite metapackage or proprietary game data is required.

```sh
sudo /opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos/current/os/raspberry-pi/native-packages.mjs --install-on-this-pi
```

This supplies Paint, Files/Trash, Writer, Calculator and OpenTTD with open graphics/sound/music assets, plus the Qt/Wayland, icon and window-focus components used by the launchers. Package installation refuses removals; keep Chromium and the normal Pi desktop. Retain the installed package versions and `/usr/share/doc/*/copyright` notices with the installation record. The official repository's package versions may change; this is not a reproducible full OS image.

The Putt-Putt demo is a private VM test input and is not included. Its catalog entry should honestly show it as unavailable on this Pi.

## 4. Enroll the native session and open kidOS

Still in the enrolled user's terminal, install the native bridge with this command. The shell resolves `$(id -un)` to that ordinary user before `sudo` starts the installer:

```sh
sudo /opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos/current/os/native-session/install-pi.mjs \
  --install --desktop-user "$(id -un)"
```

Then prepare that user's folders and preferences **without sudo**:

```sh
/opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos-native-session/native-launch.mjs --setup-user
```

Setup creates missing Documents/Pictures/Downloads and private native app settings. It preserves existing preferences and creations, and refuses unsafe ownership or linked paths instead of silently repairing them. Native files stay in this desktop user's home; service projects and imported Library media stay in `/var/lib/kidos`.

Save work and close any existing kidOS browser window before opening its dedicated profile with the newly installed extension:

```sh
/opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos/current/os/raspberry-pi/kiosk.mjs --launch
```

Despite the script's historical name, the Pi launcher opens a **maximized application window**, retaining the normal Pi panel and desktop controls. Chromium's sandbox remains enabled. Writer, Calculator, Paint and Files open separate native windows; the Pi panel is the way back between them and kidOS. Native installation also provides a **kidOS** entry in the normal Pi application menu. The VM's F8/F9/F10 bindings are not Pi shortcuts. A combined browser/native taskbar is still pending.

Once manual launch works, optional launch after normal login is:

```sh
/opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos/current/os/raspberry-pi/kiosk.mjs --enable-autostart
```

This creates the managed XDG entry `~/.config/autostart/kidos.desktop`; it does not replace labwc configuration or change login settings. Use the same command with `--disable-autostart` to remove only that entry.

## 5. Preserve work before updates or recovery tests

Save and close kidOS's Chromium window and all native applications. Stop the service while copying its complete data directory:

```sh
sudo systemctl stop kidos.service
```

Copy the following to the designated separate, private backup destination, preserving ownership and permissions:

| Source | Includes |
| --- | --- |
| `/var/lib/kidos/` in full | Projects, immutable apps, imported media bytes, scores, local mail and browser-workspace recovery. JSON alone is insufficient. Reading this service-owned directory needs administrator authority. |
| `~/Documents`, `~/Pictures`, `~/Downloads` | Native creations and exports. |
| `~/.local/share/kidos-native` | Native app preferences, Writer profile and OpenTTD saves. |
| `~/.local/share/Trash` if present | Files that can still be restored. |
| `~/.local/share/kidos-browser` with Chromium closed | Dedicated browser preferences and profile. |

A backup of the **entire enrolled user's home**, with applications closed, is preferable: apps opened through the normal Pi menu can use their normal profiles outside `kidos-native`. Include the whole service directory separately. Record any missing optional folder rather than treating it as an empty backup. Keep receipts and the release/runtime archives too. When copying finishes, start the service again:

```sh
sudo systemctl start kidos.service
```

Do not overwrite live state to test a restore. First restore to a separate test destination, compare files and reopen copies; a service-data restore requires a stopped service and an explicitly reviewed compatible-release restore plan. Keeping old source releases alone is not a tested rollback. Backup and restore acceptance on this Pi remains pending.

## One continuous acceptance walkthrough — all pending

Use original test content before relying on this device for family work. Record the Pi model/RAM, power/cooling, storage, OS image/hash, kidOS version, Node/Chromium versions and input/audio devices. For each step record the observed result, not just that the command was issued.

- [ ] Start the Pi and log in normally. Open kidOS; verify the Pi panel remains usable and the local service is healthy.
- [ ] Launch Paint from kidOS. Draw a picture, save a PNG in Pictures, close it, then reopen it from My Stuff → Pictures. Rename and copy a test file; Trash and restore the copy without changing the original.
- [ ] Launch Writer from kidOS. Write and format a short story, insert the saved picture, and save an ODT in Documents. Export a PDF and reopen both through Files or an installed reader. Check the text and picture visually.
- [ ] Launch Calculator from kidOS. Use keyboard and pointer entry, decimals, clear/backspace and an invalid operation; copy a valid answer into the story. A bridge reply alone does not pass a visible launch.
- [ ] Switch between native windows and kidOS using the Pi panel. Close and relaunch one app. Check a missing app gives a clear explanation; Putt-Putt is expected to be unavailable.
- [ ] Play an existing kidOS game and save progress. Open OpenTTD, create/save a test game, exit and reload it. Import a permitted book and representative audio/video into Library; confirm actual audible sound, volume/mute, pause, seek and resumed position.
- [ ] Save everything, disconnect the Pi from the network through its normal controls, restart normally, then reopen the story, picture, saved game and Library item. Verify browser windows/draft recovery separately from native saved files. Check the selected computer/tablet/TV presentation with the actual input devices available.
- [ ] On explicitly designated test removable media, copy a creation out and back, compare the files, and use normal safe eject. Record failures or unsupported workflows; do not test formatting, surprise removal or power loss on the installation card.
- [ ] Make the complete stopped backup above, restore test copies separately, and reopen them. Record service-data restore as pending until that separate restore procedure has actually been exercised.
- [ ] Shut down through the normal Pi desktop controls. Record any blocking friction, missing sound, lost work, launch failures or performance problems before calling the supervised device ready.

No boxes are completed by this guide. Independent child use additionally needs a non-admin child account, separate parent authority and tested execution/network policy; a normally enrolled Pi setup account is still a supervised pilot account. Giftability has further clean-install, update, identity and recovery gates in [GIFTABLE.md](../../docs/GIFTABLE.md).

## If something stops

| Symptom | Next check |
| --- | --- |
| Installer rejects the system | Check Trixie 64-bit Desktop, physical Pi identity, the pinned runtime and an ordinary username other than `kidos`. Preserve the error; do not edit guards or substitute a VM identity. |
| Local service unavailable | Run `sudo systemctl status kidos.service --no-pager` and `sudo journalctl -u kidos.service -n 80 --no-pager`. Do not delete `/var/lib/kidos` to get an empty working desktop. |
| All native apps say they need Linux | Use the installed Pi launcher, its dedicated profile and exact `http://127.0.0.1:8787/` page, in the enrolled graphical session. A regular Chromium tab, another port, Firefox or the Mac preview does not establish the bridge. Save work, close the dedicated browser fully and relaunch after installation; inspect `chrome://extensions` in that profile if discovery still fails. |
| One app is not installed or ready | Check the required packages and run ordinary-user `--setup-user` after successful registration. Applications → Refresh retries discovery. Putt-Putt's unavailability is expected. Do not loosen permissions or run apps as root. |
| Launch reports started but no window appears | Check the Pi panel and application windows. The response only reports process acceptance. Record the failure; browser-button graphical acceptance remains open until the window is seen and used. |
| Native receipt/hash or ownership error | Preserve the error and files. Native registration is checked separately from the service release; after updating kidOS, reinstall the native bridge from the verified current source as above. Do not hand-edit its receipt. |
| No sound or blank icons | Check the Pi's ordinary output/volume selection and actual connected audio device; check the installed Qt Wayland/SVG and Breeze packages. VM audio results do not establish Pi sound. |

The [pilot README](README.md), [native session details](../native-session/README.md) and [minimum lovable roadmap](../../docs/ROADMAP.md) retain the broader implementation and verification boundaries.
