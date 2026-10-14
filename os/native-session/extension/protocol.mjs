export const ORIGIN = 'http://127.0.0.1:8787';
export const DOCUMENT_URL = `${ORIGIN}/`;
export const SOURCE = 'kidos-native-v1';
export const EXTENSION_ID = 'hmpnaimcljnkfhklmappjelokjmhdjce';
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`;
export const HOST_NAME = 'org.kidos.native_session';
export const MAX_BYTES = 4096;
export const APP_IDS = Object.freeze(['paint', 'writer', 'calculator', 'files', 'documents', 'downloads', 'trash', 'puttzoo', 'openttd', 'solitaire', 'minesweeper', 'pinball', 'puzzlebox']);
export const ERRORS = Object.freeze({
  invalid_request: 'The native application request was rejected.',
  host_rejected: 'The native application host rejected the desktop request.',
  invalid_response: 'The native application connection returned an unexpected response.',
  catalog_mismatch: 'The desktop and native application catalogs do not match.',
  unavailable: 'Native applications are not connected on this computer.',
  not_installed: 'This application is not installed or ready on this computer.',
  busy: 'Please wait before opening another native application.',
  launch_failed: 'The native application could not start.',
  timeout: 'The native application connection did not respond in time.',
});
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function keys(value, names) {
  return record(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
}
export const requestId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function validRequest(value) {
  if (!record(value) || !requestId(value.requestId) || value.source !== SOURCE || value.type !== 'request') return false;
  if (value.method === 'listApps') return keys(value, ['source', 'type', 'requestId', 'method']);
  return value.method === 'launch' && keys(value, ['source', 'type', 'requestId', 'method', 'appId']) && APP_IDS.includes(value.appId);
}
export function validSender(sender, runtimeId = EXTENSION_ID) {
  return sender?.id === runtimeId && runtimeId === EXTENSION_ID && sender.frameId === 0 && sender.origin === ORIGIN && sender.url === DOCUMENT_URL && Number.isSafeInteger(sender.tab?.id) && sender.tab.id >= 0 && sender.tab.url === DOCUMENT_URL;
}
export function validContext(value) {
  return keys(value, ['origin', 'url', 'frameId']) && value.origin === ORIGIN && value.url === DOCUMENT_URL && value.frameId === 0;
}
export function validNativeRequest(value) {
  return keys(value, ['request', 'context']) && validRequest(value.request) && validContext(value.context);
}
export function failure(id, code) {
  if (!Object.hasOwn(ERRORS, code)) code = 'unavailable';
  return { source: SOURCE, type: 'response', requestId: id, ok: false, error: { code, message: ERRORS[code] } };
}
export function success(id, result) { return { source: SOURCE, type: 'response', requestId: id, ok: true, result }; }
export function validResponse(value, request) {
  if (!record(value) || value.source !== SOURCE || value.type !== 'response' || value.requestId !== request.requestId) return false;
  if (value.ok === false) return keys(value, ['source', 'type', 'requestId', 'ok', 'error']) && keys(value.error, ['code', 'message']) && Object.hasOwn(ERRORS, value.error.code) && value.error.message === ERRORS[value.error.code];
  if (value.ok !== true || !keys(value, ['source', 'type', 'requestId', 'ok', 'result'])) return false;
  if (request.method === 'launch') return keys(value.result, ['appId', 'status']) && value.result.appId === request.appId && ['started', 'focused', 'already-running'].includes(value.result.status);
  if (!keys(value.result, ['apps']) || !Array.isArray(value.result.apps) || value.result.apps.length !== APP_IDS.length) return false;
  return value.result.apps.every((app, i) => record(app) && keys(app, ['id', 'name', 'available', ...(app.reason === undefined ? [] : ['reason'])]) && app.id === APP_IDS[i] && typeof app.name === 'string' && app.name.length > 0 && app.name.length <= 64 && typeof app.available === 'boolean' && (app.reason === undefined || ['not-installed', 'not-configured'].includes(app.reason)));
}
