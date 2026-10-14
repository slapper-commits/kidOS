# Optional device updates

Status: planned. The developer preview offers versioned downloads and release notifications; it does not check for, download or install device updates. No updater is exposed through the child-facing platform API.

## Intended experience

A separately authenticated parent opens Settings → Updates, checks for a release, reads what changed and chooses whether to install. Stable is the eventual default; experimental previews require explicit opt-in. Optional notifications do not imply permission to install or restart. Downloads and restarts can be postponed, and existing apps continue working offline without an account.

## Implementation sequence

1. Package kidOS's desktop, platform service and matching native bridge/extension as a coordinated Debian package set. Evaluate a dedicated signed APT repository; use Debian/Raspberry Pi OS repositories for base-system and native-package security updates. Identify and test compatibility across these two sources.
2. Establish separately authenticated parent/OS authority and a narrow privileged update helper. Child apps and the loopback web service must not receive a general package-manager or shell endpoint. Signing keys stay outside source, build outputs and device images; document rotation, revocation and recovery.
3. Implement a bounded update state machine: check, available, download, verify, stage, install, health check, success or recovery. Authenticate repository metadata and packages, reject unexpected channels/versions, and handle low disk space and lost connectivity. APT authentication alone does not make an installation atomic or provide automatic rollback.
4. Design recovery with explicit data-schema compatibility. Preserve creations and back up before migrations. Keeping an old code directory is insufficient when an old version cannot read the new schema; do not silently discard post-upgrade work. Evaluate A/B system images with a mature updater if whole-OS recovery cannot be made dependable through the package approach.
5. Verify clean install and upgrade from each supported prior release in an isolated Linux fixture, then on the supported Pi. Exercise interrupted downloads/installations, invalid signatures, full storage, failed health checks, migration failure and recovery. Power-loss tests require designated disposable media.

## Release gates

- Parent authorization cannot be obtained or bypassed by child code.
- Offline startup remains usable and no account or telemetry is required.
- Invalid or stale update metadata cannot cause an unintended installation.
- Interrupted installations recover to a usable state with creations intact.
- Backup/restore includes platform data and native documents/game saves.
- A parent can understand recovery instructions without developer access.
- Support periods, tested hardware and supported upgrade paths are published.

Until these are verified, use the explicit developer installation procedure and make a stopped-service backup first. Source checksums and a successful VM installation are not a secure-update system.
