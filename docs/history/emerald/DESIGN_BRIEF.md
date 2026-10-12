# Design brief: Frontier Brain × Pokémon Emerald / Battle Frontier

You are restyling **Frontier Brain**, an open-source web app for competitive Pokémon Champions VGC doubles: team building, damage calcs, replay review and metagame news. Code: React + Vite in `web/`, a Node API in `tools/`.

## The goal
The app should feel like an **unofficial eighth Battle Frontier facility** from Pokémon Emerald (Game Boy Advance, Gen III), where competitive players prepare, analyse and improve. It should read as a modern competitive toolkit that could exist inside the Emerald universe.

- **Visual language:** Gen III pixel-art sensibility. Chunky pixel borders, compact information panels, and retro RPG menu conventions: a selection cursor/arrow on hovered and selected menu items, and an occasional RPG dialogue box.
- **Palette:** emerald green, deep navy, cream/off-white, restrained gold accents. Define these as tokens on `:root`, with a dark theme that is a night-time Frontier, not just inverted.
- **Dashboards:** use the Frontier Pass idea for the Teams landing page: trainer record, team cards like facility records, maybe "symbols" for achievements later. Present the main areas as facilities: Teams, Replays, Strategy, Data, News.
- **Texture:** subtle tile texture in page backgrounds. Small sprites and pixel icons; the app already uses Showdown box icons and pixelarticons.
- **AI messages:** Ask Frontier Brain replies and onboarding hints can sit in an RPG dialogue box (rounded pixel frame, small "▼" continue marker).

Look up reference screenshots yourself: Emerald Battle Frontier, the Frontier Pass, Battle Tower and Battle Factory menus, summary screens, PC box, text boxes. Use them for **mood and layout conventions only**.

## Hard rules
1. **Reference, not a clone.** Use original graphics and CSS only. **Do not** extract or include official sprites, tiles, logos, fonts or any other copyrighted game assets. Draw pixel borders and frames with CSS (box-shadow steps, borders, gradients) or small original SVGs.
2. **Fonts:**
   - A pixel display font only for short headings, labels, tabs, buttons and badges. Use an open-licensed Google Font such as "Pixelify Sans" or "Silkscreen", loaded via the existing Google Fonts link in `index.html`.
   - Body text, numbers, stat tables and calcs stay in **IBM Plex Sans / Plex Mono** for readability. The owner explicitly rejected pixel fonts for body text.
3. **Modern usability first:**
   - Readable contrast (WCAG AA) in light and dark.
   - Visible keyboard focus.
   - Works at phone width (16px gutters, no horizontal scroll).
   - Respects `prefers-reduced-motion`.
   - No layout breakage. Nostalgia never wins over clarity.
4. **Scope:** restyle, don't rebuild.
   - Work mostly in `web/style.css`. Touch components in `web/` only for markup a style needs: a wrapper, a class, a cursor element.
   - **Do not** change behaviour, data flow, API calls, routes, or anything in `tools/`, `shared/`, `supabase/`.
   - Keep every existing accessible name, label and role; the browser tests rely on them.
5. **Don't touch the sign-in logic** (`web/auth.tsx`). You may restyle the welcome screen and account menu (`.welcome*`, `.account-*` classes), which should feel like stepping into the Frontier.

## Running it
- Dev server on separate ports (the main checkout uses 5173/5174): `WEB_PORT=5273 API_PORT=5274 npm run dev`, then open http://127.0.0.1:5273. It uses a throwaway copy of real data (`APP_DATA` in `.env`), so the teams look real.
- Check every main page:
  - Teams landing
  - a team's Overview / Strategy / Replays / Versions tabs
  - a Pokémon page (set card + calc)
  - New team dialog
  - Ask dock (press `/`)
  - Data page (`#data`)
  - News modal
  - check each at desktop and ~390px width, in light and dark.
- Before finishing:
  - `npm run check` and `npm test` must pass.
  - Commit on this branch (`design/emerald`) in small, described commits. **Do not push and do not merge.**

## Deliverable
Restyled app on branch `design/emerald`, plus `DESIGN_NOTES.md` covering:
- the palette tokens;
- the fonts and their licences;
- what each facility metaphor maps to;
- before/after notes for each page;
- anything you chose not to do and why.
