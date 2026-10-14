import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyMail, validateMail, addMailPerson, saveMailDraft, sendMailDraft, changeMailMessage } from './mail.mjs';
import { Store } from './store.mjs';
import { createMailbox } from '../../apps/desktop/mail.mjs';
const id = () => `letter-${randomUUID()}`;
const failStatus = code => error => error.status === code;
function family() {
  const mail = emptyMail();
  const a = addMailPerson(mail, { name: 'Alex', color: 'green' });
  const b = addMailPerson(mail, { name: 'Blair', color: 'blue' });
  const c = addMailPerson(mail, { name: 'Casey', color: 'teal' });
  return { mail, a, b, c };
}
const input = (from, to, extra = {}) => ({ revision: 0, from, to, subject: 'A little hello', body: 'I made a game today. 👋', replyTo: null, trashed: false, ...extra });

test('draft revisions reject competing edits and safely repeat a save after its response is lost', () => {
  const { mail, a, b } = family(), draftId = id(), first = input(a.id, b.id);
  const saved = saveMailDraft(mail, draftId, first);
  assert.equal(saved.revision, 1);
  assert.deepEqual(saveMailDraft(mail, draftId, first), saved);
  assert.throws(() => saveMailDraft(mail, draftId, { ...first, body: 'competing text' }), failStatus(409));
  assert.equal(mail.drafts[draftId].body, first.body);
  const changed = saveMailDraft(mail, draftId, { ...first, revision: 1, body: 'next edit' });
  assert.equal(changed.revision, 2); assert.equal(changed.createdAt, saved.createdAt);
  assert.throws(() => saveMailDraft(mail, draftId, { ...first, revision: 2, from: b.id }), failStatus(409));
  validateMail(mail);
});

test('send is a durable idempotent receipt and cannot resend a different revision or trashed draft', () => {
  const { mail, a, b } = family(), draftId = id();
  saveMailDraft(mail, draftId, input(a.id, b.id));
  const sent = sendMailDraft(mail, draftId, { revision: 1 });
  assert.equal(Object.hasOwn(mail.drafts, draftId), false);
  assert.deepEqual(sendMailDraft(mail, draftId, { revision: 1 }), sent);
  assert.equal(Object.keys(mail.messages).length, 1);
  assert.throws(() => sendMailDraft(mail, draftId, { revision: 2 }), failStatus(409));
  assert.throws(() => saveMailDraft(mail, draftId, input(a.id, b.id)), failStatus(409));
  const trashed = id(); saveMailDraft(mail, trashed, input(a.id, b.id, { trashed: true }));
  assert.throws(() => sendMailDraft(mail, trashed, { revision: 1 }), failStatus(409));
  const blank = id(); saveMailDraft(mail, blank, input(a.id, null, { subject: '', body: '' }));
  assert.throws(() => sendMailDraft(mail, blank, { revision: 1 }), /recipient/);
  assert.equal(mail.drafts[blank].revision, 1); validateMail(mail);
});

test('read markers belong to recipient and Trash/restore affects each mailbox independently', () => {
  const { mail, a, b, c } = family(), draftId = id();
  saveMailDraft(mail, draftId, input(a.id, b.id)); sendMailDraft(mail, draftId, { revision: 1 });
  assert.throws(() => changeMailMessage(mail, draftId, { personId: a.id, action: 'read' }), /receiving/);
  assert.throws(() => changeMailMessage(mail, draftId, { personId: c.id, action: 'trash' }), /another mailbox/);
  changeMailMessage(mail, draftId, { personId: b.id, action: 'read' }); assert.ok(mail.messages[draftId].readAt);
  changeMailMessage(mail, draftId, { personId: b.id, action: 'unread' }); assert.equal(mail.messages[draftId].readAt, null);
  changeMailMessage(mail, draftId, { personId: a.id, action: 'trash' });
  changeMailMessage(mail, draftId, { personId: a.id, action: 'trash' });
  assert.deepEqual(mail.messages[draftId].trashedBy, [a.id]);
  changeMailMessage(mail, draftId, { personId: b.id, action: 'trash' });
  changeMailMessage(mail, draftId, { personId: a.id, action: 'restore' });
  assert.deepEqual(mail.messages[draftId].trashedBy, [b.id]); validateMail(mail);
});

