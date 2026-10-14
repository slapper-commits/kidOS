import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePuzzleCatalog, PUZZLE_BINARIES, piEnvironment } from '../../os/native-session/native-launch.mjs';
import { listApps, launch } from '../../os/native-session/host.mjs';

const catalogURL = new URL('../../os/native-session/puzzlebox-catalog.json', import.meta.url);
const chooserPath = fileURLToPath(new URL('../../os/native-session/puzzlebox.py', import.meta.url));
const catalog = JSON.parse(await readFile(catalogURL));
const expected = 'blackbox bridges cube dominosa fifteen filling flip flood galaxies guess inertia keen lightup loopy magnets map mines mosaic net netslide palisade pattern pearl pegs range rect samegame signpost singles sixteen slant solo tents towers tracks twiddle undead unequal unruly untangle'.split(' ');
function python(body) {
  const source = `import json, runpy, stat\nfrom types import SimpleNamespace\nm = runpy.run_path(${JSON.stringify(chooserPath)})\nraw = json.loads(${JSON.stringify(JSON.stringify(catalog))})\ncatalog, starters = m['validate_catalog'](raw)\n${body}\n`;
  return execFileSync('/usr/bin/python3', ['-I', '-c', source], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] });
}

test('Puzzle Box contains exactly the packaged forty fixed executables and six distinct starter puzzles', () => {
  assert.deepEqual(catalog.puzzles.map(puzzle => puzzle.id), expected);
  assert.deepEqual(PUZZLE_BINARIES, expected.map(id => `/usr/games/sgt-${id}`));
  assert.deepEqual(catalog.starters, ['flood', 'untangle', 'samegame', 'net', 'solo', 'lightup']);
  const mutations = [null, { ...catalog, extra: true }, { ...catalog, puzzles: catalog.puzzles.slice(1) },
    { ...catalog, starters: [...catalog.starters.slice(1), 'unknown'] },
    { ...catalog, starters: Array(6).fill('flood') }];
  for (const change of [{ binary: '/bin/sh' }, { id: '../sh', binary: '/usr/games/sgt-../sh' }, { args: ['--load', '/tmp/game'] }, { name: {} }]) {
    mutations.push({ ...catalog, puzzles: catalog.puzzles.map((entry, i) => i ? entry : { ...entry, ...change }) });
  }
  for (const value of mutations) assert.throws(() => validatePuzzleCatalog(value), /catalog/);
  assert.deepEqual(JSON.parse(python('print(json.dumps(list(catalog)))')), expected);
});

test('Python chooser rejects malformed catalogs and CLI arguments before importing GTK or spawning a game', () => {
  python(`
from copy import deepcopy
for change in [{'binary':'/bin/sh'}, {'id':'../sh','binary':'/usr/games/sgt-../sh'}, {'args':['--load','/tmp/game']}]:
    altered = deepcopy(raw)
    altered['puzzles'][0].update(change)
    try:
        m['validate_catalog'](altered)
        raise AssertionError('unsafe catalog accepted')
    except m['PuzzleError']:
        pass
for arguments in [['flood'], ['--exec', '/bin/sh'], ['--load', '/tmp/game']]:
    try:
        m['main'](arguments)
        raise AssertionError('CLI arguments accepted')
    except m['PuzzleError']:
        pass
assert 'gi' not in __import__('sys').modules
`);
});

