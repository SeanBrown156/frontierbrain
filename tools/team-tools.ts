// MCP tools that let an assistant check a team before it saves one: what a Pokémon can legally run, a structural review of
// a six (all numbers from the engine, no verdicts), and real tournament teams that run the same Pokémon.
import ps from 'pokemon-showdown';
import {dex,FORMAT,finalStats,resolveSpecies,speciesKey,teamSets,type SetInput} from './mechanics.ts';
import {importText} from './teams.ts';
import {poolTeams} from './pool.ts';
import {currentTeam} from './workbench-store.ts';
import type {Workbench} from '../shared/workbench.ts';

const str={type:'string'};
const validator:any=new ps.TeamValidator(FORMAT);

export const teamTools=[
  {name:'review_team',description:'Structural facts about a six, computed locally, for you to reason from: shared weaknesses and resists by type, speed tiers (final stats at level 50), roles it has and lacks (Fake Out, speed control, redirection, Intimidate, Protect, weather or terrain), the types its moves cover, Mega Stone count, duplicate items and any legality errors. Run it on a draft before saving, and again after changes. Observations only; the judgement is yours and the player\'s.',parameters:{type:'object',properties:{teamId:{...str,description:'A saved team (list_teams)'},paste:{...str,description:'Or a draft: a Showdown paste of up to six Pokémon, not saved'}}}},
  {name:'reference_teams',description:'Real tournament teams from the pool that run the Pokémon you name, with event, placing, record, date and source lane (official, online, shared). Use it to see how winning teams are built around the same Pokémon or strategy before proposing a six. The result says how many pooled teams were searched; show that count.',parameters:{type:'object',properties:{species:{type:'array',items:str,minItems:1,maxItems:6,description:'Species the teams should include (all of them first, then teams with most of them)'},limit:{type:'number',description:'How many teams to return (default 8, max 20)'}},required:['species']}},
];
export const teamToolNames=new Set(teamTools.map(t=>t.name));

const SPEED_CONTROL=['tailwind','trickroom','icywind','electroweb','thunderwave','glare','stringshot','bulldoze','snarl','scaryface','cottonspore','stunspore','nuzzle','sandattack','mudshot','lowsweep','rocktomb','toxicthread'];
const REDIRECT=['followme','ragepowder','allyswitch','spotlight'];
const WEATHER_ABILITY:Record<string,string>={Drought:'Sun',Drizzle:'Rain','Sand Stream':'Sand','Snow Warning':'Snow','Orichalcum Pulse':'Sun','Desolate Land':'Sun','Primordial Sea':'Rain',
  'Electric Surge':'Electric Terrain','Grassy Surge':'Grassy Terrain','Psychic Surge':'Psychic Terrain','Misty Surge':'Misty Terrain','Hadron Engine':'Electric Terrain','Seed Sower':'Grassy Terrain'};
const moveName=(id:string)=>dex.moves.get(id).name;

export function legalOptions(input:any){
  const raw=String(input.species??'').trim();const resolved=resolveSpecies(raw)??raw;const sp:any=dex.species.get(resolved);
  if(!sp.exists)throw new Error(`${raw||'That'} isn't a Pokémon in this format. Check the spelling or check the spelling.`);
  const data:any=(dex.species as any).getLearnsetData(sp.id)??(dex.species as any).getLearnsetData(dex.species.get(sp.changesFrom??sp.baseSpecies).id);
  const ids=Object.keys(data?.learnset??{});
  const moves=ids.map(id=>dex.moves.get(id)).filter((m:any)=>m.exists&&!m.isNonstandard).filter((m:any)=>{try{return !validator.checkCanLearn(m,sp);}catch{return false;}}).map((m:any)=>m.name as string).sort();
  const forms=(sp.otherFormes??[]).map((n:string)=>dex.species.get(n)).filter((f:any)=>f.exists&&/mega/i.test(f.forme??''));
  return {species:sp.name,types:[...sp.types],baseStats:sp.baseStats,abilities:Object.values(sp.abilities),legalMoves:moves,
    megaForms:forms.map((f:any)=>({name:f.name,item:f.requiredItem,types:[...f.types],ability:f.abilities?.['0']})),
    heldItems:'Use format_rules.legalItems; a Mega Stone only works on its own Pokémon.',
    source:'Pinned Champions validator (checkCanLearn); anything not listed is refused on save.'};
}

