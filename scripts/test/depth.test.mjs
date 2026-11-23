// The depth gate: the rubric loads, the template spec is valid, and the scoring rules hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scoreDepth, report } from '../../template/scripts/depth-check.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const config = JSON.parse(readFileSync(join(ROOT, 'depth.config.json'), 'utf8'));
const template = JSON.parse(readFileSync(join(ROOT, 'template', 'depth.json'), 'utf8'));

const spec = (scores) => ({
  pillars: Object.fromEntries(Object.keys(config.pillars).map((n) => [n, { score: scores[n] ?? 2, plan: `plan for ${n}` }])),
});

test('rubric is self-consistent', () => {
  for (const n of [...config.reject_if_zero, ...config.allow_zero]) assert.ok(config.pillars[n], `${n} is a pillar`);
  assert.ok(['warn', 'block'].includes(config.enforce));
  assert.equal(config.enforce, 'warn', 'J chose warn-only; change this only on his say-so');
});

test('template spec lists every pillar', () => {
  assert.deepEqual(Object.keys(template.pillars).sort(), Object.keys(config.pillars).sort());
});

test('the blank template is flagged, never passed', () => {
  const r = scoreDepth(template, config);
  assert.equal(r.pass, false);
  assert.equal(r.hypercasual, true);
});

test('a zero on a reject pillar is hypercasual even with a high total', () => {
  const r = scoreDepth(spec({ progression: 0, mastery: 3, open_loop: 3, ownership: 3, consequence: 3, runway: 3, habit: 3, stories: 3 }), config);
  assert.equal(r.hypercasual, true);
  assert.deepEqual(r.rejected, ['progression']);
  assert.equal(r.pass, false);
});

test('a deep spec passes, and a zero on habit is allowed', () => {
  const r = scoreDepth(spec({ habit: 0 }), config);
  assert.equal(r.total, (Object.keys(config.pillars).length - 1) * 2); // every pillar at 2 except habit
  assert.equal(r.pass, true);
});

test('below the bar, missing plans and bad scores are flagged', () => {
  const low = scoreDepth(spec({ mastery: 1, open_loop: 1, consequence: 1, stories: 1, habit: 1 }), config);
  assert.equal(low.belowBar, true);
  const s = spec({});
  s.pillars.stories.plan = '';
  s.pillars.mastery.score = 7;
  const bad = scoreDepth(s, config);
  assert.ok(bad.problems.some((p) => p.startsWith('stories')));
  assert.ok(bad.problems.some((p) => p.startsWith('mastery')));
  assert.equal(bad.pass, false);
});

test('a missing spec is flagged, not a crash', () => {
  const r = scoreDepth(null, config);
  assert.equal(r.pass, false);
  assert.match(report(r, config).join('\n'), /WARNING/);
});

test('a 0 on social is allowed: solo apps are not penalized', () => {
  const r = scoreDepth(spec({ social: 0, habit: 0 }), config);
  assert.deepEqual(r.otherZeros, []);
  assert.equal(r.hypercasual, false);
});
