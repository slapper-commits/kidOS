import { projectChanged, changeSourceFile, parseProjectImport, filterAndSort, RECYCLE_PREFIX } from './project-tools.mjs';
import { createGameBridge } from './game-bridge.mjs';
import { createMailbox } from './mail.mjs';
import { createExplore } from './explore.mjs';
import { createLibrary } from './library.mjs';
import { createWindowManager } from './window-manager.mjs';
import { createShortcutLayout } from './desktop-shortcuts.mjs';
import { createWorkspaceSync } from './workspace-sync.mjs';
import { createNativeApps, NATIVE_APPS, NATIVE_ORIGIN, nativeAvailabilityText, nativeEntryStatus } from './native-apps.mjs';
// The desktop is trusted UI. Project code runs only in a separately served,
// opaque-origin iframe; never evaluate project code in this module.
const root = document.getElementById('desktop');
const areas = {
  stuff: { name: 'My Stuff', intro: 'All yours.', description: 'Things you made. Things you can make your own.' },
  make: { name: 'Code Editor', intro: 'What do you want to make?', description: 'Start with something that works. Change it. See what happens.' },
  play: { name: 'Play', intro: 'Your little arcade.', description: 'Pick an adventure. Beat your own best.' },
  library: { name: 'Library', intro: 'Room for your favorite things.', description: 'Books, films, music, and pictures will have a home here.' },
  explore: { name: 'Explore', intro: 'A world worth wondering about.', description: 'Good places to explore. Big questions to ask.' },
  mail: { name: 'Mailbox', intro: 'Hello from your people.', description: 'A little hello goes a long way.' },
};
const desktopPlaces = ['stuff', 'apps', 'play', 'library', 'explore', 'mail'];
areas.apps = { name: 'Applications' };
areas.appearance = { name: 'Personalize' };
const wallpapers = ['teal', 'plum', 'night'];
let initialWallpaper = 'teal';
try { const stored = localStorage.getItem('kidos.wallpaper'); if (wallpapers.includes(stored)) initialWallpaper = stored; } catch {}
const modes = ['computer', 'tablet', 'tv'];
let initialMode = 'computer';
try { const stored = localStorage.getItem('kidos.layout'); if (modes.includes(stored)) initialMode = stored; } catch { /* A browser may disable preference storage. */ }
const state = {
  mode: initialMode, wallpaper: initialWallpaper, minimized: false, folder: 'home', browserProject: null, route: 'home', start: false, busy: false, connected: false,
  token: null, runnerOrigin: null, projects: [], trash: [], apps: [], games: [], editor: null,
  fileQuery: '', fileOrder: 'name', makeView: 'new', formName: 'My color lab', notice: null, recoveryNotice: null, run: null,
};
const nativePending = new Set();
const nativeFolders = ['documents', 'files', 'downloads'].map(id => NATIVE_APPS.find(app => app.id === id));

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    if (key === 'className') element.className = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), event => {
      // A UI action belongs to its own window, even when it was behind another.
      // Focus and movement remain available while an API action is in flight.
      if (['onClick', 'onInput', 'onChange', 'onSubmit'].includes(key)) {
        if (state.busy && !element.hasAttribute('data-shell-control') && !element.closest('dialog')) { event.preventDefault(); return; }
        if (!state.busy && !element.closest('dialog')) selectContext(element.closest('[data-window-id]'));
      }
      value(event);
      if (['onClick', 'onInput', 'onChange', 'onSubmit'].includes(key)) workspaceSync?.schedule();
    });
    else if (['value', 'disabled', 'readOnly', 'checked', 'hidden', 'spellcheck'].includes(key)) element[key] = value;
    else element.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}
