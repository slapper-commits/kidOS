# Native classic games

The first classics set uses mature Linux games installed from signed Debian packages. kidOS provides discoverable launchers and window integration; each game retains its original gameplay, settings and credits. These are native applications with the current desktop user's authority, not sandboxed child code.

## Package set — 2026-10-09

| kidOS name | Debian 13 ARM64 package verified in the VM | Executable and installed content |
| --- | --- | --- |
| Solitaire | `kpat` `4:25.04.0-1` | `/usr/games/kpat`; KPat's solitaire collection, including Klondike, Spider and FreeCell. |
| Minesweeper | `kmines` `4:25.04.0-1` | `/usr/games/kmines`; KMines. |
| Pinball | `pinball` and `pinball-data` `0.3.20230219-3` | `/usr/games/pinball`; Emilia Pinball with the packaged Tux and Professor tables. |

Official references: [KPat](https://apps.kde.org/kpat/), [KMines](https://apps.kde.org/kmines/), and Debian's [KPat](https://packages.debian.org/trixie/kpat), [KMines](https://packages.debian.org/trixie/kmines) and [Pinball](https://packages.debian.org/trixie/pinball) packages. This set requires no commercial game data, account or runtime download. Sean approved the Puzzle Box expansion on 2026-10-10; its package preparation is recorded below.

The guarded Pi package installer requests these packages from the device's signed distribution repositories. The versions above describe the recorded fixture, not an immutable Pi image. The source archive contains integration code and original kidOS artwork, not the Debian binaries, card decks, tables or private profiles.

## Launch and controls

Solitaire and Minesweeper use the fixed Qt Fusion style and kidOS's private native configuration directory. Pinball uses SDL2 with the Wayland video driver. Its installed binary links SDL2, SDL2_image, SDL2_mixer and OpenGL. No arbitrary executable, arguments, URL or environment value comes from the browser launch request. Both table files must exist before Pinball is advertised as available:

- `/usr/share/games/pinball/tux/pinball.pbl`
- `/usr/share/games/pinball/professor/pinball.pbl`

Solitaire supports dragging cards, Hint and Undo; choose Klondike for the familiar single-deck game. Minesweeper uses left-click to uncover and right-click to flag. Pinball's installed README and manual document left/right Shift for flippers, Enter to launch the ball, Escape for the menu and R to reset; Control and Space nudge the table. These documented bindings still need gameplay acceptance on the target hardware. Touch-only and controller navigation are not certified.

## Provisioning evidence and limits

The disposable ARM64 VM installation added 24 packages, with zero upgrades or removals. Signed package indexes were refreshed through the existing GET/HEAD-only Debian proxy; the install used exact versions for the three requested games, no recommended packages, and disabled automatic service restarts. All previously installed package versions were verified unchanged; `dpkg --audit` was empty. The kidOS service PID and start timestamp were unchanged by provisioning.

A verified live point-in-time backup preserved the private data directory, install receipts, Documents, Pictures, Downloads, native profiles and labwc preferences before installation. Concurrent visual checks legitimately changed Files' recent/settings files and application logs; creations, application data and receipts compared unchanged. This was not a stopped-service backup or a factory-reset drill.

The temporary proxy and SSH forwarding process were stopped after installation. Their host and guest listening ports were verified closed; the VM still had no IPv4 or IPv6 default route. No host network, DNS, firewall, trust, boot or display configuration was changed.

Local evidence remains under ignored `work/linux-vm/evidence/`: `native-classics-backup.txt`, `native-classics-package-plan-refreshed.txt`, `native-classics-apt-update.txt`, `native-classics-apt-install.txt`, `native-classics-package-verification.json`, and `native-classics-controls-and-cleanup.json`. The verification includes the exact added-package inventory, binary hashes, installed dependency resolution, complete selected copyright notices and their hashes.

Package presence and dependency checks passed. Actual kidOS launch, keyboard/mouse play, close/reopen, score/preferences persistence, audio and Pinball graphics performance require Linux visual acceptance; physical Raspberry Pi behavior remains unverified. A successful spawn alone is not gameplay acceptance. Retain this distinction when updating the milestone.

## Licenses and assets

KPat and KMines are primarily GPL-2.0-or-later, with additional documentation, translation, metadata and component notices. `kdegames-card-data` includes decks with distinct GPL, LGPL and permissive terms; the standard deck is GPL-2.0-or-later. Preserve the complete installed card-data notice rather than assigning every deck the game's license. Debian's installed Pinball and Pinball-data copyright notices identify the main source/assets as GPL-2.0 and app metadata as CC0-1.0.

The complete notices remain in `/usr/share/doc/{kpat,kmines,kdegames-card-data,libkdegames6-6,pinball,pinball-data}/copyright`. Debian source references: [KPat](https://metadata.ftp-master.debian.org/changelogs/main/k/kpat/kpat_25.04.0-1_copyright), [KMines](https://metadata.ftp-master.debian.org/changelogs/main/k/kmines/kmines_25.04.0-1_copyright), [libkdegames/card decks](https://metadata.ftp-master.debian.org/changelogs/main/libk/libkdegames/libkdegames_25.04.0-1_copyright), and [Pinball](https://metadata.ftp-master.debian.org/changelogs/main/p/pinball/pinball_0.3.20230219-3_copyright). An image that redistributes these binaries/assets must retain their notices and satisfy applicable source-distribution obligations. The full image license audit remains open; see [PROVENANCE.md](PROVENANCE.md).

## Puzzle Box package preparation — 2026-10-10

The approved expansion uses [Simon Tatham's Portable Puzzle Collection](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/) through Debian's [sgt-puzzles package](https://packages.debian.org/trixie/sgt-puzzles). The actual ARM64 fixture now has `sgt-puzzles` `20230410.71cf891-2+b2`. Debian supplies 40 separate native GTK3 games, matching desktop entries, local instructions and icons; it does not supply a combined collection launcher. The kidOS Puzzle Box chooser is a separate integration using these mature games, not a replacement game engine.

The installed executables are `/usr/games/sgt-` followed by one of these exact suffixes:

```text
blackbox bridges cube dominosa fifteen filling flip flood galaxies guess
inertia keen lightup loopy magnets map mines mosaic net netslide palisade
pattern pearl pegs range rect samegame signpost singles sixteen slant solo
tents towers tracks twiddle undead unequal unruly untangle
```

`rect` is Rectangles, `samegame` is Same Game, and `lightup` is Light Up. Every executable was checked as an ordinary protected root-owned file, hashed, and inspected for resolved native library dependencies. Packaged instructions are local under `/usr/share/sgt-puzzles/help/en/`; no downloaded puzzle packs or commercial media are needed. The package's complete source, generated game artwork and documentation notice uses the Expat/MIT license and remains at `/usr/share/doc/sgt-puzzles/copyright`.

For the native chooser, the fixture also installed `python3-gi` `3.50.0-4+b1` and `gir1.2-gtk-3.0` `3.24.49-3`. Its existing Python is `3.13.5-1`, and GTK3 is `3.24.49-3`. The protected ordinary interpreter is `/usr/bin/python3.13`; `/usr/bin/python3` is a symlink. A read-only `/usr/bin/python3.13 -I` import confirmed the system `gi` module and Gtk 3.24.49 without opening a window. Availability anchors are `/usr/lib/python3/dist-packages/gi/__init__.py` and `/usr/lib/aarch64-linux-gnu/girepository-1.0/Gtk-3.0.typelib`. PyGObject primarily uses LGPL-2.1-or-later; GTK has LGPL and separate component/media terms retained in its full package notice.

Provisioning added 13 packages, upgraded or removed none, and left all previous installed versions unchanged. A byte-verified live backup preceded installation. The nine backed-up data/profile/receipt/creation/configuration sources compared unchanged afterward, as did the running kidOS service PID and start timestamp; `dpkg --audit` was empty. The guest clock had fallen behind during host sleep, causing Debian's fresh signatures to be correctly rejected as not yet valid. Only the disposable guest clock was corrected to verified current UTC, after which the normal signature checks passed. No signature bypass, host clock change, default route or upstream DNS was introduced. The temporary proxy and tunnel were removed and their listening ports verified closed.

Evidence is retained under ignored `work/linux-vm/evidence/`: `puzzle-box-backup.txt`, `puzzle-box-clock-correction.txt`, `puzzle-box-apt-update-corrected.txt`, `puzzle-box-package-plan-refreshed.txt`, `puzzle-box-apt-install.txt`, `puzzle-box-package-verification.json`, `puzzle-box-gtk-bindings.txt`, and `puzzle-box-offline-cleanup.json`. The package verification contains the exact 13-package inventory, all 40 executable hashes/dependencies, selected complete copyright notices and hashes, and preservation checks. The GTK import emitted a nonfatal warning that this fixture lacks the accessibility bus service; it does not establish accessibility support. Package readiness does not certify the chooser UI, gameplay, save/reopen or physical Pi behavior; those remain separate acceptance checks.
