# Design feedback, round 2 (from the owner)

The owner reviewed the first Emerald pass (DESIGN_NOTES.md; commits 5c4e30e, d46093d) and **doesn't like it yet**. What he said: "There's still lots of misalignment, lots of odd button sizing and lots of stuff left aligned when there should be central spacing." The branch now also contains the latest features merged from main: sample teams, the "From tournaments" tab in New team, team delete, and the sign-in screens. Restyle those too.

## What to change
1. **Light mode only.**
   - Remove the dark theme from this design: drop the `prefers-color-scheme: dark` overrides and the `[data-theme="dark"]` variants, or make them identical to light.
   - One polished light theme.
2. **Palette: rich Pokémon Emerald green plus the trainers' red and green.**
   - Research the actual colours of the Emerald box art and logo, and of the Emerald trainer sprites (Brendan and May's Emerald outfits: their reds, greens, black and white).
   - Build the palette from those: a deep and a bright emerald for primary surfaces, headers and primary buttons; the trainers' red as the accent and for danger; cream/white paper; near-black ink. Gold only sparingly.
   - Define everything as tokens on `:root` and remove any leftover teal or navy.
   - Check WCAG AA contrast for text and buttons.
3. **Alignment and spacing: the main complaint.**
   - Use one spacing scale (4, 8, 12, 16, 24, 32, 48) and apply it consistently.
   - Content sits in a centred column with consistent max-widths. Page headers, empty states, the welcome card, modals, the Frontier record strip, sample-team offer and onboarding cards should be centred and balanced, not hugging the left edge.
   - Grids of cards should be evenly distributed. Card contents should line up: titles, tag badges, the six sprites and footers on a shared baseline.
   - Fix every misaligned row: label/field pairs, button rows, header actions, tabs, stat rows, the tournament list rows, the account menu.
4. **Buttons: one consistent system.**
   - Standard height, padding and font size for default, primary, danger, compact (chips, card actions) and text buttons.
   - Icon-only buttons are square and the same height as the others.
   - No stretched or oddly sized buttons, no mismatched heights within a row, labels vertically centred.
   - The pixel display font stays only on short labels and headings; button labels can use it only if it stays crisp and readable at that size.
5. Keep everything from the original brief (DESIGN_BRIEF.md):
   - original assets only;
   - IBM Plex for body text and numbers;
   - no behaviour, route or API changes;
   - keep all accessible names and labels.

## How to work
- Merge nothing and push nothing. Commit on `design/emerald` in small, described commits.
- Run it with `WEB_PORT=5273 API_PORT=5274 npm run dev`. It uses a throwaway copy of real data.
- **Audit first.** Screenshot every page at 1440px and 390px:
  - Teams landing
  - team Overview, Strategy, Replays and Versions
  - a Pokémon page
  - New team (all three tabs, including picking a tournament team)
  - Ask dock
  - Data page
  - News modal
  - account menu

  Write down every alignment, spacing and button problem you see (in DESIGN_NOTES.md, a "Round 2 audit" section). Fix them all, then screenshot again and confirm each one is fixed.
- `npm run check` and `npm test` must pass before you finish.
- Finish with a summary of the palette (hex values and where each comes from) and the before/after audit.

## Addendum (owner, just now)
"There's no light and dark mode switch even though it mentions it." The first pass talked about light and dark but shipped no way to switch.
- **This round: light only.** No dark theme and no theme switch. Remove every mention of dark mode or a theme switch from DESIGN_NOTES.md and the UI, so nothing promises a feature that doesn't exist.
- Don't add a toggle. A proper switch can come later, done deliberately.
