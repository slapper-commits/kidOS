// Desktop window geometry is independent of application contents. Moving,
// minimizing, and switching windows never detach a mounted editor or player.
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const limit = (value, low, high) => Math.min(high, Math.max(low, value));
export const WINDOW_MINIMUM = Object.freeze({ width: 360, height: 240 });
const edges = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const snapSide = value => value === 'left' || value === 'right' ? value : null;

function viewportSize(viewport) {
  return { width: Math.max(1, finite(viewport.width, 1)), height: Math.max(1, finite(viewport.height, 1)) };
}
function minimumSize(viewport, minimum) {
  return { width: Math.min(viewport.width, Math.max(1, finite(minimum.width, WINDOW_MINIMUM.width))), height: Math.min(viewport.height, Math.max(1, finite(minimum.height, WINDOW_MINIMUM.height))) };
}
export function clampBounds(bounds, viewport, minimum = WINDOW_MINIMUM) {
  const size = viewportSize(viewport), min = minimumSize(size, minimum);
  const width = limit(finite(bounds.width, min.width), min.width, size.width);
  const height = limit(finite(bounds.height, min.height), min.height, size.height);
  return { x: limit(finite(bounds.x, 0), 0, size.width - width), y: limit(finite(bounds.y, 0), 0, size.height - height), width, height };
}
export function defaultBounds(viewport, index = 0) {
  const size = viewportSize(viewport), cascade = (index % 7) * 26;
  return clampBounds({ x: 120 + cascade, y: 24 + cascade, width: Math.min(880, size.width - 150), height: Math.min(640, size.height - 60) }, size);
}
function restoredBounds(bounds, viewport, deferClamp) {
  if (!deferClamp) return clampBounds(bounds, viewport);
  // A narrow layout can reopen a saved desktop arrangement without shrinking
  // it permanently. Cap damaged preference values and clamp to the real screen
  // when Computer mode becomes wide enough to show floating windows again.
  const width = limit(finite(bounds.width, WINDOW_MINIMUM.width), 1, 32768);
  const height = limit(finite(bounds.height, WINDOW_MINIMUM.height), 1, 32768);
  const x = limit(finite(bounds.x, 0), 0, 32768), y = limit(finite(bounds.y, 0), 0, 32768);
  return clampBounds({ x, y, width, height }, {
    width: Math.max(viewport.width, Math.min(32768, x + width)),
    height: Math.max(viewport.height, Math.min(32768, y + height)),
  });
}
export function resizeBounds(bounds, edge, dx, dy, viewport, minimum = WINDOW_MINIMUM) {
  if (!edges.includes(edge)) throw new TypeError('Unknown window resize edge.');
  const size = viewportSize(viewport), min = minimumSize(size, minimum), start = clampBounds(bounds, size, minimum);
  const right = start.x + start.width, bottom = start.y + start.height;
  let { x, y, width, height } = start;
  dx = finite(dx, 0); dy = finite(dy, 0);
  if (edge.includes('w')) { x = limit(start.x + dx, 0, right - min.width); width = right - x; }
  if (edge.includes('e')) width = limit(start.width + dx, min.width, size.width - start.x);
  if (edge.includes('n')) { y = limit(start.y + dy, 0, bottom - min.height); height = bottom - y; }
  if (edge.includes('s')) height = limit(start.height + dy, min.height, size.height - start.y);
  return { x, y, width, height };
}

