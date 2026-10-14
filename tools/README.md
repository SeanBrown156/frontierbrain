# Local VGC tools

Run from this workspace with Node >=22.18. `npm install --omit=optional` installs pinned dependencies and builds the pinned Showdown simulator.

```sh
npm run vgc -- help
npm run vgc -- sources usage
npm run vgc -- refresh
npm run vgc -- dex Rillaboom
npm run vgc -- stats tools/examples/rillaboom.json
npm run vgc -- calc tools/examples/damage.json
npm run vgc -- speed tools/examples/speed.json
npm run vgc -- spread-search tools/examples/spread-search.json
npm run vgc -- team-import path/to/team.txt team-name-v1
npm run vgc -- team-attach team-name-v1 replay-id
npm run daily
npm run weekly
npm run vgc -- review-mark replay-id reports/replay-reviews/report.md
npm run vgc -- regulation-check --dry-run   # what the regulation routine would do (docs/REGULATION_ROUTINE.md)
npm test
npm run check
```

`stats` accepts `{species,nature,statPoints}`. `calc` accepts `{attacker,defender,move,field,moveOptions}` using the calculator's native field/side options (see its types); doubles is default. Native dynamic moves (Weather Ball, Gyro Ball, weight-based moves, HP-based moves and boosted-stat moves) derive power from supplied state; do not supply already-doubled power. Untracked contextual moves such as Rage Fist/Last Respects require explicit `moveOptions.basePower` and recorded justification. Multi-hit and Payback sequencing are rejected.

`speed` accepts two set objects with optional `stage`, `tailwind`, `paralyzed`, `multiplier`, `priority`, plus `trickRoom`. This tool computes the explicitly supplied modifiers; priority-changing abilities and fractional item/ability combinations need Showdown verification.

`calc` doubles handling: spread moves (target `allAdjacent`/`allAdjacentFoes`) take the 0.75x reduction when they hit both targets; `moveOptions.spread:false` means the move hits one target (no reduction), and `true` is the default. `secondDefender` (with optional `secondDefenderSide`; side-wide screens carry over, per-Pokémon flags such as Friend Guard do not) returns the same move on the other opposing Pokémon as `secondTarget`. `secondMove`/`secondAttacker` (with optional `secondAttackerSide` for that attack's Helping Hand/Battery/Power Spot) is two attackers into one target with an exact combined KO chance; held berries, Focus Sash, Weakness Policy, Air Balloon, Multiscale and similar between-the-hits triggers are rejected as unsupported rather than approximated.

`speed-order` takes `{pokemon:[2–4 sets with side, move, stage, tailwind, paralyzed, multiplier, quickClaw], trickRoom?, tailwind?:{mine,foe}, field?}` and returns the turn order (priority bracket, then Quick Claw/Lagging Tail, then Speed; Trick Room reversed) with ties shown as ties and mid-turn changes (Tailwind/Trick Room/Quash/After You/Mega) flagged in `watch`, not simulated. Also `calc_speed_order` in the assistants.

`spread-search` accepts a set, optional nature list, minimum final stat constraints, a total-point limit, and damage benchmarks. Damage benchmark: `{direction:"outgoing"|"incoming",other,move,minimumDamage?,maximumDamage?,field?}`. It returns a minimum-point solution for each nature, applying offensive requirements to minimum rolls and defensive caps to maximum rolls. Searching too many free dimensions is rejected; lock role-irrelevant stats with `fixedPoints` or use `minStats` for simple speed/offense requirements. It optimizes specified benchmarks, not team quality.

`team-import` accepts Showdown text with Champions SP values on its `EVs:` line (0–32 each, <=66 total), no editable IVs, and six legal Pokémon. It saves immutable `teams/<version>/` JSON, text export and final stats; metadata/rationale belongs in that folder. `team-attach` accepts replay IDs only when roster species match; explicit attachment acknowledges that you have checked the exact sets used. Roster groups alone never auto-attach versions.

`refresh` checks official rules and bounded source-page evidence, downloads the newest published exact-format Smogon usage and published moveset distributions for Bo1/Bo3/brackets, and updates the catalogue index. Content-addressed snapshots retain availability/errors and dates without overwriting changed datasets. Moveset percentages retain published denominators and truncated tails (`Other`); full chaos downloads are not necessary for routine research. It does not turn arbitrary site homepages into comparable usage data. Read and browse linked tournament/report pages for strategic analysis. `weekly` creates a statistical evidence report; finish its interpretation with the analysis skill.

`daily` scans local HTML, writes parsed JSON and observable reports, and queues unreviewed games. Coaching completion is a separate `review-mark` action, so interrupted reviews aren't lost. Rename/copy duplicates are ignored. New downloads belong in `replays/originals/`. The source-migration command requires an explicit directory, verifies hashes, journals progress, and removes only verified source files after successful copy.

`npm run daily` / `npm run weekly` refresh data and write local reports; no AI runs in them. Reports stay in the data directory.
# Frontier Brain interfaces

The local UI exposes the same pinned Champions engine via `POST /api/calculate` (`stats`, `damage`, `speed`, `speed-order`, `spread`). It never substitutes another game's mechanics. `benchmark-save` through `/api/action` recomputes results on the server and stores inputs, assumptions, sources and versions against a Pokémon revision.

`POST /api/jobs` with `kind: review` and `scope: {teamId?, versionId?, configurationId?, replayIds: string[]}` freezes a contextual review request. Configuration scopes require exactly associated games; a team-only scope permits a building review without claiming replay evidence. Saved structured findings live in `reports/coaching/`. Other job kinds and daily/weekly scheduling remain available. HTML upload accepts optional confirmed exact association context and a workspace revision; absent context means the inbox.

Use `readStore()`/`mutateStore()` for the split-folder storage. `node tools/migrate-coach.ts` migrates/rechecks old records with a backup and replay checksums. The legacy CLI team importer remains compatible; its old candidate folders are explicitly importable in the UI.
