import { describe, expect, it } from 'vitest';
import { HOST_CONFIG } from '../src/config';
import type { GameModule } from '../src/gameModule';
import { admit, freshRate } from '../src/rateLimit';
import { RoomCore } from '../src/roomCore';
import { raceApp } from './apps';

/** A two-player test game with hidden hands: each player may see only their own. */
interface S {
  hands: Record<string, number>;
  total: number;
  ticks: number;
}
const cardGame: GameModule<{ endAfter: number }, S, { add: number }, { mine: number; total: number }> = {
  id: 'cards',
  defaultConfig: { endAfter: 40 },
  limits: { tickHz: 20, snapshotHz: 10, minPlayers: 2, maxPlayers: 2, maxMsgBytes: 128, maxInputsPerSec: 5 },
  parseInput: (raw) => {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    return Object.keys(r).length === 1 && typeof r.add === 'number' && Number.isInteger(r.add) && r.add >= 1 && r.add <= 3 ? { add: r.add } : null;
  },
  init: (_cfg, players, seed) => ({ hands: Object.fromEntries(players.map((p, i) => [p, (seed + i * 7) % 10])), total: 0, ticks: 0 }),
  onInput: (s, player, input) => {
    s.hands[player] = (s.hands[player] ?? 0) + input.add;
    s.total += input.add;
  },
  tick: (s) => void s.ticks++,
  viewFor: (s, player) => ({ mine: s.hands[player] ?? 0, total: s.total }),
  isOver: (s) => s.ticks >= 40,
};
type Any = GameModule<unknown, unknown, unknown, unknown>;
const room = () => new RoomCore(cardGame as unknown as Any, HOST_CONFIG, 3);
const input = (add: unknown, s = 1) => JSON.stringify({ t: 'input', s, d: { add } });

describe('room', () => {
  it('binds seats to the verified identity: rejoining reclaims the seat, a third player is turned away', () => {
    const r = room();
    expect(r.join('a@x', 0).ok).toBe(true);
    expect(r.started).toBe(false);
    expect(r.join('b@x', 0).ok).toBe(true);
    expect(r.started).toBe(true);
    expect(r.join('c@x', 0)).toEqual({ ok: false, code: 'room_full' });
    r.leave('a@x', 10);
    const back = r.join('a@x', 20);
    expect(back.ok && back.welcome.d).toMatchObject({ seat: 0 });
  });

  it('holds a seat for the grace period before the game starts, then frees it', () => {
    const r = new RoomCore({ ...cardGame, limits: { ...cardGame.limits, minPlayers: 3, maxPlayers: 2 } } as unknown as Any, HOST_CONFIG, 1);
    r.join('a@x', 0);
    r.join('b@x', 0);
    r.leave('b@x', 1000);
    expect(r.join('c@x', 1000 + HOST_CONFIG.seatGraceMs - 1)).toEqual({ ok: false, code: 'room_full' });
    expect(r.join('c@x', 1000 + HOST_CONFIG.seatGraceMs + 1).ok).toBe(true);
  });

  it('a socket can only act for its own seat; someone without a seat is cut off', () => {
    const r = room();
    r.join('a@x', 0);
    r.join('b@x', 0);
    expect(r.message('mallory@x', input(3), 0)).toEqual({ kind: 'close', code: 'rejected' });
    expect(r.message('a@x', input(3), 0)).toEqual({ kind: 'ok' });
    const views = Object.fromEntries(Array.from({ length: 2 }, () => r.tick()).flat().map((o) => [o.player, o.msg.d]));
    expect((views['a@x'] as { mine: number }).mine).toBe((3 % 10) + 3);
    expect((views['b@x'] as { mine: number }).mine).toBe((3 + 7) % 10);
  });

  it('each player gets only their own view: the other hand never reaches them', () => {
    const r = room();
    r.join('a@x', 0);
    r.join('b@x', 0);
    const out = [r.tick(), r.tick()].flat();
    expect(out).toHaveLength(2);
    for (const o of out) expect(Object.keys(o.msg.d as object).sort()).toEqual(['mine', 'total']);
    expect(new Set(out.map((o) => o.player))).toEqual(new Set(['a@x', 'b@x']));
  });

  it('drops oversized, malformed and out-of-schema messages before they reach the game', () => {
    const r = room();
    r.join('a@x', 0);
    r.join('b@x', 0);
    const bad = ['x'.repeat(200), 'not json', '[]', '{"t":"input"}', '{"t":"input","s":1,"d":{"add":3},"x":1}', '{"t":"admin","s":1,"d":null}', input(99), input('3'), new ArrayBuffer(4)];
    for (const m of bad) expect(r.message('a@x', m, 0).kind).toBe('drop');
    expect(r.message('a@x', JSON.stringify({ t: 'ping', s: 1, d: null }), 0)).toEqual({ kind: 'ok' });
  });

  it('rate-limits inputs per player, and closes a socket that keeps flooding', () => {
    const r = room();
    r.join('a@x', 0);
    r.join('b@x', 0);
    const verdicts = Array.from({ length: 8 }, () => r.message('a@x', input(1), 500).kind);
    expect(verdicts).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'drop', 'drop', 'drop']);
    expect(r.message('b@x', input(1), 500).kind).toBe('ok');
    let last = 'ok';
    for (let i = 0; i < 1000 && last !== 'close'; i++) last = r.message('a@x', input(1), 1000 + i).kind;
    expect(last).toBe('close');
  });

  it('ticks at the game’s rate, snapshots at its snapshot rate, and stops when the game ends', () => {
    const r = room();
    r.join('a@x', 0);
    r.join('b@x', 0);
    const sent = Array.from({ length: 50 }, () => r.tick().length);
    expect(sent.slice(0, 4)).toEqual([0, 2, 0, 2]);
    expect(r.isOver).toBe(true);
    expect(sent[39]).toBe(2);
    expect(sent.slice(40).every((n) => n === 0)).toBe(true);
  });

  it('counts inbound messages and connections for the usage meter', () => {
    const r = room();
    r.join('a@x', 0);
    r.message('a@x', input(1), 0);
    r.message('a@x', 'junk', 0);
    expect(r.takeTally()).toEqual({ connections: 1, inboundMessages: 2 });
    expect(r.takeTally()).toEqual({ connections: 0, inboundMessages: 0 });
  });
});

