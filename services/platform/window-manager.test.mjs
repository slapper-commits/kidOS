import test from 'node:test';
import assert from 'node:assert/strict';
import { clampBounds, defaultBounds, resizeBounds, WindowModel } from '../../apps/desktop/window-manager.mjs';

const viewport = { width: 1200, height: 800 };
const initial = { x: 200, y: 150, width: 500, height: 400 };

function contained(bounds, size) {
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.width > 0 && bounds.height > 0);
  assert.ok(bounds.x + bounds.width <= size.width);
  assert.ok(bounds.y + bounds.height <= size.height);
  for (const value of Object.values(bounds)) assert.ok(Number.isFinite(value));
}

test('window bounds remain reachable on tiny and resized workspaces', () => {
  for (const size of [viewport, { width: 390, height: 450 }, { width: 120, height: 90 }, { width: 1, height: 1 }]) {
    for (const bounds of [initial, { x: -9999, y: 9999, width: 5000, height: -12 }, { x: NaN, y: Infinity, width: NaN, height: Infinity }]) contained(clampBounds(bounds, size), size);
    for (let i = 0; i < 20; i++) contained(defaultBounds(size, i), size);
  }
  assert.deepEqual(clampBounds(initial, { width: 120, height: 90 }), { x: 0, y: 0, width: 120, height: 90 });
});

test('all eight resize handles keep their opposite edges anchored', () => {
  const expected = {
    n: { x: 200, y: 170, width: 500, height: 380 },
    ne: { x: 200, y: 170, width: 530, height: 380 },
    e: { x: 200, y: 150, width: 530, height: 400 },
    se: { x: 200, y: 150, width: 530, height: 420 },
    s: { x: 200, y: 150, width: 500, height: 420 },
    sw: { x: 230, y: 150, width: 470, height: 420 },
    w: { x: 230, y: 150, width: 470, height: 400 },
    nw: { x: 230, y: 170, width: 470, height: 380 },
  };
  for (const [edge, bounds] of Object.entries(expected)) assert.deepEqual(resizeBounds(initial, edge, 30, 20, viewport), bounds, edge);
});

test('oversized resize motions stop at the desktop edge and minimum size', () => {
  for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    for (const amount of [-10000, 10000]) {
      const resized = resizeBounds(initial, edge, amount, amount, viewport);
      contained(resized, viewport);
      assert.ok(resized.width >= 360 && resized.height >= 240);
      if (edge.includes('w')) assert.equal(resized.x + resized.width, initial.x + initial.width);
      if (edge.includes('n')) assert.equal(resized.y + resized.height, initial.y + initial.height);
    }
  }
  assert.throws(() => resizeBounds(initial, 'invalid', 0, 0, viewport), /Unknown/);
});

test('opening, activating, and minimizing independent windows preserves content identity', () => {
  const model = new WindowModel(viewport);
  const editor = model.open('editor', initial), player = model.open('player');
  const draft = { text: 'Unsaved idea' }, playback = { position: 43 };
  editor.application = draft; player.application = playback;
  assert.equal(model.activeId, 'player');
  model.activate('editor');
  assert.deepEqual(model.order, ['player', 'editor']);
  assert.equal(model.get('player').active, false);
  model.minimize('editor');
  assert.equal(model.activeId, 'player');
  assert.equal(editor.minimized, true);
  assert.strictEqual(model.activate('editor'), editor);
  assert.equal(editor.minimized, false);
  assert.strictEqual(editor.application, draft);
  assert.strictEqual(player.application, playback);
  assert.equal(model.list().length, 2);
  assert.strictEqual(model.open('editor'), editor);
  assert.equal(model.list().length, 2, 'opening an existing application focuses its mounted window');
});

