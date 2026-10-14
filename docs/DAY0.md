# Day 0: a project becomes an app

## Scope and implementation plan

The starting repository contained a health-only Node.js service, smoke tests, product/architecture plans, and an interactive design reference. It did not contain a working desktop, editor, persistence layer, app registry, or runner.

The first slice follows this sequence:

1. Serve a standalone desktop derived from the approved visual reference, with local assets, computer/tablet/TV layouts, Start navigation, and explicit future-feature states.
2. Create a Color Lab HTML/CSS/JavaScript starter; expose My Stuff, an editor, save, preview, and JSON export.
3. Validate and persist source projects and an app registry in a versioned disk store, using recoverable writes and safe logical paths.
4. Define a versioned app manifest. Install a named app version as an immutable file snapshot; launch it from the desktop on a separate browser origin.
5. Verify editing, installation, version isolation, restart persistence, rejected inputs, recovery, and browser behavior. Record local results without claiming Linux or Pi validation.

See [architecture decisions](ARCHITECTURE.md), [the manifest contract](../packages/app-contract/README.md), and [asset provenance](PROVENANCE.md).

## Manual acceptance walkthrough

Run the commands in the [README](../README.md). Keep the same `KIDOS_DATA_DIR` setting throughout this walkthrough, if using one. Open the desktop at `http://127.0.0.1:8787/`.

1. Open **My Stuff → Projects → New project…**, enter a recognizable name such as **My color lab**, and choose **Create project**. The new folder contains `index.html`, `style.css`, and `script.js`. Open a file to launch Code Editor.
2. Select `index.html`, change visible text, and choose **Save** (or Ctrl/Cmd+S). Switch among the three file tabs and check the saved content. **Preview** runs the current saved source; when the draft is dirty, **Save & preview** saves before running.
3. Enter version `1.0.0` and choose **Install app**. If there are unsaved edits the action becomes **Save & install**, so the installed snapshot includes them.
4. Return to the desktop. Open the new app’s desktop shortcut, or find it in **My Stuff → Applications**. Check that the visible title/version identifies the installation and the Color Lab works.
5. Return to **My Stuff → Projects**, open the project folder and its `index.html` file, change the visible text again, and save. Launch the installed `1.0.0` app: it must still show the first text. Preview the source: it must show the new text.
6. Try to install the changed content as `1.0.0`. It must fail with an understandable version conflict. Change the version to `1.0.1` and install. Launch it, then use the app window's **Version** chooser to reopen `1.0.0`; each must retain its own content.
7. Choose **Export project** inside the project folder in **My Stuff**. Inspect the downloaded JSON: it should contain `{schemaVersion: 1, project}` with the saved project name and source files. It does not include installed app snapshots. Use Projects → Import project… to import this JSON into a new project. A downloaded recovery draft can be imported the same way. Review the name and file count before importing; nothing runs automatically and existing projects are not overwritten.
8. Stop the service with Ctrl+C. Start it again using the same command and data directory. Reload the desktop. Reopen the saved project and both installed versions. Check the second source edit, unchanged `1.0.0`, and updated `1.0.1`.
9. Switch to **Tablet** and **TV** modes. Confirm each core area can be opened and closed, the installed app remains available, and navigation works with the keyboard. In TV mode, check arrow-key focus and Enter activation. Use a narrow viewport to check the editor and navigation for clipping.
10. Open **Play**, **Library**, **Explore**, and **Mailbox**. Play offers two games and Library supports the documented local formats. Explore and Mailbox still identify private networking and family mail as future work. There is no parent sign-in or settings screen yet; Personalize only changes wallpaper.

Unsaved drafts remain separate from the saved project. The workspace service persists a recovery copy; wait for **Recovery copy saved** before leaving. **Save** commits the source project. Download draft provides an extra portable copy when recovery is unavailable. Switching between projects offers a save/discard/cancel choice. If another window saved the same project, use **Reopen saved** to load the latest copy; its guard lets you keep editing or explicitly discard the local draft. Copy any draft edits you want to keep before discarding them. A saved project is on disk; a selected display mode is a browser preference.

## Verification record

Verified on 2026-10-08 on macOS with Node.js 22.22.3: all 20 automated tests passed. The HTTP tests exercised the core workflow and a real process crash/restart. Independent storage, server, and desktop code reviews were completed and their identified issues corrected. The browser automation tool could not run because its required administrative security-policy verification was unavailable; no browser result is claimed. That earlier browser blockage no longer applies: the follow-up Trash slice verified selected browser interactions, listed below. Complete the remaining walkthrough before accepting the full milestone.

| Check | Evidence/status |
| --- | --- |
| Automated tests (`npm test`) | Original storage/contract and HTTP/process coverage plus game rules, score bridge, migration, progress, remix, and Trash coverage; see ROADMAP.md for the latest suite count |
| Create/edit/save/install/launch in the browser | Passed targeted macOS browser checks during the Trash slice: create project, edit source, Save & install, launch installed snapshot, run its classic script by clicking Ocean, and preview a later source revision. Full version-picker/export/restart browser walkthrough remains pending |
| Source edits leave installed snapshots unchanged | Passed: both old and current installed versions retain their own exact bytes and digest after source edits and restart |
| Restart restores projects and installed versions | Passed: orderly service restart and actual spawned-process SIGKILL followed by a fresh process |
| Validation, path safety, recovery, browser-to-platform protections | Passed automated checks for malformed/oversized input, raw path traversal, unsafe store symlinks, revisions, corrupt-state recovery, immutable digests, writer locks, Host/Origin/token checks, and sandbox/CSP response headers; independent code review completed |
| Computer/tablet/TV and narrow viewport navigation | Targeted browser checks passed for Trash/project folders: computer layout, 390×844 tablet viewport without horizontal overflow, Enter restore, TV dialog arrow focus and Escape cancel. Comprehensive keyboard/touch/controller checks remain pending |
| ARM64 Linux / physical Raspberry Pi | The earlier bounded Debian ARM64 VM service/recovery/desktop slice passed; see ARCHITECTURE.md. These new file and app controls still need their own integrated browser/Linux checks. Physical Pi remains untested; no hardware owned |

