# Frontier Brain design notes

## Design system (October 2026)

One set of components for every control, dialog and panel. Build new screens from these alone; a page rule may place a component (grid, order, width) but not restyle it.

- **Where.** `web/jade.css` in four parts: tokens (`:root`), `@layer base` (element defaults), `@layer components`, then page rules, unlayered. Page rules beat the layers without `!important`. React wrappers are in `web/ui.tsx`. **`#design-system`** (footer › Design system, `web/DesignSystem.tsx`) shows every component in dark and light side by side.
- **Themes.** Light tokens on `:root`, dark from the system or `data-theme="dark"`. Any element can carry `data-theme` to show the other theme inside it. Tokens built from other tokens (depth) are declared again per theme.
- **Phones.** `npm run check:phone` (with the app running) opens every page at 360, 390 and 430px in both themes and fails on sideways scroll. Without Playwright installed it runs itself through `npx` and downloads Chromium once.

### Tokens

| Group | Tokens |
|---|---|
| Colour | `--bg` `--glass` `--glass-2` `--sunk` `--field` · `--tx` `--mu` · `--ln` `--ln-2` · `--ac` `--ac-2` `--on` · `--gd` (gold) `--hot` (red) · `--hover` `--tint` `--danger-tint` `--backdrop` · `--phos*` (number glow) |
| Type | `--fd` Saira Condensed (titles), `--fb` Hanken Grotesk (reading, controls), `--fnum` IBM Plex Mono (numbers) · `--t-eyebrow` 10.5 `--t-xs` 11 `--t-sm` 12 `--t-md` 13 (controls) `--t-base` 15 `--t-lg` 18 `--t-xl` 24 `--t-2xl` 44 |
| Spacing | `--s05` 2 · `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s6` 24 · `--s8` 32 · `--s12` 48 |
| Shape | `--r-xs` 6 · `--rs` 10 (controls) · `--r` 16 (cards) · `--r-lg` 22 (dialogs) · `--r-pill` |
| Depth | `--e-inset` (controls) · `--e-card` · `--e-pop` (toasts, menus) · `--e-dialog` |
| Size | `--control-height` 40 (44 on phones) · `--compact-height` 32 · `--touch` 44 · `--gutter` 32 (16 below 760px) · `--edge` · `--header-offset` |

### Components

| Component | Class | React |
|---|---|---|
| Button | `button` / `.button` (secondary), `.primary`, `.danger` (`.solid` fills it), `.text-button` (quiet; `.danger` makes it a red link), `.ghost` (no fill until hovered: header, icon toggles), `.tile` (a whole clickable card; `.on` / `aria-selected` marks the chosen one), `.plain` (text that is a button), `.google` (primary with the Google G; full width on phones). Sizes: `.compact` 32px, regular 40px (44 on phones), `.large` 48px, `.hero` 68px (60 on phones) | `Button` (`variant`, `size`, `solid`), `LinkButton` (a link that looks like one), `GoogleButton` |
| Icon button | `.icon` (square; `.icon.compact` is 32px), `.icon.ghost`, `.icon.star` (save to My sets: gold and filled when `.on` / `aria-pressed`; 44px touch area on phones) | `IconButton` (`variant`: secondary, ghost, star; `size`) |
| Toolbar | `.button-row` | |
| Field | `label` > control; `label.radio` (checkbox beside its text); `label.switch` (checkbox drawn as a sliding switch); `fieldset` + `legend` | `Field`, `Checkbox`, `Switch` |
| Input, select, textarea | element styles; selects draw their own chevron; `.compact` is 32px; `input.num` centres tabular numbers (stat points, boosts) | |
| Panel / Card | `.panel` (a page section, `.panel-heading` on top), `.card` (inside a panel) | `Panel`, `Card` |
| Dialog | `dialog.modal` > `header` (title, X) · body · `.modal-footer` | `Modal` (`footer` prop), `ModalFooter` |
| Tabs / Segmented | `.tabs`, `.segmented` (one sunk track; the chosen option lifts out); `.block` shares the row equally; a tab may carry a second line; `.tabs.nav` is the large uppercase page navigation (team hub), items may be links | `Tabs` (`block`, options with `sub`), `TabLinks` (`nav`), `Segmented` (`block`) |
| Toggle / Chip | `.toggle` (control height), `.toggle.mega` (the Mega switch: dashed pill off, rainbow pill on; 44px touch area on phones), `.chip` (`.small`), `.chip-row`, `.choose` (a checkbox chip), `.chip-remove` (the × in a chip) | `Toggle` (`variant="mega"`), `Chip`, `ChipLabel`, `ChoiceChip` |
| Switch | `.mode-switch` | `ModeSwitch` |
| Tag, Badge with count | `.tag` (`.ok`, `.warn`), `.count-badge` | `Tag`, `CountBadge` |
| Notice, Empty, Toast | `.notice` (a paragraph, or an aside callout with a heading and actions), `.empty`, `.toast` (`.error`) | `Notice` (`as`), `Empty`, `Toast` |
| Text roles | `.eyebrow`, `.muted`, `.footnote`, `.error` | |

