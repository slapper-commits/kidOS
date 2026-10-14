// Only these fixed applications may cross the trusted desktop's native bridge.
// Browser projects and game frames receive neither this client nor native authority.
export const NATIVE_ORIGIN = 'http://127.0.0.1:8787';
export const NATIVE_APPS = Object.freeze([
  { id: 'paint', name: 'Paint', icon: 'paint', description: 'Draw, paint and save pictures.', shortcut: true },
  { id: 'writer', name: 'Write', icon: 'writer', description: 'Write stories, add pictures and save documents.', shortcut: true },
  { id: 'calculator', name: 'Calculator', icon: 'calculator', description: 'Work out sums and copy the answer.', shortcut: true },
  { id: 'files', name: 'Files', icon: 'stuff', description: 'Open your Pictures and ordinary folders.', shortcut: true, folderName: 'Pictures' },
  { id: 'documents', name: 'Documents', icon: 'file', description: 'Stories, notes and other documents.', folderName: 'Documents', folderOnly: true },
  { id: 'downloads', name: 'Downloads', icon: 'download', description: 'Files you downloaded or exported.', folderName: 'Downloads', folderOnly: true },
  { id: 'trash', name: 'Trash', icon: 'trash', description: 'Find and restore files you put away.' },
  { id: 'puttzoo', name: 'Putt-Putt (demo)', icon: 'car', description: 'A separately installed point-and-click adventure demo.', controls: 'Click to explore, talk and solve puzzles.', game: true },
  { id: 'openttd', name: 'OpenTTD', icon: 'train', description: 'Build a transport world with trains, roads, ships and planes.', controls: 'Choose New Game to build your first transport company.', game: true, shortcut: true },
  { id: 'solitaire', name: 'Solitaire', icon: 'solitaire', description: 'A deck of cards, a little strategy and a fresh deal whenever you like.', controls: 'Choose Klondike for classic Solitaire. Drag cards to move them; try Hint or Undo when you need a hand.', game: true, shortcut: true },
  { id: 'minesweeper', name: 'Minesweeper', icon: 'minesweeper', description: 'Follow the numbers and uncover the board without finding a mine.', controls: 'Click to uncover a square. Right-click to flag a mine.', game: true, shortcut: true },
  { id: 'pinball', name: 'Pinball', icon: 'pinball', description: 'Keep the ball in play, hit the bumpers and chase a high score.', controls: 'Choose a table. Enter launches the ball; left and right Shift control the flippers. Esc opens the menu.', game: true, shortcut: true },
  { id: 'puzzlebox', name: 'Puzzle Box', icon: 'puzzlebox', description: 'A collection of logic, shape and number puzzles, each in its own window.', controls: 'Choose a puzzle to begin. Try the Type menu for board size or difficulty. Game has New, Undo and Save.', game: true, shortcut: true },
].map(Object.freeze));
export const NATIVE_REQUIREMENT = 'These apps need the kidOS Linux desktop.';
const CONNECTION_MESSAGES = Object.freeze({
  'invalid-response': 'The desktop app connection sent an unreadable reply. Reload kidOS and check again.',
  invalid_request: 'The desktop app connection could not verify its request. Reload kidOS and check again.',
  host_rejected: 'The desktop app connection could not verify this desktop. Reopen kidOS and check again.',
  invalid_response: 'The desktop app connection sent an unreadable reply. Reload kidOS and check again.',
  catalog_mismatch: 'The desktop app connection needs the same app version as kidOS. Reopen kidOS and check again.',
  unavailable: 'The desktop app connection is unavailable. Reopen kidOS and check again.',
  timeout: 'The desktop app connection did not respond. Check again.',
  busy: 'The desktop app connection is busy. Wait a moment and check again.',
  closed: 'The desktop app connection has closed. Reload kidOS to reconnect.',
});
const SOURCE = 'kidos-native-v1';
const known = new Set(NATIVE_APPS.map(app => app.id));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const shortText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const failure = (code, message) => Object.assign(new Error(message), { code });
const connectionError = error => {
  const code = Object.hasOwn(CONNECTION_MESSAGES, error?.code) ? error.code : 'unavailable';
  return { code, message: CONNECTION_MESSAGES[code] };
};

export function nativeAvailabilityText(snapshot) {
  if (snapshot.status === 'checking') return 'Checking desktop apps…';
  if (snapshot.status !== 'ready') return snapshot.error ? connectionError(snapshot.error).message : NATIVE_REQUIREMENT;
  return snapshot.apps.every(app => app.available)
    ? 'These apps open in their own windows. Use your desktop to switch between them.'
    : 'Some apps are not installed or ready on this Linux desktop. Use your desktop to switch windows.';
}

export function nativeEntryStatus(snapshot, appId) {
  if (snapshot.status === 'checking') return 'Checking availability…';
  if (snapshot.status !== 'ready') return snapshot.error ? connectionError(snapshot.error).message : NATIVE_REQUIREMENT;
  const app = snapshot.apps.find(item => item.id === appId);
  if (app?.available) return '';
  return app?.reason === 'not-configured' || NATIVE_APPS.find(item => item.id === appId)?.folderOnly
    ? 'Not ready on this computer.' : 'Not installed on this computer.';
}

