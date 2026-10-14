import test from 'node:test';
import assert from 'node:assert/strict';
import '../../apps/games/engine.js';
import { GAMES, loadGameFiles } from './games.mjs';
import { createGameBridge } from '../../apps/desktop/game-bridge.mjs';
const engine = globalThis.KidOSGameEngine;
const advance = (game, seconds) => { for (let i = 0; i < Math.ceil(seconds * 60); i++) engine.step(game, 1 / 60); };
const start = kind => { const game = engine.create(GAMES.find(g => g.kind === kind), 42); engine.action(game, 'start'); return game; };

test('Moon Hopper: grounded jump, no double jump, landing, rock collision and star collection', () => {
  const game = start('moon');
  assert.equal(engine.action(game, 'jump'), true);
  assert.equal(engine.action(game, 'jump'), false);
  advance(game, .2); assert.ok(game.y < 210);
  advance(game, 1); assert.equal(game.grounded, true); assert.equal(game.y, 264);
  game.objects = [{ ...engine.player(game), id: 1, kind: 'star' }];
  engine.step(game, 1 / 60); assert.equal(game.stars, 1); assert.equal(game.objects.length, 0);
  engine.step(game, 1 / 60); assert.equal(game.stars, 1);
  game.objects = [{ ...engine.player(game), id: 2, kind: 'rock' }];
  engine.step(game, 1 / 60); assert.equal(game.phase, 'over');
  const stopped = structuredClone(game); advance(game, 2); assert.deepEqual(game, stopped);
});

test('Tiny Racer: lane boundaries, dodging and collision use the same rules as the player', () => {
  const game = start('racer');
  for (let i = 0; i < 5; i++) engine.action(game, 'left');
  assert.equal(game.lane, 0);
  for (let i = 0; i < 5; i++) engine.action(game, 'right');
  assert.equal(game.lane, 2);
  game.objects = [{ ...engine.player(game), id: 1, kind: 'cone' }];
  engine.action(game, 'left'); engine.step(game, 1 / 60);
  assert.equal(game.phase, 'playing');
  engine.action(game, 'right'); engine.step(game, 1 / 60);
  assert.equal(game.phase, 'over');
});

test('pause freezes input/time/score; a completed round awards its bonus only once', () => {
  for (const kind of ['moon', 'racer']) {
    const game = start(kind); advance(game, .5); engine.action(game, 'pause');
    const paused = structuredClone(game); advance(game, 5);
    assert.equal(engine.action(game, kind === 'moon' ? 'jump' : 'left'), false);
    assert.deepEqual(game, paused);
    engine.action(game, 'pause'); game.config.duration = .6;
    advance(game, .2); assert.equal(game.phase, 'won'); assert.ok(game.score >= 50);
    const won = structuredClone(game); advance(game, 2); assert.deepEqual(game, won);
  }
});

test('seeded racer spawns are repeatable and always leave lanes open', () => {
  const a = start('racer'), b = start('racer'); advance(a, 1.5); advance(b, 1.5);
  assert.deepEqual(a, b); assert.equal(a.objects.length, 2);
  assert.notEqual(Math.floor((a.objects[0].x - 180) / 100), Math.floor((a.objects[1].x - 180) / 100));
  for (const value of [NaN, Infinity, -1, 0]) { const before = structuredClone(a); engine.step(a, value); assert.deepEqual(a, before); }
});

test('both original games can be completed with their shipped controls and settings', () => {
  for (const kind of ['moon', 'racer']) {
    const game = start(kind);
    for (let i = 0; i < 2500 && game.phase === 'playing'; i++) {
      if (kind === 'moon') {
        const rock = game.objects.find(o => o.kind === 'rock' && o.x > 95 && o.x < 180);
        if (rock && game.grounded) engine.action(game, 'jump');
      } else {
        const danger = game.objects.find(o => o.kind === 'cone' && o.y > 200 && o.y < 340 && Math.abs(o.x - engine.player(game).x) < 50);
        if (danger) engine.action(game, game.lane === 2 ? 'left' : 'right');
      }
      engine.step(game, 1 / 60);
    }
    assert.equal(game.phase, 'won', kind); assert.ok(game.score >= 200);
  }
});

