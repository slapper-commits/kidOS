# Native games in the disposable Linux VM

This is a supervised demonstration on the existing Debian 13 ARM64 fixture, not a distributable kidOS game image. The installed kidOS release remains pilot.9. The browser preview on port 8917 cannot launch these native applications; use the separate **kidOS disposable Linux test** QEMU window.

## Launch and return

With the guest window focused, **F8** opens **Applications on this computer**. Select **Putt-Putt Saves the Zoo — demo** or **OpenTTD**. Paint, Files and Trash are also present after the later native-files setup. **F9** raises the existing kidOS browser. **F10**, also available as **F8 → Open windows**, opens the compositor's named-window list so an already-open application can be selected. Normal Alt+Tab bindings are retained, but CUA modifier delivery did not verify that shortcut in this run. The compositor retains its normal move, resize and close controls. On keyboards using function keys for media controls, Fn may be needed. QEMU's Ctrl+Alt+G mouse-grab control is unchanged.

The fixed launcher and labwc configuration are recorded in `native-game-launch.sh`, `native-games-rc.xml`, and `native-games-menu.xml`. The launcher accepts only the two fixed game names, verifies the fixture's ordinary user, and prevents duplicate instances with a local lock. It has no HTTP route, shell command argument, service-user authority or browser integration. These controls organize trusted native apps; they do not sandbox them. This sudo-enabled disposable account is unsuitable as a child or gift-device account.

## Installed inputs and provenance

Signed Debian repositories supplied these exact packages on 8 October 2026 (9 October UTC):

| Package | Version | Main license; see installed notice for complete component attribution |
| --- | --- | --- |
| scummvm | 2.9.0+dfsg-1+b1, ARM64 | GPL-2-or-later, component exceptions |
| scummvm-data | 2.9.0+dfsg-1 | Same package copyright inventory |
| openttd | 14.1-1+b2, ARM64 | GPL-2.0, bundled component licenses |
| openttd-data | 14.1-1 | Same package copyright inventory |
| openttd-opengfx | 7.1-3 | GPL-2.0 |
| openttd-opensfx | 1.0.3-3 | Sound collection CC-BY-SA-3.0; supporting files GPL-2-or-later or CDDL-1.1 |
| openttd-openmsx | 0.4.2-2 | GPL-2.0 |
| timgm6mb-soundfont, dependency | 1.3-5 | SoundFont GPL-2; Debian packaging GPL-3-or-later |

Full notices remain at `/usr/share/doc/PACKAGE/copyright` inside the VM and in `work/linux-vm/evidence/demo-games-package-notices.txt`. Their hashes, package versions and excerpts are in `demo-games-install-and-offline.txt` in that evidence directory. APT installed 46 new packages in total and changed no existing package version. Before/after inventories are retained in the guest; `demo-games-audio-boot.txt` verifies the exact map comparison, independent of sort order. No full system upgrade was requested.

