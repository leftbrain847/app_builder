#!/usr/bin/env node
// Post-deploy checks against the live friends URL, made WITHOUT logging in.
// Every one must show the login wall, never the app. Exit 1 on any failure.
import { readFileSync } from 'node:fs';

const app = JSON.parse(readFileSync('app.config.json', 'utf8'));
const platform = JSON.parse(readFileSync('platform/platform.config.json', 'utf8'));
const base = `https://${platform.appsHost}/${app.id}`;
const fails = [];

// Access answers an unauthenticated request with a redirect to the team's login page (or a 403).
const walled = (res) => res.status === 403 || ((res.status === 302 || res.status === 301) && /cloudflareaccess\.com/.test(res.headers.get('location') ?? ''));

async function check(name, url, init = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', ...init });
    if (!walled(res)) fails.push(`${name}: got ${res.status} ${res.headers.get('location') ?? ''} (expected the login wall)`);
    else console.log(`ok  ${name}`);
  } catch (e) {
    fails.push(`${name}: request failed (${e.message})`);
  }
}

await check('app page needs login', `${base}/`);
await check('assets need login', `${base}/index.html`);
await check('api needs login', `${base}/api/usage`);
await check('room socket needs login', `${base}/api/rooms/00000000-0000-4000-8000-000000000000/ws`, { headers: { Upgrade: 'websocket', Connection: 'Upgrade' } });

// The Worker must have no other way in.
const wrangler = readFileSync('wrangler.toml', 'utf8');
if (!/^workers_dev\s*=\s*false/m.test(wrangler)) fails.push('wrangler.toml: workers_dev must be false');
if (!/^preview_urls\s*=\s*false/m.test(wrangler)) fails.push('wrangler.toml: preview_urls must be false');
else console.log('ok  no workers.dev or preview URLs');

if (fails.length) {
  console.error('\nSMOKE FAILED:\n' + fails.join('\n'));
  process.exit(1);
}
console.log('\nSmoke passed: the app is behind the login wall.');
