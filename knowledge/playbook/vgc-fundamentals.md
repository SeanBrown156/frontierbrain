# VGC doubles fundamentals playbook

Purpose: shared doubles fundamentals for any assistant collaborating with a Frontier Brain player (MCP clients and the in-app assistant), adapted to Pokémon Champions, Regulation M-C.
Retrieved: 2026-10-12.
Status: paraphrased strategy guidance drawn from long-standing community fundamentals (Nugget Bridge, VGCGuide, Smogon). It is **not** a rules source and contains **no** numbers. Current rules come from `knowledge/regulations/`, mechanics from `knowledge/mechanics/champions.md`, and every Speed, damage, usage or matchup number from the app's tools (`calc_damage`, `calc_speed`, `pokemon_profile` and the pool/meta tools).

Champions frame: doubles; register 6, bring 4; level 50; stat points (0–32 per stat, 66 total, no IVs; mainline EV/IV numbers do not apply); one Mega Evolution per battle, though several Pokémon may hold Mega Stones; item clause and species clause; open team sheets (optional for Bo1 on Showdown, always used in Bo3). Terastallization, Dynamax and Z-moves do not exist here, so older guides that lean on them need translating, not copying.

---

## 1. Thinking in fours: team preview, leads and backlines

A VGC team is six options for building several four-Pokémon squads. Judge it by its best four against each likely opponent, not by all six at once.

- **Preview is two decisions:** which two sit out, then which two lead.
- **Read the whole opposing team, not six separate threats.** Find their mode first (Trick Room, Tailwind, weather, setup, a Mega plan), then each piece's job inside it.
- **Leads need a job:** immediate pressure, establishing speed control, or soaking a turn defensively. A lead with no clear turn-1 plan is a warning sign.
- **The backline is your escape route.** Reserves should rescue a bad lead and also finish the game.
- **The four you bring must handle all six they show.**
- **Common mistakes:** autopiloting the same four every game; "bluff" slots that never get brought; picking leads on raw matchup while ignoring the obvious opposing lead.

How to apply it when building: name two or three standard leads with backlines, and check the team has more than one "default four".