`Button` and `IconButton` keep the native button type (submit inside a form), like a plain `<button>`.

### States

Every control defines these in `@layer components`; `#design-system` shows each one side by side. In the specimens, `data-state="hover|focus|active"` forces the state without interaction (the component selectors match it alongside the real pseudo-class).

| State | How it shows |
|---|---|
| Default | the component's rest look |
| Hover | emerald edge and a faint fill; buttons lift 1px; ghost and quiet controls gain colour only; the star and Mega switch turn gold |
| Focus | a 2px emerald ring outside the control (`:focus-visible`); fields get an emerald border and a soft emerald halo |
| Active | pressed down 1px |
| Disabled | 55% opacity, not-allowed cursor, no hover; a link button uses `aria-disabled` |
| Selected | `.on`, `.selected`, `aria-pressed` or `aria-selected`: toggles and chips fill with emerald, tabs lift out as glass, tiles get an emerald edge and wash, the star fills gold, the Mega switch shows the rainbow pill, ghost controls stay filled while their menu is open (`aria-expanded`) |

### Rules

- **Dialogs.** An X top-right is the only close. The footer holds only the action(s), primary last and on the right. Phones (≤720px): the dialog fills the screen less a 16px margin, and the footer stacks full width with the primary first.
- **Full-width buttons** only when stacked: toolbars and dialog footers on phones, or a tile's single action.
- **Sticky** things sit at `top: calc(var(--header-offset) + var(--s3))`, under the header.
- **Art.** `.art` 95px, `.art.small` 48px (HOME renders, Showdown sprites by setting). Box icons 40×30, item icons 24×24, in pickers and lists only.
- **Phones (≤620px).** One column. Controls are 44px; chips, quiet buttons, segments, the save star and the Mega switch get a 44px touch area. Open pickers become full-screen sheets.
- **Copy.** Labels and short sentences. No hint paragraphs explaining how to use a control.
- **Page rules** may place and size a control (grid, order, width, height, padding for density) but not restyle it (colour, background, border, shadow, radius, type). `landing.css` keeps only the welcome page's layout and marketing art; its controls are Buttons, LinkButtons, tiles and a Switch.

### Spacing

| Role | Value |
|---|---|
| Page section (`.panel`, `--pad-panel`) | 24px, 16px on phones |
| Card inside a section (`--pad-card`) | 16px, 12px on phones |
| Tile inside a card (`--pad-tile`) | 12px |
| Dialog (`--pad-dialog`) | 24px, 16px at ≤720px |
| Panel or dialog header | 16px below, then a hairline, then 16px |
| Between sections (`--gap-section`) | 24px |
| Stacked blocks (`--gap-stack`), label to next field | 16px |
| Form columns and rows (`--gap-form`) | 12–16px |
| Toolbar and inline items (`--gap-inline`) | 8px; tight pairs (`--gap-tight`) 4px |
| Control inset (`--pad-control`, `--pad-field`) | 16px buttons, 12px fields |

- Every padding, margin and gap uses the scale. Exceptions: 1px hairlines, clearance for an icon inside a field (for example 40px beside an item sprite), room under the page for the floating Ask button, and the welcome page's staged artwork offsets.
- **Nesting.** A box inside a box gets its own padding and no outer margin; the parent supplies the gap (grid or flex `gap`, or the 24px between stacked sections).
- Breakpoints: 1100px (one column), 760px, 720px (dialogs), 620px (phones). Check phones at 360, 390 and 430px.

## Jade Glass (October 2026, branch `jade-glass-ui`)

