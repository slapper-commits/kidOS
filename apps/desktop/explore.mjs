import { exploreLocation, exploreURL, inspectExploreRequest } from './explore-request.mjs';

export function createExplore({ node, button, icon, api, perform, render, runnerOrigin, changed = () => {} }) {
  const state = { sites: [], results: [], query: '', searched: false, selected: null, path: null, lab: false, choice: 'evaporation', example: 'moon', request: null, requesting: false, error: '' };
  let viewer = null, frame = null, labPanel = null, address = null, content = null, labButton = null;

  async function refresh() {
    const { sites } = await api('/api/explore');
    state.sites = sites;
    state.results = sites;
    state.searched = false;
  }
  function leave() {
    frame = null; viewer = null; labPanel = null; address = null; content = null; labButton = null;
    state.selected = null; state.path = null; state.lab = false; state.request = null; state.error = '';
  }
  function open(site) {
    leave(); state.selected = site.id; state.path = site.path;
    render('view-heading');
  }
  function updateLocation(event) {
    const location = exploreLocation(event, frame);
    if (!location) return;
    const site = state.sites.find(value => value.id === location.siteId);
    if (!site) return;
    state.selected = site.id; state.path = location.path;
    address.textContent = `${runnerOrigin()}${location.path}`;
    frame.title = `Local website: ${site.name}`;
    viewer.querySelector('[data-explore-title]').textContent = site.name;
    changed();
  }
  globalThis.addEventListener('message', updateLocation);

  async function search(event) {
    event.preventDefault();
    const query = state.query.trim();
    perform(async () => {
      const response = await inspectExploreRequest({ origin: runnerOrigin(), path: `/explore/api/search?${new URLSearchParams({ q: query })}` });
      if (response.status !== 200) throw new Error('Search could not finish. Try a shorter search.');
      const result = JSON.parse(response.text);
      state.results = result.sites; state.searched = true;
    }, 'explore-results');
  }
  function catalog() {
    return node('div', { className: 'explore-home' },
      node('div', { className: 'explore-intro' }, icon('explore'), node('div', {}, node('h2', { tabindex: '-1', 'data-focus': 'view-heading' }, 'Where shall we go?'), node('p', {}, 'Six little websites. A whole lot to wonder about.'))),
      node('form', { className: 'explore-search', onSubmit: search },
        node('label', {}, 'Search the local web', node('input', { type: 'search', maxlength: '80', value: state.query, placeholder: 'Try “Moon”, “flowers” or “HTML”', 'data-focus': 'explore-search', onInput: event => { state.query = event.target.value; } })),
        button('Search', { type: 'submit', className: 'retro primary' }),
        state.searched ? button('Show all', { onClick: () => { state.query = ''; state.results = state.sites; state.searched = false; render('explore-search'); } }) : null,
      ),
      node('p', { className: 'explore-count', role: 'status', tabindex: '-1', 'data-focus': 'explore-results' }, state.searched ? `${state.results.length} ${state.results.length === 1 ? 'place' : 'places'} found for “${state.query.trim()}”` : 'Made for this computer · available offline'),
      node('div', { className: 'explore-grid' }, state.results.map(site => button([
        node('span', { className: `explore-stamp ${site.color}`, 'aria-hidden': 'true' }, site.symbol),
        node('span', { className: 'explore-category' }, site.category), node('strong', {}, site.name), node('span', { className: 'explore-description' }, site.description), node('small', {}, 'Open website →'),
      ], { className: 'explore-tile', 'aria-label': `Visit ${site.name}`, onClick: () => open(site) }))),
      state.searched && !state.results.length ? node('p', { className: 'explore-empty' }, 'No pages matched. Try one simple word, or show all six places.') : null,
      node('p', { className: 'explore-note' }, 'These pages live on this computer. Each opens a real local web address. This collection does not browse or block the public internet.'),
    );
  }
  function resultView() {
    const result = state.request;
    if (!result) return node('p', { className: 'explore-lab-empty' }, 'Send a request to see the response arrive.');
    let body = result.text;
    if (result.contentType.startsWith('application/json')) { try { body = JSON.stringify(JSON.parse(body), null, 2); } catch {} }
    return node('div', { className: 'explore-inspection' },
      node('h4', {}, 'Request sent'), node('code', { className: 'explore-request-url' }, `${result.method} ${result.url}`),
      result.requestBody ? node('pre', {}, result.requestBody) : null,
      node('h4', {}, `Response · ${result.status} ${result.statusText}`),
      node('dl', {}, node('dt', {}, 'Server received'), node('dd', {}, result.protocol), node('dt', {}, 'Content type'), node('dd', {}, result.contentType), node('dt', {}, 'Time / body size'), node('dd', {}, `${result.milliseconds} ms / ${result.bytes} bytes`)),
      node('pre', { tabindex: '0', 'aria-label': 'Actual response body' }, body),
    );
  }
  function drawLab() {
    if (!labPanel) return;
    labPanel.replaceChildren(
      node('h3', { tabindex: '-1', 'data-focus': 'explore-lab' }, 'Request lab'),
      node('p', {}, 'Send a real HTTP request to this computer. This lab shows the requests you send here; page clicks and forms are separate requests.'),
      node('form', { className: 'explore-lab-form', onSubmit: event => { event.preventDefault(); void sendRequest(); } },
        node('label', {}, 'Request', node('select', { disabled: state.requesting, value: state.example, onChange: event => { state.example = event.target.value; drawLab(); } },
          [['moon', 'Read Moon facts · GET JSON'], ['prediction', 'Send a prediction · POST JSON'], ['page', 'Read this website · GET HTML']].map(([id, label]) => node('option', { value: id, ...(state.example === id ? { selected: '' } : {}) }, label)))),
        state.example === 'prediction' ? node('label', {}, 'Liquid water becomes vapor. Choose a change.', node('select', { disabled: state.requesting, value: state.choice, onChange: event => { state.choice = event.target.value; } }, [['evaporation', 'Evaporation'], ['condensation', 'Condensation']].map(([id, label]) => node('option', { value: id, ...(state.choice === id ? { selected: '' } : {}) }, label)))) : null,
        button(state.requesting ? 'Sending…' : 'Send request', { type: 'submit', className: 'retro primary', disabled: state.requesting }),
      ),
      ...(state.error ? [node('p', { role: 'alert', className: 'explore-error' }, state.error)] : []),
      node('div', { 'aria-live': 'polite' }, resultView()),
      node('p', { className: 'explore-note' }, 'The prediction response is not saved. No sign-in, personal information or platform credentials are sent.'),
    );
  }
  async function sendRequest() {
    if (state.requesting) return;
    const panel = labPanel;
    state.requesting = true; state.error = ''; drawLab();
    try {
      const options = state.example === 'prediction' ? { path: '/explore/api/prediction', method: 'POST', body: { change: state.choice } }
        : { path: state.example === 'moon' ? '/explore/api/moon' : `/explore/sites/${state.selected}/` };
      const result = await inspectExploreRequest({ origin: runnerOrigin(), ...options });
      if (labPanel === panel) state.request = result;
    } catch (error) { if (labPanel === panel) state.error = error.name === 'AbortError' ? 'The local service took too long. Try again.' : `Request could not finish: ${error.message}`; }
    finally { state.requesting = false; if (labPanel === panel) drawLab(); }
  }
  function toggleLab() {
    state.lab = !state.lab;
    frame.hidden = state.lab; labPanel.hidden = !state.lab;
    labButton.textContent = state.lab ? 'Back to website' : 'Request lab';
    if (state.lab) { drawLab(); labPanel.querySelector('[data-focus="explore-lab"]').focus(); }
  }
  function selectedView() {
    if (viewer) return viewer;
    const site = state.sites.find(value => value.id === state.selected);
    address = node('code', { className: 'explore-address' }, `${runnerOrigin()}${state.path}`);
    frame = node('iframe', { className: 'explore-frame', title: `Local website: ${site.name}`, src: exploreURL(runnerOrigin(), site.path), sandbox: 'allow-scripts allow-forms', referrerpolicy: 'no-referrer', allow: '' });
    labPanel = node('section', { className: 'explore-lab', hidden: true });
    labButton = button('Request lab', { onClick: toggleLab });
    content = node('div', { className: 'explore-content' }, frame, labPanel);
    viewer = node('div', { className: 'explore-viewer' },
      node('div', { className: 'explore-toolbar' }, button('All websites', { onClick: () => { leave(); render('view-heading'); } }), labButton,
        button('Reload page', { onClick: () => { state.path = `/explore/sites/${state.selected}/`; frame.src = exploreURL(runnerOrigin(), state.path); address.textContent = frame.src; } })),
      node('h2', { className: 'visually-hidden', 'data-explore-title': '', tabindex: '-1', 'data-focus': 'view-heading' }, site.name),
      node('div', { className: 'explore-location' }, node('span', {}, 'Local address'), address), content,
    );
    return viewer;
  }
  return {
    refresh, leave, title: () => 'Explore', isViewing: () => state.selected !== null,
    view: () => state.selected ? selectedView() : catalog(),
    back: () => { if (state.lab) toggleLab(); else { leave(); render('view-heading'); } },
    snapshot: () => ({ siteId: state.selected }),
    restore: async siteId => { const site = state.sites.find(value => value.id === siteId); if (!site) return false; leave(); state.selected = siteId; state.path = site.path; return true; },
    destroy: () => { leave(); globalThis.removeEventListener('message', updateLocation); },
  };
}
