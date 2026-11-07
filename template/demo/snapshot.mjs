// Commit-ready copy of today's demo: snapshots/YYYY-MM-DD - <title>.html. The index repo's nightly refresh finds it
// on the default branch and lists the day on the Sprint tab (and on the public sprint site, if the page opts in).
// Day snapshots are frozen records: rewriting today's is fine, an earlier day's file is never touched.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const name = readFileSync('dist/demo/name.txt', 'utf8').trim();
mkdirSync('snapshots', { recursive: true });
const out = join('snapshots', `${name}.html`);
copyFileSync('dist/demo/page.html', out);
console.log(`snapshot: ${out}`);
