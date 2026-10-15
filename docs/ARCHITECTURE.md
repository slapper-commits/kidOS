# Architecture and decisions

## Day 0 implementation

The desktop is locally served HTML, CSS, and browser JavaScript modules. A Node.js service exposes the project API, persists validated state on disk, and starts a separate loopback HTTP origin for installed app files. There is no cloud requirement, client build pipeline, database daemon, native addon, or server-side third-party runtime dependency. PDF and EPUB readers use pinned, locally vendored browser libraries; see the dependency record below.

```text
Browser desktop (127.0.0.1:8787)
  ├─ desktop, editor, launcher, Library, local Mailbox
  ├─ authenticated APIs → validated state + media → private data directory
  ├─ sandboxed frame → installed snapshot (127.0.0.1:8788)
  └─ Explore frame / fixed Request lab → local educational HTTP routes
```

Source projects and installed snapshots are separate records. An install records the app ID and declared version along with its files. Saving source never writes into an installed snapshot. The launcher identifies the installed version; updating an app means explicitly installing another version. Selecting an earlier installed version changes the desktop default without changing snapshot bytes. New previews and installations omit source paths under `recycle-bin/`; existing installed snapshots remain byte-for-byte unchanged, including any legacy use of that path. The contract is versioned independently of the application version; see [the manifest contract](../packages/app-contract/README.md).

The initial storage schema is versioned. Future migrations must be explicit, source-controlled, and tested on copies of real prior schemas. An unknown schema must fail clearly rather than be silently rewritten. The Play slice introduced schema 2 for game progress. The Trash slice introduced schema 3 with a separate project-trash map. Library introduced schema 4 with a media catalog and separately stored binary files. Workspace recovery introduced schema 5 for window descriptors and a separate editor draft. Schema 6 adds local family mail and normalizes saved Explore tool state; existing source-project and installed-app record shapes remain unchanged. See the migration details below.

## Decision record: 2026-10-08

| Decision | Reason and tradeoff |
| --- | --- |
| Node.js 22+ and standard-library HTTP/filesystem/test APIs | Fits the existing scaffold, runs locally, and avoids native build dependencies on the later ARM64 target. Local development uses a supported LTS runtime; the Pi/VM installation pins Node.js v24.21.0 Linux ARM64. The separate amd64 USB recipe includes its own runtime pin and build guard. Small modules keep validation, persistence, serving, and UI concerns separate. |
| Plain browser modules and local CSS/SVG assets | The small Day 0 UI needs no framework or build service. It remains inspectable and usable offline once the local runtime is present. Revisit an editor library when editing capabilities justify its size and license review. |
| Versioned JSON state with validated, recoverable writes | Keeps the first installation understandable and portable. Bounded project sizes suit this slice; a large media catalog or many simultaneous writers will need a different store. |
| Immutable installed snapshots | The child can experiment without unexpectedly changing an installed app. Explicit versions make launch and later rollback behavior understandable. |
| Separate runner origin plus sandbox/CSP | Keeps child scripts out of the desktop origin and platform process. This is browser-level defense, not Linux process, filesystem, network, or resource containment. |
| Implement only HTML/CSS/JavaScript apps | The browser executes child code. Python, native apps, shell commands, package installation, and privileged capabilities remain unavailable until an actual containment boundary exists. |
| Pinned PDF.js and zip.js browser readers | Mature PDF/ZIP parsing is vendored with integrity hashes and licenses. EPUB rendering reduces package chapters to plain text; no child document scripts run. This adds local browser dependencies without a CDN or server-side decoder. |
| Keep system source and family data separate | Source can be replaced without bundling family projects into a distributable image. The local configurable data directory is the first step, not a completed household identity model. |

## Browser and service boundary

Development services bind only to loopback. The platform validates the request host, browser origin, and Fetch Metadata headers, and requires a per-process token for project/app API calls. The desktop obtains its token from the session endpoint after the same request checks. This limits cross-site requests and hostile hostnames; it is not parent authentication. A local process running as the same operating-system user remains trusted in this prototype.