test('chooser executes only the selected fixed game, reports missing binaries and keeps ordinary save locations', () => {
  const observed = JSON.parse(python(`
calls = []
def spawn(command, **options):
    calls.append({'command':command, 'options':options})
    return 'child'
environment = {'HOME':'/home/kid', 'USER':'kid', 'XDG_CONFIG_HOME':'/home/kid/.local/share/kidos-native/config',
 'XDG_DATA_HOME':'/home/kid/.local/share', 'WAYLAND_DISPLAY':'wayland-0', 'XDG_RUNTIME_DIR':'/run/user/1000',
 'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus', 'PATH':'/evil', 'LD_PRELOAD':'/evil',
 'PYTHONPATH':'/evil', 'GTK_MODULES':'evil', 'GIO_EXTRA_MODULES':'evil', 'GDK_BACKEND':'x11'}
assert m['launch_puzzle']('flood', catalog, environment, check=lambda path: True, spawn=spawn) == 'child'
for identity in ['flood --load /tmp/game', '../sh', '/bin/sh', '', None]:
    try:
        m['launch_puzzle'](identity, catalog, environment, check=lambda path: True, spawn=spawn)
        raise AssertionError('unknown choice started')
    except m['PuzzleError']:
        pass
try:
    m['launch_puzzle']('net', catalog, environment, check=lambda path: False, spawn=spawn)
    raise AssertionError('missing game started')
except m['PuzzleError'] as error:
    assert 'not installed' in str(error)
assert len(calls) == 1
def fail(*args, **kwargs):
    raise OSError('sensitive executable detail')
try:
    m['launch_puzzle']('net', catalog, environment, check=lambda path: True, spawn=fail)
    raise AssertionError('spawn error swallowed')
except m['PuzzleError'] as error:
    assert 'sensitive' not in str(error)
print(json.dumps(calls[0]))
`));
  assert.deepEqual(observed.command, ['/usr/games/sgt-flood']);
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.start_new_session, true);
  assert.equal(observed.options.env.XDG_CONFIG_HOME, '/home/kid/.local/share/kidos-native/config');
  assert.equal(observed.options.env.HOME, '/home/kid');
  assert.equal(observed.options.env.GDK_BACKEND, 'wayland');
  assert.equal(observed.options.env.PATH, '/usr/bin:/bin');
  for (const key of ['LD_PRELOAD', 'PYTHONPATH', 'GTK_MODULES', 'GIO_EXTRA_MODULES']) assert.equal(observed.options.env[key], undefined);
});

test('chooser search matches names and descriptions, ignores letter case and preserves all games when cleared', () => {
  python(`
assert m['matching_ids'](catalog, '  FLOOD  ') == ('flood',)
assert m['matching_ids'](catalog, 'sudoku') == ('solo',)
assert m['matching_ids'](catalog, '<script>') == ()
assert len(m['matching_ids'](catalog, '  ')) == 40
assert len(m['matching_ids'](catalog, 'matching')) > 1
`);
});

test('chooser rejects symlinked, writable, nonexecutable and non-root puzzle files or parents', () => {
  python(`
binary = '/usr/games/sgt-flood'
def facts(mode, uid=0, nlink=1):
    return SimpleNamespace(st_mode=mode, st_uid=uid, st_nlink=nlink)
def inspect(path):
    return facts(stat.S_IFREG | 0o755) if path == binary else facts(stat.S_IFDIR | 0o755)
assert m['protected_binary'](binary, inspect)
for info in [facts(stat.S_IFLNK | 0o777), facts(stat.S_IFREG | 0o777), facts(stat.S_IFREG | 0o644),
             facts(stat.S_IFREG | 0o755, uid=1000), facts(stat.S_IFREG | 0o755, nlink=2), facts(stat.S_IFDIR | 0o755)]:
    assert not m['protected_binary'](binary, lambda path: info if path == binary else inspect(path))
for info in [facts(stat.S_IFLNK | 0o755), facts(stat.S_IFDIR | 0o777), facts(stat.S_IFDIR | 0o755, uid=1000)]:
    assert not m['protected_binary'](binary, lambda path: info if path == '/usr/games' else inspect(path))
def missing(path):
    raise FileNotFoundError(path)
assert not m['protected_binary'](binary, missing)
`);
});

test('native Puzzle Box availability and Pi launch fail closed when an installed puzzle or GTK binding is missing', async () => {
  const user = { username: 'kid', uid: 1000, gid: 1000, homedir: '/home/kid' };
  const session = { targetKind: 'raspberry-pi', user };
  const inspect = async () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 1000, mode: 0o700 });
  for (const missing of ['/usr/games/sgt-untangle', '/usr/lib/aarch64-linux-gnu/girepository-1.0/Gtk-3.0.typelib']) {
    const checkFile = async path => { if (path === missing) throw new Error('missing package file'); };
    const apps = await listApps({ session, inspect, checkFile });
    assert.equal(apps.find(app => app.id === 'puzzlebox').reason, 'not-installed');
    let started = false;
    await assert.rejects(launch('puzzlebox', { session, inspect, checkFile, spawnProcess() { started = true; } }), /missing package file/);
    assert.equal(started, false);
  }
  const environment = piEnvironment(user, { PYTHONPATH: '/evil', GTK_MODULES: '/evil', GDK_BACKEND: 'x11' }, 'puzzlebox');
  assert.equal(environment.GDK_BACKEND, 'wayland'); assert.equal(environment.PYTHONPATH, undefined); assert.equal(environment.GTK_MODULES, undefined);
});
