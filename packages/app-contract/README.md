# App contract v1

Day 0 installs local HTML, CSS, and classic browser JavaScript. The runtime validator is `manifest.mjs`; the companion `manifest.schema.json` records the external JSON shape. No dependencies or server-side child-code execution are required.

```json
{
  "schemaVersion": 1,
  "id": "project-8f9c9fb8-5412-45ec-97d0-1ee236ed7d6a",
  "name": "My color lab",
  "version": "1.0.0",
  "entryPoint": "index.html",
  "runtime": "web",
  "permissions": []
}
```

All fields are required; additional fields are rejected. The project owns a generated UUID v4 ID for its lifetime. Names contain 1–60 characters, no surrounding whitespace or control characters. Versions use three nonnegative decimal numbers of at most eight digits each, without leading zeroes, prerelease tags, or build metadata. The entry point is `index.html` and the only runtime is `web`.

`permissions` must explicitly be an empty array. Unknown or requested capabilities are rejected. Version 1 grants no filesystem, platform API, parent-control, network, camera, microphone, location, or persistent app-data capability. The browser preview's isolation and policy are only a development boundary, not a Linux process or network containment guarantee. Device-level isolation remains future work. Classic relative scripts, local stylesheets and app files are supported; module imports, remote dependencies, server code and persistent app storage are not part of this version.

Projects contain 1–32 UTF-8 text files totaling at most 1 MiB (path names included), always including `index.html`. File names use ASCII letters, digits, dots, dashes, and underscores, with each segment starting with a letter or digit. Paths are relative, at most 180 characters and eight segments. Absolute paths, `.` and `..`, percent encoding, backslashes, query strings, control characters, nulls, and invalid Unicode are rejected. Content stays in the data store; child-supplied paths are never joined to host filesystem paths.

Install copies a saved project revision into a new immutable snapshot containing `manifest`, `files`, `installedAt`, `digest`, `sourceRevision`, and `projectId`. `digest` is the SHA-256 of canonical JSON `{manifest,files}` (object keys sorted recursively). It detects snapshot corruption; it is not a signed publisher identity. Reusing an installed version is a conflict even if its bytes match. The launcher selects the most recently installed version, and earlier versions remain addressable. Editing a project never edits an installed version. There are at most 32 versions per app in Day 0.

The disk schema is independently versioned: schema 5 holds source projects, installed snapshots, game progress, a project-trash map, a Library catalog, and the desktop workspace/recovery draft in one atomically replaced `state.json`, with a previous valid `state.backup.json`. Source-controlled migrations accept schemas 1, 2, 3, and 4 and preserve pre-upgrade data in a separate archive. Unsupported versions fail closed. Trash does not change the project/export or installed-manifest shape: source records stay in place, and a separate map records which projects are in Trash. Move and restore require the current project revision and each advance it. Installed app snapshots stay unchanged and launchable. Validation, digest checks, and path checks run on reopening saved state. A corrupt primary can recover the preceding state from the backup, preserving the damaged file and showing a recovery notice. Both invalid files stop startup without resetting family data.

Project export is JSON `{ "schemaVersion": 1, "project": { "id", "name", "revision", "createdAt", "updatedAt", "files" } }` with concrete property values. This exports editable source only; it is not a full-device backup, signed app package, or import/install format. Import, app data directories, custom icons, capabilities, uninstall, rollback controls, native runtimes, and signed distribution require later contract versions.

Library originals live in separate private media blobs and are not app files or granted app capabilities. A complete backup must include them; see `../../docs/LIBRARY.md`.
