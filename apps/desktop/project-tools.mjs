// Pure source-text operations. These never execute a project or access host paths.
const encoder = new TextEncoder();
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export const RECYCLE_PREFIX = 'recycle-bin/';
export function validateSourcePath(path) {
  if (typeof path !== 'string' || path.length > 180 || path.split('/').length > 8 || !path.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) throw new Error('Use a relative file name with letters, numbers, dots, dashes and underscores. Up to 180 characters and 8 path parts.');
  return path;
}
export function validateSourceFiles(files) {
  if (!isRecord(files) || Object.keys(files).length < 1 || Object.keys(files).length > 32) throw new Error('A project can hold 1–32 text files, including its file bin.');
  let bytes = 0;
  for (const [path, text] of Object.entries(files)) {
    validateSourcePath(path);
    if (typeof text !== 'string' || text.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw new Error('Files must contain valid text without null characters.');
    bytes += encoder.encode(path).length + encoder.encode(text).length;
  }
  if (bytes > 1024 * 1024) throw new Error('A project can hold up to 1 MiB of text, including its file bin.');
  if (!Object.hasOwn(files, 'index.html')) throw new Error('Keep index.html: it is the page this app opens.');
  return files;
}
export function projectChanged(editor) {
  return Boolean(editor && (editor.name !== editor.saved.name || Object.keys(editor.files).length !== Object.keys(editor.saved.files).length || Object.keys(editor.files).some(path => editor.files[path] !== editor.saved.files[path])));
}
export function changeSourceFile(files, action, path, target) {
  validateSourceFiles(files);
  const result = { ...files };
  const recycled = path?.startsWith(RECYCLE_PREFIX);
  if (action !== 'new' && !Object.hasOwn(files, path)) throw new Error('That file is no longer in this project.');
  if (action === 'new') {
    validateSourcePath(target);
    if (target === 'recycle-bin' || target.startsWith(RECYCLE_PREFIX)) throw new Error('The recycle-bin folder is reserved for removed files.');
    if (Object.hasOwn(result, target)) throw new Error('That file already exists. Choose another name.');
    result[target] = '';
  } else {
    if (path === 'index.html') throw new Error('Keep index.html: it is the page this app opens.');
    if (action === 'remove') {
      if (recycled) throw new Error('This file is already in the file bin.');
      target = RECYCLE_PREFIX + path;
    } else if (action === 'restore') {
      if (!recycled) throw new Error('This file is not in the file bin.');
      target = path.slice(RECYCLE_PREFIX.length);
    } else if (action === 'rename') {
      if (recycled) throw new Error('Restore a file before renaming it.');
      if (target === 'recycle-bin' || target?.startsWith(RECYCLE_PREFIX)) throw new Error('Use Move to file bin to remove a file.');
    } else throw new Error('Unknown file operation.');
    validateSourcePath(target);
    if (Object.hasOwn(result, target)) throw new Error('A file already uses that name. Rename or restore it first; nothing was overwritten.');
    result[target] = result[path]; delete result[path];
  }
  validateSourceFiles(result);
  return { files: result, file: target };
}
function keys(value, expected) {
  return isRecord(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));
}
export function parseProjectImport(text) {
  if (typeof text !== 'string' || encoder.encode(text).length > 2 * 1024 * 1024) throw new Error('Choose a kidOS project or draft JSON file smaller than 2 MiB.');
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose an exported kidOS project or recovery draft.'); }
  let project;
  if (keys(envelope, ['schemaVersion', 'project']) && envelope.schemaVersion === 1 && keys(envelope.project, ['id', 'name', 'revision', 'createdAt', 'updatedAt', 'files'])) project = envelope.project;
  else if (keys(envelope, ['format', 'version', 'projectId', 'baseRevision', 'name', 'files']) && envelope.format === 'kidos-recovery-draft' && envelope.version === 1) project = envelope;
  else throw new Error('Choose a kidOS project export or recovery draft, version 1.');
  if (typeof project.name !== 'string' || project.name !== project.name.trim() || project.name.length < 1 || project.name.length > 60 || /[\x00-\x1f\x7f]/.test(project.name)) throw new Error('The imported project needs a valid name of 1–60 characters.');
  validateSourceFiles(project.files);
  return { envelope, name: project.name, fileCount: Object.keys(project.files).length };
}
export function filterAndSort(items, query, order = 'name', nameOf = item => item.name, dateOf = item => item.updatedAt) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  return items.filter(item => nameOf(item).toLocaleLowerCase().includes(needle)).slice().sort((a, b) => (order === 'recent' ? String(dateOf(b) || '').localeCompare(String(dateOf(a) || '')) : 0) || nameOf(a).localeCompare(nameOf(b)));
}
