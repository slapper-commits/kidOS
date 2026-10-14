// Canvas presentation and controls. Remix the settings in script.js first.
(() => {
  const config = globalThis.KidOSGame;
  const engine = globalThis.KidOSGameEngine;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const message = document.getElementById('message');
  const description = document.getElementById('description');
  const start = document.getElementById('start');
  const pause = document.getElementById('pause');
  const status = document.getElementById('save-status');
  let game, roundId, best = 0, linked = false, previous = 0, ended = false;
  let ackTimer, retryButton, saving = null, lastPhase = null;
  const pending = new Map();
  const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  document.title = config.name;
  document.getElementById('title').textContent = config.name;
  document.getElementById('instructions').textContent = config.kind === 'moon'
    ? 'Space / ↑ or Jump to hop. Clear the rocks and catch stars. P pauses.'
    : '← → / A D or the arrow buttons to steer. Avoid cones and catch stars. P pauses.';
  document.getElementById('help-text').textContent = config.kind === 'moon'
    ? 'Jump over moon rocks and catch the stars above them. Land before jumping again. Tap anywhere in the game to jump.'
    : 'Drive through three lanes, avoiding orange cones and collecting golden stars. Tap the left or right half of the game to move one lane.';
  document.getElementById('help').addEventListener('toggle', event => { if (event.target.open) autoPause(); });
  canvas.setAttribute('aria-label', config.kind === 'moon' ? 'Moon Hopper. Use Space or Up to jump over rocks and catch stars.' : 'Tiny Racer. Use Left and Right to steer around cones and catch stars.');
  function reset() {
    game = engine.create(config, seed()); roundId = randomId(); ended = false;
    document.getElementById('score').textContent = '0';
  }
  function showOverlay(title, text, button) {
    overlay.hidden = false; message.textContent = title; description.textContent = text; start.textContent = button;
  }
  function saveResult() {
    if (!pending.size || !linked || saving) return;
    const result = pending.values().next().value;
    saving = result.roundId;
    retryButton?.remove();
    status.textContent = 'Saving your score…';
    parent.postMessage({ type: 'kidos:game-score', ...result }, '*');
    clearTimeout(ackTimer);
    ackTimer = setTimeout(() => { saving = null; offerRetry('Score not saved yet.'); }, 8000);
  }
  function offerRetry(text) {
    status.textContent = text + ' Keep this window open to try again.';
    if (!retryButton?.isConnected) {
      retryButton = document.createElement('button'); retryButton.textContent = 'Retry save';
      retryButton.addEventListener('click', saveResult); status.after(retryButton);
    }
  }
  function finish() {
    if (ended) return;
    ended = true;
    best = Math.max(best, game.score);
    document.getElementById('best').textContent = String(best);
    if (linked) pending.set(roundId, { roundId, score: game.score, won: game.phase === 'won' });
    showOverlay(game.phase === 'won' ? (config.kind === 'moon' ? 'Moon mission complete!' : 'Across the finish line!') : 'Nice run!', `${game.score} points · ${game.stars} stars. ${game.phase === 'won' ? 'You made it all the way.' : 'Every adventure gets a little easier.'}`, 'Play again');
    pause.textContent = 'Pause';
    if (linked) saveResult();
    else status.textContent = 'Practice score. Open the original from Play to save scores on this computer.';
    start.focus({ preventScroll: true });
  }
  function play() {
    if (game.phase === 'paused') engine.action(game, 'pause');
    else { if (['over', 'won'].includes(game.phase)) reset(); engine.action(game, 'start'); }
    overlay.hidden = true; pause.textContent = 'Pause'; canvas.focus({ preventScroll: true });
  }
  function pauseGame() {
    if (!engine.action(game, 'pause')) return;
    if (game.phase === 'paused') {
      showOverlay('Take a breather.', 'Your game is right here when you get back.', 'Keep playing');
      pause.textContent = 'Resume';
    } else { overlay.hidden = true; pause.textContent = 'Pause'; canvas.focus({ preventScroll: true }); }
  }
  function move(action) { if (game.phase === 'playing') { engine.action(game, action); canvas.focus({ preventScroll: true }); } }
  const movement = document.getElementById('movement');
  for (const [action, label] of config.kind === 'moon' ? [['jump', '↑ Jump']] : [['left', '← Left'], ['right', 'Right →']]) {
    const button = document.createElement('button'); button.textContent = label; button.className = 'primary';
    button.addEventListener('click', () => move(action)); movement.append(button);
  }
  start.addEventListener('click', play); pause.addEventListener('click', pauseGame);
  canvas.addEventListener('pointerdown', event => {
    if (game.phase !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    move(config.kind === 'moon' ? 'jump' : event.clientX - rect.left < rect.width / 2 ? 'left' : 'right');
  });
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    // Keep native button/summary Enter and Space activation; other game keys
    // still work after using an on-screen movement or pause button.
    if (event.target.closest('button,summary') && ['enter', ' '].includes(key)) return;
    if (key === 'enter' && ['ready', 'paused', 'over', 'won'].includes(game.phase)) { event.preventDefault(); play(); return; }
    if (['p', 'escape'].includes(key)) { event.preventDefault(); pauseGame(); return; }
    const action = config.kind === 'moon' ? ([' ', 'arrowup', 'w'].includes(key) ? 'jump' : null)
      : ['arrowleft', 'a'].includes(key) ? 'left' : ['arrowright', 'd'].includes(key) ? 'right' : null;
    if (action) { event.preventDefault(); if (!event.repeat || config.kind !== 'moon') move(action); }
  });
  const autoPause = () => { if (game.phase === 'playing') pauseGame(); };
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
  window.addEventListener('message', event => {
    if (event.source !== parent || parent === window || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'kidos:game-state' && Number.isSafeInteger(event.data.best)) {
      linked = true; best = Math.max(best, event.data.best);
      document.getElementById('best').textContent = String(best);
      if (!pending.size) status.textContent = 'Best scores save on this computer after each run.';
    }
    if (event.data.type === 'kidos:game-saved' && pending.has(event.data.roundId)) {
      if (event.data.roundId === saving || !saving) { clearTimeout(ackTimer); saving = null; }
      if (event.data.ok === true) {
        pending.delete(event.data.roundId); retryButton?.remove();
        if (pending.size) saveResult();
        else status.textContent = 'Score saved on this computer.';
      } else if (!saving) offerRetry('Could not save your score.');
    }
    if (event.data.type === 'kidos:game-visibility' && event.data.hidden) autoPause();
  });
  function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
  function star(x, y, size = 10) {
    ctx.fillStyle = '#ffe08b'; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5 - Math.PI / 2, radius = i % 2 ? size * .45 : size;
      const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
      if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  function frog() {
    const x = 98, y = Math.round(game.y);
    rect(x + 4, y + 8, 31, 22, config.playerColor || '#b7d588');
    rect(x + 3, y, 10, 13, '#d1e69c'); rect(x + 24, y, 10, 13, '#d1e69c');
    rect(x + 7, y + 3, 4, 6, '#223652'); rect(x + 27, y + 3, 4, 6, '#223652');
    rect(x - 1, y + 26, 13, 5, '#91b66b'); rect(x + 25, y + 26, 13, 5, '#91b66b');
    rect(x + 13, y + 19, 13, 3, '#405846');
  }
  function moonScene() {
    rect(0, 0, 640, 360, '#203452');
    for (let i = 0; i < 38; i++) {
      const x = ((i * 127 + 61 - game.distance * .09) % 660 + 660) % 660;
      rect(x, 16 + (i * 47) % 215, i % 4 ? 2 : 3, i % 4 ? 2 : 3, i % 3 ? '#b3c7cc' : '#ffe8ae');
    }
    ctx.fillStyle = '#aac5c1'; ctx.beginPath(); ctx.arc(516, 78, 37, 0, Math.PI * 2); ctx.fill();
    rect(490, 65, 30, 10, '#759da4'); rect(504, 89, 28, 9, '#759da4');
    ctx.fillStyle = '#3d4c69'; ctx.beginPath(); ctx.moveTo(0, 294); ctx.lineTo(110, 232); ctx.lineTo(220, 294); ctx.lineTo(348, 219); ctx.lineTo(476, 294); ctx.lineTo(575, 242); ctx.lineTo(640, 294); ctx.fill();
    rect(0, 294, 640, 66, '#d5c7aa'); rect(0, 294, 640, 5, '#fff0cc');
    for (let i = 0; i < 14; i++) rect(((i * 61 - game.distance * .6) % 680 + 680) % 680, 309 + i % 3 * 13, 18, 3, '#aa9c85');
    for (const object of game.objects) {
      if (object.kind === 'star') star(object.x + 10, object.y + 10);
      else { rect(object.x, object.y + 8, 26, 16, '#7d889a'); rect(object.x + 5, object.y, 16, 10, '#a3adba'); rect(object.x + 6, object.y + 12, 5, 5, '#54647b'); }
    }
    frog();
  }
  function racerScene() {
    rect(0, 0, 640, 360, '#a5c68a'); rect(140, 0, 320, 360, '#485d65');
    rect(136, 0, 5, 360, '#fff0c5'); rect(460, 0, 5, 360, '#fff0c5');
    for (let y = -60; y < 360; y += 60) {
      const offset = game.distance % 60;
      rect(247, y + offset, 5, 31, '#d9d7bd'); rect(347, y + offset, 5, 31, '#d9d7bd');
    }
    for (let i = 0; i < 8; i++) {
      const y = ((i * 90 + game.distance * .7) % 440) - 50;
      const x = i % 2 ? 520 : 70;
      rect(x + 9, y + 25, 8, 19, '#876e4b'); rect(x, y, 26, 31, '#6c9860'); rect(x + 6, y - 8, 15, 18, '#7dab6b');
    }
    for (const object of game.objects) {
      if (object.kind === 'star') star(object.x + 10, object.y + 10);
      else {
        ctx.fillStyle = '#ed9b58'; ctx.beginPath(); ctx.moveTo(object.x + 15, object.y); ctx.lineTo(object.x + 30, object.y + 30); ctx.lineTo(object.x, object.y + 30); ctx.fill();
        rect(object.x + 9, object.y + 13, 13, 5, '#fff3d1'); rect(object.x - 3, object.y + 29, 36, 5, '#c57748');
      }
    }
    const p = engine.player(game);
    rect(p.x - 4, p.y + 8, 5, 13, '#203831'); rect(p.x + 37, p.y + 8, 5, 13, '#203831');
    rect(p.x - 4, p.y + 35, 5, 13, '#203831'); rect(p.x + 37, p.y + 35, 5, 13, '#203831');
    rect(p.x, p.y, 38, 54, config.playerColor || '#edb5a3');
    rect(p.x + 6, p.y + 11, 26, 14, '#bddbdd'); rect(p.x + 7, p.y + 34, 24, 10, '#a76e71');
    rect(p.x + 4, p.y + 2, 7, 5, '#fff0b6'); rect(p.x + 27, p.y + 2, 7, 5, '#fff0b6');
  }
  function tick(now) {
    if (!previous) previous = now;
    let elapsed = Math.min((now - previous) / 1000, .1); previous = now;
    while (elapsed > 0) { const step = Math.min(elapsed, 1 / 60); engine.step(game, step); elapsed -= step; }
    if (config.kind === 'moon') moonScene(); else racerScene();
    document.getElementById('score').textContent = String(game.score);
    document.getElementById('stars').textContent = String(game.stars);
    document.getElementById('time-left').textContent = String(Math.max(0, Math.ceil(game.config.duration - game.time)));
    if (lastPhase !== game.phase) {
      lastPhase = game.phase;
      pause.disabled = !['playing', 'paused'].includes(game.phase);
      for (const button of movement.querySelectorAll('button')) button.disabled = game.phase !== 'playing';
      document.getElementById('round-status').textContent = ({ ready: 'Ready to play', playing: 'Round in progress', paused: 'Paused · your round is safe here', over: 'Round finished · try again', won: 'Journey complete!' })[game.phase];
    }
    document.getElementById('progress').value = Math.min(100, game.time / game.config.duration * 100);
    if (['over', 'won'].includes(game.phase)) finish();
    requestAnimationFrame(tick);
  }
  reset(); showOverlay(config.kind === 'moon' ? 'One giant little leap.' : 'Small car. Big adventure.', config.description, "Let's play");
  if (parent !== window) parent.postMessage({ type: 'kidos:game-ready' }, '*');
  requestAnimationFrame(tick);
})();
