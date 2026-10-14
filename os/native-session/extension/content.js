(() => {
  'use strict';
  const origin = 'http://127.0.0.1:8787';
  if (window !== window.top || location.href !== `${origin}/`) return;
  const ids = ['paint', 'writer', 'calculator', 'files', 'documents', 'downloads', 'trash', 'puttzoo', 'openttd', 'solitaire', 'minesweeper', 'pinball', 'puzzlebox'];
  let pending = 0;
  window.addEventListener('message', event => {
    if (window !== window.top || location.href !== `${origin}/` || event.source !== window || event.origin !== origin || pending >= 4) return;
    const r = event.data;
    if (!r || typeof r !== 'object' || Array.isArray(r) || r.source !== 'kidos-native-v1' || r.type !== 'request' || typeof r.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.requestId)) return;
    const names = ['source', 'type', 'requestId', 'method'];
    if (r.method === 'launch' && ids.includes(r.appId)) names.push('appId');
    else if (r.method !== 'listApps') return;
    if (Object.keys(r).sort().join(',') !== names.sort().join(',')) return;
    // Copy only the validated primitive fields across the isolated-world boundary.
    const request = { source: r.source, type: r.type, requestId: r.requestId, method: r.method, ...(r.method === 'launch' ? { appId: r.appId } : {}) };
    pending++;
    try {
      chrome.runtime.sendMessage(request, response => {
        pending--;
        if (chrome.runtime.lastError || !response || response.requestId !== request.requestId) return;
        if (window === window.top && location.href === `${origin}/`) window.postMessage(response, origin);
      });
    } catch { pending--; }
  });
})();