Chosen from the Round 3 lookbook: Sky Pillar inside a clear emerald shell. It supersedes the Round 2 cream palette (see `docs/history/emerald/`), which is kept as history. The system lives in one stylesheet, `web/jade.css` (structure under Design system above).

- **Themes.** Dark ("after hours") and light ("morning jade"). The app follows the system until the player picks one with the header toggle; the choice is stored in `localStorage` (`frontierbrain.theme`) and applied before first paint by `index.html`.
- **Tokens.** Background, glass, sunk, text, muted, line, accent (`#1FD08A` dark, `#0B8A55` light), hot red (the LED), gold (stat points and eyebrows).
- **Surfaces.** Frosted glass: a translucent fill, backdrop blur, a faint emerald gradient from the top-left, an inset top highlight and corner screws. Hover is a band of light sweeping down the glass (the same direction as a screen switching on) with an emerald edge and a small lift, never a dotted outline.
- **Type.** Saira Condensed (uppercase display and headings), Hanken Grotesk (reading and controls) and IBM Plex Mono (every number, plus the rare terminal moments: the boot and the calc readout). All are SIL OFL fonts from Google Fonts.
- **Pokémon images.** HOME 3D renders by default (`/api/home`, from Showdown's `sprites/home`, cached in the data directory locally and redirected on the hosted site). Each render falls back to the official illustration, then a placeholder. Held items use Showdown's item sheet (`/api/item-sheet`). The pixel box icons stay in pickers and lists as the Pixel Edge nod.
- **Data drawing.** Type badges are full-width pills coloured by type. Stat bars show the base stat in emerald with the stat points stacked on the end in gold; final stats on the Pokémon page come from the stat tool.
- **Motion.** Cards rise in sequence, bars grow, renders float and the selected tab pulses its LED. Everything stops for `prefers-reduced-motion`.
- **Logo.** An original faceted emerald brain mark (`public/brand/icon-64.png`, with 192 and 512 px copies for the apple-touch icon, MCP connector and favicon). No Pokémon artwork is used in the mark.
- **Front door.** `#welcome` is shown once on a first visit and linked from the footer. It uses the player's first team, or an example core before they have a team, on a glass stage that leans toward the pointer.
- **Polish pass (owner feedback, 12 Oct).** Selects draw their own chevron, inset 12px. The flashing red LEDs on selected tabs are gone. Everything sits on a 4px spacing rhythm, with real paragraph and list spacing in prose and replay summaries split into a lead sentence plus short follow-ons. The Ask dock title uses the display font, with its controls on one 40px row.
- **Calc.** One matchup card. Your side picks Current set, a starred My set, or a theoretical custom set (never saved; benchmarks save only from the current set). An attack-direction switch sits between the sides. The opponent side has a species picker (with My sets) plus one set dropdown (sourced spreads and My sets) and a source selector, kept labelled and never blended. Set editors use the same base-plus-stat-points bars, with the gold +SP beside each bar.
- **Pokémon page.** A favourite star sits on the top-left corner of the render (inside its bottom-right corner on phones). Benchmarks, then a single Notes field, sit full width below both columns; older split notes show merged under headings and save merged on the next edit.
- **Calc, round 3.** The attacker's card sits on top and the defender's below; the swap reorders them (animated) and the arrow follows. Side effects belong to a Pokémon's side and follow it when you swap. The attacker's card shows its move and attack boosts (Helping Hand, Battery, Power Spot, Steely Spirit, crit). The defender's card shows its protection (Reflect, Light Screen, Aurora Veil, Friend Guard, Protect). The Field box between them holds weather, terrain, Gravity, the Rooms, the Ruin abilities and Trick Room. A Mega Stone holder battles as its Mega (the MEGA badge by the name is the toggle, on by default; the calc uses the Mega species and ability). Each card's render sits above its role and name. Results: an HP bar that drains to the damage range (min–max hatched, colour by HP left, 25%/50% marks), a verdict pill and the 16 rolls (KO rolls red); speed is a race where the leader reaches the line and the other stops where its Speed takes it (reversed under Trick Room). Save as benchmark lives in the result box. Calcs run by Ask Frontier Brain on a Pokémon page load into the panel with their exact inputs ("Loaded from Ask Frontier Brain").
- **Mega images.** HOME renders exist for the classic Megas (e.g. Mawile-Mega, Swampert-Mega); the cards, set card and calc show them. New Champions Megas without a render fall back to the base form.
- **Pokémon Strategy.** Markdown, rendered as a guide with an Edit/Done toggle.
- **Later rounds (12 Oct).**
  - **Icons and type:** Lucide line icons replace the pixel icons. Saira Condensed for titles, Hanken Grotesk for reading (numbers moved to IBM Plex Mono in Jade × Phosphor).
  - **Header:** the news and nav run full width as one bar, and the nav stays full width when you scroll (the floating pill was retired).
  - **Ask Frontier Brain** is a floating overlay panel.
  - **Brain backdrop:** a giant wireframe brain sits behind every page (`web/brain/wire-brain.js`, Constellation mode, calm settings), with glass panels about 85% opaque over it. The header and favicon use the flat emerald brain icon (`public/brand/icon-64.png`).
  - **Megas** show their render (base-form HOME render when there's no Mega render), with the Mega symbol (`public/brand/mega.svg`) in a rainbow orb and a pill beside the name.
  - **Strategy tab:** a short strategy paragraph, then the team; clicking a Pokémon shows its notes.
  - **Plans:** lead plans have a title, a role (Core/Situational/Niche/Avoid) and Front/Back rows. Matchup plans have a title, a team style (one list shared with replay summaries), examples, threat and Bring.
  - **Format** is chosen when a team is created and changed from the Manage tab.
  - **Replays:** a Debrief (What's working / What to work on) and a "Who gives you trouble" grid.
  - **Pickers:** items and moves get searchable pickers with sprites and types.
  - **Speed** uses the calculator's `getFinalSpeed` (weather and terrain abilities, Choice Scarf, Iron Ball, Tailwind, paralysis), with weather and terrain on the Speed tab.
  - **Export** can create a PokePaste on request.
- **Avoid.** Sports-betting cues: odds chips, slanted score bars, loud tickers. The news strip is kept quiet: mono type, no red.

## Jade × Phosphor (12 Oct 2026, the current design)

Jade decides the layout; Phosphor adds motion only at real moments (the app starting, a page opening, a calc landing, a name you point at). The `design/phosphor` branch is retired; its ideas live here.

- **Numbers in phosphor.** Every number (stats, stat points, slot numbers, records, pool counts and shares, calc results) is IBM Plex Mono, glowing phosphor green in the dark theme and plain emerald in the light one. Titles keep Saira with a faint bloom.
- **Boot.** Once per browser session: "loading frontier-brain.exe" types out in Saira over the wireframe brain as it powers up, with real status lines (link, teams, replays, AI) in Plex Mono, then the app switches on from a bright line. Any key or click skips it.
- **Sweeps.** A band of light runs down the screen when you arrive on a page, and down a card's glass on hover. One direction everywhere.
- **Decode.** Page titles resolve from noise when you arrive on a different page (not when you switch a team's tabs); team and Pokémon names, menu items and panel headings resolve when you point at them. Short titles (the Teams page) flicker first and resolve more slowly. The FRONTIER BRAIN wordmark flickers or resolves every 20–40 s. Text keeps its size and stays on one line while it resolves.
- **Calc readout.** Each result runs a mono compute line ("CALC ▸ attacker · move → target") whose bar draws across, the numbers roll before settling, and the result box alone carries subtle scanlines.
- **Pokémon art setting.** Settings › Pokémon art: HOME renders (default), Black/White animated sprites or XY animated sprites from Showdown, each previewed with Alakazam.
- **Team hub.** The header is the team name and four tabs (Pokémon, Strategy, Replays, Manage). Manage holds Export (Showdown paste or PokePaste), Format (change in place), Duplicate, the history and Delete. On phones the six are a 2×3 grid.
- **Plans.** Lead and matchup plans share one header (title left, actions right; actions above the title on very small phones) with a dashed divider between Front and Back.
- **Replays.** One "Search opponent's team…" box suggests opponent Pokémon and team styles as multi-select chips, with All / Wins / Losses on the right.
- **Settings.** About you: liked and disliked Pokémon and team styles are pickers that add chips (team styles from `shared/team-styles.ts`). Showdown names are chips; the first is your main one.
- **Dialogs** render at the end of `<body>`, so section styles never move them.
- **Reduced motion** turns off the boot, sweeps, decode, flickers and rolling numbers.

Earlier rounds (Emerald, Round 2) are in `docs/history/emerald/`.
