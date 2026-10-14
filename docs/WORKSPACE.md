# Workspace and draft recovery

kidOS saves the open window list, stacking order, active window, floating sizes and positions, minimized/maximized/snapped states, project folder, editor file and selected Library item in its local data directory. The next desktop session restores them. **Show desktop** remains minimized after reload. Layout and wallpaper preferences remain browser-local.

In the shell, **Ctrl+Alt+Left/Right** snaps the active window to half the desktop, **Ctrl+Alt+Up** maximizes it and **Ctrl+Alt+Down** restores its floating size. These shortcuts cannot capture keys inside a sandboxed app. Use a title bar or taskbar first. Narrow/Tablet/TV layouts retain the saved Computer arrangement while showing one full-size window.

## Unsaved work

Code Editor keeps a separate recovery copy of the current unsaved project name and files, selected file, version field and original source revision. Changes are debounced for 600 ms and written serially through the platform service. **Recovery copy saved** means that copy was acknowledged on disk. **Save** still updates the source project; installing, previewing and exporting retain their explicit source-save behavior.

After reload or service restart, recovered text opens as unsaved project changes. If the saved source changed elsewhere, the draft retains its original base revision so normal Save fails with a revision conflict instead of overwriting the newer project. If the project is unavailable or in Trash, the draft stays available to download. Restore the project through My Stuff as appropriate; its revision may have changed.

**Download draft** creates a local `kidos-recovery-draft.json` containing the draft name, source files and base revision without saving or overwriting the project. Automatic import of this file is not implemented; retain it as a recoverable text copy.

## Failures and limits

- A crash or power loss before acknowledgment can lose the latest edits. A browser exit warning is best effort. Recovery is not a substitute for a whole-directory backup.
- Recovery writes retry only when requested after an error. **Retry workspace save** preserves the current draft. A lost response is reconciled with the saved revision before writing again.
- Different browser tabs share one workspace. A genuinely newer workspace stops the older tab's recovery writes and shows a conflict. Save/download the edits you need before reloading; tabs never silently merge window arrangements or drafts.
- If initial recovery fails, new recovery writes stay disabled. Save/download new edits before reloading after service repair. **Retry local service** refreshes catalogs; it does not replay old recovery state over newly typed text.
- Up to 24 windows are supported. Temporary preview windows are excluded because their launch capabilities expire. Installed versions and built-in games reopen through fresh launch requests; no tokens or runner URLs are stored.
- The apps' arbitrary in-memory state and in-progress game rounds do not survive reload. Saved scores and Library positions use their existing persistence. Restored media remains paused.
- Only one editor project and one Library item are open at a time. The current workspace is for one local installation, not separate authenticated profiles.
- Browser recovery and the pilot service do not implement parent authentication, Linux child containment or device reset.

## Storage contract

Schema 5 adds `workspace` to the atomic state file. Its independent revision prevents concurrent replacement. Window identity, supported tool state, geometry, flags, source paths and total draft size are validated; arbitrary browser code is never evaluated during restoration. The authenticated GET/PUT API uses the same loopback, Host, Origin, request-size and session checks as other desktop operations. See [ARCHITECTURE.md](ARCHITECTURE.md) for migration and backup behavior.

## Verification — 2026-10-08

Targeted macOS browser checks at isolated loopback ports 8907/8908 verified opposite half-screen snapping, selected text-book page restoration, exact unsaved draft restoration after page reload and orderly service restart, unchanged source revision/files while the recovery copy exists, enabled restored editor actions, and all four windows remaining minimized after Show desktop followed by reload. The window manager tests cover geometry, snapped/maximized restoration, compact layouts and all-minimized state. Storage/API tests cover reopening the saved draft, stale revisions, source/Trash drift, bounded input, failed disk commits, migration and desktop authority. Sync tests cover serial writes, offline retries, lost acknowledgments and browser conflicts.

See [ROADMAP.md](ROADMAP.md) for the latest complete suite count. The later Debian ARM64 VM pass verified exact workspace/draft persistence through service restart, supervised crash recovery, backup restoration and offline reboot, plus visible draft/window restoration in Linux Chromium after boot and F5 reload; see the full-checkout VM record linked from ROADMAP.md. Physical power-loss durability, touchscreen/controller input and Raspberry Pi behavior remain unverified. Test media and project drafts are synthetic and excluded from release archives. Download draft also produced a local JSON file whose project ID, base revision and source bytes matched the recovered draft. The in-app browser event wait timed out; delivery was verified from the resulting file.
