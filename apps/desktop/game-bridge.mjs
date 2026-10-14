// Only a currently mounted built-in game may submit a bounded round result.
// No platform token, arbitrary URL, project ID, or filesystem path crosses this bridge.
export function createGameBridge({ resolveSource, getFrame, getRun, save, onSaved = () => {} }) {
  const inFlight = new Map();
  // Resolve authority from the exact sending window, never the focused window.
  // The legacy accessors keep the single-frame caller contract usable.
  const resolve = typeof resolveSource === 'function' ? resolveSource : () => ({ frame: getFrame(), run: getRun() });
  return async function handleGameMessage(event) {
    const { run, frame } = resolve(event.source) || {};
    if (!run || run.kind !== 'game' || !frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const target = event.source;
    const stillMounted = () => {
      const current = resolve(target);
      return current?.run === run && current.run.kind === 'game' && current.frame?.contentWindow === target;
    };
    if (message.type === 'kidos:game-ready') {
      target.postMessage({ type: 'kidos:game-state', best: run.progress.best }, '*');
      return;
    }
    if (message.type !== 'kidos:game-score' || Object.keys(message).sort().join(',') !== 'roundId,score,type,won' ||
        typeof message.roundId !== 'string' || !/^[0-9a-f]{32}$/.test(message.roundId) ||
        !Number.isSafeInteger(message.score) || message.score < 0 || message.score > 100000 || typeof message.won !== 'boolean') return;
    const key = `${run.gameId}:${message.roundId}`;
    try {
      if (!inFlight.has(key)) {
        if (inFlight.size >= 8) throw new Error('Retry when the current saves finish.');
        const saving = Promise.resolve().then(() => save(run.gameId, { roundId: message.roundId, score: message.score, won: message.won }));
        inFlight.set(key, saving);
      }
      const progress = await inFlight.get(key);
      onSaved(run.gameId, progress);
      // A save may finish after its window closes or the frame is reused for
      // another run. Keep the catalog current without granting the new run an
      // acknowledgement or mutating its state on behalf of the old one.
      if (!stillMounted()) return;
      run.progress = progress;
      target.postMessage({ type: 'kidos:game-saved', roundId: message.roundId, ok: true }, '*');
    } catch {
      if (stillMounted()) target.postMessage({ type: 'kidos:game-saved', roundId: message.roundId, ok: false }, '*');
    } finally { inFlight.delete(key); }
  };
}
