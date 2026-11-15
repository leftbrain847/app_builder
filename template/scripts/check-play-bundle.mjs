#!/usr/bin/env node
// The Play build must make no network calls: it's an offline, login-free app.
// Fails if the built bundle contains any network code path.
//
// One exception: exact outbound link URLs listed in app.config.json, targets.play.allowedLinks. A listed URL passes
// only as a whole quoted string in link-target position: an object key or HTML attribute `href` (href:"URL",
// href="URL") or setAttribute("href","URL"). Not as an img/script src, a CSS url(), a property assignment such as
// location.href="URL", or inside a longer string, so no domain or prefix opens up and every other http(s):// string
// still fails. This is a tripwire against mistakes, not a defense against deliberately hidden code (escaped or split
// strings never were caught); reviewing the diff is that defense.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Remove allowed URLs written as a link target: `href:"URL"` / `href="URL"` (any quote; `href` not preceded by a
 * dot, letter, digit, `_` or `$`, so `a.href="URL"` and `location.href="URL"` don't count) or `"href","URL"`
 * (setAttribute). Leave everything else, so the URL anywhere else still trips the check.
 */
export function stripAllowed(text, links) {
  let out = text;
  for (const u of links) {
    const url = escapeRe(u);
    out = out.replace(new RegExp(`(?<![\\w$.])(href\\s*[:=]\\s*)(["'\`])${url}\\2`, 'g'), '$1$2$2');
    out = out.replace(new RegExp(`(["'\`])href\\1\\s*,\\s*(["'\`])${url}\\2`, 'g'), '$1href$1,$2$2');
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
    for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${f}: contains "${needle}"`);
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
