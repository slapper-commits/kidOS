# Native application session bridge

This opt-in bridge connects the exact kidOS desktop `http://127.0.0.1:8787/` to a fixed native app/folder catalog. The `0.0.1-pilot.15` candidate supports a registered ordinary user on Raspberry Pi OS Trixie 64-bit Desktop as well as the separately designated Debian 13 ARM64 VM fixture. It does not add a route, privilege or launcher to the `kidos` platform service. Pi installation remains pending; actual VM Applications buttons have opened Paint, OpenTTD, Calculator and Writer; macOS can display the catalog but cannot launch Linux apps. This is supervised integration, not child-account containment or parent authorization. Use the [Sunday Pi guide](../raspberry-pi/SUNDAY.md) for the installation sequence.

## Boundary and protocol

The static MV3 content script accepts only its own top-level window, exact origin and document URL. The extension worker independently checks Chromium's sender extension ID, frame ID, origin, document URL and tab URL. A narrowly scoped host permission makes tab URL checking possible; Chrome match patterns cannot constrain the port, so runtime checks enforce port 8787. Runner port 8788, opaque origins, other pages, child frames, extra fields and arbitrary commands are rejected.

Page messages target the exact desktop origin and use `source: "kidos-native-v1"`, `type: "request"`, a UUID `requestId`, and `method: "listApps"` or `method: "launch"`. Launch accepts one fixed `appId`: `paint`, `writer`, `calculator`, `files`, `documents`, `downloads`, `trash`, `puttzoo`, or `openttd`, in that catalog order. Replies have `type: "response"`, the matching ID, `ok`, and either `result` or a bounded fixed `error`. The catalog always contains those nine IDs and actual availability; the Pi has no Putt-Putt command and reports it unavailable. No path, URL, command, environment variable or user argument is accepted. Launch statuses distinguish process acceptance (`started`), a successful compositor activation request (`focused`), and a running game that needs the desktop's window switcher (`already-running`). A status alone does not prove that a window was visibly shown.

The worker permits at most four outstanding requests and sixteen requests per ten seconds. Native messages are capped at 4096 UTF-8 bytes, with the native-endian four-byte length checked before allocation. The host reads one request with a deadline; malformed, truncated, extra-frame and invalid UTF-8 inputs fail closed. Native stdout contains only the framed response; launched children receive no native pipe. Fixed errors do not expose internal paths or command output.

Chromium supplies the extension origin to the host. This authenticates the allowed extension caller, not the website; website identity is checked by the extension using the browser-supplied sender. The public manifest key pins extension ID `hmpnaimcljnkfhklmappjelokjmhdjce`; it is not a password or private key. The system host manifest permits only that extension. Installed sources and their receipt are root-owned and checked for links, ownership, write permissions, bounded size and exact hashes before use. Session checks require the appropriate target receipt, enrolled ordinary identity, real Wayland socket and inherited graphical environment. Format-1 receipts retain the explicit disposable VM UUID; format-2 receipts record physical-Pi target and the enrolled username/UID/GID/home. Neither accepts the other's target evidence.

The VM invokes its fixed app/game wrappers. The Pi uses protected package executables and fixed argument arrays from `native-launch.mjs`, with private settings under `~/.local/share/kidos-native` and ordinary Documents/Pictures/Downloads. Neither target uses a shell command string or caller-supplied arguments. Availability checks actual executables, required data and user folders/preferences. Running games retain their lock. The host may ask `/usr/bin/wlrctl` to find/focus individually fixed ScummVM or OpenTTD application IDs; it exposes no pointer, keyboard or arbitrary compositor command. The Pi does not install the proprietary demo or its data.

## Raspberry Pi installation

Use physical Pi hardware with Trixie 64-bit Desktop, retained Chromium/labwc, the pinned Node runtime, and the guarded kidOS service installed first. Choose an existing ordinary desktop user with a normal `/home/NAME`; do not use the reserved locked service name `kidos`. Run the Pi package helper from the verified installed source, then register that ordinary user:

```sh
sudo /opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos/current/os/raspberry-pi/native-packages.mjs --install-on-this-pi
sudo /opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos/current/os/native-session/install-pi.mjs \
  --install --desktop-user "$(id -un)"
```

Run those commands from the ordinary user's terminal so `id -un` selects that user before `sudo`. Package preparation uses the configured signed repositories and refuses removals. Registration verifies physical Pi/OS/runtime/service evidence and all required app executables/data before installing protected sources, hashes, a system Native Messaging manifest and the ordinary Pi menu's kidOS entry. It does not stop live applications or create their user preferences. A source update and a native-registration update are separate steps; rerun registration from the verified release when its native sources change.

Prepare user data and launch in that user's actual graphical desktop **without sudo**:

