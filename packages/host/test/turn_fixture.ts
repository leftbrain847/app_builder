// A tiny turn-based game for the platform's own tests: players take turns
// adding 1-3 to a shared counter; whoever reaches the target wins. Each player
// also holds a secret number nobody else may ever see (hidden information).
import { defineGame, type GameInstance } from '../src/turn/game.ts';

export interface Settings { target: number }
interface State { order: string[]; turn: number; total: number; secrets: Record<string, number>; bots: string[]; winner: string | null }
type Action = { type: 'add'; n: number; player_id: string };
interface View { total: number; turn: string; mySecret: number | null; secretsSeen: number; winner: string | null }
type Event = { kind: 'added'; by: string; n: number; secret?: number };

export const PEEK = 'secret';

function instance(settings: Settings): GameInstance<State, Action, View, Event> {
  return {
    init(seats, seed) {
      const secrets: Record<string, number> = {};
      seats.forEach((s, i) => (secrets[s.id] = 1000 + ((seed + i * 7919) % 9000)));
      return { state: { order: seats.map((s) => s.id), turn: 0, total: 0, secrets, bots: seats.filter((s) => s.isBot).map((s) => s.id), winner: null }, events: [] };
    },
    parseAction(type, params, playerId) {
      if (type !== 'add' || typeof params !== 'object' || params === null) return null;
      const n = (params as { n?: unknown }).n;
      return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 3 ? { type: 'add', n: n as number, player_id: playerId } : null;
    },
    reduce(state, a) {
      if (state.winner) return { ok: false, error: 'over' };
      if (state.order[state.turn] !== a.player_id) return { ok: false, error: 'not your turn' };
      const total = state.total + a.n;
      const next: State = { ...state, total, turn: (state.turn + 1) % state.order.length, winner: total >= settings.target ? a.player_id : null };
      return { ok: true, state: next, events: [{ kind: 'added', by: a.player_id, n: a.n, secret: state.secrets[a.player_id]! }] };
    },
    viewFor(state, playerId) {
      return { total: state.total, turn: state.order[state.turn]!, mySecret: state.secrets[playerId] ?? null, secretsSeen: 1, winner: state.winner };
    },
    redactEvents(events, playerId) {
      return events.map((e) => (e.by === playerId ? e : { kind: e.kind, by: e.by, n: e.n }));
    },
    clientConfig: () => ({ target: settings.target }),
    isOver: (state) => state.winner !== null,
    result(state) {
      const seats: Record<string, { won: boolean; score: number; extras: Record<string, number> }> = {};
      for (const id of state.order) seats[id] = { won: id === state.winner, score: id === state.winner ? 1 : 0, extras: {} };
      return { winner: state.winner, seats };
    },
    waitingOn: (state) => ({ key: `t${state.total}`, seats: state.winner ? [] : [state.order[state.turn]!] }),
    setSeatBot(state, seatId, isBot) {
      const bots = state.bots.filter((b) => b !== seatId);
      return { ...state, bots: isBot ? [...bots, seatId] : bots };
    },
    timers: { sync: () => undefined, due: () => [], next: () => null, deadlines: () => ({}) },
    bots: {
      plan(state, botSeats) {
        const who = state.order[state.turn]!;
        return !state.winner && botSeats.includes(who) ? [{ type: 'add', n: 1, player_id: who }] : [];
      },
      delayMs: () => 500,
    },
  };
}

export const counterGame = defineGame<Settings, State, Action, View, Event>({
  id: 'counter',
  limits: { minPlayers: 2, maxPlayers: 4 },
  defaultSettings: () => ({ target: 10 }),
  parseSettings(raw) {
    const t = (raw as { target?: unknown } | null)?.target;
    return Number.isInteger(t) && (t as number) >= 3 && (t as number) <= 50 ? { target: t as number } : null;
  },
  create: (settings) => instance(settings),
});
