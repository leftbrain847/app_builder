#!/usr/bin/env node
// Make a new app from the template.
//
//   node scripts/create-app.mjs <id> --mode solo|turn [--title "My App"] [--out <dir>]
//
// <dir> defaults to ../<id> and may be an empty clone of the app's GitHub repo
// (only .git and a README). Writes the app skeleton, then syncs the platform into it.
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exists, fillPlaceholders, ID, MODES, platformConfig, readJson, ROOT, syncInto, writeJson } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = args[0];
const mode = flag('mode') ?? 'solo';
const title = flag('title') ?? (id ?? '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const out = resolve(flag('out') ?? join('..', id ?? ''));

const fail = (msg) => {
  console.error(`create-app: ${msg}`);
  process.exit(1);
};
if (!id || !ID.test(id)) fail(`give an id like "settlers" (lowercase letters, digits, hyphens; must match ${ID})`);
if (!MODES.includes(mode)) fail(`--mode must be one of: ${MODES.join(', ')}`);
// The title is written into JSON, TOML, HTML and YAML files: keep it to plain characters.
if (!/^[\p{L}\p{N} .,:!?'()-]{1,60}$/u.test(title)) fail('the title may use letters, digits, spaces and . , : ! ? \' ( ) - (up to 60 characters)');
if (exists(out) && readdirSync(out).some((n) => n !== '.git' && n !== 'README.md' && n !== '.gitignore')) fail(`${out} is not empty`);

const p = platformConfig();
if (p.appsHost === 'apps.example.com') console.warn('create-app: platform.config.json still has example values; fill it in before deploying.');

mkdirSync(out, { recursive: true });
const tpl = join(ROOT, 'template');
cpSync(tpl, out, { recursive: true, filter: (src) => !src.includes(`${join('src', 'samples')}`) && !src.endsWith('gitignore.txt') });
mkdirSync(join(out, 'test'), { recursive: true });
cpSync(join(tpl, 'src', 'samples', `${mode}.ts`), join(out, 'src', 'app.ts'));
cpSync(join(tpl, 'src', 'samples', `client-${mode}.ts`), join(out, 'src', 'client', 'main.ts'));
cpSync(join(tpl, 'src', 'samples', `${mode}.test.ts`), join(out, 'test', 'app.test.ts'));
cpSync(join(tpl, 'gitignore.txt'), join(out, '.gitignore'));
rmSync(join(out, 'README.md'), { force: true });
renameSync(join(out, 'APP_README.md'), join(out, 'README.md'));

const playId = `${p.playPackagePrefix}.${id.replace(/-/g, '_')}`;
fillPlaceholders(out, { APP_ID: id, APP_TITLE: title, APP_MODE: mode, PLAY_APP_ID: playId });

const cfg = readJson(join(out, 'app.config.json'));
// Play v1 is single-player and offline: only solo apps get the Play target switched on.
cfg.targets.play.enabled = mode === 'solo';
cfg.targets.play.appId = playId;
if (mode === 'turn') cfg.host.emptyRoomTtlMs = 7 * 24 * 60 * 60_000;
writeJson(join(out, 'app.config.json'), cfg);

const { version } = syncInto(out);
console.log(`Created ${id} (${mode}) in ${out} from app_builder ${version.commit}.
Next: cd ${out} && npm install && npm test
Then add "${id}" to app_builder/apps.json and redeploy the platform Worker so it shows on the index page.`);
