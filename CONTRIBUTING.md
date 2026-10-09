# Contributing

Thanks for helping. A few ground rules keep Frontier Brain trustworthy:

- **Numbers come from tools.** Damage, speed, stats and usage figures must come from the Champions engine (`tools/mechanics.ts`) or the team pool, never from estimates or model recall.
- **Never blend sources.** Each usage number is labelled with its single source, period and sample size.
- **No personal data or secrets in commits.** Keep your data directory (`APP_DATA`) outside the repo or rely on the gitignored paths. Test fixtures must be anonymised.
- **No redistributed scrapes or game assets.** Tournament data is fetched at runtime; artwork and icons are downloaded on demand with attribution.
- Run `npm test` and `npm run check` before opening a pull request.
