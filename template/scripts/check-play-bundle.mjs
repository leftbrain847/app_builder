#!/usr/bin/env node
// The Play build must make no network calls: it's an offline, login-free app.
// Fails if the built bundle contains any network code path.
//
// One exception: exact outbound link URLs listed in app.config.json, targets.play.allowedLinks. A link is not a
// network call (nothing loads until the player taps it, and the page itself never requests it). Only a listed URL
// written as a whole quoted string literal is let through, so no domain or prefix opens up: a longer URL that starts
// with a listed one, or any other http(s):// string, still fails.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = 'dist/play';
// A tripwire, not a proof: plain substrings, so keep the client free of these words even in comments.
const FORBIDDEN = ['/api/', 'WebSocket', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'EventSource', 'import("http', 'http://', 'https://'];

/** Allowed link URLs: https only, no characters that could close a string or start markup, no credentials. */
export function allowedLinks(config) {
  const list = config?.targets?.play?.allowedLinks ?? [];
  if (!Array.isArray(list)) throw new Error('targets.play.allowedLinks must be a list of URLs');
  for (const u of list) {
    if (typeof u !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/[A-Za-z0-9._~%\/-]*)?$/.test(u)) {
      throw new Error(`targets.play.allowedLinks: not allowed: ${JSON.stringify(u)} (https, a host and a plain path only; no query, fragment, port or credentials)`);
    }
  }
  return list;
}

/** Remove allowed URLs that appear as a whole quoted string literal ("url", 'url' or `url`); leave everything else. */
export function stripAllowed(text, links) {
  let out = text;
  for (const u of links) for (const q of ['"', "'", '`']) out = out.split(`${q}${u}${q}`).join(`${q}${q}`);
  return out;
}

export function check(dir, links) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|html|css|json|webmanifest)$/.test(name)) files.push(p);
    }
  };
  walk(dir);
  const hits = [];
  for (const f of files) {
    const text = stripAllowed(readFileSync(f, 'utf8'), links);
    for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${f}: contains "${needle}"`);
  }
  return { files: files.length, hits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = existsSync('app.config.json') ? JSON.parse(readFileSync('app.config.json', 'utf8')) : {};
  const links = allowedLinks(config);
  const { files, hits } = check(DIR, links);
  if (hits.length) {
    console.error('Play bundle has network code (it must work offline with no server):\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log(`Play bundle clean: ${files} files, no network code${links.length ? ` (${links.length} allowed link${links.length === 1 ? '' : 's'})` : ''}.`);
}
