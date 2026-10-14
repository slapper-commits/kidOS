import { readFile } from 'node:fs/promises';
import { StoreError } from '../../packages/app-contract/manifest.mjs';

export const GAMES = Object.freeze([
  { id: 'moon-hopper', name: 'Moon Hopper', kind: 'moon', description: 'A little frog, a low-gravity moon, and a pocketful of stars.', controls: 'Space / ↑ to jump', duration: 40, speed: 185, gravity: 1150, jump: 470, spawnEvery: 1.8, playerColor: '#b7d588' },
  { id: 'tiny-racer', name: 'Tiny Racer', kind: 'racer', description: 'Find your lane, dodge the cones, and cruise all the way home.', controls: '← → to steer', duration: 40, speed: 175, spawnEvery: 1.55, playerColor: '#edb5a3' },
]);
export const GAME_IDS = GAMES.map(game => game.id);
export function gameInfo(id) {
  const game = GAMES.find(game => game.id === id);
  if (!game) throw new StoreError('Game not found.', 404);
  return { ...game };
}
export async function loadGameFiles() {
  const names = ['index.html', 'style.css', 'engine.js', 'play.js'];
  const common = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(new URL(`../../apps/games/${name}`, import.meta.url), 'utf8')])));
  return Object.fromEntries(GAMES.map(game => [game.id, {
    ...common,
    'script.js': `// Make it yours: try a new playerColor, speed, or jump height.\n// Changes affect your copy only. Keep the name to 60 characters.\nglobalThis.KidOSGame = ${JSON.stringify(game, null, 2)};\n`,
    'README.txt': `${game.name}\n\nOpen script.js to change colors, speed, or the jumping rules.\nstyle.css changes the buttons and page. engine.js contains the game rules.\nplay.js draws the world and handles controls.\n\nSave, Preview, then Install app with a new version to put your remix on the desktop.\nOriginal game scores save when launched from Play. Remix scores currently last only for the open window.\nAll art and code are original kidOS material. No external files are needed.\n`,
  }]));
}
