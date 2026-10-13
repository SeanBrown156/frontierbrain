# Repo map

Where things live in Frontier Brain. Code is in this repository. The player's own data is in the **data directory** (`APP_DATA`, else the repo root), which is never committed here.

## Top level

| Path | What it is |
|---|---|
| `web/` | The browser app (React + Vite). Entry `web/main.tsx`, routes in `web/App.tsx`, styles in `web/jade.css`. |
| `tools/` | The Node side: CLI, local API server, hosted API, data sources, calcs, AI. Plain TypeScript run directly by Node 22.18+. |
| `tools/tests/` | `npm test` (Node's test runner). `fixtures/` holds test data, `corpus.ts` the replay test corpus. |
| `tools/examples/` | Sample inputs for the CLI calcs (`npm run vgc -- calc tools/examples/damage.json`). |
| `shared/` | Types and logic imported by both `web/` and `tools/` (formats, benchmarks, workspace records). |
| `knowledge/` | Shipped reference data the code reads (see below). Data-directory copies override these. |
| `.agents/skills/` | Agent workflows: `vgc-analysis`, `vgc-teambuilding`, `vgc-coach`. Routed from `AGENTS.md`. |
| `public/` | Static files served as-is: app icons (`brand/`) and reference-site logos (`icons/`). |
| `api/index.mjs` | Vercel function stub. The real hosted API is bundled into `build/api/` by `tools/build-api.mjs`. |
| `supabase/migrations/` | Hosted database schema (workspaces, files, pool tables). |
| `docs/` | `DESIGN.md` (the Jade Glass design system), this map, `hosting.md` (who owns the hosted Supabase and Vercel projects) and `history/` (retired designs). |
| `.github/workflows/` | `hosted-pool.yml`: weekly pool refresh into Supabase. `hosted-news.yml`: seeds `knowledge/news/weeks.json` when it changes on main. `regulation-routine.yml`: daily regulation switch routine (see `docs/REGULATION_ROUTINE.md`). |
| `index.html`, `vite.config.ts`, `tsconfig*.json`, `vercel.json` | Build and deploy config. |
| `.env.example`, `config.example.json` | Templates for `.env` (keys, `APP_DATA`) and the data directory's `config.json`. |

Generated or local only (gitignored): `node_modules/`, `dist/`, `build/`, `.env*`, `settings.json`, `data/`.

## `knowledge/` (shipped)

| Path | Read by |
|---|---|
| `mechanics/champions.md` | Agent skills: verified Champions mechanics. |
| `regulations/index.json` | `tools/regulation.ts`: which regulation the app calls current (`active`), the `next` one, `nextCheckAt`, switch `history`. Written only by the regulation routine. |
| `regulations/<id>.json` | `tools/regulation.ts`, `tools/format.ts`: one record per regulation (dates, `status`, `confidence`, `engine.verified`, rules). `m-c.json` is the only verified record; a switch changes the label, never teams or data. |
| `regulations/notices.json` | Player-facing regulation notices (`{notices:[{id,at,kind:'regulation',level,title,body,url?}]}`, newest 50), appended by the routine; read by the Inbox. |
| `playbook/` | `tools/playbook.ts`: doubles primer (sent with every prompt) and full fundamentals. |
| `samples/` | `tools/samples.ts`: starter teams for new hosted workspaces (built by `tools/build-samples.ts`). |
| `sources/` | `tools/research.ts`, `tools/library.ts`: source catalogue, `INDEX.md`, research routes. |

## `tools/` by area

**Entry points**
- `cli.ts`: `npm run vgc -- <command>` (see `npm run vgc -- help` and `tools/README.md`).
- `dev.mjs`: `npm run dev` (local) and `npm run dev:hosted`.
- `workbench-server.ts`: the local API behind the UI (`/api/*`).
- `hosted.ts`, `vercel-entry.ts`, `keep-alive.ts`: the hosted (Supabase + Vercel) API.
- `mcp.ts`: the MCP connector for Claude, ChatGPT and CLI agents.
- `replay-intake.ts`: replay add (links or HTML, auto-link) and single-replay delete, shared by the HTTP API and MCP. `pokepaste.ts`: publish a team to pokepast.es.
- `focus.ts`: what the player has open (`get_focus`) and the calcs an assistant ran over MCP, kept in small per-user files outside the workspace revision. The app reports focus from `web/focus.ts` and lists the calcs in `web/team/AssistantCalcs.tsx`.
- `scheduled-run.ts`: `npm run daily` and `npm run weekly` (no AI).

**Workspace storage** (teams, sets, versions, replays)
- `io.ts`: paths. `CODE` is the repo, `ROOT` the data directory.
- `workbench-store.ts`: `readStore()` / `mutateLatest()`. All record writes go through here.
- `workbench-data.ts`, `workbench-jobs.ts`, `workbench-worker.ts`, `workbench-seed.ts`: API data shaping, background jobs, test seeding.
- `teams.ts`, `coaching.ts`: CLI team import and strategy records.
- Bench (per-team candidates): `Formula.bench` in `shared/workbench.ts`, `bench-*` actions in `workbench-store.ts`, MCP tools in `mcp-bench.ts`, UI in `web/team/Bench.tsx`.
- `backup.ts`: workspace backup and restore. `migrate-coach.ts`: one-off migration from the old record format.

**Replays**
- `replays.ts`: parse saved HTML into the index. `replay-links.ts`: Showdown links to HTML.
- `replay-link.ts`: automatic team/edit linking. `observed.ts`: what a game proves about the player's sets.
- `replay-summary.ts`: AI per-game summaries and team digests.

**Battle engine and calcs**
- `mechanics.ts`: stats, damage, speed and spread search on the pinned Showdown engine.
- `format.ts`: format rules for validation and AI prompts; `regulationStatus()` reads the active record from the regulation index. `regulation.ts`: regulation index and records, validators. `regulation-routine.ts`: the self-correcting switch routine (`npm run vgc -- regulation-check`). `../shared/benchmarks.ts`: saved calcs.

**Metagame data** (never blended; see AGENTS.md)
- `pool.ts`: the deduplicated team pool. `pool-db.ts`: the same pool as Supabase `pool_*` rows. `pool-names.ts`: reviewed corrections for misspelled names in team lists. `pool-import.ts`: pool team to editable team.
- `limitless.ts`, `vgcpastes.ts`, `meta-sets.ts`: upstream sources and standard opponent sets.
- `typical-set.ts`, `profile.ts`: expected sets and per-species profiles.
- `research.ts`, `library.ts`: `refresh`, source checks and the reference library.
- `icons.ts`: sprite sheets, HOME renders, site icons (cached in the data directory).

**AI**
- `chat.ts`, `assist.ts`: the Ask Frontier Brain tool loop. `ai-jobs.ts`: background jobs.
- `models.ts`: model tiers per provider. `player.ts`: what the assistant remembers about the player. `playbook.ts`: fundamentals.

**Build and hosting**
- `build-dependencies.mjs`: postinstall build of the pinned Showdown simulator.
- `build-api.mjs`: bundles the hosted API for Vercel. `hosted-seed.ts`: copies shared data into Supabase. `build-samples.ts`: starter teams.

## `web/` by area

- `App.tsx`: hash routing (`#team/...`, `#data`, `#account`, `#welcome`) and the app shell.
- `team/`: the team hub (`Hub.tsx`), Pokémon page (`PokemonWorkspace.tsx`), strategy (`Coaching.tsx`), replays, benchmarks, new team.
- `ai/`: the Ask Frontier Brain dock, pickers and set tiles, AI key storage.
- `brain/`: the wireframe brain backdrop.
- `DataPool.tsx`, `BenchmarkLab.tsx`: the data pool page and the benchmark lab.
- `Coach.tsx`: the filterable replay table, used by the team hub and Replays tab.
- `Settings.tsx`, `AccountMenu.tsx`, `auth.tsx`, `Consent.tsx`: account, sign-in (hosted only) and the MCP OAuth consent page.
- `ui.tsx`, `icons.tsx`, `save-state.ts`: shared components, the API client, icons and save status.

## The data directory (not in this repo)

Set by `APP_DATA`. Locally it's `data/` inside the checkout, a separate private git repo.

| Path | Contents |
|---|---|
| `config.json`, `context/player.md` | Showdown name, aliases, timezone, coaching level; personal goals. |
| `teams/`, `pokemon/` | Team milestones and edit logs; the Pokémon set library. `teams/index.json` is the manifest. |
| `replays/originals/`, `replays/associations.json` | Saved replay HTML (never edited) and replay-to-team links. |
| `reports/` | Coaching findings, replay summaries and digests, chats, daily and weekly reports. |
| `knowledge/metagame/`, `knowledge/pool/`, `knowledge/news/` | Downloaded metagame data, the team pool and weekly news. Rebuilt by `refresh`. News also ships in the repository (`knowledge/news/weeks.json`, written weekly by the frontier-brain-news routine); per week the more recently researched copy wins. |
| `knowledge/artwork/` | Cached sprites and renders. Re-downloaded on demand. |
| `backups/` | Workspace backups. |
