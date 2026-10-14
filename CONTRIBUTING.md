# Contributing to kidOS

kidOS is an early, local-first Linux desktop for children. Preserve its simple desktop, ordinary files and offline operation. Read [PRODUCT.md](docs/PRODUCT.md), [ARCHITECTURE.md](docs/ARCHITECTURE.md), and [ROADMAP.md](docs/ROADMAP.md) before changing behavior.

## Develop locally

Use Node.js 22 or 24 and a modern browser. There are no npm dependencies to install.

```sh
npm test
npm start
```

Open http://127.0.0.1:8787. Native apps require the separately configured Linux session. Tests create isolated temporary data; never point them at household data. Keep personal projects, media, browser profiles, credentials and VM disks out of commits. The service's `.data/` and development `work/` directories are ignored.

## Propose a change

Open an issue describing the problem, or a pull request for a focused fix. Discuss larger features first. Include what changed, why, relevant test results and the actual platform tested. A browser preview does not establish Linux or Raspberry Pi behavior. Avoid unrelated reformatting and dependencies without a clear need.

Add meaningful regression tests for behavior changes. Run `npm test` and `npm run check:public` before submitting. When deliberately adding a public file, review its contents and add its exact path to `scripts/public-source-files.json`. Runtime files also need an entry in `os/raspberry-pi/source-files.json`; tests and VM tooling belong only in the full checkout. Run `npm run release:verify` when changing packaging or installation.

Keep parent administration outside child-app authority. An iframe or kiosk is not OS containment. Do not add child-supplied Node, Python, shell or native execution without an implemented containment boundary. Do not expand network exposure beyond loopback by default.

## Reports and review

Include release/commit, operating system, hardware, reproduction steps, expected behavior and actual behavior. Remove private data from logs and screenshots. Follow [SECURITY.md](SECURITY.md) for vulnerabilities. Be respectful and constructive; harassment and disclosure of someone else's private information are not welcome.

By contributing, you agree that your original contributions use the project's license. Retain all upstream copyright and license notices. Record third-party code, artwork and content in [PROVENANCE.md](docs/PROVENANCE.md).
