#!/bin/sh
set -eu
# Runs ONLY inside live-build's disposable Debian amd64 image chroot.
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] && [ "$(id -u)" = 0 ] || exit 1
python3 -I - <<'PY'
import json, os, stat
p = '/etc/kidos-usb-build.json'
s = os.lstat(p)
assert stat.S_ISREG(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022
assert json.load(open(p)) == {'format': 1, 'purpose': 'kidOS live USB build'}
assert os.path.isdir('/opt/kidos-usb/source')
PY
. /etc/os-release
[ "$ID" = debian ] && [ "$VERSION_ID" = 13 ] || exit 1
cd /opt/kidos-usb
printf '%s\n' 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6  node-v24.21.0-linux-x64.tar.xz' | sha256sum --check --strict
mkdir -p /opt/kidos-node
mkdir /opt/kidos-node/v24.21.0
tar -xJf node-v24.21.0-linux-x64.tar.xz --strip-components=1 --no-same-owner -C /opt/kidos-node/v24.21.0
[ "$(/opt/kidos-node/v24.21.0/bin/node -p 'process.platform + "/" + process.arch')" = linux/x64 ] || exit 1
/opt/kidos-node/v24.21.0/bin/node --input-type=module -e 'import { verifyRelease } from "/opt/kidos-usb/source/os/raspberry-pi/release.mjs"; await verifyRelease("/opt/kidos-usb/source");'
/opt/kidos-node/v24.21.0/bin/node /opt/kidos-usb/calamares.mjs --configure-image
install -m 0644 /opt/kidos-usb/firstboot.service /etc/systemd/system/kidos-usb-firstboot.service
mkdir -p /etc/systemd/system/multi-user.target.wants
ln -s ../kidos-usb-firstboot.service /etc/systemd/system/multi-user.target.wants/kidos-usb-firstboot.service
mkdir -p /etc/xdg/autostart /usr/share/applications /etc/skel/.config
mkdir -p /etc/sddm.conf.d
cat > /etc/sddm.conf.d/10-kidos-session.conf <<'CONFIG'
[Autologin]
Session=plasma.desktop
CONFIG
cat > /etc/xdg/autostart/kidos-usb.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=kidOS
Comment=Open kidOS after normal desktop login
Exec=/opt/kidos-node/v24.21.0/bin/node /opt/kidos-usb/session.mjs
Icon=applications-education
Terminal=false
DESKTOP
cat > /usr/share/applications/kidos-usb-help.desktop <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Try or install kidOS
Comment=USB trial help and optional installation
Exec=/usr/bin/python3 -I /opt/kidos-usb/welcome.py
Icon=applications-education
Terminal=false
Categories=System;
DESKTOP
cat > /etc/skel/.config/kded_device_automounterrc <<'CONFIG'
[General]
AutomountEnabled=false
AutomountOnLogin=false
AutomountOnPlugin=false
CONFIG
mkdir -p /etc/polkit-1/rules.d
cat > /etc/polkit-1/rules.d/49-kidos-live-disks.rules <<'POLICY'
// Trial account only. The explicit installer runs as root through stock pkexec.
// This prevents UDisks auto-mounting internal storage; it is not child containment.
polkit.addRule(function(action, subject) {
  if (subject.user === "kidos-live" && action.id.indexOf("org.freedesktop.udisks2.") === 0 &&
      action.lookup("drive.removable") !== "true") {
    return polkit.Result.NO;
  }
});
POLICY
mkdir -p /usr/share/kidos-usb
LC_ALL=C dpkg-query -W -f='${Package}\t${Version}\t${Architecture}\n' | LC_ALL=C sort > /usr/share/kidos-usb/installed-packages.tsv
cp /opt/kidos-node/v24.21.0/LICENSE /usr/share/kidos-usb/NODE-LICENSE
# Families/accounts/receipts are created at real boot, never in the squashfs.
[ ! -e /var/lib/kidos ] && [ ! -e /opt/kidos ] && [ ! -e /opt/kidos-native-session ] || { echo 'Image contains kidOS runtime data or enrollment.' >&2; exit 1; }
[ -z "$(find /home -mindepth 1 -maxdepth 1 -print -quit)" ] || { echo 'Image contains a desktop identity.' >&2; exit 1; }
[ ! -d /root/.ssh ] || [ -z "$(find /root/.ssh -mindepth 1 -print -quit)" ] || { echo 'Image contains SSH credentials.' >&2; exit 1; }
: > /etc/machine-id
rm -f /var/lib/dbus/machine-id
ln -s /etc/machine-id /var/lib/dbus/machine-id
rm -f /etc/ssh/ssh_host_*_key /etc/ssh/ssh_host_*_key.pub
rm -f /var/lib/systemd/random-seed /var/lib/urandom/random-seed
rm node-v24.21.0-linux-x64.tar.xz /etc/kidos-usb-build.json
