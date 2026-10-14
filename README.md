# kidOS

A local-first personal computer for children, with the simplicity of a Windows 95-inspired desktop: ordinary windows, files, creative tools and games. It runs on Linux and works offline after setup, without a cloud account.

**Developer Preview.** kidOS is for supervised experimentation. It is not yet a hardened child appliance or a ready-to-flash OS image. Physical Raspberry Pi acceptance, parent authentication, OS-level child-code containment, first-run setup and secure device updates are unfinished.

[Download previews](https://github.com/slapper-commits/kidOS/releases) · [Report a bug](https://github.com/slapper-commits/kidOS/issues) · [Contribute](CONTRIBUTING.md) · [Roadmap](docs/ROADMAP.md)

![kidOS desktop with the built-in Explore window](docs/images/desktop-preview.png)

*Browser preview with empty local data and original built-in lessons. Native Linux apps are configured separately.*

## What works today

- A familiar desktop, Start menu and taskbar; movable, resizable browser windows and saved workspace arrangements.
- Computer, tablet and TV layouts. Touch and controller acceptance remain pending.
- My Stuff, Code Editor and Applications: create, edit, export, import and install local HTML/CSS/JavaScript projects, with recoverable Trash and editor drafts.
- Two original remixable games, plus a separately provisioned native app catalog for Write (LibreOffice Writer), Paint, Calculator, Files, OpenTTD, Solitaire, Minesweeper, Pinball and Puzzle Box.
- A local Library for supported audio, video, photos, text, PDF and EPUB chapter text. Bring your own permitted content; no household media is bundled.
- Explore: six original offline educational websites with real local HTTP forms, search and request inspection.
- Mailbox: local letters between named mailboxes on one computer. These are shared labels, not authenticated accounts or internet email.

Native apps require the Linux session setup; they do not run inside the browser preview. Native windows are not yet fully integrated with the browser taskbar. The educational sites do not establish a filtered public internet, and browser sandboxing is not OS containment. Use trusted local projects only.

## Try the desktop locally

Install Node.js 22 or 24 and use a modern browser. No npm packages need to be downloaded.

```sh
git clone https://github.com/slapper-commits/kidOS.git
cd kidOS
npm test
npm start
```

Open **http://127.0.0.1:8787**. The desktop and app runner bind only to loopback, on ports 8787 and 8788. Stop both with Ctrl+C. To use another private data directory or different ports:

```sh
KIDOS_DATA_DIR="$HOME/kidos-data" KIDOS_PORT=8787 KIDOS_RUNNER_PORT=8788 npm start
```

By default, projects, media, local letters and workspace state live in `.data/` beside the source. Keep it when changing source versions. Native files and game saves live separately in the Linux desktop user's home. Stop the service before backing up its complete data directory; also back up native files. Project export is not a whole-device backup. Read [migration and recovery limits](docs/ARCHITECTURE.md#storage-and-recovery) before downgrading.

## Linux and Raspberry Pi

| Target | Current status |
| --- | --- |
| Local browser preview | Working desktop/service; native Linux apps unavailable |
| Debian 13 ARM64 VM | Bounded service, recovery and native graphical workflows verified; developer fixture only |
| Raspberry Pi 5, 8 GB; Raspberry Pi OS Trixie 64-bit Desktop | Guarded developer installer exists; physical hardware acceptance pending |
| Other Linux machines / a bootable kidOS image | No supported general installer or downloadable boot image yet |

For the intended Pi target, read the [developer installation guide](os/raspberry-pi/README.md). The portable release asset `kidos-VERSION.tar` contains an allowlisted source tree and `RELEASE.json`; the adjacent SHA-256 file checks integrity. It does not contain Linux, Node.js, native app binaries or proprietary game data. GitHub's automatic source ZIP/tar downloads contain the full checkout, including tests and build tools, and are not the portable installer bundle.

The [disposable Linux VM guide](os/linux-test/README.md) is for developers. Its sudo-enabled test account is not an appliance configuration. See [window verification](docs/WINDOWS.md) for the pilot.16 corrections and [milestones](docs/ROADMAP.md) for the exact scope of earlier checks. CI tests do not certify physical hardware.

## Updates

Previews are **manual and optional**. Watch this repository → Custom → Releases to receive GitHub notifications, then choose whether to download a newer version. No background updater or forced restart is included. Check release notes and back up creations before installing.

A parent-authorized, signed update system with tested recovery is [planned](docs/UPDATES.md). Checksums alone do not authenticate a publisher. See [release procedures](docs/RELEASING.md) and [requirements before gifting a device](docs/GIFTABLE.md).

## Project guide

[Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Native apps](docs/NATIVE-APPS.md) · [Library](docs/LIBRARY.md) · [Explore](docs/EXPLORE.md) · [Mailbox](docs/MAILBOX.md) · [App contract](packages/app-contract/README.md) · [Security](SECURITY.md)

Original kidOS code, artwork and documentation are [MIT licensed](LICENSE). Bundled reader libraries and separately installed Linux packages retain their own licenses. See [provenance and third-party notices](docs/PROVENANCE.md). Full OS-image licensing and hardware acceptance remain separate work.
