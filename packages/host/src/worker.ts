import { hostConfig } from './config';
import type { Env } from './env';
import { deny } from './headers';
import { route, type RouterDeps } from './router';
import { UsageTally } from './usageCore';

export { GameRoom } from './room';
export { SoloRun, Scores } from './solo';
export { UsageMeter } from './usage';

/** Per isolate: usage tallied in memory and flushed in batches, plus the last usage report seen. */
const tally = new UsageTally(hostConfig().usageFlushMs);
let lastReport: RouterDeps['lastReport'] = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const deps: RouterDeps = {
      fetch: (input, init) => fetch(input, init),
      nowS: () => Math.floor(Date.now() / 1000),
      keysTtlMs: hostConfig().accessKeysTtlMs,
      keysMinRefreshMs: hostConfig().accessKeysMinRefreshMs,
      clockSkewS: hostConfig().clockSkewS,
      host: hostConfig(),
      waitUntil: (p) => ctx.waitUntil(p),
      tally,
      lastReport,
    };
    try {
      const res = await route(request, env, deps);
      lastReport = deps.lastReport;
      return res;
    } catch {
      return deny(500);
    }
  },
} satisfies ExportedHandler<Env>;
