# Asset and dependency provenance

The Node service uses standard-library APIs. The browser now includes pinned local PDF.js and zip.js assets for PDF and EPUB reading; no package installation or CDN request is needed at runtime. Node.js and the browser are supplied by the local machine for a browser preview and installed separately for developer Linux targets. The amd64 USB image bundles its pinned runtime and Debian packages with their installed license notices; matching Debian sources and the frozen build recipe accompany that image. The portable source-only release does not bundle those Linux binaries.

| Material | Origin | Distribution note |
| --- | --- | --- |
| Desktop visual direction | User-approved `design/kid-os-desktop.fragment.html` | Adapted into standalone local application code. The reference remains unchanged and is not executed as the production desktop. |
| Public desktop screenshot | Captured from a fresh local browser preview with empty data and original Explore lessons | Documentation only; no household data or native-app acceptance implied. |
| Desktop icons and starter-project artwork | Original repository SVG/CSS implementation | Local assets; no icon CDN, remote image source, or fetched icon library. |
| Starter HTML/CSS/JavaScript | Original code created for this project | Editable source included in each newly created starter project. |
| Moon Hopper and Tiny Racer | Original kidOS JavaScript/canvas/CSS artwork and game code | All source and art ship locally and are included when copied to Projects; no third-party sprites, sounds, or game framework. |
| Library icons | Original repository SVG implementation | Local line art; no remote covers or metadata service. |
| Library acceptance fixtures | Original synthetic signals, color patterns, and prose from `scripts/generate-library-fixtures.py` | Development only, generated under ignored `work/`. FFmpeg and Pillow are externally supplied test tools, not bundled runtime dependencies. |
| Desktop fonts | Browser/system font stacks | No custom desktop font is loaded. The Linux fixture installs Debian’s `fonts-dejavu-core`; appearance may vary by OS. PDF standard-font assets are listed separately below. |
| Explore websites | Six original lessons, fictional examples, CSS and server templates | All content is local. Institutional fact-check references and original-fiction labels are recorded in [content/private-web/README.md](../content/private-web/README.md); no copied articles, live news, remote images or family identities. |
| Family Mailbox | Original UI and plain-text local data model | Clean installations start empty. Household names, drafts and letters remain in the private data directory and are excluded from releases. |
| PDF.js | `pdfjs-dist` 6.4.299 from the official npm package archive | Locally vendored JavaScript/worker, CMaps and standard-font assets; Apache-2.0 project license plus separate CMap/font notices retained. |
| zip.js | `@zip.js/zip.js` 2.20.0 from the official npm package archive | Locally vendored ZIP reader for bounded EPUB text import; BSD-3-Clause license retained. |
| Reader acceptance fixtures | Original Moon Garden PDF/EPUB and synthetic prior media fixtures | Development-only files under ignored `work/`; they are not family content or shipped books. |

The design reference mentions an external icon-rendering API from its original presentation environment. The working desktop does not depend on that API or bundle its library. No third-party music, books, films, family mail, or other personal media have been bundled. Imported Library files belong only in a household data directory. Native browser decoders supply playback; codec availability varies by browser and eventual Linux distribution.

## Bundled reader dependency record

[The vendor manifest](../apps/desktop/library-vendor/manifest.json) records exact package versions, source archive URLs, SHA-512 package integrity and SHA-256/size for every vendored asset. Reader tests verify those local hashes. The source archives are `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz` and `https://registry.npmjs.org/@zip.js/zip.js/-/zip.js-2.20.0.tgz`; these are acquisition references, not runtime requests.

Required notices remain at:

- [PDF.js Apache-2.0 license](../apps/desktop/library-vendor/pdfjs/LICENSE)
- [CMap license](../apps/desktop/library-vendor/pdfjs/cmaps/LICENSE)
- [Foxit/PDFium standard-font license](../apps/desktop/library-vendor/pdfjs/standard_fonts/LICENSE_FOXIT)
- [Liberation standard-font license](../apps/desktop/library-vendor/pdfjs/standard_fonts/LICENSE_LIBERATION), including its GPL v2 exceptions and physical-product terms
- [zip.js BSD-3-Clause license](../apps/desktop/library-vendor/zipjs/LICENSE)

The standard-font files are part of PDF rendering, not a replacement for the desktop system-font stack. Preserve their specific notices and include their distribution terms in the image/license review; the PDF.js project license does not replace them.

