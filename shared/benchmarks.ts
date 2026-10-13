// Benchmarks are saved calcs that belong to a Pokémon. Each keeps its full inputs (both sides, field, move), so it
// can be re-run with the Pokémon's current or draft set swapped in. That makes benchmarks work like tests for a
// spread: change the set and every benchmark says whether it still holds.
import type {Benchmark,PokemonSet} from './workbench.ts';

export type Side='attacker'|'defender'|'a';
// Which side of the saved calc is the player's Pokémon. Older benchmarks don't record it, so it is inferred.
export function ownSide(b:Pick<Benchmark,'kind'|'input'>&{side?:Side},species:string):Side{
  if(b.side)return b.side;if(b.kind==='speed')return 'a';
  return b.input?.defender?.species===species&&b.input?.attacker?.species!==species?'defender':'attacker';
}
const CORE=['species','nickname','nature','statPoints','item','ability','moves','gender'] as const;
// The saved inputs with the player's side replaced by `set`, keeping that side's battle conditions (boosts, HP…).
export function withSet(b:Benchmark&{side?:Side},set:PokemonSet){
  const side=ownSide(b,set.species);const input=structuredClone(b.input);const core:any={};for(const k of CORE)if(set[k]!==undefined)core[k]=structuredClone(set[k]);
  const keep=Object.fromEntries(Object.entries(input[side]??{}).filter(([k])=>!(CORE as readonly string[]).includes(k)));input[side]={...keep,...core};return input;
}
export interface Outcome {text:string;low?:number;high?:number;guaranteed?:number;possible?:number;first?:string}
const hitsTo=(pct:number)=>pct>0?Math.ceil(100/pct-1e-9):Infinity;
const ko=(n:number)=>!isFinite(n)?'no KO':n===1?'OHKO':`${n}HKO`;
export function outcome(kind:string,result:any):Outcome{
  if(kind==='speed')return {first:result?.first,text:result?.first==='tie'?'speed tie':result?.first==='a'?'moves first':'moves second'};
  // Two attackers into one target: judged on the combined damage. A second target is shown beside it (the first target decides).
  const [low,high]=(result?.combined?.percentOfMaxHP??result?.percentOfMaxHP)??[0,0];const second=result?.secondTarget?.percentOfMaxHP;const guaranteed=hitsTo(low),possible=hitsTo(high);
  return {low,high,guaranteed,possible,text:`${low.toFixed(1)}–${high.toFixed(1)}% · ${guaranteed===possible?`guaranteed ${ko(guaranteed)}`:`possible ${ko(possible)}`}${second?` · other target ${second.map((v:number)=>v.toFixed(1)).join('–')}%`:''}`};
}
// Does the benchmark still hold? Attacking: it must KO at least as fast. Defending: it must take at least as many
// hits. Speed: the same Pokémon must move first.
export function holds(kind:string,side:Side,saved:Outcome,now:Outcome){
  if(kind==='speed')return saved.first===now.first;
  if(side==='attacker')return now.guaranteed!<=saved.guaranteed!&&now.possible!<=saved.possible!;
  return now.guaranteed!>=saved.guaranteed!&&now.possible!>=saved.possible!;
}
const short=(s:any)=>[s?.nature,s?.species].filter(Boolean).join(' ');
// "Shadow Ball vs Careful Incineroar", "Takes Careful Incineroar's Flare Blitz", "Speed vs Timid Gholdengo".
export function autoTitle(kind:string,side:Side,input:any){
  if(kind==='speed')return `Speed vs ${short(input.b)}${input.trickRoom?' (Trick Room)':''}`;
  const field=[input.field?.weather,input.field?.terrain&&`${input.field.terrain} Terrain`].filter(Boolean).join(', ');
  const extra=input.secondMove?` + ${input.secondAttacker?.species??short(input.attacker)}'s ${input.secondMove}`:input.secondDefender?` and ${short(input.secondDefender)}`:input.moveOptions?.spread===false?' (one target)':'';
  return (side==='attacker'?`${input.move} vs ${short(input.defender)}`:`Takes ${short(input.attacker)}'s ${input.move}`)+extra+(field?` (${field})`:'');
}
