import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutGrid, visibleShortcuts } from '../../apps/desktop/desktop-shortcuts.mjs';

const cells = { cellWidth: 104, cellHeight: 104, columnGap: 12, rowGap: 10 };
const keys = ['nav-stuff', 'nav-apps', ...Array.from({ length: 23 }, (_, index) => `app-${index}`)];

test('25 shortcuts fit a normal desktop and only complete cells fit a short desktop', () => {
  const normal = shortcutGrid({ ...cells, width: 1240, height: 690 });
  assert.equal(visibleShortcuts(keys, normal.capacity).size, 25);
  const short = shortcutGrid({ ...cells, width: 580, height: 220 });
  assert.deepEqual(short, { rows: 2, columns: 5, capacity: 10 });
  assert.equal(visibleShortcuts(keys, short.capacity).size, 10);
  assert.ok(short.columns * cells.cellWidth + (short.columns - 1) * cells.columnGap <= 580);
  assert.ok(short.rows * cells.cellHeight + (short.rows - 1) * cells.rowGap <= 220);
});

test('Applications remains reachable whenever a complete tile fits, including TV order', () => {
  assert.deepEqual([...visibleShortcuts(keys, 1)], ['nav-apps']);
  assert.deepEqual([...visibleShortcuts(['nav-library', 'nav-play', 'nav-explore', 'nav-stuff', 'nav-apps'], 2)], ['nav-library', 'nav-apps']);
  assert.deepEqual([...visibleShortcuts(keys, 0)], []);
});

test('tablet column limits and tiny or invalid viewports never invent partial cells', () => {
  assert.deepEqual(shortcutGrid({ width: 970, height: 475, cellWidth: 104, cellHeight: 150, columnGap: 20, rowGap: 20, columns: 3 }), { rows: 2, columns: 3, capacity: 6 });
  for (const size of [{ width: 10, height: 10 }, { width: 800, height: 103 }, { width: NaN, height: 600 }]) assert.equal(shortcutGrid({ ...cells, ...size }).capacity, 0);
  assert.deepEqual([...visibleShortcuts(keys, Infinity)], keys);
});