Further reading: [A Preview to Team Preview in VGC (R Inanimate, Nugget Bridge)](https://nuggetbridge.com/articles/a-preview-to-team-preview-in-vgc) · [VGCGuide: Team Preview](https://www.vgcguide.com/team-preview) · [VGCGuide: What Is a Game Plan](https://www.vgcguide.com/what-is-a-game-plan)

## 2. Speed control and modes

Moving first lets you KO before being hit and limits bad RNG against you.

- **Tailwind** speeds up your side for a few turns. Setting it on turn 1 is a strong opening. Count the turns: the turn it goes up counts toward its duration.
- **Trick Room** reverses order within each priority bracket for a few turns. Because it moves last on the turn it is set, it gives roughly one turn less than its listed duration. Trick Room teams need setters (bulky or immediately threatening), helpers that protect them (Fake Out, redirection) and slow, bulky, hard-hitting abusers.
- **Speed drops** (Icy Wind, Electroweb and similar) are spread chip plus control, but they reset when the target switches. Strongest late, when switching is unsafe. Beware abilities that punish stat drops.
- **Paralysis** lasts until cured and can make the target lose its turn, but type immunities and Taunt or Safeguard-style answers limit it.
- **Priority** ignores Speed and goes through Trick Room order within brackets. It usually costs power, and some priority is blocked by abilities, terrain or Quick Guard.
- **Speed tiers still matter** once field effects run out. Mixed speeds or a dual-mode plan avoid a dead window when the mode fails or expires.

How to apply it when building: decide the team's primary mode and its fallback. Use `calc_speed` to check what each Pokémon outspeeds or underspeeds, both with and without the mode active, and choose Speed stat points to hit a named benchmark, not a round number. Speed ties are coin flips.

Further reading: [VGCGuide: Speed Control](https://www.vgcguide.com/speed-control) · [VGCGuide: Trick Room](https://www.vgcguide.com/trick-room) · [Smogon: A Beginner's Guide to Speed Control in VGC](https://www.smogon.com/articles/guide-to-speed-control-in-vgc-p1)

## 3. Board control: Fake Out, redirection, Intimidate, guards, Protect, positioning

- **Fake Out** works only on a Pokémon's first turn out. It uses priority to flinch one target, buying a free turn for setup (Tailwind, Trick Room, a boost) or stopping a KO. Protect, flinch immunity and faster Fake Out blunt it; switching out resets it.
- **Redirection** (Follow Me, Rage Powder) pulls single-target moves toward the user so a partner can set up or attack safely. Rage Powder fails against Pokémon immune to powder moves, and spread moves ignore redirection.
- **Intimidate** lowers both foes' Attack on entry. Cycling an Intimidate user in and out keeps physical attackers weak, but it also costs tempo and exposes the switch-in to two attacks. Respect abilities that punish stat drops or block Intimidate.
- **Wide Guard / Quick Guard** block spread moves and priority moves for your whole side. Strong but narrow; justify the slot by how common the threat is.
- **Protect** is the default doubles move: it scouts, wastes opposing Fake Out and turns of speed control, and makes double-targeting fail. Before you click it, ask what happens next turn. Consecutive Protects usually fail, so plan for only one.
- **Positioning** means arranging the board so next turn is good for you: switching on a predicted attack, stalling out field effects, or saving a low-HP Pokémon (it still hits at full strength) for a safe re-entry.

How to apply it when building: give the team at least one way to make a turn safe (Fake Out, redirection, Intimidate, Protect on key slots) and at least one way to beat opposing board control. When a slot drops Protect, say why.

Further reading: [The Fake Out Guide (bearsfan092, Nugget Bridge)](https://nuggetbridge.com/?p=65) · [VGCGuide: Utility Moves](https://www.vgcguide.com/utility-moves) · [VGCGuide: Protect in Battle](https://www.vgcguide.com/protect-in-battle) · [VGCGuide: Switching](https://www.vgcguide.com/switching) · [VGCGuide: 1 HP Is Infinitely More Than 0 HP](https://www.vgcguide.com/1-hp-is-infinitely-more-than-0-hp) · [Smogon: Fifth Generation Double Battle Guide](https://www.smogon.com/resources/competitive/bw/double_battles)

## 4. Damage: spread vs focus fire, chip, KO thresholds, defensive benchmarks

- **Spread moves** hit both foes at reduced power. They pay off in total damage and chip, but leave both targets alive more often.
- **Doubling up** (two attacks into one target) secures a KO through Protect-less targets or bulk. A Protect or switch wastes both actions, so split against likely Protects and double a must-remove threat.
- **Damage-boost support** (Helping Hand-style moves, Intimidate on the defending side, screens) shifts KO thresholds, so calculate with the boost in place.
- **Chip has value only if it sets up a KO.** Think in combined damage: "spread move plus a follow-up KOs" is a plan; "50% damage" is not.
- **Defensive benchmarks** come before offensive polish: name the specific attack a Pokémon must survive (often a common spread move or a key partner combination), find the minimum bulk that clears it, then spend what is left on Speed or offense.
- **Rolls and crits exist.** Don't build a plan that only works on a high roll, and say so when a KO is not guaranteed.

How to apply it when building: never estimate damage in prose. Run `calc_damage` against the opposing spreads the app provides (labelling the source), including the spread modifier, weather, Intimidate and items. Report ranges and guaranteed or possible KOs.

Further reading: [Smogon: Fifth Generation Double Battle Guide](https://www.smogon.com/resources/competitive/bw/double_battles) · [VGCGuide: Predictions](https://www.vgcguide.com/predictions)

## 5. Building around a Pokémon

- **Say what makes the pick distinctive.** A typing, ability, Speed tier, move or Mega form that few others offer. If another Pokémon does the job better, say so while respecting the player's choice.
- **Good picks pressure without setup,** stay useful when the opponent knows their set (open sheets make this essential), enable teammates, and have more than one good matchup.
- **Cores** are pairs or trios whose synergy defines how the team plays. Partners cover each other's weaknesses and remove each other's checks. Classic type cores (Fire/Water/Grass; Dragon/Fairy/Steel) are templates, not rules.
- **Cover the centrepiece's weaknesses** two ways: defensively (partners that take its bad hits or remove those attackers) and with board control (Fake Out, redirection, speed control that lets it act).
- **Name win conditions.** What actually ends games: a cleaner under Tailwind, a Trick Room sweeper, a late-game bulky attacker? A team needs at least two routes.
- **Sixth-Pokémon syndrome:** if the last slot has to fix five problems, the first five are the problem. Shrink back to the core and rebuild, or accept a weakness that is rare in practice.

How to apply it when building: start from the player's centrepiece and partner, write the job of each slot in one line, and use `pokemon_profile` to check typing, abilities and movepool before suggesting roles.

Further reading: [VGCGuide: What Makes a Pokémon Good](https://www.vgcguide.com/what-makes-a-pokemon-good) · [VGCGuide: Cores and Modes](https://www.vgcguide.com/cores-and-modes) · [VGCGuide: Sixth Pokémon Syndrome](https://www.vgcguide.com/6th-pokemon-syndrome) · [VGCGuide: Teambuilding index](https://www.vgcguide.com/teambuilding)

## 6. Megas in Champions as modes

Only one Pokémon can Mega Evolve per battle, but a team may carry several Mega Stone holders (each stone counts toward the item clause).

- **Treat each Mega as a mode.** Two holders let you choose your Mega at preview and keep opponents guessing, but the other holder is a base form whose stone does nothing.
- **Check each holder un-Megaed.** Dead weight in base form shrinks your bring-4 options.
- **Mega forms can change typing, ability and stats,** and some change Speed in ways that interact with turn order on the turn they evolve. Check the Mega form with `pokemon_profile` and `calc_speed`, and never benchmark the base form as if it were the Mega (or the reverse).
- **The Mega usually is the win condition or the main pressure.** Build the rest of the team to enable it (speed control, board control, partners that cover its weaknesses), and keep a non-Mega plan for when it is answered.

Further reading: [Victory Road: Pokémon Champions Regulations](https://victoryroad.pro/champions-regulations/) · [VGCGuide: Cores and Modes](https://www.vgcguide.com/cores-and-modes)

## 7. Matchup planning and the meta

- **Build a threat list from the app's evidence:** the team pool, official-event team lists and the meta set tools, labelled by source and period. Don't blend sources or invent usage.
- **Plan for common leads.** For each frequent opposing lead pair, write your preferred lead, the turn-1 play that works across most of their options, and your backline.
- **Analyse the threat, then answer with good Pokémon.** Work out what makes a threat dangerous (offense, bulk, utility or Speed) and exploit that with Pokémon that are strong in general. A combo threat usually needs synergy, not a single counter.
- **Don't over-tech.** Single-purpose slots or moves clash with the team. Accept some hard matchups; "hard but winnable" is different from "no options".
- **Know the game plan for each matchup:** how your strengths beat their likely answers, what the endgame looks like after your speed control expires, and how you close.

How to apply it when building: save leads and matchup plans to the team's coaching record (`coaching-save`, kept `proposed` until the player accepts). Re-check them when the meta snapshot changes.

Further reading: [VGCGuide: How to Beat a Pokémon](https://www.vgcguide.com/how-to-beat-a-pokemon) · [VGCGuide: What Is a Game Plan](https://www.vgcguide.com/what-is-a-game-plan) · [VGCGuide: Sixth Pokémon Syndrome](https://www.vgcguide.com/6th-pokemon-syndrome)

## 8. Bo1 vs Bo3, open team sheets, information and adaptation

- **Bo1:** surprise has more value, but under open sheets surprise moves and items are visible, so surprise comes from unusual choices and spreads (stat points stay hidden). At preview, choose fours that handle all six opponents and avoid all-in leads. Assume the opponent has their strongest options.
- **Bo3:** consistency beats gimmicks. Teams with several modes make the opponent guess what you will bring. A player who is a game up can afford more risk.
- **Open team sheets** show species, abilities, items and moves, but not stat points. Planning should assume the opponent knows your moves and items. Your hidden edge lies in stat-point benchmarks, selection, and sequencing. Infer opposing spreads only as labelled hypotheses.
- **Information discipline:** judge decisions by what was known at that turn. Revealed information is for the next game, not hindsight blame.
- **Between games, take notes:** which items, moves and Speed interactions were revealed, and how the opponent played the key turns (risk-taking, favourite pieces, how often they protect or switch). Turn that into a revised plan for the next game. A game-1 win is not the set: the opponent is now informed and motivated, so game 2 often needs more focus, not less.

Further reading: [VGCGuide: Approaching Best-of-1 vs Best-of-3](https://www.vgcguide.com/approaching-best-of-1-vs-best-of-3) · [VGCGuide: Predictions](https://www.vgcguide.com/predictions) · [Victory Road: Pokémon Champions Regulations](https://victoryroad.pro/champions-regulations/) · [Player's Psychology (Rubén Yanguas, Victory Road, archived)](https://web.archive.org/web/20210210222504/https://victoryroadvgc.com/2019/09/03/subjective-interpretation-situation-pokemon/)

## 9. Playtesting and revising

- **A good team gives you control:** several ways to win, proactive turns rather than forced reactions, and weaknesses you know and rarely meet. It holds up in Bo3 against opponents who know it.
- **Sample size first.** A handful of games is anecdote. Report the counts, separate ladder from tournament and Bo1 from Bo3, and look for repeated patterns (the same lead losing, the same Pokémon never brought) before concluding anything.
- **Separate play errors from team problems.** A loss to a misplay or a low-probability roll does not mean the team needs changing.
- **What to change first, smallest change first:** play pattern and leads, then stat-point spread (to hit a benchmark you keep missing), then moves and items, then one slot, then the core. Change one thing at a time so the result is readable.
- **Low use is not proof a move or Pokémon is expendable.** Some options earn their place by threat or by a rare but decisive matchup.
- **Candidate changes are proposals,** saved as new inactive versions or set revisions, never silently adopted.
- **Be honest about what isn't working.** Memorable wins are not evidence; judge a pet pick over a real sample.
- **Practise with a purpose.** Set a specific aim for each session (a matchup, a lead, a Speed benchmark to verify), keep short notes on each session, and review replays as well as playing. Practise tired sometimes: late rounds count too.
- **Taper before events.** Lock the team well before the tournament, then spend the remaining time learning its matchups rather than rebuilding.

Further reading: [VGCGuide: How Do You Know if a Team Is Good?](https://www.vgcguide.com/how-do-you-know-if-a-team-youve-made-is-good) · [VGCGuide: Battling index (incl. How to Analyze a Battle)](https://www.vgcguide.com/battling) · [Preparing Yourself for Competition (Rhydian Cowley, Pokémon Australia, archived)](https://web.archive.org/web/20170206043343/http://pokemonaustralia.com/preparing-yourself-for-competition/) · [Playing to Win (Zog, Nugget Bridge)](https://nuggetbridge.com/articles/sardonic-hipsters-guide-vgc-2015-part-one-playing-win/)

## 10. How to collaborate with the player

Questions worth asking early:
- What is the centrepiece or idea, and is it non-negotiable? (A favourite is a constraint to build around, not a mistake to fix.)
- Bo1 ladder or Bo3 tournament? What is the event date and level?
- Preferred style: hyper offense, balance, Trick Room, dual mode? Which Pokémon do they enjoy or dislike piloting?
- Which matchups or Pokémon currently beat them, and in how many games?
- For an existing team: what are their usual leads and fours, and which sets are confirmed rather than inferred?

When to decide yourself versus ask:
- **Decide and show your work:** exact stat-point spreads to a named benchmark (after running the calcs), item-clause conflicts, illegal or impossible sets, obvious type redundancies, and turn-count arithmetic.
- **Propose options with trade-offs:** move or item swaps, the last slot, which Mega to run, the lead plan.
- **Ask before:** replacing a core member, changing the archetype, or adopting any change to the active team.

Habits: give a short verdict first, then the reasoning; mark observations, assumptions and hypotheses; take every number from the tools and say which source and period; coach at the player's `coachingLevel`; and prefer one clear recommendation with a fallback over a long menu.

Further reading: [VGCGuide: How to Win (Sometimes) With Your Favorites](https://www.vgcguide.com/how-to-win-sometimes-with-your-favorites) · [VGCGuide: Teambuilding index](https://www.vgcguide.com/teambuilding)

## 11. Playing well: momentum, reads and mindset

**Momentum.** In a 2v2 board, the side with more active threats has momentum: Pokémon that can KO or cripple something next turn and that will survive to do it.
- **Every turn should create or use a threat.** Switching in "whatever takes least damage" with no follow-up just leads to another defensive turn. Ask whether the move leaves you threatening something.
- **Tools that build momentum:** pivoting moves (switch plus damage), speed control (turns outsped threats into active ones), redirection and survival effects like Focus Sash or Sturdy (guarantee an action), and sometimes a double Protect that baits out the opponent's Protect.
- **Use momentum to narrow their options, then convert.** When you hold the threats, the opponent has few good moves. Pick plays that cover their likely responses (including the likely switch-in) and trade your advantage for a material lead.
- **Not every KO is good.** A KO gives the opponent a free switch-in. If that switch brings in their setter or win condition safely, or locks you into a poor position, it may be better to remove the key piece (such as the Trick Room setter) than to take the easy KO.

**Reads and risk.**
- **Proactive over reactive.** Stopping a threat from acting (removing it, controlling speed, denying the setup turn) beats building to survive it, because surviving still leaves secondary effects and RNG in play.
- **Manage probability.** Speed, bulk, accuracy and board position all decide how exposed you are to misses, crits and secondary effects. Prefer lines that leave the opponent needing luck, and avoid lines that need it yourself.
- **Read the opponent's style.** Some players switch heavily around your committed moves; others make aggressive reads. Note which you face, especially across a Bo3.
- **Spend the clock wisely.** Champions has per-turn and total timers (see `knowledge/regulations/`). Move fast on obvious turns so you have time for the decisive ones.

**Mindset.**
- **A bad roll is a new starting position, not the end.** Find the remaining route to victory; tilt costs more than the roll did.
- **Early losses in a Swiss event matter no more than late ones** when advancement is by record. Reset between rounds (a break, a walk, food and water) and play one game at a time.
- **Pressure is shared.** In a deciding match the opponent is just as nervous and tired; whoever manages it better gains the edge.
- **Don't blame luck.** Ask how you could have reached a position where their luck would not have mattered. Win or lose, be gracious and talk the game through; both players learn.
- **Know what you play for.** Playing to win means treating each game as a puzzle and choosing what most improves your odds, but players also have personal goals and favourites. Respect both, and say clearly when they conflict.

How to apply it as a collaborator: in replay reviews, point to turns where momentum was won or lost and to KOs that gave away a free switch, judged with the information available at the time. Frame bad luck as "what position would have made this not matter", and keep feedback calm and constructive.

Further reading: [Momentum Management in Pokémon (SuperIntegration, Nugget Bridge)](http://nuggetbridge.com/articles/momentum-management-pokemon/) · [Playing to Win (Zog, Nugget Bridge)](https://nuggetbridge.com/articles/sardonic-hipsters-guide-vgc-2015-part-one-playing-win/) · [Player's Psychology (Rubén Yanguas, Victory Road, archived)](https://web.archive.org/web/20210210222504/https://victoryroadvgc.com/2019/09/03/subjective-interpretation-situation-pokemon/) · [Caution! Trainer Under Pressure: Sportsmanship in VGC Play (Nugget Bridge)](https://nuggetbridge.com/articles/caution-trainer-under-pressure-sportsmanship-in-vgc-play/) · [Preparing Yourself for Competition (Rhydian Cowley, archived)](https://web.archive.org/web/20170206043343/http://pokemonaustralia.com/preparing-yourself-for-competition/) · [Pokémon VGC Resources (Nimbasa City Post)](https://www.nimbasacitypost.com/2019/12/vgc-resources.html)
