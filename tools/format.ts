// The format, as the AI needs to understand it: rules read from the pinned Showdown validator and the verified
// regulation record (knowledge/regulations), plus what those rules mean for building and playing. Nothing here is
// recalled from memory; if the regulation record is missing a fact, the primer says it's unknown.
import {dex,FORMAT} from './mechanics.ts';
import {FORMATS} from '../shared/formats.ts';
import {currentRegulations,activeRegulation,recordForFormat,regulationStatusFor} from './regulation.ts';

// The regulation record for a format: the record whose Showdown formats include it, else (for the pinned engine
// format) the active record. Records come from the index (knowledge/regulations/index.json), not a hard-coded map.
function regulation(format:string){const state=currentRegulations();return format.replace(/bo3$/,'')===FORMAT?activeRegulation(state):recordForFormat(state,format);}

// Where a regulation stands today, from its record: active, ending (within 21 days) or ended. With no format it is the
// regulation the app calls current (the index's active one), which after a switch can be newer than the pinned engine:
// then engineVerified is false and everything that speaks about legality says so.
export function regulationStatus(format?:string,now=Date.now()){
  const state=currentRegulations();
  return regulationStatusFor(state,format&&format.replace(/bo3$/,'')!==FORMAT?format:undefined,now)??null;
}
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
    regulation:regulationStatus(format.replace(/bo3$/,'')===FORMAT?undefined:format),
    statPoints:'0–32 per stat, 66 total; no IVs; natures ±10%',
  };
}

// The short version every assistant prompt carries.
export function formatPrimer(format=FORMAT){
  const r=formatRules(format);const reg=r.regulation;
  const clock=!reg?'':(reg.status==='ended'?`\nIMPORTANT: Regulation ${reg.id} ended on ${reg.endsAt.slice(0,10)}. Say so before advising, treat legality and usage here as ${reg.id} data only, and ask which regulation the player is building for.`:reg.status==='ending'?`\nNote: Regulation ${reg.id} ends on ${reg.endsAt.slice(0,10)} (${reg.daysLeft} day${reg.daysLeft===1?'':'s'} left); mention it when advising on long-term builds.`:'')
    +(reg.next&&(reg.status==='ended'||reg.status==='ending')?`\nNext regulation: ${reg.next.id}${reg.next.startsAt?` starts ${reg.next.startsAt.slice(0,10)}`:' (dates not confirmed)'}${reg.next.confidence==='official'&&reg.next.status==='upcoming'?' (official)':' (not confirmed by an official source yet)'}.`:'')
    +(reg.engineVerified?'':`\nIMPORTANT: Legality data for ${reg.id} is not verified yet. The rules, species and item legality and calcs below come from the pinned ${FORMATS[0].label} engine, so say that legality for ${reg.id} is unconfirmed and point the player to the official eligible list.`);let bo3:ReturnType<typeof formatRules>|null=null;try{bo3=formatRules(format.endsWith('bo3')?format:`${format}bo3`);}catch{}
  const megas=r.megaEvolutionPerBattle===1
    ?`One Mega Evolution per battle, but a team may carry several Mega Stone holders${r.duplicateHeldItems===false?' (each stone is a different item, so the item clause allows it)':''}. Which one Mega Evolves is a per-game choice made from team preview and the board: e.g. two Megas give two different modes, and the one you don't evolve still plays as its base form holding the stone (no other item). Never tell the player a team can only have one Mega.`
    :'Mega Evolution limits: not in the regulation record; check with the player or official rules before advising.';
  return `Format: ${r.label} (${r.name}).${clock} ${r.gameType==='doubles'?'Doubles':'Singles'}: register ${r.teamSize}, see both teams at team preview, bring ${r.bring}; level ${r.level}. Stat points ${r.statPoints}.
Clauses: ${r.clauses.species?'one of each species; ':''}${r.clauses.item?'no duplicate held items; ':''}${r.bans.length?`no ${r.bans.join(' or ')}; `:''}open team sheets ${r.clauses.openTeamSheets} in Bo1 on Showdown${bo3?`, ${bo3.clauses.openTeamSheets} in Bo3`:''}. ${r.timers?`Timers: ${r.timers.previewSeconds}s preview, ${r.timers.turnSeconds}s per turn, ${r.timers.playerMinutes} min per player.`:''}
${megas}
Think about a team as the fours it can bring: each matchup picks four of six and a lead pair. Good sixes have more than one mode (e.g. Trick Room and fast, or two Mega options), plans for the common leads, and a backline that rescues bad leads. Bo3 means adapting between games with information from game 1; with open team sheets the opponent knows your items, moves and abilities (not spreads).`;
}
