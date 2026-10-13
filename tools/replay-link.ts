// Automatic replay linking. Every team edit is timestamped in history, and a replay records when it was played,
// the player's six (team preview) and whatever the battle revealed (moves used, items and abilities that showed).
// A replay links to the team whose six it matches, at the edit that was current when the game was played, as long
// as nothing the battle revealed contradicts those sets. Spreads and natures never appear in a replay, so an
// automatic link means "consistent with the game", never "confirmed"; the player can confirm it in one tap.
import {speciesKey,dex} from './mechanics.ts';
import {currentTeam,sameRoster} from './workbench-store.ts';
import type {Game} from './replays.ts';
import type {Workbench,ReplayAssociation,PokemonSet} from '../shared/workbench.ts';

export interface Observed {moves:Set<string>;item?:string;ability?:string}
const base=speciesKey;
const norm=(s?:string)=>(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');

// What the battle showed about the player's own Pokémon, keyed by base species.
export function observedSets(game:Game):Map<string,Observed>{
  const side=game.ownSide,identity:Record<string,string>={},out=new Map<string,Observed>();
  const who=(ref?:string)=>{const name=ref&&identity[ref];return ref?.startsWith(side)&&name?base(name):null;};
  const get=(sp:string)=>{let o=out.get(sp);if(!o){o={moves:new Set()};out.set(sp,o);}return o;};
  for(const e of game.events){const a=e.args;
    if(['switch','drag','replace','detailschange'].includes(e.type)){identity[a[0]]=a[1]?.split(',')[0];continue;}
    const from=a.find(x=>x.startsWith('[from]'))??'',of=a.find(x=>x.startsWith('[of]'))?.slice(5);
    if(e.type==='move'&&a[1]!=='Struggle'&&!from){const sp=who(a[0]);if(sp)get(sp).moves.add(a[1]);continue;}
    // An item that appears or is used up was held — unless it arrived by Trick, Switcheroo or Bestow.
    if((e.type==='-item'||e.type==='-enditem')&&!/move: (Trick|Switcheroo|Bestow)/.test(from)){const sp=who(a[0]);if(sp&&a[1])get(sp).item??=a[1];continue;}
    if(e.type==='-ability'&&!from){const sp=who(a[0]);if(sp&&a[1])get(sp).ability=a[1];continue;}
    const m=/^\[from\] (item|ability): (.+)$/.exec(from);if(m){const sp=who(of??a[0]);if(sp){if(m[1]==='item')get(sp).item??=m[2];else get(sp).ability??=m[2];}}
    if(e.type==='-mega'){const sp=who(a[0]);if(sp&&a[2])get(sp).item??=a[2];}
  }
  return out;
}
// Differences between what the battle showed and a set of six. Empty means consistent.
export function differences(sets:PokemonSet[],observed:Map<string,Observed>):string[]{
  const out:string[]=[];
  for(const [sp,o] of observed){const set=sets.find(s=>base(s.species)===sp);if(!set){out.push(`${sp} isn't in this team`);continue;}
    for(const m of o.moves)if(!set.moves?.some(x=>norm(x)===norm(m)))out.push(`${sp} used ${m}`);
    if(o.item&&set.item&&norm(o.item)!==norm(set.item))out.push(`${sp} held ${o.item}, not ${set.item}`);
    if(o.ability&&set.ability&&norm(o.ability)!==norm(set.ability))out.push(`${sp} had ${o.ability}, not ${set.ability}`);}
  return out;
}
export interface LinkResult {association:ReplayAssociation|null;teamIds?:string[]}
// teamId limits the search to one team (replays added from that team's page).
export function autoLink(db:Workbench,game:Game,teamId?:string):LinkResult{
  const six=game.preview[game.ownSide]??[];const observed=observedSets(game);const played=game.date?Date.parse(game.date):Date.now();
  const teams=teamId?db.teams.filter(t=>t.id===teamId):db.teams;
  const entries=(t:Workbench['teams'][number])=>t.versions.flatMap(v=>v.configurations.map(c=>({v,c,at:Date.parse(c.createdAt),sets:currentTeam(db,t,v.id,c.id)}))).filter(e=>sameRoster(six,e.sets.sets.map(s=>s.species)));
  const matching=teams.map(t=>({t,list:entries(t)})).filter(x=>x.list.length);
  if(!matching.length)return teamId&&teams.length?{association:{teamId,certainty:'family',basis:'auto',note:'A different six from any saved version of this team'}}:{association:null};
  if(matching.length>1)return {association:null,teamIds:matching.map(x=>x.t.id)};
  const {t,list}=matching[0];list.sort((a,b)=>a.at-b.at);
  // The edit current when the game was played; a game from before the team was saved uses its first edit.
  const atTime=[...list].reverse().find(e=>e.at<=played)??list[0];
  const byDistance=[...list].sort((a,b)=>Math.abs(a.at-played)-Math.abs(b.at-played));
  for(const e of [atTime,...byDistance.filter(x=>x!==atTime)]){if(e.sets.errors.length)continue;if(!differences(e.sets.sets,observed).length)
    return {association:{teamId:t.id,versionId:e.v.id,configurationId:e.c.id,certainty:'exact',basis:'auto',...e!==atTime?{note:'Matched an edit from a different date than the game'}:{}}};}
  return {association:{teamId:t.id,versionId:atTime.v.id,certainty:'family',basis:'auto',note:differences(atTime.sets.sets,observed).slice(0,6).join('; ')}};
}
