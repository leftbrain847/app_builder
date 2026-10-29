import type { AuthDeps } from '../src/auth';

export const TEAM = 'friends';
export const AUD = 'aud-tag-123';
export const NOW_S = 1_800_000_000;

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (v: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(v)));

export interface Signer {
  kid: string;
  jwks: { keys: JsonWebKey[] };
  sign(payload: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

export async function makeSigner(kid = 'key-1'): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return {
    kid,
    jwks: { keys: [{ ...pub, kid, alg: 'RS256', use: 'sig' } as JsonWebKey] },
    async sign(payload, header = { alg: 'RS256', kid, typ: 'JWT' }) {
      const signing = `${b64urlJson(header)}.${b64urlJson(payload)}`;
      const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signing)));
      return `${signing}.${b64url(sig)}`;
    },
  };
}

export const goodClaims = (email = 'Pat@Example.com'): Record<string, unknown> => ({
  iss: `https://${TEAM}.cloudflareaccess.com`,
  aud: [AUD],
  email,
  iat: NOW_S - 10,
  nbf: NOW_S - 10,
  exp: NOW_S + 3600,
});

/** Auth deps whose key endpoint serves `signer`'s keys and counts fetches. */
export function authDeps(signer: Signer): AuthDeps & { fetches: string[] } {
  const fetches: string[] = [];
  return {
    fetches,
    fetch: (async (input: RequestInfo | URL) => {
      fetches.push(String(input));
      return new Response(JSON.stringify(signer.jwks), { status: 200 });
    }) as typeof fetch,
    nowS: () => NOW_S,
    keysTtlMs: 3_600_000,
    keysMinRefreshMs: 60_000,
    clockSkewS: 60,
  };
}

export const withToken = (url: string, token: string | null, init: RequestInit = {}): Request => {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set('Cf-Access-Jwt-Assertion', token);
  return new Request(url, { ...init, headers });
};
