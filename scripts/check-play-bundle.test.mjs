// node --test: the Play bundle tripwire and its exact-link allowlist.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { allowedLinks, check, stripAllowed } from '../template/scripts/check-play-bundle.mjs';

const bundle = (js) => {
  const dir = mkdtempSync(join(tmpdir(), 'play-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index.js'), js);
  return dir;
};
const LINK = 'https://example.org/teams/report';
const hits = (js) => check(bundle(js), [LINK]).hits.length;

test('no allowlist: any https:// string fails, as before', () => {
  assert.equal(check(bundle(`x={outboundHref:"${LINK}"}`), []).hits.length, 1);
  assert.equal(check(bundle('const x = 1'), []).hits.length, 0);
});

test('a listed URL passes only as an outboundHref value', () => {
  for (const ok of [`x={outboundHref:"${LINK}"}`, `x={label:"a",outboundHref:'${LINK}',b:1}`, `x={ outboundHref : \`${LINK}\` }`, `x={a:1,\n  outboundHref:"${LINK}"}`]) {
    assert.equal(hits(ok), 0, ok);
  }
});

test('anywhere else, or extended, a listed URL still fails (loads, assignments, longer URLs)', () => {
  for (const bad of [
    `url("${LINK}")`, `<img src="${LINK}">`, `<script src="${LINK}"></script>`, `new Image().src="${LINK}"+"?d="+x`,
    `location.href="${LINK}"`, `a.href="${LINK}"`, `<a href="${LINK}">`, `x={href:"${LINK}"}`, `a.setAttribute("href","${LINK}")`,
    `<link rel="stylesheet" href="${LINK}">`, `<base href="${LINK}">`, `<image href="${LINK}">`, `<use xlink:href="${LINK}">`,
    `e("link",{rel:"stylesheet",href:"${LINK}"})`, `Object.assign(location,{href:"${LINK}"})`, `Reflect.set(location,"href","${LINK}")`,
    `<a ping="${LINK}">`, `const u="${LINK}";import(u)`, `x={url:"${LINK}"}`, `x={myoutboundHref:"${LINK}"}`, `x={"outboundHref":"${LINK}"}`,
    `new Image().src=c?o.outboundHref:"${LINK}"`, `location.href=c?outboundHref:"${LINK}"`, `x=a.outboundHref:"${LINK}"`,
    `x={outboundHref:"${LINK}/../../evil"}`, `x={outboundHref:"${LINK}?q="+data}`, 'x={outboundHref:"https://example.org/other"}', `x={outboundHref:"x${LINK}"}`,
  ]) assert.equal(hits(bad), 1, bad);
});

test('uppercase and protocol-relative URLs fail too', () => {
  for (const bad of ['x="HTTPS://evil.example/x"', 'x="Http://evil.example/x"', 'x="//evil.example/x"', "x='//evil.example'", 'a{background:url(//evil.example/i.png)}']) {
    assert.ok(hits(bad) >= 1, bad);
  }
  for (const ok of ['x="a // b"', 'x=1 // comment', 'r=/\\/\\//g', 'x="//"']) assert.equal(hits(ok), 0, ok);
});

test('the allowlist never excuses network code', () => {
  assert.ok(hits(`fetch("${LINK}")`) >= 1);
  assert.ok(hits(`x={outboundHref:"${LINK}"};fetch(x.outboundHref)`) >= 1);
  assert.ok(hits('new WebSocket("wss://x")') >= 1);
});

test('allowlist entries: https, host and plain path only', () => {
  assert.deepEqual(allowedLinks({}), []);
  assert.deepEqual(allowedLinks({ targets: { play: { allowedLinks: [LINK, 'https://www.nfl.com/injuries/'] } } }), [LINK, 'https://www.nfl.com/injuries/']);
  for (const bad of ['http://example.org/', 'https://example.org/?q=1', 'https://user:pw@example.org/', 'https://example.org:8443/', 'https://example.org/"x', 'https://', 'javascript:alert(1)', 'https://example.org/#f', 7]) {
    assert.throws(() => allowedLinks({ targets: { play: { allowedLinks: [bad] } } }), /allowedLinks/, String(bad));
  }
  assert.throws(() => allowedLinks({ targets: { play: { allowedLinks: LINK } } }), /list/);
});

test('stripAllowed only empties an outboundHref value', () => {
  assert.equal(stripAllowed(`{outboundHref:"${LINK}"}`, [LINK]), '{outboundHref:""}');
  assert.equal(stripAllowed(`{outboundHref:"${LINK}x"}`, [LINK]), `{outboundHref:"${LINK}x"}`);
});

test('run as a script, also through a symlink: network code exits non-zero', () => {
  const app = mkdtempSync(join(tmpdir(), 'app-'));
  mkdirSync(join(app, 'dist', 'play'), { recursive: true });
  writeFileSync(join(app, 'dist', 'play', 'i.js'), 'fetch("x")');
  const real = resolve(dirname(fileURLToPath(import.meta.url)), '../template/scripts');
  symlinkSync(real, join(app, 'scripts'));
  for (const script of [join(real, 'check-play-bundle.mjs'), 'scripts/check-play-bundle.mjs']) {
    const r = spawnSync(process.execPath, [script], { cwd: app, encoding: 'utf8' });
    assert.equal(r.status, 1, `${script}: ${r.stdout}${r.stderr}`);
  }
});
