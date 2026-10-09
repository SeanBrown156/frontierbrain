---
name: vgc-teambuilding
description: Build and refine legal Pokémon VGC doubles sets, Champions stat spreads, cores and six-Pokémon teams using current metagame evidence and reproducible calculations.
---

# VGC teambuilding

Read `context/player.md`, `knowledge/mechanics/champions.md`, and the analysis skill for research steps. Refresh evidence and verify the current rules. Work from the user's requested Pokémon/core, matchup targets and play environment; resolve routine choices yourself. Ask only about constraints that materially change the team.

## Build

Use `npm run vgc -- dex <species>` and the numerical commands in `tools/README.md`. Champions uses stat points, not mainline EVs; the CLI only supports the configured Champions formats. Exact damage requires full assumed sets and field conditions. Save request JSON and result together. Explicitly say whether a threshold is guaranteed, a roll, or contingent on chip/boosts/items. Unsupported contexts cannot support exact claims.

Choose roles, partner interactions, offensive/defensive benchmarks, speed control, leads and bring-four plans together. Use spread search to identify minimum points for constraints; prioritize user objectives and show sacrificed thresholds. Speed ties are not outspeeds; priority and Trick Room are separate from raw Speed. Assess alternative opposing spreads rather than only convenient targets.

Produce set alternatives or a six-Pokémon candidate, with rationale, matchup plans, information profile (closed/open sheets; Bo1/Bo3), known weaknesses and test objectives. A legal team is not automatically a good team. In PokéCoach use the storage/API actions to save independent Pokémon revisions and explicitly selected team configurations; keep benchmark inputs/results/version provenance against the relevant revision. The legacy Champions `team-import` command also validates and saves an immutable CLI candidate, export and final stat sheet, which can be explicitly imported into the UI. Never edit frozen records directly or silently adopt a lab candidate. The Showdown export's `EVs:` label carries Champions stat points solely for import compatibility.

## Revision

Read relevant replay reports and exact matching team versions. Do not infer all sets from a six-species roster. Save revisions under new version IDs with changes, supporting evidence and test criteria; leave the active selection unchanged unless the user chooses the candidate. Keep ladder consistency and tournament adaptation distinguishable. Use a goal-driven balance of proven cores and experiments.
