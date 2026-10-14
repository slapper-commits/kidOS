# Native Files, Paint, Writer and Calculator in the disposable VM

Status: the bounded Paint → save PNG in Pictures → find in Files → reopen → Trash/restore workflow has been visually verified in the Debian ARM64 QEMU fixture, with exact byte preservation. This is Sean's authorized native-app demonstration, separate from the host browser preview and the installed kidOS pilot.9 service. It is not browser/My Stuff integration, a Pi result, or a giftable child account. Remaining acceptance is listed below.

On 2026-10-09, Writer and Calculator were added to this same supervised VM. Both launched visibly through F8, Calculator displayed `12.5 + 7.5 = 20` and a division-by-zero error, and F9 returned to kidOS. Writer's complete editing/save/reopen workflow remains unverified because the host UI automation failed pointer actions and delivered incomplete/repeated text and unreliable modifier chords. See the dated record at the end; installation and launch are not complete minimum-lovable acceptance.

## Components and user data

Signed Debian packages provide KolourPaint, PCManFM-Qt, GVfs and xdg-user-dirs, with their required dependencies, Breeze icons and Qt Wayland/SVG plugins. GVfs supplies local Trash support; the larger `gvfs-backends` collection is not needed for this local-folder slice. No alternate desktop, automount policy, package manager UI or host setting is installed by the launcher/setup code.

| Installed package | Version |
| --- | --- |
| kolourpaint | 4:25.04.0-1 |
| pcmanfm-qt | 2.1.0-2 |
| gvfs and gvfs-daemons | 1.57.2-2+deb13u1 |
| xdg-user-dirs | 0.18-2 |
| qt6-wayland | 6.8.2-4 |
| breeze-icon-theme | 4:5.116.0-1 |
| qt6-svg-plugins | 6.8.2-3 |

The initial installation added 252 packages without upgrading or removing existing packages. One later package, `qt6-svg-plugins`, supplied the missing SVG icon/image plugins: the first Paint window had blank toolbar icons despite installed Breeze assets; reopening after that addition displayed the expected icons. Full installed notices and hashes are retained in `work/linux-vm/evidence/native-files-package-notices.txt`, `native-files-package-verification.txt` and `native-files-svg-plugin.txt`. The temporary package channel was closed after both installations.

[`native-files.mjs`](native-files.mjs) accepts these fixed launch actions:

| Action | Program and destination |
| --- | --- |
| `paint` | `/usr/bin/kolourpaint`, with Pictures as its working directory |
| `writer` | `/usr/lib/libreoffice/program/soffice --writer`, with an explicit shared private profile and Documents as its working directory |
| `calculator` | `/usr/bin/kcalc`, with Documents as its working directory |
| `files` | `/usr/bin/pcmanfm-qt --profile=kidos-files /home/kidos-test/Pictures` |
| `documents` | The same PCManFM profile at `/home/kidos-test/Documents` |
| `downloads` | The same PCManFM profile at `/home/kidos-test/Downloads` |
| `trash` | The same PCManFM profile at `trash:///` |

The ordinary `kidos-test` user owns Pictures, Documents and Downloads. App preferences and cache live in `~/.local/share/kidos-native-files/{config,cache}`. Only this test profile associates PNG with `org.kde.kolourpaint.desktop`; the global MIME preferences are not overwritten. `XDG_DATA_HOME` remains the ordinary user's `~/.local/share`, so GVfs uses normal user Trash. Diagnostic logs append under `~/.local/share/kidos-native-files/`. Back up the drawings and user Trash as well as those preferences when preserving this demonstration; the existing service backup does not include these folders.

The setup creates missing folders privately, refuses linked or differently owned paths, and never replaces existing preferences or creations. Initial preferences are written and synced to a temporary file before publication without overwriting an existing target. An interrupted pre-publication write leaves an ignored temporary file, not partial active settings; a conflicting file created meanwhile is preserved. Logs open nonblocking before regular-file validation. The earlier Paint/Files helper's SHA-256 was `22c0e245384d7918539cca054f871af4d4fcc31f7d99264e27344b1fe9f52746`; the later Writer/Calculator revision is recorded below. Each predecessor was preserved, and these updates did not reset preferences or restart applications.

