import { beforeEach, describe, expect, it } from 'vitest';
import { resetKeyCache, verifyAccess } from '../src/auth';
import { AUD, authDeps, goodClaims, makeSigner, NOW_S, TEAM, withToken } from './support';

const env = { TEAM, ACCESS_AUD: AUD };
const url = 'https://games.example.com/';

describe('Access JWT verification (fail closed)', () => {
  beforeEach(() => resetKeyCache());

  it('accepts a correctly signed token for our app, and returns the lower-cased email', async () => {
    const s = await makeSigner();
    const deps = authDeps(s);
    expect(await verifyAccess(withToken(url, await s.sign(goodClaims())), env, deps)).toEqual({ email: 'pat@example.com' });
    expect(deps.fetches).toEqual([`https://${TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`]);
  });

  it('rejects a missing, malformed or oversized token', async () => {
    const s = await makeSigner();
    const deps = authDeps(s);
    for (const t of [null, '', 'abc', 'a.b', 'a.b.c', '!!.??.**', 'x'.repeat(9000)]) expect(await verifyAccess(withToken(url, t), env, deps)).toBeNull();
  });

  it('rejects a bad signature, a token signed by another key, and non-RS256 algorithms', async () => {
    const s = await makeSigner();
    const other = await makeSigner('key-1');
    const deps = authDeps(s);
    const good = await s.sign(goodClaims());
    const [h, p] = good.split('.');
    expect(await verifyAccess(withToken(url, `${h}.${p}.AAAA`), env, deps)).toBeNull();
    expect(await verifyAccess(withToken(url, await other.sign(goodClaims())), env, deps)).toBeNull();
    expect(await verifyAccess(withToken(url, await s.sign(goodClaims(), { alg: 'none', kid: s.kid })), env, deps)).toBeNull();
    expect(await verifyAccess(withToken(url, await s.sign(goodClaims(), { alg: 'HS256', kid: s.kid })), env, deps)).toBeNull();
    expect(await verifyAccess(withToken(url, `${h}.${p}.`), env, deps)).toBeNull();
  });

  it('rejects the wrong audience, the wrong issuer, and tokens out of their time window', async () => {
    const s = await makeSigner();
    const deps = authDeps(s);
    const bad = [
      { ...goodClaims(), aud: ['someone-else'] },
      { ...goodClaims(), aud: undefined },
      { ...goodClaims(), iss: 'https://evil.cloudflareaccess.com' },
      { ...goodClaims(), exp: NOW_S - 3600 },
      { ...goodClaims(), exp: undefined },
      { ...goodClaims(), iat: NOW_S + 3600 },
      { ...goodClaims(), nbf: NOW_S + 3600 },
      { ...goodClaims(), email: '' },
      { ...goodClaims(), email: 42 },
    ];
    for (const claims of bad) expect(await verifyAccess(withToken(url, await s.sign(claims)), env, deps)).toBeNull();
    // A plain-string aud is also valid.
    expect(await verifyAccess(withToken(url, await s.sign({ ...goodClaims(), aud: AUD })), env, deps)).not.toBeNull();
  });

  it('denies everything when TEAM or ACCESS_AUD is missing or malformed', async () => {
    const s = await makeSigner();
    const deps = authDeps(s);
    const token = await s.sign(goodClaims());
    for (const e of [{}, { TEAM }, { ACCESS_AUD: AUD }, { TEAM: 'evil.com/x', ACCESS_AUD: AUD }, { TEAM, ACCESS_AUD: '' }]) {
      expect(await verifyAccess(withToken(url, token), e, deps)).toBeNull();
    }
    expect(deps.fetches).toHaveLength(0);
  });

  it('enforces the optional email allowlist', async () => {
    const s = await makeSigner();
    const deps = authDeps(s);
    const allow = { ...env, ALLOWED_EMAILS: 'pat@example.com, sam@example.com' };
    expect(await verifyAccess(withToken(url, await s.sign(goodClaims())), allow, deps)).toEqual({ email: 'pat@example.com' });
    expect(await verifyAccess(withToken(url, await s.sign(goodClaims('eve@example.com'))), allow, deps)).toBeNull();
  });

  it('fails closed when the allowlist is required but its secret was never set', async () => {
    const s = await makeSigner();
    const deps = authDeps(s);
    const token = await s.sign(goodClaims());
    for (const missing of [{}, { ALLOWED_EMAILS: '' }, { ALLOWED_EMAILS: ' , ' }]) {
      expect(await verifyAccess(withToken(url, token), { ...env, EMAIL_ALLOWLIST: 'required', ...missing }, deps)).toBeNull();
    }
    expect(await verifyAccess(withToken(url, token), { ...env, EMAIL_ALLOWLIST: 'required', ALLOWED_EMAILS: 'pat@example.com' }, deps)).toEqual({ email: 'pat@example.com' });
    expect(await verifyAccess(withToken(url, token), { ...env, EMAIL_ALLOWLIST: 'off' }, deps)).toEqual({ email: 'pat@example.com' });
  });

  it('caches keys, and an unknown key id refetches at most once per minute', async () => {
    const s = await makeSigner();
    const deps = authDeps(s);
    const token = await s.sign(goodClaims());
    await verifyAccess(withToken(url, token), env, deps);
    await verifyAccess(withToken(url, token), env, deps);
    expect(deps.fetches).toHaveLength(1);
    const forged = await s.sign(goodClaims(), { alg: 'RS256', kid: 'nope' });
    for (let i = 0; i < 5; i++) expect(await verifyAccess(withToken(url, forged), env, deps)).toBeNull();
    expect(deps.fetches).toHaveLength(1);
  });

  it('fails closed when the key endpoint is down', async () => {
    const s = await makeSigner();
    const deps = { ...authDeps(s), fetch: (async () => new Response('', { status: 500 })) as typeof fetch };
    expect(await verifyAccess(withToken(url, await s.sign(goodClaims())), env, deps)).toBeNull();
  });
});
