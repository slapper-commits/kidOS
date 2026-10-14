// Version-one contract. Runtime validation is intentionally dependency-free.
export const MAX_PROJECT_BYTES = 1024 * 1024;
export const MAX_FILES = 32;
export const PROJECT_ID = /^project-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const APP_VERSION = /^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/;
export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'StoreError'; this.status = status; }
}
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export function exactKeys(value, expected, label) {
  if (!isRecord(value) || Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) {
    throw new StoreError(`${label} has an unsupported or missing field.`);
  }
}
export function validateName(name) {
  if (typeof name !== 'string' || name !== name.trim() || name.length < 1 || name.length > 60 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new StoreError('Use a project name of 1–60 characters without control characters.');
  }
  return name;
}
export function validateFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.length > 180 || filePath.split('/').length > 8 ||
      !filePath.split('/').every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))) {
    throw new StoreError('Use a relative file path with letters, numbers, dots, dashes and underscores; no dot segments or encoded paths.');
  }
  return filePath;
}
export function validateFiles(files) {
  if (!isRecord(files) || Object.keys(files).length < 1 || Object.keys(files).length > MAX_FILES) {
    throw new StoreError(`A project must contain 1–${MAX_FILES} text files.`);
  }
  let bytes = 0;
  for (const [filePath, content] of Object.entries(files)) {
    validateFilePath(filePath);
    if (typeof content !== 'string' || content.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(content)) {
      throw new StoreError('Project files must contain valid UTF-8 text without null characters.');
    }
    bytes += Buffer.byteLength(filePath, 'utf8') + Buffer.byteLength(content, 'utf8');
  }
  if (bytes > MAX_PROJECT_BYTES) throw new StoreError('A project can contain at most 1 MiB of text.');
  if (!Object.hasOwn(files, 'index.html')) throw new StoreError('A web project must include index.html.');
  return files;
}
export function validateManifest(manifest, files) {
  exactKeys(manifest, ['schemaVersion', 'id', 'name', 'version', 'entryPoint', 'runtime', 'permissions'], 'App manifest');
  if (manifest.schemaVersion !== 1) throw new StoreError('Unsupported app manifest schema version.');
  if (typeof manifest.id !== 'string' || !PROJECT_ID.test(manifest.id)) throw new StoreError('Invalid app ID.');
  validateName(manifest.name);
  if (typeof manifest.version !== 'string' || !APP_VERSION.test(manifest.version)) throw new StoreError('Use a version such as 1.0.0 (three nonnegative integers, without leading zeroes).');
  validateFilePath(manifest.entryPoint);
  if (manifest.entryPoint !== 'index.html' || manifest.runtime !== 'web') throw new StoreError('Version 1 supports web apps with index.html as their entry point.');
  if (!Array.isArray(manifest.permissions) || manifest.permissions.length !== 0) throw new StoreError('Version 1 supports no granted permissions: permissions must be an empty array.');
  if (files && !Object.hasOwn(files, manifest.entryPoint)) throw new StoreError('The app entry point is missing.');
  return manifest;
}
