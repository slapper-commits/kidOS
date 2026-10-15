# Build milestones

## Experimental USB delivery — 2026-10-15

The corrected 3,392,798,720-byte ISO is prepared locally with its guide, checksums,
matching Debian package sources, frozen ea56 recipe, boot-policy and font sources.
It has not been uploaded to GitHub Releases. Image SHA-256:
`dce7199203fdb3b350c9daa358427992ac37468f17f1ebff99e57d01c4ea4b1b`.

Actual offline QEMU checks passed with SandyBridge-v2, two CPUs and 4 GiB RAM:
corrected BIOS diskless trial; corrected UEFI Try/Cancel with full 32 GiB final
byte preservation; deliberate Calamares installation to that synthetic drive;
and two installed UEFI boots with the live medium absent. Both normal password
logins used default Plasma (Wayland), with a fresh installed identity that stayed
stable, matching source/enrollment, locked root/service accounts and clean initial
home/projects/Mailbox. The first administration check required a password.

On boot one, kidOS Write opened on one click, and a document was saved, closed
and reopened. On boot two its exact bytes and original sentence persisted.
Two kidOS Write-button requests timed out; Dolphin Documents and the default
LibreOffice association reopened it successfully. That fallback uses the ordinary
LibreOffice profile. The first kidOS page also required a normal Ctrl+R. These
limits remain in the guide; neither page nor native-launch reliability is certified.
All three installation phases ended in normal guest shutdown and passing stopped
image checks. All owned source/acceptance VMs and builder transports are stopped.

Final second-boot checkpoint:
`62dd6193a06fbc2dc667a31930cdcbbc680e0e24077d8a37a4ee524f846b5c4c`.
The reconciled software acceptance record is
`work/usb-builder/evidence/ea56-usb-software-acceptance.json`, SHA-256
`57799e9ee82f99588122cd403268992b8bc7574dff27c97a892b418a306163dd`.
Independent review checked the phase/exit/screenshot/source associations.

This is an experimental supervised preview. Physical MacBook/PC compatibility,
Secure Boot, Wi-Fi, sound, input, suspend and real USB copy/eject remain unqualified.
The friends-following-the-guide pilot, whole-device backup/recovery, parent
controls, child-code containment and giftability remain separate pending gates.
The first practical target is an Intel MacBook without T2 (2012–2017) or an x64
Intel/AMD PC; no model is certified by the emulated tests.

## Internal-drive discovery correction — 2026-10-15

The first attached-drive test of the ea56 base image caught live-boot mounting
and unmounting the synthetic internal ext4 partition while searching for its
USB filesystem. No real drive was attached. The exact Debian live-boot discovery
code uses `ro,noatime`, and ext4 can replay a journal even on a read-only mount.
The earlier clean-image/static tests did not cover that behavior. The ea56 base
ISO is superseded for distribution and must not be offered for real-computer
trials.

The recipe now adds `live-media=removable-usb`, the existing fail-closed
live-boot branch which accepts USB devices reported removable and does not
fall back to scanning internal drives. A label/device path alone would fall
back and is insufficient. Fixed-reporting USB sticks/SSDs are outside this
boot path; other removable storage should be disconnected during startup.
The audit now requires this setting on every live entry and rejects conflicting
device/ISO-discovery aliases or duplicate boot/GPT/swap assignments.
All 346 checkout tests pass after the change, including 16 focused image/audit
tests. Evidence: `work/verification/usb-media-scope-full-tests.txt` and
`usb-media-scope-tests.txt`.

A corrected boot-configuration-only derivative is now built: 3,392,798,720 bytes,
SHA-256 `dce7199203fdb3b350c9daa358427992ac37468f17f1ebff99e57d01c4ea4b1b`.
The transformation removes stock `findiso` overrides and separate Debian
installer menu references. All 782 ordinary payload paths were compared: three
configurations, two checksum tables and the generated ISOLINUX boot-info table
changed; all other payload bytes, including SquashFS/kernel/initrd/EFI/offline
packages, match the base. The runtime source remains exactly ea56, with the
boot-policy source and its own artifact identity retained separately. Corrected
BIOS and UEFI boots now reach kidOS after one normal browser reload. In the UEFI
attached-drive trial, the internal test partition remained unmounted and swap
was empty. Try, a RAM file creation, and actual Calamares Summary → Cancel ended
in clean shutdown and a passing full logical 32 GiB comparison. The immutable
baseline and target hashes were unchanged. The combined preservation record is
`7884f851765c41df6a2f2dc3b2cada1d150f7ad1e19e0e7fa1965d20fa7025ac`.
Offline installation and two installed boots subsequently passed, as recorded
in the current delivery milestone above. These are emulated software observations,
not physical hardware qualification.
Sampled counters retained in private historical evidence are not device-level
write-absence proof: the installation later grew the target while the same
named-node counters remained zero. Preservation rests on the completed full-drive
comparison and unchanged hashes, not those counter samples.

