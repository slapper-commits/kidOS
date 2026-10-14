# Project Trash and restore

Inside **My Stuff → Projects**, open a project folder and choose **Move to Trash**. Its saved files remain on this computer. Open **My Stuff → Trash** and choose **Restore** to return the same folder and files to Projects. Installed apps keep their original snapshots and remain on the desktop, including while their source is in Trash.

If that project has an open unsaved draft, the move offers **Save & move to Trash**, **Keep project**, and **Discard draft & move**. Discard moves only the saved source and discards the browser draft after the server confirms the move. Cancel and failed saves/moves retain the draft. Keep project is initially focused; Escape cancels. Drafts in other projects are unaffected.

**Refresh** reloads folder lists after changes in another window. Each move and restore advances the source revision. An older editor cannot silently overwrite a restored project; its save fails with a conflict and retains the draft. Copy any wanted edits before using **Reopen saved → Discard changes** to load the latest source.

## Persistence and boundaries

Schema 3 adds `trash: { [projectId]: { trashedAt } }` alongside the existing source projects, immutable app versions, and original-game scores. The project/export and app-manifest shapes are unchanged. Valid schema-1 or schema-2 primary state is archived byte for byte as `state.pre-v3.<uuid>.json` before migration. Recovery from an older backup preserves that backup in an archive too. Existing pre-v2 archives remain untouched. Unknown schemas fail closed. A migration that would exceed the 64-MiB state limit stops before changing primary, backup, or archive files; preserve the directory and use compatible older software to reduce saved source content before retrying. Follow DAY0.md for whole-directory backups before downgrading; an old backup omits later work.

Trashed sources cannot be opened, edited, newly previewed, exported, or installed until restored. Installed snapshots keep working, and previously issued temporary preview snapshots retain their normal lifetime. This is organization and recovery, not revocation of running apps or a security boundary.

This slice moves entire project folders. It has no individual-file deletion, empty Trash, permanent delete, automatic expiry, or app uninstall. Trashed projects still count toward the 128-project and 64-MiB store limits. Moving to Trash does not free disk space. Trash is not an independent backup against disk loss or deletion of the data directory.

## Verification — 2026-10-08

**Trash-slice `npm test`: 41 passed, 0 failed** on macOS with Node.js 22.22.3. Syntax checks passed for the changed browser and service modules. Automated checks cover exact source/app/score preservation, schema-1 and schema-2 migration archives, recovery from old backups, malformed Trash state, total project limits, a real near-64-MiB migration boundary, concurrent save/move/restore requests, stale requests after repeated move/restore, API token/origin checks, and unsupported operations. The HTTP suite also kills a real service process, starts a fresh one, and verifies that Trash survives and restores the exact saved source. Tests use isolated temporary data; loopback HTTP tests require local listening permission in the Codex sandbox.

Targeted browser checks passed on macOS in the Codex in-app browser with a fresh temporary data directory and loopback ports 8877/8878:

- Create a Color Lab project, edit its HTML, save/install version 1.0.0, and later launch the unchanged installation while its source is in Trash. Clicking Ocean updates the app's message, verifying classic-script execution under the current sandbox/CSP.
- Keep project cancels a move with a dirty draft intact. Save & move persists that draft; Restore reopens its saved text. Discard draft & move followed by Restore recovers the saved text without the discarded edit.
- A later source preview displays the new saved text while the installed version still displays the original.
- In two browser tabs, move and restore a project in one, then attempt a stale save in the other: the save is rejected and its unsaved text stays visible.
- Computer layout at 1280×720; Trash at a 390×844 tablet viewport with no document horizontal overflow; keyboard Enter restores; in TV mode Enter opens the move dialog, ArrowLeft moves focus between its choices, and Escape cancels.

Independent desktop and backend code reviews were performed. Review found and corrected post-save catalog-refresh ambiguity, long-name wrapping in dialogs, and migration capacity handling. Screenshots from the isolated browser fixture are kept under ignored `work/verification/`.

This is targeted acceptance of the Trash slice. Full Day 0 version/export/browser-restart checks, Play gameplay, physical touch/TV controllers, Linux containment, and Raspberry Pi behavior remain unverified. The later Library slice implements bounded media import/catalog/search and native players plus text reading; see LIBRARY.md for current acceptance.
