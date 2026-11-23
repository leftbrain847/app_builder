# app_builder

The shared platform for J's apps: host library, client SDK, platform Worker, app template, scripts, CI and the ship-app skill. `SPEC.md` is the design and the source of truth; read its "For Claude Code" part before changing anything.

## Decisions already made (do not relitigate without asking)

- Friends apps: Cloudflare Workers + Durable Objects behind Cloudflare Access, one hostname, one Worker per app at `/<id>/`.
- Invite apps (no login): the same, but on `friendsHost`, outside Access; the Worker checks the host key, signed room links and invite approval itself.
- Play apps: Capacitor-bundled, no TWA. Today they are single-player and offline, and the guards below enforce it. J has dropped that as a permanent rule (Nov 2026): online and multiplayer Play apps are allowed, but designing it (accounts, auth, hosting, moderation) is a bridge crossed only when a specific app is about to go live that way. Until then, keep the guards and don't build ahead.
- Apps vendor the platform into `platform/` via `sync`; no npm registry, no cross-repo access at build time.
- Settings are config: `platform.config.json` (shared), `app.config.json` (per app), typed rule objects in code.

## Rules

- Run `npm run typecheck && npm test` before every commit. CI also generates a solo, a turn and an invite app from `template/` and runs their checks; keep that green.
- Exact dependency pins, `npm ci` only, no new dependencies without asking. The host has no runtime dependencies.
- Anything rendered into an app's `wrangler.toml` lives in `scripts/lib.mjs`. Change it there, never in a generated file.
- Keep `SPEC.md` section 1 (Status) truthful. When something moves from "written" to "tested live", update it in the same commit.
- Never weaken the security rules in SPEC.md section 11 without J's explicit OK.
- Conventional commits.

## Working rules for agents (shared across J's repos)

- **Public-safe by default.** Write everything as if this repo will be public tomorrow. No secrets or real personal data in code, config or history (keys go in env vars and GitHub secrets). No security through hidden code: anything that would be unsafe if the repo went public is a bug, so flag it.
- **PRs, never pushes to `main`.** Every change goes through a pull request. Claude merges it once CI is green and, for high-risk PRs, an independent review has passed; J gets a short summary instead of a review queue. Hold a PR for J only when it needs a decision or a look CI can't give (visuals, money, anything irreversible).
- **Every PR opens with a risk tier and a 60-second check.** First line: `Risk: low | medium | high`. Then what could break and the exact lines worth reading.
- **High risk = these paths, or anything that publishes or touches auth:** `.github/`, secrets and tokens, auth and host code, `wrangler.toml` or other deploy config, anything that makes something public. High-risk PRs get an independent review (a fresh agent that hasn't seen the work) before J is asked to merge.
- **No generated files in PRs.** Outputs that a workflow rebuilds stay out of PRs, so they can't collide with that workflow.
- **Small PRs.** One purpose each. Split anything J can't check from a phone in about a minute.
- **Check before explaining.** Read the log, run the test, open the file. A guess is labeled as a guess.
- **Include a ready-to-paste Claude Code prompt** in each PR, as the alternative to merging.