## Persistence and local recovery

The default data directory is `.data/` at the repository root. A custom `KIDOS_DATA_DIR` is appropriate for data kept outside the checkout. It must be private to this local installation; never share it between concurrently running instances or put it into a gift image.

Writes retain a previous valid state so that startup can recover from a damaged current state. Recovery may lose the last successful change. Corruption that cannot be safely recovered must stop startup with a useful error rather than reset to an empty family. A schema version newer than this service supports requires matching software; do not downgrade or edit the version field to force it open.

Windows and acknowledged unsaved editor recovery drafts also persist in the service data directory. This does not persist arbitrary app memory or eliminate the risk of unacknowledged edits being lost. See [WORKSPACE.md](WORKSPACE.md).

For a manual whole-installation backup: stop the service, copy the entire data directory to another location, and restart. To restore that backup, stop the service, preserve the current directory separately, and start the service with `KIDOS_DATA_DIR` pointing at the restored copy. These are developer file-copy steps, not a tested parent-facing backup/recovery product. Keep exports outside the data directory as additional copies of individual projects.

## Deliberate limits

- The default Color Lab starter is a small web app. Play now supplies two separate original game sources; see PLAY.md for their acceptance status. Text editing has no language server, dependency installer, arbitrary host-file access, or server-side child code. Version-1 kidOS JSON source and recovery draft imports are supported.
- App permissions are explicit but no privileged permission is granted in Day 0. There are no filesystem, microphone/camera, mail, network, or parent capability APIs.
- The browser runner is not operating-system containment. It has no enforced Linux CPU/memory limits, hardened egress policy, per-app OS identity, or persistent app-data API. It is not ready for untrusted imported apps.
- Source project data and installed app files survive restarts. Arbitrary installed-app state is not persisted. The two original games launched through Play now save scores through a restricted built-in bridge; copied remixes keep practice scores only.
- No authenticated parent setup, unique family credentials, multiple households, LAN access, backup UI, signed updates, recovery image, or factory reset exists.
- Browser layout checks on the development machine do not verify touch hardware, a TV remote/controller, Linux behavior, or Raspberry Pi performance.
- JSON export/import and duplicate preserve source in separate projects. Installed-version selection changes the desktop default without deleting snapshots. Uninstall, app data migrations, and a complete update/rollback policy remain future work; operating-system rollback is not implemented.

The [giftable checklist](GIFTABLE.md) remains a release gate, not a claim about this prototype.

## Desktop refinement — 2026-10-08

The home screen now uses everyday desktop shortcuts, a live clock, minimize/restore, and optional wallpaper colors. The app-creation CTA and workshop entry point were removed from the desktop and Start menu. My Stuff is a folder browser: Projects → project folder → source file opens Code Editor. New projects are created inside Projects; installed versions remain ordinary shortcuts and Applications entries. Minimize hides the window without removing its live editor or app frame. These presentation/navigation changes are syntax-checked and code-reviewed. The later Trash slice added targeted browser rendering/input verification; see the table above and TRASH.md. Full desktop acceptance remains pending.


## Everyday source and application controls — 2026-10-08

My Stuff adds name search and sorting for Projects, Applications and project Trash; source folders can be searched by path. Projects can import a version-1 kidOS export or `kidos-recovery-draft` JSON up to 2 MiB. The service validates the existing format, name and text paths, then generates a fresh project identity and revision. Imports do not launch, install or replace existing content. Use trusted local source while OS containment is pending. Duplicate makes a new independent source project; if its original is open with unsaved edits, the confirmation explains that those edits are saved first. Neither operation copies installed snapshots.

Code Editor can add an empty text file, rename a source file, and move files into a project-local **file bin**. `index.html` is the fixed entry point and cannot be renamed or removed. Rename does not rewrite HTML/script references. The file bin uses `recycle-bin/<original path>` in the same project map, persists with Save and recovery drafts, and stays in exports. Restore returns the exact text to its original path and refuses to overwrite a replacement file. Bin files count toward the 32-file/1 MiB limits. Very long/deep paths cannot be moved if the extra bin prefix would exceed the existing path bounds; that operation fails without changing source. There is no permanent-delete action. New previews and new installations exclude files under `recycle-bin/`, so removed source is not runnable in those snapshots. Already-installed versions retain their exact original bytes, including any formerly valid path with that name; restoring or removing current source cannot rewrite an older installation.

Applications exposes every installed version with **Open version** and **Use on desktop**. The latter changes the default shortcut version without editing source or deleting versions. Existing open app windows keep their selected immutable snapshot.

Targeted automated verification for this slice: **17 passed**, covering the source operations, import envelopes, dirty-state removal detection, filtering, the existing game rules/score bridge, and new game-control behavior with a small DOM fixture. This fixture verifies actual player code and rules but is not a browser rendering or physical-input acceptance result. Integrated HTTP/storage, browser and Linux verification is tracked in the main milestone record.
