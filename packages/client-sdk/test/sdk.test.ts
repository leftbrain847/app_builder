import { describe, expect, it } from 'vitest';
import { backoffMs, CLIENT_CONFIG, InputOnChange, SnapshotBuffer } from '../src';

describe('client sdk', () => {
  it('sends an input only when it changes (per key); one-off inputs always go', () => {
    const sent: unknown[] = [];
    const io = new InputOnChange<{ x: number }>((i) => sent.push(i));
    io.offer('steer', { x: 1 });
    io.offer('steer', { x: 1 });
    io.offer('steer', { x: 0 });
    io.always({ x: 9 });
    io.always({ x: 9 });
    expect(sent).toEqual([{ x: 1 }, { x: 0 }, { x: 9 }, { x: 9 }]);
  });

  it('backs off exponentially up to a cap', () => {
    expect([0, 1, 2].map((n) => backoffMs(n))).toEqual([500, 1000, 2000]);
    expect(backoffMs(50)).toBe(CLIENT_CONFIG.reconnect.maxMs);
  });

  it('interpolates between the views around now − delay', () => {
    const b = new SnapshotBuffer<number>();
    expect(b.at(0)).toBeNull();
    b.push(1000, 10);
    b.push(1050, 20);
    b.push(1100, 30);
    expect(b.at(1175)).toEqual({ from: 20, to: 30, t: 0.5 });
    expect(b.at(1500)).toEqual({ from: 20, to: 30, t: 1 });
    expect(b.at(900)).toEqual({ from: 10, to: 10, t: 1 });
  });
});