// The model keeps floating bounds while maximized or snapped; presentation modes can fill
// the workspace without throwing away a child's desktop arrangement.
export class WindowModel {
  constructor(viewport = { width: 1024, height: 720 }) {
    this.viewport = viewportSize(viewport);
    this.windows = new Map();
    this.order = [];
    this.activeId = null;
  }
  get(id) { return this.windows.get(id); }
  list() { return [...this.windows.values()]; }
  open(id, bounds, options = {}) {
    if (this.windows.has(id)) return this.activate(id);
    const maximized = options.maximized === true;
    const record = { id, bounds: restoredBounds(bounds || defaultBounds(this.viewport, this.windows.size), this.viewport, options.deferClamp), minimized: options.minimized === true, maximized, snap: maximized ? null : snapSide(options.snap), active: false };
    this.windows.set(id, record);
    if (record.minimized) this.order.push(id);
    else this.activate(id);
    return record;
  }
  activate(id) {
    const record = this.get(id);
    if (!record) return undefined;
    record.minimized = false;
    this.activeId = id;
    this.order = this.order.filter(value => value !== id);
    this.order.push(id);
    this.updateActive();
    return record;
  }
  updateActive() { for (const record of this.windows.values()) record.active = record.id === this.activeId; }
  fallback() {
    this.activeId = [...this.order].reverse().find(id => !this.get(id).minimized) || null;
    this.updateActive();
  }
  minimize(id) {
    const record = this.get(id);
    if (!record) return;
    record.minimized = true;
    if (this.activeId === id) this.fallback();
  }
  close(id) {
    if (!this.windows.delete(id)) return;
    this.order = this.order.filter(value => value !== id);
    if (this.activeId === id) this.fallback();
  }
  toggleMaximize(id) {
    const record = this.get(id);
    if (!record) return;
    return record.maximized ? this.restore(id) : this.maximize(id);
  }
  maximize(id) {
    const record = this.get(id);
    if (!record) return;
    record.maximized = true;
    record.snap = null;
    this.activate(id);
  }
  snap(id, side) {
    if (!snapSide(side)) throw new TypeError('Unknown window snap side.');
    const record = this.get(id);
    if (!record) return;
    record.snap = side;
    record.maximized = false;
    this.activate(id);
  }
  restore(id) {
    const record = this.get(id);
    if (!record) return;
    record.snap = null;
    record.maximized = false;
    this.activate(id);
  }
  detachSnap(id) {
    const record = this.get(id);
    if (!record?.snap) return;
    record.bounds = clampBounds(this.displayBounds(id), this.viewport);
    record.snap = null;
  }
  move(id, dx, dy) {
    const record = this.get(id);
    if (!record || record.maximized) return;
    this.detachSnap(id);
    record.bounds = clampBounds({ ...record.bounds, x: record.bounds.x + finite(dx, 0), y: record.bounds.y + finite(dy, 0) }, this.viewport);
  }
  resize(id, edge, dx, dy) {
    const record = this.get(id);
    if (!record || record.maximized) return;
    this.detachSnap(id);
    record.bounds = resizeBounds(record.bounds, edge, dx, dy, this.viewport);
  }
  setViewport(viewport) {
    this.viewport = viewportSize(viewport);
    for (const record of this.windows.values()) record.bounds = clampBounds(record.bounds, this.viewport);
  }
  cycle(direction = 1) {
    let candidates = this.list().filter(record => !record.minimized);
    if (!candidates.length) candidates = this.list();
    if (!candidates.length) return undefined;
    const current = candidates.findIndex(record => record.id === this.activeId);
    const index = current < 0 ? (direction < 0 ? candidates.length - 1 : 0) : (current + (direction < 0 ? -1 : 1) + candidates.length) % candidates.length;
    return this.activate(candidates[index].id);
  }
  displayBounds(id) {
    const record = this.get(id);
    if (!record) return;
    if (record.maximized) return { x: 0, y: 0, ...this.viewport };
    if (record.snap) {
      const leftWidth = Math.ceil(this.viewport.width / 2);
      const width = record.snap === 'left' ? leftWidth : Math.max(1, this.viewport.width - leftWidth);
      return { x: record.snap === 'left' ? 0 : this.viewport.width - width, y: 0, width, height: this.viewport.height };
    }
    return { ...record.bounds };
  }
  snapshot() {
    return { entries: this.order.map(id => {
      const record = this.get(id);
      return { id, bounds: { ...record.bounds }, minimized: record.minimized, maximized: record.maximized, snap: record.snap };
    }), activeId: this.activeId };
  }
  restoreLayout(snapshot, { deferClamp = false } = {}) {
    if (!snapshot || !Array.isArray(snapshot.entries)) return;
    const restored = [];
    for (const entry of snapshot.entries) {
      if (!entry || restored.includes(entry.id)) continue;
      const record = this.get(entry.id);
      if (!record) continue;
      if (entry.bounds && typeof entry.bounds === 'object') record.bounds = restoredBounds(entry.bounds, this.viewport, deferClamp);
      record.minimized = entry.minimized === true;
      record.maximized = entry.maximized === true;
      record.snap = record.maximized ? null : snapSide(entry.snap);
      restored.push(record.id);
    }
    this.order = [...this.order.filter(id => !restored.includes(id)), ...restored];
    const active = this.get(snapshot.activeId);
    if (active && !active.minimized) {
      this.activeId = active.id;
      this.updateActive();
    } else this.fallback();
  }
}