The profile sets PCManFM `UseTrash`, `ConfirmTrash` and `ConfirmDelete`; disables automatic mounting, autorun and QuickExec; and launches only the file manager, never its desktop manager. These are UI preferences, not an execution sandbox. Native Files retains ordinary-user filesystem visibility, manual actions and permanent-delete options. The test account still has the VM's developer sudo authority. Do not treat these defaults as enforced child/parent controls.

The fixed wrapper [`native-files-launch.sh`](native-files-launch.sh) invokes the helper with one action. The helper verifies the ordinary VM identity against the protected fixture/installation receipt, requires the actual Wayland/D-Bus runtime, and runs root-owned package executables without a shell command string. No browser API, generic path argument, privileged operation, custom polkit rule or change to `kidos.service` is introduced. **F8** opens the application menu, **F9** returns to kidOS, and **F10** shows the compositor's named open-window menu. F9/F10 were verified during the native-game walkthrough. Alt+Tab retains the compositor default but its CUA delivery was unreliable, so it is not the verified handoff. Native windows are not members of the browser's taskbar or workspace recovery.

## Reproduce on the designated VM

The [VM recipe](README.md) owns target verification, package-channel setup and stopped-service backups. Its package owner must preserve/compare the existing private service data before and after installing packages, retain APT's signature checks and record the complete before/after package inventory. Do not run these instructions on the host or a household device.

Through the existing temporary, Debian-only package channel, install the explicitly reviewed packages using the fixture's private APT options:

```sh
DEBIAN_FRONTEND=noninteractive apt-get "${apt_options[@]}" install -y --no-install-recommends \
  kolourpaint pcmanfm-qt gvfs xdg-user-dirs qt6-wayland breeze-icon-theme qt6-svg-plugins
```

