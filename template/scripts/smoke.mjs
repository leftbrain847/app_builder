#!/usr/bin/env node
// Post-deploy checks against the live friends URL, made WITHOUT logging in.
// Every one must show the login wall, never the app. Exit 1 on any failure.
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

const app = JSON.parse(readFileSync('app.config.json', 'utf8'));
const platform = JSON.parse(readFileSync('platform/platform.config.json', 'utf8'));
const host = platform.appsHost;
const base = `/${app.id}`;
const fails = [];

const toLogin = (status, location) => (status === 301 || status === 302 || status === 303 || status === 307) && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\//.test(location ?? '');

/** One raw HTTPS request (no redirects followed), so WebSocket upgrade headers can be sent too. */
function probe(path, headers = {}) {
  return new Promise((resolve) => {
    const req = request({ host, port: process.env.SMOKE_PORT ?? 443, path, method: 'GET', headers: { 'User-Agent': 'app-smoke-test', ...headers }, timeout: 15_000 });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? '' });
    });
    // A 101 here would mean the socket opened without a login: the worst outcome.
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode ?? 101, location: '' });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (e) => resolve({ status: 0, location: '', error: e.message }));
    req.end();
  });
}

async function check(name, path, { headers = {}, strict = false } = {}) {
  const r = await probe(path, headers);
  // Strict: must be Access's redirect to the team login. That proves Access (not just our Worker) covers the path.
  // Otherwise a 403 also passes: our Worker refusing a request that carries no token.
  const ok = toLogin(r.status, r.location) || (!strict && r.status === 403);
  if (ok) console.log(`ok   ${name} (${r.status})`);
  else fails.push(`${name}: got ${r.status}${r.location ? ` → ${r.location}` : ''}${r.error ? ` (${r.error})` : ''}; expected the login wall`);
}

await check('app page redirects to the Access login', `${base}/`, { strict: true });
await check('assets need login', `${base}/index.html`);
await check('api needs login', `${base}/api/usage`);
await check('room socket needs login', `${base}/api/rooms/00000000-0000-4000-8000-000000000000/ws`, {
  headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': 'c21va2UtdGVzdC1ub25jZQ==', 'Sec-WebSocket-Version': '13' },
});

// The Worker must have no other way in.
const wrangler = readFileSync('wrangler.toml', 'utf8');
if (!/^workers_dev\s*=\s*false/m.test(wrangler)) fails.push('wrangler.toml: workers_dev must be false');
else if (!/^preview_urls\s*=\s*false/m.test(wrangler)) fails.push('wrangler.toml: preview_urls must be false');
else console.log('ok   no workers.dev or preview URLs');

if (fails.length) {
  console.error('\nSMOKE FAILED:\n' + fails.join('\n'));
  process.exit(1);
}
console.log('\nSmoke passed: the app is behind the login wall.');
