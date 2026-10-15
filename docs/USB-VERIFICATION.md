# USB preview verification

The recorded emulated checks completed on **15 October 2026**, with the startup
and app-launch workarounds described below. These results qualify the stated
software observations; they do not qualify physical hardware or a finished child
appliance. See the [try/install guide](USB-TRY.md).

| Image identity | Value |
| --- | --- |
| Complete filename | `kidOS-USB-preview-amd64.iso` |
| Bytes | `3,392,798,720` |
| SHA-256 | `dce7199203fdb3b350c9daa358427992ac37468f17f1ebff99e57d01c4ea4b1b` |
| Frozen portable runtime source | `ea56e10ebac7b1e9b0ac38ec6d5c444134140506c97a5ae7224a2d0eb77e9969` |
| Separate boot-policy source | `e94afa67475ed4d0d7bdb4786f4748ea5e428db3cbf763213d258dd115ef9b43` |

The pilot.20 listing distributes this unchanged frozen pilot.19 USB system
alongside the newer pilot.20 portable source bundle. Those are separate artifacts;
the newer bundle is not a claim that the ISO was rebuilt from it.

## Completed trial observations

- The corrected image booted from emulated removable USB in BIOS with no
  writable computer disk, and in UEFI with a designated synthetic 32 GiB
  internal drive. Normal **Try** reached kidOS after one browser reload.
- In the attached-drive UEFI test, the drive remained unmounted and swap was
  empty. Kernel logs showed device detection without the old internal-filesystem
  probe mount.
- The graphical installer reached its proposed partition **Summary**. **Cancel**
  and its confirmation returned to the desktop without accepting installation.
  A short file was created and read back in the temporary Documents home using
  a terminal; that marker was not another native Save UI test.
- After clean shutdown, `qemu-img check` and a full logical 32 GiB comparison
  passed. Baseline and target-container hashes were unchanged. This establishes
  final byte preservation in this emulated workflow, not the absence of every
  possible physical write attempt.
- The corrected image differs from its base in three boot configurations, two
  checksum tables, generated boot-info bytes and ISO/boot metadata. All 782
  ordinary payload paths were compared. System, kernel/initrd, EFI programs,
  offline package pool and kidOS source payload remain byte-identical.
  Native Write create/save/close/relaunch/reopen passed in BIOS and UEFI on that
  unchanged base payload. This is distinct from corrected-image boot and
  drive-preservation observations. The unsafe original boot image is not supplied.

The combined preservation record SHA-256 is
`7884f851765c41df6a2f2dc3b2cada1d150f7ad1e19e0e7fa1965d20fa7025ac`.

## Completed installed-system observations

- Offline Calamares installation reached **All done**. Normal shutdown and a
  stopped-drive check passed before booting the installed system.
- Two separate UEFI boots had the USB/live medium absent. The chosen password
  logged into the default Plasma (Wayland) session on both. Automatic login was
  off; no manual session selection or system repair was needed.
- The installed machine identity differed from the temporary live identity and
  remained stable after reboot. Installed source and ordinary-user enrollment
  matched the frozen release. Root/service accounts were locked. The first sudo
  check required a password before any sudo authentication.
- The installed home started with empty Documents, zero projects and an
  unconfigured Mailbox. No temporary live home was copied into it.
- On boot one, one normal kidOS Write click opened the app. A document was
  created, saved, closed and reopened through normal UI. After boot two its
  SHA-256 was unchanged and its original sentence visibly reopened. That second
  reopen used Dolphin Documents and the normal LibreOffice file association
  after two kidOS Write-button timeouts. It verifies native-file persistence,
  without certifying the kidOS native bridge on boot two.
- Every installation phase ended in clean shutdown. All stopped-drive checks
  passed; the immutable baseline remained unchanged. All owned test/source VMs
  and builder transports were stopped after verification.

The final second-boot checkpoint SHA-256 is
`62dd6193a06fbc2dc667a31930cdcbbc680e0e24077d8a37a4ee524f846b5c4c`.
The reconciled software-acceptance record SHA-256 is
`57799e9ee82f99588122cd403268992b8bc7574dff27c97a892b418a306163dd`.

## Scope and limits

Tests used offline QEMU x86_64, SandyBridge-v2 CPU, two CPUs and 4 GiB RAM, with
no host disk/USB passthrough, network, shared folders or acceptance SSH seed.
Physical MacBooks/PCs, Secure Boot enforcement, Wi-Fi, sound, graphics, suspend,
keyboard/trackpad and real USB copy/eject remain unqualified. These checks do
not establish independent child-use safety or completed parent controls.

The first kidOS page was blank until normal **Ctrl+R**. Native-app connection
and reply timeouts also occurred. Opening the saved document through Documents
worked using ordinary LibreOffice on boot two. Check the Linux taskbar before
retrying; the [guide](USB-TRY.md#try-save-and-leave) gives the tested fallback.
Automatic page/native launch reliability and the cause of these failures are
not certified. Live trial data/settings disappear at shutdown.

The checkout passed all 346 macOS tests with loopback fixtures enabled. The
frozen Linux x64 source passed 341 tests with two expected platform skips and no
failures. These code suites have separate scopes from actual runtime observations.

## Corresponding sources

The source components supplied with the USB include matching Debian package
sources, the frozen ea56 build recipe, separate boot-policy source and editable
font source with notices. All 4,176 Debian source artifacts matched the
authenticated 1,301-version union. Keep these sources/notices available when
redistributing the image. Rebuilding an ISO byte-for-byte across tool/repository
changes has not been certified. Checksums establish integrity; they are not
publisher-authentication signatures.
