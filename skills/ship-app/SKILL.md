---
name: ship-app
description: Builds, ships or updates one of J's apps on the app_builder pipeline (the day's sprint demo, then the friends link on Cloudflare and an optional Google Play build). Use when J types /ship-app, or asks to make a new app, ship today's sprint build, deploy an app, publish to Play, or update an app to a newer platform version.
disable-model-invocation: true
---

# Ship an app on app_builder

The pipeline's real instructions live in the `leftbrain847/app_builder` repo, not here, so they stay current without re-uploading this skill.

1. **Get the current spec.**
    - If `app_builder` or `index` isn't in this session, attach it (owner `leftbrain847`) and clone it.
    - Read app_builder's `SPEC.md`: the "For Claude Code" part, and the Status table in section 1 before promising anything.
    - If you're in an existing app repo and can't reach app_builder, read that repo's `platform/SPEC.md` and say it may be out of date.
2. **Work out which job this is.**
    - **New app (one sprint day):** follow SPEC section 8 from start to finish in this session. The day ships when its demo artifact is published and its snapshot is in a PR, not when Cloudflare deploys.
        - Date everything in J's time zone (`app.config.json` → `sprint.timeZone`, America/New_York), never UTC.
        - Pick the mode from the request: `solo` for single-player, `invite` for multiplayer. Ask only if it's genuinely unclear.
        - J creates the empty GitHub repo; you can't. If it isn't attached, ask for its name, attach it with push access, and clone it.
    - **Change an existing app:** work in its repo, following its CLAUDE.md and `platform/SPEC.md`. A later change is not a new sprint day: run `npm run live` and commit `live/<Title>.html` (the living version), never a new or edited file in `snapshots/`, unless J says this is a new sprint day. Share it as one living artifact titled with the app's name, republished in place.
    - **Update an app's platform:** follow SPEC section 9. Compare `platform/VERSION.json` with app_builder's current commit and say what changed before syncing.
    - **Release to Play:** follow SPEC sections 5 and 7. Remind J of the one-time manual steps still open.
3. **Before calling anything shipped,** meet the matching definition at the end of SPEC section 8:
    - **sprint day:** artifact published, snapshot in the app PR, `build:demo` green, and play-tested at phone width like a person, and `demo/clip.json` scripted to show the core function in its first 1–2 seconds, and `depth.json` filled in (a score and a plan for every pillar) with `npm run depth` run
    - **friends:** typecheck, tests and build pass, and the smoke test is green after CI deploys
    - **Play:** `npm run build:play` passes too
4. **Report briefly.**
    - Lead with the artifact link (or the live URL `https://<host>/<id>/`).
    - List the PRs J has to merge, in order, and when the public sprint site will show the day.
    - List what J still has to do by hand, such as adding the `CLOUDFLARE_API_TOKEN` repo secret (and `ALLOWED_EMAILS` for solo and turn apps if `requireEmailAllowlist` is on).
    - Include the depth table from `npm run depth`. If it warns "hypercasual", say so in the first lines: it's a warning, not a block.
    - Flag any *(verify)* item from the Status table that this work depended on.

Follow each repo's "Working rules for agents": PRs only, never merge, a risk tier and a 60-second check on each PR. Never edit an app's `platform/` folder by hand, never weaken SPEC section 11's security rules, and never promote a Play release past the internal track.