test('reply and payload validation reject forged references, missing people, invalid text and extra keys', () => {
  const { mail, a, b, c } = family(), original = id();
  saveMailDraft(mail, original, input(a.id, b.id)); sendMailDraft(mail, original, { revision: 1 });
  const reply = saveMailDraft(mail, id(), input(b.id, a.id, { replyTo: original })); assert.equal(reply.replyTo, original);
  for (const patch of [{ replyTo: original, from: c.id }, { replyTo: id() }, { to: `person-${randomUUID()}` }, { subject: 'x'.repeat(121) }, { body: '\0' }, { body: '\ud800' }, { revision: -1 }, { body: 'x'.repeat(16001) }, { extra: 'unsupported' }]) assert.throws(() => saveMailDraft(mail, id(), { ...input(a.id, b.id), ...patch }));
  assert.throws(() => addMailPerson(mail, { name: 'alex', color: 'pink' }), failStatus(409));
  assert.throws(() => addMailPerson(mail, { name: 'New', color: 'invisible' }));
  const damaged = structuredClone(mail); damaged.messages[original].trashedBy = [a.id, a.id]; assert.throws(() => validateMail(damaged));
});

test('mailbox store preserves exact letters/drafts and idempotent send across restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kidos-mail-')); let store = await Store.open(directory);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const a = await store.addMailPerson({ name: 'Parent', color: 'purple' }); const b = await store.addMailPerson({ name: 'Kid', color: 'orange' });
  const first = id(), second = id();
  await store.saveMailDraft(first, input(a.id, b.id)); const sent = await store.sendMailDraft(first, { revision: 1 });
  await store.changeMailMessage(first, { personId: b.id, action: 'read' });
  await store.saveMailDraft(second, input(b.id, a.id, { replyTo: first, body: 'Reply stays unfinished.' }));
  const before = store.getMail(); before.people[a.id].name = 'mutated return'; assert.equal(store.getMail().people[a.id].name, 'Parent');
  const saved = store.getMail(); await store.close(); store = await Store.open(directory);
  assert.deepEqual(store.getMail(), saved);
  const receipt = await store.sendMailDraft(first, { revision: 1 }); assert.equal(receipt.id, sent.id); assert.equal(Object.keys(store.getMail().messages).length, 1);
  const results = await Promise.allSettled([store.saveMailDraft(second, input(b.id, a.id, { revision: 1, replyTo: first, body: 'edit one' })), store.saveMailDraft(second, input(b.id, a.id, { revision: 1, replyTo: first, body: 'edit two' }))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
});

test('schema 5 migration adds empty mail while retaining creations and exact pre-upgrade bytes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kidos-mail-migration-')); let store = await Store.open(directory);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const project = await store.createProject('Keep my story'); const app = await store.installProject(project.id, { revision: 1, version: '1.0.0' });
  await store.close();
  const before = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')); delete before.mail; before.schemaVersion = 5;
  const bytes = JSON.stringify(before, null, 2); await writeFile(path.join(directory, 'state.json'), bytes);
  store = await Store.open(directory);
  assert.deepEqual(store.getMail(), emptyMail()); assert.deepEqual(store.getProject(project.id), project); assert.deepEqual(store.getInstalled(project.id), app);
  const archives = (await readdir(directory)).filter(name => name.startsWith('state.pre-v6.')); assert.equal(archives.length, 1);
  assert.equal(await readFile(path.join(directory, archives[0]), 'utf8'), bytes);
  assert.equal(JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8')).schemaVersion, 6);
});

function uiFixture(t, intercept = null) {
  const { mail, a, b } = family(); let root, errors = [], queued = [];
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { addEventListener() {} }; globalThis.document = { querySelectorAll: () => [] };
  t.after(() => { globalThis.window = oldWindow; globalThis.document = oldDocument; });
  const node = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter(c => c !== false && c !== null && c !== undefined) });
  const button = (label, attrs = {}) => node('button', attrs, label);
  const text = value => typeof value === 'object' ? value.children.map(text).join('') : String(value);
  const all = item => typeof item === 'object' ? [item, ...item.children.flatMap(all)] : [];
  const api = async (url, options = {}) => {
    if (intercept) { const result = await intercept({ url, options, mail }); if (result !== undefined) return result; }
    if (url === '/api/mail') return { mail: structuredClone(mail) };
    const draft = /\/drafts\/(letter-[^/]+)(\/send)?$/.exec(url);
    if (draft?.[2]) return { message: structuredClone(sendMailDraft(mail, draft[1], options.body)) };
    if (draft) return { draft: structuredClone(saveMailDraft(mail, draft[1], options.body)) };
    throw new Error(`Unexpected test API ${url}`);
  };
  let app;
  const render = () => { root = app.view(); };
  const perform = work => { const promise = (async () => { try { await work(); } catch (error) { errors.push(error); } finally { render(); } })(); queued.push(promise); return promise; };
  app = createMailbox({ node, button, icon: () => '', api, perform, render });
  return { app, mail, a, b, render, errors, async start() { await app.refresh(); render(); },
    async click(label) { const found = all(root).find(n => n.tag === 'button' && text(n) === label); assert.ok(found, `button ${label}`); const result = found.attrs.onClick(); await result; while (queued.length) await queued.shift(); },
    input(label, value) { const field = all(root).find(n => n.tag === 'label' && n.children[0] === label)?.children[1]; assert.ok(field, `field ${label}`); (field.attrs.onInput || field.attrs.onChange)({ target: { value } }); },
    get rootText() { return text(root); }, get hasEditor() { return all(root).some(n => n.tag === 'h2' && text(n) === 'Write a letter'); },
  };
}