test('maximizing and restoring retain each window’s floating geometry', () => {
  const model = new WindowModel(viewport);
  model.open('editor', initial);
  model.open('library', { x: 50, y: 40, width: 600, height: 600 });
  model.toggleMaximize('editor');
  assert.deepEqual(model.displayBounds('editor'), { x: 0, y: 0, ...viewport });
  model.move('editor', 100, 100); model.resize('editor', 'se', 100, 100);
  assert.deepEqual(model.get('editor').bounds, initial);
  model.toggleMaximize('editor');
  assert.deepEqual(model.displayBounds('editor'), initial);
  assert.deepEqual(model.displayBounds('library'), { x: 50, y: 40, width: 600, height: 600 });
});

test('desktop resize clamps saved restore geometry even for maximized windows', () => {
  const model = new WindowModel(viewport);
  model.open('editor', { x: 650, y: 300, width: 550, height: 500 });
  model.toggleMaximize('editor');
  const smaller = { width: 800, height: 600 };
  model.setViewport(smaller);
  assert.deepEqual(model.displayBounds('editor'), { x: 0, y: 0, ...smaller });
  model.toggleMaximize('editor');
  contained(model.displayBounds('editor'), smaller);
  assert.deepEqual(model.displayBounds('editor'), { x: 250, y: 100, width: 550, height: 500 });
});

test('closing and minimizing choose the last visible window without resurrecting minimized ones', () => {
  const model = new WindowModel(viewport);
  model.open('files'); model.open('editor'); model.open('library');
  model.minimize('editor');
  model.close('library');
  assert.equal(model.activeId, 'files');
  assert.equal(model.get('editor').minimized, true);
  model.minimize('files');
  assert.equal(model.activeId, null);
  model.close('editor');
  assert.equal(model.activeId, null);
  assert.equal(model.get('files').minimized, true);
  model.activate('missing'); model.minimize('missing'); model.close('missing');
  assert.equal(model.list().length, 1);
});

test('keyboard cycling follows stable application order across repeated switches', () => {
  const model = new WindowModel(viewport);
  model.open('files'); model.open('editor'); model.open('library');
  assert.equal(model.cycle().id, 'files');
  assert.equal(model.cycle().id, 'editor');
  assert.equal(model.cycle().id, 'library');
  assert.equal(model.cycle(-1).id, 'editor');
  model.minimize('files');
  assert.equal(model.cycle().id, 'library');
  assert.equal(model.cycle().id, 'editor');
  model.minimize('editor'); model.minimize('library');
  assert.equal(model.cycle().id, 'files');
  assert.equal(model.get('files').minimized, false);
});

// A deliberately small event fixture checks lifecycle contracts, not browser
// rendering, pointer capture across frames, or physical touch accessibility.
class ElementFixture {
  constructor(document) {
    this.ownerDocument = document;
    this.listeners = new Map(); this.style = {}; this.dataset = {}; this.attributes = {}; this.children = [];
    const classes = new Set();
    this.classList = {
      add: (...values) => values.forEach(value => classes.add(value)),
      remove: (...values) => values.forEach(value => classes.delete(value)),
      toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value),
      contains: value => classes.has(value),
    };
  }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, properties = {}) {
    const event = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...properties };
    this.listeners.get(type)?.forEach(callback => callback(event));
  }
  append(...elements) { this.children.push(...elements); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.removed = true; }
  focus() { this.focused = true; this.ownerDocument.activeElement = this; }
  closest() { return null; }
  setPointerCapture(id) { this.pointer = id; }
  hasPointerCapture(id) { return this.pointer === id; }
  releasePointerCapture() { this.pointer = undefined; }
}
async function managerFixture(callbacks = {}) {
  const { createWindowManager } = await import('../../apps/desktop/window-manager.mjs');
  const document = new ElementFixture();
  document.defaultView = new ElementFixture(document);
  document.createElement = () => new ElementFixture(document);
  const workspace = new ElementFixture(document);
  workspace.clientWidth = viewport.width; workspace.clientHeight = viewport.height;
  const manager = createWindowManager({ workspace, ...callbacks });
  const register = (id, options = {}) => manager.register({
    id, title: id, bounds: initial,
    element: new ElementFixture(document), titlebar: new ElementFixture(document), taskButton: new ElementFixture(document),
    minimizeButton: new ElementFixture(document), maximizeButton: new ElementFixture(document), closeButton: new ElementFixture(document),
    applicationData: { draft: `${id} unsaved text` },
    ...options,
  });
  return { manager, workspace, document, register };
}

