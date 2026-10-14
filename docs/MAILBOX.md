# Local family Mailbox

Mailbox is an offline letter app for people sharing this kidOS computer. Add up to 12 named mailboxes, write letters, choose a recipient, reply, and browse Inbox, Sent, Drafts and Trash. There are no email accounts, SMTP delivery, cloud servers or messages to other devices. Mailboxes are convenient shared labels; anyone using the trusted desktop can switch between them. This is not parent authentication or private correspondence between secured accounts.

Drafts save automatically after a short typing pause and show their save status. Closing the app waits for the draft save. Keep the window open if saving fails; Retry save retries without replacing a newer draft from another browser, and Save a new copy preserves conflicting text under a new identity. Browser reload warns while text has not been acknowledged. A crash before a save completes can lose the most recent typing. Sending requires a recipient, subject and body. The saved draft identity is the send receipt, so repeating an acknowledged send does not deliver a second letter.

Trash is recoverable. Moving a letter affects only the selected mailbox's view; the other mailbox retains its own copy. Drafts can also be moved to Trash and restored. There is no permanent-delete operation. Limits are 100 drafts, 1,000 letters, 120 characters per subject and 16,000 per letter; Trash counts toward these bounds.

The schema 6 `mail` map lives in the private data directory alongside projects. Stop kidOS and back up the entire directory to preserve letters and media together. Schema 1–5 upgrades retain exact old state bytes in a `state.pre-v6.<uuid>.json` archive before writing the new state. Mailboxes start empty in a new installation; personal names and letters are never part of a release archive.

All letters render as plain text. The API requires the same desktop session checks as projects; sandboxed app frames receive no mail capability. These controls do not replace Linux containment or parent sign-in.

Verification of this app wave is recorded in the project README and DAY0 document. Physical Raspberry Pi behavior remains unverified.