const effectOf=(attack:string,types:string[])=>dex.getImmunity(attack,types)?2**dex.getEffectiveness(attack,types):0;
function review(sets:SetInput[],format=FORMAT){
  const mons=sets.map(s=>{const sp:any=dex.species.get(s.species);const item=s.item?dex.items.get(s.item):null;
    const mega:any=item&&(item as any).megaStone?dex.species.get(typeof (item as any).megaStone==='string'?(item as any).megaStone:Object.values((item as any).megaStone)[0] as string):null;
    const bodies=[sp,...(mega?.exists?[mega]:[])];
    const stats=finalStats({...s} as any);return {set:s,species:sp.name,types:[...sp.types] as string[],megaTypes:mega?.exists?[...mega.types] as string[]:null,spe:stats.spe,megaSpe:mega?.exists?finalStats({...s,species:mega.name,ability:mega.abilities?.['0']} as any).spe:null,
      ability:s.ability??'',moves:(s.moves??[]).map(m=>dex.moves.get(m)),bodies};});
  const attackTypes:string[]=dex.types.names().filter((t:string)=>t!=='Stellar');
  const weak=attackTypes.map((t:string)=>{const w:string[]=[],r:string[]=[];for(const m of mons){const e=effectOf(t,m.types);if(e>=2)w.push(`${m.species}${e>=4?' (4×)':''}`);else if(e<1)r.push(m.species);}return {type:t,weak:w,resist:r};});
  const flags=weak.filter(x=>x.weak.length>=3&&x.weak.length>x.resist.length).map(x=>`${x.weak.length} weak to ${x.type} (${x.weak.join(', ')}) with ${x.resist.length} resisting`);
  const has=(ids:string[])=>mons.filter(m=>m.moves.some((mv:any)=>ids.includes(mv.id))).map(m=>m.species);
  const roles={
    fakeOut:has(['fakeout','firstimpression']),
    speedControl:[...new Set([...has(SPEED_CONTROL)])],
    trickRoom:has(['trickroom']),tailwind:has(['tailwind']),
    redirection:has(REDIRECT),
    protect:mons.filter(m=>m.moves.some((mv:any)=>['protect','detect','spikyshield','kingsshield','banefulbunker','silktrap','burningbulwark'].includes(mv.id))).map(m=>m.species),
    intimidate:mons.filter(m=>m.ability==='Intimidate').map(m=>m.species),
    weatherOrTerrain:mons.filter(m=>WEATHER_ABILITY[m.ability]).map(m=>`${m.species} (${WEATHER_ABILITY[m.ability]})`),
    spreadMoves:mons.filter(m=>m.moves.some((mv:any)=>['allAdjacentFoes','allAdjacent'].includes(mv.target))).map(m=>m.species),
  };
  const missing=[!roles.fakeOut.length&&'Fake Out',!roles.speedControl.length&&'speed control',!roles.redirection.length&&'redirection',!roles.protect.length&&'Protect'].filter(Boolean);
  const covered=new Set<string>();for(const m of mons)for(const mv of m.moves as any[])if(mv.category!=='Status')covered.add(mv.type);
  const unhit=attackTypes.filter((t:string)=>!([...covered].some((c:string)=>effectOf(c,[t])>=2)));
  const speeds=mons.map(m=>({species:m.species,speed:m.spe,...m.megaSpe?{megaSpeed:m.megaSpe}:{}})).sort((a,b)=>b.speed-a.speed);
  const stones=mons.filter(m=>m.megaTypes).map(m=>m.species);
  const items=mons.map(m=>m.set.item).filter(Boolean) as string[];const dupItems=[...new Set(items.filter((i,n)=>items.indexOf(i)!==n))];
  let legality:string[]=[];try{if(sets.length===6)new ps.TeamValidator(format).validateTeam(teamSets(sets) as any)?.forEach((e:string)=>legality.push(e));else legality=[`${sets.length} Pokémon: a team needs six`];}catch(e){legality=[(e as Error).message];}
  return {pokemon:mons.map(m=>({species:m.species,types:m.types,...m.megaTypes?{megaTypes:m.megaTypes}:{},item:m.set.item??null,ability:m.ability||null})),
    sharedWeaknesses:flags,weaknessTable:weak.filter(x=>x.weak.length>=2).map(x=>({type:x.type,weak:x.weak,resist:x.resist})),
    speedTiers:speeds,roles,rolesNotCovered:missing,
    moveTypesCovered:[...covered].sort(),typesNoMoveHitsSuperEffectively:unhit,
    megaStoneHolders:stones,duplicateItems:dupItems,legality:legality.length?legality:'legal',
    note:'Facts from the pinned engine. A missing role is not automatically a flaw: judge it against the plan, and check the pool for how winning teams handle it.'};
}

async function referenceTeams(input:any){
  const want=[...new Set((Array.isArray(input.species)?input.species:[]).map((s:any)=>speciesKey(resolveSpecies(String(s))??String(s))))].filter(Boolean) as string[];
  if(!want.length)throw new Error('Name at least one Pokémon');
  const limit=Math.min(20,Math.max(1,Number(input.limit)||8));const teams=await poolTeams();
  const rows=teams.map((t:any)=>{const have=new Set(t.pokemon.map((p:string)=>speciesKey(resolveSpecies(p)??p)));const hit=want.filter(w=>have.has(w));return {t,hit:hit.length};}).filter(x=>x.hit>0);
  const best=Math.max(0,...rows.map(r=>r.hit));
  const ranked=rows.filter(r=>r.hit===best).sort((a,b)=>((a.t.placing??999)-(b.t.placing??999))||String(b.t.date).localeCompare(String(a.t.date))).slice(0,limit);
  return {searched:teams.length,asked:input.species,matchedAll:best===want.length,mostShared:best,
    teams:ranked.map(({t}:any)=>({event:t.event,date:t.date,players:t.players,placing:t.placing,record:t.record,lane:t.lane,player:t.player,pokemon:t.pokemon,
      sets:t.sets.map((s:any)=>`${s.species} @ ${s.item||'?'} · ${s.ability||'?'} · ${(s.moves??[]).join(', ')}`),source:t.sources?.[0]?.url??null})),
    note:best===want.length?`${ranked.length} of the matching teams shown. Placing and record are the event's; no win rates are implied.`
      :`No pooled team runs all of them. These share ${best} of ${want.length}. Say so; do not present them as the same strategy.`};
}

export async function teamToolCall(name:string,input:any,db:Workbench){
  if(name==='reference_teams')return referenceTeams(input);
  if(name==='review_team'){
    if(typeof input.paste==='string'&&input.paste.trim())return review(importText(input.paste));
    if(input.teamId){const t=db.teams.find(x=>x.id===input.teamId);if(!t)throw new Error('Team not found');return review(currentTeam(db,t).sets as any,t.format);}
    throw new Error('Send teamId or paste');
  }
  throw new Error(`Unknown tool ${name}`);
}