describe('rate limit', () => {
  it('resets each second', () => {
    const s = freshRate();
    const lim = { perSec: 2, abusePerSec: 100, windowS: 5 };
    expect([admit(s, lim, 0), admit(s, lim, 10), admit(s, lim, 20), admit(s, lim, 1000)]).toEqual(['ok', 'ok', 'drop', 'ok']);
  });
});

describe('turn-based room (tickHz: 0)', () => {
  const race = () => new RoomCore(raceApp as unknown as Any, HOST_CONFIG, 5);
  const move = (add: number) => JSON.stringify({ t: 'input', s: 1, d: { add } });

  it('never ticks; each accepted move is answered with everyone’s own view', () => {
    const r = race();
    expect(r.turnBased).toBe(true);
    r.join('a@x', 0);
    r.join('b@x', 0);
    expect(r.tick()).toEqual([]);
    expect(r.message('a@x', move(3), 0)).toEqual({ kind: 'ok' });
    const views = Object.fromEntries(r.settle().map((o) => [o.player, o.msg.d]));
    expect(views).toEqual({ 'a@x': { yourTurn: false, total: 3, mine: 3 }, 'b@x': { yourTurn: true, total: 3, mine: 0 } });
  });

  it('a move out of turn changes nothing', () => {
    const r = race();
    r.join('a@x', 0);
    r.join('b@x', 0);
    r.message('b@x', move(3), 0);
    expect(r.settle().every((o) => (o.msg.d as { total: number }).total === 0)).toBe(true);
  });

  it('survives hibernation: a room rebuilt from its snapshot carries on where it left off', () => {
    const r = race();
    r.join('a@x', 0);
    r.join('b@x', 0);
    r.message('a@x', move(2), 0);
    const snap = structuredClone(r.snapshot());
    const back = RoomCore.restore(raceApp as unknown as Any, HOST_CONFIG, 5, snap);
    expect(back.connectedPlayers).toBe(0);
    back.reattach('a@x');
    back.reattach('b@x');
    expect(back.message('b@x', move(3), 1000)).toEqual({ kind: 'ok' });
    expect(back.settle().map((o) => (o.msg.d as { total: number }).total)).toEqual([5, 5]);
    expect(back.join('c@x', 2000)).toEqual({ ok: false, code: 'room_full' });
  });

  it('ends with an `over` message once the app says the game is over', () => {
    const r = race();
    r.join('a@x', 0);
    r.join('b@x', 0);
    for (const [p, n] of [['a@x', 3], ['b@x', 3], ['a@x', 3], ['b@x', 1]] as const) r.message(p, move(n), 0);
    const out = r.settle();
    expect(r.isOver).toBe(true);
    expect(out.map((o) => o.msg.t)).toEqual(['over', 'over']);
  });
});
