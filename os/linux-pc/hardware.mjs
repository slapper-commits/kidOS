import { open } from 'node:fs/promises';
import { totalmem } from 'node:os';

const GiB = 1024 ** 3;
// Visible RAM is lower than the marketed capacity because of hardware reserves.
// This is a provisional 4 GB-machine screen, not a measured performance minimum.
export const VISIBLE_MEMORY_BASELINE = 3.5 * GiB;
const cleanLabel = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 100) || null : null;

async function boundedText(path) {
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(4096);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead === bytes.length) throw new Error('Hardware fact exceeds its read bound.');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally { await file.close(); }
}

export function assessHardware(facts) {
  const linux = facts.platform === 'linux', x64 = facts.arch === 'x64';
  const debian = linux && /^ID=["']?debian["']?$/m.test(facts.osRelease || '') && /^VERSION_ID=["']?13["']?$/m.test(facts.osRelease || '') && /^VERSION_CODENAME=["']?trixie["']?$/m.test(facts.osRelease || '');
  const memory = Number.isSafeInteger(facts.memoryBytes) && facts.memoryBytes > 0 ? facts.memoryBytes : null;
  const checks = [
    { id: 'architecture', status: x64 ? 'pass' : 'blocked', message: x64 ? '64-bit Intel/AMD architecture detected.' : 'This dedicated-computer pilot requires 64-bit Intel/AMD hardware; ARM and 32-bit PCs use separate tracks.' },
    { id: 'memory', status: memory === null ? 'unknown' : memory >= VISIBLE_MEMORY_BASELINE ? 'pass' : 'below-target', message: 'Target a machine with at least 4 GB installed RAM; 8 GB is preferred. This provisional screen allows for reserved RAM.' },
    { id: 'linux', status: debian ? 'pass' : 'blocked', message: debian ? 'Debian 13 Trixie detected.' : 'Boot the Debian 13 amd64 live desktop to check Linux hardware behavior; the current PC setup does not install onto macOS or Windows.' },
    { id: 'desktop', status: linux && facts.desktopType === 'wayland' && facts.hasWaylandDisplay === true ? 'detected' : 'unverified', message: 'The native PC bridge needs a real Wayland desktop. A session hint does not verify its sockets, graphics or input.' },
  ];
  return {
    format: 1,
    // This result intentionally never certifies a model or enables disk writes.
    conclusion: checks.some(check => check.status === 'blocked') ? 'setup-unavailable' : checks.some(check => ['below-target', 'unknown'].includes(check.status)) ? 'review-required' : 'hardware-trial-required',
    hardwareAccepted: false,
    machine: { platform: cleanLabel(facts.platform), architecture: cleanLabel(facts.arch), visibleMemoryGiB: memory === null ? null : Math.round(memory / GiB * 10) / 10, manufacturer: cleanLabel(facts.manufacturer), model: cleanLabel(facts.model) },
    checks,
    manualChecks: [
      'On an Intel Mac, verify that it has no Apple T2 chip; newer MacBooks can use Apple Silicon or T2 and are outside this first pilot.',
      'Try display/brightness, keyboard, trackpad/mouse, Wi-Fi, sound/headphones and lid/suspend/resume in the live desktop.',
      'Check USB copy/eject, offline restart and saving/reopening creations on the actual device.',
      'Choose and back up the installation drive separately. This report does not inspect, select, mount, repartition or write a drive; 64 GB storage is the provisional target.',
    ],
  };
}

export async function collectHardware({ platform = process.platform, arch = process.arch, memoryBytes = totalmem(), env = process.env, readText = boundedText } = {}) {
  const facts = { platform, arch, memoryBytes, desktopType: env.XDG_SESSION_TYPE, hasWaylandDisplay: Boolean(env.WAYLAND_DISPLAY) };
  if (platform === 'linux') {
    // Explicit small allowlist: no serials, UUIDs, MACs, hostname, user, home,
    // network scans or disk enumeration. Missing/unreadable facts stay unknown.
    for (const [key, path] of [['osRelease', '/etc/os-release'], ['manufacturer', '/sys/class/dmi/id/sys_vendor'], ['model', '/sys/class/dmi/id/product_name']]) {
      try { facts[key] = await readText(path); }
      catch { facts[key] = null; }
    }
  }
  return assessHardware(facts);
}