Before executing that command, confirm the actual package plan; dependencies and current installed packages determine what changes. Record exact versions and `/usr/share/doc/PACKAGE/copyright` notices. PCManFM-Qt is GPL-2.0-or-later. The installed KolourPaint notice identifies main code and pictures as BSD-2-Clause, additional LGPL components, MIT AppStream metadata and GFDL-1.2-or-later documentation. Preserve the full distro notices, not just these summaries. [PCManFM upstream](https://github.com/lxqt/pcmanfm-qt), [KolourPaint upstream](https://apps.kde.org/kolourpaint/).

Copy the source helper to `/opt/kidos-linux-test/native-files.mjs` as root-owned 0644 and the wrapper to `native-files-launch.sh` as root-owned 0755. Keep the existing protected `target.mjs` adjacent. Then, as the ordinary `kidos-test` user, run this non-GUI setup with the fixture's exact UUID:

```sh
/opt/kidos-node/v24.21.0/bin/node /opt/kidos-linux-test/native-files.mjs \
  --setup --disposable-vm-id EXACT_VM_UUID
```

The shared labwc menu owner adds simple Execute entries for the fixed wrapper actions, preserving the game entries, compositor bindings and kiosk autostart. For example:

```xml
<item label="Paint"><action name="Execute" command="/opt/kidos-linux-test/native-files-launch.sh paint" /></item>
<item label="Files — Pictures"><action name="Execute" command="/opt/kidos-linux-test/native-files-launch.sh files" /></item>
<item label="Trash"><action name="Execute" command="/opt/kidos-linux-test/native-files-launch.sh trash" /></item>
```

Use simple Execute here: the installed labwc 0.8.3 menu parser did not execute the first game menu's nested conditional ForEach blocks. Avoid overlapping writes to `native-games-menu.xml`; preserve any live configuration before installing its combined successor. Close the temporary package channel before acceptance. Start apps only from the actual visible labwc session, not by reconstructing a GUI environment through SSH.

## Verification and acceptance

The focused native-files suite passed **7/7 on macOS and 7/7 on Debian ARM64 with Node 24.21.0**. It covers fixed-command rejection, preservation on setup rerun, linked-folder/preference refusal, actual SIGKILL during a partial configuration write followed by retry, preservation of a concurrently created preference, and FIFO-log rejection with a subprocess timeout. Node/shell syntax and macOS launch refusal also passed. The Linux result is `work/linux-vm/evidence/native-files-linux-tests-final.txt`; deployment is recorded in `native-files-helper-update.txt`. These are targeted results, not a new full-suite count.

The actual CUA walkthrough opened Paint through F8 and drew a 400×300 picture: a red rectangle containing a blue-outline, yellow-filled ellipse. The PNG dialog saved `/home/kidos-test/Pictures/kidos.png` as a 4,131-byte PNG, UID/GID 1000, mode 0600. After Paint closed, Files displayed its thumbnail. Selecting the file and pressing Return invoked the configured Paint handler and showed the same drawing with the corrected toolbar icons. Closing without edits preserved its bytes.

Files' **Move to Trash** action displayed an explicit confirmation. After confirmation, Pictures was empty and native Trash contained the drawing with the original-path `.trashinfo` record. **Restore** in Trash returned it to Pictures and removed both the trashed file and its metadata. The original, reopened, trashed and restored bytes all matched SHA-256 **`ad8b08084e1309073ec1732fa76f0f424fe63e10da3b3132bfc0892875fbedfe`**. The restored PNG then reopened visibly in Paint with the drawing and toolbar icons intact. The native titlebar button also maximized and restored the Paint window. Evidence is `native-files-paint-saved.json`, `native-files-paint-reopened.txt`, `native-files-trash.json` and `native-files-restored.json` under `work/linux-vm/evidence/`; the Trash screenshot is `work/verification/native-files-trash.jpg`. All content was created for this test.

The final private-state comparison preserved projects, installed apps, games, mail, media, project Trash and the schema exactly; binary/media files also matched. Browser activity changed only workspace active-window identity, revision and window-list length, so the entire live state is not byte-identical. The service still runs as `kidos` with no capabilities, protected homes/private devices, strict system protection and `NoNewPrivileges`. See `native-files-kidos-state-diff.json` and `native-files-final-session.txt`.

Native move/resize remains unverified: a CUA drag did not move Paint. Rename/copy, guest reboot persistence, Alt+Tab delivery, USB devices, cross-device moves, interrupted copies, full disks, hostile files, administrative isolation, native/browser taskbar integration and physical Pi behavior are also unverified in this slice. The [everyday-computer proposal](../../docs/EVERYDAY-COMPUTER.md) retains those later gates. No source release was repackaged to include these native applications or the synthetic drawing.

## Writer and Calculator milestone — 2026-10-09

The fixed launcher and compositor menu now include **Writer**, **Calculator**, **Documents** and **Downloads**, alongside Paint, Pictures, Trash and the existing games. This change is a supervised native-app milestone. The separate [desktop bridge](../../docs/NATIVE-APPS.md) is under active development; this record does not certify its launch routes or taskbar behavior.

Signed Debian packages installed `libreoffice-writer` and `libreoffice-qt6` **4:25.2.3-2+deb13u8**, and `kcalc` **4:25.04.0-1**, on the existing Debian ARM64 fixture. The package transaction added 63 packages, changed no existing package versions and removed none, using about 334 MB of disk. No full office-suite metapackage, external account, spelling dictionary or offline help package was added. The [Writer](https://packages.debian.org/trixie/libreoffice-writer), [Qt6 integration](https://packages.debian.org/trixie/libreoffice-qt6) and [KCalc](https://packages.debian.org/trixie/kcalc) package pages identify the upstream inputs. Full installed package notices and their hashes are retained in `work/linux-vm/evidence/writer-calculator-package-notices.txt`; LibreOffice's main code is MPL-2.0 and KCalc has GPL/LGPL component notices. Preserve the complete notices when packaging an image.

The exact real executables and all their system ancestors were inspected as root-owned, non-writable by group/other, ordinary files/directories. `/usr/lib/libreoffice/program/soffice` is the real launcher rather than the `/usr/bin/libreoffice` symlink. Its installed `bootstraprc` declares `UserInstallation=$SYSUSERCONFIG/libreoffice/4`. The launcher explicitly selects `~/.local/share/kidos-native-files/config/libreoffice/4`, matching the shared `XDG_CONFIG_HOME` default used by Files' packaged MIME handler. Both the profile and its parent are checked. Shared `SAL_USE_VCLPLUGIN=qt6` and `QT_QPA_PLATFORM=wayland` select the installed Wayland UI. An existing Files process from before deployment retains its previous environment until it is closed and reopened normally; Files→Writer acceptance remains pending.

Review caught and corrected an initially different Writer profile before deployment. Setup preserved all three existing preference files and the existing saved creations. The deployed helper SHA-256 is `a7a835d29e62a87d45a152ca3b14f8125db07c7e538dc1a966cde2f09a48923e`; `writer-calculator-launcher-deployed.txt` records the helper, wrapper and menu hashes. The helper/VM menu source is excluded from the Pi archive, and these applications were not added to a distributable image.

Before package changes, the stopped service's entire data directory was copied and compared exactly. Saved native folders, app preferences, compositor configuration, install receipt and package inventory were also preserved under `/var/lib/kidos-linux-test/before-writer-calculator.nbsQCd/`. The graphical session was kept running because Paint contained an existing unsaved drawing. After installation, all prior package versions, Documents/Pictures/Downloads bytes, service content outside ordinary workspace state, and media bytes matched their baseline. `writer-calculator-preservation.json` records the comparison. The platform service remained under its existing locked identity with protected homes/private devices and no capabilities; no home/device API or parent authority was added.

The first APT index refresh found the paused VM's clock behind the signatures' validity time and retained previously verified indices. Signature checks were never disabled. Correcting only the disposable guest clock to current UTC allowed a clean signed refresh; see `writer-calculator-clock-refresh.txt`. The temporary Debian-only proxy and reverse tunnel were stopped before graphical checks, and the guest retained no default route. No host network, DNS, trust, firewall or boot setting changed.

Verification in this milestone:

- The focused native-launcher suite passed **11/11 on macOS** and **10 passed with one host-specific skip on Debian ARM64**. It covers fixed commands, unknown/extra argument refusal, preservation, linked/unsafe profile paths, interrupted preference publication and FIFO logs. Evidence: `work/verification/mlp-native-tests.txt` and `work/linux-vm/evidence/writer-calculator-linux-tests.txt`.
- A point-in-time full macOS run passed **206 tests, zero failures** (`work/verification/mlp-final-tests.txt`); the earlier baseline passed 201. Other desktop integration work was progressing in the shared checkout, so this is not a release certification or a full Linux regression result.
- F8 visibly launched KCalc and Writer. Calculator showed `2 + 3 = 5`, `12.5 + 7.5 = 20`, and **Math error** for division by zero. Writer displayed a real blank document with its normal menus/toolbars. F9 returned to kidOS. These observations are in the conversation's CUA captures.
- The host automation returned `noWindowsAvailable` for pointer clicks and delivered incomplete/repeated text and unreliable modifier chords. No successful Writer save/reopen, formatting, image insertion, PDF export, Calculator copy/pointer controls, native reboot persistence or physical input result is claimed. The unsaved synthetic Writer scratch text is not a saved story. The prior Paint drawing and existing applications were left open; no reboot was attempted.

Complete the [minimum lovable acceptance sequence](../../docs/ROADMAP.md) before calling these apps ready for everyday child use. The immediate next proof is a story with a drawing saved to Documents, reopened through Files using the same Writer profile, and exported to a readable PDF, followed by integrated desktop launch and restart recovery.

### Unlocked-host follow-up — 2026-10-09

After Sean unlocked the Mac, actual F8/F9/F10 keyboard navigation worked. F8 opened a new Writer document, the introductory tip was dismissed, and the text `The kite` was entered. F6 and arrow navigation reached Save and displayed the Documents dialog. Save produced a real 9,280-byte ODT owned by UID 1000; its ZIP integrity and ODT media type passed inspection, and its saved paragraph was exactly `The kite` (SHA-256 `1e0389bd76c0adf8cc6d4e2b049f9e15701f5af6fedd7137708bd8bc3c24c441`). This establishes only native launch and a limited save operation.

The automation still failed pointer clicks with `noWindowsAvailable`, ignored Control modifiers and omitted/repeated input characters. The filename therefore differs from the intended test name and includes repeated letters. Further deliberate key input also failed to produce an exact body. Formatting, controlled filename entry, image insertion, reopen, PDF and pointer acceptance remain pending; the saved title does not pass the story workflow. Evidence is `work/linux-vm/evidence/pi5-writer-limited-save.json`. The synthetic Writer document remains open with additional unsaved test input; it was not used to replace any existing creation.

Before this attempt, all live service data exactly matched a private point-in-time copy at `/var/lib/kidos-linux-test/before-pilot11.XUTrwF/`, alongside native files/preferences and installation receipts. This is not a stopped-service backup. A stored editor recovery draft with three files was verified separately. The original Paint process, PID 5102, remained alive; the compositor and other native applications were not restarted. The service still runs pilot.10 and the earlier bridge. Closing Chromium to load the reviewed pilot.11 launchers was blocked by automatic approval review pending explicit confirmation; no browser restart or live candidate deployment occurred. F9 returned the visible session to kidOS.
