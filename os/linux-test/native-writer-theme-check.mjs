// VM-only preview: keep existing Writer recovery and open documents untouched.
import { userInfo } from 'node:os';
import { spawn } from 'node:child_process';
import { validateCaller, checkImportFiles, chromiumEnvironment } from './native-launcher-check.mjs';

const user = userInfo();
validateCaller(process.argv.slice(2), { platform: process.platform, arch: process.arch, uid: process.getuid?.(), user, home: process.env.HOME });
await checkImportFiles();
const { checkSession, protectedFile } = await import('/opt/kidos-native-session/registration.mjs');
const session = await checkSession(user);
if (session.targetKind !== 'disposable-linux-vm') throw new Error('Writer theme preview requires the disposable VM.');
await protectedFile('/usr/lib/libreoffice/program/soffice', { executable: true, read: false });
const { prepareNativeTheme, themePaths } = await import('/opt/kidos-native-session/theme.mjs');
await prepareNativeTheme(user.homedir, user.uid, { targetKind: session.targetKind, writerPreview: true });
const paths = themePaths(user.homedir, session.targetKind, { writerPreview: true });
const env = { ...chromiumEnvironment(process.env), QT_QPA_PLATFORM: 'wayland', SAL_USE_VCLPLUGIN: 'qt6', XDG_CONFIG_HOME: paths.config, XDG_CACHE_HOME: `${paths.base}/cache`, XDG_DATA_HOME: `${user.homedir}/.local/share` };
const child = spawn('/usr/lib/libreoffice/program/soffice', [`-env:UserInstallation=file://${paths.writer}`, '--writer'], { shell: false, cwd: `${user.homedir}/Documents`, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
