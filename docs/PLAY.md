# Play: two games and editable copies

Moon Hopper is a 40-second moon run: Space/↑/W or the Jump button clears rocks and collects stars. Tiny Racer is a 40-second three-lane drive: ←/→/A/D or the arrow buttons steer around cones and toward stars. Both have pause/resume (P or Escape), a finish state, replay, score, best score, stars and seconds remaining. Enter starts or resumes from the canvas; native Enter/Space button activation is preserved. Movement buttons are disabled while paused or before a round. The How to play panel explains goals, scoring, tap areas, keyboard controls and automatic pausing; opening it pauses an active round. Changing browser focus, hiding the page, or minimizing the window pauses an active round. Restoring leaves it paused until the child resumes.

All drawing, controls, game rules, and assets are local. No package download or external media is needed. The plain home screen remains a desktop; Play is opened from its shortcut or Start.

## Make a copy

1. Open Play and choose **Copy to My Stuff** on a game. Its independent source copy opens in Code Editor with `script.js` selected.
2. Edit `script.js` to change settings such as speed, player color, or jump height. `engine.js` contains the rules; `play.js` draws and controls the game; `style.css` styles the page.
3. Save and preview the project. Install an explicit version to add your remix to the desktop.
4. Make another source edit. The installed version and original game remain unchanged.

The six copied text files are real project files, not references to shared editable source. Installation has the existing schema-1 web-app manifest and `permissions: []`. Original-game scores persist when launched through Play. Remix scores last only while the window stays open; a general persistent app-data permission is future work.

## Scores and upgrades

Results save after a completed or crashed round. Best score never decreases; rounds and wins accumulate. Retrying a recent round does not count it twice. A save failure exposes **Retry save** and keeps pending results in that open window. Keep it open until the saved message appears. The pending queue is not durable until the server confirms the save. Service restart renews the desktop session on its next request; saved scores reload when a game is reopened.

The schema-2 migration adds game progress without modifying existing source projects or installed snapshots. An exact pre-upgrade primary is retained in `state.pre-v2.<uuid>.json`. The normal previous-commit recovery file continues to protect writes; it is not a complete backup history. Follow the whole-data-directory backup instructions in DAY0.md.

## Verification — 2026-10-08

The Play slice passed **32 tests**. Later Trash tests extend that suite; see TRASH.md for the current verification record. Play checks cover:

- Jump/landing, no double jump, collisions, one-time star collection, bounded lane steering, paused state, finish bonus, repeatable obstacle layouts, and simulated completion of both shipped games.
- Exact schema-1 project/install preservation, retained original migration file, independent game histories, concurrent results, duplicate retries, restart persistence, invalid result rejection, and corrupt-progress recovery.
- Score messages rejected from other windows, normal origins, installed apps, and malformed payloads; duplicate in-flight results coalesced and save errors acknowledged.
- Local asset serving, restrictive runner response policies, source-copy independence, installed remix snapshot independence, and score persistence across an actual killed service process and fresh process.

During the Play slice, browser automation was blocked by unavailable administrative security-policy verification, and automatic approval review rejected a follow-up browser-access attempt. Browser access now works and was used for the Trash slice. This turn did not run Play gameplay acceptance: no canvas keyboard/touch behavior, focus/minimize behavior, or game visual acceptance result is claimed. The game rules and HTTP/storage paths are tested; these do not establish end-to-end browser execution under sandbox/CSP. Complete the manual checks below before accepting that boundary.

## Manual acceptance still required

Open each game, start using keyboard and on-screen controls, collect a star, collide, replay, pause/resume, switch away and return, minimize/restore, and complete a round. Check best score and run count after closing and reopening, refreshing, and restarting the service. Stop the service after a run, observe retry messaging, restart it, and retry while keeping the game window open. Check narrow tablet and TV layouts, including entering and leaving the frame by keyboard. Copy a game, edit `script.js`, preview, install, and verify both the remix and unchanged original.

No Linux containment, ARM64 or physical Raspberry Pi performance, TV remote/gamepad support, child profiles, audio, or general app-data capability is implemented or certified by this slice. Milestone 2 now includes project-folder Trash/restore (see TRASH.md); individual-file trash remains pending. The later Library slice adds bounded media import/catalog/search, native players and text reading; see LIBRARY.md for its format matrix and remaining readers. Code Editor now has a reversible source-file bin inside each project; that is separate from whole-project Trash.


## Everyday Play polish — 2026-10-08

The catalog now includes completed-round totals and expandable help. Copy to My Stuff opens the actual configuration source for customization. The player shows a countdown and star count, explains score/finish bonuses, announces phase changes without continuously announcing every animation frame, and accepts pause keys after on-screen buttons have focus. Opening help or leaving the window pauses play; the child explicitly resumes. Game rules, durations, saved best scores and immutable remix behavior are unchanged.

Two new DOM-fixture tests execute the actual player and shared engine to check keyboard start/replay, native button activation, movement, pause/resume, blur/help pausing and the visible HUD/finish state. Those plus the ten existing game rule/bridge tests and five project-tools tests pass (**17 total**). Full browser play-through, audio, gamepad/TV remote and physical Pi behavior remain acceptance work; no fixture result establishes those boundaries.
