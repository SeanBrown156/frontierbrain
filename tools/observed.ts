import {dex} from './mechanics.ts';
import type {Game} from './replays.ts';
import type {PokemonSet,FieldCertainty} from '../shared/workbench.ts';
import type {MetaSets} from './meta-sets.ts';

// What one game proves about the player's own sets. Only directly revealed facts are recorded:
// moves the Pokémon chose (not called/copied), items shown or consumed, abilities announced while unmega'd.
export interface Observation {moves:string[];item?:string;ability?:string;}
const base=(name:string)=>dex.species.get(name).baseSpecies;
export function observeGame(game:Game):Record<string,Observation>{
  const own=game.ownSide,identity:Record<string,string>={},out:Record<string,{moves:Set<string>;item?:string;ability?:string}>={};
  const at=(position:string)=>{const species=identity[position];if(!species||!position.startsWith(own))return null;return {species,record:out[base(species)]??={moves:new Set()}};};
  for(const e of game.events){
    if(['switch','drag','replace','detailschange'].includes(e.type)){const species=e.args[1]?.split(',')[0];if(species)identity[e.args[0]]=species;continue;}
    const from=e.args.find(a=>a.startsWith('[from]'));
    if(e.type==='move'&&!from){const hit=at(e.args[0]);if(hit&&e.args[1]!=='Struggle')hit.record.moves.add(e.args[1]);}
    if((e.type==='-item'||e.type==='-enditem')&&!from?.startsWith('[from] move:')){const hit=at(e.args[0]);if(hit)hit.record.item??=e.args[1];}
    if(e.type==='-mega'){const hit=at(e.args[0]);if(hit&&e.args[2])hit.record.item=e.args[2];}
    // An ability belongs to the [of] Pokémon when present, otherwise to the subject. Mega forms change ability.
    const ability=e.type==='-ability'?{owner:e.args[0],name:e.args[1]}:from?.startsWith('[from] ability: ')?{owner:e.args.find(a=>a.startsWith('[of] '))?.slice(5)??e.args[0],name:from.slice(16)}:null;
    if(ability){const hit=at(ability.owner);if(hit&&!/-Mega/.test(hit.species))hit.record.ability??=ability.name;}
  }
  return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,{moves:[...v.moves],...v.item?{item:v.item}:{},...v.ability?{ability:v.ability}:{}}]));
}
// Merge observations; null when they cannot be one set (more than four moves, or a different item/ability).
export function mergeObservations(a:Record<string,Observation>,b:Record<string,Observation>):Record<string,Observation>|null{
  const out:Record<string,Observation>={...a};
  for(const [species,o] of Object.entries(b)){const prev=out[species];if(!prev){out[species]=o;continue;}
    const moves=[...new Set([...prev.moves,...o.moves])];if(moves.length>4)return null;
    if(prev.item&&o.item&&prev.item!==o.item)return null;if(prev.ability&&o.ability&&prev.ability!==o.ability)return null;
    out[species]={moves,...(prev.item??o.item)?{item:prev.item??o.item}:{},...(prev.ability??o.ability)?{ability:prev.ability??o.ability}:{}};}
  return out;
}
// Chronological greedy clustering: each cluster is a set of games consistent with one six-set configuration.
export function clusterGames(games:Game[]){
  const clusters:{games:Game[];observed:Record<string,Observation>}[]=[];
  for(const g of [...games].sort((x,y)=>(x.date??x.id).localeCompare(y.date??y.id))){const o=observeGame(g);let placed=false;
    for(const c of clusters){const merged=mergeObservations(c.observed,o);if(merged){c.games.push(g);c.observed=merged;placed=true;break;}}
    if(!placed)clusters.push({games:[g],observed:o});}
  return clusters;
}
export interface BuiltSet {set:PokemonSet;knownMoves:string[];fields:Record<'moves'|'item'|'ability'|'nature'|'statPoints',FieldCertainty>;basis:string;}
// Build a legal working set: observed facts are known; gaps come from the closest saved paste of that
// species, else the PokéBase top set, and are labelled inferred. usedItems enforces item clause.
// What the same roster revealed across all its games, most frequent first. Used before any paste or usage data.
export interface Siblings {moves:string[];items:string[];abilities:string[];}
export function siblingObservations(games:Game[]):Record<string,Siblings>{
  const tally:Record<string,{moves:Record<string,number>;items:Record<string,number>;abilities:Record<string,number>}>={};
  for(const g of games)for(const [species,o] of Object.entries(observeGame(g))){const t=tally[species]??={moves:{},items:{},abilities:{}};for(const m of o.moves)t.moves[m]=(t.moves[m]??0)+1;if(o.item)t.items[o.item]=(t.items[o.item]??0)+1;if(o.ability)t.abilities[o.ability]=(t.abilities[o.ability]??0)+1;}
  const rank=(r:Record<string,number>)=>Object.entries(r).sort((a,b)=>b[1]-a[1]).map(([k])=>k);
  return Object.fromEntries(Object.entries(tally).map(([k,t])=>[k,{moves:rank(t.moves),items:rank(t.items),abilities:rank(t.abilities)}]));
}
export function buildObservedSet(species:string,o:Observation,templates:{label:string;set:PokemonSet}[],meta:MetaSets|null,usedItems:Set<string>,siblings?:Siblings):BuiltSet{
  const same=templates.filter(t=>base(t.set.species)===base(species)).sort((x,y)=>overlap(y.set,o)-overlap(x.set,o));const t=same[0];
  const fill=[...(t?.set.moves??[]),...(meta?.moves.map(m=>m.name)??[])].filter(m=>!o.moves.includes(m)&&dex.moves.get(m).exists);
  fill.sort((a,b)=>Number(b==='Protect')-Number(a==='Protect'));const moves=[...new Set([...o.moves,...(siblings?.moves??[]),...fill])].slice(0,4);
  const itemChoices=[...(siblings?.items??[]),t?.set.item,...(meta?.items.map(i=>i.name)??[])].filter((i):i is string=>!!i&&!usedItems.has(i));
  const item=o.item??itemChoices[0]??'';if(item)usedItems.add(item);
  const metaSpread=meta?.spreads[0];
  const set:PokemonSet={species:dex.species.get(species).name,nature:t?.set.nature??meta?.natures[0]?.name??'Hardy',statPoints:t?.set.statPoints??metaSpread?.statPoints??{hp:32,atk:0,def:0,spa:0,spd:0,spe:0},ability:o.ability??siblings?.abilities[0]??t?.set.ability??meta?.abilities[0]?.name??'',item,moves};
  const gap=t?`the ${t.label} paste`:meta?`the ${meta.population} top set (${meta.period})`:'neutral placeholders';
  return {set,knownMoves:o.moves,fields:{moves:o.moves.length>=4?'known':'inferred',item:o.item?'known':item?'inferred':'unknown',ability:o.ability?'known':'inferred',nature:t||meta?'inferred':'unknown',statPoints:t||metaSpread?'inferred':'unknown'},
    basis:`Observed in replays: ${o.moves.join(', ')||'no moves'}${o.item?`; item ${o.item}`:''}${o.ability?`; ability ${o.ability}`:''}. Unobserved fields inferred first from this roster's other games${siblings?.moves.length?` (${siblings.moves.join(', ')})`:''}, then from ${gap}.`};
}
const overlap=(set:PokemonSet,o:Observation)=>(set.moves??[]).filter(m=>o.moves.includes(m)).length+(o.item&&set.item===o.item?1:0);
