# Frontier Brain × Emerald design notes

Implemented on `design/emerald`, 9 October 2026. This is an original CSS restyle of the existing toolkit, imagined as an unofficial eighth Battle Frontier facility.

## References and visual approach

Looked up the Frontier Pass, Battle Tower lobby, Battle Factory rental menu, Pokémon summary screens, PC storage and dialogue boxes. The references informed framed records, compact menu groups, selection arrows and a quieter information hierarchy; no game images, tiles, symbols, logos or fonts were added.

- [Frontier Pass screenshot](https://www.smogon.com/forums/threads/gen-iii-battle-frontier-discussion-and-records.3648697/page-58): trainer identity alongside records, individually framed sections.
- [Frontier Pass image inspected](https://gamebanana.com/mods/634904): inset cream panels, strong outer frame, small selection cursor. The image remained outside the repository.
- [Battle Tower lobby and PC storage screenshots](https://www.techtudo.com.br/listas/2020/05/pokemon-emerald-completa-15-anos-veja-curiosidades-sobre-o-jogo-de-rpg.ghtml): orderly compartments and a text-box hierarchy.
- [Battle Factory rental menu](https://note.com/famous_auk630/n/nf5eabff0d464): a compact party strip alongside decisions.
- [Emerald summary screen](https://note.com/hot_ixora5045/n/nd035a9d7ec3f): species identity separated from detailed information.

The background is a subtle original 16px CSS tile grid. Offset border shadows draw stepped corners on the Pass and team records. Double borders frame panels and dialogue. Gold is reserved for the decorative VIII seal, notices and provenance hints; VIII identifies the imagined facility, not an earned achievement.

## Palette tokens

Tokens live on `:root` in `web/style.css`. Dark mode follows `prefers-color-scheme`; its navy night background, blue-green panels, mint controls and warm gold are intentionally authored.

| Token | Day | Night | Purpose |
| --- | --- | --- | --- |
| `--emerald` | `#176448` | `#88d5ab` | Facility green |
| `--navy` | `#183548` | `#0d1d2c` | Frontier navy |
| `--cream` | `#fffbed` | `#ecf0df` | Warm cream |
| `--gold` | `#b28b37` | `#d4b66b` | Restrained accents |
| `--ink` | navy | `#ecf0df` | Main text |
| `--paper` | cream | `#172e38` | Framed panels |
| `--page` | `#e7eddd` | `#0d1d2c` | Page background |
| `--surface` | `#eef3e5` | `#203d43` | Secondary panels |
| `--field` | `#fffef8` | `#112730` | Inputs |
| `--muted` | `#53665d` | `#b2c3b9` | Secondary text |
| `--blue` | `#176448` | `#88d5ab` | Existing link/action token, now green |
| `--red` | `#a43e36` | `#ffa99a` | Errors and losses |
| `--success` | `#27613e` | `#9cd9af` | Success and wins |
| `--line` | `#b4c4ae` | `#46645f` | Dividers |
| `--frame` | `#315647` | `#7eaa92` | Outer frames |
| `--hover` | `#dde9ce` | `#2b4b4b` | Hover surfaces |
| `--tint` | `#f4ebce` | `#3b392b` | Notices and dialogue input |
| `--gold-ink` | `#75561b` | `#e0c47e` | Readable gold text |
| `--inverse` | `#fffbed` | `#10232c` | Text on filled controls |
| `--strong` | `#183548` | `#9bd4b4` | Ticker and strong actions |
| `--focus` | `#176448` | `#e0c47e` | Keyboard outline |

`--shadow`, `--tile` and `--stripe` provide theme-specific shadow, texture and stat-point stripe colors. Legacy hard-coded component surfaces now use semantic tokens, including errors, notices, Markdown blocks, chat and table stripes.

Calculated WCAG text contrast against paper/page/surface/field/tint: the minimum among ink, muted, green links, error, success and gold text is **5.12:1 day / 6.30:1 night**. Primary control contrast is **6.87:1 / 9.36:1**; ticker contrast is **12.35:1 / 9.60:1**. These are token-pair checks, not a claim of a complete accessibility audit. Disabled controls are exempt from the text-contrast requirement.

## Typography and licences

- **Pixelify Sans**, `--display`: short headings, navigation, buttons, badges and facility labels. [SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/pixelifysans/OFL.txt), copyright the Pixelify Sans Project Authors; designed by Stefie Justprince.
- **IBM Plex Sans**, `--font`: prose, forms, moves, source descriptions, Markdown, news articles, stat tables and numeric spread presets.
- **IBM Plex Mono**, `--mono`: code/pastes, stat values, pool counts and calculator result numbers. Both Plex families use [SIL Open Font License 1.1](https://github.com/IBM/plex/blob/master/LICENSE.txt), copyright IBM Corp., reserved font name Plex.

All three load through the existing Google Fonts link with `display=swap`. Fallbacks remain readable when fonts are unavailable. No game font or new bitmap asset is bundled.

## Facilities and page changes

Existing routes, labels, roles and actions remain intact. The facility metaphor is conveyed through the shared record/panel language, not a replacement navigation system.

| Area / facility | Before | After |
| --- | --- | --- |
| Teams / Frontier Pass | One column of neutral team cards | Trainer identity, actual team/replay counts, decorative VIII seal, two facility records across on desktop, one on phones |
| Team Overview / party preparation | Thin neutral roster panels | Emerald-topped set panels, pixel species headings, framed roster; six across on wide desktop, three at intermediate widths, one on phones |
| Strategy / planning room | Neutral notes and plan cards | Cream/day or blue-green/night framed notebook; Plex prose and tables; selected menu arrow; proposed plans retain dashed gold outlines |
| Replays / battle records | Neutral digest and game cards | Framed coaching digest, distinct win/loss strips, readable tags and filters; phone cards stack |
| Versions / record archive | Plain version panels | Framed facility records, current-version tag and readable edit log; phone edit-log rows stack |
| Pokémon / training lab | Neutral set and calculator panels | Emerald set frame, inset calculator frame, crisp stat bars and Plex numbers; controls stack on phones |
| New team / registration desk | Standard dialog | Double frame and cream/day or night panels; both prompt and paste modes retain all controls |
| Ask / attendant dialogue | Plain chat cards | RPG dialogue frames with a static ▼ marker on replies and the onboarding hint; suggestions and reply prose remain Plex |
| Data / research terminal | Neutral pool totals and tables | Framed totals, Plex Mono counts, themed striped tables and team records; loaded tables fit phone widths |
| News / bulletin room | Neutral news dialog | Double frame, compact week menus, restrained gold digest inset; evidence labels and source links preserved |
| References / reference library | Neutral source cards | Themed original source-card grid and menu cursor; descriptions stay Plex |
| Welcome / Frontier entrance | Plain welcome card | Stepped facility frame, emerald top edge, pixel heading and dialogue-style hint; auth code untouched |

## Browser verification

Used the existing throwaway data copy on web **5273**, API **5274**. The watch-based launcher hit `EMFILE`; started the same API without Node watch and Vite separately, with **both ports in both process environments**. No startup code was changed. The in-app browser tool failed during setup, so the available Playwright browser provided verification.

Checked Teams, Overview, Strategy, Replays, Versions, Pokémon set/calculator, Data, References, the replay inbox and standalone News at **1440×1000** and **390×844**, in **light and dark**. Waited for the saved replay digest, existing pool and calculated result rather than treating initial loading content as the completed page. Checked New team in both prompt and paste modes, the News modal and the Ask dock in all four combinations. Screenshots and contact sheets are local in the ignored `output/playwright/` directory because they include private player data.

- No page-level horizontal overflow in the page matrix; no horizontal overflow inside the tested dialogs or dock.
- Loaded Data pool totals, usage tables and recent teams checked on phones; dense Markdown strategy tables retain their existing contained scrolling.
- `/` opens the Ask dock; a clearly labelled local reply fixture verifies the assistant frame, Plex prose and ▼ marker without an AI request. Original browser chat storage was restored.
- Keyboard focus has a visible 3px outline. Escape closes the New team dialog.
- Reduced-motion emulation yields `animation-name: none` on the ticker; CSS also disables pulse, transitions and smooth scrolling.
- `npm run check` passed; `npm test` passed **59/59**.

## Deliberate limits

No earned symbols, streaks or Battle Points were invented. The Pass counts are read directly from existing dashboard data. No new animations, sounds, official game assets or sprite downloads were introduced; the app's existing artwork and box-icon infrastructure is preserved. No manual theme switch was added because that would expand behavior; the OS preference selects the palette. Existing private replay summaries and strategy prose were not rewritten.

Welcome/account selectors are restyled, but hosted sign-in/account flows were not exercised in this local-data run. Reference-site favicons can fail to load; the existing fallback hides them. Browser verification covers presentation and existing read-only workflows, not paid AI generation or saving/importing player data. No tools, shared logic, API calls, storage, routes or auth code were changed. No push or merge was performed.
