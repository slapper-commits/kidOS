# Wider installation rollout

Sean approved both dedicated-computer and existing-OS editions on 2026-10-14,
starting with dedicated computers so friends can use spare laptops. This expands
the hardware target beyond the Pi while keeping local-first storage, the agreed
desktop, no cloud account and no bundled household data.

Sean does not have exact hardware details; assume an unspecified post-2012
MacBook and a basic Windows PC for planning. Do not wait on a model list to
develop the installer. The read-only `--check-hardware` report discovers broad
architecture/RAM/model facts on the machine, keeps missing facts unknown and
never certifies a model. Physical trials remain necessary before qualification.

## First track: dedicated Linux computers

The shared target is Debian 13 amd64 on 64-bit Intel/AMD machines: 2012-era Intel
MacBooks and basic PCs are candidates. Start with 4 GB RAM, preferably 8 GB, and
64 GB storage/SSD; these are provisional targets requiring measurement. Year
alone never establishes support. Apple Silicon, T2 Macs, Windows on ARM and
32-bit PCs need separate work. Reuse Debian's live USB and graphical installer
for boot, drivers and explicit disk selection.

The [experimental PC setup](../os/linux-pc/README.md) adds a separate x64 guard,
runtime pin, service install, ordinary-user native enrollment and login launcher.
The Pi and disposable ARM64 VM checks stay separate. It is developer-assisted
setup on already-installed Debian. The [Try/install USB recipe](../os/live-usb/README.md)
now adds an identity-free live-image build and separate graphical installation.
The corrected development ISO reaches kidOS in isolated BIOS/UEFI tests after a
normal browser reload. Native Write save/reopen passed on the byte-identical base
system payload. The corrected image also passed Try, a temporary file and
installer Summary → Cancel with no internal mount/swap and a full unchanged
32 GiB synthetic-drive comparison. Offline Calamares installation and two USB-absent UEFI password logins passed.
A document saved/reopened through kidOS Write on boot one retained its exact bytes
and text on boot two, reopened through Dolphin and ordinary LibreOffice after
two kidOS shortcut timeouts. Physical qualification and launcher reliability
remain pending.

| Gate | Evidence required | Status |
| --- | --- | --- |
| Shared source and installer rehearsal | x64/ARM64 runtime selection, fail-closed target and receipt checks, extracted release and native staging, source/privacy checks | Local verification recorded in ROADMAP.md |
| x64 Linux integration | Fresh isolated guest; actual service install/restart, native packages/bridge, offline persistence and backup/restore | Installed service/enrollment, fresh identity/password login and native document persistence verified through two offline UEFI boots; launcher reliability and broader backup/restore pending |
| Hardware qualification | Real 2012 MacBook and low-end PC; graphics, Wi-Fi, input, battery/suspend, sound, USB, offline workflows and performance | Pending |
| Friend-installable USB | Reproducible clean live image, try-before-install kidOS, graphical setup, deliberate disk selection, fresh identities, package notices/source obligations, recovery | Experimental ISO: corrected BIOS/UEFI boot, synthetic Try/Cancel preservation, UEFI installation and document persistence passed with documented workarounds; matching sources supplied; physical qualification/recovery pending |
| Friends pilot | Another adult follows the public guide without a developer; clean setup and update retain creations; documented supported models | Pending |

Keep disk writing and reset tests confined to explicitly designated disposable
targets. Existing hardware acceptance and giftability requirements still apply.
Check in with Sean at these working milestones before calling the installer
ready or starting another major track.

## Second track: retain macOS or Windows

Package the local service and desktop as an ordinary application, keep creations
in an appropriate per-user application-data directory, and provide launch/quit,
backup, uninstall-with-data-preservation and manual updates. First decide and
verify supported host OS versions and signed packaging/runtime licensing. Old
MacBooks running Linux can have a different support range from an app running on
their original macOS; do not promise current runtimes on obsolete macOS.

The current source browser preview is available on compatible hosts with Node
22+ and a modern browser. It does not include native Linux apps. Porting native
launch, trusted file operations and settings requires separate adapters and
security review; do not expose arbitrary shell commands to the desktop. No
macOS `.dmg`, Windows `.exe`/`.msi`, auto-updater or full native host integration
has been implemented or verified for this track.