App responses use a restrictive Content Security Policy and a sandbox that permits scripts but does not grant same-origin authority. Day 0 apps use classic relative JavaScript scripts and local stylesheets; app ES-module imports and remote dependencies are not supported. The desktop does not execute project HTML using `innerHTML`, evaluate child code in its own JavaScript context, or expose a host-shell API. Unsupported manifest permissions are rejected. The Day 0 empty permission set grants no kidOS capability APIs; it is not a promise that all network and resource use is blocked by the operating system.

An iframe is not a substitute for separate operating-system identities, resource limits, or enforced egress policy. Browser navigation behavior, browser vulnerabilities, resource exhaustion, direct IP/IPv6 paths, and physical access are not comprehensively contained here. The runner is for local development, not untrusted imported app packages. Parent controls must eventually use authority that child apps cannot obtain.

## Storage and recovery

The data directory is excluded from Git. The service validates incoming data and state read from disk, bounds file and request sizes, and rejects unsafe names, invalid text, and non-JSON API request bodies. Logical project paths are keys in the JSON state and do not become unrestricted host paths. State updates use a temporary file and atomic replacement, with a previous valid state retained for recovery. Startup surfaces corruption or recovery instead of silently presenting lost work as an empty installation.

`state.json` contains `{schemaVersion: 6, projects, apps, games, trash, media, workspace, mail}`. Validated migrations take schemas 1–5 directly to schema 6, preserve their existing maps, add missing maps with empty state, and normalize an old empty Explore tool state to `{siteId: null}`. Opening an older valid primary retains its exact bytes as `state.pre-v6.<uuid>.json`, saves it as the recovery backup, and atomically replaces the primary with schema 6. Recovery from an older backup also archives its exact bytes before upgrading. Migration checks serialized size before any file changes and fails without falling back to older data if the result would exceed 64 MiB. Archives are not overwritten by later writes; existing pre-v2, pre-v3, pre-v4 and pre-v5 archives remain untouched. Older software cannot read schema 6: preserve the upgraded directory before restoring a pre-upgrade backup, which omits subsequent progress and changes.

`state.backup.json` contains the previous valid committed state. Temporary writes use private files followed by file sync, rename, and directory sync where supported. `store.lock` prevents concurrent service instances from opening the same data directory; a dead process's lock can be recovered. An interrupted lock recovery can require manual inspection of `store.lock.recovery`. Corrupt primary state is preserved as `state.corrupt.<time>.<uuid>.json` when a valid backup is restored.

Day 0 limits are 128 projects, 32 text files and 1 MiB of text per project, 32 installed versions per app, and 64 MiB of serialized total state. JSON API bodies are capped at 2 MiB. Binary Library imports have separate bounds: 64 MiB/file, 2 MiB/text book, 512 catalog items, and 1 GiB in the media directory. These are prototype limits, not full-household sizing. Saves use a revision check so another browser cannot silently overwrite newer edits. Every installation records the source revision, installation time, and SHA-256 content digest. The last explicitly installed version becomes the launcher default, regardless of numeric ordering; Applications can subsequently select any existing version as that default.

The previous-state file is recovery from a damaged or interrupted write, not a backup history. Disk failure, deletion of the data directory, and a crash before a save completes can still lose work. Export creates a portable JSON source copy. My Stuff imports validated version-1 project exports or recovery drafts into new projects with fresh identities, revisions and timestamps, never by overwriting an existing project. Import does not run or install the source. Duplicate also creates a new identity after checking the original revision. For a complete local backup, stop the service and copy the entire data directory to a separate location. Do not edit live state files by hand.

## Destination architecture

The [native application launcher](NATIVE-APPS.md) adds a fixed ordinary-user Chromium Native Messaging bridge for the supervised Linux desktop: catalog and launch by one of nine fixed application/folder IDs. Pi provisioning enrolls one existing desktop account; the VM retains its separate fixture identity. An extension validates the exact desktop origin and top frame; the host independently checks the request and launches a fixed program without a shell or caller-supplied arguments. The portable bridge and guarded Pi installer are included in the source archive; enrollment remains a separate root operation. VM installation wrappers and identities remain excluded. The platform service gains no launch endpoint or home/device access. The [everyday-computer proposal](EVERYDAY-COMPUTER.md) retains the pending shared-folder, taskbar and UDisks work. Trusted native-app VM demonstrations do not establish child-code containment.

