import { readFile } from 'node:fs/promises';
import { SITES, MOON_FACTS } from '../../content/private-web/sites.mjs';

const stylesheet = await readFile(new URL('../../content/private-web/site.css', import.meta.url), 'utf8');
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const fail = (status, message) => Object.assign(new Error(message), { status });
const ids = new Set(SITES.map(site => site.id));
const MAX_BODY = 1024;
const permissions = 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), payment=(), display-capture=()';

export function exploreCatalog(query = '') {
  if (typeof query !== 'string' || query.length > 80 || /[\u0000-\u001f\u007f]/.test(query)) throw fail(400, 'Search using up to 80 ordinary characters.');
  const terms = query.toLocaleLowerCase('en').trim().split(/\s+/).filter(Boolean);
  return SITES.filter(site => {
    const words = `${site.name} ${site.category} ${site.description} ${site.title} ${site.paragraphs.join(' ')} ${site.activity}`.toLocaleLowerCase('en');
    return terms.every(term => words.includes(term));
  }).map(({ id, name, category, symbol, color, description, title }) => ({ id, name, category, symbol, color, description, title, path: `/explore/sites/${id}/` }));
}

async function readBody(req, expectedType) {
  if (req.headers['content-type']?.split(';')[0].trim() !== expectedType || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) throw fail(415, `Send ${expectedType} without compression.`);
  if (Number(req.headers['content-length']) > MAX_BODY) { req.resume(); throw fail(413, 'This activity accepts at most 1 KiB.'); }
  const chunks = []; let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > MAX_BODY) { req.resume(); throw fail(413, 'This activity accepts at most 1 KiB.'); }
    chunks.push(chunk);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw fail(400, 'Send UTF-8 text.'); }
}

function documentFor(site, result = null) {
  const answer = result === null ? '' : `<section class="answer" aria-label="Your answer"><p class="status">POST received · HTTP 200</p><h2>Your answer came back</h2><p>${escape(result)}</p><p class="hint">This response is not saved. Try another choice whenever you like.</p><a href="/explore/sites/${site.id}/">Back to the lesson</a></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(site.name)}</title><link rel="stylesheet" href="/explore/site.css"><script defer src="/explore/location.js"></script></head><body class="${site.color}"><header class="site-head"><span aria-hidden="true">${site.symbol}</span><a href="/explore/sites/${site.id}/">${escape(site.name)}</a><small>kidOS · a local website</small></header><main><p class="eyebrow">${escape(site.eyebrow)}</p><h1>${escape(site.title)}</h1>${answer}${site.paragraphs.map(paragraph => `<p>${escape(paragraph)}</p>`).join('')}<aside class="activity"><h2>Try a little wondering</h2><p>${escape(site.activity)}</p></aside><form method="post" action="/explore/sites/${site.id}/answer"><h2>Send an answer</h2><label for="choice">${escape(site.question)}</label><select id="choice" name="choice">${site.choices.map(([id, label]) => `<option value="${escape(id)}">${escape(label)}</option>`).join('')}</select><button type="submit">Send to this computer</button><p class="hint">A real HTTP form. Your choice stays on this computer and is not saved.</p></form><p class="source">${escape(site.source)}</p><nav class="related" aria-label="More local websites"><strong>Follow another question</strong>${site.related.map(id => { const related = SITES.find(entry => entry.id === id); return `<a href="/explore/sites/${id}/">${escape(related.name)} →</a>`; }).join('')}</nav><footer>Original kidOS learning pages · works offline · source notes are in the project’s content guide.</footer></main></body></html>`;
}

