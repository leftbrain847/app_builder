import { beforeEach, describe, expect, it } from 'vitest';
import { resetKeyCache } from '../src/auth';
import { HOST_CONFIG } from '../src/config';
import { PLAYER_HEADER } from '../src/env';
import { SECURITY_HEADERS } from '../src/headers';
import type { ScoresResponse, SoloSegmentResponse, SoloStartResponse, UsageResponse } from '../src/protocol';
import { register } from '../src/registry';
import { route, type RouterDeps } from '../src/router';
import { UsageTally } from '../src/usageCore';
import { fakeEnv } from './fakes';
import { diceApp, playLikeTheClient } from './apps';
import { authDeps, goodClaims, makeSigner, withToken, type Signer } from './support';

const BASE = 'https://apps.example.com';

describe('router', () => {
  let signer: Signer;
  let token: string;
  let deps: RouterDeps;
  let ctx: ReturnType<typeof fakeEnv>;
  const pending: Promise<unknown>[] = [];

  beforeEach(async () => {
    resetKeyCache();
    register([diceApp as never], { basePath: '' });
    signer = await makeSigner();
    token = await signer.sign(goodClaims('pat@example.com'));
    ctx = fakeEnv();
    deps = { ...authDeps(signer), host: HOST_CONFIG, waitUntil: (p) => void pending.push(p), tally: new UsageTally(HOST_CONFIG.usageFlushMs), lastReport: null };
  });

  const call = (path: string, init: RequestInit = {}, t: string | null = token) => route(withToken(`${BASE}${path}`, t, init), ctx.env, deps);

  it('answers 403 with no body to anything without a valid Access token, including the client and sockets', async () => {
    for (const path of ['/', '/index.html', '/api/usage', '/api/solo/dice/start', '/api/rooms/00000000-0000-4000-8000-000000000000/ws']) {
      const res = await call(path, { headers: { Upgrade: 'websocket' } }, null);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe('');
    }
    const forged = await (await makeSigner()).sign(goodClaims());
    expect((await call('/', {}, forged)).status).toBe(403);
    expect(ctx.assets).toHaveLength(0);
  });

  it('serves the client to a verified player, with the security headers', async () => {
    const res = await call('/');
    expect(res.status).toBe(200);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect((await call('/', { method: 'POST' })).status).toBe(405);
  });

  it('plays a solo run end to end: server seed, every play replayed, the server’s score on the board', async () => {
    const start = await call('/api/solo/dice/start', { method: 'POST' });
    expect(start.status).toBe(200);
    const { runId, seed } = (await start.json()) as SoloStartResponse;
    const played = playLikeTheClient(seed);
    let last: SoloSegmentResponse | null = null;
    for (const seg of played.segments) {
      const res = await call(`/api/solo/dice/${runId}/segment`, { method: 'POST', body: JSON.stringify(seg) });
      last = (await res.json()) as SoloSegmentResponse;
      expect(last.ok).toBe(true);
    }
    expect(last).toEqual({ ok: true, score: played.run.points, over: true });
    await Promise.all(pending);
    const board = (await (await call('/api/solo/dice/scores')).json()) as ScoresResponse;
    expect(board.scores).toEqual([{ player: 'pat', score: played.run.points, atMs: expect.any(Number) }]);
    // The finished run is gone: nothing more can be added to it.
    const again = await call(`/api/solo/dice/${runId}/segment`, { method: 'POST', body: JSON.stringify(played.segments[0]) });
    expect(again.status).toBe(404);
  });

  it('only the run’s owner can submit to it', async () => {
    const { runId, seed } = (await (await call('/api/solo/dice/start', { method: 'POST' })).json()) as SoloStartResponse;
    const seg = playLikeTheClient(seed).segments[0];
    const eve = await signer.sign(goodClaims('eve@example.com'));
    const res = await call(`/api/solo/dice/${runId}/segment`, { method: 'POST', body: JSON.stringify(seg) }, eve);
    expect(await res.json()).toEqual({ ok: false, code: 'rejected' });
  });

  it('a client can’t claim to be someone else: the object only ever sees the verified email', async () => {
    await call('/api/solo/dice/start', { method: 'POST', headers: { [PLAYER_HEADER]: 'boss@example.com' } });
    const seen = ctx.runs.requests.map((r) => r.request.headers.get(PLAYER_HEADER));
    expect(seen).toEqual(['pat@example.com']);
  });

  it('rejects oversized bodies before parsing, and malformed ids and paths', async () => {
    const { runId } = (await (await call('/api/solo/dice/start', { method: 'POST' })).json()) as SoloStartResponse;
    const big = 'x'.repeat(64 * 1024 + 1);
    expect((await call(`/api/solo/dice/${runId}/segment`, { method: 'POST', body: big })).status).toBe(413);
    expect((await call(`/api/solo/dice/${runId}/segment`, { method: 'POST', body: '{"play":1,"ticks":"no"}' })).status).toBe(400);
    expect((await call('/api/solo/dice/not-an-id/segment', { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await call('/api/solo/chess/start', { method: 'POST' })).status).toBe(404);
    expect((await call('/api/solo/__proto__/start', { method: 'POST' })).status).toBe(404);
    expect((await call('/api/rooms/not-a-uuid/ws', { headers: { Upgrade: 'websocket' } })).status).toBe(404);
    expect((await call('/api/nope')).status).toBe(404);
    expect((await call('/api/solo/dice/start')).status).toBe(405);
  });

  it('reports usage, and refuses new runs and rooms past the hard stop', async () => {
    const report = (await (await call('/api/usage')).json()) as UsageResponse;
    expect(report.budget).toBe(HOST_CONFIG.quota.dailyRequestBudget);
    expect(report.hardStop).toBe(false);
    deps.lastReport = { report: { ...report, fraction: 0.99, hardStop: true }, atMs: deps.nowS() * 1000 };
    expect((await call('/api/solo/dice/start', { method: 'POST' })).status).toBe(503);
    expect((await call('/api/rooms/dice', { method: 'POST' })).status).toBe(503);
  });

  it('creates rooms with unguessable ids and forwards only verified socket upgrades', async () => {
    const res = await call('/api/rooms/dice', { method: 'POST' });
    const { roomId } = (await res.json()) as { roomId: string };
    expect(roomId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await call(`/api/rooms/${roomId}/ws`)).status).toBe(426);
    await call(`/api/rooms/${roomId}/ws`, { headers: { Upgrade: 'websocket' } });
    const last = ctx.rooms.requests[ctx.rooms.requests.length - 1]!;
    expect(new URL(last.url).pathname).toBe('/ws');
    expect(last.headers.get(PLAYER_HEADER)).toBe('pat@example.com');
  });

  it('serves only its own path when an app is one of many on the hostname', async () => {
    register([diceApp as never]);
    const page = await call('/dice/');
    expect(page.status).toBe(200);
    expect(new URL(ctx.assets[ctx.assets.length - 1]!.url).pathname).toBe('/');
    await call('/dice/assets/app.js');
    expect(new URL(ctx.assets[ctx.assets.length - 1]!.url).pathname).toBe('/assets/app.js');
    expect((await call('/dice')).status).toBe(308);
    expect((await call('/other/')).status).toBe(404);
    expect((await call('/api/usage')).status).toBe(404);
    expect((await call('/dice/api/usage')).status).toBe(200);
    // Outside the path still needs a valid login first: no token, no hint the path exists.
    expect((await call('/other/', {}, null)).status).toBe(403);
    register([diceApp as never], { basePath: '' });
  });

  it('keeps redirects, links and odd paths inside the app', async () => {
    register([diceApp as never]);
    ctx = fakeEnv({ ASSETS: { fetch: async () => new Response(null, { status: 307, headers: { Location: '/' } }) } as unknown as Fetcher });
    const res = await call('/dice/index.html');
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toBe('/dice/');
    const bare = await call('/dice?room=00000000-0000-4000-8000-000000000000');
    expect(bare.headers.get('Location')).toBe('https://apps.example.com/dice/?room=00000000-0000-4000-8000-000000000000');
    expect((await call('/dice//index.html')).status).toBe(404);
    expect((await call('/dice//api/usage')).status).toBe(404);
    register([diceApp as never], { basePath: '' });
  });
});