```sh
/opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos-native-session/native-launch.mjs --setup-user
/opt/kidos-node/v24.21.0/bin/node \
  /opt/kidos/current/os/raspberry-pi/kiosk.mjs --launch
```

Setup creates missing private directories and initial Files/MIME preferences while preserving existing preferences and creations. It refuses links, unexpected owners and writable-by-others paths; it does not chown a home or repair unsafe paths. The Pi launcher validates the optional registration before enabling the extension and uses its dedicated Chromium profile in a maximized application window. Save work and close an existing dedicated browser session before relaunching with a new registration. Keep the normal Pi panel for window switching, sound, input and power; no labwc XML or VM F8/F9/F10 binding is installed.

Optional `kiosk.mjs --enable-autostart` writes only the managed XDG entry `~/.config/autostart/kidos.desktop` after normal login; `--disable-autostart` removes it. The system menu entry uses the argument-free protected `reopen.sh`, which invokes the Pi launcher with its dedicated profile. Browser/native taskbar integration and native unsaved-memory restoration are not supplied.

For a local filesystem rehearsal, `node os/native-session/install-pi.mjs --stage EMPTY_DIRECTORY` writes an explicitly non-installable staging tree with a synthetic identity. Never copy that tree over a Pi's root: run the guarded live installer. Back up the complete stopped `/var/lib/kidos` separately from the closed desktop user's home, including native saves, Trash and browser profile. The [Sunday guide](../raspberry-pi/SUNDAY.md) has the continuous acceptance and troubleshooting checklist.

## Reload the bridge after an update

After installing changed native-session sources, reload the unpacked **kidOS native applications** extension in the dedicated kidOS Chromium profile, then reload the kidOS page. Chrome's [extension reload instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload-the-extension) require an extension reload for manifest and service-worker changes, and both an extension and page reload for content-script changes. Replacing installed files, increasing `manifest.version`, or restarting Chromium alone is not accepted as verification that the new worker is active.

1. Save current browser work. In the same dedicated Chromium profile used by kidOS, open `chrome://extensions` and enable **Developer mode** before reloading this local unpacked extension. The tested Chromium build disabled the extension when it was reloaded with Developer mode off; turning Developer mode on restored it without adding permissions.
2. Find **kidOS native applications**, ID `hmpnaimcljnkfhklmappjelokjmhdjce`, and choose its **Reload** control. Confirm the displayed version matches the installed `/opt/kidos-native-session/extension/manifest.json`.
3. Return to `http://127.0.0.1:8787/`, reload the page, and check **Applications**. Confirm an approved app opens from the desktop; a native Linux menu launch alone does not check the browser connection.

Use the same profile throughout; reloading an extension in another browser profile does not repair this one. Keep the existing profile and family data. The installer retains prior protected source files but does not operate Chromium's extension controls or clear its caches. Automatic bridge reload during upgrades remains unimplemented.

## Disposable-VM installation

Read [the VM target and SSH recipe](../linux-test/README.md) and preserve the current session and data. This installer does not start/stop the service, browser, compositor or applications, and does not create app preferences. The existing native app setup is a prerequisite. Copy this directory beside the source `os/linux-test/target.mjs` into a new temporary guest source directory, then run the pinned Node executable as root:

```sh
sudo /opt/kidos-node/v24.21.0/bin/node SOURCE/os/native-session/install-vm.mjs \
  --install --disposable-vm-id EXPLICIT-DISPOSABLE-VM-UUID
```

The installer validates the root-only disposable marker first, installs fixed sources at `/opt/kidos-native-session`, records hashes in `install.json`, and writes `/etc/chromium/native-messaging-hosts/org.kidos.native_session.json`. Shell entry files are installed mode 0755; modules are 0644. Existing registered sources are retained in a uniquely named previous directory during an update. Unknown or unregistered prior installations are refused.

