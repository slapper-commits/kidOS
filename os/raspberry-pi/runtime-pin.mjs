// Official Node.js release and its published SHA256, reviewed 2026-10-08.
// Updating this pin also requires the service path, setup instructions and tests.
export const PILOT_NODE = Object.freeze({
  version: 'v24.21.0',
  directory: '/opt/kidos-node/v24.21.0',
  executable: '/opt/kidos-node/v24.21.0/bin/node',
  archive: 'node-v24.21.0-linux-arm64.tar.xz',
  archiveSha256: '6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2',
  archiveUrl: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-arm64.tar.xz',
  checksumSource: 'https://nodejs.org/en/blog/release/v24.21.0#shasums',
});

// Same release, independently pinned official glibc x64 archive. Reviewed
// against https://nodejs.org/en/blog/release/v24.21.0#shasums on 2026-10-14.
export const PC_NODE = Object.freeze({
  ...PILOT_NODE,
  archive: 'node-v24.21.0-linux-x64.tar.xz',
  archiveSha256: 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6',
  archiveUrl: 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz',
});
export function runtimeFor(arch) {
  if (arch === 'arm64') return PILOT_NODE;
  if (arch === 'x64') return PC_NODE;
  throw new Error('Only Linux ARM64 and x64 runtimes are supported.');
}
