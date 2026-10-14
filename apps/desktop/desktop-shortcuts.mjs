// Desktop shortcuts occupy complete visible cells. The full launcher remains
// in Start and Applications when a small display cannot fit every shortcut.
export function shortcutGrid({ width, height, cellWidth, cellHeight, columnGap = 0, rowGap = 0, columns = 0 }) {
  const finite = value => Number.isFinite(value) && value >= 0;
  if (![width, height, cellWidth, cellHeight, columnGap, rowGap, columns].every(finite) || cellWidth < 1 || cellHeight < 1) return { rows: 0, columns: 0, capacity: 0 };
  const fittingColumns = Math.floor((width + columnGap) / (cellWidth + columnGap));
  const fittingRows = Math.floor((height + rowGap) / (cellHeight + rowGap));
  const count = columns > 0 ? Math.min(Math.floor(columns), fittingColumns) : fittingColumns;
  return { rows: fittingRows, columns: count, capacity: fittingRows * count };
}

export function visibleShortcuts(keys, capacity) {
  const limit = Math.min(keys.length, Math.max(0, Math.floor(capacity) || 0));
  const visible = new Set(keys.slice(0, limit));
  if (limit && keys.includes('nav-apps') && !visible.has('nav-apps')) {
    visible.delete(keys[limit - 1]);
    visible.add('nav-apps');
  }
  return visible;
}

export function createShortcutLayout({ container, fallback }) {
  const browser = container.ownerDocument.defaultView;
  let pending = false;
  function layout() {
    pending = false;
    const style = browser.getComputedStyle(container);
    const value = property => Number.parseFloat(style.getPropertyValue(property)) || 0;
    const grid = shortcutGrid({
      width: Math.max(0, container.clientWidth - value('padding-left') - value('padding-right')),
      height: Math.max(0, container.clientHeight - value('padding-top') - value('padding-bottom')),
      cellWidth: value('--shortcut-width'), cellHeight: value('--shortcut-height'),
      columnGap: value('column-gap'), rowGap: value('row-gap'), columns: value('--shortcut-column-limit'),
    });
    container.style.setProperty('--shortcut-rows', String(Math.max(1, grid.rows)));
    container.style.setProperty('--shortcut-columns', String(Math.max(1, grid.columns)));
    const buttons = [...container.querySelectorAll('.app-icon')];
    const visible = visibleShortcuts(buttons.map(button => button.dataset.focus), grid.capacity);
    const active = container.ownerDocument.activeElement;
    const apps = buttons.find(button => button.dataset.focus === 'nav-apps');
    for (const button of buttons) button.hidden = !visible.has(button.dataset.focus);
    const hiddenCount = buttons.length - visible.size;
    if (apps) {
      apps.title = hiddenCount ? `Applications — more shortcuts are available in Start (${hiddenCount} not shown on the desktop).` : 'Applications';
    }
    if (buttons.includes(active) && active.hidden) (apps && !apps.hidden ? apps : fallback)?.focus({ preventScroll: true });
  }
  function schedule() {
    if (pending) return;
    pending = true;
    browser.requestAnimationFrame(layout);
  }
  const observer = new browser.ResizeObserver(schedule);
  observer.observe(container);
  browser.addEventListener('resize', schedule);
  return { layout, schedule, destroy() { observer.disconnect(); browser.removeEventListener('resize', schedule); } };
}
