const siteIds = ['science', 'space', 'nature', 'newspaper', 'workshop', 'personal'];

export function exploreSiteFromPath(path) {
  if (typeof path !== 'string') return null;
  const match = /^\/explore\/sites\/([a-z]+)\/(?:answer)?$/.exec(path);
  return match && siteIds.includes(match[1]) ? match[1] : null;
}

export function exploreLocation(event, frame) {
  const value = event.data;
  if (!frame || event.source !== frame.contentWindow || event.origin !== 'null' || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || value.type !== 'kidos:explore-location') return null;
  const siteId = exploreSiteFromPath(value.path);
  return siteId ? { siteId, path: value.path } : null;
}

export function exploreURL(origin, path) {
  const base = new URL(origin);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.origin !== origin || base.username || base.password) throw new Error('Explore needs the local kidOS web service.');
  if (typeof path !== 'string' || path.length > 1024 || !path.startsWith('/explore/') || path.startsWith('//') || /[\\\u0000-\u001f]/.test(path)) throw new Error('Choose a local Explore page.');
  const rawPath = path.split('?')[0];
  if (rawPath.includes('%') || rawPath.split('/').some(part => part === '.' || part === '..')) throw new Error('Choose a local Explore page.');
  const url = new URL(path, base);
  if (url.origin !== origin || url.hash || url.pathname.includes('%')) throw new Error('Choose a local Explore page.');
  if (exploreSiteFromPath(path) && path.endsWith('/')) return url.href;
  if (['/explore/api/moon', '/explore/api/prediction'].includes(path)) return url.href;
  if (url.pathname === '/explore/api/search' && url.searchParams.getAll('q').length <= 1 && [...url.searchParams.keys()].every(key => key === 'q')) return url.href;
  throw new Error('Choose a local Explore page.');
}

// Only requests explicitly sent by Explore are inspected. This does not claim
// to observe every iframe request or act as a browser-wide network monitor.
export async function inspectExploreRequest({ origin, path, method = 'GET', body, fetchImpl = globalThis.fetch }) {
  const url = exploreURL(origin, path);
  if (path === '/explore/api/prediction') {
    if (method !== 'POST' || !body || Object.keys(body).length !== 1 || !['evaporation', 'condensation'].includes(body.change)) throw new Error('Choose a prediction from the activity.');
  } else if (method !== 'GET' || body !== undefined) throw new Error('This Explore request uses GET.');
  const serialized = body === undefined ? null : JSON.stringify(body);
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(url, { method, ...(serialized ? { body: serialized, headers: { 'Content-Type': 'application/json' } } : {}), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
    const reader = response.body?.getReader();
    let text = '', bytes = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 32768) { await reader.cancel(); throw new Error('The local response was larger than this activity allows.'); }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    }
    return { url, method, requestBody: serialized, status: response.status, statusText: response.statusText, contentType: response.headers.get('content-type') || 'Not supplied', protocol: response.headers.get('x-kidos-request-protocol') || 'Not reported', milliseconds: Math.round(performance.now() - started), bytes, text };
  } finally { clearTimeout(timer); }
}
