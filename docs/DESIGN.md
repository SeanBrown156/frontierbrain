# Frontier Brain design notes

## Jade Glass (October 2026, branch `jade-glass-ui`)

Chosen from the Round 3 lookbook: Sky Pillar inside a clear emerald shell. It supersedes the Round 2 cream palette (see `docs/history/emerald/`), which is kept as history. The system lives in one stylesheet, `web/jade.css`: an unscoped base section (element defaults and layout) followed by the theme, whose rules are scoped to `html.jade`.

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
- **Calc, round 3.** The attacker's card sits on top and the defender's below; the swap reorders them (animated) and the arrow follows. Side effects belong to a Pokémon's side and follow it when you swap. The attacker's card shows its move and attack boosts (Helping Hand, Battery, Power Spot, Steely Spirit, crit). The defender's card shows its protection (Reflect, Light Screen, Aurora Veil, Friend Guard, Protect). The Field box between them holds weather, terrain, Gravity, the Rooms, the Ruin abilities and Trick Room. A Mega Stone holder battles as its Mega (switch on the card, on by default; the calc uses the Mega species and ability). Results: an HP bar that drains to the damage range (min–max hatched, colour by HP left, 25%/50% marks), a verdict pill and the 16 rolls (KO rolls red); speed is a race where the leader reaches the line and the other stops where its Speed takes it (reversed under Trick Room). Save as benchmark lives in the result box. Calcs run by Ask Frontier Brain on a Pokémon page load into the panel with their exact inputs ("Loaded from Ask Frontier Brain").
- **Mega images.** HOME renders exist for the classic Megas (e.g. Mawile-Mega, Swampert-Mega); the cards, set card and calc show them. New Champions Megas without a render fall back to the base form.
- **Pokémon Strategy.** Markdown, rendered as a guide with an Edit/Done toggle.
- **Later rounds (12 Oct).**
  - **Icons and type:** Lucide line icons replace the pixel icons, and the app uses two fonts: Saira Condensed for titles and big numbers, Hanken Grotesk for everything else.
  - **Header:** the news and nav run full width as one bar and detach into a floating bar on scroll.
  - **Ask Frontier Brain** is a floating overlay panel.
  - **Brain backdrop:** a giant wireframe brain sits behind every page (`web/brain/wire-brain.js`, Constellation mode, calm settings), with glass panels about 85% opaque over it. The header and favicon use the flat emerald brain icon (`public/brand/icon-64.png`).
  - **Megas** show their render (base-form HOME render when there's no Mega render), with the Mega symbol (`public/brand/mega.svg`) in a rainbow orb and a pill beside the name.
  - **Strategy tab:** a short strategy paragraph, then the team; clicking a Pokémon shows its notes.
  - **Plans:** lead plans have a title, a role (Core/Situational/Niche/Avoid) and Front/Back rows. Matchup plans have a title, a team style (one list shared with replay summaries), examples, threat and Bring.
  - **Format** is chosen when a team is created and moved by copying.
  - **Replays:** a Debrief (What's working / What to work on) and a "Who gives you trouble" grid.
  - **Pickers:** items and moves get searchable pickers with sprites and types.
  - **Speed** uses the calculator's `getFinalSpeed` (weather and terrain abilities, Choice Scarf, Iron Ball, Tailwind, paralysis), with weather and terrain on the Speed tab.
  - **Export** can create a PokePaste on request.
- **Avoid.** Sports-betting cues: odds chips, slanted score bars, loud tickers. The news strip is kept quiet: mono type, no red.

Earlier rounds (Emerald, Round 2) are in `docs/history/emerald/`.
