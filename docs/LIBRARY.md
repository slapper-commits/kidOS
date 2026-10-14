# Local Library

Open **Library → Add file…** to choose a local file, give it a title, choose its shelf, and copy it into kidOS. Search matches titles, original filenames and collection names; the shelf filter separates Books, Music, Audiobooks, Videos, Photos, and Comics. Favorites and Continue provide smaller shelves. Sort by recent use, title, or collection order. Imports do not move or modify the original file. Reimporting identical bytes returns the existing item and preserves its title, shelf, collection, favorite, and saved position. Open an item and choose **Edit details…** to rename it, select a compatible shelf, or give it a collection name and numeric order. **Previous item / Next item** follows that collection. Ungrouped photos and comic images also have sequential navigation. Tracks open paused; collection navigation does not autoplay.

Imports are currently developer operations exposed in the trusted desktop. Parent sign-in and parent-only import controls are not implemented. Child app frames receive neither the Library API token nor a Library capability. This prototype does not replace Linux filesystem, network, or resource containment.

## Format matrix

| Shelf | Accepted files | Reader/player and limits |
| --- | --- | --- |
| Photos | JPEG, PNG, WebP | Browser image decoder; full-image view, no editing or EXIF stripping |
| Comics | JPEG, PNG, WebP, PDF | Images can be grouped and ordered into collections; PDFs save the selected page. No CBZ/CBR archive import. |
| Music / Audiobooks | MP3, WAV | Native browser player and seeking; playback position in seconds |
| Videos | MP4, WebM | Native browser player and seeking; the codec inside the container must be supported by the browser |
| Books | UTF-8 `.txt`, PDF, EPUB | TXT and EPUB chapter text use paragraph/word-aware pages and saved character position. PDF renders individual pages with saved page number and an accessible text disclosure. |

Maximums: 64 MiB per media file, 2 MiB per text book, 512 catalog items, and 1 GiB for the physical media directory including interrupted imports. These are prototype bounds, not recommended household-library capacity. No comic archive extractor, subtitles, automatic playlist playback, DRM, remote URL import, media deletion, transcoder, or full-text search is implemented.

PDF is limited to 1000 pages. EPUB is a **chapter-text reader**: it follows the package spine, offers a chapter selector, and includes image alternative text; it does not reproduce embedded artwork, typography, interactive content, links or fixed layouts. Encrypted books and protected-font EPUBs are rejected. Its archive is limited to 512 entries, 8 MiB per entry, 32 MiB declared expansion, 256 chapters and 2 MiB readable text; output streams enforce actual entry bounds and CRC checks. Unusually high compression ratios are rejected. Archives are never extracted to the filesystem.

The PDF reader uses locally bundled **PDF.js 6.4.299** (Apache-2.0). ZIP parsing uses locally bundled **zip.js 2.20.0** (BSD-3-Clause). Original licenses, standard-font licenses, exact per-file hashes and source archive integrity values are in `apps/desktop/library-vendor/`. The reader loads no CDN assets. PDF JavaScript, forms, annotations, XFA, dynamic evaluation, WebAssembly codecs and font-face injection are disabled; some uncommon PDFs that need disabled codecs or features will fail. Canvas output is bounded to roughly 4 megapixels and 4096 pixels per side; parsing and page operations have timeouts. These are application bounds, not process isolation or proof against every malicious media file.