The separate Zoo data came from the [official ScummVM demo listing](https://www.scummvm.org/demos/) and its [Windows US demo download](https://downloads.scummvm.org/frs/demos/scumm/he/puttzoo-win-demo-us.zip). Its complete input, extraction and per-file hash record is [native-games-inputs.json](native-games-inputs.json). Only five `ZOODEMO.HE0`–`HE4` data files were transferred; the Windows EXE, W32 component and HLP file were not extracted, transferred or executed. Guest ScummVM detected **scumm:puttzoo — Putt-Putt Saves the Zoo (Demo/Windows/English)**. This is the proprietary demo, not the commercial full game; redistribution permission has not been established. Neither it nor any of these binaries is included in the kidOS source archive or generic image.

The data live at `/opt/kidos-linux-test/game-data/puttzoo`, owned by root and mode 0444. The root-owned launcher is `/opt/kidos-linux-test/native-game-launch.sh`. Ordinary-user configuration and saves live separately under `/home/kidos-test/.local/share/kidos-native-demos/`, with a private mode-0700 root directory:

- ScummVM configuration: `config/scummvm.ini`; demo save directory: `puttzoo-saves/`.
- OpenTTD configuration: `config/openttd/openttd.cfg`; save directory: `data/openttd/save/`, with autosaves beneath it.
- Last-launch diagnostic output: `puttzoo.log` and `openttd.log`, overwritten per launch.

The OpenTTD paths use its documented XDG directory support and a fixed configuration path; see [the 14.1 file-path implementation](https://github.com/OpenTTD/OpenTTD/blob/14.1/src/fileio.cpp). They are defaults, not an OS filesystem restriction. The ScummVM [CLI](https://docs.scummvm.org/en/v2.9.0/advanced_topics/command_line.html) selects an explicit data path, save path and configuration file, with its documented windowed OpenGL renderer at 960×720. No original Transport Tycoon data is needed: OpenGFX, OpenSFX and OpenMSX were detected as usable.

## Reproduce this fixture

Use only the explicit disposable target and SSH identity from the [VM recipe](README.md). Before modifying packages, stop its graphical login and kidOS service, copy the whole data directory and install/runtime receipts into a new private backup, and compare the stopped data exactly. In this run the copy is `/var/lib/kidos-linux-test/before-demo-games.lLnmc7/`; a second stopped comparison after installation also passed.

Temporarily start the existing Debian-only package proxy and reverse SSH tunnel using the VM recipe. Run APT with the existing private source, list and archive directories plus its command-local loopback proxy, then install only:

```sh
apt-get "${apt_options[@]}" update
DEBIAN_FRONTEND=noninteractive apt-get "${apt_options[@]}" install -y --no-install-recommends \
  scummvm openttd openttd-opengfx openttd-opensfx openttd-openmsx
```

Acquire the official demo separately, validate every member and its hashes against the manifest, and transfer only the five data files. Install them root-owned and read-only. Copy the fixed launcher to `/opt/kidos-linux-test/` with mode 0755; create the private ordinary-user save/config directories. Install the XML files as `~/.config/labwc/rc.xml` and `menu.xml` only after preserving any existing configuration. This fixture had neither file; its existing kiosk autostart was retained unchanged. [labwc's menu format](https://manpages.debian.org/trixie/labwc/labwc-menu.5.en.html) and [window actions](https://manpages.debian.org/trixie/labwc/labwc-actions.5.en.html) define the fixed menu and focus behavior.

Stop the temporary proxy and tunnel before interactive acceptance. This run verified the proxy listener and guest forwarding port closed and the guest had no default route. No host network, DNS, firewall, trust store, audio settings, microphone permission or kidOS service restriction changed.

## Optional VM playback

The VM launcher now supports an explicit output-only virtual audio device on macOS. Its default remains no audio device. Shut down through ACPI before changing the launch options:

```sh
node os/linux-test/vm.mjs stop --directory work/linux-vm/instance
node os/linux-test/vm.mjs start --directory work/linux-vm/instance --display cocoa --audio coreaudio
```

This selects QEMU's CoreAudio playback backend with an HDA output codec. The actual restart succeeded; Linux reported one HDA playback PCM and no capture PCM. Ordinary UID 1000 had read/write access through the existing session permissions, without new groups or permission changes. Hardware presence alone does not establish audible output. Physical Raspberry Pi audio remains untested.

The launcher passed `node --check`, rejected an unsupported audio backend before filesystem access, rejected the audio option on `stop`, and the existing Linux-fixture suite passed 8/8. The native game shell script passed shell syntax validation, and both XML files parsed. Independent review covered the fixed commands, input manifest, hash transfer, output-only audio options and release exclusion.

## Acceptance record

The installation, data preservation, offline restart, actual engine detection and virtual playback device checks passed. Logs are `demo-games-backup.txt`, `demo-games-apt-install.txt`, `demo-games-engine-cli.txt`, `demo-games-install-and-offline.txt`, `demo-games-audio-restart.txt` and `demo-games-audio-boot.txt` under `work/linux-vm/evidence/`.

The OpenTTD native window opened through F8. The optional survey was declined, a new world generated, time paused at 13 January 1950, and Save created `demo.sav`. The file is 95,104 bytes, owned by `kidos-test`, mode 0600, SHA-256 `1b80e03cea337b5a6b944697c95087355901bd925a0dae68ed597c915b75b13b`. OpenTTD's read-only save inspector accepted format 334, unmodified, with no NewGRFs. Evidence: `demo-games-openttd-save.txt`. F9 visibly returned to kidOS, and F10's named list successfully brought the existing OpenTTD window forward. A first close attempt had left its confirmation pending; after confirming Yes, the real process and its lock exited and the save hash remained identical.

A fresh F8 launch then loaded `demo.sav` through the game's Load Game dialog. The same landscape returned paused at 13 January 1950 with £100,000; the dialog identified a 256×256 map and no NewGRFs. This verifies a real GUI save, process exit, relaunch and load. Screenshot: `work/verification/native-games-openttd.jpg`. The default Alt+Tab shortcut's modifier delivery was not verified by CUA; the tested F9/F10 controls provide the handoff.

Zoo's OpenGL window rendered the colored entrance scene, car, dog and dashboard. Clicking the path advanced to the Jungle Dock scene with animation intact. F5 opened the ScummVM menu; choosing Save displayed the expected message that this game requires its in-game save interface. Original S and L keys in the scene showed no save/load dialog, and no game save was created. Demo saving remains unverified; the disabled global-menu Save is expected for this HE72 engine, not an installation failure. Screenshot: `work/verification/native-games-zoo.jpg`; process/renderer and save-directory evidence: `demo-games-scummvm-opengl.txt` and `demo-games-zoo-interaction.txt`. No audible-output claim is made without direct listening evidence.

The initial menu displayed but its nested conditional actions did not launch a process. The installed labwc 0.8.3 [menu parser](https://github.com/labwc/labwc/blob/0.8.3/src/menu/menu.c) does not build the conditional branches supported by its [keybinding parser](https://github.com/labwc/labwc/blob/0.8.3/src/config/rcxml.c). Replacing game menu entries with fixed Execute actions reached the actual executables; F9 retains a conditional keybinding. The first ScummVM SurfaceSDL attempt then failed with `SDL_BlitSurface failed: Parameter 'src' is invalid!`, preserved in `demo-games-scummvm-surface-failure.txt`. The documented OpenGL alternate passed the real GUI checks above. Both games opened the playback PCM, but ALSA underruns were observed, including in Zoo after package installation had finished. Playback smoothness and audibility remain unverified.

The current fixture is left running for supervised use. Its private disk, SSH identity, backups and saved creations remain out of distribution. The host browser preview is preserved separately.
