// node --test: the Play bundle tripwire and its exact-link allowlist.
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { allowedLinks, check, stripAllowed } from '../template/scripts/check-play-bundle.mjs';

const bundle = (js) => {
  const dir = mkdtempSync(join(tmpdir(), 'play-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index.js'), js);
  return dir;
};
const LINK = 'https://example.org/teams/report';

test('no allowlist: any https:// string fails, as before', () => {
  assert.equal(check(bundle(`a.href="${LINK}"`), []).hits.length, 1);
  assert.equal(check(bundle('const x = 1'), []).hits.length, 0);
});

test('a listed URL passes only as a whole quoted literal', () => {
  for (const q of ['"', "'", '`']) assert.equal(check(bundle(`a.href=${q}${LINK}${q}`), [LINK]).hits.length, 0);
  // a longer URL starting with the listed one, or the same host with another path, still fails
  assert.equal(check(bundle(`a.href="${LINK}/../../evil"`), [LINK]).hits.length, 1);
  assert.equal(check(bundle(`a.href="${LINK}?q="+data`), [LINK]).hits.length, 1);
  assert.equal(check(bundle('a.href="https://example.org/other"'), [LINK]).hits.length, 1);
  assert.equal(check(bundle(`a.href="x${LINK}"`), [LINK]).hits.length, 1);
});

test('the allowlist never excuses network code', () => {
  assert.equal(check(bundle(`fetch("${LINK}")`), [LINK]).hits.length, 1);
  assert.equal(check(bundle(`new WebSocket("wss://x")`), [LINK]).hits.length, 1);
});

test('allowlist entries: https, host and plain path only', () => {
  assert.deepEqual(allowedLinks({}), []);
  assert.deepEqual(allowedLinks({ targets: { play: { allowedLinks: [LINK, 'https://www.nfl.com/injuries/'] } } }), [LINK, 'https://www.nfl.com/injuries/']);
  for (const bad of ['http://example.org/', 'https://example.org/?q=1', 'https://user:pw@example.org/', 'https://example.org:8443/', 'https://example.org/"x', 'https://', 'javascript:alert(1)', 'https://example.org/#f', 7]) {
    assert.throws(() => allowedLinks({ targets: { play: { allowedLinks: [bad] } } }), /allowedLinks/, String(bad));
  }
  assert.throws(() => allowedLinks({ targets: { play: { allowedLinks: LINK } } }), /list/);
});

test('stripAllowed leaves an unquoted or partial match alone', () => {
  assert.equal(stripAllowed(`"${LINK}"`, [LINK]), '""');
  assert.equal(stripAllowed(`"${LINK}x"`, [LINK]), `"${LINK}x"`);
});