export function createWindowManager({ workspace, onActivate = () => {}, onMinimize = () => {}, onClose = () => {}, onChange = () => {} }) {
  const document = workspace.ownerDocument;
  const browser = document.defaultView;
  const measure = () => viewportSize({ width: workspace.clientWidth, height: workspace.clientHeight });
  const model = new WindowModel(measure());
  let mode = 'computer', activeBefore = null, gesture = null, destroyed = false;
  const globalCleanup = [];
  const listen = (element, type, callback, options, cleanup = globalCleanup) => {
    element.addEventListener(type, callback, options);
    cleanup.push(() => element.removeEventListener(type, callback, options));
  };
  // Computer mode is an explicit choice, even on a small display or when
  // browser zoom reduces CSS pixels. Tablet and TV keep one visible window.
  const isCompact = () => mode !== 'computer';
  function sync() {
    if (destroyed) return;
    const size = measure(), compact = isCompact();
    workspace.classList.toggle('is-compact', compact);
    for (const record of model.list()) {
      const { element, titlebar, taskButton, maximizeButton } = record;
      const bounds = compact ? { x: 0, y: 0, ...size } : model.displayBounds(record.id);
      Object.assign(element.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, zIndex: String(model.order.indexOf(record.id) + 1) });
      element.hidden = record.minimized || (compact && !record.active);
      element.inert = compact && !record.active;
      element.classList.toggle('is-active', record.active);
      element.classList.toggle('is-minimized', record.minimized);
      element.classList.toggle('is-maximized', record.maximized);
      element.classList.toggle('is-snapped', Boolean(record.snap));
      element.dataset.snap = record.snap || '';
      element.classList.toggle('is-compact', compact);
      element.setAttribute('aria-label', record.title);
      if (titlebar) {
        titlebar.title = compact ? record.title : `${record.title} — drag to move; double-click to maximize. Alt + arrows moves; Alt + Shift + arrows resizes. Ctrl + Alt + arrows snaps, maximizes, or restores.`;
        titlebar.setAttribute('aria-label', `${record.title} window title bar`);
        titlebar.setAttribute('aria-description', compact ? 'Use the taskbar to switch between open windows.' : 'Alt plus arrow keys moves this window. Alt plus Shift plus arrow keys resizes it. Ctrl plus Alt plus Left or Right snaps to that side; Up maximizes; Down restores the floating size.');
      }
      if (record.minimizeButton) record.minimizeButton.setAttribute('aria-label', `Minimize ${record.title}`);
      if (record.closeButton) record.closeButton.setAttribute('aria-label', `Close ${record.title}`);
      if (maximizeButton) {
        maximizeButton.setAttribute('aria-label', `${record.maximized ? 'Restore size of' : 'Maximize'} ${record.title}`);
        maximizeButton.setAttribute('aria-pressed', String(record.maximized));
        maximizeButton.disabled = compact;
        maximizeButton.title = compact ? 'Windows fill the screen in this layout' : record.maximized ? 'Restore size' : 'Maximize';
      }
      if (taskButton) {
        taskButton.classList.toggle('is-active', record.active);
        taskButton.setAttribute('aria-pressed', String(record.active));
        taskButton.setAttribute('aria-label', `${record.minimized ? 'Restore' : record.active ? 'Minimize' : 'Switch to'} ${record.title}`);
        taskButton.title = record.title;
      }
    }
    if (model.activeId !== activeBefore) {
      activeBefore = model.activeId;
      onActivate(model.get(model.activeId) || null);
      model.get(model.activeId)?.taskButton?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    onChange(model.list());
  }
  function activate(id, { focus = false } = {}) {
    const record = model.activate(id);
    if (!record) return;
    sync();
    if (focus) record.titlebar?.focus({ preventScroll: true });
    return record;
  }
  function minimize(id) {
    const record = model.get(id);
    if (!record || record.minimized) return;
    model.minimize(id);
    sync();
    onMinimize(record);
    record.taskButton?.focus({ preventScroll: true });
  }
  async function close(id) {
    const record = model.get(id);
    if (!record || record.closing) return false;
    record.closing = true;
    try {
      if (await onClose(record) === false) return false;
      if (gesture?.record === record) stopGesture();
      record.cleanup.forEach(cleanup => cleanup());
      model.close(id);
      record.element.remove();
      record.taskButton?.remove();
      sync();
      model.get(model.activeId)?.titlebar?.focus({ preventScroll: true });
      return true;
    } finally { record.closing = false; }
  }
  function toggleMaximize(id) {
    if (isCompact()) return;
    stopGesture();
    model.toggleMaximize(id);
    sync();
  }
  function snap(id, side) {
    if (isCompact()) return;
    stopGesture();
    model.snap(id, side);
    sync();
  }
  function maximize(id) {
    if (isCompact()) return;
    stopGesture();
    model.maximize(id);
    sync();
  }
  function restore(id) {
    if (isCompact()) return;
    stopGesture();
    model.restore(id);
    sync();
  }
  function stopGesture(event) {
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    const { source, pointerId, record } = gesture;
    gesture = null;
    record.element.classList.remove('is-moving', 'is-resizing');
    workspace.classList.remove('has-window-gesture');
    if (source.hasPointerCapture?.(pointerId)) source.releasePointerCapture(pointerId);
  }
  function startGesture(event, record, edge = null) {
    if (event.button !== 0 || record.minimized) return;
    if (!edge && event.target.closest('button, input, select, textarea, a, [contenteditable="true"]')) return;
    activate(record.id);
    if (isCompact() || record.maximized) return;
    // Preventing pointer default also prevents browser focus transfer. Move
    // DOM focus off a prior app frame before the frame-focus poll can raise it.
    record.titlebar?.focus({ preventScroll: true });
    event.preventDefault();
    stopGesture();
    const source = event.currentTarget;
    gesture = { record, edge, source, pointerId: event.pointerId, x: event.clientX, y: event.clientY, bounds: model.displayBounds(record.id) };
    record.element.classList.add(edge ? 'is-resizing' : 'is-moving');
    workspace.classList.add('has-window-gesture');
    source.setPointerCapture(event.pointerId);
  }
  function moveGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { record, edge, x, y, bounds } = gesture;
    const dx = event.clientX - x, dy = event.clientY - y;
    if (dx === 0 && dy === 0) return;
    record.snap = null;
    record.bounds = edge ? resizeBounds(bounds, edge, dx, dy, model.viewport) : clampBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, model.viewport);
    sync();
  }
  function register(input) {
    if (model.get(input.id)) return activate(input.id);
    const record = model.open(input.id, input.bounds, { ...input, deferClamp: isCompact() });
    // Keep model fields authoritative, and preserve application-specific data.
    Object.assign(record, input, { bounds: record.bounds, minimized: record.minimized, maximized: record.maximized, snap: record.snap, active: record.active, cleanup: [] });
    const { element, titlebar, taskButton, minimizeButton, maximizeButton, closeButton } = record;
    element.classList.add('managed-window');
    element.dataset.windowId = record.id;
    listen(element, 'pointerdown', () => activate(record.id), true, record.cleanup);
    listen(element, 'focusin', () => { if (!record.minimized) activate(record.id); }, false, record.cleanup);
    listen(element, 'keydown', event => {
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || isCompact() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') snap(record.id, event.key === 'ArrowLeft' ? 'left' : 'right');
      else if (event.key === 'ArrowUp') maximize(record.id);
      else restore(record.id);
    }, false, record.cleanup);
    if (titlebar) {
      titlebar.tabIndex = 0;
      listen(titlebar, 'pointerdown', event => startGesture(event, record), false, record.cleanup);
      listen(titlebar, 'dblclick', event => {
        if (!event.target.closest('button, input, select, textarea, a')) toggleMaximize(record.id);
      }, false, record.cleanup);
      listen(titlebar, 'keydown', event => {
        if (event.target !== titlebar || !event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || isCompact()) return;
        event.preventDefault(); event.stopPropagation();
        const dx = event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0;
        const dy = event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0;
        if (event.shiftKey) model.resize(record.id, 'se', dx, dy); else model.move(record.id, dx, dy);
        sync();
      }, false, record.cleanup);
    }
    if (taskButton) listen(taskButton, 'click', () => record.active ? minimize(record.id) : activate(record.id, { focus: true }), false, record.cleanup);
    if (minimizeButton) listen(minimizeButton, 'click', () => minimize(record.id), false, record.cleanup);
    if (maximizeButton) listen(maximizeButton, 'click', () => toggleMaximize(record.id), false, record.cleanup);
    if (closeButton) listen(closeButton, 'click', () => { close(record.id).catch(error => browser.reportError?.(error)); }, false, record.cleanup);
    for (const edge of edges) {
      const handle = document.createElement('div');
      handle.className = 'window-resize-handle';
      handle.dataset.edge = edge;
      handle.setAttribute('aria-hidden', 'true');
      element.append(handle);
      listen(handle, 'pointerdown', event => startGesture(event, record, edge), false, record.cleanup);
    }
    sync();
    return record;
  }
  function layout() {
    stopGesture();
    if (!isCompact()) model.setViewport(measure());
    sync();
    model.get(model.activeId)?.taskButton?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  listen(document, 'pointermove', moveGesture);
  listen(document, 'pointerup', stopGesture);
  listen(document, 'pointercancel', stopGesture);
  listen(document, 'lostpointercapture', stopGesture);
  listen(browser, 'blur', () => stopGesture());
  listen(browser, 'resize', layout);
  const observer = browser.ResizeObserver ? new browser.ResizeObserver(layout) : null;
  observer?.observe(workspace);
  return {
    register, activate, minimize, close, toggleMaximize, snap, maximize, restore, layout,
    snapshot: () => model.snapshot(),
    restoreLayout(snapshot) { stopGesture(); model.restoreLayout(snapshot, { deferClamp: isCompact() }); sync(); },
    get: id => model.get(id), list: () => model.list(), isCompact,
    cycle(direction = 1) { const record = model.cycle(direction); sync(); record?.titlebar?.focus({ preventScroll: true }); return record; },
    setMode(value) { mode = value; layout(); },
    updateTitle(id, title) { const record = model.get(id); if (record) { record.title = title; sync(); } },
    destroy() { stopGesture(); destroyed = true; observer?.disconnect(); globalCleanup.forEach(cleanup => cleanup()); for (const record of model.list()) record.cleanup.forEach(cleanup => cleanup()); },
  };
}
