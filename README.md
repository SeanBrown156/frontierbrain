# Frontier Brain

**The open-source brain for Pokémon VGC.** Build teams, run exact damage and speed calcs, and learn from your replays, with the AI you already use.

Frontier Brain is built for Pokémon Champions doubles (Regulation M-C). It's free and open source, and AI is bring-your-own: use your own OpenAI or Anthropic key, or connect your own Claude, ChatGPT or coding agent over MCP. Nobody pays for anyone else's AI.

> **Try it:** https://frontierbrain.vercel.app (Google sign-in, or continue as a guest). Or run it yourself, below.

> Not affiliated with or endorsed by Nintendo, The Pokémon Company, Game Freak or Creatures. Pokémon and Pokémon character names are trademarks of Nintendo. Battle mechanics come from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) and [@smogon/calc](https://github.com/smogon/damage-calc) (MIT).

## What it does

- **Team builder.** Start from proven tournament teams, paste a Showdown or PokePaste team, or ask the AI to build one. Iterate on your matchup strategy and lead pairings.
- **Integrated calculators.** Damage and speed calcs on Champions mechanics, built into the Pokémon page: no sea of dropdowns. Calc straight from your Pokémon against the format-defining sets, and save benchmarks for later.
- **Replay analysis.** Paste Showdown replays and see who you're beating, who you're losing to, and what to work on, with AI summaries judged from the information available at each turn. (Video replay analysis is coming.)
- **One consolidated data source.** Tournament results, usage and sets from Limitless, PokéBase, Pikalytics, VGCPastes, Smogon and Showdown, pooled and deduplicated in one place and refreshed on a schedule.
- **Use the AI tools you already use.** Connect with your own API key for the in-app chat, or connect via MCP so Claude, ChatGPT, Claude Code, Codex CLI, Cursor or VS Code can read your teams, run exact calcs and propose plans.

## Run it locally

Requires Node 22.18 or newer.

```sh
git clone https://github.com/SeanBrown156/frontierbrain && cd frontierbrain
npm install                 # also builds the pinned Showdown simulator
cp .env.example .env        # optional: AI key, data directory
cp config.example.json "${APP_DATA:-.}/config.json"   # optional: your Showdown name (to find your side in replays)
npm run dev                 # http://127.0.0.1:5173 (use this address, not localhost)
```

Your data (teams, sets, replays, reports, downloaded metagame data) is written to the **data directory**: `APP_DATA` from `.env`, or the repository folder when it's unset (those folders are gitignored). Keeping it in a separate folder, for example `APP_DATA=../my-vgc-data`, keeps your own data out of the code checkout. The tournament pool downloads on first start.

### Hosted mode

With the Supabase variables in `.env.example` set, `npm run dev` (or `npm run dev:hosted`) runs like the hosted site: Google sign-in, guest sessions and per-user data. Deployment, ownership and scheduled jobs are in [docs/hosting.md](docs/hosting.md).

### Working with an AI agent

The repo is set up for coding agents (Claude Code, Codex and others): `AGENTS.md` and the skills in `.agents/skills/` describe the research, teambuilding and replay-coaching workflows, and `npm run vgc -- help` lists the calc and data commands an agent can run. The browser UI shows the results live.

## Using the app

Everything starts from a team.

- **Teams.** Each card opens a team; background builds show progress here.
- **Team hub** (`#team/<id>/<tab>`), with four tabs:
  - **Pokémon**: the six, one per row on phones. Click a Pokémon to edit it; **Swap** opens it with the species picker focused.
  - **Strategy**: the overall game plan, lead strategy and matchup strategy (`teams/<id>/coaching.json`). Lead-combo and opponent tables appear once replays are linked, flagged below 5 games.
  - **Replays**: add links or HTML files; filters by opponent Pokémon, style and result; one card per game with an AI summary. A **Who gives you trouble** panel shows your toughest and easiest opponents, with counts.
  - **Manage**: export (Showdown paste or PokePaste), the format, duplicating the team, the history of every saved change (view or restore any of them), and deleting the team.
- **Pokémon page** (`#team/<id>/mon/<version>/<slot>`): one editable set card next to the **Calc** (damage and speed), which follows your edits.
  - Multi-hit moves show per-hit rolls and an exact KO chance over every roll combination; pick the hit count where it varies.
  - Rage Fist, Last Respects, Stomping Tantrum, Avalanche, Assurance and Payback ask for the battle state they depend on; immunities show 0.
  - **Find a spread…** hands the question to Ask Frontier Brain, which runs the spread search.
  - **☆ Save to My sets** stars a set so the species picker offers it later.
- **Saving.** Changes save in the background; a notice appears only if a save fails. Every saved change is kept in the team's history.
- **Ask Frontier Brain.** One docked chat per team (press `/`), described below.
- **Nav and references.** The nav groups sources into Data, Results, Learn, Community and Play, headed by Frontier Brain's own combined data. **All references** lists the same sources with the same titles and descriptions, plus a **Built on** section for the official rules and open-source engines the calcs follow. A weekly news ticker runs across the top.
- **Settings.** Your Showdown name, AI connection (an **API key / MCP** switch), Pokémon art style (HOME renders or Showdown sprites), backup and restore, and account deletion.

## Data: the team pool

All real-usage answers come from **one deduplicated pool of individual teams** (`tools/pool.ts`, `#data` page). Every percentage is computed there once:

| Lane | Source | Gives |
|---|---|---|
| official | Limitless official events (RK9 open team sheets) | Day 2 lists and placings, no stat points |
| online | Limitless online tournaments (public API, ≥16 players, custom-rule events skipped) | Full lists, placings, records |
| shared | VGCPastes → PokePaste | Exact spreads |

- **Merging:** a shared paste of the same team (same six, plus the same player, or the same event and placing, shared after the event) is merged into the tournament list. The verified list gains exact spreads, and the paste isn't counted twice.
- **Not ingested:** mirrors (StatCrusher, MunchStats' Showdown tabs, Top Cut Explorer) and composites (Suckerpunch, Pikalytics, LabMaus). They stay as links and cross-checks.
- **Refresh:** every 12 h while the app runs, with `npm run daily`, or with **Refresh now**. In the hosted site it's a scheduled job.
- **"Typical" spreads** use the pool when it has at least 8 exact spreads for the species. Otherwise PokéBase's M-C tournament aggregate is used, labelled. Other single sources can still be requested by name, and are never blended.

## Bring your own AI

There are two ways in, and you can use either or both.

**API key (in-app chat).** Add `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to `.env` locally, or paste a key in Settings on the hosted site, where it stays in your browser and is used only for your requests. Pick the model in the Ask Frontier Brain panel (chats) and the New team dialog (builds); defaults are a light model for chat and a flagship for builds, for either provider (`tools/models.ts`).

- One conversation per team, docked on every team page. It knows which page you're on and can propose sets, a full team, the strategy, leads and matchups.
- It's a tool loop (`tools/chat.ts`, `tools/assist.ts`): every number comes from the local Champions engine or the team pool. Proposals are rules-checked before you see them.
- Proposals are tiles to **Accept** or **Reject**; an AI-built team arrives as a separate draft. Nothing about your current team changes until you accept.
- Requests are background jobs (`tools/ai-jobs.ts`) with Cancel and Retry. Replay HTML never goes to the provider.

**MCP (your own subscription).** Frontier Brain is a remote MCP server at `/api/mcp` (`tools/mcp.ts`): `https://frontierbrain.vercel.app/api/mcp` on the hosted site, or `http://127.0.0.1:5173/api/mcp` locally. Add it as a connector in Claude or ChatGPT, or use `claude mcp add --transport http frontier-brain <url>` (Claude Code), `codex mcp add frontier-brain --url <url>` (Codex CLI), or the JSON snippet for Cursor and VS Code. You approve access when connecting. Your assistant can then read your teams and replays, run exact damage and speed calcs, look up the pool, usage and sets, edit a Pokémon's moves, item, nature and stat points, write and edit lead and matchup plans (new ones arrive as proposals for you to accept), and save calcs as benchmarks. Changes to sets and teams are kept in the team's History so they can be restored; deleting a team needs your explicit say-so. Settings shows the exact steps for each client.

## Teams and replays

- **+ New team** has three tabs: **From tournaments** (search the pool and import a real team, with exact or labelled spreads), **Build from a prompt**, and **Paste or PokePaste link**. Nothing is saved until **Create team**.
- **Replays** are added from a team's Replays tab as Showdown links (paste several) or downloaded HTML files. They link to the team that played them, at the sets current when the game was played. Links work only for replays saved with Showdown's "Upload and share replay".
- Data is plain JSON in the data directory (`APP_DATA`): `teams/<id>/`, `pokemon/<id>/` and `replays/`. Write through `tools/workbench-store.ts` or the API; writes are journalled and stale-checked.
- **Backup and restore** are in Settings: one file with your teams, sets, strategy, replays and summaries. Restoring adds what's missing and never overwrites anything.

## Known limits

- Spread search covers at most three free damage dimensions. It is not global team optimisation.
- PokéBase publishes no exact team count for tournament stats; the label uses the largest teammate pairing as a lower bound. Pikalytics has no Champions spreads.
- Local mode is loopback-only with no accounts. Don't expose the dev server. Replay HTML is never executed.
- Replay video analysis isn't built yet.
- `npm audit` flags Showdown's optional server dependencies. The app uses only the pinned simulator.

## Data sources and attribution

Tournament data is fetched from its publishers at runtime and cached; it is not redistributed in this repository. Sources are always labelled and never blended: [Limitless](https://limitlesstcg.com), [VGCPastes](https://twitter.com/VGCPastes) and [PokePaste](https://pokepast.es), [PokéBase](https://pokebase.app), [Pikalytics](https://www.pikalytics.com) and Smogon usage stats. Box icons come from [Pokémon Showdown](https://pokemonshowdown.com), downloaded on demand. See `knowledge/sources/INDEX.md` for the full reference library.

## Development

```sh
npm test            # node:test suite (temp workspaces; anonymised replay fixtures)
npm run check       # tsc for tools and web
npm run build       # production web build
npm run daily | npm run weekly | npm run vgc -- help
```

- [Repo map](docs/REPO_MAP.md) · [Design system](docs/DESIGN.md) · [Hosting](docs/hosting.md)
- [Source quick reference](knowledge/sources/INDEX.md) · [Research routes](knowledge/sources/research-routes.md) · [Tool commands](tools/README.md)
- Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
