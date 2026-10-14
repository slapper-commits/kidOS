// Original kidOS game rules. No browser or filesystem APIs in this file.
// Both the canvas player and automated tests use these exact rules.
globalThis.KidOSGameEngine = (() => {
  const WIDTH = 640, HEIGHT = 360, GROUND = 294;
  function random(state) {
    state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
    return state.seed / 4294967296;
  }
  function create(config, seed = 12345) {
    return {
      config: { duration: 40, speed: 190, gravity: 1150, jump: 470, spawnEvery: 1.65, ...config },
      seed: seed >>> 0, phase: 'ready', time: 0, distance: 0, score: 0, stars: 0,
      lane: 1, y: GROUND - 30, velocity: 0, grounded: true,
      nextSpawn: 1.4, objects: [], nextObject: 1,
    };
  }
  function action(state, action) {
    if (action === 'start' && state.phase === 'ready') { state.phase = 'playing'; return true; }
    if (action === 'pause' && ['playing', 'paused'].includes(state.phase)) {
      state.phase = state.phase === 'playing' ? 'paused' : 'playing'; return true;
    }
    if (state.phase !== 'playing') return false;
    if (state.config.kind === 'moon') {
      if (action === 'jump' && state.grounded) {
        state.velocity = -state.config.jump; state.grounded = false; return true;
      }
    } else if (action === 'left' || action === 'right') {
      state.lane = Math.max(0, Math.min(2, state.lane + (action === 'left' ? -1 : 1)));
      return true;
    }
    return false;
  }
  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function player(state) {
    return state.config.kind === 'moon'
      ? { x: 104, y: state.y + 3, w: 25, h: 27 }
      : { x: 180 + state.lane * 100, y: 282, w: 38, h: 54 };
  }
  function spawn(state) {
    if (state.config.kind === 'moon') {
      state.objects.push({ id: state.nextObject++, kind: 'rock', x: WIDTH + 10, y: GROUND - 24, w: 26, h: 24 });
      state.objects.push({ id: state.nextObject++, kind: 'star', x: WIDTH + 13, y: GROUND - 99, w: 20, h: 20 });
    } else {
      const lane = Math.floor(random(state) * 3);
      const starLane = (lane + 1 + Math.floor(random(state) * 2)) % 3;
      state.objects.push({ id: state.nextObject++, kind: 'cone', x: 184 + lane * 100, y: -40, w: 30, h: 33 });
      state.objects.push({ id: state.nextObject++, kind: 'star', x: 190 + starLane * 100, y: -35, w: 20, h: 20 });
    }
  }
  function step(state, seconds) {
    if (state.phase !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return state;
    // A short fixed step prevents objects tunneling through the player.
    const dt = Math.min(seconds, 1 / 30);
    state.time += dt;
    state.distance += state.config.speed * dt;
    if (state.config.kind === 'moon') {
      state.velocity += state.config.gravity * dt;
      state.y += state.velocity * dt;
      if (state.y >= GROUND - 30) { state.y = GROUND - 30; state.velocity = 0; state.grounded = true; }
    }
    if (state.time >= state.nextSpawn) {
      spawn(state);
      state.nextSpawn += Math.max(1.1, state.config.spawnEvery);
    }
    const body = player(state);
    for (const object of state.objects) {
      if (state.config.kind === 'moon') object.x -= state.config.speed * dt;
      else object.y += state.config.speed * dt;
      if (!object.collected && overlaps(body, object)) {
        if (object.kind === 'star') { object.collected = true; state.stars += 1; }
        else state.phase = 'over';
      }
    }
    state.objects = state.objects.filter(object => !object.collected && object.x > -50 && object.y < HEIGHT + 50);
    state.score = Math.min(100000, Math.floor(state.distance / 40) + state.stars * 10);
    if (state.phase === 'playing' && state.time >= state.config.duration) { state.phase = 'won'; state.score = Math.min(100000, state.score + 50); }
    return state;
  }
  return Object.freeze({ create, action, step, player, overlaps, WIDTH, HEIGHT, GROUND });
})();
