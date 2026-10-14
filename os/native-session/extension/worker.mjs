// Keep this URL in step with manifest.version so Chromium cannot reuse a
// previous same-path imported module after the fixed app catalog changes.
import { HOST_NAME, MAX_BYTES, SOURCE, APP_IDS, ERRORS, keys, validRequest, validSender, validResponse, failure } from './protocol.mjs?v=1.2.0';

export function responseFailure(response, request) {
  if (validResponse(response, request)) return null;
  if (keys(response, ['source', 'type', 'requestId', 'ok', 'error']) && response.source === SOURCE && response.type === 'response' && response.requestId === null && response.ok === false &&
      keys(response.error, ['code', 'message']) && response.error.code === 'invalid_request' && response.error.message === ERRORS.invalid_request) return 'host_rejected';
  if (request.method === 'listApps' && keys(response, ['source', 'type', 'requestId', 'ok', 'result']) && response.source === SOURCE && response.type === 'response' && response.requestId === request.requestId && response.ok === true &&
      keys(response.result, ['apps']) && Array.isArray(response.result.apps) && response.result.apps.every(app => typeof app?.id === 'string') &&
      (response.result.apps.length !== APP_IDS.length || response.result.apps.some((app, i) => app.id !== APP_IDS[i]))) return 'catalog_mismatch';
  return 'invalid_response';
}

export function registerWorker(api, { clock = Date.now, timeoutMs = 5000 } = {}) {
  let active = 0;
  const recent = [];
  api.runtime.onMessage.addListener((request, sender, reply) => {
    if (!validSender(sender, api.runtime.id) || !validRequest(request)) return false;
    if (new TextEncoder().encode(JSON.stringify(request)).length > MAX_BYTES) return false;
    const now = clock();
    while (recent.length && recent[0] < now - 10000) recent.shift();
    if (active >= 4 || recent.length >= 16) { reply(failure(request.requestId, 'busy')); return false; }
    recent.push(now); active++;
    let done = false;
    const finish = response => {
      if (done) return;
      done = true; active--; clearTimeout(timer);
      reply(response);
    };
    const timer = setTimeout(() => finish(failure(request.requestId, 'timeout')), timeoutMs);
    const envelope = { request, context: { origin: sender.origin, url: sender.url, frameId: sender.frameId } };
    try {
      api.runtime.sendNativeMessage(HOST_NAME, envelope, response => {
        const error = api.runtime.lastError;
        if (error) return finish(failure(request.requestId, 'unavailable'));
        let bounded = false;
        try { bounded = new TextEncoder().encode(JSON.stringify(response)).length <= MAX_BYTES; } catch {}
        const code = bounded ? responseFailure(response, request) : 'invalid_response';
        finish(code ? failure(request.requestId, code) : response);
      });
    } catch { finish(failure(request.requestId, 'unavailable')); }
    return true;
  });
}
if (globalThis.chrome?.runtime?.onMessage) registerWorker(globalThis.chrome);