test('mail UI preserves unsaved text on failed save and close, then retries the same draft identity', async t => {
  let offline = false;
  const f = uiFixture(t, ({ options }) => { if (offline && options.method === 'PUT') throw new Error('offline'); });
  await f.start(); await f.click('Write letter'); const draftId = Object.keys(f.mail.drafts)[0];
  f.input('Subject', 'My changed subject'); f.input('Your letter', 'Keep my exact words'); offline = true;
  assert.equal(await f.app.beforeClose(), false); assert.equal(f.app.hasPending(), true); assert.equal(f.hasEditor, true);
  offline = false; assert.equal(await f.app.beforeClose(), true); assert.equal(f.app.hasPending(), false);
  assert.equal(Object.keys(f.mail.drafts).length, 1); assert.equal(f.mail.drafts[draftId].body, 'Keep my exact words');
});

test('mail UI does not discard local text when a different draft revision was sent elsewhere', async t => {
  const f = uiFixture(t, ({ url, options, mail }) => {
    if (!url.endsWith('/send')) return;
    const draftId = url.split('/').at(-2), previous = mail.drafts[draftId];
    saveMailDraft(mail, draftId, { ...Object.fromEntries(['revision', 'from', 'to', 'subject', 'body', 'replyTo', 'trashed'].map(key => [key, previous[key]])), body: 'Different text from another window' });
    sendMailDraft(mail, draftId, { revision: previous.revision + 1 });
    const error = new Error('This letter was sent from a different revision.'); error.status = 409; throw error;
  });
  await f.start(); await f.click('Write letter'); f.input('To', f.b.id); f.input('Subject', 'Keep my letter'); f.input('Your letter', 'My original local words');
  await f.click('Send letter');
  assert.equal(f.hasEditor, true, 'a conflicting send receipt must not close the local draft');
  assert.equal(f.errors.length, 1);
  assert.equal(f.app.hasPending(), true, 'the surviving local text needs a new durable copy');
  assert.equal(await f.app.beforeClose(), false, 'closing must wait until the conflicting local text is rescued');
  await f.click('Save a new copy');
  assert.equal(f.app.hasPending(), false);
  assert.equal(Object.values(f.mail.drafts).some(d => d.body === 'My original local words'), true);
});


test('mail UI saves edits that arrive while an earlier autosave is in flight', async t => {
  let waitForSave = false, release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = uiFixture(t, async ({ options }) => { if (waitForSave && options.method === 'PUT') { waitForSave = false; entered(); await gate; } });
  await f.start(); await f.click('Write letter'); const draftId = Object.keys(f.mail.drafts)[0];
  f.input('Your letter', 'First edit'); waitForSave = true;
  const saving = f.app.beforeClose(); await started;
  f.input('Your letter', 'Second edit arrived while saving'); release();
  assert.equal(await saving, true); assert.equal(f.app.hasPending(), false);
  assert.equal(f.mail.drafts[draftId].body, 'Second edit arrived while saving'); assert.equal(f.mail.drafts[draftId].revision, 3);
});

test('mail UI resolves a lost send response using the exact matching durable receipt', async t => {
  const f = uiFixture(t, ({ url, options, mail }) => {
    if (!url.endsWith('/send')) return;
    sendMailDraft(mail, url.split('/').at(-2), options.body);
    throw new Error('Send response lost');
  });
  await f.start(); await f.click('Write letter'); f.input('To', f.b.id); f.input('Subject', 'Real delivery'); f.input('Your letter', 'One copy only');
  await f.click('Send letter');
  assert.equal(f.errors.length, 0); assert.equal(f.hasEditor, false); assert.equal(f.app.hasPending(), false);
  assert.equal(Object.values(f.mail.messages).length, 1); assert.equal(Object.values(f.mail.messages)[0].body, 'One copy only');
});