export function createNativeApps({ target, origin = target.location.origin, requestId = () => crypto.randomUUID(),
  catalogTimeout = 3000, launchTimeout = 8000, onChange = () => {} }) {
  const pending = new Map();
  const launches = new Map();
  let catalog = null;
  let disposed = false;
  let current = { status: origin === NATIVE_ORIGIN ? 'idle' : 'unavailable', apps: [] };
  const snapshot = () => ({ status: current.status, apps: current.apps.map(app => ({ ...app })), ...(current.error ? { error: { ...current.error } } : {}) });
  const update = (status, apps = [], error) => { current = { status, apps, ...(error ? { error } : {}) }; onChange(snapshot()); };

  function receive(event) {
    if (event.source !== target || event.origin !== NATIVE_ORIGIN || origin !== NATIVE_ORIGIN) return;
    const message = event.data;
    if (!record(message) || message.source !== SOURCE || message.type !== 'response' || typeof message.requestId !== 'string') return;
    const waiting = pending.get(message.requestId);
    if (!waiting) return; // A timed-out or unrelated reply has no effect.
    if (message.ok === false && exactKeys(message, ['source', 'type', 'requestId', 'ok', 'error']) &&
        exactKeys(message.error, ['code', 'message']) && shortText(message.error.code, 64) && shortText(message.error.message, 280)) {
      waiting.finish(failure(message.error.code, message.error.message));
      return;
    }
    let valid = message.ok === true && exactKeys(message, ['source', 'type', 'requestId', 'ok', 'result']);
    const result = message.result;
    if (waiting.method === 'listApps') {
      valid = valid && exactKeys(result, ['apps']) && Array.isArray(result.apps) && result.apps.length === known.size &&
        new Set(result.apps.map(app => app?.id)).size === known.size && result.apps.every(app =>
          record(app) && known.has(app.id) && typeof app.available === 'boolean' && shortText(app.name, 100) &&
          Object.keys(app).every(key => ['id', 'name', 'available', 'reason'].includes(key)) &&
          (!Object.hasOwn(app, 'reason') || shortText(app.reason, 100)));
    } else valid = valid && exactKeys(result, ['appId', 'status']) && result.appId === waiting.appId && ['started', 'focused', 'already-running'].includes(result.status);
    if (!valid) waiting.finish(failure('invalid-response', 'Desktop apps sent an unreadable reply. Try again.'));
    else waiting.finish(null, result);
  }
  target.addEventListener('message', receive);

  function request(method, appId) {
    if (disposed) return Promise.reject(failure('closed', 'The desktop connection has closed. Reload kidOS to reconnect.'));
    if (origin !== NATIVE_ORIGIN) return Promise.reject(failure('unavailable', NATIVE_REQUIREMENT));
    const id = requestId();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        if (!pending.has(id)) return;
        clearTimeout(timer); pending.delete(id);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(failure('timeout', method === 'launch'
        ? 'No launch reply arrived. Check whether the app is already open before trying again.'
        : CONNECTION_MESSAGES.timeout)), method === 'launch' ? launchTimeout : catalogTimeout);
      pending.set(id, { method, appId, finish });
      try { target.postMessage({ source: SOURCE, type: 'request', requestId: id, method, ...(appId ? { appId } : {}) }, NATIVE_ORIGIN); }
      catch { finish(failure('unavailable', CONNECTION_MESSAGES.unavailable)); }
    });
  }

  function refresh({ retry = false } = {}) {
    if (catalog) return catalog;
    if (origin !== NATIVE_ORIGIN) { update('unavailable'); return Promise.resolve(snapshot()); }
    update('checking');
    catalog = (async () => {
      try {
        let result;
        try { result = await request('listApps'); }
        catch (error) {
          // One startup retry covers a late extension listener. Never retry launches.
          if (!retry || error.code !== 'timeout' || disposed) throw error;
          result = await request('listApps');
        }
        // Names and help belong to the desktop; the bridge supplies availability only.
        update('ready', NATIVE_APPS.map(app => {
          const entry = result.apps.find(item => item.id === app.id);
          return { id: app.id, available: entry.available, ...(entry.reason ? { reason: entry.reason } : {}) };
        }));
      } catch (error) { update('unavailable', [], connectionError(error)); }
      finally { catalog = null; }
      return snapshot();
    })();
    return catalog;
  }
  function launch(appId) {
    if (!known.has(appId)) return Promise.reject(failure('unknown-app', 'Choose an application from Applications.'));
    if (launches.has(appId)) return launches.get(appId);
    const launching = (async () => {
      if (current.status !== 'ready') await refresh();
      if (current.status !== 'ready') throw current.error ? failure(current.error.code, current.error.message) : failure('unavailable', NATIVE_REQUIREMENT);
      if (!current.apps.find(app => app.id === appId)?.available) {
        const app = NATIVE_APPS.find(app => app.id === appId);
        throw failure('not-installed', `${app.name}: ${nativeEntryStatus(current, appId)}`);
      }
      return request('launch', appId);
    })().finally(() => launches.delete(appId));
    launches.set(appId, launching);
    return launching;
  }
  function dispose() {
    disposed = true;
    target.removeEventListener('message', receive);
    for (const waiting of pending.values()) waiting.finish(failure('closed', 'The desktop connection has closed. Reload kidOS to reconnect.'));
  }
  return { snapshot, refresh, launch, dispose };
}
