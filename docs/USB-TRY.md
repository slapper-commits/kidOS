# Try kidOS from USB

This experimental preview includes Linux, kidOS, creative tools, games and local
lessons. **Try kidOS** starts a temporary session; permanent installation is a
separate choice. No cloud account is required.

Emulated boot, Try/Cancel drive preservation, installation and document
persistence checks passed with the workarounds below. Physical computer models
remain unqualified. See [exact verification scope](USB-VERIFICATION.md) and
[all installation options](INSTALL.md).

## Get the image

Use the [pilot.20 release page](https://github.com/slapper-commits/kidOS/releases/tag/v0.0.1-pilot.20)
for the download components, matching checksums and corresponding sources. The
source checkout does not contain the ISO. Reconstruct and verify the complete
ISO before opening the image-writing tool; individual download parts are not
bootable images.

Download **both parts** into the same new folder:

- [kidOS-USB-preview-amd64.iso.part01 — 1.80 GB](https://github.com/slapper-commits/kidOS/releases/download/v0.0.1-pilot.20/kidOS-USB-preview-amd64.iso.part01)
- [kidOS-USB-preview-amd64.iso.part02 — 1.59 GB](https://github.com/slapper-commits/kidOS/releases/download/v0.0.1-pilot.20/kidOS-USB-preview-amd64.iso.part02)

Keep the exact filenames. Open Terminal or PowerShell in that folder. Joining
the parts creates another 3.4 GB file, so allow about 7 GB free for parts plus
the assembled image. On macOS:

```sh
cat kidOS-USB-preview-amd64.iso.part01 kidOS-USB-preview-amd64.iso.part02 > kidOS-USB-preview-amd64.iso
```

On Windows PowerShell, the following streams the parts in order without loading
the whole image into memory. It refuses an existing output file:

```powershell
$parts = @('kidOS-USB-preview-amd64.iso.part01', 'kidOS-USB-preview-amd64.iso.part02')
$output = [System.IO.File]::Open((Join-Path $PWD.Path 'kidOS-USB-preview-amd64.iso'), [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  foreach ($part in $parts) {
    $inputFile = [System.IO.File]::OpenRead((Join-Path $PWD.Path $part))
    try { $inputFile.CopyTo($output) } finally { $inputFile.Dispose() }
  }
} finally { $output.Dispose() }
```

The complete file is `kidOS-USB-preview-amd64.iso`, **3,392,798,720 bytes**
(about 3.4 GB). Its SHA-256 is:

```text
dce7199203fdb3b350c9daa358427992ac37468f17f1ebff99e57d01c4ea4b1b
```

To check the reconstructed download in its folder:

```sh
# macOS Terminal
shasum -a 256 kidOS-USB-preview-amd64.iso
```

```powershell
# Windows PowerShell
Get-FileHash .\kidOS-USB-preview-amd64.iso -Algorithm SHA256
```

Compare the entire result before flashing. A missing/wrong part or interrupted
join fails this check; do not flash that output. Keep the guide, checksums and
verification notes with the image. Source downloads are not needed to try
kidOS. When sharing the image, also make the [matching sources and notices](#sources-for-redistribution)
available from the same place; they are not flashed onto the USB.

## Choose a computer and USB

This preview targets Intel MacBooks without Apple's T2 chip and 64-bit Intel/AMD
PCs. For MacBooks, start with Intel models from 2012–2017. Apple Silicon Macs,
T2 Macs, ARM Windows devices and 32-bit PCs are outside this preview.
[Apple's model list](https://support.apple.com/en-gb/103265) helps identify T2
models. Start with at least 4 GB RAM; 8 GB is preferable.

Real MacBook/PC Wi-Fi, sound, graphics and suspend compatibility has not been
qualified. Some Broadcom Wi-Fi hardware may need a supported Ethernet/USB
adapter. A model year alone does not establish compatibility.

Choose an **ordinary empty removable USB stick, preferably 16 GB or larger**.
External SSDs and devices reported as fixed are outside this boot path.
Disconnect other storage USB drives and remove SD/memory cards until the trial
desktop has started.

## Flash and start

1. Install [balenaEtcher](https://etcher.balena.io/) on a supported Mac or Windows
   computer. You can prepare the USB on a different computer from the one that
   will run kidOS.
2. In Etcher, choose **Flash from file**, select the complete verified ISO,
   select the intended USB stick, then **Flash**. Check the target carefully:
   **flashing erases that selected drive**. Let validation finish. If macOS or
   Windows offers to format or initialize the flashed USB, cancel that prompt.
   Safely eject it. Copying the ISO into an ordinary USB folder does not make it
   bootable.
3. Shut down the computer you want to try. Connect the boot USB and choose it
   in the one-time startup menu. On an Intel Mac, hold **Option (Alt)** while
   starting and choose **USB / EFI Boot**. On a PC, use the manufacturer's
   one-time boot-menu key. If firmware refuses to boot, stop and report the
   model and message; Secure Boot on physical PCs remains unqualified.
4. In the boot menu, choose the first **Live system (amd64)** entry and press
   Enter. Close KDE's separate welcome tour if it covers kidOS. Choose **Try
   kidOS** in the kidOS welcome window. Trying needs no internal-drive selection.

## Try, save and leave

Try Write, Paint, games and the local lessons. **Trial files and settings live in
RAM and disappear at shutdown.** Save/export anything you want to keep to a
separate removable USB stick, then safely eject it. The boot USB does not
automatically retain creations. External SSDs identified as nonremovable are
not enabled for this trial-save path.

Known issues from the emulated tests:

- The first kidOS window can be blank. Click it and press **Ctrl+R once**. If
  it remains blank, stop and report the problem.
- Native-app buttons have timed out. Check the Linux taskbar before trying
  again. If the app connection still does not respond, open an installed app
  through the Linux application menu. To reopen a saved document, open the blue
  folder on the bottom panel, choose **Documents**, and double-click its `.odt`
  file. This tested fallback opens ordinary LibreOffice Writer; its appearance
  can differ from kidOS Write. Automatic native-app launch reliability has not
  been verified.

To leave the trial, shut down using the Linux desktop controls, remove the boot
USB and start the computer normally to return to its existing operating system.

## Optional installation

Offline installation and two installed boots were tested on a disposable
virtual drive. Real computer models and recovery workflows remain unqualified.
**Installation can replace the selected drive's operating system and files.**
Back up first and keep the original system's recovery media. Keep the computer
connected to power and awake until installation finishes.

After backing up and exporting trial work, safely eject and disconnect other
storage USB drives and memory cards before opening the installer. Leave the
boot USB connected.

If the welcome window has closed, open the Linux application menu and search
for **Try or install kidOS**. Choose **Install kidOS**, then explicitly **Open
installer**. The wizard is labelled **Debian GNU/Linux Installer**. Review the
target drive, proposed partition changes and final **Install** confirmation.
Cancel before that confirmation to remain in the USB trial.

There is no automatic dual boot, transfer of trial creations or undo for a
completed installation. The installer uses the clean system image; it does not
copy temporary live-session data or identity. Choose your own installed account
and password when prompted.

At **All done**, uncheck **Restart now** and click **Done**. Shut down normally,
remove the boot USB, then start the installed computer. Log in using the account
and password you chose. The tested login default is **Plasma (Wayland)**; choose
that session if a session selector is shown.

This is a supervised developer preview. Parent administration, enforced child
network/execution controls, physical qualification and giftable-device acceptance
remain separate work.

Official references: [writing a Debian USB image](https://www.debian.org/CD/faq/#write-usb),
[balenaEtcher](https://etcher.balena.io/),
[Intel Mac startup keys](https://support.apple.com/en-us/102603).

## Sources for redistribution

These downloads contain corresponding sources and notices, rather than files
needed to boot or run the USB. Keep them available alongside an image you share.
Download the following six files from the same pilot.20 release into a new
folder, retaining their exact names:

- [debian-package-sources.tar.part01](https://github.com/slapper-commits/kidOS/releases/download/v0.0.1-pilot.20/debian-package-sources.tar.part01)
- [debian-package-sources.tar.part02](https://github.com/slapper-commits/kidOS/releases/download/v0.0.1-pilot.20/debian-package-sources.tar.part02)
- [debian-package-sources.tar.part03](https://github.com/slapper-commits/kidOS/releases/download/v0.0.1-pilot.20/debian-package-sources.tar.part03)
- [debian-package-sources.tar.part04](https://github.com/slapper-commits/kidOS/releases/download/v0.0.1-pilot.20/debian-package-sources.tar.part04)
- [debian-package-sources.tar.part05](https://github.com/slapper-commits/kidOS/releases/download/v0.0.1-pilot.20/debian-package-sources.tar.part05)
- [kidOS-USB-source-supplements.tar](https://github.com/slapper-commits/kidOS/releases/download/v0.0.1-pilot.20/kidOS-USB-source-supplements.tar)

The five package parts total 8,121,784,320 bytes; the supplement is 41,011,200
bytes. Allow about 17 GB for their downloads and assembled sources. Check the
supplement before extracting. Its SHA-256 must be
`089c896213ad9dda9d5a1951589bee5495a7370d667eb59060d7878e6a489dfb`:

```sh
# macOS
shasum -a 256 kidOS-USB-source-supplements.tar
```

```powershell
# Windows PowerShell
Get-FileHash .\kidOS-USB-source-supplements.tar -Algorithm SHA256
```

After it matches, extract it with `tar -xf kidOS-USB-source-supplements.tar` in
that folder. This creates `SOURCES/`, containing the frozen build recipe,
boot-policy source, font source, notices and source manifests. Put the assembled
Debian archive inside that directory. On macOS:

```sh
cat debian-package-sources.tar.part01 debian-package-sources.tar.part02 debian-package-sources.tar.part03 debian-package-sources.tar.part04 debian-package-sources.tar.part05 > SOURCES/debian-package-sources.tar
shasum -a 256 SOURCES/debian-package-sources.tar
```

On Windows PowerShell:

```powershell
$parts = @('debian-package-sources.tar.part01', 'debian-package-sources.tar.part02', 'debian-package-sources.tar.part03', 'debian-package-sources.tar.part04', 'debian-package-sources.tar.part05')
$output = [System.IO.File]::Open((Join-Path $PWD.Path 'SOURCES\debian-package-sources.tar'), [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
  foreach ($part in $parts) {
    $inputFile = [System.IO.File]::OpenRead((Join-Path $PWD.Path $part))
    try { $inputFile.CopyTo($output) } finally { $inputFile.Dispose() }
  }
} finally { $output.Dispose() }
Get-FileHash .\SOURCES\debian-package-sources.tar -Algorithm SHA256
```

The complete Debian archive SHA-256 must be
`f4775f572293619097b7081056e494b20040f60022f3464b657e5b5bb6a234c5`.
Retain the complete `SOURCES/` directory and read its `README.txt` for source
composition and reproduction limits.
