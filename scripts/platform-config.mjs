#!/usr/bin/env node
// Regenerate the platform Worker's wrangler config from platform.config.json and apps.json.
//   node scripts/platform-config.mjs
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ID, platformConfig, readJson, renderPlatformWrangler, ROOT } from './lib.mjs';

const apps = readJson(join(ROOT, 'apps.json'));
for (const a of apps) if (!ID.test(a.id) || typeof a.title !== 'string') throw new Error(`apps.json: bad entry ${JSON.stringify(a)}`);
writeFileSync(join(ROOT, 'packages', 'host', 'wrangler.platform.toml'), renderPlatformWrangler(platformConfig(), apps));
console.log(`wrote packages/host/wrangler.platform.toml (${apps.length} apps)`);