// This handler has no Store reference, filesystem-write operation, platform
// token, or child-code evaluator. Its only POST operations compute fixed replies.
export function createExploreHandler({ platformOrigin, runnerOrigin }) {
  let reading = 0;
  return async (req, res, url) => {
    const rawPath = req.url?.split('?')[0];
    if (!url.pathname.startsWith('/explore/') && !rawPath?.startsWith('/explore/')) return false;
    if (req.headers.host !== new URL(runnerOrigin).host) throw fail(403, 'Use the local kidOS address.');
    if (!rawPath?.startsWith('/explore/') || /[%\\\u0000-\u001f]/.test(rawPath) || rawPath.split('/').some(part => part === '.' || part === '..')) throw fail(400, 'Invalid Explore path.');
    const origin = req.headers.origin;
    const formMatch = /^\/explore\/sites\/([a-z]+)\/answer$/.exec(url.pathname);
    // Chromium sends Origin:null for assets loaded by these opaque frames.
    // Permit only the two fixed assets and nonpersistent lesson form replies;
    // this does not authorize the frame to fetch JSON or desktop capabilities.
    const frameAsset = req.method === 'GET' && ['/explore/site.css', '/explore/location.js'].includes(url.pathname);
    const frameRequest = origin === 'null' && (frameAsset || (formMatch && req.method === 'POST'));
    if (origin && origin !== platformOrigin && !frameRequest) throw fail(403, 'Open this activity from Explore.');
    if (origin === platformOrigin) {
      res.setHeader('Access-Control-Allow-Origin', platformOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type, X-kidos-request-protocol');
    }
    res.setHeader('X-kidos-request-protocol', `HTTP/${req.httpVersion}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', permissions);
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src ${runnerOrigin}; style-src ${runnerOrigin}; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action ${runnerOrigin}/explore/sites/; frame-ancestors ${platformOrigin}; sandbox allow-scripts allow-forms`);
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
      return true;
    };
    const onlyGet = () => { if (req.method !== 'GET') throw fail(405, 'Use GET to open this resource.'); };
    const noQuery = () => { if (url.search) throw fail(400, 'This activity does not accept address parameters.'); };
    if (req.method === 'OPTIONS') {
      if (url.pathname !== '/explore/api/prediction' || origin !== platformOrigin || req.headers['access-control-request-method'] !== 'POST' || req.headers['access-control-request-headers']?.toLowerCase() !== 'content-type') throw fail(403, 'This request is not part of the activity.');
      noQuery();
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return true;
    }
    if (url.pathname === '/explore/site.css') { onlyGet(); noQuery(); return send(200, stylesheet, 'text/css; charset=utf-8'); }
    if (url.pathname === '/explore/location.js') {
      onlyGet(); noQuery();
      return send(200, `parent.postMessage({type:'kidos:explore-location',path:location.pathname},${JSON.stringify(platformOrigin)});`, 'text/javascript; charset=utf-8');
    }
    if (url.pathname === '/explore/api/search') {
      onlyGet();
      if (url.search.length > 1024 || [...url.searchParams.keys()].some(key => key !== 'q') || url.searchParams.getAll('q').length > 1) throw fail(400, 'Search with one q parameter.');
      const query = url.searchParams.get('q') || '';
      return send(200, { query, sites: exploreCatalog(query), saved: false });
    }
    if (url.pathname === '/explore/api/moon') { onlyGet(); noQuery(); return send(200, MOON_FACTS); }
    if (url.pathname === '/explore/api/prediction') {
      noQuery();
      if (req.method !== 'POST') throw fail(405, 'Send a prediction with POST.');
      if (reading >= 8) throw fail(503, 'The activity is busy. Try again in a moment.');
      reading++;
      try {
        let input;
        try { input = JSON.parse(await readBody(req, 'application/json')); }
        catch (error) { if (error.status) throw error; throw fail(400, 'Send valid JSON.'); }
        if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).length !== 1 || !Object.hasOwn(input, 'change') || !['evaporation', 'condensation'].includes(input.change)) throw fail(400, 'Choose evaporation or condensation in the change field.');
        return send(200, { received: { change: input.change }, result: SITES[0].answers[input.change], saved: false });
      } finally { reading--; }
    }
    if (formMatch && ids.has(formMatch[1])) {
      noQuery();
      if (req.method !== 'POST') throw fail(405, 'Send an answer from the lesson form.');
      if (reading >= 8) throw fail(503, 'The activity is busy. Try again in a moment.');
      reading++;
      try {
        const site = SITES.find(entry => entry.id === formMatch[1]);
        const input = new URLSearchParams(await readBody(req, 'application/x-www-form-urlencoded'));
        if ([...input.keys()].length !== 1 || !Object.hasOwn(site.answers, input.get('choice'))) throw fail(400, 'Choose one of the answers on the page.');
        return send(200, documentFor(site, site.answers[input.get('choice')]), 'text/html; charset=utf-8');
      } finally { reading--; }
    }
    const pageMatch = /^\/explore\/sites\/([a-z]+)\/$/.exec(url.pathname);
    if (pageMatch && ids.has(pageMatch[1])) {
      onlyGet(); noQuery(); return send(200, documentFor(SITES.find(site => site.id === pageMatch[1])), 'text/html; charset=utf-8');
    }
    throw fail(404, 'That local page was not found. Return to Explore and choose a site.');
  };
}
