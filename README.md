# Frontier Brain

**Your competitive second brain** for Pokémon Champions VGC doubles: build teams, run exact damage calcs, review replays with AI, and keep up with the tournament metagame.

Frontier Brain is free and open source. AI is bring-your-own: plug in your own OpenAI or Anthropic key, or connect your own Claude or ChatGPT over MCP. Nobody pays for anyone else's AI.

> **Status:** early. It runs locally today. A hosted version with accounts (Google sign-in, or try it as a guest) and an MCP connector for Claude and ChatGPT is in progress.

> Not affiliated with or endorsed by Nintendo, The Pokémon Company, Game Freak or Creatures. Pokémon and Pokémon character names are trademarks of Nintendo. Battle mechanics come from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) and [@smogon/calc](https://github.com/smogon/damage-calc) (MIT).

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

### Working with an AI agent

The repo is set up for coding agents (Claude Code, Codex and others): `AGENTS.md` and the skills in `.agents/skills/` describe the research, teambuilding and replay-coaching workflows, and `npm run vgc -- help` lists the calc and data commands an agent can run. The browser UI shows the results live.

## How the app is organised

Everything starts from a team.

- **Teams** (landing page). Each card opens a team; background builds show progress here.
- **Team hub** (`#team/<id>/<tab>/<version|all>`), with a version dropdown beside the tabs:
  - **Overview**: the six in one row (one column on phones). Click a Pokémon to edit it; **Swap** opens it with the species picker focused.
  - **Strategy**: the overall game plan (edit with a save bar), lead strategy and matchup strategy (`teams/<id>/coaching.json`). Lead-combo and opponent tables appear once replays are linked, flagged below 5 games.
  - **Replays**: one page. **What to work on** (an AI digest of themes across games, with counts) at the top; one box to add links or HTML files; filters by opponent Pokémon, opponent style and result; one card per game with an AI summary and what to work on. A game opens with key moments (click a turn to jump to it in the turn-by-turn log), selections and link details. Each new replay is summarised in the background (`tools/replay-summary.ts`, the chat model), then the digest refreshes. The old PASRS-style tables live on in `#inbox`.
  - **Versions**: versions are milestones you choose. **Save as V2** in the team header (with an optional name) keeps the current six as a fixed point, e.g. before a tournament, and makes it the current team. Edits in between are kept in each version's **edit log** (viewable and restorable) so replays stay tied to the exact sets played. Older versions open read-only, with **Make it the current team**. AI-built teams arrive as versions that aren't current until you choose.
- **Pokémon page** (`#team/<id>/mon/<version>/<slot>`): one editable set card (species picker that fills the most common set, item, ability, nature, moves, stat points with final stats, notes, earlier sets) next to the **Calc** (damage and speed), which follows your unsaved edits. Multi-hit moves show per-hit rolls and an exact KO chance over every roll combination (pick the hit count where it varies); Rage Fist, Last Respects, Stomping Tantrum, Avalanche, Assurance and Payback ask for the battle state they depend on; immunities show 0. For spreads, **Find a spread…** hands the question to Ask Frontier Brain, which runs the spread search. Fields guessed from replays carry a “guess” tag until edited. **☆ Save to My sets** stars a set with a name; the species picker then offers, for each species, its most common set plus your saved ones. **Undo history** lists the slot's recent sets.
- **Saving**: edits are drafts until **Save**. The header pill shows *Unsaved*, *Saving…*, *Saved* or *Save failed*, and leaving a page with unsaved changes asks first.
- **Ask Frontier Brain**: one docked chat per team on every team page (press `/`), described below.
- **News ticker** across the top; **quick links** in four groups plus Showdown.
- Look and feel: the Jade Glass design system, dark and light themes ([docs/DESIGN.md](docs/DESIGN.md)).
- Box icons in the species picker come from Pokémon Showdown's icon sheet, downloaded once to `knowledge/artwork/` (`tools/icons.ts`; source and retrieval date in `icon-index.json`).

## Data: the team pool

All real-usage answers come from **one deduplicated pool of individual teams** (`tools/pool.ts`, `#data` page). Every percentage is computed there once:

| Lane | Upstream | Gives |
|---|---|---|
| official | Limitless official events (RK9 open team sheets) | Day 2 lists and placings, no stat points |
| online | Limitless online tournaments (public API, ≥16 players, custom-rule events skipped) | Full lists, placings, records |
| shared | VGCPastes → PokePaste | Exact spreads |

- **Merging:** a shared paste of the same team (same six, plus the same player, or the same event and placing, shared after the event) is merged into the tournament list. The verified list gains exact spreads, and the paste isn't counted twice. Re-shared identical pastes collapse into one.
- **Not ingested:**
  - mirrors: StatCrusher and MunchStats' Showdown tabs (Smogon), Top Cut Explorer (RK9)
  - composites: Suckerpunch, Pikalytics, LabMaus

  They stay as links and cross-checks.
- **Refresh:** every 12 h while the app runs, with `npm run daily`, or with **Refresh now**. Finished events and pastes are cached for good, so a refresh takes seconds.
- **"Typical" spreads** use the pool when it has at least 8 exact spreads for the species. Otherwise PokéBase's M-C tournament aggregate is used, labelled. Other single sources (`pokebase`, `pokebase-ladder`, `vgcpastes`, `limitless`, `pikalytics`, `smogon`) can still be requested by name, and are never blended.

## Ask Frontier Brain (OpenAI)

Add `OPENAI_API_KEY=…` to `.env` (gitignored). Pick the model from the dropdown in the Ask Frontier Brain panel (chats, default `gpt-6-luna` with low reasoning effort, about 15 s for a quick question) and in the New team dialog (builds, default `gpt-6-astra`); choices are saved in gitignored `settings.json`. If a model isn't available to the key, Frontier Brain falls back to astra and says so under the reply; each reply shows the model and time.

- One conversation per team, docked on every team page. It knows which page you're on (“Looking at: Farigiraf (slot 3)”) and can propose any change: sets, a full team, the strategy, lead and matchup plans.
- It's a tool loop (`tools/chat.ts`, `tools/assist.ts`): every number comes from the local Champions engine or the team pool. Proposals are checked against the Champions rules before you see them; a failed check gets one repair turn without redoing the research.
- Proposals are tiles to **Accept** or **Reject**. A set for the Pokémon you have open loads into its card as a draft; other sets save as a change (with a warning if the slot changed since); a full team becomes a new, inactive version; strategy opens in the strategy editor; leads and matchups go to Strategy (**Accept all plans** for several).
- Requests are background jobs (`tools/ai-jobs.ts`) with Cancel and Retry; you can move between pages while one runs.
- Your questions and the open team's sets go to OpenAI. Replay HTML never does. Transcripts stay in `reports/chats/`.

## Teams, versions and replays

- **+ New team** has two tabs:
  - **Build from a prompt**: the AI researches with usage data and calcs, and the Champions rules check runs locally with up to 3 fix-ups. You get a paste, a strategy, per-set roles, and draft lead and matchup plans.
  - **Paste or PokePaste link**: imports the raw paste from pokepast.es.
  - Nothing is saved until **Create team**.
- **Each Pokémon** is edited on its card: saving records a change in the version (older changes are kept and restorable); restoring an earlier set reuses it rather than copying it.
- **Replays** are added from a team's Replays tab:
  - **Showdown links** (recommended, paste several) or downloaded **HTML files**.
  - Each replay links to the version you played. Tick "exact sets" only when the paste matches; contradicted moves fall back to a roster link with the reason shown.
  - Links work only for replays saved with Showdown's "Upload and share replay".
- Data is plain JSON in the data directory (`APP_DATA`):
  - `teams/<id>/`: team, versions, changes (stored as configurations), coaching
  - `pokemon/<id>/`: revisions, benchmarks
  - `replays/`: originals, parsed, associations
- Write through `tools/workbench-store.ts` or the API; writes are journalled and stale-checked.

## Known limits

- Multi-hit and contextual moves are rejected, not approximated. Speed item and ability multipliers are explicit inputs.
- Spread search covers at most three free damage dimensions. It is not global team optimisation.
- PokéBase publishes no exact team count for tournament stats; the label uses the largest teammate pairing as a lower bound. Pikalytics has no Champions spreads.
- Local mode is loopback-only with no accounts. Don't expose the dev server. Replay HTML is never executed.
- `npm audit` flags Showdown's optional server dependencies. The app uses only the pinned simulator.

## Data sources and attribution

Tournament data is fetched from its publishers at runtime and cached in your data directory; it is not redistributed in this repository. Sources are always labelled and never blended: [Limitless](https://limitlesstcg.com) (official and online events), [VGCPastes](https://twitter.com/VGCPastes) and [PokePaste](https://pokepast.es) (shared team pastes), [PokéBase](https://pokebase.app), [Pikalytics](https://www.pikalytics.com) and Smogon usage stats. Box icons come from [Pokémon Showdown](https://pokemonshowdown.com), downloaded on demand. See `knowledge/sources/INDEX.md` for the full reference library.

## Development

```sh
npm test            # node:test suite (temp workspaces; anonymised replay fixtures)
npm run check       # tsc for tools and web
npm run daily | npm run weekly | npm run vgc -- help
```

- [Repo map](docs/REPO_MAP.md) · [Design system](docs/DESIGN.md)
- [Source quick reference](knowledge/sources/INDEX.md) · [Research routes](knowledge/sources/research-routes.md) · [Tool commands](tools/README.md)
- Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