Install the reviewed VM kiosk wrapper as root-owned `/opt/kidos-linux-test/kiosk.mjs`; the corresponding shared `kiosk-core.mjs` must be in the installed source release. The VM wrapper validates its separate native receipt before selecting the fixed extension path. It remains a separate target from Pi enrollment. Back up the existing labwc menu/rc before applying the fixed fixture XML. F8's first item, **Open kidOS**, and F9's no-browser fallback use the protected argument-free `reopen.sh`. Restart only Chromium through the real UI after these files and the source release are ready, then follow [the extension and page reload steps](#reload-the-bridge-after-an-update). Do not log out or restart the compositor while native windows have unsaved work. In this VM fixture, F9 returns to kidOS and F10 lists native windows.

The installed Debian Chromium wrapper supports the unpacked extension switch; loaded-extension discovery and four app launches have now been observed in the VM; each remaining path still requires its own graphical acceptance. This does not rely on branded Google Chrome supporting that switch.

## Verification and provenance

Run `node --test services/platform/native-session.test.mjs services/platform/native-apps-ui.test.mjs services/platform/native-pi.test.mjs services/platform/pi-pilot.test.mjs services/platform/linux-test.test.mjs`. Tests exercise page/worker/host boundaries, incomplete native framing, response limits, launch failures, fixed activation, target enrollment, safe user setup and Pi desktop startup behavior. Current candidate results are recorded in [ROADMAP.md](../../docs/ROADMAP.md). macOS/staging results do not certify the installed extension, graphical Linux behavior or physical Pi.

The corrected full suite passed **262/262 on macOS** and **253 passed, 9 skipped, 0 failed out of 262 on Debian ARM64**, using pinned Node v24.21.0 for Linux. Pilot.12 supersedes pilot.11: all nine IDs now pass the content script and worker, and browser reopening explicitly selects the already-validated Wayland session. Actual VM checks opened Paint, OpenTTD, Calculator and Writer; a second OpenTTD request focused the same game process, Calculator produced `7 + 3 = 10`, and Writer recovered two previous documents. The original browser and open apps were preserved using the VM-only separate-profile check helper. Folder/demo graphical checks and physical Pi acceptance remain pending. See [the current evidence and limits](../../docs/NATIVE-APPS.md#verification-and-limits); the earlier 255-test pilot.11 run did not catch the content-script mismatch.

At the earlier five-entry VM checkpoint on 9 October 2026, the then-current focused macOS run passed 40/40. Its full frozen suite passed 230/230 on macOS and 224/230 with six platform-specific skips and no failures on Debian ARM64, using pinned Node v24.21.0. The guest source snapshot is `/home/kidos-test/native-bridge.4OEHuF/full`, separate from the running service. The installed protected receipt passed hash verification, and all five actual catalog entries reported available. Menu and kiosk updates preserved labwc, Chromium, Files and the user's unsaved Paint processes; only the documented labwc configuration reload signal was sent. Existing combined menu entries were retained in full. Logs: `native-bridge-macos-tests.txt`, `native-bridge-linux-full-tests.txt`, `native-bridge-install.txt`, `native-bridge-installed-catalog.json` and `native-bridge-menu-install.txt`. These are historical results for that frozen source; real browser discovery, launch and repeat-game activation were still pending, and the counts do not verify the later Pi path.

For that VM bridge, signed Debian `wlrctl` 0.2.2-2 was the only additional package. Its upstream is Ronan Pigott's [wlrctl](https://git.sr.ht/~brocellous/wlrctl); Debian records the Expat license in `/usr/share/doc/wlrctl/copyright`, SHA-256 `3b8cd830315e2281639acca2555ce08eeb961623d8c40969c479cd036cdf1036`. The temporary package proxy and SSH reverse tunnel were closed after installation. Evidence is under `work/linux-vm/evidence/native-bridge-*`. The game/demo inputs and existing application licenses remain in the [native games](../linux-test/NATIVE-GAMES.md) and [native Files](../linux-test/NATIVE-FILES.md) records in the full checkout. Portable native source now belongs in the Pi candidate; VM wrappers/fixtures, live receipts, identities, proprietary demo data and user creations remain excluded. Retain the exact installed Pi package versions and complete distro copyright notices separately.

Primary references: Chrome [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [isolated content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [tab URL permissions](https://developer.chrome.com/docs/extensions/reference/api/tabs#type-Tab), Chromium's [unpacked-extension support clarification](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ), and the installed-version Debian [wlrctl manual](https://manpages.debian.org/trixie/wlrctl/wlrctl.1.en.html).

## Native appearance defaults

Ordinary-user setup also seeds missing Write profile, Calculator colors, KDE palette and `~/.config/labwc/themerc-override`. Existing preferences and recovery remain untouched. The labwc override is appearance only; it does not replace rc.xml, menu bindings, panel or session startup. Log in again after saving native work to apply window colors, or use an already-supported compositor reconfigure operation. New Paint, Calculator and Files processes receive fixed native stylesheets. Existing Write profiles require a separate closed-app migration. See theme/PAINT.md, WRITER.md, CALCULATOR.md and FILES.md. The active Linux appearance acceptance record is in docs/NATIVE-APPS.md; physical Pi remains pending.

## Puzzle Box

The `puzzlebox` identity opens a native GTK3 chooser using the protected system Python3.13 interpreter in isolated mode. Its protected catalog contains 40 fixed Debian puzzle executables; browser requests supply no game name, path, argument or environment. Six starter choices and the full searchable collection share this one entry. The native receipt now has 44 files, accepting complete prior 42-file receipts only after their recorded hashes pass; older supported exact receipt formats remain checked. Extension 1.2.0 and its matching protocol module add the 13th browser catalog identity. Apply the extension/page reload steps above after updating an existing browser profile. Physical Pi and full game acceptance remain pending.
