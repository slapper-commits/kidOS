# Publishing a developer preview

This procedure publishes source and a portable installation bundle. The separate experimental [USB image](../os/live-usb/README.md) has its own build, source-distribution and runtime acceptance requirements. Neither is a signed device update. No family data, VM disks, runtime binaries or proprietary game content belong in the source-only downloads.

## Source review

`scripts/public-source-files.json` is the exact reviewed set for the public repository. `npm run check:public` compares it to tracked and non-ignored untracked files, rejects links and sensitive paths, and checks for common credential formats. It also confirms that the runtime allowlist is a subset and retains vendor notices. This guard complements human review; it is not a comprehensive secret or license audit. Review additions before editing either allowlist. Do not regenerate the public list blindly.

Before the first commit, inspect all public files and the staged diff, use a public-safe Git author email, and exclude local evidence and household/device identifiers. The repository has no need for a publishing token in its files. GitHub Actions uses its short-lived repository token.

## Validate and build

```sh
npm run check:public
npm test
npm run release:verify -- --version 0.0.1-pilot.20 --output-dir work/public-release
```

Use a fresh output directory. The verifier builds the portable archive twice, compares bytes, extracts it into a temporary directory, verifies its manifest and rehearses staging without touching a live system. The archive and SHA-256 sidecar are the portable source assets; a release may also include separately verified USB components as described below. Full source, build tooling and tests remain available from the matching Git tag.

The two manifests serve different purposes: the public repository includes tests and VM tooling; the portable archive includes the shared runtime, guarded Pi/PC setup and documentation. Neither includes `work/`, `.data/`, credentials or game-demo assets. Required licenses are included in both. Release verification now also stages the PC CLI and native source graph through the extracted installed-release symlink. This is filesystem verification, not a live x64 Linux installation.

## Release workflow

1. Choose a new `X.Y.Z-pilot.N` version. Never replace an existing release's bytes or move its tag.
2. Commit release notes at `docs/releases/VERSION.md`, explicitly naming verification evidence and remaining limitations. Keep package.json at the development base version; RELEASE.json is the bundle's authoritative version.
3. Merge reviewed changes into `main` and require the CI matrix to pass on that exact commit.
4. Run the **Preview release** workflow on `main`, supplying the version. It repeats the public-source check, full Linux tests and archive/staging verification before creating a **draft prerelease** targeting the exact workflow commit.
5. Compare downloaded draft assets with local build hashes for that commit, review notes, then publish the prerelease. Keep it marked prerelease and do not designate it as a stable release.

People can opt into GitHub release notifications through Watch → Custom → Releases and manually choose a version. The in-device updater is a separate future milestone described in [UPDATES.md](UPDATES.md).

## USB assets in a preview release

Keep the USB's frozen runtime identity separate from the current portable bundle.
Do not remaster or relabel an already verified ISO during publication. Include
its matching package sources, frozen recipe, any transformation source and all
required notices; the full checkout at the newer release tag is not a substitute.

GitHub release files must each be under 2 GiB. For pilot.20, the verified ISO is
split into two ordered parts and its matching Debian source archive into five
parts, with a separate source-supplement tar. The [USB guide](USB-TRY.md) records
exact filenames, reconstruction instructions and complete-file hashes. Prepare
parts as ordinary files, independently rehash each part and their concatenation,
and retain a public manifest of sizes/order/hashes. Keep private VM evidence,
credentials and local host paths out of uploaded assets.

Upload the complete USB/source set, public guide, verification notes and checksum
list to the draft. Verify GitHub's recorded size and SHA-256 for every uploaded
asset against the local manifest, and download the portable source assets to
compare bytes. Publish only after every required component is present; preserve
the prerelease designation and existing release bytes.

## Before offering a family-ready image

Complete the physical-hardware, first-run identity, package/content licensing, parent administration, backup, interrupted-update and recovery gates in [GIFTABLE.md](GIFTABLE.md). GitHub CI and VM tests cannot certify these outcomes. A full-image build must satisfy the licenses and source obligations of every bundled package, beyond kidOS's own source license.
