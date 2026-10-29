import type { GameModule } from '../src/gameModule';

/** Deterministic die for the test app: same seed and play → same face. */
export const die = (seed: number, play: number): number => (((seed ^ (play * 2654435761)) >>> 0) % 6) + 1;

interface DiceRun {
  seed: number;
  play: number;
  points: number;
}
interface DiceSegment {
  play: number;
  guess: number;
}

/**
 * A tiny solo app with server replay: guess the die each play (three plays).
 * A right guess is 10 points, a wrong one 1. A segment for the wrong play
 * number is something the real client could never send, so it's rejected.
 */
export const diceApp: GameModule<{ plays: number }, null, never, null> = {
  id: 'dice',
  defaultConfig: { plays: 3 },
  limits: { tickHz: 0, snapshotHz: 0, minPlayers: 1, maxPlayers: 1, maxMsgBytes: 256, maxInputsPerSec: 5 },
  parseInput: () => null,
  init: () => null,
  onInput: () => undefined,
  viewFor: () => null,
  isOver: () => true,
  solo: {
    start: (_cfg, seed): DiceRun => ({ seed, play: 0, points: 0 }),
    parseSegment: (raw): DiceSegment | null => {
      if (typeof raw !== 'object' || raw === null) return null;
      const r = raw as Record<string, unknown>;
      if (Object.keys(r).length !== 2) return null;
      return Number.isInteger(r.play) && Number.isInteger(r.guess) && (r.guess as number) >= 1 && (r.guess as number) <= 6 ? { play: r.play as number, guess: r.guess as number } : null;
    },
    apply: (cfg, run, seg) => {
      const r = run as DiceRun;
      const s = seg as DiceSegment;
      if (s.play !== r.play + 1 || s.play > cfg.plays) return { error: 'out of order' };
      return { run: { ...r, play: s.play, points: r.points + (s.guess === die(r.seed, s.play) ? 10 : 1) } };
    },
    isOver: (run) => (run as DiceRun).play >= 3,
    score: (run) => (run as DiceRun).points,
    maxSegmentBytes: 1024,
    maxSegments: 10,
  },
};

/** What an honest client would submit for `seed`, and the run it ends with. */
export function playLikeTheClient(seed: number): { segments: DiceSegment[]; run: DiceRun } {
  const segments = [1, 2, 3].map((play) => ({ play, guess: play === 2 ? (die(seed, play) % 6) + 1 : die(seed, play) }));
  let run: DiceRun = { seed, play: 0, points: 0 };
  for (const s of segments) run = { seed, play: s.play, points: run.points + (s.guess === die(seed, s.play) ? 10 : 1) };
  return { segments, run };
}

interface RaceState {
  order: string[];
  turn: number;
  total: number;
  by: Record<string, number>;
}

/** A turn-based test app: players take turns adding 1–3; first to push the total to 10 or more ends it. Only the player whose turn it is may move. */
export const raceApp: GameModule<{ target: number }, RaceState, { add: number }, { yourTurn: boolean; total: number; mine: number }> = {
  id: 'race',
  defaultConfig: { target: 10 },
  limits: { tickHz: 0, snapshotHz: 0, minPlayers: 2, maxPlayers: 2, maxMsgBytes: 128, maxInputsPerSec: 5 },
  parseInput: (raw) => {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    return Object.keys(r).length === 1 && Number.isInteger(r.add) && (r.add as number) >= 1 && (r.add as number) <= 3 ? { add: r.add as number } : null;
  },
  init: (_cfg, players) => ({ order: players, turn: 0, total: 0, by: {} }),
  onInput: (s, player, input) => {
    if (s.order[s.turn % s.order.length] !== player) return;
    s.total += input.add;
    s.by[player] = (s.by[player] ?? 0) + input.add;
    s.turn++;
  },
  viewFor: (s, player) => ({ yourTurn: s.order[s.turn % s.order.length] === player, total: s.total, mine: s.by[player] ?? 0 }),
  isOver: (s) => s.total >= 10,
};
