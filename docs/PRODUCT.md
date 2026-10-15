# Product scope

## Agreed
- A personal Linux-based computer that can eventually be gifted as a plug-and-play device.
- Simple retro desktop, Start menu, app launcher, My Stuff, Make, Play, Library, Explore and family Mailbox.
- Computer, tablet and TV presentation modes.
- Multiple live desktop windows with movement, resizing, task switching, minimize, maximize and snapping; compact layouts retain open windows while showing one at a time. Window arrangements and acknowledged editor recovery drafts persist locally.
- Two basic games with editable source and persistent progress.
- A media library covering video, music, audiobooks, books, comics and photos.
- Family Mailbox initially serves people sharing one computer; shared named mailboxes are not authenticated private accounts. Sean confirmed this local-first scope on 2026-10-08.
- An enclosed educational internet using actual network protocols, not simulated browser chrome alone.
- A child can create a project, write code, run it, install it as an app, and launch it from the desktop.
- A repeatable Raspberry Pi installation is the intended destination. Sean selected a Raspberry Pi 5 with 8 GB RAM on 2026-10-09 and requested installation by Sunday 2026-10-11. Prioritize a supervised usable Pi pilot before completing every private-web or family feature.

## Provisional defaults — not confirmed preferences
- Local imports and compatible playback formats; no subscription streaming or DRM integrations.
- Offline child use with parent-controlled imports and updates.
- JavaScript web apps for Day 0. Python services require a real containment boundary before child code can run; native graphical application packaging remains a decision.
- One household per installation; the expanded hardware rollout approved on 2026-10-14 follows the separate qualification gates below.
- No cloud AI dependency.

## Open decisions
Optional reading/typing assistance; final media format list and library size; approved external access; Pi storage and peripherals; first TV input device; household profiles and languages. The first native app set is Write, Calculator, Paint, Files and OpenTTD. Write is the kidOS name for its LibreOffice Writer-based word processor; the stable internal application ID remains `writer`.

These decisions do not block the Day 0 web-project workflow. Resolve before selecting content, configuring containment, or promising hardware performance.

## Wider hardware direction — 2026-10-14

Sean requested installation on Intel MacBooks from at least 2012 and basic PCs
so friends can use kidOS, and selected both dedicated-computer and existing-OS
editions, starting with dedicated computers. Add a Debian 13 amd64 track alongside
the Pi, then a macOS/Windows app edition. Reuse mature Linux USB/installation and
hardware support. Preserve local-first storage and the familiar desktop. A
2012-era Intel MacBook is a qualification target, not a promise that every newer
Mac is supported. Hardware checks, a graphical kidOS installer/live USB and
friend-followable onboarding remain required; see [PC rollout](PC-INSTALL.md).

Sean further requested a USB edition that friends can try without wiping their
computers, then optionally install. Default to a temporary live session, with
clear save/export limits and no automatic internal-disk mounting, swap, resume
or persistence. Keep installation outside browser/child-app authority, with
explicit drive selection, proposed changes and a final confirmation. Use the
clean read-only system source when installing, not trial data or identities.
Physical flashing/install acceptance still requires designated disposable media.

## Day 0 boundary

The working application set includes My Stuff, Code Editor, Applications, Play, Library, Explore and local family Mailbox. Source projects can be created, edited, exported, imported as new projects, duplicated and moved to recoverable Trash. Source files can be added, renamed and moved into a reversible project file bin; installed app versions remain immutable and a chosen version can become the desktop default. The two games retain local original-game scores and editable source copies.

Library supports local native audio/video/image formats, text books, PDF pages and EPUB chapter text, plus favorites, progress and collections. EPUB is a text reader, and comic archives remain unsupported. Explore supplies six original offline websites, genuine HTTP forms/search/JSON and a request inspector. It does not yet supply private DNS, HTTPS, public-internet filtering or child-hosted server code. Mailbox supplies local letters, replies, autosaved drafts, read markers and reversible Trash; it does not send email or messages between devices. Parent authentication and parent-only imports/updates remain pending.

The desktop stays an everyday computer. There is no cloud-account requirement, and family projects, media, letters and identities are kept out of distributable source. The approved design's sample media and messages are not shipped family content. See [Day 0 acceptance and limits](DAY0.md), [Library](LIBRARY.md), [Explore](EXPLORE.md), [Mailbox](MAILBOX.md), and [the milestone record](ROADMAP.md) for verified behavior and remaining work.

## Home-screen direction — 2026-10-08

