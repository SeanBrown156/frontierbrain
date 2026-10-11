// The format, as the AI needs to understand it: rules read from the pinned Showdown validator and the verified
// regulation record (knowledge/regulations), plus what those rules mean for building and playing. Nothing here is
// recalled from memory; if the regulation record is missing a fact, the primer says it's unknown.
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {CODE} from './io.ts';
import {dex,FORMAT} from './mechanics.ts';
import {FORMATS} from '../shared/formats.ts';

const regulations:Record<string,any>={'gen9championsvgc2026regmc':'m-c.json'};
function regulation(format:string){const file=regulations[format];const path=file&&resolve(CODE,'knowledge/regulations',file);return path&&existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;}

export function formatRules(format=FORMAT){
  const f=dex.formats.get(format);if(!f.exists)throw new Error(`Unknown format ${format}`);const rt=dex.formats.getRuleTable(f);const reg=regulation(format);
  const has=(r:string)=>rt.has(r);
  return {format:f.id,name:f.name,label:FORMATS.find(x=>format.startsWith(x.id))?.label??f.name,gameType:f.gameType,
    teamSize:rt.maxTeamSize,bring:rt.pickedTeamSize,level:rt.adjustLevel,
    clauses:{species:has('speciesclause'),item:has('itemclause'),teamPreview:has('teampreview'),openTeamSheets:has('forceopenteamsheets')?'forced':has('openteamsheets')?'optional (both players agree)':'no'},
    bans:[has('-tag:mythical')&&'Mythical Pokémon',has('-tag:restrictedlegendary')&&'Restricted legendaries'].filter(Boolean),
    bestOf:has('bestof')?3:1,
    megaEvolutionPerBattle:reg?.megaEvolutionPerBattle??null,duplicateHeldItems:reg?.duplicateHeldItems??null,timers:reg?.timers??null,
    period:reg?{starts:reg.startsAt,ends:reg.endsAt,verified:reg.verifiedAt,source:reg.officialURL}:null,
    statPoints:'0–32 per stat, 66 total; no IVs; natures ±10%',
  };
}

// The short version every assistant prompt carries.
export function formatPrimer(format=FORMAT){
  const r=formatRules(format);let bo3:ReturnType<typeof formatRules>|null=null;try{bo3=formatRules(format.endsWith('bo3')?format:`${format}bo3`);}catch{}
  const megas=r.megaEvolutionPerBattle===1
    ?`One Mega Evolution per battle, but a team may carry several Mega Stone holders${r.duplicateHeldItems===false?' (each stone is a different item, so the item clause allows it)':''}. Which one Mega Evolves is a per-game choice made from team preview and the board: e.g. two Megas give two different modes, and the one you don't evolve still plays as its base form holding the stone (no other item). Never tell the player a team can only have one Mega.`
    :'Mega Evolution limits: not in the regulation record; check with the player or official rules before advising.';
  return `Format: ${r.label} (${r.name}). ${r.gameType==='doubles'?'Doubles':'Singles'}: register ${r.teamSize}, see both teams at team preview, bring ${r.bring}; level ${r.level}. Stat points ${r.statPoints}.
Clauses: ${r.clauses.species?'one of each species; ':''}${r.clauses.item?'no duplicate held items; ':''}${r.bans.length?`no ${r.bans.join(' or ')}; `:''}open team sheets ${r.clauses.openTeamSheets} in Bo1 on Showdown${bo3?`, ${bo3.clauses.openTeamSheets} in Bo3`:''}. ${r.timers?`Timers: ${r.timers.previewSeconds}s preview, ${r.timers.turnSeconds}s per turn, ${r.timers.playerMinutes} min per player.`:''}
${megas}
Think about a team as the fours it can bring: each matchup picks four of six and a lead pair. Good sixes have more than one mode (e.g. Trick Room and fast, or two Mega options), plans for the common leads, and a backline that rescues bad leads. Bo3 means adapting between games with information from game 1; with open team sheets the opponent knows your items, moves and abilities (not spreads).`;
}