function button(label, attributes = {}) {
  return node('button', { type: 'button', className: 'retro', disabled: state.busy, ...attributes }, label);
}
function iconButton(name, label, attributes = {}) { return button([icon(name), node('span', {}, label)], attributes); }
function isDirty() {
  return projectChanged(state.editor);
}
function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Saved locally' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
function messageFrom(error) {
  if (error instanceof TypeError) return 'Cannot reach the local kidOS service. Your open edits are still here. Start the service, then choose Retry local service.';
  return error?.message || 'Something went wrong. Your open edits are still here.';
}
async function readSession() {
  const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error('The local kidOS service could not open a session. Choose Retry local service.');
  const session = await response.json();
  if (typeof session.token !== 'string' || typeof session.runnerOrigin !== 'string') throw new Error('The local service returned an incomplete session. Restart kidOS and try again.');
  state.token = session.token;
  state.runnerOrigin = new URL(session.runnerOrigin).origin;
  if (session.recoveryNotice) state.recoveryNotice = typeof session.recoveryNotice === 'string' ? session.recoveryNotice : 'kidOS recovered saved data after an interrupted write. Export your projects to keep a backup.';
  state.connected = true;
}
async function api(path, { method = 'GET', body, binary, raw = false } = {}, retry = true) {
  if (!state.token) await readSession();
  let response;
  try {
    response = await fetch(path, {
      method, cache: 'no-store', credentials: 'same-origin',
      headers: { 'X-KidOS-Token': state.token, ...(binary ? { 'Content-Type': 'application/octet-stream' } : body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(binary ? { body: binary } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) { state.connected = false; throw error; }
  if ((response.status === 401 || response.status === 403) && retry) {
    await readSession();
    return api(path, { method, body, binary, raw }, false);
  }
  state.connected = true;
  if (!response.ok) {
    let detail;
    try { detail = await response.json(); } catch { /* An HTTP error need not have a JSON body. */ }
    const text = typeof detail?.error === 'string' ? detail.error : detail?.error?.message;
    throw Object.assign(new Error(text || `kidOS could not complete that action (${response.status}). Your open edits are still here.`), { status: response.status });
  }
  return raw ? response : response.json();
}
async function refreshCatalogs() {
  await Promise.all([library.refresh(), mailbox.refresh(), explore.refresh()]);
  const [projects, trash, apps, games] = await Promise.all([api('/api/projects'), api('/api/trash'), api('/api/apps'), api('/api/games')]);
  state.projects = projects.projects;
  state.trash = trash.projects;
  state.apps = apps.apps;
  state.games = games.games;
}
async function perform(work, focus) {
  if (state.busy) return;
  state.busy = true;
  state.notice = null;
  root.setAttribute('aria-busy', 'true');
  // Lock application actions during a transaction without remounting windows.
  // Remember prior disabled states (Save may already be disabled).
  const controls = [...root.querySelectorAll('.window-content button, .window-content input, .window-content select, .window-content textarea, .window-tools button:not([data-shell-control]), .desktop-apps button')];
  const disabled = controls.map(element => [element, element.disabled]);
  for (const [element] of disabled) element.disabled = true;
  try { await work(); }
  catch (error) { state.notice = { type: 'error', text: messageFrom(error) }; }
  finally {
    state.busy = false;
    for (const [element, wasDisabled] of disabled) element.disabled = wasDisabled;
    render(focus);
  }
}
function navigate(route) {
  if (route === 'apps') { openFolder('apps'); return; }
  if (route === 'home') { showDesktop(); return; }
  state.minimized = false;
  state.route = route;
  state.start = false;
  render(route === 'home' ? 'desktop-heading' : 'view-heading');
}
function showNewProject() {
  state.minimized = false;
  state.makeView = 'new';
  state.route = 'make';
  state.start = false;
  render('new-project-name');
}
function nextVersion(projectId) {
  const current = state.apps.find(app => app.id === projectId)?.currentVersion;
  const parsed = /^(\d+)\.(\d+)\.(\d+)$/.exec(current || '');
  return parsed ? `${parsed[1]}.${parsed[2]}.${Number(parsed[3]) + 1}` : '1.0.0';
}
function useProject(project) {
  state.minimized = false;
  const files = { ...project.files };
  state.editor = { ...project, files, saved: { name: project.name, files: { ...files } }, file: Object.hasOwn(files, 'index.html') ? 'index.html' : Object.keys(files)[0], version: nextVersion(project.id) };
  state.makeView = 'editor';
  state.route = 'make';
  state.start = false;
}
async function saveProject() {
  if (!state.editor) return;
  const editor = state.editor;
  if (!editor.name.trim()) throw new Error('Give your project a name before saving.');
  if (!isDirty()) return;
  const { project } = await api(`/api/projects/${encodeURIComponent(editor.id)}`, { method: 'PUT', body: { name: editor.name, files: editor.files, revision: editor.revision } });
  const file = editor.file;
  const version = editor.version;
  const route = state.route;
  const minimized = state.minimized;
  const makeView = state.makeView;
  useProject(project);
  state.route = route;
  state.minimized = minimized;
  state.makeView = makeView;
  if (state.browserProject?.id === project.id) state.browserProject = project;
  state.editor.file = Object.hasOwn(project.files, file) ? file : state.editor.file;
  state.editor.version = version;
  const summary = { id: project.id, name: project.name, revision: project.revision, createdAt: project.createdAt, updatedAt: project.updatedAt, fileCount: Object.keys(project.files).length };
  state.projects = state.projects.map(item => item.id === project.id ? summary : item);
}
function chooseUnsaved(title = 'Before you open a project') {
  return new Promise(resolve => {
    const dialog = node('dialog', { className: 'dialog', 'aria-labelledby': 'unsaved-title', 'aria-describedby': 'unsaved-description' });
    const finish = choice => { dialog.close(); dialog.remove(); resolve(choice); };
    dialog.append(node('div', { className: 'titlebar' }, title));
    dialog.append(node('div', { className: 'dialog-body' },
      node('h2', { id: 'unsaved-title' }, 'Keep your changes?'),
      node('p', { id: 'unsaved-description' }, `“${state.editor.name || 'Your project'}” has changes that have not been saved to disk.`),
      node('div', { className: 'button-row' },
        button('Save & continue', { className: 'retro primary', disabled: false, onClick: () => finish('save') }),
        button('Keep editing', { disabled: false, onClick: () => finish('cancel') }),
        button('Discard changes', { disabled: false, onClick: () => finish('discard') }),
      ),
    ));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel'); });
    document.body.append(dialog);
    dialog.showModal();
    dialog.querySelector('button').focus();
  });
}
async function maySwitchProject(title) {
  if (!isDirty()) return true;
  const choice = await chooseUnsaved(title);
  if (choice === 'cancel') { state.makeView = 'editor'; state.route = 'make'; return false; }
  if (choice === 'save') await saveProject();
  return true;
}
function openProject(id, file = 'index.html') {
  if (state.editor?.id === id && Object.hasOwn(state.editor.files, file)) { state.editor.file = file; state.makeView = 'editor'; navigate('make'); return; }
  perform(async () => {
    if (!await maySwitchProject()) return;
    const { project } = await api(`/api/projects/${encodeURIComponent(id)}`);
    useProject(project);
    if (Object.hasOwn(project.files, file)) state.editor.file = file;
  }, 'code-editor');
}
function reopenSavedProject() {
  const id = state.editor.id;
  perform(async () => {
    if (!await maySwitchProject()) return;
    const { project } = await api(`/api/projects/${encodeURIComponent(id)}`);
    useProject(project);
    state.notice = { type: 'success', text: 'Opened the latest saved copy from this computer.' };
  }, 'code-editor');
}
function createProject(event) {
  event.preventDefault();
  const name = state.formName.trim();
  if (!name) return;
  perform(async () => {
    if (!await maySwitchProject()) return;
    const { project } = await api('/api/projects', { method: 'POST', body: { name } });
    useProject(project);
    await refreshCatalogs();
    state.browserProject = project;
    state.folder = 'project';
    state.route = 'stuff';
    state.notice = { type: 'success', text: `Created “${project.name}” in Projects.` };
  }, 'view-heading');
}
function checkedRunnerUrl(value) {
  const url = new URL(value);
  if (url.origin !== state.runnerOrigin || url.origin === location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('kidOS refused an unexpected app address. Restart the service and try again.');
  return url.href;
}
function previewProject() {
  perform(async () => {
    await saveProject();
    const { url } = await api(`/api/projects/${encodeURIComponent(state.editor.id)}/preview`, { method: 'POST', body: { revision: state.editor.revision } });
    state.run = { kind: 'preview', title: state.editor.name, url: checkedRunnerUrl(url), revision: state.editor.revision, returnTo: 'make' };
    state.route = 'run';
    state.minimized = false;
  }, 'view-heading');
}
function installProject(event) {
  event.preventDefault();
  const version = state.editor.version.trim();
  if (!version) return;
  perform(async () => {
    await saveProject();
    const { app } = await api(`/api/projects/${encodeURIComponent(state.editor.id)}/install`, { method: 'POST', body: { revision: state.editor.revision, version } });
    await refreshCatalogs();
    state.editor.version = nextVersion(state.editor.id);
    state.notice = { type: 'success', text: `Installed ${app.manifest.name} · v${app.manifest.version}. Your app is now on the desktop. This version will keep its own files.` };
  }, 'installed-app-button');
}
function launchApp(app, version = app.currentVersion, returnTo = state.route === 'run' ? state.run.returnTo : state.route) {
  perform(async () => {
    const { url } = await api(`/api/apps/${encodeURIComponent(app.id)}/launch?version=${encodeURIComponent(version)}`);
    const details = app.versions.find(item => item.version === version);
    state.run = { kind: 'installed', title: app.name, appId: app.id, version, url: checkedRunnerUrl(url), returnTo, details };
    state.route = 'run';
    state.minimized = false;
    state.start = false;
  }, 'view-heading');
}
function exportProject(project) {
  perform(async () => {
    // An export contains the saved version. Save an open draft of this project
    // first, so a successful export includes the work currently visible.
    if (state.editor?.id === project.id && isDirty()) await saveProject();
    const response = await api(`/api/projects/${encodeURIComponent(project.id)}/export`, { raw: true });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const safeName = project.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'project';
    const link = node('a', { href: url, download: `${safeName}.kidos.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    state.notice = { type: 'success', text: `Exported “${project.name}” as a project backup. Keep it somewhere separate from this device.` };
  });
}
function projectDialog({ title, description, label, value = '', confirm = 'Continue', choices = null }) {
  return new Promise(resolve => {
    const dialog = node('dialog', { className: 'dialog', 'aria-label': title });
    const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
    const input = label ? node('input', { type: 'text', value, maxlength: '180', required: '', autocomplete: 'off' }) : null;
    dialog.append(node('div', { className: 'titlebar' }, title), node('form', { className: 'dialog-body', onSubmit: event => { event.preventDefault(); finish(input ? input.value.trim() : true); } },
      node('h2', {}, title), node('p', {}, description),
      choices ? node('ul', {}, choices.map(choice => node('li', {}, choice))) : null,
      input ? node('label', {}, label, input) : null,
      node('div', { className: 'button-row' }, button(confirm, { type: 'submit', className: 'retro primary', disabled: false }), button('Cancel', { disabled: false, onClick: () => finish(null) })),
    ));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    document.body.append(dialog); dialog.showModal(); (input || dialog.querySelector('button')).focus(); input?.select();
  });
}
function importProjectFile(file) {
  if (!file) return;
  perform(async () => {
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a kidOS project or draft JSON file smaller than 2 MiB.');
    const imported = parseProjectImport(await file.text());
    if (!await projectDialog({ title: 'Import project', description: `Import “${imported.name}” with ${imported.fileCount} text files as a new project? Existing projects stay as they are. The source will not run until you choose Preview or install it.`, confirm: 'Import as new project' })) return;
    const { project } = await api('/api/projects/import', { method: 'POST', body: imported.envelope });
    await refreshCatalogs(); state.browserProject = project; state.folder = 'project'; state.fileQuery = ''; state.route = 'stuff';
    state.notice = { type: 'success', text: `Imported “${project.name}” as a new editable project. Your existing projects and installed apps are unchanged.` };
  }, 'view-heading');
}
function duplicateProject(project) {
  perform(async () => {
    const name = await projectDialog({ title: 'Duplicate project', description: `Make an independent copy of the source files. Installed versions stay with the original.${state.editor?.id === project.id && isDirty() ? ' This saves your open edits before copying them.' : ''}`, label: 'Name for the copy', value: `${project.name.slice(0, 55)} copy`, confirm: 'Make copy' });
    if (!name) return;
    if (state.editor?.id === project.id && isDirty()) await saveProject();
    const current = state.editor?.id === project.id ? state.editor : project;
    const { project: copy } = await api(`/api/projects/${encodeURIComponent(project.id)}/duplicate`, { method: 'POST', body: { revision: current.revision, name } });
    await refreshCatalogs(); state.browserProject = copy; state.folder = 'project'; state.fileQuery = ''; state.route = 'stuff';
    state.notice = { type: 'success', text: `Copied “${copy.name}” into Projects.` };
  }, 'view-heading');
}
function editProjectFile(action) {
  perform(async () => {
    const editor = state.editor;
    let target;
    if (action === 'new' || action === 'rename') {
      target = await projectDialog({ title: action === 'new' ? 'New source file' : 'Rename source file', description: action === 'new' ? 'Add an empty text file. Use folders in the name, such as pages/about.html. Save commits your changes.' : 'Links and script references are not changed automatically. Update them after renaming, then save.', label: 'File name', value: action === 'new' ? 'notes.txt' : editor.file, confirm: action === 'new' ? 'Add file' : 'Rename file' });
      if (!target) return;
    } else if (action === 'remove' && !await projectDialog({ title: 'Move to file bin', description: `Move “${editor.file}” into this project’s file bin? Its text stays recoverable. Links to its old name will stop working. Save commits this move.`, confirm: 'Move to file bin' })) return;
    const changed = changeSourceFile(editor.files, action, editor.file, target);
    editor.files = changed.files; editor.file = changed.file;
    state.notice = { type: 'success', text: action === 'remove' ? 'File moved into the project’s file bin. Choose Restore file to bring it back. Save to keep this change.' : action === 'restore' ? 'File restored. Save to keep this change.' : 'Source files changed. Save to keep this change.' };
  }, 'code-editor');
}
function setDefaultVersion(app, version) {
  perform(async () => {
    await api(`/api/apps/${encodeURIComponent(app.id)}/current`, { method: 'POST', body: { version } });
    await refreshCatalogs();
    state.notice = { type: 'success', text: `${app.name} now opens v${version} from the desktop. Other installed versions are still available.` };
  });
}
function applicationItem(app) {
  let chosen = app.currentVersion;
  const select = node('select', { 'aria-label': `Installed version of ${app.name}`, onChange: event => { chosen = event.target.value; } }, app.versions.map(item => node('option', { value: item.version, selected: item.version === app.currentVersion ? '' : null }, `v${item.version}${item.version === app.currentVersion ? ' · desktop default' : ''}`)));
  return node('article', { className: 'application-item' },
    fileTile(app.name, 'app', `Desktop opens v${app.currentVersion}`, () => launchApp(app)),
    node('details', { className: 'version-manager' }, node('summary', {}, `${app.versions.length} installed ${app.versions.length === 1 ? 'version' : 'versions'}`),
      node('label', {}, 'Version', select), node('div', { className: 'button-row' },
        button('Open version', { className: 'retro small', onClick: () => launchApp(app, chosen) }),
        button('Use on desktop', { className: 'retro small', onClick: () => setDefaultVersion(app, chosen) }),
      ), node('p', { className: 'permission-note' }, 'Choosing a default preserves every installed version and its files.'),
    ),
  );
}
function dirtyCallout() {
  if (!isDirty() || (state.route === 'make' && state.makeView === 'editor')) return null;
  return node('div', { className: 'draft-callout' },
    node('span', {}, `Open draft: ${state.editor.name || 'Untitled project'} · unsaved changes`),
    button('Continue editing', { className: 'retro small', onClick: () => { state.makeView = 'editor'; navigate('make'); } }),
  );
}
function heading(text) { return node('h2', { tabindex: '-1', 'data-focus': 'view-heading' }, text); }
function chooseTrash(project) {
  const dirty = state.editor?.id === project.id && isDirty();
  return new Promise(resolve => {
    const dialog = node('dialog', { className: 'dialog', 'aria-labelledby': 'trash-title', 'aria-describedby': 'trash-description' });
    const finish = choice => { dialog.close(); dialog.remove(); resolve(choice); };
    const cancel = button('Keep project', { disabled: false, onClick: () => finish('cancel') });
    dialog.append(node('div', { className: 'titlebar' }, 'My Stuff'));
    dialog.append(node('div', { className: 'dialog-body' },
      node('h2', { id: 'trash-title' }, 'Move this project to Trash?'),
      node('p', { id: 'trash-description' }, `“${project.name}” and all its saved files can be restored from Trash. Installed apps will still work.`),
      dirty ? node('p', {}, 'You have unsaved changes. Save them first, or move only the saved copy and discard this draft.') : null,
      node('div', { className: 'button-row' },
        button(dirty ? 'Save & move to Trash' : 'Move to Trash', { className: 'retro primary', disabled: false, onClick: () => finish(dirty ? 'save' : 'move') }),
        cancel,
        dirty ? button('Discard draft & move', { disabled: false, onClick: () => finish('discard') }) : null,
      ),
    ));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish('cancel'); });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
function trashProject(project) {
  perform(async () => {
    const choice = await chooseTrash(project);
    if (choice === 'cancel') return;
    if (choice === 'save') await saveProject();
    // Keep the draft until the server confirms the move. Use its revision even
    // when discarding, so another window's newer work cannot be moved silently.
    const current = state.editor?.id === project.id ? state.editor : project;
    const { project: moved } = await api(`/api/projects/${encodeURIComponent(project.id)}/trash`, { method: 'POST', body: { revision: current.revision } });
    if (state.editor?.id === project.id) { state.editor = null; state.makeView = 'new'; }
    state.browserProject = null;
    state.projects = state.projects.filter(item => item.id !== project.id);
    const { files, ...summary } = moved;
    state.trash = [{ ...summary, fileCount: Object.keys(files).length, trashedAt: moved.updatedAt }, ...state.trash.filter(item => item.id !== project.id)];
    state.folder = 'trash'; state.route = 'stuff';
    state.notice = { type: 'success', text: `Moved “${moved.name}” to Trash. Choose Restore to put it back in Projects.` };
  }, 'view-heading');
}
function restoreProject(project) {
  perform(async () => {
    const { project: restored } = await api(`/api/trash/${encodeURIComponent(project.id)}/restore`, { method: 'POST', body: { revision: project.revision } });
    // A draft in another window must keep its old revision and fail safely on
    // save. Never silently attach old edits to the restored revision here.
    state.trash = state.trash.filter(item => item.id !== project.id);
    const { files, ...summary } = restored;
    state.projects = [{ ...summary, fileCount: Object.keys(files).length }, ...state.projects.filter(item => item.id !== project.id)];
    state.notice = { type: 'success', text: `Restored “${restored.name}” to Projects.` };
  }, 'view-heading');
}
function openFolder(folder) {
  state.fileQuery = '';
  state.folder = folder;
  navigate('stuff');
}
function browseProject(id) {
  perform(async () => {
    const { project } = await api(`/api/projects/${encodeURIComponent(id)}`);
    state.browserProject = project;
    state.fileQuery = '';
    state.folder = 'project';
    state.route = 'stuff';
    state.minimized = false;
    state.start = false;
  }, 'view-heading');
}
function fileTile(name, kind, detail, onClick, extra = {}) {
  return button([
    node('span', { className: `file-art ${kind}`, 'aria-hidden': 'true' }, icon(kind === 'folder' ? 'stuff' : kind === 'app' ? 'rocket' : kind === 'trash' ? 'trash' : 'file')),
    node('strong', {}, name), node('small', {}, detail),
  ], { className: 'file-tile', onClick, ...extra });
}
function fileBreadcrumbs() {
  const folder = state.folder;
  return node('nav', { className: 'file-breadcrumbs', 'aria-label': 'Folder path' },
    button([icon('stuff'), 'My Stuff'], { className: 'breadcrumb', onClick: () => openFolder('home') }),
    folder !== 'home' ? node('span', { 'aria-hidden': 'true' }, '/') : null,
    folder !== 'home' ? button(folder === 'apps' ? 'Applications' : folder === 'trash' ? 'Trash' : 'Projects', { className: 'breadcrumb', onClick: () => openFolder(folder === 'apps' ? 'apps' : folder === 'trash' ? 'trash' : 'projects') }) : null,
    folder === 'project' ? [node('span', { 'aria-hidden': 'true' }, '/'), node('span', { 'aria-current': 'location' }, state.browserProject.name)] : null,
  );
}
function nativeAttributes(app) {
  return { 'data-native-app': app.id, 'aria-label': `Open ${app.name}`, disabled: state.busy || nativePending.has(app.id),
    'aria-busy': nativePending.has(app.id), title: nativeEntryStatus(nativeApps.snapshot(), app.id) || app.description, onClick: () => launchNative(app) };
}
function nativeLabel(text, className) {
  return node('span', { className, 'data-native-label': text }, text);
}
function nativeDescription(app) {
  return node('small', { 'data-native-description': app.id },
    [app.description, nativeEntryStatus(nativeApps.snapshot(), app.id)].filter(Boolean).join(' '));
}
function nativeNote() {
  const snapshot = nativeApps.snapshot();
  return node('div', { className: 'native-apps-note' },
    node('p', { 'data-native-status': '', role: 'status' }, nativeAvailabilityText(snapshot)),
    button('Check again', { className: 'retro small', 'data-native-refresh': '', hidden: snapshot.status !== 'unavailable' || location.origin !== NATIVE_ORIGIN,
      onClick: () => { void nativeApps.refresh(); } }),
  );
}
function updateNativeUI() {
  const snapshot = nativeApps.snapshot();
  // Updating a bridge reply must not remount an editor, iframe or background window.
  root.querySelectorAll('[data-native-app]').forEach(element => {
    const opening = nativePending.has(element.dataset.nativeApp);
    element.disabled = state.busy || opening;
    element.setAttribute('aria-busy', String(opening));
    const app = NATIVE_APPS.find(item => item.id === element.dataset.nativeApp);
    element.title = nativeEntryStatus(snapshot, app.id) || app.description;
    element.querySelectorAll('[data-native-label]').forEach(label => { label.textContent = opening ? 'Opening…' : label.dataset.nativeLabel; });
  });
  root.querySelectorAll('[data-native-description]').forEach(element => {
    const app = NATIVE_APPS.find(item => item.id === element.dataset.nativeDescription);
    element.textContent = [app.description, nativeEntryStatus(snapshot, app.id)].filter(Boolean).join(' ');
  });
  root.querySelectorAll('[data-native-status]').forEach(element => { element.textContent = nativeAvailabilityText(snapshot); });
  root.querySelectorAll('[data-native-refresh]').forEach(element => {
    element.hidden = snapshot.status !== 'unavailable' || location.origin !== NATIVE_ORIGIN;
    element.disabled = state.busy || snapshot.status === 'checking';
  });
}
async function launchNative(app) {
  if (nativePending.has(app.id)) return;
  toggleStart(false, false);
  nativePending.add(app.id); updateNativeUI();
  try {
    const result = await nativeApps.launch(app.id);
    state.notice = { type: 'success', source: 'native', text: result.status === 'already-running'
      ? `${app.name} is already open. Choose it with your desktop's window switcher.`
      : result.status === 'focused' ? `${app.name} is open.`
        : `${app.name} is opening in its own window.` };
  } catch (error) { state.notice = { type: 'error', source: 'native', text: error.message }; }
  finally {
    nativePending.delete(app.id); updateNativeUI();
    renderNotices();
  }
}
function nativeApplicationItem(app) {
  return node('article', { className: 'application-item native-application' },
    button([node('span', { className: `file-art native-art ${app.id}`, 'aria-hidden': 'true' }, icon(app.icon)),
      node('strong', {}, nativeLabel(app.name)), nativeDescription(app)], { className: 'file-tile', ...nativeAttributes(app) }),
  );
}
function nativeFolderItem(app) {
  return button([node('span', { className: 'file-art folder', 'aria-hidden': 'true' }, icon('stuff')),
    node('strong', {}, nativeLabel(app.folderName)), nativeDescription(app)],
  { className: 'file-tile', ...nativeAttributes(app), 'aria-label': `Open ${app.folderName}` });
}
function nativeTile(app) {
  return button([node('span', { className: `icon-box native-art ${app.id}` }, icon(app.icon)), nativeLabel(app.name, 'label')], {
    className: 'app-icon', 'data-focus': `native-${app.id}`, ...nativeAttributes(app),
  });
}
function nativeGameCard(app) {
  return node('article', { className: 'game-card' },
    node('div', { className: `game-poster native-poster ${app.id}`, 'aria-hidden': 'true' }, icon(app.icon)),
    node('div', { className: 'game-card-body' }, node('h3', {}, app.name), nativeDescription(app),
      button([icon('play'), nativeLabel('Play')], { className: 'retro primary', ...nativeAttributes(app), 'aria-label': `Play ${app.name}` }),
      node('p', { className: 'game-controls-note' }, app.controls),
    ),
  );
}
function stuffView() {
  const folder = state.folder;
  const project = state.browserProject;
  const title = folder === 'home' ? 'My Stuff' : folder === 'apps' ? 'Applications' : folder === 'trash' ? 'Trash' : folder === 'project' ? project.name : 'Projects';
  let items;
  let count;
  if (folder === 'home') {
    items = [
      ...nativeFolders.map(nativeFolderItem),
      fileTile('Projects', 'folder', `${state.projects.length} ${state.projects.length === 1 ? 'project' : 'projects'}`, () => openFolder('projects')),
      fileTile('Applications', 'folder', 'Tools, games and your installed apps', () => openFolder('apps')),
      fileTile('Trash', 'trash', `${state.trash.length} ${state.trash.length === 1 ? 'project' : 'projects'}`, () => openFolder('trash')),
    ];
    count = `${items.length} folders`;
  } else if (folder === 'projects') {
    items = filterAndSort(state.projects, state.fileQuery, state.fileOrder).map(item => fileTile(item.name, 'folder', dateLabel(item.updatedAt), () => browseProject(item.id), { 'aria-label': `Open folder ${item.name}` }));
    count = `${items.length} ${items.length === 1 ? 'folder' : 'folders'}`;
  } else if (folder === 'apps') {
    const applications = [...NATIVE_APPS.filter(app => !app.folderOnly).map(app => ({ ...app, native: true })), ...state.apps];
    items = filterAndSort(applications, state.fileQuery, state.fileOrder, app => app.name, app => app.versions?.find(item => item.version === app.currentVersion)?.installedAt)
      .map(app => app.native ? nativeApplicationItem(app) : applicationItem(app));
    count = `${items.length} ${items.length === 1 ? 'application' : 'applications'}`;
  } else if (folder === 'trash') {
    items = filterAndSort(state.trash, state.fileQuery, state.fileOrder, item => item.name, item => item.trashedAt).map(item => node('article', { className: 'trash-item' },
      node('span', { className: 'file-art folder', 'aria-hidden': 'true' }, icon('stuff')),
      node('strong', {}, item.name),
      node('small', {}, `${item.fileCount} files · Moved ${dateLabel(item.trashedAt)}`),
      button('Restore', { className: 'retro small', 'aria-label': `Restore ${item.name}`, onClick: () => restoreProject(item) }),
    ));
    count = `${items.length} ${items.length === 1 ? 'project' : 'projects'} in Trash`;
  } else {
    items = filterAndSort(Object.entries(project.files), state.fileQuery, 'name', item => item[0]).map(([file, content]) => fileTile(file.startsWith(RECYCLE_PREFIX) ? `File bin / ${file.slice(RECYCLE_PREFIX.length)}` : file, file.startsWith(RECYCLE_PREFIX) ? 'trash' : 'source', `${new TextEncoder().encode(content).length.toLocaleString()} bytes`, () => openProject(project.id, file), { 'aria-label': `Open ${file} in Code Editor` }));
    count = `${items.length} files`;
  }
  return node('div', { className: 'file-manager' },
    node('aside', { className: 'file-sidebar', 'aria-label': 'Places' },
      node('p', { className: 'sidebar-label' }, 'PLACES'),
      iconButton('stuff', 'My Stuff', { className: 'place-link', 'aria-current': folder === 'home' ? 'location' : null, onClick: () => openFolder('home') }),
      nativeFolders.map(app => button([icon(app.icon), nativeLabel(app.folderName)], {
        className: 'place-link', ...nativeAttributes(app), 'aria-label': `Open ${app.folderName}`,
      })),
      [['projects', 'code', 'Projects'], ['apps', 'blocks', 'Applications'], ['trash', 'trash', 'Trash']].map(([id, image, label]) => iconButton(image, label, {
        className: 'place-link', 'aria-current': folder === id || (id === 'projects' && folder === 'project') ? 'location' : null, onClick: () => openFolder(id),
      })),
      node('p', { className: 'sidebar-foot' }, 'On this computer'),
    ),
    node('div', { className: 'file-main' },
      fileBreadcrumbs(), dirtyCallout(),
      node('div', { className: 'file-heading' }, heading(title),
        node('div', { className: 'button-row' },
          folder !== 'project' ? button('Refresh', { className: 'retro small', onClick: () => perform(() => ['home', 'apps'].includes(folder) ? Promise.all([refreshCatalogs(), nativeApps.refresh()]) : refreshCatalogs(), 'view-heading') }) : null,
          folder === 'projects' ? [iconButton('plus', 'New project…', { className: 'retro small', onClick: showNewProject }),
            node('label', { className: 'retro small import-project-label' }, 'Import project…', node('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Import a kidOS project or recovery draft', disabled: state.busy, onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; importProjectFile(file); } })),
          ] : null,
          folder === 'project' ? [
            button('Duplicate…', { className: 'retro small', onClick: () => duplicateProject(project) }),
            iconButton('download', 'Export project', { className: 'retro small', onClick: () => exportProject(project) }),
            iconButton('trash', 'Move to Trash', { className: 'retro small', onClick: () => trashProject(project) }),
          ] : null,
        ),
      ),
      folder !== 'home' ? node('div', { className: 'file-search' },
        node('label', {}, 'Find', node('input', { type: 'search', placeholder: folder === 'project' ? 'File name' : 'Name', value: state.fileQuery, 'data-focus': 'file-search', onInput: event => { state.fileQuery = event.target.value; render(); } })),
        folder !== 'project' ? node('label', {}, 'Sort', node('select', { value: state.fileOrder, onChange: event => { state.fileOrder = event.target.value; render(); } }, [['name', 'Name'], ['recent', 'Recently saved']].map(([value, label]) => node('option', { value, selected: state.fileOrder === value ? '' : null }, label)))) : null,
      ) : null,
      folder === 'trash' ? node('p', { className: 'trash-help' }, 'Restore a project to use its files again. Projects stay here until restored and still use storage space.') : null,
      ['home', 'apps'].includes(folder) ? nativeNote() : null,
      items.length ? node('div', { className: 'file-grid' }, items) : node('div', { className: 'folder-empty' }, icon(folder === 'trash' ? 'trash' : 'stuff'), node('p', {}, state.fileQuery ? 'No matching names.' : folder === 'trash' ? 'Trash is empty.' : 'This folder is empty.'), node('small', {}, state.fileQuery ? 'Try a different search or clear Find.' : folder === 'projects' ? 'Use New project or Import project to add something here.' : folder === 'trash' ? 'Projects you move to Trash will appear here.' : 'Installed applications will appear here.')),
      node('div', { className: 'file-status' }, count),
    ),
  );
}
function newProjectView() {
  const form = node('form', { className: 'create-form', onSubmit: createProject },
    node('label', {}, 'Project name', node('input', { type: 'text', value: state.formName, maxlength: '60', required: '', autocomplete: 'off', disabled: state.busy, 'data-focus': 'new-project-name', onInput: event => { state.formName = event.target.value; } })),
    iconButton('plus', state.busy ? 'Creating…' : 'Create project', { type: 'submit', className: 'retro primary' }),
  );
  return node('div', {},
    dirtyCallout(), heading('New project'),
    node('p', { className: 'sub' }, 'Create a web project in My Stuff / Projects.'),
    node('article', { className: 'starter' },
      node('div', { className: 'starter-art' }, icon('code')),
      node('div', { className: 'starter-description' },
        node('h3', {}, 'Color Lab'),
        node('p', {}, 'A tiny interactive color toy, ready to make your own. Change the words, choose new colors, or give its button a different job.'),
        node('p', { className: 'starter-files' }, 'index.html · the page', node('br'), 'style.css · the look', node('br'), 'script.js · what happens'),
        form,
      ),
    ),
    state.editor && !isDirty() ? button(`Continue “${state.editor.name}”`, { onClick: () => { state.makeView = 'editor'; navigate('make'); } }) : null,
    node('p', { className: 'permission-note' }, 'This first workshop supports HTML, CSS, and browser JavaScript. Projects have no device permissions or saved game progress yet.'),
  );
}
function saveStatus() {
  return isDirty() ? 'Unsaved project changes.' : `Saved locally · revision ${state.editor.revision}`;
}
function refreshDirtyUI() {
  const dirty = isDirty();
  const status = document.getElementById('save-status');
  if (status) { status.textContent = saveStatus(); status.classList.toggle('dirty', dirty); }
  const save = document.getElementById('save-project');
  if (save) save.disabled = state.busy || !dirty;
  const preview = document.getElementById('preview-label');
  if (preview) preview.textContent = dirty ? 'Save & preview' : 'Preview';
  const exportLabel = document.getElementById('export-label');
  if (exportLabel) exportLabel.textContent = dirty ? 'Save & export' : 'Export';
  const install = document.getElementById('install-label');
  if (install) install.textContent = dirty ? 'Save & install' : 'Install app';
}
function editorView() {
  const editor = state.editor;
  const installed = state.apps.find(app => app.id === editor.id);
  const recycled = editor.file.startsWith(RECYCLE_PREFIX);
  const preferred = ['index.html', 'style.css', 'script.js'];
  const filenames = Object.keys(editor.files).sort((a, b) => {
    const orderA = preferred.includes(a) ? preferred.indexOf(a) : preferred.length;
    const orderB = preferred.includes(b) ? preferred.indexOf(b) : preferred.length;
    return orderA - orderB || a.localeCompare(b);
  });
  return node('div', {},
    node('h2', { className: 'visually-hidden', tabindex: '-1', 'data-focus': 'view-heading' }, 'Code Editor'),
    node('div', { className: 'workbench-heading' },
      node('label', { className: 'project-name-label' }, 'Project name', node('input', { type: 'text', value: editor.name, maxlength: '60', required: '', disabled: state.busy, autocomplete: 'off', 'data-focus': 'project-name', onInput: event => { editor.name = event.target.value; refreshDirtyUI(); } })),
      node('div', {}, node('p', { id: 'save-status', className: `save-status${isDirty() ? ' dirty' : ''}`, role: 'status' }, saveStatus()), node('p', { className: 'recovery-status', 'data-recovery-status': '', role: 'status' }, recoveryText())),
    ),
    node('div', { className: 'source-file-actions' },
      button('New file…', { className: 'retro small', onClick: () => editProjectFile('new') }),
      button('Rename file…', { className: 'retro small', disabled: state.busy || recycled || editor.file === 'index.html', onClick: () => editProjectFile('rename') }),
      button(recycled ? 'Restore file' : 'Move to file bin…', { className: 'retro small', disabled: state.busy || editor.file === 'index.html', onClick: () => editProjectFile(recycled ? 'restore' : 'remove') }),
      node('span', { className: 'source-file-count' }, `${filenames.filter(file => !file.startsWith(RECYCLE_PREFIX)).length} source files · ${filenames.filter(file => file.startsWith(RECYCLE_PREFIX)).length} in file bin`),
    ),
    recycled ? node('p', { className: 'file-bin-notice' }, 'This file is in the project’s file bin. Its text is kept below. Restore it to edit and use its original path again.') : null,
    node('div', { className: 'file-tabs', role: 'group', 'aria-label': 'Project files' }, filenames.map(file => button(file.startsWith(RECYCLE_PREFIX) ? `Bin: ${file.slice(RECYCLE_PREFIX.length)}` : file, {
      className: 'file-tab', 'aria-pressed': file === editor.file, 'aria-controls': 'code-editor', 'data-focus': `file-${file}`,
      onClick: () => { editor.file = file; render(`file-${file}`); },
    }))),
    node('label', { className: 'editor-label', for: 'code-editor' }, `${recycled ? 'Read' : 'Edit'} ${editor.file}`),
    node('textarea', {
      id: 'code-editor', className: 'code-editor', 'data-focus': 'code-editor', 'data-project': editor.id, 'data-file': editor.file, value: editor.files[editor.file],
      'aria-describedby': 'editor-help', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', wrap: 'off', readOnly: state.busy || recycled,
      onInput: event => { editor.files[editor.file] = event.target.value; refreshDirtyUI(); },
    }),
    node('p', { id: 'editor-help', className: 'editor-help' }, 'Ctrl / ⌘ + S saves your project. Tab moves between controls. Renaming a file does not change links to it. The file bin stays in your saved project and export.'),
    node('div', { className: 'editor-actions' },
      iconButton('save', 'Save', { id: 'save-project', className: 'retro primary', 'data-focus': 'save-project', disabled: state.busy || !isDirty(), onClick: () => perform(async () => { await saveProject(); state.notice = { type: 'success', text: 'Your project is saved on this computer.' }; }, 'code-editor') }),
      button([icon('play'), node('span', { id: 'preview-label' }, isDirty() ? 'Save & preview' : 'Preview')], { 'data-focus': 'preview-project', onClick: previewProject }),
      button([icon('download'), node('span', { id: 'export-label' }, isDirty() ? 'Save & export' : 'Export')], { onClick: () => exportProject(editor) }),
      button('Reopen saved', { 'data-focus': 'reopen-saved', onClick: reopenSavedProject }),
      button('Download draft', { 'data-focus': 'download-draft', onClick: downloadDraft }),
    ),
    node('div', { className: 'install-panel' },
      node('div', { className: 'install-explainer' },
        node('h3', {}, 'Give it a place on your desktop.'),
        node('p', {}, 'Install a named version with its own copy of these files. Editing this project later will leave your installed app as it is.'),
      ),
      node('form', { className: 'install-form', onSubmit: installProject },
        node('label', {}, 'Version', node('input', { type: 'text', value: editor.version, placeholder: '1.0.0', required: '', maxlength: '64', disabled: state.busy, autocomplete: 'off', 'data-focus': 'install-version', 'aria-describedby': 'permissions-note', onInput: event => { editor.version = event.target.value; } })),
        button([icon('rocket'), node('span', { id: 'install-label' }, isDirty() ? 'Save & install' : 'Install app')], { type: 'submit', className: 'retro primary', 'data-focus': 'install-app' }),
      ),
    ),
    node('p', { id: 'permissions-note', className: 'permission-note' }, 'Use a version like 1.0.0. Permissions: none. Each installed version keeps its own copy of your files.'),
    installed ? node('div', { className: 'button-row installed-actions' },
      iconButton('rocket', `Open installed v${installed.currentVersion}`, { 'data-focus': 'installed-app-button', onClick: () => launchApp(installed) }),
      iconButton('home', 'Go to desktop', { onClick: () => navigate('home') }),
    ) : null,
  );
}
function playGame(game) {
  perform(async () => {
    const { url, progress } = await api(`/api/games/${game.id}/launch`);
    state.run = { kind: 'game', gameId: game.id, title: game.name, url: checkedRunnerUrl(url), progress, returnTo: 'play' };
    state.route = 'run'; state.minimized = false; state.start = false;
  }, 'view-heading');
}
function copyGame(game) {
  perform(async () => {
    if (!await maySwitchProject()) return;
    const { project } = await api(`/api/games/${game.id}/remix`, { method: 'POST', body: {} });
    useProject(project);
    state.browserProject = project; state.folder = 'project'; state.editor.file = 'script.js'; state.route = 'make';
    await refreshCatalogs();
    state.notice = { type: 'success', text: `Copied ${game.name} to My Stuff. Open script.js to change colors or game settings.` };
  }, 'view-heading');
}
function playView() {
  return node('div', {}, heading('Your little arcade.'),
    node('p', { className: 'sub' }, 'Pick an adventure. Beat your own best.'),
    node('div', { className: 'game-catalog' }, state.games.map(game => node('article', { className: 'game-card' },
      node('div', { className: `game-poster ${game.kind}`, 'aria-hidden': 'true' },
        node('span', { className: 'poster-moon' }), node('span', { className: 'poster-road' }),
        node('span', { className: 'poster-player' }), node('span', { className: 'poster-star' }, '✦'),
      ),
      node('div', { className: 'game-card-body' }, node('h3', {}, game.name), node('p', {}, game.description),
        node('p', { className: 'game-record' }, game.progress.rounds ? `Best ${game.progress.best} · ${game.progress.rounds} ${game.progress.rounds === 1 ? 'run' : 'runs'} · ${game.progress.wins} finished` : 'A fresh adventure'),
        node('div', { className: 'button-row' },
          iconButton('play', 'Play', { className: 'retro primary', 'aria-label': `Play ${game.name}`, onClick: () => playGame(game) }),
          iconButton('stuff', 'Copy to My Stuff', { className: 'retro small', 'aria-label': `Copy ${game.name} to My Stuff`, onClick: () => copyGame(game) }),
        ),
        node('p', { className: 'game-controls-note' }, `${game.controls} · On-screen buttons too`),
        node('details', { className: 'game-help' }, node('summary', {}, 'How to play'),
          node('p', {}, game.kind === 'moon' ? 'Hop over each moon rock and collect the stars above it. You can jump again after landing.' : 'Choose one of three lanes. Move away from orange cones and toward golden stars.'),
          node('p', {}, 'Reach the end of a 40-second round for a 50-point finish bonus. Stars add 10 points each. P pauses; leaving the game pauses it too.'),
          node('p', {}, 'Copy to My Stuff opens editable settings for your own remix. Change playerColor or speed, save, preview, and install a new version. Your original game and scores stay here.'),
        ),
      ),
    ))),
    node('p', { className: 'permission-note' }, 'Scores save on this computer. Copy a game to My Stuff to change its source; the original stays yours to play.'),
    node('section', { className: 'desktop-games', 'aria-label': 'More games' },
      node('h3', {}, 'More to play'), nativeNote(),
      node('div', { className: 'game-catalog' }, NATIVE_APPS.filter(app => app.game).map(nativeGameCard)),
    ),
  );
}
function gameView(run) {
  return node('div', { className: 'game-player-view' },
    node('h2', { className: 'visually-hidden', tabindex: '-1', 'data-focus': 'view-heading' }, run.title),
    node('iframe', { className: 'app-frame game-frame', title: run.title, src: run.url, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', allow: '',
      onLoad: event => event.currentTarget.contentWindow.postMessage({ type: 'kidos:game-state', best: run.progress.best }, '*'),
    }),
  );
}
function futureView(area) {
  const details = {
    library: 'Adding your own books, movies, music, and photos is coming soon.',
    explore: 'A collection of places to learn and explore is coming soon.',
    mail: 'Family messages are coming soon.',
  };
  return node('div', {}, dirtyCallout(),
    node('div', { className: 'empty-state' },
      node('span', { className: 'icon-box' }, icon(area)),
      node('p', { className: 'future-banner' }, 'Still to come'),
      heading(areas[area].intro),
      node('p', {}, areas[area].description),
      node('p', {}, details[area]),
      iconButton('home', 'Back to desktop', { onClick: () => navigate('home') }),
    ),
  );
}
function runView(run) {
  if (run.kind === 'game') return gameView(run);
  const installed = run.kind === 'installed';
  const app = installed ? state.apps.find(item => item.id === run.appId) : null;
  const versionSelect = app ? node('label', {}, 'Version', node('select', { disabled: state.busy, 'data-focus': 'launch-version', onChange: event => launchApp(app, event.target.value, run.returnTo) }, app.versions.map(version => node('option', { value: version.version, ...(version.version === run.version ? { selected: '' } : {}) }, `v${version.version}${version.version === app.currentVersion ? ' · desktop default' : ''}`)))) : null;
  return node('div', { className: 'app-player-view' },
    node('h2', { className: 'visually-hidden', tabindex: '-1', 'data-focus': 'view-heading' }, run.title),
    node('iframe', {
      className: 'app-frame', title: `${installed ? 'Installed app' : 'Project preview'}: ${run.title}${installed ? ` version ${run.version}` : ''}`,
      src: run.url, sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', allow: '',
    }),
    node('details', { className: 'app-details' },
      node('summary', {}, installed ? `About this version · v${run.version}` : `About this preview · revision ${run.revision}`),
      versionSelect,
      node('p', { className: 'run-facts' }, installed
        ? `Permissions: none · Installed ${dateLabel(run.details?.installedAt)}${run.details?.sourceRevision ? ` · Source revision ${run.details.sourceRevision}` : ''}. Source edits do not change this copy.`
        : 'Preview uses a saved snapshot. App progress is not persisted yet.'),
      installed && run.details?.digest ? node('p', { className: 'run-facts' }, `Snapshot: ${run.details.digest}`) : null,
    ),
  );
}
function areaTile(area) {
  return button([node('span', { className: 'icon-box' }, icon(area === 'apps' ? 'blocks' : area)), node('span', { className: 'label' }, areas[area].name)], {
    className: 'app-icon', 'data-area': area, 'data-focus': `nav-${area}`, ...(state.route === area ? { 'aria-current': 'page' } : {}), onClick: () => { if (area === 'stuff') openFolder('home'); else navigate(area); },
  });
}
function installedTile(app) {
  return button([node('span', { className: 'icon-box' }, icon('rocket')), node('span', { className: 'label' }, app.name)], {
    className: 'app-icon installed-shortcut', 'data-focus': `launch-${app.id}`, title: `${app.name} · v${app.currentVersion}`,
    'aria-label': `Open ${app.name}, version ${app.currentVersion}`, onClick: () => launchApp(app),
  });
}
function appearanceView() {
  return node('div', {}, heading('Make yourself at home.'), node('p', { className: 'sub' }, 'Pick a color for your corner of the universe.'),
    node('div', { className: 'wallpaper-options' }, wallpapers.map(value => button([
      node('span', { className: `wallpaper-sample ${value}`, 'aria-hidden': 'true' }, 'kidOS ▰'),
      node('strong', {}, { teal: 'Lagoon', plum: 'Grape soda', night: 'Space camp' }[value]),
    ], { className: 'wallpaper-choice', 'aria-pressed': state.wallpaper === value, onClick: () => {
      state.wallpaper = value;
      try { localStorage.setItem('kidos.wallpaper', value); } catch {}
      render();
    } }))),
    node('p', { className: 'permission-note' }, 'Your wallpaper stays on this browser.'),
  );
}
function windowTitle(route = state.route, run = state.run) {
  if (route === 'library') return library.title();
  if (route === 'mail') return mailbox.title();
  if (route === 'explore') return explore.title();
  if (route === 'run') return run.kind === 'installed' ? `${run.title} · v${run.version}` : run.kind === 'preview' ? `${run.title} — Preview` : run.title;
  if (route === 'make') return state.makeView === 'new' ? 'New project' : `${state.editor?.file || 'Project'} — Code Editor`;
  return areas[route]?.name || 'kidOS';
}
function selectContext(element) {
  const record = element && windows?.get(element.dataset.windowId);
  state.route = record?.route || 'home';
  if (record?.run) state.run = record.run;
}
function activeWindow() { return windows?.list().find(record => record.active); }
function pauseWindow(record) {
  if (record.route === 'library') library.pause();
  if (record.run?.kind === 'game') record.element.querySelector('.game-frame')?.contentWindow.postMessage({ type: 'kidos:game-visibility', hidden: true }, '*');
}
function showDesktop() {
  for (const record of windows.list()) if (!record.minimized) windows.minimize(record.id);
  state.start = false; toggleStart(false, false);
  state.route = 'home';
  desk.focus();
}
async function beforeCloseWindow(record) {
  if (state.busy) return false;
  if (record.route === 'make' && state.editor && isDirty()) {
    selectContext(record.element);
    let allowed = false;
    await perform(async () => { allowed = await maySwitchProject('Before you close Code Editor'); });
    if (!allowed) return false;
  }
  if (record.route === 'make') { state.editor = null; state.makeView = 'new'; }
  if (record.route === 'mail' && !await mailbox.beforeClose()) return false;
  if (record.route === 'explore') explore.leave();
  if (record.route === 'library') library.leave();
  pauseWindow(record);
  state.start = false;
  return true;
}
function fileBack() {
  if (state.folder === 'project') openFolder('projects');
  else if (state.folder !== 'home') openFolder('home');
  else navigate('home');
}
function contentView(route, run) {
  return route === 'mail' ? mailbox.view() : route === 'explore' ? explore.view() : route === 'run' ? runView(run) : route === 'library' ? library.view() : route === 'stuff' ? stuffView() : route === 'appearance' ? appearanceView() : route === 'play' ? playView() : route === 'make' ? state.makeView === 'editor' && state.editor ? editorView() : newProjectView() : futureView(route);
}
function windowId() {
  if (state.route !== 'run') return state.route;
  const run = state.run;
  return run.kind === 'game' ? `game:${run.gameId}` : run.kind === 'installed' ? `app:${run.appId}:${run.version}` : `preview:${run.url}`;
}
function createWindow(id) {
  const route = state.route, run = route === 'run' ? state.run : null;
  const titlebar = node('div', { className: 'titlebar', tabindex: '0' }, node('span', { className: 'window-title' }, windowTitle(route, run)));
  // Managed controls stay usable independently of the API operation lock.
  const control = (label, text) => node('button', { type: 'button', className: 'retro', 'aria-label': label }, text);
  const minimizeButton = control('Minimize window', '−');
  const maximizeButton = control('Maximize window', '□');
  const closeButton = control('Close window', icon('close'));
  titlebar.append(node('div', { className: 'window-buttons' }, minimizeButton, maximizeButton, closeButton));
  const element = node('section', { className: `window${route === 'stuff' ? ' files-window' : ''}`, 'aria-label': windowTitle(route, run), 'data-route': route }, titlebar,
    node('div', { className: 'window-tools' },
      iconButton('back', 'Back', { className: 'retro small', onClick: () => {
        if (run) navigate(run.returnTo || 'home');
        else if (route === 'library' && library.isViewing()) library.back();
        else if (route === 'explore' && explore.isViewing()) explore.back();
        else if (route === 'stuff') fileBack();
        else if (route === 'make' && state.editor && state.makeView === 'editor') browseProject(state.editor.id);
        else if (route === 'make') openFolder('projects');
        else navigate('home');
      } }),
      iconButton('home', 'Desktop', { className: 'retro small', 'data-shell-control': '', onClick: showDesktop }),
      node('span', {}, route === 'make' ? 'My Stuff / Projects' : run ? 'Applications' : 'This computer'),
    ),
    node('div', { className: 'window-content' }), node('div', { className: 'window-foot' }, 'kidOS'),
  );
  const taskButton = node('button', { type: 'button', className: 'retro task-current' }, node('span', {}, windowTitle(route, run)));
  workspace.append(element); tasks.append(taskButton);
  return windows.register({ id, route, run, title: windowTitle(route, run), element, titlebar, taskButton, minimizeButton, maximizeButton, closeButton });
}
function toggleStart(open = !state.start, focus = true) {
  state.start = open;
  const menu = document.getElementById('start-menu');
  const start = document.getElementById('start-button');
  if (!menu || !start) return;
  menu.hidden = !open;
  start.setAttribute('aria-expanded', String(open));
  if (focus) { if (open) menu.querySelector('button')?.focus(); else start.focus(); }
}
function setMode(value) {
  if (!modes.includes(value)) return;
  state.mode = value;
  root.dataset.mode = value;
  windows.setMode(value);
  shortcutLayout?.layout();
  try { localStorage.setItem('kidos.layout', value); } catch { /* Preference is optional; projects use disk storage. */ }
}
function clockText() {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
}
function taskbar() {
  return node('footer', { className: 'taskbar' },
    node('nav', { id: 'start-menu', className: 'start-menu', hidden: !state.start, 'aria-label': 'Start menu' },
      node('div', { className: 'start-strip', 'aria-hidden': 'true' }, 'kidOS'),
      iconButton('home', 'Desktop', { className: 'menu-item', 'data-shell-control': '', onClick: showDesktop }),
      desktopPlaces.map(area => iconButton(area === 'apps' ? 'blocks' : area, areas[area].name, { className: 'menu-item', onClick: () => { if (area === 'stuff') openFolder('home'); else navigate(area); } })),
      node('hr', { className: 'menu-rule' }),
      NATIVE_APPS.filter(app => !app.folderOnly && app.id !== 'puttzoo').map(app => button([icon(app.icon), nativeLabel(app.name)], { className: 'menu-item', ...nativeAttributes(app) })),
      state.apps.length ? node('hr', { className: 'menu-rule' }) : null,
      state.apps.map(app => iconButton('rocket', app.name, { className: 'menu-item', onClick: () => launchApp(app) })),
      node('hr', { className: 'menu-rule' }),
      iconButton('make', 'Personalize', { className: 'menu-item', onClick: () => navigate('appearance') }),
    ),
    iconButton('blocks', 'Start', { id: 'start-button', className: 'retro start-button', 'data-focus': 'start', 'aria-expanded': state.start, 'aria-controls': 'start-menu', 'data-shell-control': '', onClick: () => toggleStart() }),
    node('nav', { className: 'window-tasks', 'aria-label': 'Open windows' }),
    button('▱', { className: 'retro show-desktop', title: 'Show desktop', 'aria-label': 'Show desktop', 'data-shell-control': '', onClick: showDesktop }),
    node('label', { className: 'mode-control' }, node('span', {}, 'Screen'), node('select', { 'aria-label': 'Layout', 'data-focus': 'layout', 'data-shell-control': '', onChange: event => setMode(event.target.value) }, modes.map(mode => node('option', { value: mode, ...(mode === state.mode ? { selected: '' } : {}) }, mode === 'tv' ? 'TV' : mode[0].toUpperCase() + mode.slice(1))))),
    node('div', { className: 'tray', title: state.connected ? 'Connected to this computer' : 'Local service unavailable' }, node('span', { className: `status-dot${state.connected ? '' : ' offline'}`, 'aria-hidden': 'true' }), node('time', { id: 'desktop-clock', title: new Date().toLocaleDateString(undefined, { dateStyle: 'full' }) }, clockText())),
  );
}
function noticeView(notice, recovery = false) {
  return node('div', { className: `notice ${recovery ? 'recovery-notice' : notice.type}`, role: notice.type === 'error' ? 'alert' : 'status' },
    node('p', {}, notice.text),
    notice.type === 'error' && notice.source !== 'native' ? button('Retry local service', { className: 'retro small', onClick: () => perform(async () => { await readSession(); await refreshCatalogs(); state.notice = { type: 'success', text: 'Connected to the local service. Your open project is still here.' }; }) }) : null,
    button(icon('close'), { disabled: false, 'aria-label': recovery ? 'Dismiss recovery notice' : 'Dismiss message', onClick: event => { if (recovery) state.recoveryNotice = null; else state.notice = null; event.currentTarget.closest('.notice').remove(); } }),
  );
}
const noticeDeadlines = new WeakMap();
let noticeTimer;
function renderNotices() {
  clearTimeout(noticeTimer);
  const notice = state.notice;
  // A rerender must not restart a confirmation's lifetime. Errors and recovery
  // notices remain until dismissed; a timer can never dismiss a newer message.
  if (notice?.type === 'success') {
    if (!noticeDeadlines.has(notice)) noticeDeadlines.set(notice, Date.now() + 5000);
    const remaining = noticeDeadlines.get(notice) - Date.now();
    if (remaining <= 0) state.notice = null;
    else noticeTimer = setTimeout(() => {
      if (state.notice === notice) state.notice = null;
      renderNotices();
    }, remaining);
  }
  notices.replaceChildren(...(state.recoveryNotice ? [noticeView({ text: state.recoveryNotice }, true)] : []), ...(state.notice ? [noticeView(state.notice)] : []));
}
let desk, workspace, tasks, shortcuts, notices, windows, recoveryBanner, shortcutLayout;
let workspaceSync;
let recoveryStatus = { ready: false, pending: false, error: '', conflict: false };
let restoringWorkspace = false;
function setupDesktop() {
  notices = node('div', { className: 'desktop-notices' });
  shortcuts = node('nav', { className: 'desktop-apps', 'aria-label': 'Desktop shortcuts' });
  workspace = node('div', { className: 'window-workspace' });
  desk = node('main', { className: 'desk', 'aria-label': 'kidOS desktop', tabindex: '-1', 'data-focus': 'desktop-heading' }, shortcuts, workspace);
  const bar = taskbar(); tasks = bar.querySelector('.window-tasks');
  recoveryBanner = node('div', { className: 'workspace-recovery-banner', hidden: true });
  root.replaceChildren(notices, recoveryBanner, desk, bar);
  shortcutLayout = createShortcutLayout({ container: shortcuts, fallback: document.getElementById('start-button') });
  windows = createWindowManager({ workspace,
    onActivate: record => { root.classList.toggle('has-window', Boolean(record)); },
    onChange: records => {
      for (const record of records) {
        if (record.element.hidden && !record.wasHidden) pauseWindow(record);
        record.wasHidden = record.element.hidden;
      }
      workspaceSync?.schedule();
    },
    onMinimize: pauseWindow,
    onClose: beforeCloseWindow,
  });
  windows.setMode(state.mode);
}
function render(requestedFocus) {
  if (!windows) setupDesktop();
  const active = document.activeElement;
  const remembered = active?.dataset?.focus;
  const oldCode = document.getElementById('code-editor');
  const codeSelection = oldCode ? { project: oldCode.dataset.project, file: oldCode.dataset.file, start: oldCode.selectionStart, end: oldCode.selectionEnd, top: oldCode.scrollTop, left: oldCode.scrollLeft } : null;
  const selection = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ? { start: active.selectionStart, end: active.selectionEnd, scrollTop: active.scrollTop, scrollLeft: active.scrollLeft } : null;
  root.dataset.mode = state.mode; root.dataset.wallpaper = state.wallpaper;
  root.setAttribute('aria-busy', String(state.busy));
  root.querySelector('.status-dot')?.classList.toggle('offline', !state.connected);
  root.querySelector('.tray')?.setAttribute('title', state.connected ? 'Connected to this computer' : 'Local service unavailable');
  renderNotices();
  const order = state.mode === 'tv' ? ['library', 'play', 'explore', 'stuff', 'apps', 'mail'] : desktopPlaces;
  shortcuts.replaceChildren(...order.map(areaTile), ...NATIVE_APPS.filter(app => app.shortcut).map(nativeTile), ...state.apps.map(installedTile));
  shortcutLayout.layout();
  // Refresh the menu without replacing the taskbar or any mounted window.
  const replacementMenu = taskbar().querySelector('#start-menu');
  document.getElementById('start-menu').replaceWith(replacementMenu);
  toggleStart(state.start, false);
  let record;
  if (state.route !== 'home') {
    const id = windowId();
    if (!windows.get(id) && windows.list().length >= 24) {
      state.notice = { type: 'error', text: 'You have 24 windows open. Close one before opening another.' };
      notices.append(noticeView(state.notice)); return;
    }
    record = windows.get(id) || createWindow(id);
    const container = record.element.querySelector('.window-content');
    // A connected iframe must never be detached just to refresh shell chrome.
    if (record.route !== 'run' || !container.firstChild) {
      const content = contentView(record.route, record.run);
      if (container.firstChild !== content) container.replaceChildren(content);
    }
    if (record.route === 'make') record.editor = state.editor;
    windows.updateTitle(id, windowTitle(record.route, record.run));
    record.element.querySelector('.window-title').textContent = windowTitle(record.route, record.run);
    record.taskButton.querySelector('span').textContent = windowTitle(record.route, record.run);
    record.element.querySelector('.window-foot').textContent = record.route === 'make' && state.editor ? `My Stuff / Projects / ${state.editor.name}` : 'kidOS';
    if (!restoringWorkspace && (requestedFocus || !activeWindow())) windows.activate(id);
  }
  // Saving/switching/trashing a document also refreshes a background Editor.
  // Its controls must never retain closures for a different project object.
  const editorWindow = windows.get('make');
  if (editorWindow && record !== editorWindow && editorWindow.editor !== state.editor) {
    editorWindow.element.querySelector('.window-content').replaceChildren(state.editor && state.makeView === 'editor' ? editorView() : newProjectView());
    editorWindow.editor = state.editor;
    const title = windowTitle('make');
    windows.updateTitle('make', title);
    editorWindow.element.querySelector('.window-title').textContent = title;
    editorWindow.taskButton.querySelector('span').textContent = title;
    editorWindow.element.querySelector('.window-foot').textContent = state.editor ? `My Stuff / Projects / ${state.editor.name}` : 'kidOS';
  }
  const newCode = document.getElementById('code-editor');
  if (newCode && codeSelection && newCode.dataset.project === codeSelection.project && newCode.dataset.file === codeSelection.file) {
    newCode.setSelectionRange(codeSelection.start, codeSelection.end); newCode.scrollTop = codeSelection.top; newCode.scrollLeft = codeSelection.left;
  }
  const focusKey = requestedFocus || remembered;
  const scope = requestedFocus ? record?.element || root : active?.closest('[data-window-id]') || root;
  const target = [...scope.querySelectorAll('[data-focus]')].find(element => element.dataset.focus === focusKey);
  if (target && !target.closest('[hidden]') && (!state.busy || requestedFocus)) {
    target.focus({ preventScroll: !requestedFocus });
    if (!requestedFocus && selection && target instanceof HTMLTextAreaElement) {
      target.setSelectionRange(selection.start, selection.end); target.scrollTop = selection.scrollTop; target.scrollLeft = selection.scrollLeft;
    } else if (!requestedFocus && selection && target instanceof HTMLInputElement && selection.start !== null) target.setSelectionRange(selection.start, selection.end);
  }
  updateRecoveryStatus(recoveryStatus);
  updateNativeUI();
  workspaceSync?.schedule();
}

function workspaceSnapshot() {
  const layout = windows.snapshot();
  const entries = [];
  for (const geometry of layout.entries) {
    const record = windows.get(geometry.id);
    if (record.route === 'run') {
      const run = record.run;
      if (run.kind === 'preview') continue; // Temporary URLs expire; never persist capabilities.
      entries.push({ ...geometry, kind: run.kind, ...(run.kind === 'installed' ? { appId: run.appId, version: run.version } : { gameId: run.gameId }) });
    } else {
      const toolState = record.route === 'stuff' ? { folder: state.folder, projectId: state.folder === 'project' ? state.browserProject?.id || null : null }
        : record.route === 'make' ? { projectId: state.makeView === 'editor' ? state.editor?.id || null : null, file: state.makeView === 'editor' ? state.editor?.file || null : null }
        : record.route === 'library' ? library.snapshot() : record.route === 'explore' ? explore.snapshot() : {};
      entries.push({ ...geometry, kind: 'tool', route: record.route, state: toolState });
    }
  }
  const editor = state.editor;
  return {
    windows: entries, activeId: entries.some(entry => entry.id === layout.activeId) ? layout.activeId : null,
    editorDraft: isDirty() ? { projectId: editor.id, baseRevision: editor.revision, name: editor.name, files: { ...editor.files }, file: editor.file, version: editor.version } : null,
  };
}
function recoveryText() {
  if (!recoveryStatus.ready || recoveryStatus.error) return 'Recovery copy unavailable · Save or download your draft.';
  if (recoveryStatus.pending) return isDirty() ? 'Saving a recovery copy…' : 'Saving your workspace…';
  return isDirty() ? 'Recovery copy saved · use Save to update the project.' : 'Workspace saved on this computer.';
}
function updateRecoveryStatus(status) {
  recoveryStatus = status;
  document.querySelectorAll('[data-recovery-status]').forEach(element => { element.textContent = recoveryText(); });
  if (!recoveryBanner) return;
  const text = status.error;
  recoveryBanner.hidden = !text;
  // Ordinary successful writes never rebuild the live workspace or move focus.
  if (text && recoveryBanner.dataset.error !== text) {
    recoveryBanner.dataset.error = text;
    recoveryBanner.replaceChildren(node('div', { className: 'notice error', role: 'alert' },
      node('p', {}, text),
      status.ready && !status.conflict ? button('Retry workspace save', { disabled: false, 'data-shell-control': '', className: 'retro small', onClick: () => { void workspaceSync.retry(); } }) : null,
      state.editor ? button('Download draft', { disabled: false, 'data-shell-control': '', className: 'retro small', onClick: downloadDraft }) : null,
    ));
  }
  if (!text) recoveryBanner.dataset.error = '';
}
function downloadDraft() {
  const editor = state.editor;
  if (!editor) return;
  const value = { format: 'kidos-recovery-draft', version: 1, projectId: editor.id, baseRevision: editor.revision, name: editor.name, files: editor.files };
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = node('a', { href: url, download: 'kidos-recovery-draft.json' });
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function restoreWorkspace() {
  const { workspace: saved } = await api('/api/workspace');
  const warnings = [];
  restoringWorkspace = true; root.inert = true;
  const mountRestored = () => {
    const busy = state.busy; state.busy = false;
    try { render(); } finally { state.busy = busy; root.setAttribute('aria-busy', String(busy)); }
  };
  try {
    // Recover source text separately from geometry. Keep the original base
    // revision when its source changed elsewhere; normal Save then fails safely.
    const draft = saved.editorDraft;
    if (draft) {
      let project;
      try { ({ project } = await api(`/api/projects/${encodeURIComponent(draft.projectId)}`)); }
      catch (error) {
        if (![404, 409].includes(error.status)) throw error;
        project = { id: draft.projectId, name: '', files: {}, revision: draft.baseRevision };
        warnings.push('The recovered project is unavailable or in Trash. Download its draft before closing, or restore the project in My Stuff.');
      }
      useProject(project);
      const same = draft.name === project.name && Object.keys(draft.files).length === Object.keys(project.files).length && Object.keys(draft.files).every(file => draft.files[file] === project.files[file]);
      if (!same) {
        state.editor.name = draft.name; state.editor.files = { ...draft.files }; state.editor.revision = draft.baseRevision;
        warnings.push(project.revision !== draft.baseRevision ? 'Recovered edits keep their original revision because the saved project changed elsewhere. Download the draft before reopening the latest source.' : 'Recovered your unsaved edits. Use Save to update the project.');
      }
      state.editor.file = draft.file; state.editor.version = draft.version;
    }
    const reserveDraftWindow = draft && !saved.windows.some(entry => entry.id === 'make');
    for (const entry of saved.windows) {
      if (reserveDraftWindow && windows.list().length >= 23) {
        warnings.push('One window was left closed to make room for your recovered editor.');
        break;
      }
      if (entry.kind === 'installed') {
        const app = state.apps.find(item => item.id === entry.appId);
        if (!app?.versions.some(item => item.version === entry.version)) { warnings.push('An unavailable installed app was left closed.'); continue; }
        const { url } = await api(`/api/apps/${encodeURIComponent(app.id)}/launch?version=${encodeURIComponent(entry.version)}`);
        state.run = { kind: 'installed', title: app.name, appId: app.id, version: entry.version, url: checkedRunnerUrl(url), returnTo: 'home', details: app.versions.find(item => item.version === entry.version) };
        state.route = 'run';
      } else if (entry.kind === 'game') {
        const game = state.games.find(item => item.id === entry.gameId);
        if (!game) { warnings.push('An unavailable game was left closed.'); continue; }
        const { url, progress } = await api(`/api/games/${game.id}/launch`);
        state.run = { kind: 'game', gameId: game.id, title: game.name, url: checkedRunnerUrl(url), progress, returnTo: 'play' }; state.route = 'run';
      } else {
        if (entry.route === 'stuff') {
          state.folder = entry.state.folder;
          if (state.folder === 'project') {
            if (state.projects.some(project => project.id === entry.state.projectId)) state.browserProject = (await api(`/api/projects/${encodeURIComponent(entry.state.projectId)}`)).project;
            else { state.folder = 'projects'; state.browserProject = null; warnings.push('An unavailable project folder was left closed.'); }
          }
        }
        if (entry.route === 'make') {
          if (!draft && entry.state.projectId && state.projects.some(project => project.id === entry.state.projectId)) {
            useProject((await api(`/api/projects/${encodeURIComponent(entry.state.projectId)}`)).project);
            if (Object.hasOwn(state.editor.files, entry.state.file)) state.editor.file = entry.state.file;
          }
          state.makeView = state.editor ? 'editor' : 'new';
        }
        if (entry.route === 'explore' && entry.state.siteId) await explore.restore(entry.state.siteId);
        if (entry.route === 'library' && entry.state.mediaId && !await library.restore(entry.state.mediaId)) warnings.push('An unavailable Library item was left closed.');
        state.route = entry.route;
      }
      mountRestored();
    }
    // An unsaved document can outlive its former tool view. Always expose it.
    if (draft && !windows.get('make')) { state.makeView = 'editor'; state.route = 'make'; mountRestored(); }
    windows.restoreLayout({ entries: saved.windows, activeId: saved.activeId });
    if (draft && !saved.windows.some(entry => entry.id === 'make')) windows.activate('make');
    const active = activeWindow();
    state.route = active?.route || 'home'; if (active?.run) state.run = active.run;
    active?.titlebar.focus({ preventScroll: true });
    if (warnings.length) state.notice = { type: 'success', text: [...new Set(warnings)].join(' ') };
    workspaceSync.start(saved);
  } finally { restoringWorkspace = false; root.inert = false; }
}

function moveSpatialFocus(event, scope) {
  const current = event.target.closest('button,a');
  if (!current) {
    const firstScope = scope === root ? root.querySelector('.window:not([hidden]) .window-content') || root : scope;
    const first = [...firstScope.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not([readonly])')].find(element => element.getClientRects().length);
    if (first) { event.preventDefault(); first.focus(); }
    return;
  }
  const rect = current.getBoundingClientRect();
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
  const sign = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
  const candidates = [...scope.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not([readonly])')]
    .filter(element => element !== current && element.getClientRects().length)
    .map(element => { const r = element.getBoundingClientRect(), dx = r.x + r.width / 2 - cx, dy = r.y + r.height / 2 - cy; return { element, forward: (vertical ? dy : dx) * sign, side: Math.abs(vertical ? dx : dy) }; })
    .filter(item => item.forward > 5)
    .sort((a, b) => (a.forward + a.side * 3) - (b.forward + b.side * 3));
  if (candidates.length) { event.preventDefault(); candidates[0].element.focus(); }
}

// Layout and Start toggles do not rebuild a running iframe or the editor.
document.addEventListener('pointerdown', event => {
  if (state.start && !event.target.closest('#start-menu, #start-button')) toggleStart(false, false);
});
document.addEventListener('keydown', event => {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    if (state.mode === 'tv' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) moveSpatialFocus(event, dialog);
    return;
  }
  if (event.ctrlKey && event.key === 'F6') {
    event.preventDefault(); windows.cycle(event.shiftKey ? -1 : 1); return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && state.editor && activeWindow()?.route === 'make') {
    if (state.busy) { event.preventDefault(); return; }
    selectContext(activeWindow().element);
    event.preventDefault();
    perform(async () => { await saveProject(); state.notice = { type: 'success', text: 'Your project is saved on this computer.' }; });
    return;
  }
  if (event.key === 'Escape') {
    if (state.start) { event.preventDefault(); toggleStart(false); }
    else if (activeWindow() && !event.target.matches('input,textarea,select,audio,video')) { event.preventDefault(); windows.minimize(activeWindow().id); }
    return;
  }
  if (state.mode !== 'tv' || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || event.target.matches('input,textarea,select,audio,video')) return;
  moveSpatialFocus(event, state.start ? document.getElementById('start-menu') : activeWindow()?.element || root);
});
window.addEventListener('beforeunload', event => {
  workspaceSync.schedule(); void workspaceSync.flush();
  if ((isDirty() && !workspaceSync.matchesCurrent()) || workspaceSync.hasPending() || library.hasPending()) { event.preventDefault(); event.returnValue = ''; }
});
const mailbox = createMailbox({ node, button, icon, api, perform, render: focus => { state.route = 'mail'; render(focus); } });
const explore = createExplore({ node, button, icon, api, perform, runnerOrigin: () => state.runnerOrigin, changed: () => workspaceSync?.schedule(), render: focus => { state.route = 'explore'; render(focus); } });
const library = createLibrary({ node, button, icon, api, perform,
  render: focus => { state.route = 'library'; render(focus); }, isBusy: () => state.busy });
const nativeApps = createNativeApps({ target: window, onChange: updateNativeUI });
workspaceSync = createWorkspaceSync({ api, snapshot: workspaceSnapshot, onStatus: updateRecoveryStatus });
document.addEventListener('visibilitychange', () => { if (document.hidden) { library.pause(); workspaceSync.schedule(); void workspaceSync.flush(); } });
render();
void nativeApps.refresh({ retry: true });
perform(async () => {
  try { await readSession(); await refreshCatalogs(); await restoreWorkspace(); }
  catch (error) {
    updateRecoveryStatus({ ready: false, pending: false, conflict: false, error: `Workspace recovery is unavailable: ${messageFrom(error)} Save or download any new edits before reloading.` });
    throw error;
  }
});

// Update the tray without rebuilding the editor or restarting an app.
setInterval(() => { const clock = document.getElementById('desktop-clock'); if (clock) { clock.textContent = clockText(); clock.title = new Date().toLocaleDateString(undefined, { dateStyle: 'full' }); } }, 15_000);

// Cross-origin frame-to-frame focus does not dispatch parent focusin/blur in
// every browser. Read only the parent's active element, never child contents.
// The small visible-page check lets the first click reach the app and raise it.
function trackFrameFocus() {
  if (document.hidden) return;
  const frame = document.activeElement;
  if (frame?.tagName !== 'IFRAME' || !frame.isConnected) return;
  const id = frame.closest('[data-window-id]')?.dataset.windowId;
  const record = id && windows.get(id);
  if (record && !record.active && !record.minimized && !record.element.hidden) windows.activate(id);
}
window.addEventListener('blur', () => setTimeout(trackFrameFocus, 0));
setInterval(trackFrameFocus, 100);
window.addEventListener('message', createGameBridge({
  resolveSource: source => {
    for (const record of windows.list()) {
      if (record.run?.kind !== 'game') continue;
      const frame = record.element.querySelector('.game-frame');
      if (frame?.isConnected && frame.contentWindow === source) return { frame, run: record.run };
    }
    return null;
  },
  save: async (id, result) => (await api(`/api/games/${id}/result`, { method: 'POST', body: result })).progress,
  onSaved: (id, progress) => {
    const game = state.games.find(item => item.id === id);
    if (game) game.progress = progress;
  },
}));