test('compact presentation retains mounted contents and restores floating arrangements', async () => {
  const f = await managerFixture();
  const editor = f.register('editor'), library = f.register('library');
  const contents = editor.element.children;
  f.manager.setMode('tablet');
  assert.equal(editor.element.hidden, true); assert.equal(editor.element.inert, true);
  assert.equal(library.element.hidden, false);
  assert.equal(library.element.style.width, '1200px');
  f.manager.activate('editor');
  assert.equal(editor.element.hidden, false); assert.equal(library.element.hidden, true);
  assert.equal(editor.maximizeButton.disabled, true);
  f.workspace.clientWidth = 390; f.manager.layout();
  assert.equal(editor.element.style.width, '390px');
  assert.deepEqual(editor.bounds, initial, 'compact dimensions do not erase desktop bounds');
  f.workspace.clientWidth = 1200; f.manager.setMode('computer');
  assert.equal(editor.element.style.left, '200px'); assert.equal(editor.element.style.width, '500px');
  assert.equal(library.element.hidden, false); assert.equal(library.element.inert, false);
  assert.strictEqual(editor.element.children, contents);
  assert.equal(editor.applicationData.draft, 'editor unsaved text');
  f.manager.destroy();
});

test('Computer mode keeps multiple windows visible even below the old compact breakpoint', async () => {
  const f = await managerFixture();
  f.workspace.clientWidth = 640; f.manager.layout();
  const editor = f.register('editor'), library = f.register('library');
  assert.equal(f.manager.isCompact(), false);
  assert.equal(editor.element.hidden, false);
  assert.equal(library.element.hidden, false);
  assert.equal(editor.maximizeButton.disabled, false);
  f.manager.activate('editor');
  assert.equal(library.element.hidden, false);
  f.manager.minimize('editor');
  assert.equal(editor.element.hidden, true);
  assert.equal(library.element.hidden, false);
  f.manager.activate('editor');
  assert.equal(editor.element.hidden, false);
  f.manager.destroy();
});

test('task buttons switch, minimize, and restore without replacing application nodes', async () => {
  const active = [], minimized = [];
  const f = await managerFixture({ onActivate: record => active.push(record?.id || null), onMinimize: record => minimized.push(record.id) });
  const editor = f.register('editor'), library = f.register('library');
  editor.taskButton.emit('click');
  assert.equal(editor.active, true); assert.equal(editor.element.hidden, false);
  editor.taskButton.emit('click');
  assert.equal(editor.minimized, true); assert.equal(library.active, true);
  editor.taskButton.emit('click');
  assert.equal(editor.minimized, false); assert.strictEqual(f.manager.get('editor'), editor);
  assert.deepEqual(minimized, ['editor']);
  assert.deepEqual(active, ['editor', 'library', 'editor', 'library', 'editor']);
  assert.equal(editor.taskButton.attributes['aria-pressed'], 'true');
  f.manager.destroy();
});

test('a canceled asynchronous close keeps the exact window and its unsaved state', async () => {
  let resolveClose;
  const pending = new Promise(resolve => { resolveClose = resolve; });
  let attempts = 0;
  const f = await managerFixture({ onClose: () => { attempts++; return pending; } });
  const editor = f.register('editor');
  const closing = f.manager.close('editor');
  assert.equal(await f.manager.close('editor'), false, 'a second close cannot duplicate a pending draft dialog');
  assert.equal(attempts, 1);
  resolveClose(false);
  assert.equal(await closing, false);
  assert.strictEqual(f.manager.get('editor'), editor);
  assert.equal(editor.element.removed, undefined);
  assert.equal(editor.applicationData.draft, 'editor unsaved text');
  assert.equal(editor.closing, false);
  f.manager.destroy();
});