test('game copies include all local executable assets and independently editable settings', async () => {
  const files = await loadGameFiles();
  for (const game of GAMES) {
    assert.equal(Object.keys(files[game.id]).length, 6);
    for (const match of files[game.id]['index.html'].matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(Object.hasOwn(files[game.id], match[1]), match[1]);
    assert.match(files[game.id]['script.js'], new RegExp(game.name));
  }
  const original = files['tiny-racer']['engine.js']; files['moon-hopper']['engine.js'] = 'changed';
  assert.equal(files['tiny-racer']['engine.js'], original);
});

function bridgeFixture(save) {
  const sent = [], child = { postMessage: message => sent.push(message) };
  const run = { kind: 'game', gameId: 'moon-hopper', progress: { best: 10 } };
  const handler = createGameBridge({ getFrame: () => ({ contentWindow: child }), getRun: () => run, save });
  const data = { type: 'kidos:game-score', roundId: 'a'.repeat(32), score: 20, won: true };
  return { sent, child, run, handler, data, event: { source: child, origin: 'null', data } };
}
test('score bridge rejects other windows, normal origins, installed apps and malformed capabilities', async () => {
  let calls = 0;
  const f = bridgeFixture(() => { calls++; return { best: 20 }; });
  for (const changes of [{ source: {} }, { origin: 'http://127.0.0.1:8788' }, { data: { ...f.data, gameId: 'tiny-racer' } }, { data: { ...f.data, score: Infinity } }, { data: { ...f.data, roundId: '../bad' } }]) await f.handler({ ...f.event, ...changes });
  f.run.kind = 'installed'; await f.handler(f.event); assert.equal(calls, 0);
  f.run.kind = 'game'; await f.handler({ ...f.event, data: { type: 'kidos:game-ready' } });
  assert.deepEqual(f.sent[0], { type: 'kidos:game-state', best: 10 });
  await f.handler(f.event); assert.equal(calls, 1);
  assert.deepEqual(f.sent.at(-1), { type: 'kidos:game-saved', roundId: f.data.roundId, ok: true });
});
test('score bridge coalesces duplicate saves and returns a retryable failure', async () => {
  let resolveSave, calls = 0;
  const f = bridgeFixture((id, result) => { calls++; assert.equal(id, 'moon-hopper'); assert.equal(result.score, 20); return new Promise(resolve => { resolveSave = resolve; }); });
  const a = f.handler(f.event), b = f.handler(f.event);
  await Promise.resolve(); assert.equal(calls, 1); resolveSave({ best: 20 }); await Promise.all([a, b]);
  assert.equal(f.run.progress.best, 20);
  const failed = bridgeFixture(async () => { throw new Error('Disk full'); });
  await failed.handler(failed.event); assert.equal(failed.sent.at(-1).ok, false);
});

test('score bridge resolves simultaneous games by their source and excludes other app windows', async () => {
  const windows = new Map(), calls = [], resolvers = new Map();
  function add(gameId, kind = 'game') {
    const messages = [], source = { postMessage: message => messages.push(message) };
    const run = { kind, gameId, progress: { best: 0 } };
    windows.set(source, { frame: { contentWindow: source }, run });
    return { source, run, messages };
  }
  const moon = add('moon-hopper'), racer = add('tiny-racer'), installed = add('moon-hopper', 'installed');
  const handler = createGameBridge({
    resolveSource: source => windows.get(source),
    save: (id, result) => { calls.push({ id, result }); return new Promise(resolve => resolvers.set(id, resolve)); },
  });
  const score = (source, number = 20) => ({ source, origin: 'null', data: { type: 'kidos:game-score', roundId: 'b'.repeat(32), score: number, won: true } });
  await handler(score(installed.source));
  await handler(score({}));
  await handler({ ...score(moon.source), origin: 'http://127.0.0.1:8788' });
  const spoofed = {};
  windows.set(spoofed, windows.get(moon.source));
  await handler(score(spoofed));
  assert.equal(calls.length, 0);

  const savingMoon = handler(score(moon.source)), savingRacer = handler(score(racer.source, 30));
  await Promise.resolve();
  assert.deepEqual(calls.map(value => value.id), ['moon-hopper', 'tiny-racer']);
  resolvers.get('tiny-racer')({ best: 30 });
  await savingRacer;
  assert.equal(racer.run.progress.best, 30);
  assert.equal(moon.messages.length, 0);
  resolvers.get('moon-hopper')({ best: 20 });
  await savingMoon;
  assert.equal(moon.run.progress.best, 20);
  assert.equal(moon.messages.at(-1).ok, true);
  assert.equal(racer.messages.at(-1).ok, true);
  assert.equal(installed.messages.length, 0);
});

test('score bridge rejects closed sources and does not acknowledge a replacement run after an old save', async () => {
  const windows = new Map(), messages = [], saved = [];
  const source = { postMessage: message => messages.push(message) };
  const frame = { contentWindow: source };
  const oldRun = { kind: 'game', gameId: 'moon-hopper', progress: { best: 5 } };
  windows.set(source, { frame, run: oldRun });
  let resolveSave, calls = 0;
  const handler = createGameBridge({
    resolveSource: value => windows.get(value),
    save: () => { calls++; return new Promise(resolve => { resolveSave = resolve; }); },
    onSaved: (id, progress) => saved.push({ id, progress }),
  });
  const event = { source, origin: 'null', data: { type: 'kidos:game-score', roundId: 'c'.repeat(32), score: 40, won: true } };
  const saving = handler(event);
  await Promise.resolve();
  windows.delete(source);
  await handler({ source, origin: 'null', data: { type: 'kidos:game-ready' } });
  await handler(event);
  assert.equal(calls, 1);
  assert.equal(messages.length, 0);

  // Even reusing the WindowProxy must not attach the old request to a new run.
  const newRun = { kind: 'game', gameId: 'tiny-racer', progress: { best: 7 } };
  windows.set(source, { frame, run: newRun });
  resolveSave({ best: 40 });
  await saving;
  assert.equal(oldRun.progress.best, 5);
  assert.equal(newRun.progress.best, 7);
  assert.equal(messages.length, 0);
  assert.deepEqual(saved, [{ id: 'moon-hopper', progress: { best: 40 } }]);
  await handler({ source, origin: 'null', data: { type: 'kidos:game-ready' } });
  assert.deepEqual(messages, [{ type: 'kidos:game-state', best: 7 }]);
});
