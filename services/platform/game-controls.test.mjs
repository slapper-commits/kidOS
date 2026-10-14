import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
const rules = await readFile(new URL('../../apps/games/engine.js', import.meta.url), 'utf8');
const player = await readFile(new URL('../../apps/games/play.js', import.meta.url), 'utf8');

function playerFixture(kind) {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.events = new Map(); this.hidden = false; this.disabled = false; this.isConnected = true; }
    addEventListener(type, fn) { this.events.set(type, fn); }
    fire(type, extra = {}) { const event = { target: this, currentTarget: this, preventDefault() { this.prevented = true; }, ...extra }; this.events.get(type)?.(event); return event; }
    setAttribute() {}
    append(item) { this.children.push(item); }
    after() {}
    remove() { this.isConnected = false; }
    focus() {}
    closest(selector) { return selector.split(',').includes(this.tag) ? this : null; }
    querySelectorAll(tag) { return this.children.filter(child => child.tag === tag); }
    getBoundingClientRect() { return { left: 0, width: 640 }; }
    getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); }
  }
  const elements = Object.fromEntries(['game', 'overlay', 'message', 'description', 'start', 'pause', 'save-status', 'title', 'instructions', 'help-text', 'help', 'score', 'best', 'stars', 'time-left', 'round-status', 'movement', 'progress'].map(id => [id, new Element(['start', 'pause'].includes(id) ? 'button' : id === 'game' ? 'canvas' : 'div')]));
  const document = new Element('document'); document.getElementById = id => elements[id]; document.createElement = tag => new Element(tag);
  const window = new Element('window'); let nextFrame, game;
  const context = vm.createContext({ document, window, parent: window, crypto: webcrypto, setTimeout, clearTimeout, requestAnimationFrame: fn => { nextFrame = fn; }, KidOSGame: { kind, name: 'Control test', description: 'Practice', duration: 40, speed: 180 } });
  vm.runInContext(rules, context);
  const actual = context.KidOSGameEngine;
  context.KidOSGameEngine = { ...actual, create: (...args) => (game = actual.create(...args)) };
  vm.runInContext(player, context);
  return { elements, document, window, game: () => game, frame: now => nextFrame(now), key: (key, target = elements.game) => document.fire('keydown', { key, target, repeat: false }) };
}

test('game keyboard and on-screen controls start, move, pause, resume, and preserve native button activation', () => {
  const f = playerFixture('racer'); f.frame(1);
  assert.equal(f.elements.pause.disabled, true);
  assert.equal(f.elements.movement.children[0].disabled, true);
  f.key('Enter'); assert.equal(f.game().phase, 'playing'); f.frame(17);
  assert.equal(f.elements.pause.disabled, false);
  assert.equal(f.elements.movement.children[0].disabled, false);
  f.elements.movement.children[0].fire('click'); assert.equal(f.game().lane, 0);
  f.key('ArrowRight'); assert.equal(f.game().lane, 1);
  f.key('p', f.elements.pause); assert.equal(f.game().phase, 'paused'); f.frame(33);
  assert.match(f.elements['round-status'].textContent, /^Paused/);
  const native = f.key('Enter', f.elements.start); assert.equal(native.prevented, undefined); assert.equal(f.game().phase, 'paused');
  f.elements.start.fire('click'); assert.equal(f.game().phase, 'playing');
  f.window.fire('blur'); assert.equal(f.game().phase, 'paused');
  f.key('Enter'); assert.equal(f.game().phase, 'playing');
  f.elements.help.open = true; f.elements.help.fire('toggle'); assert.equal(f.game().phase, 'paused');
});

test('moon pointer jump, helpful HUD, finish and keyboard replay use the real game engine', () => {
  const f = playerFixture('moon'); f.elements.start.fire('click');
  f.elements.game.fire('pointerdown', { clientX: 100 }); assert.equal(f.game().grounded, false);
  f.frame(1); assert.equal(f.elements['time-left'].textContent, '40'); assert.equal(f.elements.stars.textContent, '0');
  f.game().phase = 'over'; f.game().score = 17; f.game().stars = 1; f.frame(17);
  assert.equal(f.elements.start.textContent, 'Play again'); assert.equal(f.elements.best.textContent, '17');
  assert.equal(f.elements.pause.disabled, true); assert.equal(f.elements.stars.textContent, '1');
  f.key('Enter'); assert.equal(f.game().phase, 'playing'); assert.equal(f.game().score, 0);
  assert.equal(f.elements.best.textContent, '17');
});
