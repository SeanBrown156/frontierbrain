# Frontier Brain

**The open-source brain for Pokémon VGC.** Build teams, run exact damage and speed calcs, and learn from your replays, with the AI you already use.

Built for Pokémon Champions doubles (Regulation M-C). Free and open source. AI is bring-your-own: use your own OpenAI or Anthropic key, or connect your own Claude, ChatGPT or coding agent over MCP. Nobody pays for anyone else's AI.

**Use it:** https://frontierbrain.vercel.app (sign in with Google, or continue as a guest). Or run it yourself, below.

> Not affiliated with or endorsed by Nintendo, The Pokémon Company, Game Freak or Creatures. Pokémon and Pokémon character names are trademarks of Nintendo. Battle mechanics come from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) and [@smogon/calc](https://github.com/smogon/damage-calc) (MIT).

## What it does

- **Team builder.** Start from real tournament teams, paste a Showdown or PokePaste team, or ask the AI to build one. Every team has its own strategy: overall plan, leads and matchup plans.
- **Calcs in the Pokémon page.** Damage and speed on Champions mechanics, next to the set you're editing. Calc against the sets that win events, and save benchmarks. Doubles-aware: spread moves on one or both targets, and the four-way speed order.
- **Bench.** A scratchboard per team for Pokémon you might bring in. Tune them, write how they'd replace someone, then promote.
- **Replay analysis.** Paste Showdown replays: they link to the team that played them, show who you beat and who beats you, and get AI summaries judged from what was known at each turn.
- **Inbox.** One place for what's waiting on you: suggestions from your assistant, calcs, unlinked replays and rule notices. Accept or dismiss in place.
- **One metagame data source.** Tournament teams and usage from Limitless, PokéBase, VGCPastes, Pikalytics and Smogon, pooled and deduplicated, refreshed on a schedule, with every number labelled by source and sample.
- **Your AI, connected.** Ask Frontier Brain is the in-app chat. Over MCP, Claude, ChatGPT, Claude Code, Codex, Cursor or VS Code can read your teams, run exact calcs and propose changes you accept in the app.

## Run it locally

Requires Node 22.18 or newer.

```sh
git clone https://github.com/SeanBrown156/frontierbrain && cd frontierbrain
npm install                 # also builds the pinned Showdown simulator
cp .env.example .env        # optional: AI key, data directory
cp config.example.json "${APP_DATA:-.}/config.json"   # optional: your Showdown name
npm run dev                 # http://127.0.0.1:5173
```

Your data (teams, sets, replays, reports) lives in the **data directory**: `APP_DATA` from `.env`, or the repository folder when unset (gitignored either way). Use a separate folder such as `APP_DATA=../my-vgc-data` to keep it out of the checkout. The tournament pool downloads on first start.

Hosted mode (Google sign-in, guest sessions, per-user data) is documented in [docs/hosting.md](docs/hosting.md).

## Bring your own AI

**API key.** Add `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` to `.env`, or paste a key in Settings on the hosted site, where it stays in your browser. Every number the chat gives comes from the local Champions engine or the team pool; its suggestions are checked against the rules and wait for your Accept.

**MCP.** Frontier Brain is a remote MCP server: `https://frontierbrain.vercel.app/api/mcp` hosted, `http://127.0.0.1:5173/api/mcp` locally.

```sh
claude mcp add --transport http frontier-brain <url>   # Claude Code
codex mcp add frontier-brain --url <url>               # Codex CLI
```

In Claude or ChatGPT add it as a custom connector; Settings shows the steps for each client. Your assistant can read teams and replays, run calcs, look up usage and sets, suggest set changes and plans, save benchmarks and add replays. Deleting things and publishing to PokePaste need your explicit say-so.

## Data

Real-usage answers come from one deduplicated pool of individual teams (`tools/pool.ts`). Sources are never blended into one unlabeled number.

| Lane | Source | Gives |
|---|---|---|
| official | Limitless official events (open team sheets) | Day 2 lists and placings, no stat points |
| online | Limitless online tournaments | Full lists, placings, records |
| shared | VGCPastes → PokePaste | Exact spreads |

Mirrors and composite sites stay as links and cross-checks. Tournament data is fetched at runtime and cached, not redistributed here. See `knowledge/sources/INDEX.md` for the reference library.

## Your data and privacy

On the hosted site each account's teams and replays are private to that account (Supabase row-level security). Guests are anonymous accounts that can be upgraded. Replay HTML is never executed and never sent to an AI provider. Backup, restore and account deletion are in Settings.

## Known limits

- Spread search covers at most three free damage dimensions. It is not global team optimisation.
- PokéBase publishes no exact team count for tournament stats; Pikalytics has no Champions spreads.
- Local mode is loopback-only with no accounts. Don't expose the dev server.
- Replay video analysis isn't built yet.

## Development

```sh
npm test            # node:test suite (temp workspaces; anonymised replay fixtures)
npm run check       # tsc for tools and web
npm run build       # production web build
npm run vgc -- help # CLI: calcs, data, refresh
```

[Repo map](docs/REPO_MAP.md) · [Design system](docs/DESIGN.md) · [Hosting](docs/hosting.md) · [Tool commands](tools/README.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
