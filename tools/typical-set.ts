// The "most expected" set for a species, used when a slot is swapped: pool shares for ability, item, nature and
// moves; the most common exact spread (pool if it has enough, else PokéBase M-C). Items already on the team are
// skipped (item clause). The result is validated with the Champions rules and labelled with where each part came from.
import {dex} from './mechanics.ts';
import {cleanSet} from './workbench-store.ts';
import {poolSets} from './pool.ts';
import {metaSets,type MetaSets} from './meta-sets.ts';
import {MIN_POOL_SPREADS} from './chat.ts';
import type {PokemonSet} from '../shared/workbench.ts';

export interface TypicalSet {set:PokemonSet;basis:string[];}
const legalMoves=(species:string,moves:string[])=>moves.filter(m=>dex.moves.get(m).exists);
export async function typicalSet(species:string,avoidItems:string[]=[]):Promise<TypicalSet>{
  const name=dex.species.get(species);if(!name.exists)throw new Error(`Unknown species: ${species}`);
  let pool:MetaSets|null=null,spreadSource:MetaSets|null=null;const basis:string[]=[];
  try{pool=await poolSets(name.name);}catch{}
  const poolSpreads=(pool?.spreads??[]).reduce((n,s:any)=>n+(s.count??0),0);
  if(pool&&poolSpreads>=MIN_POOL_SPREADS)spreadSource=pool;else{try{spreadSource=await metaSets(name.name,'pokebase');}catch{}}
  const usage=pool??spreadSource;if(!usage)throw new Error(`No usage data for ${name.name} yet`);
  const avoid=new Set(avoidItems.filter(Boolean));const item=usage.items.find(i=>!avoid.has(i.name)&&dex.items.get(i.name).exists)?.name??'';
  const ability=usage.abilities.find(a=>dex.abilities.get(a.name).exists)?.name??Object.values(name.abilities)[0] as string;
  const spread=spreadSource?.spreads[0];const nature=spread?.nature??usage.natures[0]?.name??'Serious';
  const moves=legalMoves(name.name,usage.moves.map(m=>m.name)).slice(0,4);
  const set=cleanSet({species:name.name,ability,item,nature,moves,statPoints:spread?.statPoints??{hp:32,atk:0,def:0,spa:0,spd:0,spe:32}});
  basis.push(`Ability, item, moves: ${usage===pool?'Frontier Brain team pool':usage.population} (${usage.sample??usage.period})${avoid.size&&usage.items[0]&&avoid.has(usage.items[0].name)?`; skipped ${usage.items[0].name} (already on the team)`:''}.`);
  basis.push(spread?`Spread: ${spreadSource===pool?'pool':'PokéBase M-C tournaments'} most common, ${spread.percent}%${spread.nature?'':` with the top nature ${nature}`}.`:'Spread: no published spread found; placeholder 32 HP / 32 Spe.');
  return {set,basis};
}