test('successful close detaches only its own window and chooses the remaining window', async () => {
  const f = await managerFixture();
  const editor = f.register('editor'), library = f.register('library');
  assert.equal(await f.manager.close('library'), true);
  assert.equal(library.element.removed, true); assert.equal(library.taskButton.removed, true);
  assert.equal(library.element.listeners.get('pointerdown').size, 0);
  assert.equal(editor.active, true); assert.equal(editor.element.removed, undefined);
  assert.strictEqual(f.manager.get('editor'), editor);
  f.manager.destroy();
});

test('titlebar keyboard and pointer movement update geometry without rebuilding content', async () => {
  const f = await managerFixture();
  const editor = f.register('editor');
  editor.titlebar.emit('keydown', { key: 'ArrowRight', altKey: true });
  assert.equal(editor.bounds.x, 220);
  editor.titlebar.emit('keydown', { key: 'ArrowDown', altKey: true, shiftKey: true });
  assert.equal(editor.bounds.height, 420);
  editor.titlebar.emit('pointerdown', { button: 0, pointerId: 7, clientX: 250, clientY: 160 });
  f.document.emit('pointermove', { pointerId: 7, clientX: -999, clientY: -999 });
  assert.equal(editor.bounds.x, 0); assert.equal(editor.bounds.y, 0);
  f.document.emit('pointerup', { pointerId: 7 });
  assert.equal(editor.titlebar.pointer, undefined);
  assert.equal(f.workspace.classList.contains('has-window-gesture'), false);
  assert.equal(editor.element.children.length, 8, 'resize handles are mounted once');
  assert.equal(editor.applicationData.draft, 'editor unsaved text');
  f.manager.destroy();
});

test('left and right snapping tiles odd-width screens and restores original floating bounds', () => {
  const model = new WindowModel({ width: 1201, height: 800 });
  model.open('editor', initial); model.open('library', initial);
  model.snap('editor', 'left'); model.snap('library', 'right');
  assert.deepEqual(model.displayBounds('editor'), { x: 0, y: 0, width: 601, height: 800 });
  assert.deepEqual(model.displayBounds('library'), { x: 601, y: 0, width: 600, height: 800 });
  assert.deepEqual(model.get('editor').bounds, initial);
  model.snap('editor', 'right'); model.snap('editor', 'left'); model.restore('editor');
  assert.deepEqual(model.displayBounds('editor'), initial);
  assert.equal(model.get('editor').snap, null);
  model.snap('editor', 'right'); model.maximize('editor');
  assert.equal(model.get('editor').snap, null);
  assert.equal(model.get('editor').maximized, true);
  model.restore('editor');
  assert.deepEqual(model.displayBounds('editor'), initial);
  assert.throws(() => model.snap('editor', 'middle'), /Unknown window snap side/);
});

test('snapped windows follow viewport changes while keeping clamped restore geometry', () => {
  const model = new WindowModel(viewport);
  model.open('editor', { x: 700, y: 300, width: 500, height: 500 });
  model.snap('editor', 'right');
  model.setViewport({ width: 900, height: 650 });
  assert.deepEqual(model.displayBounds('editor'), { x: 450, y: 0, width: 450, height: 650 });
  assert.deepEqual(model.get('editor').bounds, { x: 400, y: 150, width: 500, height: 500 });
  model.restore('editor');
  assert.deepEqual(model.displayBounds('editor'), { x: 400, y: 150, width: 500, height: 500 });
  model.snap('editor', 'left'); model.resize('editor', 'e', 40, 0);
  assert.equal(model.get('editor').snap, null);
  assert.deepEqual(model.displayBounds('editor'), { x: 0, y: 0, width: 490, height: 650 });
});

