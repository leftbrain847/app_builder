# app_builder

The pipeline every app is built and shipped with. The full design is in `SPEC.md`; its top section is the short version.

## How other repos use this

Nothing is copied by hand, and app repos never reach back here to build:

1. **The skill** (`skills/ship-app/`) goes on your claude.ai account once. In any session, `/ship-app` tells Claude to follow this pipeline.
2. **New app:** a session runs `create-app` here. It writes the app into your new repo, including a stamped copy of the platform code in `platform/` (like a lockfile).
3. **Platform update:** change this repo, then a session runs `sync` for each app you want updated. Each app moves to the new version in its own commit, only when you say so.

## One-time setup (you, from your phone)

1. **Cloudflare:** an account with a passkey. Buy the domain. In Zero Trust (free plan), create one self-hosted Access application on `apps.<domain>` allowing your friends' emails with one-time-code login.
2. **Fill in `platform.config.json`:** hostname, zone, account id, Access team name and AUD tag, allowed emails. Or tell a session the values.
3. **Cloudflare API token:** create one for Workers deploys and add it as the `CLOUDFLARE_API_TOKEN` secret here and in each app repo.
4. **Upload the skill:** `skills/ship-app.zip` goes into your skills on claude.ai.
5. **Google Play, when ready:** the developer account ($25), a service account for uploads and an upload key. Their secrets go in each Play app's repo.

## Per app

You create an empty GitHub repo and add the token secret. Everything else is `/ship-app`.
