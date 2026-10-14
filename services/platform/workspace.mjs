import { APP_VERSION, PROJECT_ID, StoreError, exactKeys, validateFilePath, validateFiles } from '../../packages/app-contract/manifest.mjs';
import { GAME_IDS } from './games.mjs';
import { validateMediaId } from './media.mjs';

export const MAX_WORKSPACE_WINDOWS = 24;
const TOOL_ROUTES = ['stuff', 'make', 'play', 'library', 'explore', 'mail', 'appearance'];
const WINDOW_COMMON = ['id', 'kind', 'bounds', 'minimized', 'maximized', 'snap'];
const invalidText = /[\x00-\x1f\x7f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const validProjectId = value => typeof value === 'string' && PROJECT_ID.test(value);
const validRevision = value => Number.isSafeInteger(value) && value >= 0;
export const emptyWorkspace = () => ({ revision: 0, windows: [], activeId: null, editorDraft: null });

function validateBounds(bounds) {
  exactKeys(bounds, ['x', 'y', 'width', 'height'], 'Window bounds');
  for (const [key, value] of Object.entries(bounds)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (key === 'width' || key === 'height' ? 1 : 0) || value > 32768) throw new StoreError('Window positions and sizes must be finite and within the desktop limits.');
  }
}
function validateToolState(window) {
  if (window.route === 'stuff') {
    exactKeys(window.state, ['folder', 'projectId'], 'My Stuff workspace');
    if (!['home', 'projects', 'apps', 'trash', 'project'].includes(window.state.folder) || (window.state.folder === 'project' ? !validProjectId(window.state.projectId) : window.state.projectId !== null)) throw new StoreError('Invalid saved My Stuff folder.');
  } else if (window.route === 'make') {
    exactKeys(window.state, ['projectId', 'file'], 'Editor workspace');
    if (window.state.projectId !== null && !validProjectId(window.state.projectId)) throw new StoreError('Invalid editor project ID.');
    if (window.state.file !== null) validateFilePath(window.state.file);
    if (window.state.projectId === null && window.state.file !== null) throw new StoreError('An editor file requires a saved project identity.');
  } else if (window.route === 'library') {
    exactKeys(window.state, ['mediaId'], 'Library workspace');
    if (window.state.mediaId !== null) validateMediaId(window.state.mediaId);
  } else if (window.route === 'explore' && Object.keys(window.state ?? {}).length) {
    exactKeys(window.state, ['siteId'], 'Explore workspace');
    if (window.state.siteId !== null && !['science', 'space', 'nature', 'newspaper', 'workshop', 'personal'].includes(window.state.siteId)) throw new StoreError('Unknown saved Explore site.');
  } else exactKeys(window.state, [], 'Tool workspace');
}
export function validateWindowDescriptor(window) {
  if (window?.kind === 'tool') {
    exactKeys(window, [...WINDOW_COMMON, 'route', 'state'], 'Tool window');
    if (!TOOL_ROUTES.includes(window.route) || window.id !== window.route) throw new StoreError('Invalid desktop tool identity.');
    validateToolState(window);
  } else if (window?.kind === 'installed') {
    exactKeys(window, [...WINDOW_COMMON, 'appId', 'version'], 'Installed app window');
    if (!validProjectId(window.appId) || typeof window.version !== 'string' || !APP_VERSION.test(window.version) || window.id !== `app:${window.appId}:${window.version}`) throw new StoreError('Invalid installed app window identity.');
  } else if (window?.kind === 'game') {
    exactKeys(window, [...WINDOW_COMMON, 'gameId'], 'Game window');
    if (!GAME_IDS.includes(window.gameId) || window.id !== `game:${window.gameId}`) throw new StoreError('Invalid game window identity.');
  } else throw new StoreError('Unsupported saved window kind.');
  validateBounds(window.bounds);
  if (typeof window.minimized !== 'boolean' || typeof window.maximized !== 'boolean' || ![null, 'left', 'right'].includes(window.snap) || (window.maximized && window.snap !== null)) throw new StoreError('Invalid saved window presentation.');
  return window;
}
function validateDraft(draft) {
  if (draft === null) return;
  exactKeys(draft, ['projectId', 'baseRevision', 'name', 'files', 'file', 'version'], 'Editor recovery draft');
  if (!validProjectId(draft.projectId) || !validRevision(draft.baseRevision) || draft.baseRevision < 1) throw new StoreError('A draft must retain its original project identity and saved revision.');
  // A recovery draft may contain an unfinished name/version. Do not silently
  // normalize edits or require project-save validity while preserving typing.
  if (typeof draft.name !== 'string' || draft.name.length > 60 || invalidText.test(draft.name) || typeof draft.version !== 'string' || draft.version.length > 64 || invalidText.test(draft.version)) throw new StoreError('Draft names and versions must be bounded plain text.');
  validateFiles(draft.files);
  validateFilePath(draft.file);
  if (!Object.hasOwn(draft.files, draft.file)) throw new StoreError('The selected draft file must exist in its saved recovery files.');
}
export function validateWorkspace(workspace) {
  exactKeys(workspace, ['revision', 'windows', 'activeId', 'editorDraft'], 'Desktop workspace');
  if (!validRevision(workspace.revision) || !Array.isArray(workspace.windows) || workspace.windows.length > MAX_WORKSPACE_WINDOWS) throw new StoreError('A workspace needs a current revision and at most 24 windows.');
  const ids = new Set();
  for (const window of workspace.windows) {
    validateWindowDescriptor(window);
    if (ids.has(window.id)) throw new StoreError('Saved window identities must be unique.');
    ids.add(window.id);
  }
  if (workspace.activeId !== null && (typeof workspace.activeId !== 'string' || !workspace.windows.some(window => window.id === workspace.activeId && !window.minimized))) throw new StoreError('The active saved window must be open and visible.');
  validateDraft(workspace.editorDraft);
  return workspace;
}
