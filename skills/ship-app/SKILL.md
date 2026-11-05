---
name: ship-app
description: Builds, ships or updates one of J's apps on the app_builder pipeline (friends link on Cloudflare, optional Google Play build). Use when J types /ship-app, or asks to make a new app, deploy an app, publish to Play, or update an app to a newer platform version.
disable-model-invocation: true
---

# Ship an app on app_builder

The pipeline's real instructions live in the `leftbrain847/app_builder` repo, not here, so they stay current without re-uploading this skill.

1. **Get the current spec.**
    - If app_builder isn't in this session, attach it (owner `leftbrain847`, repo `app_builder`) and clone it.
    - Read its `SPEC.md`: the "For Claude Code" part, and the Status table in section 1 before promising anything.
    - If you're in an existing app repo and can't reach app_builder, read that repo's `platform/SPEC.md` and say it may be out of date.
2. **Work out which job this is.**
    - **New app:** follow SPEC section 8.
        - Ask J for the app's id, title and mode (`solo`, `turn`, or `invite` for no-login play by link) only if the request doesn't make them clear.
        - J must create the empty GitHub repo; you can't. Ask for its name, attach it with push access, and clone it.
    - **Change an existing app:** work in its repo, following its CLAUDE.md and `platform/SPEC.md`.
    - **Update an app's platform:** follow SPEC section 9. Compare `platform/VERSION.json` with app_builder's current commit and say what changed before syncing.
    - **Release to Play:** follow SPEC sections 5 and 7. Remind J of the one-time manual steps still open.
3. **Before calling anything shipped,** meet SPEC section 8's definition of shipped:
    - typecheck, tests and build all pass
    - for Play apps, `npm run build:play` passes too
    - the smoke test is green after CI deploys
4. **Report briefly.**
    - Say what shipped and its URL (`https://<appsHost>/<id>/`).
    - List what J still has to do by hand, such as adding the `CLOUDFLARE_API_TOKEN` repo secret.
    - Flag any *(verify)* item from the Status table that this work depended on.

Never edit an app's `platform/` folder by hand, never weaken SPEC section 11's security rules, and never promote a Play release past the internal track.
