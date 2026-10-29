import { describe, expect, it } from 'vitest';
import { HOST_CONFIG, RoomCore, type AnyApp } from '@app-builder/host';
import { app, DEFAULT_RULES } from '../src/app';

const room = () => new RoomCore(app as unknown as AnyApp, HOST_CONFIG, 1);
const move = (add: number) => JSON.stringify({ t: 'input', s: 1, d: { add } });

describe('app rules in a real room', () => {
  it('is turn-based: the room never ticks', () => {
    expect(app.limits.tickHz).toBe(0);
    expect(room().tick()).toEqual([]);
  });

  it('only the player whose turn it is can move, and each player sees only their own view', () => {
    const r = room();
    r.join('a@x', 0);
    r.join('b@x', 0);
    r.message('b@x', move(3), 0);
    expect(r.settle().map((o) => (o.msg.d as { total: number }).total)).toEqual([0, 0]);
    r.message('a@x', move(3), 0);
    const views = Object.fromEntries(r.settle().map((o) => [o.player, o.msg.d]));
    expect(views['a@x']).toMatchObject({ yourTurn: false, total: 3, seat: 0 });
    expect(views['b@x']).toMatchObject({ yourTurn: true, total: 3, seat: 1 });
  });

  it('ends when the target is reached, and the winner is told', () => {
    const r = room();
    r.join('a@x', 0);
    r.join('b@x', 0);
    let p = 'a@x';
    while (!r.isOver) {
      r.message(p, move(DEFAULT_RULES.maxAdd), 0);
      r.settle();
      p = p === 'a@x' ? 'b@x' : 'a@x';
    }
    const last = Object.fromEntries(r.views().map((o) => [o.player, o.msg.d as { youWon: boolean }]));
    expect([last['a@x']?.youWon, last['b@x']?.youWon].filter(Boolean)).toHaveLength(1);
  });

  it('rejects inputs outside the schema', () => {
    for (const bad of [null, {}, { add: 0 }, { add: 4 }, { add: '1' }, { add: 1, x: 1 }]) expect(app.parseInput(bad)).toBeNull();
  });
});