1. Desktop shell: UI and input modes; no privileged system access.
2. Local platform service: project files, app registry, media catalog, and authenticated parent operations.
3. App runner: independent constrained identities/processes, private app data, explicit capabilities, and resource limits.
4. Private network services: actual DNS, HTTP/HTTPS, local search, and curriculum websites. Use `home.arpa` names on the dedicated local network.
5. Linux appliance: kiosk startup, supervision, enforced egress policy, storage, updates, and recovery.

Start on the current computer, add an isolated Linux integration target, then validate physical ARM64 hardware. A cloud preview can show the UI but cannot certify local networking or Linux enforcement. The [Raspberry Pi developer pilot](../os/raspberry-pi/README.md) now supplies a deterministic source archive, staging installer, guarded live installer, systemd unit and optional desktop-user launcher. The archive and staging paths are verified on macOS. The same service/runtime and persistence paths now have actual Debian ARM64 VM evidence; physical Pi acceptance remains pending. A separate amd64 [USB development image](../os/live-usb/README.md) has been built and reaches kidOS in isolated BIOS/UEFI boots after one normal browser reload. Native Write save/reopen passed on the unchanged base payload; the corrected boot policy passed full synthetic-drive Try/Cancel preservation. Offline Calamares installation and two USB-absent UEFI password logins passed, with stable installed identity and native document bytes/text. Boot two reopened the document through Dolphin/LibreOffice after kidOS shortcut timeouts. Automatic page/native-launch reliability and physical hardware qualification remain pending.

Six original loopback HTTP websites, search, fixed forms/JSON and the Explore Request lab now run locally. Private DNS, HTTPS, device trust enrollment and enforced network policy remain planned. Each family/device must receive a unique identity and local certificate-authority material at first boot. Enrolling other devices requires explicit DNS and certificate-trust configuration.

The Library format matrix is documented in LIBRARY.md; native media, PDF pages and EPUB chapter text are implemented, while comic archives, richer EPUB presentation, large libraries and hardware performance remain open. Prefer direct playback and import-time conversion; benchmark representative files before promising Pi transcoding. Reuse mature media and document readers after license/security review.

## Isolated Linux integration target — 2026-10-08

The [disposable VM fixture](../os/linux-test/README.md), available in the full checkout rather than the Pi source archive, uses Debian 13 generic ARM64 image `20261001-2618`, QEMU 11.1.1/HVF, kernel package `6.12.111-1`, Node.js v24.21.0, Chromium `154.0.8037.92-1~deb13u1` and labwc `0.8.3-1`. The image and Node archive have source-controlled hashes; signed APT packages are recorded by version and are not a fully reproducible image build.

Pi and VM wrappers perform separate target checks before entering common `install-core.mjs` and `kiosk-core.mjs`. The Pi wrapper still requires physical Pi identity and Raspberry Pi OS. The VM wrapper requires actual Debian/QEMU identity plus a private root-owned marker matching an explicit UUID. VM wrappers and test identities are excluded from the Pi archive. Both use the same pinned runtime, source verification, service identity/unit, private data path and ordinary-user Chromium launcher. The first guest run exposed a CLI entry-point comparison that failed when the service launched through `/opt/kidos/current`; pilot.4 corrected that path handling and started successfully. The subsequent pilot.5 update retained the complete data directory, confirmed by an exact directory comparison before further UI testing.

The guest has no default route or upstream DNS. QEMU restricts user networking and forwards only host-loopback SSH; no host folders are shared. Provisioning temporarily forwards a guest-loopback package proxy over SSH to a host GET/HEAD allowlist that fetches official Debian repositories over HTTPS. It preserves APT signature checks and uses separate fixture sources, lists and cache. The proxy/channel were stopped for offline acceptance. Host setup did install QEMU and dependencies through Homebrew, including pcre2/glib updates; host firewall, DNS, trust, network and boot configuration were not changed. This fixture topology is not the future product's enforced child network policy.

