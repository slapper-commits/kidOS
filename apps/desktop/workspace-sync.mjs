// Serial, revision-checked recovery writes. A conflicting browser never silently
// replaces another browser's workspace. No source project is saved here.
const content = ({ windows, activeId, editorDraft }) => ({ windows, activeId, editorDraft });
const signature = value => JSON.stringify(content(value));
export function createWorkspaceSync({ api, snapshot, onStatus = () => {}, delay = 600 }) {
  let ready = false, revision = 0, acknowledged = '', pending = null, timer = null, running = null;
  let error = '', conflict = false, uncertain = null;
  const notify = () => onStatus({ ready, pending: Boolean(pending || running), error, conflict });
  function start(workspace) {
    revision = workspace.revision; acknowledged = signature(workspace);
    ready = true; pending = null; error = ''; conflict = false; uncertain = null; notify();
  }
  function schedule() {
    if (!ready) return;
    const value = content(snapshot());
    if (signature(value) === acknowledged && !running && !uncertain) { pending = null; notify(); return; }
    pending = structuredClone(value);
    clearTimeout(timer);
    if (!error && !conflict) timer = setTimeout(() => { void flush(); }, delay);
    notify();
  }
  async function writePending() {
    while (pending && !conflict) {
      const sent = pending, serialized = signature(sent), attemptedRevision = revision;
      try {
        if (uncertain) {
          // Resolve an uncertain attempt before sending a different payload at
          // the same base revision. Even repeated failed retries then retain
          // the one exact payload that may already have reached disk.
          const latest = (await api('/api/workspace')).workspace;
          const latestSignature = signature(latest);
          if (latest.revision === uncertain.revision && latestSignature === acknowledged) {
            uncertain = null; error = '';
          } else if (latest.revision === uncertain.revision + 1 && latestSignature === uncertain.serialized) {
            revision = latest.revision; acknowledged = latestSignature; uncertain = null; error = '';
          } else {
            conflict = true;
            throw new Error('Another browser saved a newer workspace. Keep or download your edits, then reload to use that workspace.');
          }
          if (signature(pending) === acknowledged) pending = null;
          continue;
        }
        let saved;
        try { saved = (await api('/api/workspace', { method: 'PUT', body: { ...sent, revision } })).workspace; }
        catch (failure) {
          if (failure.status !== 409) {
            // A missing response (or server error after a disk write) may leave
            // this exact payload committed. New typing must not erase that
            // evidence before a retry resolves the uncertain revision.
            if (!failure.status || failure.status >= 500) uncertain = { revision: attemptedRevision, serialized };
            throw failure;
          }
          const latest = (await api('/api/workspace')).workspace;
          const latestSignature = signature(latest);
          // A PUT response may have been lost after its disk commit. Only an
          // exact payload match is evidence that our own write was accepted.
          if (latestSignature !== serialized || latest.revision !== attemptedRevision + 1) {
            conflict = true;
            throw new Error('Another browser saved a newer workspace. Keep or download your edits, then reload to use that workspace.');
          }
          saved = latest;
        }
        revision = saved.revision; acknowledged = serialized; error = ''; uncertain = null;
        if (signature(pending) === serialized) pending = null;
      } catch (failure) { error = failure.message || 'The local service could not save your workspace.'; break; }
    }
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (!ready || conflict) return Promise.resolve();
    if (running) return running;
    if (!pending) return Promise.resolve();
    running = writePending().finally(() => { running = null; notify(); });
    notify(); return running;
  }
  function retry() { if (conflict) return Promise.resolve(); error = ''; schedule(); return flush(); }
  return {
    start, schedule, flush, retry,
    isReady: () => ready,
    hasPending: () => Boolean(pending || running),
    matchesCurrent: () => ready && !pending && !running && signature(snapshot()) === acknowledged,
    stop: () => { ready = false; clearTimeout(timer); },
  };
}
