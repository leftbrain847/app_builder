// Note: lives at src/app.ts in a generated app; imports are relative to that location.
/**
 * Sample turn-based multiplayer app: players take turns adding 1–3; whoever
 * pushes the total to the target wins. Replace the rules with your own; keep
 * the shape. The server is authoritative: clients only send intentions, and
 * each player gets only their own view.
 */
import type { GameModule } from '@app-builder/host';
import config from '../app.config.json';

export interface Rules {
  target: number;
  maxAdd: number;
  players: number;
}

export const DEFAULT_RULES: Rules = { target: 21, maxAdd: 3, players: 2 };

export interface State {
  order: string[];
  turn: number;
  total: number;
  winner: string | null;
}

export interface Input {
  add: number;
}

export interface View {
  seat: number;
  yourTurn: boolean;
  total: number;
  target: number;
  youWon: boolean | null;
}

export function move(rules: Rules, s: State, player: string, input: Input): void {
  if (s.winner || s.order[s.turn % s.order.length] !== player) return;
  s.total += input.add;
  s.turn++;
  if (s.total >= rules.target) s.winner = player;
}

export const app: GameModule<Rules, State, Input, View> = {
  id: config.id,
  defaultConfig: DEFAULT_RULES,
  // tickHz 0 = turn-based: no server loop, the room sleeps between moves.
  limits: { tickHz: 0, snapshotHz: 0, minPlayers: DEFAULT_RULES.players, maxPlayers: DEFAULT_RULES.players, maxMsgBytes: 128, maxInputsPerSec: 5 },
  parseInput: (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    return Object.keys(r).length === 1 && Number.isInteger(r.add) && (r.add as number) >= 1 && (r.add as number) <= DEFAULT_RULES.maxAdd ? { add: r.add as number } : null;
  },
  init: (_rules, players) => ({ order: players, turn: 0, total: 0, winner: null }),
  onInput: (s, player, input) => move(DEFAULT_RULES, s, player, input),
  viewFor: (s, player) => ({
    seat: s.order.indexOf(player),
    yourTurn: !s.winner && s.order[s.turn % s.order.length] === player,
    total: s.total,
    target: DEFAULT_RULES.target,
    youWon: s.winner ? s.winner === player : null,
  }),
  isOver: (s) => s.winner !== null,
};
