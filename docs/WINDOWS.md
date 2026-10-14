# Desktop windows

Computer mode supports several open, overlapping windows. Open tools from the desktop or Start, and switch by clicking a window or its taskbar button. Clicking an active taskbar button minimizes it; clicking its button again restores it. Each window has minimize, maximize/restore, and close controls. Double-click a title bar to maximize or restore. Drag the title bar to move, or any edge/corner to resize. Windows stay within the available desktop above the taskbar.

**Show desktop** minimizes all open windows without closing them. Window contents remain mounted while switching, moving, resizing, maximizing, or minimizing: installed apps retain their live state and editor drafts remain available. Closing Code Editor offers save, discard, or keep editing when there are unsaved changes. Closing an app ends that running instance. Running apps fill the available window area; their version picker and snapshot details are under **About this version**.

Use **Ctrl+F6** to cycle open windows and **Ctrl+Shift+F6** to cycle backwards when focus is in the desktop shell. With a title bar focused, **Alt+arrow** moves it and **Alt+Shift+arrow** resizes it in 20-pixel steps. These shell shortcuts do not capture keyboard events inside sandboxed apps; use the taskbar to leave an app. Escape minimizes the active window unless focus is in an editable field or native media control. Ctrl/Command+S saves only when Code Editor is active.

Tablet and TV layouts show one full-size window at a time while keeping the others open. Use the taskbar or Ctrl+F6 to switch. Computer mode keeps overlapping windows even below 700 pixels. Returning to Computer restores the floating geometry, clamped if the screen has become smaller. The taskbar scrolls horizontally when many windows are open.

Library audio/video continues when another floating computer window is brought forward. Minimizing, closing, hiding the document, or hiding the Library in a compact layout pauses it and saves its position. Restoring leaves it paused. Games retain their iframe and use their existing focus-loss/minimize pause behavior.

## Scope and implementation

There is one open instance of each built-in tool (My Stuff, Code Editor, Library, Play, Explore, Mailbox, Personalize). My Stuff and Applications share the file browser. Code Editor still holds one project at a time, with the existing unsaved-project switching dialog. Library still holds one reader/player at a time. Different installed apps, installed versions, built-in games, and new preview snapshots can coexist in separate windows; launching an already-open identity brings it forward.

Window positions and open-window lists now persist through the platform service, along with a separate editor recovery draft. Installed apps reopen as new instances after reload; arbitrary in-memory app state is not saved. **Ctrl+Alt+Left/Right** snaps the active window, **Ctrl+Alt+Up** maximizes and **Ctrl+Alt+Down** restores. See [WORKSPACE.md](WORKSPACE.md) for exact recovery behavior and verification. This is a browser desktop window manager, not native Linux process/window management. No containment or parent authority was added.

The window manager keeps each window connected to the document until close succeeds. Focus and geometry changes update styles and attributes without reconstructing app frames. API transactions disable application actions temporarily while window focus, movement, resizing, and minimize remain available. Editor rendering reconciles the current project object even when the editor is behind another window. The exact registered built-in game frame determines score authority; installed and preview frames gain no new API access. A visible-page focus check reads only the parent document's active iframe element to handle browsers that omit parent focus events between two cross-origin frames.

## Verification — 2026-10-08

Initial window-manager slice: **83 passed, 0 failed** on macOS/Node.js 22.22.3. The suite includes 13 new window geometry/lifecycle tests and two new multi-frame game bridge tests. Coverage includes all eight resize directions, viewport bounds, compact geometry preservation, task switching, canceled asynchronous close, keyboard/pointer movement, concurrent game sources, closed/replaced frame rejection, and all prior storage/API/Library tests. Changed browser/service modules also pass syntax checks. Independent integration, CSS, and score-bridge review was completed. Later workspace recovery and Pi packaging checks are recorded in WORKSPACE.md and ROADMAP.md.

Targeted browser checks use isolated loopback ports 8907/8908 and synthetic media/test apps:

- Multiple tools and two installed apps remain open together; app counters and color selections survive opening other windows and switching layouts.
- Title-bar drag, corner resize, keyboard resize/movement, maximize/restore, and taskbar switching retain content and restore the measured geometry.
- Direct clicks from one sandboxed app into another raise the receiving app without consuming its first click.
- Unsaved source text survives taskbar switching; closing offers a dialog, Keep editing retains the exact draft, and Ctrl+S saves it.
- Library audio continues behind another computer window, then pauses when switching to Tablet hides it; its position remains available.
- Show desktop hides all five tested open windows without destroying them. Both built-in games open together, and switching away from a started Moon Hopper round leaves it paused with its score intact.
- At 390×844 the desktop has no horizontal document overflow and shows one full-size window with scrollable task buttons; the active task stays visible. TV mode supports Ctrl+F6 switching between retained windows.

The later Debian ARM64 VM pass verified real labwc/Chromium autostart, task switching, minimization, titlebar dragging, upper-corner resizing and workspace restoration. It also fixed stale iframe focus stealing an accepted drag or resize. See ROADMAP.md for current evidence. Physical touch/remote/controller input, native child-app window integration and Raspberry Pi behavior remain unverified. Screenshots and the test log are under ignored `work/verification/`.

## Desktop follow-up — 2026-10-14

Computer mode now retains floating windows at all widths; only explicit Tablet/TV modes use the one-visible-window presentation. Success notices float above the lower-right desktop and expire after five seconds. They no longer consume desktop height, reflow shortcuts, or permanently hide tiles that previously fitted. Errors and recovery notices remain dismissible and do not expire automatically.

The disposable Linux VM now launches Chromium as a maximized app window instead of fullscreen kiosk mode. Its labwc rule matches the observed `chrome-127.0.0.1__-Default` app identity, removes the outer decorations and keeps the desktop below native application windows. The rule intentionally does not match the page title: the title is populated after the window is first mapped. F9 focuses this exact desktop identity. This configuration is VM-specific; no Pi panel or host settings were changed.

Native windows and browser windows still use separate window managers. Native apps remain above browser-hosted tools; minimize a native window to expose a covered browser tool. The browser's Show desktop button and taskbar still manage browser windows only; F10 remains the VM's native window list. This bounded stacking fix does not claim complete native taskbar integration.

Verification: 290/290 automated tests passed on macOS; 281 passed with nine expected platform skips on Debian ARM64. The new regression exercises two visible windows at 640 CSS pixels, switching and minimize/restore. The installed pilot.16 source archive rebuilt byte-identically on both platforms (SHA-256 `50c79345de7d1a686b1e3cdc188649667d3f08e824ef3caaeda154b336e2f200`). Staging passed; all persistent service data compared byte-for-byte after deployment, excluding the running process's new `store.lock`.

Actual VM keyboard/visual checks showed Paint launching from its desktop shortcut while Files and Solitaire stayed open, followed by F9 desktop activation leaving all three native windows visible. Paint's shortcut retained its position, and the persistent top strip was absent. The compositor rule and browser wrapper were updated separately from the portable archive. Pointer automation returned `noWindowsAvailable`, so direct mouse clicking/dragging was not reverified in this session. Physical Pi checks remain pending. Evidence: `work/verification/desktop-fixes-full-authorized.tap`, `desktop-fixes-linux.tap`, and `desktop-fixes-native-windows.png`.
