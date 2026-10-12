# Hosted deployment

Who owns what for frontierbrain.vercel.app. No secrets here: keys live in Vercel environment variables and in a
local, untracked `.env.hosted`.

| Piece | Where | Notes |
| --- | --- | --- |
| Database, auth, storage | Supabase org **Frontier Brain** (`bllfdmvooghyzyzsvykl`), project **frontierbrain** (ref `txsjxommeirxuiclooel`) | Sydney (`ap-southeast-2`), Postgres 17, Free plan |
| Web app and API | Vercel team **Sean's projects** (`seans-projects-95ee1f5b`), project **frontierbrain** (`prj_Q6T4APAT62jHiJZBgPngzOU7hloh`) | Region `syd1`; production at https://frontierbrain.vercel.app |
| Source and automation | GitHub `SeanBrown156/frontierbrain` | Actions secrets `SUPABASE_URL`, `SUPABASE_SECRET_KEY` |

## Billing

- Supabase: org **Frontier Brain**, Free plan (checked 2026-10-12).
- Vercel: team **Sean's projects**, Pro plan (checked 2026-10-12), paid by the team owner (`seanbrown156`).
- GitHub Actions: public repository, standard runners (no charge).
- AI: never paid by the site. Players bring their own key or connect Claude/ChatGPT; the weekly news routine runs on
  the owner's Claude subscription.

## Scheduled jobs

- `hosted-pool.yml` (GitHub Actions, Mondays 22:00 UTC): pool refresh → `pool_*` tables → pool files in `shared_files`.
- `hosted-news.yml` (GitHub Actions, on push of `knowledge/news/weeks.json`): schema test → news file in `shared_files`.
- `frontier-brain-news` (Claude routine, Sundays 21:00 UTC, no connectors): researches the week and commits
  `knowledge/news/weeks.json` to main.

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