test('layout snapshots round-trip geometry, stacking, minimize, maximize and snap without app data', () => {
  const original = new WindowModel(viewport);
  original.open('files', initial); original.open('editor'); original.open('library'); original.open('game');
  original.snap('library', 'left'); original.maximize('game'); original.activate('editor'); original.minimize('files');
  const saved = JSON.parse(JSON.stringify(original.snapshot()));
  assert.deepEqual(saved.entries.map(entry => entry.id), original.order);
  assert.deepEqual(Object.keys(saved.entries[0]).sort(), ['bounds', 'id', 'maximized', 'minimized', 'snap']);
  const reopened = new WindowModel(viewport);
  for (const id of ['game', 'library', 'editor', 'files']) reopened.open(id);
  const editor = reopened.get('editor'); editor.draft = { text: 'Still editing' };
  reopened.restoreLayout(saved);
  assert.deepEqual(reopened.snapshot(), saved);
  assert.strictEqual(reopened.get('editor'), editor);
  assert.equal(editor.draft.text, 'Still editing');
  assert.equal(reopened.get('files').minimized, true);
  saved.entries[0].bounds.x = 999;
  assert.notEqual(reopened.snapshot().entries[0].bounds.x, 999, 'saved preferences never alias live geometry');
});

test('restoring minimized registrations leaves the desktop visible instead of opening a window', () => {
  const model = new WindowModel(viewport);
  model.open('editor', initial, { minimized: true, maximized: true });
  model.open('library', initial, { minimized: true, snap: 'right' });
  assert.equal(model.activeId, null);
  assert.equal(model.get('editor').maximized, true);
  const saved = model.snapshot();
  model.activate('editor'); model.restoreLayout({ ...saved, activeId: 'editor' });
  assert.equal(model.activeId, null, 'a stale active ID cannot unminimize restored windows');
  assert.ok(model.list().every(record => record.minimized && !record.active));
  model.activate('library');
  assert.equal(model.get('library').snap, 'right', 'taskbar restore retains the snapped shape');
});

test('layout restoration ignores unknown entries and normalizes damaged preferences', () => {
  const model = new WindowModel(viewport);
  model.open('untouched', initial); model.open('editor');
  model.restoreLayout({ entries: [null, { id: 'missing' }, { id: 'editor', bounds: { x: -100, y: 99999, width: Infinity, height: -10 }, minimized: 'yes', maximized: false, snap: 'bogus' }, { id: 'editor', minimized: true }], activeId: 'missing' });
  assert.deepEqual(model.order, ['untouched', 'editor']);
  contained(model.get('editor').bounds, viewport);
  assert.equal(model.get('editor').minimized, false);
  assert.equal(model.get('editor').snap, null);
  assert.deepEqual(model.get('untouched').bounds, initial);
  assert.equal(model.activeId, 'editor');
  const before = model.snapshot();
  model.restoreLayout(null); model.restoreLayout({ entries: 'bad' });
  assert.deepEqual(model.snapshot(), before);
});

test('manager keyboard snapping and restore notify persistence without remounting application content', async () => {
  const changes = [];
  const f = await managerFixture({ onChange: records => changes.push(records.map(record => ({ id: record.id, snap: record.snap, maximized: record.maximized }))) });
  const editor = f.register('editor');
  const content = editor.element.children;
  const key = value => editor.element.emit('keydown', { key: value, ctrlKey: true, altKey: true });
  key('ArrowLeft');
  assert.equal(editor.snap, 'left'); assert.equal(editor.element.style.width, '600px');
  key('ArrowRight'); assert.equal(editor.element.style.left, '600px');
  key('ArrowUp'); assert.equal(editor.maximized, true); assert.equal(editor.snap, null);
  key('ArrowDown'); assert.equal(editor.maximized, false); assert.deepEqual(editor.bounds, initial);
  assert.equal(editor.element.style.left, '200px');
  assert.strictEqual(editor.element.children, content);
  assert.ok(changes.some(records => records[0]?.snap === 'left'));
  assert.ok(changes.some(records => records[0]?.maximized));
  f.manager.setMode('tablet'); key('ArrowRight');
  assert.equal(editor.snap, null, 'compact keyboard input cannot alter the saved arrangement');
  f.manager.destroy();
});

