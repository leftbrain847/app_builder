import { describe, expect, it } from 'vitest';
import { HOST_CONFIG } from '../src/config';
import type { AnyApp } from '../src/registry';
import { displayName, mergeScore } from '../src/scoresCore';
import { applySolo, startSolo } from '../src/soloCore';
import { addUsage, UsageTally, usageReport } from '../src/usageCore';
import { diceApp, playLikeTheClient } from './apps';

const game = diceApp as unknown as AnyApp;

describe('solo runs', () => {
  it('a doctored play doesn’t replay, and the run is thrown away', () => {
    const record = startSolo(game, 'pat@x', 77, 0)!;
    const { segments } = playLikeTheClient(77);
    const seg = segments[0]!;
    // A play out of order: something the real client could never have sent.
    const doctored = { ...seg, play: 5 };
    const out = applySolo(game, record, 'pat@x', JSON.stringify(doctored));
    expect(out.response).toEqual({ ok: false, code: 'rejected' });
    expect(out.record).toBeNull();
  });

  it('rejects other players, oversized and malformed bodies without touching the run', () => {
    const record = startSolo(game, 'pat@x', 77, 0)!;
    const seg = JSON.stringify(playLikeTheClient(77).segments[0]);
    expect(applySolo(game, record, 'eve@x', seg)).toMatchObject({ record, response: { ok: false, code: 'rejected' } });
    expect(applySolo(game, record, 'pat@x', 'x'.repeat(game.solo!.maxSegmentBytes + 1))).toMatchObject({ record, response: { code: 'bad_message' } });
    expect(applySolo(game, record, 'pat@x', '{oops')).toMatchObject({ record, response: { code: 'bad_message' } });
    expect(applySolo(game, record, 'pat@x', seg).response.ok).toBe(true);
  });
});

describe('scoreboard', () => {
  it('keeps each player’s best, highest first, and shows only the name before the @', () => {
    let list = mergeScore([], { player: 'pat', score: 100, atMs: 1 }, 2);
    list = mergeScore(list, { player: 'sam', score: 300, atMs: 2 }, 2);
    list = mergeScore(list, { player: 'pat', score: 50, atMs: 3 }, 2);
    expect(list.map((e) => [e.player, e.score])).toEqual([['sam', 300], ['pat', 100]]);
    list = mergeScore(list, { player: 'kim', score: 200, atMs: 4 }, 2);
    expect(list.map((e) => e.player)).toEqual(['sam', 'kim']);
    expect(displayName('pat@example.com')).toBe('pat');
  });
});

describe('usage meter', () => {
  const day = { day: '2026-10-23', workerRequests: 0, objectRequests: 0, inboundWs: 0, rowsWritten: 0 };

  it('bills inbound socket messages at 20:1 and reports the tightest allowance', () => {
    const r = usageReport(addUsage(day, { workerRequests: 1000, objectRequests: 500, inboundWs: 40_000, rowsWritten: 10 }), HOST_CONFIG);
    expect(r.used).toBe(2500);
    expect(r.warn).toBe(false);
    const rows = usageReport(addUsage(day, { workerRequests: 0, objectRequests: 0, inboundWs: 0, rowsWritten: 96_000 }), HOST_CONFIG);
    expect(rows.hardStop).toBe(true);
    expect(usageReport({ ...day, workerRequests: 71_000 }, HOST_CONFIG).warn).toBe(true);
  });

  it('flushes in batches, not per request', () => {
    const t = new UsageTally(30_000);
    t.add({ workerRequests: 1 });
    expect(t.due(30_000)).toEqual({ workerRequests: 1, objectRequests: 0, inboundWs: 0, rowsWritten: 0 });
    t.add({ workerRequests: 1 });
    expect(t.due(31_000)).toBeNull();
    expect(t.due(61_000)).not.toBeNull();
    expect(t.due(200_000)).toBeNull();
  });
});
