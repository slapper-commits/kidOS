import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, unlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { starterFiles } from './starter.mjs';
import { emptyProgress, validateGameId, validateResult, validateProgressMap } from './game-progress.mjs';
import { MAX_MEDIA_ITEMS, editMediaDetails, prepareMedia, validateMediaId, validateMediaMap, validateMediaProgress, readMediaBlob, writeMediaBlob } from './media.mjs';
import { emptyMail, validateMail, addMailPerson, saveMailDraft, sendMailDraft, changeMailMessage } from './mail.mjs';
import { emptyWorkspace, validateWorkspace } from './workspace.mjs';
import { APP_VERSION, PROJECT_ID, MAX_PROJECT_BYTES, StoreError, exactKeys, isRecord, validateFiles, validateManifest, validateName, validateFilePath } from '../../packages/app-contract/manifest.mjs';
export { StoreError, MAX_PROJECT_BYTES, validateManifest, validateFilePath };

const MAX_STATE_BYTES = 64 * 1024 * 1024;
const MAX_PROJECTS = 128;
const MAX_VERSIONS = 32;
const clone = value => structuredClone(value);
const emptyState = () => ({ schemaVersion: 6, projects: {}, apps: {}, games: {}, trash: {}, media: {}, workspace: emptyWorkspace(), mail: emptyMail() });
const isoDate = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const revision = value => Number.isSafeInteger(value) && value >= 1;
const canonical = value => JSON.stringify(value, function (_key, item) {
  return isRecord(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const digest = (manifest, files) => createHash('sha256').update(canonical({ manifest, files })).digest('hex');
function validateProject(project, id) {
  exactKeys(project, ['id', 'name', 'revision', 'createdAt', 'updatedAt', 'files'], 'Project');
  if (!PROJECT_ID.test(id) || project.id !== id) throw new StoreError('Invalid stored project ID.');
  validateName(project.name); validateFiles(project.files);
  if (!revision(project.revision) || !isoDate(project.createdAt) || !isoDate(project.updatedAt) || project.updatedAt < project.createdAt) throw new StoreError('Invalid stored project revision or date.');
}
function validateState(state) {
  if (![1, 2, 3, 4, 5, 6].includes(state.schemaVersion)) throw new StoreError(`Unsupported data schema version ${String(state.schemaVersion)}. No migration is available; preserve this directory and use compatible software.`);
  exactKeys(state, ['schemaVersion', 'projects', 'apps', ...(state.schemaVersion >= 2 ? ['games'] : []), ...(state.schemaVersion >= 3 ? ['trash'] : []), ...(state.schemaVersion >= 4 ? ['media'] : []), ...(state.schemaVersion >= 5 ? ['workspace'] : []), ...(state.schemaVersion >= 6 ? ['mail'] : [])], 'Stored state');
  if (!isRecord(state.projects) || !isRecord(state.apps) || Object.keys(state.projects).length > MAX_PROJECTS) throw new StoreError('Invalid project registry.');
  for (const [id, project] of Object.entries(state.projects)) validateProject(project, id);
  for (const [id, app] of Object.entries(state.apps)) {
    if (!Object.hasOwn(state.projects, id)) throw new StoreError('An installed app has no source project.');
    exactKeys(app, ['currentVersion', 'versions'], 'App registry entry');
    if (typeof app.currentVersion !== 'string' || !APP_VERSION.test(app.currentVersion) || !isRecord(app.versions) || Object.keys(app.versions).length < 1 || Object.keys(app.versions).length > MAX_VERSIONS || !Object.hasOwn(app.versions, app.currentVersion)) throw new StoreError('Invalid installed app versions.');
    for (const [version, installed] of Object.entries(app.versions)) {
      exactKeys(installed, ['manifest', 'files', 'installedAt', 'digest', 'sourceRevision', 'projectId'], 'Installed app');
      validateFiles(installed.files); validateManifest(installed.manifest, installed.files);
      if (installed.projectId !== id || installed.manifest.id !== id || installed.manifest.version !== version || !isoDate(installed.installedAt) ||
          !revision(installed.sourceRevision) || installed.sourceRevision > state.projects[id].revision || installed.digest !== digest(installed.manifest, installed.files)) {
        throw new StoreError('Installed app integrity check failed.');
      }
    }
  }
  if (state.schemaVersion >= 2) validateProgressMap(state.games);
  if (state.schemaVersion >= 3) {
    if (!isRecord(state.trash)) throw new StoreError('Invalid project trash.');
    for (const [id, entry] of Object.entries(state.trash)) {
      exactKeys(entry, ['trashedAt'], 'Trash entry');
      if (!Object.hasOwn(state.projects, id) || !isoDate(entry.trashedAt) || entry.trashedAt < state.projects[id].createdAt || entry.trashedAt !== state.projects[id].updatedAt) throw new StoreError('Invalid trashed project or date.');
    }
  }
  if (state.schemaVersion >= 4) validateMediaMap(state.media);
  if (state.schemaVersion >= 5) validateWorkspace(state.workspace);
  if (state.schemaVersion >= 6) validateMail(state.mail);
  return state;
}
// Version 6 adds local family mail and richer app views without changing creations.
const upgrade = state => {
  validateState(state);
  const workspace = state.workspace ?? emptyWorkspace();
  workspace.windows = workspace.windows.map(window => window.kind === 'tool' && window.route === 'explore' && Object.keys(window.state).length === 0 ? { ...window, state: { siteId: null } } : window);
  return validateState({ ...state, schemaVersion: 6, games: state.games ?? {}, trash: state.trash ?? {}, media: state.media ?? {}, workspace, mail: emptyMail() });
};
const migrations = new Map([[1, upgrade], [2, upgrade], [3, upgrade], [4, upgrade], [5, upgrade], [6, validateState]]);
function decodeState(text) {
  const state = JSON.parse(text);
  if (!isRecord(state) || !Number.isSafeInteger(state.schemaVersion)) throw new StoreError('The stored state has no valid schema version.');
  const migration = migrations.get(state.schemaVersion);
  if (!migration) throw new StoreError(`Unsupported data schema version ${String(state?.schemaVersion)}. No migration is available; preserve this directory and use compatible software.`);
  return migration(state);
}
function checkedUpgradeText(state) {
  const text = JSON.stringify(state);
  if (Buffer.byteLength(text) > MAX_STATE_BYTES) {
    throw new StoreError('Upgrading this saved state would exceed the 64 MiB store limit. No saved files were changed. Preserve this data directory and use software compatible with its existing schema to reduce saved content before retrying the upgrade.', 503);
  }
  return text;
}
async function safeRead(filePath, maxBytes = MAX_STATE_BYTES) {
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new StoreError(`Unsafe or oversized data file: ${path.basename(filePath)}.`, 503);
    return await file.readFile('utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') throw new StoreError(`Refusing a symbolic link at ${path.basename(filePath)}.`, 503);
    throw error;
  } finally { await file?.close(); }
}
async function checkTarget(filePath) {
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new StoreError(`Refusing unsafe data file: ${path.basename(filePath)}.`, 503);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function syncDirectory(directory) {
  const dir = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await dir.sync(); }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EBADF'].includes(error.code)) throw error; }
  finally { await dir.close(); }
}
async function atomicWrite(directory, name, text) {
  const target = path.join(directory, name);
  await checkTarget(target);
  const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(text, 'utf8');
    await file.sync();
    await file.close(); file = null;
    await checkTarget(target);
    await rename(temporary, target);
    await syncDirectory(directory);
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}
function decodeLock(text) {
  try {
    const lock = JSON.parse(text);
    if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0 || typeof lock.token !== 'string') throw new Error('invalid');
    return lock;
  } catch { throw new StoreError('The data directory has an unreadable store.lock. Preserve its files and inspect the lock before retrying.', 503); }
}
async function acquireLock(directory) {
  const lockPath = path.join(directory, 'store.lock');
  const token = randomUUID();
  const record = JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() });
  const create = async () => {
    const file = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(record); await file.sync(); } finally { await file.close(); }
    return token;
  };
  try { return await create(); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const previousText = await safeRead(lockPath, 4096);
  if (previousText === null) {
    try { return await create(); } catch { throw new StoreError('Another process is opening this data directory. Retry shortly.', 503); }
  }
  const previous = decodeLock(previousText);
  if (processIsAlive(previous.pid)) throw new StoreError('This data directory is already open by another kidOS service. Stop it before starting a second service.', 503);
  // A second exclusive file serializes stale-lock recovery between new services.
  const recoveryPath = path.join(directory, 'store.lock.recovery');
  let recovery;
  try { recovery = await open(recoveryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new StoreError('Store lock recovery is in progress or was interrupted. Preserve the data and inspect store.lock.recovery.', 503); throw error; }
  try {
    if (await safeRead(lockPath, 4096) !== previousText || processIsAlive(previous.pid)) throw new StoreError('The store lock changed while opening. Retry shortly.', 503);
    await unlink(lockPath);
    try { return await create(); } catch (error) { if (error.code === 'EEXIST') throw new StoreError('Another service opened this data directory.', 503); throw error; }
  } finally { await recovery.close(); await unlink(recoveryPath); }
}

export class Store {
  #directory; #state; #token; #queue = Promise.resolve(); #closed = false; #closing = false; #closePromise; #fault = false;
  recoveryNotice = null;
  constructor(directory, token) { this.#directory = directory; this.#token = token; }
  static async open(dataDir) {
    if (typeof dataDir !== 'string' || !dataDir) throw new StoreError('A data directory is required.');
    const requested = path.resolve(dataDir);
    try {
      const stat = await lstat(requested);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new StoreError('The kidOS data root must be a real directory, not a symbolic link.', 503);
    } catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(requested, { recursive: true, mode: 0o700 }); }
    const stat = await lstat(requested);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new StoreError('The kidOS data root must be a real directory.', 503);
    const directory = await realpath(requested);
    const store = new Store(directory, await acquireLock(directory));
    try { await store.#load(); return store; }
    catch (error) { await store.close(); throw error; }
  }
  async #load() {
    const primary = await safeRead(path.join(this.#directory, 'state.json'));
    const backup = await safeRead(path.join(this.#directory, 'state.backup.json'));
    if (primary === null && backup === null) {
      this.#state = emptyState();
      await atomicWrite(this.#directory, 'state.json', JSON.stringify(this.#state));
      return;
    }
    let primaryError;
    if (primary !== null) {
      let loaded;
      try { loaded = decodeState(primary); }
      catch (error) {
        // Unknown schemas must never be silently rolled back into an older format.
        if (error.message.startsWith('Unsupported data schema version')) throw new StoreError(error.message, 503);
        primaryError = error;
      }
      if (loaded) {
        if (JSON.parse(primary).schemaVersion < 6) {
          // A valid old state near the size limit may not fit the new schema.
          // Fail before changing any files, without treating it as corruption.
          const upgradedText = checkedUpgradeText(loaded);
          // Retain the exact pre-upgrade file before changing the on-disk schema.
          await atomicWrite(this.#directory, `state.pre-v6.${randomUUID()}.json`, primary);
          await atomicWrite(this.#directory, 'state.backup.json', primary);
          await atomicWrite(this.#directory, 'state.json', upgradedText);
        }
        this.#state = loaded;
        return;
      }
    }
    let recovered;
    try { if (backup !== null) recovered = decodeState(backup); }
    catch { /* Report a single actionable failure below and leave both files untouched. */ }
    if (!recovered) throw new StoreError(`The kidOS data file${primaryError ? ` (${primaryError.message})` : ''} and its backup could not be loaded. Both have been preserved; restore a known-good backup before continuing.`, 503);
    const recoveredText = checkedUpgradeText(recovered);
    if (JSON.parse(backup).schemaVersion < 6) await atomicWrite(this.#directory, `state.pre-v6.${randomUUID()}.json`, backup);
    if (primary !== null) await rename(path.join(this.#directory, 'state.json'), path.join(this.#directory, `state.corrupt.${Date.now()}.${randomUUID()}.json`));
    await atomicWrite(this.#directory, 'state.json', recoveredText);
    this.#state = recovered;
    this.recoveryNotice = 'Recovered the previous saved state from state.backup.json. The newest change may need to be repeated. Any damaged primary file was preserved in the data directory.';
  }
  #assertOpen(allowClosing = false) {
    if (this.#closed || (this.#closing && !allowClosing)) throw new StoreError('The project store is closed.', 503);
    if (this.#fault) throw new StoreError('A disk write failed. Restart kidOS to verify and recover its saved state before continuing.', 503);
  }
  #project(id, includeTrashed = false) {
    if (typeof id !== 'string' || !PROJECT_ID.test(id)) throw new StoreError('Invalid project ID.');
    if (!Object.hasOwn(this.#state.projects, id)) throw new StoreError('Project not found.', 404);
    if (!includeTrashed && Object.hasOwn(this.#state.trash, id)) throw new StoreError('This project is in Trash. Restore it in My Stuff before opening or changing it.', 409);
    return this.#state.projects[id];
  }
  async #mutate(change, beforeCommit) {
    this.#assertOpen();
    const result = this.#queue.then(async () => {
      this.#assertOpen(true);
      const next = clone(this.#state);
      const output = change(next);
      validateState(next);
      const text = JSON.stringify(next);
      if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw new StoreError('The Day 0 data store is full (64 MiB). Export projects before adding more.', 409);
      // Validate catalog capacity before writing a blob; persist bytes before its
      // catalog entry so an interrupted commit cannot advertise absent content.
      if (beforeCommit) await beforeCommit(next, output);
      try {
        await atomicWrite(this.#directory, 'state.backup.json', JSON.stringify(this.#state));
        await atomicWrite(this.#directory, 'state.json', text);
      } catch (error) {
        this.#fault = true;
        throw new StoreError(`Could not finish saving to disk. Existing data was preserved; restart kidOS before retrying. ${error.code ?? error.message}`, 503);
      }
      this.#state = next;
      return clone(output);
    });
    this.#queue = result.catch(() => {});
    return result;
  }
  listProjects() {
    this.#assertOpen();
    return Object.values(this.#state.projects).filter(project => !Object.hasOwn(this.#state.trash, project.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ files, ...summary }) => ({ ...summary, fileCount: Object.keys(files).length }));
  }
  listTrash() {
    this.#assertOpen();
    return Object.entries(this.#state.trash).map(([id, { trashedAt }]) => {
      const { files, ...summary } = this.#state.projects[id];
      return { ...summary, fileCount: Object.keys(files).length, trashedAt };
    }).sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
  }
  getProject(id) { this.#assertOpen(); return clone(this.#project(id)); }
  async createProject(name = 'My color lab', files = starterFiles()) {
    validateName(name);
    validateFiles(files);
    const sourceFiles = clone(files);
    return this.#mutate(state => {
      if (Object.keys(state.projects).length >= MAX_PROJECTS) throw new StoreError('This store supports up to 128 projects, including projects in Trash.', 409);
      const now = new Date().toISOString();
      const project = { id: `project-${randomUUID()}`, name, revision: 1, createdAt: now, updatedAt: now, files: sourceFiles };
      state.projects[project.id] = project;
      return project;
    });
  }
  async importProject(input) {
    let source;
    if (input?.schemaVersion === 1) {
      exactKeys(input, ['schemaVersion', 'project'], 'Project export');
      validateProject(input.project, input.project?.id); source = input.project;
    } else if (input?.format === 'kidos-recovery-draft' && input.version === 1) {
      exactKeys(input, ['format', 'version', 'projectId', 'baseRevision', 'name', 'files'], 'Recovery draft export');
      if (typeof input.projectId !== 'string' || !PROJECT_ID.test(input.projectId) || !revision(input.baseRevision)) throw new StoreError('Invalid recovery draft identity.');
      validateName(input.name); validateFiles(input.files); source = input;
    } else throw new StoreError('Choose a kidOS project export or recovery draft.');
    return this.createProject(source.name, source.files);
  }
  async duplicateProject(id, input) {
    exactKeys(input, ['revision', 'name'], 'Duplicate project'); validateName(input.name);
    const requested = clone(input);
    return this.#mutate(state => {
      const source = this.#project(id);
      if (source.revision !== requested.revision) throw new StoreError('The source changed. Reopen it before making a copy.', 409);
      if (Object.keys(state.projects).length >= MAX_PROJECTS) throw new StoreError('The project store is full.', 409);
      const now = new Date().toISOString();
      const project = { ...clone(source), id: `project-${randomUUID()}`, name: requested.name, revision: 1, createdAt: now, updatedAt: now };
      state.projects[project.id] = project; return project;
    });
  }
  async saveProject(id, input) {
    exactKeys(input, ['name', 'files', 'revision'], 'Project save');
    validateName(input.name); validateFiles(input.files);
    if (!revision(input.revision)) throw new StoreError('A current project revision is required.');
    const requested = clone(input);
    return this.#mutate(state => {
      const current = this.#project(id);
      if (current.revision !== requested.revision) throw new StoreError('This project changed in another window. Reopen it before saving to avoid losing changes.', 409);
      const saved = { ...current, name: requested.name, files: requested.files, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      state.projects[id] = saved;
      return saved;
    });
  }
  async trashProject(id, input) {
    exactKeys(input, ['revision'], 'Move to Trash');
    if (!revision(input.revision)) throw new StoreError('A current project revision is required.');
    const requestedRevision = input.revision;
    return this.#mutate(state => {
      const current = this.#project(id);
      if (current.revision !== requestedRevision) throw new StoreError('This project changed in another window. Reopen it before moving it to Trash.', 409);
      const trashedAt = new Date().toISOString();
      const project = { ...current, revision: current.revision + 1, updatedAt: trashedAt };
      state.projects[id] = project;
      state.trash[id] = { trashedAt };
      return project;
    });
  }
  async restoreProject(id, input) {
    exactKeys(input, ['revision'], 'Restore project');
    if (!revision(input.revision)) throw new StoreError('A current project revision is required.');
    const requestedRevision = input.revision;
    return this.#mutate(state => {
      const current = this.#project(id, true);
      if (!Object.hasOwn(state.trash, id)) throw new StoreError('This project is already in Projects. Refresh My Stuff to open it.', 409);
      if (current.revision !== requestedRevision) throw new StoreError('This project changed in another window. Refresh Trash before restoring it.', 409);
      const project = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      state.projects[id] = project;
      delete state.trash[id];
      return project;
    });
  }
  async installProject(id, input) {
    exactKeys(input, ['revision', 'version'], 'App install');
    if (!revision(input.revision)) throw new StoreError('Save the project and supply its current revision before installing.');
    if (typeof input.version !== 'string' || !APP_VERSION.test(input.version)) throw new StoreError('Use a version such as 1.0.0.');
    const requested = clone(input);
    return this.#mutate(state => {
      const project = this.#project(id);
      if (project.revision !== requested.revision) throw new StoreError('The project changed before installation. Reopen it and install the saved revision.', 409);
      const app = state.apps[id] ?? { currentVersion: requested.version, versions: {} };
      if (Object.hasOwn(app.versions, requested.version)) throw new StoreError('That app version is already installed. Choose a new version to preserve the installed copy.', 409);
      if (Object.keys(app.versions).length >= MAX_VERSIONS) throw new StoreError('This Day 0 store supports 32 installed versions per app.', 409);
      const manifest = { schemaVersion: 1, id, name: project.name, version: requested.version, entryPoint: 'index.html', runtime: 'web', permissions: [] };
      const files = Object.fromEntries(Object.entries(project.files).filter(([file]) => !file.startsWith('recycle-bin/')));
      const installed = { manifest, files, installedAt: new Date().toISOString(), digest: digest(manifest, files), sourceRevision: project.revision, projectId: id };
      app.versions[requested.version] = installed;
      app.currentVersion = requested.version;
      state.apps[id] = app;
      return installed;
    });
  }
  listApps() {
    this.#assertOpen();
    return Object.entries(this.#state.apps).map(([id, app]) => ({
      id, name: app.versions[app.currentVersion].manifest.name, currentVersion: app.currentVersion,
      versions: Object.values(app.versions).map(({ manifest, installedAt, digest, sourceRevision }) => ({ version: manifest.version, installedAt, digest, sourceRevision }))
    }));
  }
  async selectAppVersion(id, input) {
    exactKeys(input, ['version'], 'Choose app version');
    if (typeof input.version !== 'string' || !APP_VERSION.test(input.version)) throw new StoreError('Choose an installed app version such as 1.0.0.');
    const requested = clone(input);
    return this.#mutate(state => {
      this.getInstalled(id, requested.version);
      state.apps[id].currentVersion = requested.version;
      const app = state.apps[id];
      return { id, name: app.versions[app.currentVersion].manifest.name, currentVersion: app.currentVersion, versions: Object.values(app.versions).map(({ manifest, installedAt, digest, sourceRevision }) => ({ version: manifest.version, installedAt, digest, sourceRevision })) };
    });
  }
  getInstalled(id, version) {
    this.#assertOpen(); this.#project(id, true);
    const app = this.#state.apps[id];
    if (!app) throw new StoreError('App not installed.', 404);
    const selected = version ?? app.currentVersion;
    if (typeof selected !== 'string' || !APP_VERSION.test(selected)) throw new StoreError('Invalid app version.');
    if (!Object.hasOwn(app.versions, selected)) throw new StoreError('App version not found.', 404);
    return clone(app.versions[selected]);
  }
  getGameProgress(id) {
    this.#assertOpen(); validateGameId(id);
    return clone(this.#state.games[id] ?? emptyProgress());
  }
  async recordGameResult(id, input) {
    validateGameId(id); validateResult(input);
    const result = clone(input);
    return this.#mutate(state => {
      const progress = state.games[id] ?? emptyProgress();
      if (progress.recentRounds.includes(result.roundId)) return progress;
      if (progress.rounds === Number.MAX_SAFE_INTEGER) throw new StoreError('Game history is full.', 409);
      progress.best = Math.max(progress.best, result.score);
      progress.last = result.score;
      progress.rounds += 1;
      if (result.won) progress.wins += 1;
      progress.recentRounds = [...progress.recentRounds, result.roundId].slice(-128);
      progress.updatedAt = new Date().toISOString();
      state.games[id] = progress;
      return progress;
    });
  }
  #media(id) {
    validateMediaId(id);
    if (!Object.hasOwn(this.#state.media, id)) throw new StoreError('Library item not found.', 404);
    return this.#state.media[id];
  }
  listMedia() {
    this.#assertOpen();
    return clone(Object.values(this.#state.media).sort((a, b) => b.importedAt.localeCompare(a.importedAt) || a.title.localeCompare(b.title)));
  }
  getMedia(id) { this.#assertOpen(); return clone(this.#media(id)); }
  async importMedia(input, bytes) {
    this.#assertOpen();
    const item = prepareMedia(input, bytes);
    const content = Buffer.from(bytes);
    return this.#mutate(state => {
      if (Object.hasOwn(state.media, item.id)) return { item: state.media[item.id], duplicate: true };
      if (Object.keys(state.media).length >= MAX_MEDIA_ITEMS) throw new StoreError('The Library supports up to 512 items.', 409);
      state.media[item.id] = item;
      return { item, duplicate: false };
    }, async (_state, result) => {
      if (result.duplicate) await readMediaBlob(this.#directory, result.item);
      else await writeMediaBlob(this.#directory, item, content);
    });
  }
  async readMedia(id) {
    const item = this.getMedia(id);
    return { item, bytes: await readMediaBlob(this.#directory, item) };
  }
  async saveMediaProgress(id, input) {
    exactKeys(input, ['position'], 'Library progress');
    const requested = clone(input);
    return this.#mutate(state => {
      const item = this.#media(id);
      validateMediaProgress(item, requested);
      state.media[id] = { ...item, progress: { position: requested.position, updatedAt: new Date().toISOString() } };
      return state.media[id];
    });
  }
  async editMedia(id, input) {
    const requested = clone(input);
    return this.#mutate(state => { state.media[id] = editMediaDetails(this.#media(id), requested); return state.media[id]; });
  }
  getMail() { this.#assertOpen(); return clone(this.#state.mail); }
  async addMailPerson(input) { const requested = clone(input); return this.#mutate(state => addMailPerson(state.mail, requested)); }
  async saveMailDraft(id, input) { const requested = clone(input); return this.#mutate(state => saveMailDraft(state.mail, id, requested)); }
  async sendMailDraft(id, input) { const requested = clone(input); return this.#mutate(state => sendMailDraft(state.mail, id, requested)); }
  async changeMailMessage(id, input) { const requested = clone(input); return this.#mutate(state => changeMailMessage(state.mail, id, requested)); }
  getWorkspace() { this.#assertOpen(); return clone(this.#state.workspace); }
  async saveWorkspace(input) {
    validateWorkspace(input);
    const requested = clone(input);
    return this.#mutate(state => {
      if (requested.revision !== state.workspace.revision) throw new StoreError('This desktop workspace changed in another window. Your pending arrangement and draft have not replaced it. Reload the saved workspace before choosing what to keep.', 409);
      if (state.workspace.revision === Number.MAX_SAFE_INTEGER) throw new StoreError('The desktop workspace revision limit has been reached.', 409);
      state.workspace = { ...requested, revision: state.workspace.revision + 1 };
      return state.workspace;
    });
  }
  exportProject(id) { return { schemaVersion: 1, project: this.getProject(id) }; }
  close() {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#closePromise = (async () => {
      await this.#queue;
      this.#closed = true;
      const lockPath = path.join(this.#directory, 'store.lock');
      const lock = await safeRead(lockPath, 4096);
      if (lock !== null && decodeLock(lock).token === this.#token) await unlink(lockPath);
    })();
    return this.#closePromise;
  }
}
