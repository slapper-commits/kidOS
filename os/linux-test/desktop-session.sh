#!/bin/bash
# Run only after PAM/logind creates the ordinary user's real tty1 session.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C
unset NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH
if [[ $# != 2 || $1 != --disposable-vm-id ]]; then echo 'Use --disposable-vm-id UUID.' >&2; exit 1; fi
[[ $(id -u) == 1000 && $(uname -s) == Linux && $(uname -m) == aarch64 ]] || { echo 'The desktop fixture requires its ordinary Linux ARM64 test user.' >&2; exit 1; }
/opt/kidos-node/v24.21.0/bin/node --input-type=module - "$2" <<'JS'
import { lstat, readdir, readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { vmTarget } from '/opt/kidos-linux-test/target.mjs';
await vmTarget(process.argv[2]);
const user = userInfo();
if (user.username !== 'kidos-test' || user.uid !== 1000 || user.homedir !== '/home/kidos-test' || process.env.HOME !== user.homedir) throw new Error('Use the cloud-seeded ordinary test desktop login.');
const runtime = process.env.XDG_RUNTIME_DIR;
if (runtime !== `/run/user/${user.uid}`) throw new Error('A real PAM/logind runtime directory is required.');
const info = await lstat(runtime);
if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== user.uid || (info.mode & 0o777) !== 0o700) throw new Error('Unsafe desktop runtime directory.');
let connected = false;
for (const name of await readdir('/sys/class/drm')) {
  if (/^card\d+-/.test(name)) {
    try { connected ||= (await readFile(`/sys/class/drm/${name}/status`, 'utf8')).trim() === 'connected'; } catch {}
  }
}
if (!connected) throw new Error('No connected virtual DRM display. This fixture does not fall back to a headless compositor.');
JS
[[ $(tty) == /dev/tty1 ]] || { echo 'Start through the tty1 login session.' >&2; exit 1; }
[[ -n ${XDG_SESSION_ID:-} ]] || { echo 'A logind session is required.' >&2; exit 1; }
[[ $(/usr/bin/loginctl show-session "$XDG_SESSION_ID" --property=Active --value) == yes ]] || { echo 'The tty1 session must be active.' >&2; exit 1; }
[[ $(/usr/bin/loginctl show-session "$XDG_SESSION_ID" --property=Seat --value) == seat0 ]] || { echo 'The display must belong to seat0.' >&2; exit 1; }
export XDG_SESSION_TYPE=wayland XDG_CURRENT_DESKTOP=labwc LIBSEAT_BACKEND=logind
# QEMU's 2D virtual GPU uses software rendering. This is a real DRM display,
# keyboard and pointer session, not a headless or nested compositor.
export WLR_BACKENDS=drm,libinput WLR_RENDERER=pixman
exec /usr/bin/dbus-run-session -- /usr/bin/labwc
