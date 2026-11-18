#!/usr/bin/env node
// The Play build must make no network calls: it's an offline, login-free app.
// Fails if the built bundle contains any network code path.
//
// One exception: exact outbound link URLs listed in app.config.json, targets.play.allowedLinks. A listed URL passes
// only as the value of an object key named `outboundHref` (outboundHref:"URL", whole quoted string). No browser,
// HTML or Capacitor API reads that name, so the URL loads nothing unless code deliberately copies it into an <a>'s
// href, which is what the app's link helper does and what a reviewer should look for. Any other appearance (an
// href/src attribute, CSS url(), location, a longer string) still fails, as does every other http(s):// string.
// This is a tripwire against mistakes, not a defense against deliberately hidden code (escaped or split strings
// never were caught); reviewing the diff is that defense. Imported as a module (for tests) it checks nothing.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = 'dist/play';
// A tripwire, not a proof: plain substrings (any letter case), so keep the client free of these words even in comments.
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

const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Remove allowed URLs written as an object key `outboundHref:"URL"` (any quote); leave everything else. */
export function stripAllowed(text, links) {
  let out = text;
  for (const u of links) {
    // an object key: right after `{` or `,` (so not a ternary's `: "URL"` or a longer name)
    out = out.replace(new RegExp(`(?<=[{,]\\s*)(outboundHref\\s*:\\s*)(["'\`])${escapeRe(u)}\\2`, 'g'), '$1$2$2');
  }
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
    const lower = text.toLowerCase();
    for (const needle of FORBIDDEN) if (lower.includes(needle.toLowerCase())) hits.push(`${f}: contains "${needle}"`);
    // a protocol-relative URL ("//host/...") loads over https from the app's origin
    const rel = /(["'`]|\burl\(\s*)\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/.exec(text);
    if (rel) hits.push(`${f}: contains a protocol-relative URL "${rel[0]}"`);
  }
  return { files: files.length, hits };
}

// run as a script (also when reached through a symlink: compare real paths, or the check would silently pass)
const self = realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(resolve(process.argv[1])) === self) {
  const config = existsSync('app.config.json') ? JSON.parse(readFileSync('app.config.json', 'utf8')) : {};
  const links = allowedLinks(config);
  const { files, hits } = check(DIR, links);
  if (hits.length) {
    console.error('Play bundle has network code (it must work offline with no server):\n' + hits.join('\n'));
    process.exit(1);
  }
  console.log(`Play bundle clean: ${files} files, no network code${links.length ? ` (${links.length} allowed link${links.length === 1 ? '' : 's'})` : ''}.`);
}
