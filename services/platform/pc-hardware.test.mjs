import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessHardware, collectHardware, VISIBLE_MEMORY_BASELINE } from '../../os/linux-pc/hardware.mjs';
import { parseOptions } from '../../os/linux-pc/install.mjs';

const facts = { platform: 'linux', arch: 'x64', memoryBytes: 4 * 1024 ** 3, manufacturer: 'Apple Inc.', model: 'MacBookPro9,2', osRelease: 'ID=debian\nVERSION_ID="13"\nVERSION_CODENAME=trixie\n', desktopType: 'wayland', hasWaylandDisplay: true };

test('provisional PC hardware screen never certifies a model or treats a year as compatibility', () => {
  const report = assessHardware(facts);
  assert.equal(report.conclusion, 'hardware-trial-required');
  assert.equal(report.hardwareAccepted, false);
  assert.equal(report.machine.model, 'MacBookPro9,2');
  assert.equal(report.machine.visibleMemoryGiB, 4);
  assert.equal(report.checks.find(check => check.id === 'desktop').status, 'detected');
  assert.ok(report.manualChecks.some(check => /T2/.test(check)));
  assert.ok(report.manualChecks.some(check => /does not inspect, select, mount, repartition or write/.test(check)));
  for (const model of ['Unknown PC', 'MacBookPro16,1', 'MacBookAir', 'PC from 2020']) assert.equal(assessHardware({ ...facts, model }).hardwareAccepted, false);
});

test('hardware screen identifies other architectures and unsupported setup OS without mutating them', () => {
  for (const change of [{ arch: 'arm64' }, { arch: 'ia32' }, { platform: 'darwin' }, { platform: 'win32' }, { osRelease: facts.osRelease.replace('13', '12') }, { osRelease: facts.osRelease.replace('debian', 'ubuntu') }]) {
    const report = assessHardware({ ...facts, ...change });
    assert.equal(report.conclusion, 'setup-unavailable'); assert.equal(report.hardwareAccepted, false);
  }
  for (const change of [{ memoryBytes: null }, { memoryBytes: -1 }, { memoryBytes: NaN }, { memoryBytes: Infinity }, { memoryBytes: 2 * 1024 ** 3 }]) assert.equal(assessHardware({ ...facts, ...change }).conclusion, 'review-required');
  assert.equal(assessHardware({ ...facts, memoryBytes: VISIBLE_MEMORY_BASELINE }).conclusion, 'hardware-trial-required');
  assert.equal(assessHardware({ ...facts, desktopType: 'x11' }).checks.find(check => check.id === 'desktop').status, 'unverified');
});

test('hardware collector reads only allowed non-identity facts and strips control characters', async () => {
  const seen = [];
  const answers = { '/etc/os-release': facts.osRelease, '/sys/class/dmi/id/sys_vendor': 'Apple\u001b\n', '/sys/class/dmi/id/product_name': 'MacBookPro9,2\u0000\n' };
  const report = await collectHardware({ ...facts, env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'do-not-copy-this', HOME: '/private-home', USER: 'private-user' }, readText: async path => { seen.push(path); return answers[path]; } });
  assert.deepEqual(seen, Object.keys(answers));
  assert.equal(report.machine.manufacturer, 'Apple');
  assert.equal(report.machine.model, 'MacBookPro9,2');
  for (const value of ['do-not-copy-this', '/private-home', 'private-user', 'serial', 'uuid']) assert.equal(JSON.stringify(report).toLowerCase().includes(value), false);
});

test('unavailable hardware metadata remains unknown and non-Linux hosts trigger no Linux reads', async () => {
  const report = await collectHardware({ ...facts, env: {}, readText: async () => { throw new Error('permission denied'); } });
  assert.equal(report.machine.model, null); assert.equal(report.conclusion, 'setup-unavailable');
  let read = false;
  const other = await collectHardware({ ...facts, platform: 'darwin', env: {}, readText: async () => { read = true; } });
  assert.equal(read, false); assert.equal(other.conclusion, 'setup-unavailable');
});

test('PC hardware report is a standalone no-sudo CLI and accepts no path or drive argument', () => {
  assert.deepEqual(parseOptions(['--check-hardware']), { hardware: true });
  assert.throws(() => parseOptions(['--check-hardware', '/dev/disk0']));
  const path = fileURLToPath(new URL('../../os/linux-pc/install.mjs', import.meta.url));
  const report = JSON.parse(execFileSync(process.execPath, [path, '--check-hardware'], { encoding: 'utf8' }));
  assert.equal(report.hardwareAccepted, false); assert.equal(report.format, 1);
  assert.equal(report.checks.length, 4);
});