Treat kidOS as a child’s everyday computer. The home screen is a calm, playful desktop with familiar file/app shortcuts, a Start menu, a taskbar, and personal wallpaper. It must not center an app-creation CTA or workshop onboarding. Creation is a normal file operation: My Stuff → Projects → New project; opening a source file launches Code Editor. Installed apps appear as regular shortcuts and in Applications. The file browser currently exposes saved project folders and installed applications, not unrestricted host filesystem access.

The desktop background itself stays plain: no central logo, tagline, creation CTA, onboarding copy, or empty-app promotional panel. Branding belongs in the Start menu; tools and applications are accessed through shortcuts and files.

## Real-computer direction — 2026-10-08

The initial audience is approximately ages 3–11. Keep the dignity and capabilities of a real computer: ordinary windows, files, folders, tools, games and understandable settings. Sean's reference is learning Windows 95 at age four. Do not replace familiar computer concepts with an infantilized shell, compulsory preschool styling, or arbitrary age-based simplification. Make mistakes recoverable, controls readable and help available. Optional assistance and the installed content collection can serve different abilities without changing that baseline.

The desired quality bar for educational content is thoughtful, engaging and pleasant, comparable to good public-service children's media; this does not authorize copying third-party characters or media. The next planning priorities are classic creative tools and games, practical USB/file workflows, a mature native-game/emulation path, ordinary device settings and separately authorized parent administration. Approved family/friend messaging is a later connected feature; the current Mailbox remains local to one computer.

## Minimum lovable product direction — 2026-10-09

Sean requested a review of the current state, suggested a word processor and calculator, and asked to keep working toward a minimum lovable product that is ready to use. The working scope below makes that request concrete for milestone review. It is an acceptance target, not a claim that these capabilities are implemented or verified.

The first target is a coherent, supervised everyday computer: a child can write a story, draw a picture, do a calculation, enjoy a small offline collection, and find yesterday's work without a developer operating the computer. Preserve the calm desktop, familiar windows and ordinary files. Use mature native applications where they provide reliable editing and file formats; adding a standalone VM application does not complete its kidOS integration.

| Essential experience | Minimum scope |
| --- | --- |
| Write | A word processor for stories and notes, with undo, basic text formatting, inserting a saved picture, normal Save/Open, and a portable document format plus PDF export. |
| Calculator | Four operations, decimals, clear/backspace, keyboard and pointer use, understandable invalid-operation behavior, and copying the displayed answer. |
| Paint and Files | Launch Paint and Write from the same desktop; save into ordinary Pictures/Documents folders; find, reopen, rename, copy and restore creations from Trash. Preserve project records and Library imports as their existing separate stores. |
| Play, read and listen | A small, deliberately selected offline collection using the existing Play, Library and Explore foundations. Include a book, playable audio/video and a few enjoyable games, with permission and attribution for anything distributed. Content selection remains open. |
| Control the computer | Discoverable volume/mute, readable display and input settings, help, and safe restart/shutdown. Verify the chosen input devices; keep computer, tablet and TV layouts without claiming untested touch or controller support. |
| Keep creations | Clear save/recovery feedback, recoverable mistakes, a tested USB copy/eject path, and a parent-followable backup/restore covering both service data and native files and saves. |

Readiness is an end-to-end result: start offline, write and illustrate something, save it, switch applications, find and reopen it after restarting, recover a trashed copy, and restore a backup. The [minimum lovable acceptance sequence](ROADMAP.md#minimum-lovable-acceptance-sequence--2026-10-09) defines the pending checks and review boundaries.

Supervised use is the first milestone. Independent child use additionally requires an ordinary account without administrative authority, separately authenticated parent administration, and an enforced policy for executing apps and accessing the network. The current browser runner and sudo-enabled VM account do not meet that gate. A giftable device additionally requires the physical-hardware, clean-install, onboarding, update, recovery and reset evidence in [GIFTABLE.md](GIFTABLE.md). A successful macOS preview or Linux VM demonstration cannot certify those outcomes.

Keep connected messaging, private DNS/HTTPS, child-hosted servers, Python/native child code, a broad game catalog, richer comic/EPUB support and a full office suite outside this minimum lovable milestone. Existing code creation and local Mailbox remain available; their expansion is not a prerequisite for completing the everyday workflows.

## Shared system appearance — 2026-10-09

Sean requested one kidOS appearance for all built-in tools, including Paint, Write, Calculator and Files/system surfaces. Use the existing cream/navy/teal visual language and coherent native controls, title bars, menus and dialogs. His Apple/iOS reference means coherent first-party design, not replacing the agreed Windows 95-inspired computer model. Keep mature file-format/calculation engines and upstream attribution. Installed games and emulators retain their own interfaces. Desktop shortcuts must never scroll horizontally or vertically; spread into columns, show only complete tiles when space is limited, and retain access to the full catalog through Applications and Start.
