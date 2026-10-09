# Champions mechanics and calculation contract

Verified 2026-10-08 against pinned Showdown commit `c046106cbe075931b1ff8d8b800ff5be47a85f96` and `@smogon/calc` 0.12.0 (its native Champions generation is **0**, not ordinary generation 9).

Sources: [Showdown Champions stat implementation](https://github.com/smogon/pokemon-showdown/blob/c046106cbe075931b1ff8d8b800ff5be47a85f96/data/mods/champions/scripts.ts), [Champions validator](https://github.com/smogon/pokemon-showdown/blob/c046106cbe075931b1ff8d8b800ff5be47a85f96/sim/team-validator.ts), [calculator](https://github.com/smogon/damage-calc).

## Stats

At the fixed Champions battle stats, HP = base HP + SP + 75. Other stats = floor((base + SP + 20) × nature), using integer 110/100 or 90/100 to avoid binary floating-point rounding errors. 0–32 integer points per stat; 66 total at most. Neutral nature has no modifier. No editable IVs. The Showdown serializer calls this field `evs` and uses the `EVs:` text label; our records use `statPoints` so it is never confused with mainline EVs.

Use the modded Champions species/moves/items/abilities and validate sets against the corresponding format. Form changes can affect types, stats and abilities; don't apply an unactivated Mega form to a base-form benchmark.

## Doubles analysis

Priority precedes Speed; Trick Room reverses Speed ordering within priority brackets. Tailwind, paralysis, stages, weather abilities and items affect effective Speed. Speed ties remain ties. Move order alone can reflect priority or effects rather than a raw Speed stat.

Damage includes random rolls, stat/nature rounding, STAB, type effects, weather/terrain, stages, spread targeting, screens, burn, items, abilities and critical-hit rules. Use the calculator's native Champions mechanics, not prose arithmetic. Multi-hit and conditional-power moves may need explicit context; the CLI rejects unprovided context rather than offering false precision. Combined rolls assume the stated attacks connect and no intervening changes; they are not a battle win probability.

Replay HP denominators distinguish exact HP from percent observations. An opponent shown as 77/100 is not known to have max HP 100. Inference from such damage must use intervals and assumptions. Unknown spreads, hidden moves and unobserved back Pokémon remain unknown.

## Iteration

Study lead positioning, speed control, redirection/Fake Out denial, spread versus single-target choices, Intimidate/Defiant interactions, trapping/Perish Song, weather cycles, setup windows, defensive resources and preservation of the win condition. Judge a choice from available information and plausible opposing lines; outcome alone is not decision quality.