The USB distribution also retains matching editable sources for PDF.js's
Liberation Sans **1.07.4** fonts. The upstream archive is preserved from the
[official Debian mirror](https://deb.debian.org/debian/pool/main/f/fonts-liberation/fonts-liberation_1.07.4.orig.tar.gz):
2,937,949 bytes, SHA-256
`ad98b7498dc2992f7f0868f79b65ce4a720a3acdb63ab3f1f1cb6881117a5406`.
It includes the SFD sources, FontForge build scripts and original license texts.
The USB delivery’s `SOURCES/font-source/` directory records the version/name and notice
comparisons, acquisition metadata and checksums. Keep that supplement available
with the image and its Debian sources/build recipe; newer Liberation packages
are not a substitute for this version. No font rebuild or byte-identical output
is claimed. The supplement does not change the frozen ISO.

Original kidOS code, artwork and documentation use the root MIT license. Vendored dependencies retain the separate licenses listed here; the MIT license does not replace them. Before distributing an image, audit every bundled package, include the required notices and source offers where applicable, and record permissions for every piece of educational or media content. This provenance record is not a completed distribution license review.

## Linux VM development inputs — 2026-10-08

The full checkout’s [VM recipe](../os/linux-test/README.md) records exact download URLs and hashes in [vm-inputs.json](../os/linux-test/vm-inputs.json) (both VM files are excluded from the Pi archive) and the [Node runtime pin](../os/raspberry-pi/runtime-pin.mjs). The guest uses the official Debian 13 generic ARM64 image `20261001-2618`, with SHA-512 checked before creating its disposable overlay, and the official Node.js v24.21.0 Linux ARM64 archive, SHA-256 checked on the host and again on a private root-owned guest copy before extraction. The complete Node distribution and its `LICENSE` are retained at `/opt/kidos-node/v24.21.0`; a protected receipt also records the installed executable hash. See the [official Node license](https://github.com/nodejs/node/blob/v24.21.0/LICENSE).

QEMU 11.1.1 and its dependencies were installed on the Apple Silicon host through Homebrew for this fixture; pcre2 and glib were also updated. Firmware comes from that QEMU installation. These are host development prerequisites, not kidOS application dependencies. Host firewall, DNS, trust store, network and boot configuration were not changed.

Guest Debian packages were fetched through a temporary official-domain GET/HEAD proxy and authenticated using the existing Debian archive keyring. The package channel was removed for offline checks. Recorded packages include kernel `6.12.111-1`, Chromium/`chromium-sandbox` `154.0.8037.92-1~deb13u1`, labwc `0.8.3-1`, D-Bus/PAM/logind, Mesa, DejaVu fonts, seatd, Xwayland, grim and Wayland utilities. These are signed distribution packages rather than source-vendored components. Their exact installed versions are retained in local `work/linux-vm/evidence/packages-and-isolation.txt`, and their license notices remain under the guest’s `/usr/share/doc`. Current signed APT repositories make this a recorded test environment, not a bit-for-bit reproducible full image.

The VM harness generates its own clearly synthetic HTML/CSS/JavaScript, text-book prose and PCM WAV tone. It does not import family content or execute app JavaScript in Node. The overlay, SSH private key, cloud-init seed, root-only VM marker, runtime state and browser profile are private test artifacts under ignored `work/` or inside the guest; they must not enter the Pi source archive or a distributable household image. The VM’s passwordless-sudo test account and automatic login are explicitly developer-only. No physical Pi, audio-output or redistribution certification follows from this provenance record.

## Original application candidates — historical proposal, 2026-10-08

These were uninstalled research candidates when the proposal was recorded. Later supervised VM work installed Paint/Files, OpenTTD with open base assets and the ScummVM Zoo demo; see the [native games](../os/linux-test/NATIVE-GAMES.md) and [native tools](../os/linux-test/NATIVE-FILES.md) records for exact installed packages and notices. None is bundled in the Pi source archive or verified on physical Pi hardware. Demo availability does not establish redistribution permission.

| Candidate | Purpose and upstream license notes |
| --- | --- |
| [KolourPaint](https://apps.kde.org/kolourpaint/) | Familiar Paint application. [Upstream source](https://github.com/KDE/kolourpaint) carries mixed BSD-2-Clause, LGPL-2.0-or-later and GFDL documentation terms; retain per-file notices. |
| [Simon Tatham’s puzzles](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/index.html) | Mines and other small logic games; MIT license. |
| [Aisleriot](https://github.com/GNOME/aisleriot/blob/master/COPYING.README) | Solitaire; aggregate GPL-3.0-or-later, some LGPL-3.0-or-later code and GFDL-1.1-or-later documentation. Audit card artwork separately. |
| [Emilia Pinball](https://github.com/adoptware/pinball/blob/master/pinball.appdata.xml) | Open pinball candidate; GPL-2.0-or-later. Verify the selected source/table/audio notices. |
| [GCompris](https://github.com/KDE/gcompris) | Educational activities; aggregate AGPLv3 because of an included activity library, with internal code GPLv3+. Preserve individual media notices. |
| [Scratch editor](https://github.com/scratchfoundation/scratch-editor) | Visual programming; current editor repository is AGPL-3.0. Its TRADEMARK policy and media licenses are separate; offline packaging remains unevaluated. |
| [ScummVM licensing](https://github.com/scummvm/scummvm/blob/master/COPYING) + [Putt-Putt Zoo demo](https://www.scummvm.org/demos/) | First proposed game experiment. Engine licensing excludes Humongous game data. Official demo availability does not establish redistribution permission; full games require an authorized copy. |
| [OpenTTD and open base sets](https://www.openttd.org/content-creators) | Second proposed experiment. OpenTTD/OpenGFX/OpenMSX are GPLv2; OpenSFX is CC BY-SA 3.0. These sets avoid requiring original Transport Tycoon assets. |

Later candidates include [SuperTux](https://github.com/SuperTux/supertux) and a selected [Luanti](https://docs.luanti.org/about/luanti/) game/world. Review engine, game, mod and media licenses separately. [Space Cadet’s source port](https://github.com/k4zmu2a/SpaceCadetPinball) excludes the original Microsoft-distributed game resources; none are supplied here.

Actual Age of Empires/Mythology remains an optional experiment with licensed assets: [Box64/Wine](https://github.com/ptitSeb/box64) adds ARM translation and compatibility limits. [openage](https://github.com/SFTtech/openage) currently reports nonfunctional gameplay and is not an Age of Mythology solution.

Before inclusion, pin versions/hashes, retain required source/notices/attributions, establish asset permissions, and verify offline launch, saves, windows, audio and controls on Linux and physical Pi. Redistribution and hardware acceptance remain open.

## Writer and Calculator VM inputs — 2026-10-09

The supervised Debian ARM64 fixture installed `libreoffice-writer` and `libreoffice-qt6` 4:25.2.3-2+deb13u8 and `kcalc` 4:25.04.0-1 through the temporary signed Debian package channel. LibreOffice's main code is MPL-2.0 with separate component/icon/documentation licenses; KCalc has GPL/LGPL component notices. Complete installed notices, SHA-256 hashes and versions are retained in `work/linux-vm/evidence/writer-calculator-package-notices.txt` and `writer-calculator-package-verification.txt`. The transaction added 63 packages without upgrading or removing prior packages; its full package inventory is in `writer-calculator-preservation.json`. The [native-tools record](../os/linux-test/NATIVE-FILES.md#writer-and-calculator-milestone--2026-10-09) distinguishes launch/arithmetic evidence from pending document-workflow acceptance. Applications, private profiles, VM identities and creations remain outside the distributable source archive.

## Native appearance assets — 2026-10-09

The native-session theme directory contains original kidOS Qt stylesheets, palette/default configuration, labwc colors, Paint SVG controls/app icon and Write toolbar image strips. No game graphics or third-party app binaries are embedded. Installed KolourPaint, KCalc, PCManFM-Qt, LibreOffice and labwc retain their package licenses; LibreOffice credits/legal information remain available under the Write product label. Default LibreOffice formatting icons and native file icons continue to come from the installed upstream packages. See theme/PAINT.md, WRITER.md, CALCULATOR.md and FILES.md for upstream configuration sources.

## Native classics VM inputs — 2026-10-09

The supervised Debian 13 ARM64 fixture installed `kpat` and `kmines` `4:25.04.0-1`, plus `pinball` and `pinball-data` `0.3.20230219-3`. The signed Debian transaction added 24 packages and changed no existing package versions. Its temporary restricted package channel was removed afterward; the VM retained no default route. Complete selected package notices, notice/binary hashes and the dependency inventory are recorded locally in `work/linux-vm/evidence/native-classics-package-verification.json`.

KPat/KMines primarily use GPL-2.0-or-later with separate documentation, translation and component notices. KDE card decks have distinct GPL/LGPL/permissive licenses, recorded in the installed `kdegames-card-data` notice. The selected Debian Pinball/Pinball-data notices identify their main source/assets as GPL-2.0 and metadata as CC0-1.0. The packaged Tux/Professor tables use no Microsoft Space Cadet resources. These distribution packages and their assets are not vendored into the kidOS source archive; future image distribution must preserve notices and satisfy the applicable source obligations. Exact package paths, controls, evidence and hardware/visual acceptance limits are in [NATIVE-CLASSICS.md](NATIVE-CLASSICS.md).

## Puzzle Box VM inputs — 2026-10-10

The approved native puzzle collection uses Debian ARM64 `sgt-puzzles` `20230410.71cf891-2+b2`: 40 GTK3 games from Simon Tatham's Portable Puzzle Collection, with matching local icons and instructions. Debian's complete installed copyright notice identifies the collection and packaging under Expat/MIT terms. Preserve the authors' copyright and permission notice when distributing its software/assets. The package has no combined launcher; kidOS's separately authored Puzzle Box chooser uses installed games rather than embedding their binaries or artwork into the source archive.

The chooser's system bindings are `python3-gi` `3.50.0-4+b1` and `gir1.2-gtk-3.0` `3.24.49-3`, using the fixture's existing Python `3.13.5-1` and GTK3 `3.24.49-3`. PyGObject's primary license is LGPL-2.1-or-later with additional Expat files; GTK's full mixed component notices remain separate. Complete selected package notices, notice hashes, all 40 puzzle executable hashes/dependencies, and the exact 13-package transaction are retained in `work/linux-vm/evidence/puzzle-box-package-verification.json`. The signed transaction changed no previous package versions or saved data; the temporary package channel was removed after use. The [Puzzle Box package record](NATIVE-CLASSICS.md#puzzle-box-package-preparation--2026-10-10) distinguishes installation/import evidence from pending graphical and physical-Pi acceptance. This does not complete the image-wide license audit.
