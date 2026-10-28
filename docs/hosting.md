# Hosted deployment

Who owns what for frontierbrain.vercel.app. No secrets here: keys live in Vercel environment variables and in a
local, untracked `.env.hosted`.

| Piece | Where | Notes |
| --- | --- | --- |
| Database, auth, storage | Supabase org **Frontier Brain** (`bllfdmvooghyzyzsvykl`), project **frontierbrain** (ref `txsjxommeirxuiclooel`) | Sydney (`ap-southeast-2`), Postgres 17, Free plan |
| Web app and API | Vercel team **Sean's projects** (`seans-projects-95ee1f5b`), project **frontierbrain** (`prj_Q6T4APAT62jHiJZBgPngzOU7hloh`) | Region `syd1`; production at https://frontierbrain.vercel.app |
| Source and automation | GitHub `SeanBrown156/frontierbrain` | Actions secrets `SUPABASE_URL`, `SUPABASE_SECRET_KEY` |

## Accounts

- Sign-in is **Google only**, plus anonymous guest sessions. There are no email/password accounts, so no confirmation
  or reset emails and no SMTP sender. In Supabase → Authentication → Sign In / Providers: Google and anonymous
  sign-ins on, Email off.
- A guest who signs in with Google is upgraded in place (`linkIdentity`); signing in to an existing account carries
  the guest's teams over (`stashGuestWork` / `bringGuestWork` in `web/auth.tsx`).
- Settings → Delete your account calls `POST /api/account-delete`: it revokes every session, then deletes the user
  with the secret key; workspaces and files cascade.

## Billing

- Supabase: org **Frontier Brain**, Free plan (checked 2026-10-12).
- Vercel: team **Sean's projects**, Pro plan (checked 2026-10-12), paid by the team owner (`seanbrown156`).
- GitHub Actions: public repository, standard runners (no charge).
- AI: never paid by the site. Players bring their own key or connect Claude/ChatGPT; the weekly news routine runs on
  the owner's Claude subscription.

## Scheduled jobs

- `hosted-pool.yml` (GitHub Actions, Mondays 22:00 UTC): pool refresh → `pool_*` tables → pool files in `shared_files`.
- `hosted-guest-cleanup.yml` (Sundays 20:00 UTC): deletes guest sessions not seen for 30 days (anonymous users only; their workspace and files cascade). Manual runs default to a dry run that reports counts. Signed-in accounts are never touched.
- `hosted-news.yml` (GitHub Actions, on push of `knowledge/news/weeks.json`): schema test → news file in `shared_files`.
- `frontier-brain-news` (Claude routine, Sundays 21:00 UTC, no connectors): researches the week and commits
  `knowledge/news/weeks.json` to main.

The pool job restores the last published pool from `shared_files` on every run. Source caches use both the
Actions cache and a 30-day `hosted-pool-cache` artifact, so a delayed weekly run can recover after cache eviction.
Limitless requests are paced at two seconds and retry rate limits with exponential backoff and `Retry-After`.
Any failed lane stops publication; a cold, incomplete refresh records `last-attempt.json` without saving a pool.
The loader retains its 5% shrink guard, both pool files publish together, seed errors fail the job, and verification compares the published files,
snapshot timestamp and all five table counts.

To recover manually, use an isolated data directory (not the player's `APP_DATA`). Load `.env.hosted` before
running the scripts; its `VITE_SUPABASE_URL` is accepted as an alternative to `SUPABASE_URL`:

```sh
export APP_DATA=.cache/hosted-pool-refresh
node --env-file=.env.hosted tools/hosted-pool.ts restore
node --input-type=module -e 'const {refreshPool}=await import("./tools/pool.ts"); const s=await refreshPool(); if(s.errors?.length)throw new Error(s.errors.join("; "));'
node --env-file=.env.hosted tools/pool-db.ts
node --env-file=.env.hosted tools/hosted-seed.ts --only knowledge/pool/
node --env-file=.env.hosted tools/hosted-pool.ts verify
```

Do not bypass the shrink guard to recover a failed source fetch. Restore and retry instead. A successful refresh
can be published only after its sources finish without errors. Shared file caches on running API instances may
take up to ten minutes to see the newly seeded pool.

## Environment variables

Vercel (production and preview; the first two also for development):

- `VITE_SUPABASE_URL`: the project URL, `https://txsjxommeirxuiclooel.supabase.co`.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: public by design; it ships in the browser bundle.
- `SUPABASE_SECRET_KEY`: server only (Supabase → Project Settings → API Keys → Secret keys). Never in the bundle.

`npm run dev:hosted` reads the same three from `.env.hosted`. There is one Supabase project, so local hosted mode
reads and writes production data.

## Migrations

`supabase/migrations/` file versions match the remote `supabase_migrations.schema_migrations` versions, so
`supabase db push` sees them as applied. Add new migrations with `supabase migration new <name>`.