test('compact reload preserves wide saved positions and inactive windows across layout restoration', async () => {
  const active = [];
  const f = await managerFixture({ onActivate: record => active.push(record?.id || null) });
  f.workspace.clientWidth = 390; f.manager.setMode('tablet');
  const wide = { x: 850, y: 100, width: 600, height: 550 };
  const editor = f.register('editor', { bounds: wide, minimized: true, snap: 'right' });
  assert.deepEqual(editor.bounds, wide);
  assert.equal(editor.element.hidden, true);
  assert.deepEqual(active, []);
  f.manager.restoreLayout({ entries: [{ id: 'editor', bounds: wide, minimized: true, maximized: false, snap: 'right' }], activeId: null });
  assert.deepEqual(editor.bounds, wide);
  assert.equal(f.manager.snapshot().activeId, null);
  f.workspace.clientWidth = 1600; f.manager.setMode('computer');
  f.manager.activate('editor');
  assert.equal(editor.element.style.left, '800px');
  f.manager.restore('editor');
  assert.equal(editor.element.style.left, '850px'); assert.equal(editor.element.style.width, '600px');
  f.manager.destroy();
});

test('clicking a snapped titlebar retains snapping, while dragging creates floating geometry', async () => {
  const f = await managerFixture();
  const editor = f.register('editor');
  f.manager.snap('editor', 'right');
  editor.titlebar.emit('pointerdown', { button: 0, pointerId: 4, clientX: 610, clientY: 10 });
  f.document.emit('pointerup', { pointerId: 4 });
  assert.equal(editor.snap, 'right'); assert.deepEqual(editor.bounds, initial);
  editor.titlebar.emit('pointerdown', { button: 0, pointerId: 5, clientX: 610, clientY: 10 });
  f.document.emit('pointermove', { pointerId: 5, clientX: 510, clientY: 10 });
  f.document.emit('pointerup', { pointerId: 5 });
  assert.equal(editor.snap, null);
  assert.equal(editor.element.style.left, '500px');
  assert.equal(editor.bounds.width, 600);
  f.manager.destroy();
});

test('drag and resize transfer DOM focus away from an app frame before suppressing pointer defaults', async () => {
  const f = await managerFixture();
  const editor = f.register('editor'), app = f.register('app');
  const frame = new ElementFixture(f.document); frame.tagName = 'IFRAME';
  app.element.append(frame); f.manager.maximize('app');
  for (const source of [editor.titlebar, editor.element.children.find(child => child.dataset.edge === 'se')]) {
    f.manager.activate('app'); f.document.activeElement = frame;
    let prevented = false;
    source.emit('pointerdown', { button: 0, pointerId: 8, clientX: 220, clientY: 160, preventDefault() {
      prevented = true;
      assert.strictEqual(f.document.activeElement, editor.titlebar, 'DOM focus must move before its default transfer is suppressed.');
    } });
    assert.equal(prevented, true); assert.equal(editor.active, true);
    assert.notEqual(f.document.activeElement?.tagName, 'IFRAME', 'Frame-focus polling must no longer see the previous app.');
    f.document.emit('pointermove', { pointerId: 8, clientX: 260, clientY: 180 });
    assert.equal(editor.active, true); assert.equal(app.active, false);
    f.document.emit('pointerup', { pointerId: 8 });
  }
  f.manager.destroy();
});