The future generator now applies this same reviewed policy in a binary hook
after menu generation and before live-build checksums. Its two build-only helper
hashes are recorded in BUILD.json, outside the portable 337-file runtime. Unknown
menu templates stop the build. All 346 macOS tests pass after this wiring;
`work/verification/usb-final-macos-loopback-tests.txt` records the loopback-enabled
run. Public-source verification covers 413 reviewed files. A complete future
image rebuild is not claimed by the fixture tests.

The final delivery staging includes the matching public-safe frozen ea56 recipe,
the common Debian package-source tar (all 4,176 artifacts checked against the
authenticated 1,301-version union), font sources and the boot-policy supplement.
That package-source archive matches the unchanged payload even though it was
produced by the preceding build; its older kidOS live-configuration tar is not
substituted. The new normal build/source-packaging stage also completed with
exit 0. Its newly generated live-configuration archive was preserved privately;
it has not replaced the separately inspected recipe in the delivery folder.
The [Debian live-boot manual](https://manpages.debian.org/trixie/live-boot-doc/live-boot.7.en.html)
and [kernel ext4 documentation](https://docs.kernel.org/6.12/admin-guide/ext4.html)
explain the relevant discovery and journal behavior.

## Historical base-image checkpoint — 2026-10-15

This historical checkpoint describes the superseded base image, not the corrected
USB for distribution. Its pending items record that earlier point in time; the
correction and delivery records above contain the current results.

The development ISO `0.0.1-pilot.19-ea56e10ebac7` was built and copied locally:
3,392,471,040 bytes, SHA-256
`deaf63fc99d1494794530b205dfbabb9e6ef5f06494ae1e9cfc4c39b588fcafc`.
Its frozen portable source digest is
`ea56e10ebac7b1e9b0ac38ec6d5c444134140506c97a5ae7224a2d0eb77e9969`.
Later checkout/documentation changes are separate from that frozen image.
All 11 static image checks passed, including clean identities/data, exact source,
bootstrap/installer settings and the then-required BIOS/UEFI trial arguments.
The subsequent drive test above exposed the discovery gap in those arguments.
The exact source
passed 341 Linux x64 tests, with two expected platform skips and no failures.

Fresh isolated BIOS and UEFI boots reach Plasma without manual session repairs.
UEFI verified Wayland, fresh live enrollment, active kidOS services and local
HTTP 200. Both firmware trials required a normal browser reload to render the
first kidOS window. Both then completed offline Write create/save/close/relaunch/
reopen with the original sentence visibly intact, using normal UI. Native
launches also needed an extra attempt after a timeout. Automatic first launch
and first-request native reliability remain unverified; the observed failures
are retained rather than treated as passing. Bounded journal/kernel inspection
did not establish a renderer crash, OOM or CPU-instruction cause. Synthetic-drive
Try/Cancel preservation and Calamares install/reboot remain pending. No physical
MacBook/PC, USB stick or computer disk has been changed or qualified.

Signed metadata/source closure covers 1,301 source/version pairs and 4,176 source
artifacts. Retained source archives from the prior build were verified and copied;
the new build was held before its source stage at that checkpoint. It has since
resumed normally. The correction record above describes current source delivery
and the distinction between package sources and generated-ISO byte reproduction.
Evidence remains in ignored `work/usb-builder/`, particularly `CURRENT-EA56.json`,
`evidence/ea56-static-audit-output.json`,
`evidence/final-linux-full-tests-result.json`, and
`diskless-ea56-uefi/browser-after-reload-01.png`. The subsequent
`evidence/ea56-diskless-acceptance.json` binds the actual BIOS/UEFI observations
and explicitly keeps both first-launch reliability flags false.

The image is a local development artifact, not yet a friend-ready download.
The [USB acceptance sequence](../os/live-usb/README.md) remains required.
After reconciling the reviewed startup/auditor changes into the checkout,
all 346 macOS tests passed with two workers and loopback fixtures enabled;
`work/verification/usb-reconciled-macos-tests.txt` records that result. This
checkout check does not add image or physical-hardware acceptance.

## Try/install USB — 2026-10-14

Sean requested a USB edition for friends to try kidOS without wiping a computer,
then optionally install. The [live USB recipe](../os/live-usb/README.md) now
prepares a Debian 13 amd64 BIOS/UEFI hybrid image with the existing offline app
set, a RAM-only default trial, native Try/install dialog and the stock graphical
Debian/Calamares drive workflow. Fresh service/native enrollment runs after real
boot; no account, shared password, service data, native receipt, machine ID,
random seed or host SSH key is supplied in the image inputs. Trial changes are
not the installation source. Persistent USB storage remains outside this first
candidate; the welcome dialog explains exporting creations before shutdown.

Local bounded-concurrency verification passed **323/323 tests**. This includes
19 USB tests: first-boot authority/receipt recovery, reviewed installer config,
actual generated-shell argv boundaries, native fixed-action UI, UDisks policy and
identity-free recipe preparation. The first parallel full run under emulated
builder load hit existing subprocess limits (six failures and two cancellations);
the affected native suites passed 26/26 separately, then the complete suite
passed with two workers without changing timeouts. Evidence:
`work/verification/usb-macos-bounded-tests.txt`, `usb-timeout-recheck.txt` and
`usb-image-tests.txt`. Source/privacy checks pass. Independent review found and
fixed the runtime receipt normalization and undocumented UDisks lookup issues.

A separate Debian 13 x64 QEMU builder is running without host folders, physical
disks, USB passthrough or an upstream guest route/DNS. Official cloud/Node hashes
and signed APT tools were verified. The first ISO build is in progress, with
source input `0.0.1-pilot.19-b7e6ae84fa27`; transfer ownership was normalized in
the disposable guest before image copying. Logs remain under ignored
`work/usb-builder/evidence/`. No bootable ISO, BIOS/UEFI boot, drive-preservation,
Calamares installation or physical MacBook/PC acceptance is complete yet. Do not
offer the candidate as friend-ready before the USB acceptance sequence passes.

## Intel MacBook and PC rollout — 2026-10-14

Sean approved expanding to 2012-era Intel MacBooks and basic PCs, with both a
dedicated-computer edition and a later existing-macOS/Windows app, starting with
dedicated computers. The [PC rollout](PC-INSTALL.md) records the revised scope
and gates. An experimental Debian 13 x64 setup now exists in `os/linux-pc/`,
sharing the protected service, local data and fixed native apps while keeping
Pi/ARM64 fixture checks separate. It adds a separately pinned x64 runtime,
format-3 native enrollment, architecture-specific GTK lookup and optional desktop
startup. No disk, boot, driver, host-network or firmware changes were made.

Local macOS verification passed **299/299 tests**, including seven PC-specific
tests covering wrong-target/runtime/receipt rejection, fixed commands, empty
private state, extracted-bundle service/native staging and reversible login
startup. The full suite required loopback listeners outside the restricted
sandbox; its earlier sandbox run's HTTP listener denials are not product
failures. Evidence: `work/verification/pc-expansion-macos-tests.txt`. The PC/Pi
release verifier checks deterministic bytes, manifest/extraction and both staging
paths. These are local code/filesystem checks only. No x64 Linux service/native
installation, physical MacBook/PC qualification, kidOS live USB, friend-ready
wizard or native macOS/Windows installer is certified. Existing supervised-use,
parent-authority, containment and giftability limits still apply.

The follow-up uses Sean's unspecified post-2012 MacBook/basic-PC planning
assumption without requiring a model list. `--check-hardware` now prints a local,
read-only architecture/RAM/model report, tolerates missing metadata, reads no
serial/UUID/user/network/disk inventory and never marks hardware accepted. It
keeps the live device trial and deliberate drive selection separate. Five new
hardware-report tests plus the seven PC installer tests passed locally (12/12);
public-source and extracted-bundle checks cover the new module. Physical/x64
Linux acceptance remains pending.

Milestone 0 is complete. The working app set now includes My Stuff, Code Editor, Applications, Play, Library, Explore and local family Mailbox, alongside multiple desktop windows and workspace/draft recovery. The Pi source archive, guarded installer and isolated ARM64 Linux foundation are implemented. This app wave adds project imports/duplicates and reversible file operations, installed-version defaults, PDF/EPUB reading and collection metadata, six real local websites with HTTP activities, and local letters with durable drafts. Full product acceptance, physical input and Pi behavior remain open. Sean selected a Raspberry Pi 5 with 8 GB RAM for installation by Sunday 11 October 2026; actual hardware acceptance remains pending.

The corrected pilot.12 native launcher candidate is in progress. Actual Linux **Applications → Paint**, **OpenTTD**, **Calculator** and **Writer** launches now work, and repeating OpenTTD focuses the existing game. Calculator pointer input and Writer document recovery also have bounded graphical evidence. The remaining native launcher checks and broader everyday-computer acceptance remain pending; see the dated launcher follow-up below.

Historical app-wave full-suite results: **194 passed, 0 failed** on macOS/ARM64 with Node.js 22.22.3; **190 passed, 0 failed, 4 skipped** out of 194 tests on Debian 13 ARM64 with pinned Node.js v24.21.0. The four Linux skips exercise rejection on a non-Linux/non-ARM64 development host. Tests cover the feature contracts, durable state, migrations and reader integrity; they do not establish physical hardware behavior.

Targeted browser checks verified local Mailbox send/receive/read/reply, draft save on close/reload and draft Trash/restore; PDF pages/favorite; EPUB chapter selection opening chapter 2 at page 4 of 6; and an actual Explore form POST returning HTTP 200 plus JSON request inspection. My Stuff/Editor checks verified new file, rename, bin/save/restore with exact recovered text, two installed versions, and changing the desktop default to 1.0.0 while retaining both versions. Export displayed a success notice, but the browser download tool timed out, so browser-export byte verification is not claimed; API import/export round trips pass. Additional macOS checks verified project import/duplicate, Moon Hopper round completion/saved score/replay/pause, Tiny Racer steering/pause and Tablet/TV layout switching. Packaged pilot.9 Linux startup retained windows and the editor draft. Its final VM walkthrough verified the styled Moon Post lesson, styled POST answer with HTTP 200, and local address update; the Linux VM record below holds the later acceptance evidence.

The previous VM foundation milestone remains historical evidence at **145 macOS passes** and **141 Linux passes plus four skips**. Those results included the reviewed window gesture/focus correction and actual guest drag/resize/task-switching checks. Earlier 144/140 and 120-test runs, pilot.2 staging, and pilot.4/pilot.5 service/update checks remain historical records. See [DAY0.md](DAY0.md), [PLAY.md](PLAY.md), [TRASH.md](TRASH.md), [LIBRARY.md](LIBRARY.md), [EXPLORE.md](EXPLORE.md), [MAILBOX.md](MAILBOX.md), [WINDOWS.md](WINDOWS.md), [WORKSPACE.md](WORKSPACE.md) and the [Linux VM record](../os/linux-test/README.md). VM documentation refers to the full checkout; it is excluded from the Pi archive.

## 0 — Scaffold (completed)
Separate repository, product requirements, design reference, architecture, milestones, giftability requirements, runnable development service and smoke tests.

## 1 — First working vertical slice (Day 0)
Retro desktop with computer/tablet/TV modes. Create a text/web project, save it to disk, register it as an app, launch it in a constrained preview, restart the service and reopen it. Include export, validation and path traversal tests. No unrestricted child-code execution.

Acceptance: fresh checkout runs using documented commands; real persistence survives restart; sample app appears in launcher; keyboard/touch navigation works; server filesystem boundaries verified.

The implementation and exact local verification results are tracked in [DAY0.md](DAY0.md). Browser layout and keyboard checks do not certify physical touch/TV hardware or Linux containment. An installed app version must remain unchanged after source edits. The first manifest explicitly declares permissions, and the runner must keep child scripts out of the platform process and desktop origin.

## 2 — Everyday prototype
Two playable games with saved original-game scores, help and editable copies; project import/duplicate/search and reversible project/file Trash; native media, PDF pages and EPUB chapter-text readers with favorites, collections and progress; local family letters with read state, replies and recoverable drafts/Trash. Permanent deletion, CBZ/CBR archives, richer EPUB layout, larger-library performance, authenticated parent operations and comprehensive accessibility/controller acceptance remain pending.

Acceptance: representative audio/video/book/comic/photo files work; missing/corrupt files fail understandably; game progress survives restart; offline runtime has no external asset dependencies.

## Isolated Linux VM — bounded milestone verified

The [VM recipe](../os/linux-test/README.md) ran the real shared service on Debian 13 ARM64 under QEMU/HVF with the pinned Node runtime. Pilot.4 fixed service startup through the selected-release symlink. The later pilot.5 update retained the complete data directory exactly against its pre-update baseline. Synthetic projects, immutable installed bytes, media, Trash, scores and recovery drafts passed exact API checks after service restart, supervised recovery from a service crash, whole-directory backup restoration and an offline reboot. The exact reboot test used a changed boot ID and disabled the browser to preserve the comparison baseline. Labwc/Chromium autostart also ran in an actual tty1/DRM session and was visually confirmed; the gesture/focus correction passed actual guest dragging and corner resizing after app-frame focus. The corrected synthetic layout also passed exact state checks after graphical reboot. F5 reload restored the moved/resized windows, minimized app and unsaved draft.

This verifies a Linux service and recovery slice, not a complete appliance OS. Audio output, full browser acceptance, child process/network containment and physical Pi operation remain open. The disposable VM's sudo-enabled test account and automatic login are separate from the strict [Pi installation path](../os/raspberry-pi/README.md).

## Next — Minimum lovable everyday computer

Sean's 2026-10-09 request prioritizes a minimum lovable computer that is ready to use, including a word processor and calculator. The immediate work is to complete ordinary creative workflows and their integration, then demonstrate a dependable offline session. Preserve the existing Linux evidence and service boundary. Private internet services and a giftable image are later work; no hardware acceptance is complete until checks run on the chosen physical device.

### Minimum lovable acceptance sequence — 2026-10-09

All acceptance groups below are **pending**. Earlier evidence establishes only its recorded scope; it does not automatically complete these broader workflows. Record the tested release, target, input devices and observed outcome before changing a group's status. Review a working result with Sean after each group.

First bounded progress: Writer and Calculator are installed in the existing Linux VM and launch from its F8 menu; Calculator arithmetic/error feedback was observed. The fixed launcher passes 11 macOS checks and 10 Linux checks with one host-specific skip. Writer's complete editing/save/reopen proof remains pending because UI automation had pointer/typing failures. Saved content was preserved. See [the dated native-tools record](../os/linux-test/NATIVE-FILES.md#writer-and-calculator-milestone--2026-10-09). The separate [desktop launcher connection](NATIVE-APPS.md) is in progress and is not certified by this milestone.

1. **Write, calculate and draw in the Linux session.** Demonstrate a mature word processor creating a formatted story with a saved Paint picture, saving to Documents, closing/reopening it with text and picture intact, and exporting a readable PDF. Demonstrate calculator arithmetic/decimals, keyboard and pointer entry, clear/backspace, invalid operations and copying an answer into the document. Keep the existing Paint save/reopen evidence, and verify ordinary Files rename/copy/Trash/restore without overwriting a conflicting creation. Native application demonstrations are this first bounded step; they do not complete browser launcher or taskbar integration.

2. **Make it one computer.** Launch Write, Calculator, Paint and Files from the kidOS desktop/Start menu; reach Documents, Pictures and Downloads through understandable My Stuff entries. Switch between native and browser windows and return to a saved creation without function-key knowledge or a terminal. Verify missing-app errors, app crash/relaunch, open/save dialogs and browser reload while native saved files remain intact. Complete a create → save → find → reopen workflow after a Linux restart. Keep the native launcher restricted to approved application/folder identities and preserve the platform service's home/device restrictions; do not expose arbitrary commands or paths. Browser recovery must not claim to restore unsaved native-app memory.

3. **Finish a pleasant offline session.** Select a small distributable starter collection with recorded provenance: a book, representative audio/video and a few enjoyable games, using the current Library, Explore and game paths. Confirm real audible output, volume/mute, pause/resume, saved progress and return to the desktop while disconnected. Verify readable text, keyboard focus and the chosen pointer/input devices, plus ordinary display/input controls, accessible offline help and restart/shutdown with unsaved-work feedback. Exercise computer/tablet/TV layouts; physical touch, remote or controller acceptance requires the corresponding device and remains separately pending.

4. **Keep the work safe.** Copy a synthetic creation to removable media and back, compare its bytes, and test conflicts, read-only/full media, cancellation, disconnect and busy-eject feedback using an isolated virtual device first. Safe removal must report actual success. Physical tests require explicitly designated media. Demonstrate a parent-followable backup and restore including the private service directory, ordinary Documents/Pictures/Downloads, native game saves and relevant app preferences; reopen restored documents, pictures and saved progress. Verify acknowledged recovery behavior after an interrupted application/session and make any limits visible. Never automatically overwrite or purge creations to make a check pass.

5. **Review supervised readiness on the intended device.** Run one continuous offline walkthrough: start → write and illustrate → calculate → save → switch to a game/book → restart → find/reopen → Trash/restore → backup/restore. A parent must be able to follow the instructions without a developer shell. Record friction and fix the blocking issues before calling the supervised product ready. A VM can complete a supervised VM milestone; physical Pi readiness requires the chosen Pi, actual sound/input/graphics/storage/USB evidence and representative performance. The selected target is a Raspberry Pi 5 with 8 GB RAM; actual hardware acceptance remains pending.

Independent child use is a separate pending gate: an ordinary non-admin account, separately authorized parent operations, and tested OS execution/network policy. The current sudo-enabled VM demonstrations and browser sandbox do not satisfy it. Giftability remains milestone 5 and [GIFTABLE.md](GIFTABLE.md), including clean onboarding, per-device identities, updates/rollback, recovery and reset on a designated disposable target. Do not expand this minimum lovable sequence into connected messaging, private-network infrastructure, child server execution or a large app catalog before the everyday workflows work.

## Pi 5 installation target — Sunday 2026-10-11

Sean selected a Raspberry Pi 5 with 8 GB RAM. The [Sunday checklist](../os/raspberry-pi/SUNDAY.md) targets a supervised personal installation on Raspberry Pi OS Trixie 64-bit Desktop. The candidate includes Writer, Calculator, Paint, Files, Documents/Downloads shortcuts and OpenTTD through a root-enrolled ordinary-user native bridge. The source archive contains the portable bridge and excludes VM installers, fixture identities, game-demo data and family content.

Pi startup uses a maximized app window and a separate XDG login entry, preserving the existing Pi panel, window switching, volume and shutdown. The desktop menu can reopen kidOS. Native user setup creates missing folders/preferences without replacing existing creations. Package preparation remains a separately invoked physical-Pi operation; the service retains its locked identity and private data restrictions.

The macOS preview verified Writer/Calculator desktop and Start entries, the Documents/Pictures/Downloads views, and truthful unavailable-native messages. At the pilot.11 checkpoint, Linux pointer interaction failed with `noWindowsAvailable`; that check did not close any application, browser or compositor. The resumed check later found the VM already stopped, preserved its disk before booting, and regained working pointer input. Applications now launches Paint, OpenTTD, Calculator and Writer in actual Linux windows; complete nine-entry graphical acceptance is still in progress. Story save/reopen/PDF, Pi panel behavior, sound, USB, reboot and full backup/restore acceptance remain open. This installation milestone does not complete the minimum lovable acceptance groups.

The earlier pilot.11 candidate's full suite passed **255/255 on macOS** and **247/255 with eight platform-specific skips on Debian ARM64**, with no failures. The pinned Linux runtime was v24.21.0; tests ran from a separate source copy, without changing the then-installed pilot.10 service or open native apps. All nine candidate catalog entries found their actual installed VM programs/folders. That checkpoint's independent review reported no blocking findings after the selected-release symlink entry-point fix. Evidence: `work/verification/pi5-macos-full-tests.txt`, `work/linux-vm/evidence/pi5-linux-full-tests.txt`, and `pi5-candidate-native-catalog.json`. These tests covered native enrollment/source validation, fixed commands, preservation during interrupted/concurrent preference setup, and staging the portable native graph from the extracted release. They did not catch the extension mismatch found in the subsequent review below; pilot.11 is superseded and must not be treated as the current installation candidate.

## Native launcher follow-up — 2026-10-09

Sean requested visible, launchable Paint and games. The earlier checkpoint listed Paint, Files, Trash, Putt-Putt (demo) and OpenTTD in Applications and Start. The Sunday candidate adds Writer and Calculator, links ordinary Documents/Pictures/Downloads from My Stuff, and removes the optional demo from prominent desktop/Start shortcuts. The separately provisioned bridge accepts fixed application IDs only; complete kidOS-native taskbar coordination remains pending. See [the launcher implementation and verification record](NATIVE-APPS.md). This bounded follow-up does not complete the broader minimum-lovable acceptance groups above.

The resumed Linux check verified Applications opening actual Paint and OpenTTD windows. Selecting OpenTTD again brought the existing game forward with the same process identity. A subsequent code review found that the browser content script still allowed only the original five IDs, so Writer, Calculator, Documents and Downloads requests were dropped even though the catalog and native host accepted them. Pilot.12 corrects that mismatch and adds a behavioral regression through the actual content script and worker for all nine approved IDs. The corrected candidate is installed in the VM. Its current browser successfully launched Calculator, where pointer input produced `7 + 3 = 10`, and Writer, whose recovery dialog restored two earlier documents and left them open. This verifies launch and recovery only; a complete formatted story, saved picture, save/reopen and PDF export remains pending. The Mac locked again before the Documents launch check, so folder and Putt-Putt demo checks await resumed graphical access. The final code suite passed 262/262 on macOS and 253/262 with nine expected skips on Debian ARM64. The source archive rebuilt byte-identically, staged on both platforms, and passed clean-data, loopback, asset and project/install/restart smoke checks. Exact artifact and installation evidence is retained in the dated Linux VM record. Saved data and the platform service's home/device restrictions remain separate from the ordinary-user launcher.

## Earlier everyday-computer integration proposal — 2026-10-08

Proposal recorded 2026-10-08; the wider integration remains unimplemented, with a bounded native Files/Paint workflow now verified in the disposable VM. Paint saved an actual PNG in Pictures; Files reopened it through the configured handler and moved/restored it through native Trash with exact byte preservation. See [the native Files/Paint record](../os/linux-test/NATIVE-FILES.md) for packages, seven focused tests passing on both platforms, evidence and outstanding acceptance. This earlier slice does not complete rename/copy, reboot persistence, native taskbar integration, USB, parent authority or physical Pi validation; the later browser launcher follow-up is recorded above. Build for approximately ages 3–11 with familiar Windows 95-style files, windows, tools and settings. Keep the real-computer baseline described in [PRODUCT.md](PRODUCT.md): optional assistance and varied content, with recoverable mistakes and room to learn powerful tools.

The following three integration tracks remain the technical reference for the acceptance sequence above. The [everyday-computer integration proposal](EVERYDAY-COMPUTER.md) narrows Files/native apps/USB into testable slices while preserving the existing service boundary.

1. **Files and USB.** Extend My Stuff beyond project records to ordinary household folders, with open/save, copy/move, understandable conflicts and recoverable Trash. Reuse mature Linux services such as [UDisks](https://storaged.org/doc/udisks2-api/latest/) for removable-drive discovery, authorized mounting and safe eject; show transfer progress and busy-drive failures before reporting that removal is safe. Keep system files and private service data outside the child file scope. Exercise removal and interrupted copies using isolated fixtures, then explicitly designated test media.

2. **Native apps, windows and games.** Add a trusted launcher for approved native applications, compositor/taskbar coordination and shared creation folders. Native windows need Linux integration; they cannot be hosted as ordinary browser iframes. Evaluate [KolourPaint](https://apps.kde.org/kolourpaint/) for Paint, [Simon Tatham's puzzles](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/) for Mines and other small games, Aisleriot for Solitaire, and an openly distributable Pinball package. Run two bounded game proofs of concept: ScummVM with a Putt-Putt demo from its [official demo collection](https://www.scummvm.org/demos/), and [OpenTTD](https://www.openttd.org/about) with open graphics, sound and music assets. Check launch/return, window switching, controls, audio and save/reload; record engine and content licenses separately before redistribution. These are component candidates, not promises that every game or commercial asset will ship.

3. **Settings and parent onboarding.** Provide ordinary display, sound, input and accessibility settings, plus a separate parent setup/administration path for household identity, network access, imports and updates. Use OS identities and narrowly authorized service operations, evaluating [polkit](https://polkit.pages.freedesktop.org/polkit/) where appropriate. A browser PIN or hidden settings button cannot establish parent authority; child apps must not receive administrative credentials or a general shell capability.

Later connected work can add parent-approved family/friend chat with explicit contact enrollment; the existing Mailbox remains local to one computer. Keep this separate from the first everyday-computer milestone.

Review each track with a working Linux result, then apply the existing physical-Pi and [giftable release](GIFTABLE.md) gates. A giftable device still requires actual-hardware input/audio/graphics/USB and offline checks, a clean image that generates fresh household/device identities, and verified backup/restore, update rollback and recovery. Containers and graphical VMs provide bounded evidence; they do not complete physical Pi acceptance.

## 3 — Real private internet and app development
Six original starter sites, local search, genuine HTTP forms/JSON and a fixed-request inspector are implemented in Explore. Code editing, imported/duplicated source, immutable installs and desktop version selection are implemented. Private DNS/HTTPS and trust enrollment, child site publishing, source history, a contained Python/native runner, uninstall, app-data migrations and a complete update/rollback policy remain pending.

Acceptance: child publishes a site and installs an app; genuine requests can be inspected; out-of-scope filesystem/network/resource access is denied in Linux integration tests; app crashes do not stop the platform.

## 4 — Physical Pi pilot
Select hardware after representative media and development workloads. Reproducible image recipe, first-run enrollment, kiosk, supervision, network policy, backup/restore and update rollback.

Acceptance on actual hardware: boot, restart, disconnected use, audio/video, input, filled storage, crashed app and interrupted update recovery. Test IPv4/IPv6 and alternate egress paths. Do not claim hardware validation without a Pi.

## 5 — Giftable release
Clean image, per-device credentials and certificates, signed release artifacts, parent onboarding, content-license manifest, offline help, safe factory reset and recovery media.

Acceptance: another parent sets up a clean device without developer assistance; backup restores creations; reset removes prior household data and secrets; no developer-specific configuration remains; clean-install and upgrade paths both pass.

## Review rhythm
Show the project owner a working result at each milestone and resolve only decisions needed for the next. Keep prototype limitations visible. A Pi is useful for physical acceptance; choosing and buying one remains a user decision. Continue everyday software polish and bounded Linux regression checks while hardware is unavailable.

## Native appearance checkpoint — 2026-10-09

Built-in appearance work now includes Write branding/native toolbar/colors, Paint, Calculator and Files Qt styles, and shared labwc title bars. The desktop never scrolls its shortcuts and keeps overflow applications accessible via Applications/Start. Source and browser checks pass; actual Linux proof covers initial Paint and revised Write visuals plus ODT save/PDF export. Existing profiles and recovered documents are preserved. The normal Write profile was safely backed up/migrated and reopened the saved ODT; Calculator arithmetic and Files Pictures were observed with their new styles. Revised Paint sizing, image insertion and PDF rendering remain pending due to intermittent VM input failures. Browser launch is being rechecked independently. This does not complete any broader minimum-lovable acceptance group or certify physical Pi behavior. See NATIVE-APPS.md for exact bounded evidence.

## Native classics — next candidate

Sean approved a focused set of native Solitaire, Minesweeper and Pinball apps. Reuse Debian ARM64 games with distributable assets and fixed launch entries, preserve upstream attribution, and verify installed availability and real gameplay in the Linux VM. This explicit scope adds three classics; a larger puzzle catalog remains deferred. Physical Pi graphics, input and sound require the actual device. See [native classics](NATIVE-CLASSICS.md).

## Puzzle Box — 2026-10-10

Sean approved the proposed Simon Tatham puzzle collection. Add a single native **Puzzle Box** entry across the desktop, Start, Applications and Play. A kidOS-styled native chooser presents six starting choices and the full searchable 40-game Debian collection; puzzle engines, controls and credits remain upstream. This explicitly approved collection does not expand into other game packs. Keep the fixed-command launcher boundary and desktop no-scroll rule. Package/install, chooser launch, a playable puzzle, and save/load require recorded verification before claiming acceptance. Physical Pi, full collection gameplay, touch/controller and broader supervised readiness remain pending. See [native classics](NATIVE-CLASSICS.md) for package/provenance facts and the [Linux record](../os/linux-test/README.md) for later bounded checks.

## Desktop corrections — 2026-10-14

Pilot.16 (`0.0.1-pilot.16-444bd3ff4252`) is installed in the existing disposable Linux VM. Successful-launch messages now expire without shrinking the desktop or hiding shortcuts; Computer mode retains multiple visible browser windows at narrow widths. A separately updated VM Chromium app-mode launcher and precise labwc background rule prevent desktop activation from covering every native window. Actual keyboard/visual acceptance showed Paint, Files and Solitaire together, with Paint's shortcut preserved. Pointer automation was unavailable; native taskbar integration and physical Pi acceptance remain open. Full tests: 290 passed on macOS; 281 passed and nine expected skips on Linux. See [the verification and limitations](WINDOWS.md#desktop-follow-up--2026-10-14).

Sean withdrew the offline Wikipedia request after reviewing the full English archive's storage size. No Wikipedia archive, reader package or virtual disk was added; the provisional launcher changes were removed.

## Public developer preview — 2026-10-14

The project owner approved public open-source distribution through their personal GitHub account and delegated the license choice. Original kidOS code, artwork and documentation now use MIT; vendor notices remain separate. The initial public-source candidate is pilot.17. It adds a public README and clean-data screenshot, contribution/security guidance, an exact public-source allowlist and credential/path checks, a CI matrix, deterministic archive/extraction/staging verification, and a workflow that prepares draft prereleases. Local verification passed 292 tests on macOS, including the new publication-boundary regression tests. GitHub execution and publication are recorded by the repository's runs and releases; they are not implied by this local preparation record.

The initial distribution is source plus a portable developer installation bundle. Optional GitHub release notifications and manual downloads precede the separate parent-authorized updater milestone in [UPDATES.md](UPDATES.md). That initial source-only release did not include a bootable image. The later experimental amd64 USB and its scoped software checks are recorded above; no automatic updater, physical-Pi acceptance or giftable-device acceptance is claimed.
