# app_builder

The pipeline every app is built and shipped with. The full design is in `SPEC.md`; its top section is the short version.

## Run

```sh
npm ci
npm run create-app -- <id> --mode solo|turn|invite --out <dir>   # new app repo
npm run sync -- <app dir>                                        # update an app's platform/ copy
```

## Test

```sh
npm run typecheck && npm test
```

CI also generates a solo, turn and invite app from `template/` and runs their checks.

## How other repos use this

Nothing is copied by hand, and app repos never reach back here to build:

1. **The skill** (`skills/ship-app/`) goes on your claude.ai account once. In any session, `/ship-app` tells Claude to follow this pipeline.
2. **New app:** a session runs `create-app` here. It writes the app into your new repo, including a stamped copy of the platform code in `platform/` (like a lockfile).
3. **Platform update:** change this repo, then a session runs `sync` for each app you want updated. Each app moves to the new version in its own commit, only when you say so.

## One-time setup (you, from your phone)

1. **Cloudflare:** an account with a passkey. Buy the domain. In Zero Trust (free plan), create one self-hosted Access application on `apps.<domain>` allowing your friends' emails with one-time-code login.
2. **Only if you make invite apps:** in Cloudflare (Security → WAF → Rate limiting rules, one rule on the free plan), limit requests to your `friendsHost` (e.g. `play.<domain>`), say 60 per 10 seconds per IP, action Block. It stops a stranger from spending the shared free quota.
3. **Fill in `platform.config.json`:** hostname, the no-login hostname for invite apps (`friendsHost`, e.g. `play.<domain>`; keep it OUT of Access), zone, account id, Access team name and AUD tag. Or tell a session the values. Never friends' emails: this repo may be public. For the second email check, add an `ALLOWED_EMAILS` secret (comma-separated) here and in each solo or turn app repo, and set `requireEmailAllowlist` to `true` (see SPEC.md, Operations).
4. **Cloudflare API token:** create one for Workers deploys and add it as the `CLOUDFLARE_API_TOKEN` secret here and in each app repo.
5. **Upload the skill:** `skills/ship-app.zip` goes into your skills on claude.ai.
6. **Google Play, when ready:** the developer account ($25), a service account for uploads and an upload key. Their secrets go in each Play app's repo.

## Per app

You create an empty GitHub repo and add the token secret. Everything else is `/ship-app`.
