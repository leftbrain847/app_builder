// Fold the demo build into one self-contained page: dist/demo/page.html, titled `YYYY-MM-DD - <title>` (the
// sprint date in app.config.json's sprint.timeZone, or DEMO_DATE). It has no doctype/html/head/body of its own,
// because the Claude artifact host wraps the page. Publish it as the day's artifact; `npm run snapshot` commits it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const app = JSON.parse(readFileSync('app.config.json', 'utf8'));
const sprint = { timeZone: 'America/New_York', public: true, ...app.sprint };
const day = process.env.DEMO_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: sprint.timeZone }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`inline: DEMO_DATE must be YYYY-MM-DD, got ${day}`);
const name = `${day} - ${app.title}`;

const dir = 'dist/demo';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const css = /<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/.exec(html)?.[1];
const js = /<script type="module"[^>]*src="\.\/([^"]+)"/.exec(html)?.[1];
if (!css || !js) throw new Error('inline: the demo build is missing its script or stylesheet');
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const page = [
  `<title>${escape(name)}</title>`,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  // The index repo publishes a discovered day on the public sprint site only if the page carries this opt-in.
  ...(sprint.public ? ['<meta name="sprint-public" content="yes">'] : []),
  `<style>\n${readFileSync(join(dir, css), 'utf8')}</style>`,
  '<div id="app"></div>',
  `<script type="module">\n${readFileSync(join(dir, js), 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`,
  '',
].join('\n');
writeFileSync(join(dir, 'page.html'), page);
writeFileSync(join(dir, 'name.txt'), name);
console.log(`wrote ${join(dir, 'page.html')} (${page.length} bytes): "${name}"`);
