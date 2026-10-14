import { randomUUID } from 'node:crypto';
import { exactKeys, isRecord, StoreError } from '../../packages/app-contract/manifest.mjs';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const personId = new RegExp(`^person-${uuid}$`);
const letterId = new RegExp(`^letter-${uuid}$`);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const revision = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
export const MAIL_COLORS = ['blue', 'green', 'purple', 'orange', 'pink', 'teal'];
export const emptyMail = () => ({ people: {}, drafts: {}, messages: {} });
function checkId(id, pattern) { if (typeof id !== 'string' || !pattern.test(id)) throw new StoreError('Invalid mailbox identity.'); }
function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && (!value.trim() || value !== value.trim())) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new StoreError(`${label} must be plain text, up to ${max} characters.`);
}
function person(mail, id) { checkId(id, personId); if (!Object.hasOwn(mail.people, id)) throw new StoreError('Mailbox not found.', 404); }
function content(mail, input, sending = false) {
  person(mail, input.from);
  if (input.to !== null) person(mail, input.to);
  text(input.subject, 120, 'Subject'); text(input.body, 16000, 'Letter');
  if (input.replyTo !== null) {
    checkId(input.replyTo, letterId);
    const original = mail.messages[input.replyTo];
    if (!original || ![original.from, original.to].includes(input.from)) throw new StoreError('The original letter is unavailable in this mailbox.');
  }
  if (sending && (!input.to || !input.subject.trim() || !input.body.trim())) throw new StoreError('Choose a recipient and add a subject and letter before sending.');
}
export function validateMail(mail) {
  exactKeys(mail, ['people', 'drafts', 'messages'], 'Family mailbox');
  for (const [key, limit] of [['people', 12], ['drafts', 100], ['messages', 1000]]) if (!isRecord(mail[key]) || Object.keys(mail[key]).length > limit) throw new StoreError(`Mailbox ${key} exceed the local limit.`);
  for (const [id, value] of Object.entries(mail.people)) {
    exactKeys(value, ['id', 'name', 'color', 'createdAt'], 'Family mailbox'); checkId(id, personId);
    text(value.name, 40, 'Mailbox name', true);
    if (value.id !== id || !MAIL_COLORS.includes(value.color) || !date(value.createdAt)) throw new StoreError('Invalid saved mailbox.');
  }
  for (const [id, value] of Object.entries(mail.drafts)) {
    exactKeys(value, ['id', 'revision', 'from', 'to', 'subject', 'body', 'replyTo', 'createdAt', 'updatedAt', 'trashed'], 'Letter draft');
    checkId(id, letterId); content(mail, value);
    if (value.id !== id || !revision(value.revision) || value.revision < 1 || !date(value.createdAt) || !date(value.updatedAt) || value.updatedAt < value.createdAt || typeof value.trashed !== 'boolean' || Object.hasOwn(mail.messages, id)) throw new StoreError('Invalid saved draft.');
  }
  for (const [id, value] of Object.entries(mail.messages)) {
    exactKeys(value, ['id', 'draftRevision', 'from', 'to', 'subject', 'body', 'replyTo', 'createdAt', 'readAt', 'trashedBy'], 'Sent letter');
    checkId(id, letterId); content(mail, value, true);
    if (value.id !== id || !revision(value.draftRevision) || value.draftRevision < 1 || !date(value.createdAt) || (value.readAt !== null && (!date(value.readAt) || value.readAt < value.createdAt)) || !Array.isArray(value.trashedBy) || value.trashedBy.length > 2 || new Set(value.trashedBy).size !== value.trashedBy.length || value.trashedBy.some(p => ![value.from, value.to].includes(p))) throw new StoreError('Invalid saved letter.');
  }
  return mail;
}
export function addMailPerson(mail, input) {
  exactKeys(input, ['name', 'color'], 'New mailbox'); text(input.name, 40, 'Mailbox name', true);
  if (!MAIL_COLORS.includes(input.color)) throw new StoreError('Choose a mailbox color.');
  if (Object.keys(mail.people).length >= 12) throw new StoreError('This computer supports up to 12 family mailboxes.', 409);
  if (Object.values(mail.people).some(p => p.name.toLocaleLowerCase() === input.name.toLocaleLowerCase())) throw new StoreError('That mailbox name is already used.', 409);
  const value = { id: `person-${randomUUID()}`, ...input, createdAt: new Date().toISOString() };
  mail.people[value.id] = value; return value;
}
export function saveMailDraft(mail, id, input) {
  checkId(id, letterId); exactKeys(input, ['revision', 'from', 'to', 'subject', 'body', 'replyTo', 'trashed'], 'Save draft');
  content(mail, input);
  if (!revision(input.revision) || typeof input.trashed !== 'boolean') throw new StoreError('A current draft revision is required.');
  if (Object.hasOwn(mail.messages, id)) throw new StoreError('This letter has already been sent. Refresh Mailbox to see it.', 409);
  const previous = mail.drafts[id];
  const sameContent = previous && ['from', 'to', 'subject', 'body', 'replyTo', 'trashed'].every(key => previous[key] === input[key]);
  // A retry after a lost response is safe; a competing edit remains a conflict.
  if (sameContent && previous.revision === input.revision + 1) return previous;
  if ((previous?.revision ?? 0) !== input.revision || (previous && previous.from !== input.from)) throw new StoreError('This draft changed in another window. Your open text is still here; save it as a new letter.', 409);
  if (!previous && Object.keys(mail.drafts).length >= 100) throw new StoreError('The computer has reached its 100 saved drafts limit.', 409);
  const now = new Date().toISOString();
  const value = { id, ...input, revision: input.revision + 1, createdAt: previous?.createdAt ?? now, updatedAt: now };
  mail.drafts[id] = value; return value;
}
export function sendMailDraft(mail, id, input) {
  checkId(id, letterId); exactKeys(input, ['revision'], 'Send letter');
  if (!revision(input.revision) || input.revision < 1) throw new StoreError('Save this draft before sending.');
  const receipt = mail.messages[id];
  if (receipt) {
    if (receipt.draftRevision !== input.revision) throw new StoreError('This letter was sent from a different revision.', 409);
    return receipt;
  }
  const draft = mail.drafts[id];
  if (!draft) throw new StoreError('Draft not found.', 404);
  if (draft.revision !== input.revision || draft.trashed) throw new StoreError('The draft changed or is in Trash. Reopen it before sending.', 409);
  content(mail, draft, true);
  if (Object.keys(mail.messages).length >= 1000) throw new StoreError('This computer has reached its 1,000 saved letters limit.', 409);
  const { from, to, subject, body, replyTo } = draft;
  const message = { id, from, to, subject, body, replyTo, draftRevision: draft.revision, createdAt: new Date().toISOString(), readAt: null, trashedBy: [] };
  mail.messages[id] = message; delete mail.drafts[id]; return message;
}
export function changeMailMessage(mail, id, input) {
  checkId(id, letterId); exactKeys(input, ['personId', 'action'], 'Letter action'); person(mail, input.personId);
  const message = mail.messages[id];
  if (!message) throw new StoreError('Letter not found.', 404);
  if (![message.from, message.to].includes(input.personId)) throw new StoreError('This letter belongs to another mailbox.');
  if (['read', 'unread'].includes(input.action)) {
    if (message.to !== input.personId) throw new StoreError('Only the receiving mailbox has a read marker.');
    message.readAt = input.action === 'read' ? new Date().toISOString() : null;
  } else if (input.action === 'trash') message.trashedBy = [...new Set([...message.trashedBy, input.personId])];
  else if (input.action === 'restore') message.trashedBy = message.trashedBy.filter(value => value !== input.personId);
  else throw new StoreError('Unsupported letter action.');
  return message;
}