Actual Linux evidence covers exact synthetic projects, installed files, Trash, game progress, media bytes/positions and workspace drafts across service restart, a forced service-process crash with supervised recovery, whole-directory backup restoration and an offline reboot with a changed boot ID. That exact reboot check kept the desktop browser disabled so normal UI workspace writes could not alter the baseline. The earlier browser-enabled baseline mismatch came from a synthetic fixture with inconsistent stacking and JSON field order. It remains recorded; the corrected fixture subsequently passed an exact check after graphical reboot. Service properties and loopback listeners were inspected. A real tty1 PAM/logind session launched labwc on the virtual DRM display and then Chromium through labwc autostart; its desktop was visually confirmed. A window gesture/focus correction found during that session passed the actual guest drag and corner-resize retest. Task switching, minimization, the installed app, the text reader and recovered draft were visibly checked; F5 reload restored the altered workspace.

Guest-only automatic login and passwordless sudo belong to the explicitly disposable developer account. They are not Pi setup defaults or child controls. Read-only renderer process checks found NoNewPrivs=1, seccomp filter mode, no effective capabilities and separate user/PID namespaces from the browser process. This verifies those Chromium renderer mechanisms, not complete UI acceptance, audible playback, physical Pi performance or kidOS child-code containment. Local evidence is retained under ignored `work/linux-vm/evidence/`, including `install-fixed.log`, `recovery.log`, `offline-reboot.txt`, `packages-and-isolation.txt`, `reboot-and-graphical.txt`, `tests-final-macos.txt` and `install-focus-and-tests-linux.txt`, `final-graphical-boot-api.json` and `browser-sandbox.json`. Screenshots are under `work/verification/linux-desktop.jpg` and `linux-workspace-reload.jpg`.

## Intel/AMD installation track — 2026-10-14

The owner-approved [PC track](PC-INSTALL.md) reuses the same service unit, private
data directory, release manifest and source archive. `os/linux-pc/` supplies
separate Debian 13 x64 entry points; it never partitions storage or configures
boot, drivers or networking. The shared service core selects the independently
pinned x64 archive only for `linux-pc` and records its architecture. ARM64 Pi/VM
wrappers retain their own checks. The runtime checker rejects receipts/binaries
for a different architecture and non-installable staging trees.

Native format-3 receipts enroll an ordinary PC user separately from format-2 Pi
and format-1 disposable VM identities. The fixed app catalog and source hashes
remain enforced; GTK paths select the actual architecture. PC startup preserves
the normal Linux desktop/panel and uses a dedicated Chromium app profile. This
first native PC path requires Wayland and a real user-owned session/DBus socket;
an X11-only device is not accepted by that bridge. KDE window decorations and
game refocusing differ from labwc, and no integrated native taskbar is claimed.
The separate USB path has actual offline x64 installation, chosen-password login
and document persistence through two UEFI boots. The first page required Ctrl+R;
boot two used Dolphin/LibreOffice after the kidOS Write shortcut timed out.
Physical hardware, full backup/restore and launcher reliability remain pending.

The later existing-macOS/Windows edition needs its own packaging and native
adapters. Browser preview portability does not certify those OS integrations.

## Try/install USB track — 2026-10-14

`os/live-usb/prepare.mjs` prepares allowlisted source and a SHA-pinned x64 Node
runtime for Debian live-build, without mounting or flashing. The guarded build
entry requires a separately marked disposable Debian amd64 QEMU/KVM guest.
Debian's live-boot/SquashFS RAM overlay is the default trial, with persistence,
GPT auto/swap and resume disabled. KDE automount defaults and a temporary-user
UDisks rule prevent automatic internal-drive mounts; this is not containment
against an administrator or a hardened child account.

An actual boot runs the existing guarded service/native installers, using the
ordinary UID-1000 account created by live-config or Calamares. Code, accounts,
runtime receipts, family data and machine/host identities are never captured
from the builder filesystem. Bootstrap validates existing receipts rather than
resetting creations on later boots. A native GTK dialog offers Try by default;
the optional install button opens Debian's fixed Calamares wrapper after a
separate warning. Browser content has no installation API. Calamares' reviewed
disk-selection/summary/execute order is retained and its unpacker uses the clean
read-only SquashFS, so live trial files/enrollments are not installed. Installed
homes are private, reserved account names are rejected and normal login remains
required. See [USB build, behavior and recorded acceptance](../os/live-usb/README.md).

