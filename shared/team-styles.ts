// Team styles: one vocabulary for the player's preferences (Settings) and, later, opponent tags on replays (issue #16).
// Grouped for pickers; anything else the player types is kept as written.
export const TEAM_STYLES:{group:string;styles:string[]}[]=[
  {group:'Speed control',styles:['Trick Room','Tailwind','Icy Wind / Electroweb','Priority']},
  {group:'Weather',styles:['Rain','Sun','Sand','Snow']},
  {group:'Terrain',styles:['Psychic Terrain','Electric Terrain','Grassy Terrain','Misty Terrain']},
  {group:'Archetype',styles:['Hyper offense','Bulky balance','Bulky Trick Room','Goodstuffs','Perish trap','Setup','Redirection','Intimidate cycling','Fake Out pressure','Stall']},
];
export const ALL_TEAM_STYLES=TEAM_STYLES.flatMap(g=>g.styles);
