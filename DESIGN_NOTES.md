# Frontier Brain design notes

## Jade Glass (October 2026, branch `jade-glass-ui`)

Chosen from the Round 3 lookbook: Sky Pillar inside a clear emerald shell. It supersedes the Round 2 cream palette below, which is kept as history. The system lives in `web/jade.css`, loaded after `style.css`. Every rule is scoped to `html.jade`, and the legacy tokens are remapped, so older components pick up the theme without edits.

- **Themes.** Dark ("after hours") and light ("morning jade"). The app follows the system until the player picks one with the header toggle; the choice is stored in `localStorage` (`frontierbrain.theme`) and applied before first paint by `index.html`.
- **Tokens.** Background, glass, sunk, text, muted, line, accent (`#1FD08A` dark, `#0B8A55` light), hot red (the LED), gold (stat points and eyebrows).
- **Surfaces.** Frosted glass: a translucent fill, backdrop blur, a faint emerald gradient from the top-left, an inset top highlight and corner screws. Hover is a light sweep across the glass with an emerald edge and a small lift, never a dotted outline.
- **Type.** Saira Condensed (uppercase display and headings), Hanken Grotesk (reading and controls), JetBrains Mono (eyebrows, labels and stat keys), and Doto for dot-matrix numerals (slot numbers, final stats and counts). All are SIL OFL fonts from Google Fonts.
- **Pokémon images.** HOME 3D renders by default (`/api/home`, from Showdown's `sprites/home`, cached in the data directory locally and redirected on the hosted site). Each render falls back to the official illustration, then a placeholder. Held items use Showdown's item sheet (`/api/item-sheet`). The pixel box icons stay in pickers and lists as the Pixel Edge nod.
- **Data drawing.** Type badges are full-width pills coloured by type. Stat bars show the base stat in emerald with the stat points stacked on the end in gold; final stats on the Pokémon page come from the stat tool.
- **Motion.** Cards rise in sequence, bars grow, renders float and the selected tab pulses its LED. Everything stops for `prefers-reduced-motion`.
- **Logo.** An original emerald-cut gem, read as a Battle Frontier symbol, with a circuit "brain" and a red LED node in its table facet (`public/favicon.svg`). No Pokémon artwork is used in the mark.
- **Front door.** `#welcome` is shown once on a first visit and linked from the footer. It uses the player's first team, or an example core before they have a team, on a glass stage that leans toward the pointer.
- **Polish pass (owner feedback, 12 Oct).** Selects draw their own chevron, inset 12px. The flashing red LEDs on selected tabs are gone. Everything sits on a 4px spacing rhythm, with real paragraph and list spacing in prose and replay summaries split into a lead sentence plus short follow-ons. The Ask dock title uses the display font, with its controls on one 40px row.
- **Calc.** One matchup card. Your side picks Current set, a starred My set, or a theoretical custom set (never saved; benchmarks save only from the current set). An attack-direction switch sits between the sides. The opponent side has a species picker (with My sets) plus one set dropdown (sourced spreads and My sets) and a source selector, kept labelled and never blended. Set editors use the same base-plus-stat-points bars, with the gold +SP beside each bar.
- **Pokémon page.** A favourite star sits on the top-left corner of the render. Benchmarks, then a single Notes field, sit full width below both columns; older split notes show merged under headings and save merged on the next edit.
- **Avoid.** Sports-betting cues: odds chips, slanted score bars, loud tickers. The news strip is kept quiet: mono type, no red.

## Round 2 history: Frontier Brain × Emerald

Round 2 on `design/emerald`, 9 October 2026. One light theme, original CSS graphics, IBM Plex for reading and calculations, Pixelify Sans for short display text. The owner's round 2 feedback supersedes the earlier palette and layout.

## Round 2 audit

Captured the existing UI at 1440×1000 and 390×844 **before changing the design**. Local screenshots are in ignored `output/playwright/r2-before-*.png`; they contain private player data. Hosted-only screens use the original auth components in an ignored local preview with browser-only test configuration, without signing in. Empty-team/onboarding screens use the actual TeamsLanding component with an empty presentation fixture. The tournament API process was restarted to load the already-merged implementation.

| ID | Area | Observed before | Resolution |
| --- | --- | --- | --- |
| A01 | Global palette | Muted teal/blue-green framing and navy text/ticker do not match the requested rich Emerald green and trainer red | Fixed: rich green signboard and actions, trainer red accents, cream paper and neutral ink; one light palette. |
| A02 | Global geometry | Competing 10/14/18/20/22/26/28/36px spaces; broad page content and different inset widths | Fixed: 4/8/12/16/24/32/48px spacing tokens; centred 1200px shell, 880px reading panels, 32px desktop and 16px phone gutters. |
| A03 | Buttons | Default 38px, chips 30px, Mega selectors 28px, star action 20px, history action 40px; icon close 32px | Fixed: 40px default/primary/danger and square icon controls; 32px compact/text actions; IBM Plex labels. Multiline picker/suggestion rows deliberately grow together. |
| A04 | Teams | Heading/action anchored opposite sides; trainer identity far left and counters far right; hidden title cursor occupies space; card title/tag/footer baselines differ | Fixed: centred introduction and record, two equal desktop cards / one phone column, shared title/tag, sprite-strip and footer rows; cursor removed from flow. |
| A05 | Overview | Phone title, milestone and Export scatter across rows; tabs have uneven wrapping; six desktop cards have cramped move text and varied inner alignment | Fixed: centred title/actions and tabs; three equal desktop cards with aligned headers/moves; two equal phone tab columns and one card column. |
| A06 | Strategy | Edit/new actions and plan footers do not share spacing or alignment; prose spans a very wide column; phone header actions become separate islands | Fixed: centred 880px prose; consistent header/action gaps, paired footers and phone action rows. |
| A07 | Replays | Add replays stretches to 51px next to the textarea; upload/import controls and filters do not share a baseline; short game cards leave irregular open space | Fixed: Add replays 40px; upload action on the same desktop baseline; balanced phone action grid, centred filters and equal card columns. |
| A08 | Versions/delete | Edit-log rows and View/Restore pairs use mixed dimensions; destructive section is visually disconnected and its phone action hugs the left edge | Fixed: edit-log actions 32px and common gaps; centred reading width; red framed delete area with centred phone action. |
| A09 | Pokémon | Species/set identity, six-member navigation, labels and stat rows use competing spacing; 20/28/30/40px actions; benchmark input/button need one baseline | Fixed: balanced identity/navigation, consistent field labels and stat columns, 32px stat/set actions and 40px benchmark controls; single phone column. |
| A10 | New team tabs | Tabs start at left and break asymmetrically on phones; close button is shorter than normal controls; prompt action/model heights differ | Fixed: centred modal heading, 40px square close, three equal tabs (40px desktop / 56px phone for wrapped labels), baseline-aligned prompt/model controls. |
| A11 | Paste import | Desktop Fetch paste stretches to 79px beside the labelled field; review fields and Create team lack balanced action spacing | Fixed: explicit paste-source alignment keeps Fetch paste 40px; phone fetch centred below the field; review grid and create actions share the spacing system. |
| A12 | Tournament picker/picked draft | Placement, long player names, sprite groups and optional badges shift between rows; phone metadata truncates; selected-team heading/action compete; spread explanations are uneven | Fixed: stable placement/name/sprite/badge columns; wrapped phone metadata and visible sprites; centred picked-team banner and aligned spread evidence rows. Picking a team verified without creating it. |
| A13 | Ask | Heading/actions wrap inconsistently; model picker is shorter than buttons; Send stretches to textarea height; suggestion buttons have inconsistent widths | Fixed: centred toolbar with 40px controls, 64px textarea and 40px square Send; equal-width readable suggestions; phone launcher spans the shell and footer clears it. |
| A14 | Data/News/References/inbox | Pool totals have variable text heights; table and team-record spacing varies; News has nested frames and unbalanced week tabs; auxiliary headers start too close to the back link | Fixed: equal totals grid, consistent dense table spacing, centred auxiliary headers, three equal News tabs and one modal frame. All pages fit both viewport widths. |
| A15 | Welcome/sign-in | Welcome contents left-aligned inside a centred card; email actions mix tiny text links and buttons; inconsistent label/field and prose spacing | Fixed: centred 480px welcome card, balanced dialogue panel and action sequence; 40px email actions with consistent labels and fields. |
| A16 | Account | Popover follows its trigger rather than the shell edge; signed-in email crowds/wraps the phone brand; guest email form has irregular actions and vertical spacing | Fixed: popover aligned with shell edge; separate header account/save positions, centred phone trigger and full-shell popover; consistent email/action layout. |
| A17 | Samples/onboarding/empty state | Wide shallow profile strip, sample prose/button pulled to opposite ends, and a separate empty panel compete instead of forming a centred welcome sequence | Fixed: centred 880px welcome sequence; profile heading spans the grid, fields align and Save centres; samples and empty state have balanced prose/action spacing. |

## Reference research

Reference images are for palette/layout research only; none are included in the app.

- [Emerald box art](https://pokedexgenerator.com/walkthroughs/pokemon-emerald): bright green rays, deeper green shades, black/white Emerald lettering, small red Nintendo mark. Inspected a temporary image locally.
- [Brendan's Emerald front sprite](https://github.com/pret/pokeemerald/blob/master/graphics/trainers/front_pics/brendan.png) and [May's Emerald front sprite](https://github.com/pret/pokeemerald/blob/master/graphics/trainers/front_pics/may.png): examined separately from later-generation or fan-made designs. Exact colors measured from the temporary PNG references include red `#c54141`, red highlight `#ff625a`, green `#629c5a`, green highlight `#8bde73`, black `#000000`, white `#ffffff`. Both sprites contain these red and green pairs. UI greens and text shades are contrast-adjusted adaptations, rather than claimed as exact box-art samples.
- [Frontier Pass](https://www.smogon.com/forums/threads/gen-iii-battle-frontier-discussion-and-records.3648697/page-58), [Battle Tower and PC screenshots](https://www.techtudo.com.br/listas/2020/05/pokemon-emerald-completa-15-anos-veja-curiosidades-sobre-o-jogo-de-rpg.ghtml), and [Battle Factory menus](https://note.com/famous_auk630/n/nf5eabff0d464): framed records, compact menu groups and selection arrows.

## Typography and licences

Pixelify Sans handles short headings and navigation. IBM Plex Sans handles prose, fields, button labels, source descriptions, numerical spread presets and tables. IBM Plex Mono handles pastes/code and key stat/calculator numbers. Loaded through the existing Google Fonts link with `display=swap`.

[Pixelify Sans licence](https://github.com/google/fonts/blob/main/ofl/pixelifysans/OFL.txt): SIL Open Font License 1.1, Pixelify Sans Project Authors. [IBM Plex licence](https://github.com/IBM/plex/blob/master/LICENSE.txt): SIL Open Font License 1.1, IBM Corp., reserved name Plex.

## Facility conventions

| App area | Emerald reference translated into the interface |
| --- | --- |
| Teams | Frontier Pass: centred trainer record, six-member facility cards and a small original VIII seal |
| Overview / Versions | Framed roster and immutable configuration records; the seal never implies an earned achievement |
| Strategy / Replays | Preparation room: readable plans, move-by-move evidence and compact menu controls |
| Pokémon / Data | Summary and PC conventions: clear stat columns, six-member navigation and organized reference panels |
| New team / News | Facility menu: equal tabs, selection arrows and framed draft/news content |
| Ask / welcome | RPG dialogue convention: original CSS double frame and a small continue marker |

Dense prose and evidence remain left-aligned inside centred panels for reading. Official graphics, fabricated achievements, decorative stat numbers and behavior changes are outside this design’s scope.

## Scope

Preserve routes, behavior, accessible names, labels, original data and storage. CSS is the primary implementation surface; component edits may add styling classes only. No game assets, earned symbols, streaks or Battle Points are added. VIII identifies the imagined eighth facility, not an achievement. No auth implementation, tools, shared logic, API or storage changes. No publication, push or merge.

## Final palette and components

| Role | Hex | Origin / application |
| --- | --- | --- |
| Deep emerald | `#006b35` | Adaptation of the box art’s rich green rays; masthead, primary buttons and active menus |
| Bright emerald | `#00a64c` | Adaptation of the box art’s bright green; card and welcome frame accents |
| Emerald shade | `#004c26` | Deeper box-art-inspired green for ticker and hover surfaces |
| Trainer greens | `#629c5a`, `#8bde73` | Exact colors measured in both Emerald trainer sprites; decorative trim/highlights |
| Trainer reds | `#c54141`, `#ff625a` | Exact sprite colors; accent, ticker label and filled danger state; highlight retained as a palette token |
| Red text | `#b53333` | Contrast-adjusted trainer red for small error/danger text |
| Paper / field | `#fffdf3`, `#ffffff` | Cream adaptation of the game’s menu paper; sprite white for fields |
| Ink / secondary text | `#1c211e`, `#53604c` | Neutral near-black adaptation of sprite black; readable secondary text |
| Page / secondary panel | `#eff4e7`, `#e6f0db` | Pale green paper adaptations, not sampled artwork colors |
| Frame | `#47633f` | Contrast-adjusted green for panel boundaries |
| Gold / gold text | `#b68b2e`, `#765715` | Small logo-inspired seal accent and readable caption, used sparingly |

The shared CSS controls establish the hierarchy: default/primary/danger 40px, compact/chip/text 32px, icon 40px square. Inputs are 40px, stat inputs 32px. Wrapped phone modal tabs and two-line week tabs share a deliberate 56px height. Tournament rows and multiline chat suggestions use automatic height with a shared minimum. These are content rows, not stretched field actions. Reading, card, modal and onboarding frames share the same gutters and spacing tokens. The only TSX edit adds a styling class to the paste-source row.

## Final verification

Every A01–A17 resolution above was checked against the after screenshots at **1440×1000 and 390×844**. The screenshot pairs cover Teams; Overview, Strategy, Replays, Versions; Pokémon; Data; References; replay analysis inbox; all three New team tabs; tournament selection and the draft’s final action; News; Ask; welcome; email sign-in; guest/account menus; guest email form; empty-state onboarding and samples. Files are ignored local artifacts under `output/playwright/r2-{before,after}-*.png`; review contact sheets are `r2-after-{pages,dialogs}-{desktop,phone}.jpg`.

- No horizontal document overflow at either width on the nine main routes or hosted-screen previews. Modal and picker contents scroll internally when necessary.
- Measured actual controls: Add replays 40px, Fetch paste 40px, set actions 32px, close buttons 40px square. Labels are centred and adjacent controls share their specified baselines.
- Computed-token WCAG text contrast: white/deep emerald **6.66:1**, white/trainer red **4.99:1**, ink/paper **16.02:1**, secondary text/paper **6.55:1**, green/secondary panel **5.66:1**, red text/pale red **5.26:1**, red text/hover **4.83:1**, gold text/paper **6.55:1**. Frame/white **6.72:1**. Enabled rendered text on the nine audited main routes also passed a computed foreground/background scan; decorative graphics and disabled controls are excluded. This is a contrast check, not a claim of a complete accessibility certification.
- `npm run check`: passed, both TypeScript projects.
- `npm test`: **64 passed, 0 failed**. Initial sandbox run could not bind the API test server (`EPERM`); the permitted localhost run passed.
- Browser checks used Playwright because the in-app browser runtime could not initialize its sandbox policy. Hosted screens used original components with preview-only browser configuration; no credentials or actual authentication calls. No create/import/delete/save/AI action was submitted during the design audit.
- Changes limited to `web/style.css`, one styling class in `web/team/NewTeam.tsx`, the browser theme-color metadata and these notes. Private screenshots, preview fixtures, reference downloads, dependencies and player data are excluded from commits.