## Primary references

- [Node.js release lifecycle](https://nodejs.org/en/about/previous-releases)
- [MDN iframe sandbox reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
- [Raspberry Pi image generator](https://github.com/raspberrypi/rpi-image-gen)
- [`home.arpa` specification](https://www.rfc-editor.org/info/rfc8375/)

## Play decisions — 2026-10-08

The two original canvas games share browser-independent rules (`apps/games/engine.js`) used by both the player and automated simulations. The existing runner serves their bundled files under fixed game IDs. Copying a game materializes those same files as an ordinary editable project; installing it uses the existing immutable snapshot contract with empty permissions. No game code executes on the server.

Only registered mounted built-in game frames have a narrow score bridge. The desktop resolves the exact sending frame, opaque sandbox origin, built-in game identity, and bounded message fields before submitting a result through its authenticated local API. Neither the token nor a generic platform API crosses into the game. Preview and installed remix frames have no score capability. This is not a new permission for arbitrary apps or a competitive anti-cheat system.

Scores store best/last score, round and win counts, timestamp, and the last 128 round IDs per game. Retries within that window do not count twice. Game windows queue unacknowledged results and expose retry on failure; closing the window loses unsaved queued results. Successful saves survive service restart. Progress is shared on this installation, with no child profiles yet. JSON transactions remain suitable for this small prototype; a future app-data capability and larger catalogs require a separate design.


## Project Trash — 2026-10-08

Trash is a reversible project-folder operation. `trash[projectId] = {trashedAt}` hides a source project from the active catalog while retaining all source files and installed versions. Active source reads, saves, installs, exports, and new previews require restoration first. Existing preview snapshots remain temporary snapshots, and installed apps continue to launch. Both move and restore require an exact current revision and advance it, so an editor opened before a move/restore cycle cannot overwrite restored work. The desktop offers save, discard, and cancel for the affected unsaved draft and retains the draft on failure.

There is no purge, empty-trash operation, permanent individual-file deletion, or uninstallation in this slice. Code Editor has a separate reversible file bin: source keys move under `recycle-bin/<original path>` and remain in saved projects, recovery drafts and exports. Restore refuses collisions. These files count toward project limits but are omitted from new preview/install snapshots. Rename and bin moves do not rewrite source references. Trashed projects count toward the 128-project and 64-MiB limits. Restore keeps the same ID and files; source revision and update time advance. See [Trash acceptance and limits](TRASH.md).


## Library — 2026-10-08

Media metadata and positions share the validated atomic state store; the original bytes live separately in private, content-addressed files under the data directory. Blob creation completes before catalog commit. A failed/interrupted catalog commit can leave an orphan that still counts toward the physical quota and can be reused after digest verification. Copy the entire stopped data directory for backup; JSON alone omits media.

The browser supplies mature image/audio/video decoding and controls. Plain UTF-8 books and EPUB chapter text are paginated and rendered as text; PDFs render one page at a time with an accessible text disclosure. PDF.js 6.4.299 and zip.js 2.20.0 are pinned under `apps/desktop/library-vendor/`, with all asset hashes, package integrity values and licenses retained. EPUB archives are read in memory, never extracted to the filesystem. Script/interactive document content is not executed. PDF pages, canvas dimensions, EPUB expansion and operation time are bounded; these are application checks, not process isolation. Filenames never become host paths, and imports are signature/category checked without executing their contents on the server. Missing or altered blobs fail clearly. Full decoding and codec compatibility are established only by browser tests, not header sniffing.

A separate per-process HttpOnly cookie and same-origin request checks authorize native player/image requests, while catalog, import and progress use the desktop API token. The runner receives no media capability or Library CORS grant. Explore’s separate fixed educational endpoints grant the exact desktop origin access only to their public lesson data; this does not expose media or platform APIs. Single byte ranges support native seeking. Reads currently buffer and hash the entire bounded file before sending, including seek ranges; two reads and one upload may be active. This is a small local prototype, not Linux resource isolation or a promise of Pi playback performance.

Imports are exposed as developer operations in the trusted desktop; they are not authenticated parent controls. Pending position writes remain in browser memory with retry until acknowledged. See [Library behavior and verification](LIBRARY.md).


## Multiple desktop windows — 2026-10-08

The shell retains connected window elements and app frames until close succeeds. A separate window manager owns stacking, geometry, pointer capture, taskbar switching, maximize and compact layouts. Tools remain single instances; installed app/version and game identities can run alongside one another. Desktop rendering refreshes the relevant tool without replacing the workspace or other running frames. Window geometry is saved in the workspace introduced in schema 5 and retained in schema 6; live frame memory remains browser-session state. Media pauses on hidden-window transitions, while ordinary floating-window focus changes preserve playback. Score messages resolve their exact registered game source rather than whichever game has focus. See [window behavior and verification](WINDOWS.md).

## Workspace recovery

The workspace introduced in schema 5 and retained in schema 6 stores bounded window identities and tool state separately from app execution. Reload obtains fresh runner URLs rather than persisting capabilities. A serial, revision-checked workspace API retains an unsaved editor copy with its original source revision; it does not save the project or grant app frames any new authority. Lost responses are reconciled before retry; workspace reads await earlier admitted workspace writes, including a commit after client disconnect. Genuine competing-tab changes stop writes. See [WORKSPACE.md](WORKSPACE.md) for recovery timing, conflicts and verification.


## Explore and local family Mailbox — 2026-10-08

Explore serves original fixed educational content from `/explore/` on the separate runner. Its handler has no Store reference, generic proxy or child-code evaluator. HTML forms accept bounded fixed choices and return genuine HTTP responses without persistence. The trusted Request lab sends only fixed requests with omitted credentials, no redirects and no platform token; it displays response text and metadata. Frames allow scripts/forms without same-origin authority, and their narrowly checked messages can report only a known local site/path. Workspace recovery stores the site ID, not frame state, URLs or credentials. See [EXPLORE.md](EXPLORE.md).

The `mail` map holds local people, drafts and sent messages. Named mailboxes are convenience labels, not authenticated users. Draft writes use revisions and idempotent retry checks; sending converts the saved draft identity into a durable receipt so retries do not create duplicate letters. A mismatched send receipt preserves local text and offers a new draft copy. Autosave keeps edits that arrive during an in-flight write; closing waits for success. Read markers belong to the recipient view; Trash is per mailbox and reversible. There is no external delivery, SMTP, permanent delete or child-app mail capability. Limits are 12 mailboxes, 100 drafts, 1,000 letters, 120 subject characters and 16,000 body characters. All letters render as plain text. See [MAILBOX.md](MAILBOX.md).

## Application-wave verification — 2026-10-08

The Debian ARM64 app-wave suite completed 194 tests: **190 passed, 0 failed, 4 platform-specific skips**. The matching macOS/ARM64 suite passed **194 tests, 0 failed**, with Node.js 22.22.3; its earlier 183-test run remains historical. Targeted browser checks covered local send/receive/read/reply and draft close/reload/Trash restoration, PDF pages/favorite, EPUB chapter reading through page 4 of 6, and actual Explore form POST/HTTP 200 plus JSON inspection. Browser file checks also verified new/rename/bin/save/restore with exact recovered text and changing the desktop default while retaining both installed versions. Export showed success but browser-download bytes remain unverified after a tool timeout; API import/export round trips pass. Additional macOS checks verified project import/duplicate, Moon Hopper completion/saved score/replay/pause, Tiny Racer steering/pause and Tablet/TV layout switching. Packaged pilot.9 Linux startup retained windows and the editor draft. The final native VM walkthrough verified the Moon Post stylesheet, styled POST answer with HTTP 200, and location-script address update; evidence is recorded in the Linux VM guide. This record does not extend VM results into physical Pi, full accessibility, arbitrary media, child-code containment or authenticated-parent acceptance. The earlier 145-macOS/141-Linux-plus-four-skips foundation evidence above remains historical.
