# Pi runtime provenance

Reviewed 8 October 2026. This record identifies a prerequisite for the supervised personal pilot. The kidOS source archive contains this record and the runtime pin, but no Node executable or third-party binary distribution.

| Input | Pinned value |
| --- | --- |
| Publisher | Node.js project |
| Version | v24.21.0 LTS |
| Platform | Linux ARM64 |
| Archive | `node-v24.21.0-linux-arm64.tar.xz` |
| Official download | [nodejs.org release archive](https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz) |
| SHA-256 | `6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2` |
| Checksum source | [Official v24.21.0 release, SHASUMS](https://nodejs.org/en/blog/release/v24.21.0#shasums) |
| Installation | `/opt/kidos-node/v24.21.0/` |

The [setup instructions](README.md#set-up-the-dedicated-runtime-on-the-pi) verify this published SHA-256 before extraction. The earlier macOS staging checkpoint did not execute this runtime. The subsequent disposable Debian ARM64 VM run downloaded this exact archive, verified its hash on the host and a private guest copy, retained the complete distribution, and ran the real service and test suite with Node v24.21.0. Physical Pi execution remains unverified. A checksum establishes correspondence with the pinned release record; it does not replace trusting the publisher and the source of this recipe.

Node.js is MIT-licensed and includes dependencies with additional license notices. Preserve the **entire official distribution**, including its complete `LICENSE` file and notices inside its bundled packages. The versioned [official LICENSE](https://github.com/nodejs/node/blob/v24.21.0/LICENSE) is the reference for Node and bundled third-party terms. The installer checks that `LICENSE` is retained as a protected ordinary file; that check is not a full legal or distribution audit.

The manual setup never overwrites `/usr/bin/node` or places npm links on the system PATH. The app service and kiosk use the explicit dedicated executable. The live installation receipt records the expected archive checksum and hashes the installed executable separately; the startup check rejects a changed executable or mismatched version. A runtime update requires a reviewed new pin, source release and reinstallation.

OS, Chromium, firmware and other device-image inputs need their own license/provenance records before a distributable image exists. kidOS's own distribution license remains undecided; this pilot does not certify redistribution to another household.
