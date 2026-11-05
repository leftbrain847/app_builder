import { beforeEach, describe, expect, it } from 'vitest';
import { signRoomId } from '../src/turn/crypto.ts';
import type { TurnEnv } from '../src/turn/env.ts';
import { registerTurn } from '../src/turn/registry.ts';
import { routeInvite } from '../src/turn/worker.ts';
import { counterGame } from './turn_fixture.ts';

const KEY = 'h'.repeat(48);
const ORIGIN = 'https://play.example.com';

function fakeEnv(over: Partial<TurnEnv> = {}) {
  const touched: string[] = [];
  const inits: unknown[] = [];
  const meterHits: string[] = [];
  const env = {
    HOST_KEY: KEY,
    ASSETS: { fetch: async (r: Request) => new Response(`asset ${new URL(r.url).pathname}`, { status: 200 }) },
    ROOMS: {
      idFromName: (n: string) => n,
      get: (id: string) => {
        touched.push(id);
        return { init: async (a: unknown) => void inits.push(a), fetch: async () => new Response('ws', { status: 200 }) };
      },
    },
    PROFILES: {},
    USAGE: {
      idFromName: () => 'global',
      get: () => ({ fetch: async (u: string) => (meterHits.push(u), Response.json({ fraction: 0.1 })) }),
    },
    ...over,
  } as unknown as TurnEnv;
  return { env, touched, inits, meterHits };
}

const req = (path: string, init: RequestInit = {}) => new Request(`${ORIGIN}${path}`, init);
const wsHeaders = (origin = ORIGIN) => ({ Upgrade: 'websocket', Origin: origin });

describe('invite worker', () => {
  beforeEach(() => registerTurn([counterGame]));

  it('refuses everything without a strong host key', async () => {
    const { env } = fakeEnv({ HOST_KEY: 'short' });
    expect((await routeInvite(req('/counter/'), env)).status).toBe(503);
    const { env: none } = fakeEnv({ HOST_KEY: undefined as unknown as string });
    expect((await routeInvite(req('/counter/api/rooms', { method: 'POST' }), none)).status).toBe(503);
  });

  it('only the host key creates rooms', async () => {
    const { env, inits } = fakeEnv();
    expect((await routeInvite(req('/counter/api/rooms', { method: 'POST' }), env)).status).toBe(403);
    expect((await routeInvite(req('/counter/api/rooms', { method: 'POST', headers: { Authorization: `Bearer ${'x'.repeat(48)}` } }), env)).status).toBe(403);
    expect((await routeInvite(req('/counter/api/rooms', { method: 'GET', headers: { Authorization: `Bearer ${KEY}` } }), env)).status).toBe(405);
    expect(inits).toHaveLength(0);
    const ok = await routeInvite(req('/counter/api/rooms', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: '{"name":"J"}' }), env);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { cap: string; invite: string; hostToken: string };
    expect(body.cap).toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{22}$/);
    expect(body.invite).toMatch(/^[0-9a-f]{32}$/);
    // The room keeps only hashes of the secrets it hands out.
    expect(JSON.stringify(inits)).not.toContain(body.invite);
    expect(JSON.stringify(inits)).not.toContain(body.hostToken);
    expect(ok.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('refuses oversized or malformed create bodies', async () => {
    const { env } = fakeEnv();
    const auth = { Authorization: `Bearer ${KEY}` };
    expect((await routeInvite(req('/counter/api/rooms', { method: 'POST', headers: auth, body: 'x'.repeat(2000) }), env)).status).toBe(413);
    expect((await routeInvite(req('/counter/api/rooms', { method: 'POST', headers: auth, body: '[1]' }), env)).status).toBe(400);
  });

  it('refuses new rooms past the daily hard stop', async () => {
    const { env } = fakeEnv({ USAGE: { idFromName: () => 'g', get: () => ({ fetch: async () => Response.json({ fraction: 0.99 }) }) } as unknown as TurnEnv['USAGE'] });
    expect((await routeInvite(req('/counter/api/rooms', { method: 'POST', headers: { Authorization: `Bearer ${KEY}` } }), env)).status).toBe(503);
  });

  it('a forged room capability never reaches a room', async () => {
    const { env, touched } = fakeEnv();
    const forged = `${'ab'.repeat(16)}.${'A'.repeat(22)}`;
    expect((await routeInvite(req(`/counter/ws/${forged}`, { headers: wsHeaders() }), env)).status).toBe(403);
    expect((await routeInvite(req('/counter/ws/../api', { headers: wsHeaders() }), env)).status).toBe(404);
    expect(touched).toHaveLength(0);
  });

  it('a genuine capability connects, but not from a foreign page', async () => {
    const { env, touched } = fakeEnv();
    const cap = await signRoomId(KEY, 'cd'.repeat(16));
    expect((await routeInvite(req(`/counter/ws/${cap}`, { headers: wsHeaders('https://evil.example') }), env)).status).toBe(403);
    expect((await routeInvite(req(`/counter/ws/${cap}`), env)).status).toBe(426);
    expect(touched).toHaveLength(0);
    expect((await routeInvite(req(`/counter/ws/${cap}`, { headers: wsHeaders() }), env)).status).toBe(200);
    expect(touched).toEqual(['cd'.repeat(16)]);
  });

  it('serves only the static client, only under its base path, with security headers', async () => {
    const { env } = fakeEnv();
    const page = await routeInvite(req('/counter/r/abc'), env);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('asset /r/abc');
    expect(page.headers.get('X-Frame-Options')).toBe('DENY');
    expect((await routeInvite(req('/counter/app.js', { method: 'POST' }), env)).status).toBe(405);
    expect((await routeInvite(req('/other/'), env)).status).toBe(404);
    expect((await routeInvite(req('/counter/api/anything'), env)).status).toBe(404);
    expect((await routeInvite(req('/counter//x'), env)).status).toBe(404);
    expect((await routeInvite(req('/counter'), env)).status).toBe(308);
  });

  it('usage needs the host key', async () => {
    const { env } = fakeEnv();
    expect((await routeInvite(req('/counter/api/usage'), env)).status).toBe(403);
    expect((await routeInvite(req('/counter/api/usage', { headers: { Authorization: `Bearer ${KEY}` } }), env)).status).toBe(200);
  });
});
