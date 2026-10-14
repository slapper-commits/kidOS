import { StoreError, exactKeys, isRecord } from '../../packages/app-contract/manifest.mjs';
import { GAME_IDS } from './games.mjs';

export const ROUND_ID = /^[0-9a-f]{32}$/;
const natural = n => Number.isSafeInteger(n) && n >= 0;
export const emptyProgress = () => ({ best: 0, last: 0, rounds: 0, wins: 0, recentRounds: [], updatedAt: null });
export function validateGameId(id) {
  if (!GAME_IDS.includes(id)) throw new StoreError('Game not found.', 404);
}
export function validateResult(result) {
  exactKeys(result, ['roundId', 'score', 'won'], 'Game result');
  if (typeof result.roundId !== 'string' || !ROUND_ID.test(result.roundId) || !natural(result.score) || result.score > 100000 || typeof result.won !== 'boolean') throw new StoreError('Invalid game result.');
  return result;
}
export function validateProgressMap(games) {
  if (!isRecord(games)) throw new StoreError('Invalid game progress.');
  for (const [id, record] of Object.entries(games)) {
    validateGameId(id);
    exactKeys(record, ['best', 'last', 'rounds', 'wins', 'recentRounds', 'updatedAt'], 'Saved game progress');
    if (![record.best, record.last, record.rounds, record.wins].every(natural) || record.best > 100000 || record.rounds < 1 || record.updatedAt === null || record.last > record.best || record.wins > record.rounds ||
      !Array.isArray(record.recentRounds) || record.recentRounds.length < 1 || record.recentRounds.length > 128 || record.recentRounds.length > record.rounds || new Set(record.recentRounds).size !== record.recentRounds.length ||
      !record.recentRounds.every(id => typeof id === 'string' && ROUND_ID.test(id)) ||
      (record.updatedAt !== null && (typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt)) || new Date(record.updatedAt).toISOString() !== record.updatedAt))) {
      throw new StoreError('Invalid saved game progress.');
    }
  }
}
