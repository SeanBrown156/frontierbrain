---
name: vgc-analysis
description: Research Pokémon VGC doubles mechanics, regulation legality, current usage, tournament results and team reports. Use for metagame analysis and the evidence foundation of builds and replay-driven revisions.
---

# VGC analysis

Operate from the project root. Read `context/player.md`, `knowledge/sources/INDEX.md`, and the applicable `knowledge/regulations/` record. Run `npm run vgc -- refresh` before substantive research/builds. Read the refresh manifest and available snapshots; network failures and missing periods must be visible.

## Research

- Verify the intended game, regulation, Bo1/Bo3 and team-sheet availability. Check official eligibility and changes. Showdown and calculators are implementations, not substitutes for official tournament rules.
- Choose evidence for the requested play environment. Prioritize specialist tournament coverage (including Pikalytics and event sources) for tournament preparation; verify selected format and population. Smogon original monthly usage is specifically Showdown ladder evidence, not Champions in-game usage. Use MunchStats/StatCrusher/Pikalytics for set distributions and speed tiers with checked provenance. Do not count mirrors of one dataset as independent evidence or merge populations into an unlabeled meta percentage.
- Check Limitless, Victory Road, Top Cut Explorer and LabMaus for recent events, standings, teams and event-scoped usage. Read report authors' explanations on Victory Road, Liberty Note, Smogon and linked reports. Follow primary links and identify missing stat spreads.
- Separate representative frequency, event results and strategic judgment. Compare compatible periods only. Changing populations/ratings make apparent usage deltas unreliable. Treat community discussions as hypotheses.

## Output and storage

Write dated reports in `reports/metagame/`: evidence/date/format, current threats and cores, observed changes (or lack of comparable prior data), relevant set/speed benchmarks, tournament findings, implications for the player's teams, and next experiments. Link every material sourced claim. Snapshots retain period, source, retrieval time and sample counts. Save validated mechanics in `knowledge/mechanics/` and official rules in `knowledge/regulations/`; include version/source and distinguish rule facts from interpretation.

Weekly: execute `npm run weekly`, then use browsing to assess newly completed tournaments and reports; the generated statistical report is an evidence starting point, not the finished strategic analysis. Update the source catalogue when a useful destination changes. Keep unresolved bookmark destinations explicit rather than guessed.
