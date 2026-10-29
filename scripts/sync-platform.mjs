#!/usr/bin/env node
// Refresh an app's copy of the platform from this checkout of app_builder.
//
//   node scripts/sync-platform.mjs <app dir>
//
// Replaces <app>/platform/, regenerates wrangler.toml and the shared CI and
// scripts. The app's own code and app.config.json are left alone. Review the
// diff, run the app's tests, then commit: that commit is the version bump.
import { resolve } from 'node:path';
import { exists, readJson, syncInto } from './lib.mjs';

const dir = process.argv[2];
if (!dir || !exists(resolve(dir, 'app.config.json'))) {
  console.error('sync: give the path to an app repo (the folder with app.config.json)');
  process.exit(1);
}
const before = exists(resolve(dir, 'platform/VERSION.json')) ? readJson(resolve(dir, 'platform/VERSION.json')).commit : 'none';
const { app, version } = syncInto(resolve(dir));
console.log(`Synced ${app.id}: platform ${before} → ${version.commit}. Run its tests, then commit.`);