File extension, category, and bounded format signatures must agree. This rejects arbitrary HTML/SVG and obvious mismatches, but does not fully validate or decode images/audio/video. Native browser decode errors are shown in the viewer. An accepted MP4 or WebM signature does not establish codec compatibility. See [MDN's media-container guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers).

## Saving your place

Audio/video starts paused at its saved position, saves during playback about every ten seconds and after seeking/pausing, and pauses when leaving the viewer, minimizing, hiding the document, or hiding its window in a compact layout. In Computer mode, playback continues when another floating window is brought forward (see WINDOWS.md). A completed track resets to the beginning. TXT/EPUB books save the start offset of the selected page, and reopen at the page containing that offset. PDF saves its zero-based page index after successful rendering. The text-size control changes readability without changing character bookmarks. Positions are shared on this installation; there are no child profiles.

The status message distinguishes saving, saved, and failed positions. Failed positions remain queued in browser memory across navigation; **Retry positions** retries them. Keep kidOS open until the saved message appears. A browser reload/crash before acknowledgement can lose pending positions; this queue is not durable storage. The browser warns before leaving with pending saves. Simultaneous browser tabs use last accepted write for media positions; project revision conflict protection remains separate.

## Storage and recovery

Library originally introduced the `media` map in schema 4. The current application stores schema 6; upgrades preserve exact prior bytes as `state.pre-v6.<uuid>.json`, with older migration archives untouched. Optional `details = {favorite, collection, order}` preserves compatibility with older item records. TXT keeps its verified `textLength`; EPUB and PDF keep `textLength: null` and format-specific bounded positions. Metadata edits preserve original filenames, content digests, import times, bytes and progress. See ARCHITECTURE.md for the current complete schema migration rules.

The catalog stores metadata, SHA-256 identity, size and position. Actual files live in private `media/<sha256>.blob` files under `KIDOS_DATA_DIR`, separate from source code and the JSON state. Imports sync the blob before committing its catalog entry, with mutations serialized by the existing writer queue. An interrupted catalog commit may leave an unreferenced blob; it still counts toward the physical quota. A later import can adopt the matching verified blob. There is no automatic purge of possible family data.

Each read rejects missing files, links, non-regular files, changed size or digest mismatch. A damaged item does not prevent reading the catalog or opening other items. Back up and restore the **entire stopped data directory**, including `media/`; a `state.json` copy alone is incomplete. Import copies original bytes, including embedded metadata. Do not distribute family media, private data directories, or developer fixtures in an appliance image.

The local HTTP service serves native players with single byte-range GETs and HEAD. Content needs a separate per-process HttpOnly SameSite cookie and desktop-origin checks; the cookie is renewed when opening an item. No capability appears in media URLs. Media uses no third-party service. The current bounded implementation reads and hashes the entire file before responding, even for a small seek range. At most two content reads and one upload run concurrently; memory use exceeds the file size during copying. This is not a Pi performance result. See [HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests).

## Reader and collection verification — 2026-10-08

Targeted Node tests: **35 passed, 0 failed** across media storage, Library UI state/events, and reader/vendored-asset validation on macOS. These cover persistent detail edits and duplicate preservation, compatible category changes, legacy item records, format-specific positions, favorites/continue/search, sequential collections, connected-player preservation, stored/deflated EPUB text, archive limits, paths, CRC failures, executable-node suppression, distinct EPUB chapter starts, safe doctype handling, cross-tab metadata freshness and all pinned asset hashes. The existing position retry/ordering, binary integrity, quota and migration tests remain green.

Original browser fixtures are in ignored `work/library-fixtures/Moon Garden.pdf` and `Moon Garden.epub`; browser rendering and Linux validation of this new reader slice must be recorded separately by the integrated QA pass. Unit tests do not establish PDF rendering or DOMParser behavior in a browser.

## Earlier native-player verification — 2026-10-08

**`npm test`: 68 passed, 0 failed**, on macOS with Node.js 22.22.3. Syntax checks passed for all changed browser/service modules. The full suite includes 13 new media storage tests, 7 media HTTP tests and 7 Library UI state/event tests, alongside the existing project, game and Trash tests. UI state fixtures are not browser-rendering tests.

Coverage includes schema-1/2/3 archival upgrades and recovery, media/source/app/game/Trash preservation, byte integrity, missing/corrupt blobs, safe filenames/links, duplicate imports, bounded uploads (declared and actual chunked size), serialized physical quotas, read admission even after aborted requests, range/HEAD behavior, cookie/origin rejection, retry ordering, latest pending positions, detached-player events, finished-playback reset, failed-import retention, and lossless word/emoji-safe pagination. Independent storage, HTTP and frontend reviews were completed; reported issues were fixed.

Targeted browser checks passed in the Codex in-app browser, using generated fixtures in a fresh temporary data directory on loopback ports 8897/8898:

| Fixture | Observed result |
| --- | --- |
| UTF-8 original book, about 8 KB | File-picker import, paginated text, Next/Previous, saved page 2 reopening after service restart |
| PNG, JPEG, lossless WebP, each 480×320 | All decoded with their full dimensions; JPEG tested as a single Comic page |
| PCM16 mono WAV at 22.05 kHz, 24 seconds | Native playback advanced to completion, no decode error |
| MP3 at 96 kb/s, 24 seconds | Native playback, minimize paused at about 11 seconds, reopen and service restart resumed paused at 11 seconds |
| H.264 MP4, 480×320 at 12 fps, silent, 18 seconds | Native playback advanced and displayed video; TV-mode ArrowRight kept focus on the native video control |
| VP9 WebM, 480×320 at 12 fps, silent, 18 seconds | Native playback advanced with correct dimensions/duration and no decode error |
| HTML bytes named `.png` | HTTP import rejected with a format mismatch |
| Truncated PNG with valid header | Import accepted by signature check; native decoder failure displayed an understandable viewer error |

Search for “moon” returned the three matching audio/book items; the Books filter narrowed it to the book. The Library shelf rendered at 1280×720 and a 390×844 tablet viewport without horizontal document overflow. The test service was gracefully stopped and restarted with the same data; the existing browser renewed its credentials and reopened saved audio/book positions. The final test log and screenshots are in ignored `work/verification/`.

These small, synthetic examples establish only the listed browser behavior. They do not establish arbitrary codec support, audible output-device quality, large-file performance, touch/remote/gamepad input, Linux codecs/containment, or physical Pi performance. Full milestone-2 acceptance remains pending.

Original acceptance fixtures can be regenerated with `python3 scripts/generate-library-fixtures.py` when FFmpeg and Pillow are already available as developer tools. The script uses only synthetic signals, generated color patterns and original prose; it fetches no media. Outputs live under ignored `work/media-fixtures/` and are not bundled product content. FFmpeg and Pillow are not kidOS runtime dependencies.
