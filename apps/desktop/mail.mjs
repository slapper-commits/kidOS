// Local personas are convenience labels, not authenticated/private accounts.
const colors = ['blue', 'green', 'purple', 'orange', 'pink', 'teal'];
const fields = ['from', 'to', 'subject', 'body', 'replyTo', 'trashed'];
const stamp = value => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export function createMailbox({ node, button, icon, api, perform, render }) {
  let mail = { people: {}, drafts: {}, messages: {} };
  let selectedPerson = null, folder = 'inbox', selected = null, editor = null, dirty = false, failure = '', timer = null, saving = null, generation = 0, adding = false, query = '';
  const name = id => mail.people[id]?.name || 'Family';
  const drafts = () => Object.values(mail.drafts).filter(d => d.from === selectedPerson);
  const letters = () => Object.values(mail.messages).filter(m => [m.from, m.to].includes(selectedPerson));
  const status = () => failure || (saving ? 'Saving draft…' : dirty ? 'Draft has unsaved changes.' : editor ? 'Draft saved on this computer.' : 'Letters stay on this computer.');
  function updateStatus() {
    document.querySelectorAll('[data-mail-status]').forEach(el => { el.textContent = status(); });
    document.querySelectorAll('[data-mail-retry]').forEach(el => { el.hidden = !failure; });
  }
  async function refresh() {
    mail = (await api('/api/mail')).mail;
    if (!mail.people[selectedPerson]) selectedPerson = Object.keys(mail.people)[0] ?? null;
  }
  async function flush() {
    clearTimeout(timer);
    if (saving) return saving;
    if (!dirty || !editor) return true;
    saving = (async () => {
      try {
        while (dirty && editor) {
          const version = generation, current = editor;
          const input = Object.fromEntries(['revision', ...fields].map(key => [key, current[key]]));
          const { draft } = await api(`/api/mail/drafts/${current.id}`, { method: 'PUT', body: input });
          mail.drafts[draft.id] = draft;
          if (editor?.id === draft.id) editor.revision = draft.revision;
          if (version === generation) dirty = false;
          failure = '';
        }
        return true;
      } catch (error) { failure = `Draft not saved: ${error.message} Keep this window open, retry, or save a new copy.`; return false; }
      finally { saving = null; updateStatus(); }
    })();
    updateStatus(); return saving;
  }
  function edit(key, value) {
    editor[key] = value; generation += 1; dirty = true; failure = ''; updateStatus();
    clearTimeout(timer); timer = setTimeout(() => void flush(), 500);
  }
  async function switchView(action) { if (await flush()) action(); render(); }
  async function compose(reply) {
    if (!(await flush())) return;
    selected = null;
    editor = { id: `letter-${crypto.randomUUID()}`, revision: 0, from: selectedPerson, to: reply ? (reply.from === selectedPerson ? reply.to : reply.from) : null, subject: reply ? `Re: ${reply.subject}`.slice(0, 120) : '', body: '', replyTo: reply?.id ?? null, trashed: false };
    generation += 1; dirty = true; failure = ''; await flush(); render();
  }
  async function change(message, action) {
    const result = await api(`/api/mail/messages/${message.id}`, { method: 'PATCH', body: { personId: selectedPerson, action } });
    mail.messages[message.id] = result.message;
  }
  async function openLetter(message) {
    if (!(await flush())) return;
    editor = null; selected = message.id;
    if (message.to === selectedPerson && !message.readAt) await change(message, 'read');
  }
  async function send() {
    if (!(await flush()) || !editor) return;
    const id = editor.id, attempted = structuredClone(editor);
    try { await api(`/api/mail/drafts/${id}/send`, { method: 'POST', body: { revision: editor.revision } }); }
    catch (error) {
      // Resolve a lost send response before inviting a retry. The server uses
      // the draft identity as the durable send receipt.
      await refresh(); const receipt = mail.messages[id];
      if (!receipt || receipt.draftRevision !== attempted.revision || ['from', 'to', 'subject', 'body', 'replyTo'].some(key => receipt[key] !== attempted[key])) {
        if (receipt || !mail.drafts[id]) { dirty = true; generation += 1; failure = 'This letter changed before sending. Your text is still here. Save a new copy to keep it.'; updateStatus(); }
        throw error;
      }
    }
    editor = null; dirty = false; failure = ''; selected = id; folder = 'sent'; await refresh();
  }
  function openDraft(draft) {
    return switchView(() => { editor = structuredClone(draft); selected = null; dirty = false; failure = ''; });
  }
  function statusBar() { return node('div', { className: 'mail-status' },
    node('span', { role: 'status', 'data-mail-status': '' }, status()),
    button('Retry save', { hidden: !failure, 'data-mail-retry': '', onClick: () => void flush() }),
    button('Save a new copy', { hidden: !failure, 'data-mail-retry': '', onClick: () => perform(async () => {
      if (saving) await saving;
      editor = { ...editor, id: `letter-${crypto.randomUUID()}`, revision: 0 }; generation += 1; dirty = true; await flush();
    }) }),
  ); }
  function composeView() {
    const recipient = node('select', { 'aria-label': 'To mailbox', onChange: e => edit('to', e.target.value || null) },
      node('option', { value: '' }, 'Choose a mailbox…'), ...Object.values(mail.people).map(p => node('option', { value: p.id }, p.name)));
    recipient.value = editor.to ?? '';
    return node('section', { className: 'mail-compose' },
      node('h2', {}, 'Write a letter'), node('p', {}, `From ${name(editor.from)}`),
      node('label', {}, 'To', recipient),
      node('label', {}, 'Subject', node('input', { value: editor.subject, maxlength: 120, onInput: e => edit('subject', e.target.value) })),
      node('label', {}, 'Your letter', node('textarea', { value: editor.body, maxlength: 16000, rows: 12, spellcheck: true, onInput: e => edit('body', e.target.value) })),
      node('div', { className: 'actions' }, button('Send letter', { onClick: () => perform(send) }), button('Save draft', { onClick: () => void flush() }),
        button('Move draft to Trash', { onClick: () => perform(async () => { if (!(await flush())) return; edit('trashed', true); if (await flush()) { editor = null; selected = null; folder = 'drafts'; } }) })), statusBar(),
    );
  }
  function letterView(message) {
    const trashed = message.trashedBy.includes(selectedPerson);
    return node('article', { className: 'mail-letter' },
      node('h2', {}, message.subject), node('p', { className: 'muted' }, `From ${name(message.from)} · To ${name(message.to)} · ${stamp(message.createdAt)}`),
      node('div', { className: 'mail-paper' }, message.body),
      node('div', { className: 'actions' }, button('Reply', { onClick: () => perform(() => compose(message)) }),
        button(trashed ? 'Restore letter' : 'Move to Trash', { onClick: () => perform(async () => { await change(message, trashed ? 'restore' : 'trash'); selected = null; }) }),
        message.to === selectedPerson && button(message.readAt ? 'Mark unread' : 'Mark read', { onClick: () => perform(async () => { await change(message, message.readAt ? 'unread' : 'read'); selected = null; }) })),
    );
  }
  function listView() {
    let items = folder === 'drafts' ? drafts().filter(d => !d.trashed) : folder === 'trash' ? [...drafts().filter(d => d.trashed), ...letters().filter(m => m.trashedBy.includes(selectedPerson))] : letters().filter(m => !m.trashedBy.includes(selectedPerson) && (folder === 'inbox' ? m.to === selectedPerson : m.from === selectedPerson));
    items = items.filter(m => `${m.subject} ${m.body} ${name(m.from)} ${name(m.to)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
    return node('section', { className: 'mail-list' },
      node('h2', {}, ({ inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts', trash: 'Trash' })[folder]),
      node('label', {}, 'Find a letter', node('input', { type: 'search', value: query, onChange: e => { query = e.target.value; render(); } })),
      items.length ? node('div', { className: 'mail-rows' }, ...items.map(m => {
        const isDraft = Object.hasOwn(m, 'revision');
        return node('div', { className: 'mail-row' }, button([
          node('strong', {}, `${!isDraft && m.to === selectedPerson && !m.readAt ? '● ' : ''}${m.subject || 'Untitled draft'}`),
          node('span', {}, `${isDraft ? 'Draft' : folder === 'sent' ? `To ${name(m.to)}` : `From ${name(m.from)}`} · ${stamp(m.updatedAt ?? m.createdAt)}`),
          node('span', { className: 'muted' }, m.body.slice(0, 90)),
        ], { className: 'mail-row-button', onClick: () => perform(() => isDraft ? (m.trashed ? Promise.resolve() : openDraft(m)) : openLetter(m)), disabled: isDraft && m.trashed }),
        isDraft && m.trashed && button('Restore draft', { onClick: () => perform(async () => {
          const input = Object.fromEntries(['revision', ...fields].map(key => [key, m[key]])); input.trashed = false;
          const { draft } = await api(`/api/mail/drafts/${m.id}`, { method: 'PUT', body: input }); mail.drafts[m.id] = draft;
        }) }));
      })) : node('p', { className: 'empty' }, query ? 'No letters match your search.' : folder === 'inbox' ? 'No letters here yet. Write to someone in your family.' : 'This folder is empty.'),
      folder === 'trash' && node('p', { className: 'muted' }, 'Trash keeps letters and drafts recoverable. Other family mailboxes keep their own copies.'),
    );
  }
  function addView() {
    let newName = '', newColor = colors[Object.keys(mail.people).length % colors.length];
    const color = node('select', { 'aria-label': 'Mailbox color', onChange: e => { newColor = e.target.value; } }, ...colors.map(c => node('option', { value: c }, c)));
    color.value = newColor;
    return node('form', { className: 'mail-setup', onSubmit: event => {
      event.preventDefault(); void perform(async () => {
        if (!(await flush())) return;
        const { person } = await api('/api/mail/people', { method: 'POST', body: { name: newName.trim(), color: newColor } });
        await refresh(); selectedPerson = person.id; adding = false; selected = editor = null; folder = 'inbox';
      });
    } }, node('h2', {}, 'Add a family mailbox'), node('p', {}, 'Choose a name for someone who uses this computer.'),
    node('label', {}, 'Mailbox name', node('input', { required: true, maxlength: 40, onInput: e => { newName = e.target.value; } })),
    node('label', {}, 'Color', color), node('div', { className: 'actions' }, button('Create mailbox', { type: 'submit' }),
      Object.keys(mail.people).length > 0 && button('Cancel', { onClick: () => { adding = false; render(); } })));
  }
  function view() {
    const person = node('select', { 'aria-label': 'Family mailbox', onChange: e => {
      const id = e.target.value; void switchView(() => { selectedPerson = id; editor = selected = null; folder = 'inbox'; query = ''; });
    } }, ...Object.values(mail.people).map(p => node('option', { value: p.id }, p.name)));
    person.value = selectedPerson ?? '';
    const unread = letters().filter(m => m.to === selectedPerson && !m.readAt && !m.trashedBy.includes(selectedPerson)).length;
    return node('div', { className: 'mail-app' },
      node('header', { className: 'mail-header' }, node('h1', {}, icon('mail'), ' Family Mailbox'),
        node('p', {}, 'Local to this computer. Mailboxes are shared labels, not private accounts.')),
      node('div', { className: 'mail-toolbar' }, Object.keys(mail.people).length > 0 && person,
        button('Add mailbox…', { onClick: () => { adding = true; render(); } }),
        button('Refresh mail', { onClick: () => perform(refresh) })),
      adding || !selectedPerson ? addView() : node('div', { className: 'mail-layout' },
        node('nav', { className: 'mail-folders', 'aria-label': 'Mailbox folders' },
          node('span', { className: `mail-person mail-${mail.people[selectedPerson].color}` }, name(selectedPerson)),
          button('Write letter', { onClick: () => perform(() => compose()) }),
          ...['inbox', 'sent', 'drafts', 'trash'].map(value => button(value === 'inbox' ? `Inbox${unread ? ` (${unread})` : ''}` : value[0].toUpperCase() + value.slice(1), {
            'aria-pressed': folder === value && !editor && !selected, onClick: () => void switchView(() => { folder = value; editor = selected = null; query = ''; }),
          }))),
        editor ? composeView() : selected && mail.messages[selected] ? letterView(mail.messages[selected]) : listView()),
    );
  }
  window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
  return { refresh, view, title: () => 'Family Mailbox', beforeClose: flush, hasPending: () => dirty || Boolean(saving) };
}
