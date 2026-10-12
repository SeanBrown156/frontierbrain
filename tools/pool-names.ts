// Explicit corrections for names in submitted team lists that the Showdown engine cannot resolve: misspellings,
// truncations, other-language names and "no item" placeholders seen in the pool. Each entry is reviewed by hand; there
// is no fuzzy matching. Anything not listed here (ambiguous names such as "Shadow" or "Mega Stone", names not in the
// Champions roster) is still stored as written and flagged unresolved. The team's source URL keeps the original.
// `null` means the field is explicitly empty (the list says it holds no item).
export type NameKind='item'|'ability'|'nature'|'move';
const key=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const TABLE:Record<NameKind,Record<string,string|null>>={
  item:{
    'Passcho Berry':'Passho Berry','Chopple Berry':'Chople Berry','Sitris Berry':'Sitrus Berry','Citrus berry':'Sitrus Berry','Kassib Berry':'Kasib Berry',
    'Left Over':'Leftovers','leftover':'Leftovers','Focus Slash':'Focus Sash','Choice Scraf':'Choice Scarf','Eject Buttom':'Eject Button',
    'Grassy Seeds':'Grassy Seed','Fairy plume':'Fairy Feather',
    'Golisopodite':'Golisopite','mega Golisopod':'Golisopite','Staraptorite':'Staraptite','venosaurite':'Venusaurite','Sableyite':'Sablenite',
    'Clefabite':'Clefablite','Dragonitite':'Dragoninite','Garchompnite Z':'Garchompite Z',
    'No Item':null,'No Held Item':null,'No Object':null,'Nothing':null,'None':null,'Held Item:':null,
  },
  ability:{
    'Lighting Rod':'Lightning Rod','Lightining rode':'Lightning Rod','Lighitning rod':'Lightning Rod','Lightening Rod':'Lightning Rod','Lighting road':'Lightning Rod',
    'From Zero to Hero':'Zero to Hero','armour tail':'Armor Tail','Competetive':'Competitive','Intimidade':'Intimidate',
    'Emergancy Exit':'Emergency Exit','Emergence Exit':'Emergency Exit','pixilite':'Pixilate','Pixalte':'Pixilate',
  },
  nature:{'Adament':'Adamant','Adamnt':'Adamant','Admant':'Adamant','Modesto':'Modest','Quieto':'Quiet','Quite':'Quiet'},
  move:{
    'Kowtow Kleave':'Kowtow Cleave','Grassy Slide':'Grassy Glide','Last Respect':'Last Respects','Psychic Fang':'Psychic Fangs','Sword dance':'Swords Dance',
    'Psysock':'Psyshock','Duel Wingbeat':'Dual Wingbeat','Darckest Lariat':'Darkest Lariat','Darkest Larient':'Darkest Lariat','Clam Mind':'Calm Mind',
    'Heat Weave':'Heat Wave','Protect it':'Protect','Protec':'Protect','Mystcial Fire':'Mystical Fire','Drgon pulse':'Dragon Pulse','earth po':'Earth Power',
    'utrun':'U-turn','high horsh power':'High Horsepower','High Horse[pwer':'High Horsepower','Mooblast':'Moonblast','throat shop':'Throat Chop',
    'Clanglorous Soul':'Clangorous Soul','Draco Mateor':'Draco Meteor','Ice Wind':'Icy Wind','yamn':'Yawn',
    "Rueed'or":'Make It Rain','Tricherie':'Foul Play',
  },
};
const INDEX=Object.fromEntries(Object.entries(TABLE).map(([k,v])=>[k,new Map(Object.entries(v).map(([raw,to])=>[key(raw),to]))])) as Record<NameKind,Map<string,string|null>>;
/** The reviewed correction for a raw name, `null` for an explicit "no item", or undefined when there is none. */
export const correctName=(kind:NameKind,raw:string|undefined|null):string|null|undefined=>raw?INDEX[kind].get(key(raw)):undefined;
export const corrections=TABLE;
