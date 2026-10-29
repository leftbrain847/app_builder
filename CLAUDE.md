# app_builder

The shared platform for J's apps: host library, client SDK, platform Worker, app template, scripts, CI and the ship-app skill. `SPEC.md` is the design and the source of truth; read its "For Claude Code" part before changing anything.

## Decisions already made (do not relitigate without asking)

- Friends apps: Cloudflare Workers + Durable Objects behind Cloudflare Access, one hostname, one Worker per app at `/<id>/`.
- Play apps: single-player, offline, Capacitor-bundled. No TWA, no network.
- Apps vendor the platform into `platform/` via `sync`; no npm registry, no cross-repo access at build time.
- Settings are config: `platform.config.json` (shared), `app.config.json` (per app), typed rule objects in code.

## Rules

- Run `npm run typecheck && npm test` before every commit. CI also generates a solo and a turn app from `template/` and runs their checks; keep that green.
- Exact dependency pins, `npm ci` only, no new dependencies without asking. The host has no runtime dependencies.
- Anything rendered into an app's `wrangler.toml` lives in `scripts/lib.mjs`. Change it there, never in a generated file.
- Keep `SPEC.md` section 1 (Status) truthful. When something moves from "written" to "tested live", update it in the same commit.
- Never weaken the security rules in SPEC.md section 11 without J's explicit OK.
- Conventional commits.
