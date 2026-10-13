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

// ---- Multi-Pokémon calcs are saved as their independent single claims, never as a composite benchmark ----
// Side flags that belong to one Pokémon rather than the side; they do not carry over to a second target.
export const PER_POKEMON_SIDE=['isProtected','isFriendGuard','isSeeded','isNightmared','isSaltCured','isForesight','isSwitching'];
export interface SaveRow {key:string;title:string;kind:'speed'|'damage';input:any;side:Side;defaultOn:boolean;savable:boolean;why?:string;cross?:boolean}
const nm=(m:any)=>m.species;
// Four-way order -> one speed benchmark per pair of Pokémon. `order` is the speed-order result; `own` is the index of the
// Pokémon whose page is open (a speed benchmark re-checks that Pokémon against the other one, so only its pairs can be saved
// here). Cross-side pairs are on by default; same-side pairs are optional. Each carries the conditions that produced it.
export function speedPairs(roster:any[],order:any,opts:{trickRoom?:boolean;field?:any;tailwind?:{mine?:boolean;foe?:boolean};own:number}):SaveRow[]{
  const rows:SaveRow[]=[];const row=(i:number)=>order.order.find((o:any)=>o.index===i);const tw=opts.tailwind??{};
  for(let i=0;i<roster.length;i++)for(let j=i+1;j<roster.length;j++){
    const [ai,bi]=j===opts.own?[j,i]:[i,j];const A=roster[ai],B=roster[bi];const ra=row(ai),rb=row(bi);if(!ra||!rb)continue;
    const cross=A.side!==B.side;const involvesOwn=ai===opts.own||bi===opts.own;
    const strip=(m:any)=>{const {side,label,...x}=m;return {...x,tailwind:!!x.tailwind||!!(m.side&&tw[m.side as 'mine'|'foe'])};};
    const input:any={a:strip(A),b:strip(B),trickRoom:!!opts.trickRoom,field:opts.field??{}};
    const conds:string[]=[];
    const tailA=input.a.tailwind,tailB=input.b.tailwind;
    if(tailA&&tailB&&A.side===B.side)conds.push('Tailwind up');else{if(tailA)conds.push(`${A.side==='foe'?'their':'your'} Tailwind up`);if(tailB)conds.push(`${B.side==='foe'?'their':'your'} Tailwind up`);}
    if(opts.trickRoom)conds.push('Trick Room');
    for(const m of [A,B]){
      if(m.paralyzed)conds.push(`${nm(m)} paralysed`);if(m.stage)conds.push(`${nm(m)} ${m.stage>0?'+':''}${m.stage} Speed`);if(m.multiplier&&m.multiplier!==1)conds.push(`${nm(m)} ×${m.multiplier}`);
      if(m.quickClaw)conds.push(`${nm(m)}'s Quick Claw`);if(m.move&&ra.priority!==rb.priority&&((m===A?ra:rb).priority!==0))conds.push(`${nm(m)} uses ${m.move}`);}
    if(opts.field?.weather)conds.push(opts.field.weather);if(opts.field?.terrain)conds.push(`${opts.field.terrain} Terrain`);
    const prio=ra.priority!==rb.priority,brk=ra.bracket!==rb.bracket;
    const verdict=ra.rank===rb.rank?'ties with':ra.rank<rb.rank?(prio||brk||opts.trickRoom?'moves before':'outspeeds'):(prio||brk||opts.trickRoom?'moves after':'is outsped by');
    const first=`${A.side==='foe'?'Their':'Your'} ${nm(A)}`,second=`${B.side==='foe'?'their':'your'} ${nm(B)}`;
    const title=`${first} ${verdict} ${second}${conds.length?` (${conds.join(', ')})`:''} · from a four-way order`.slice(0,200);
    rows.push({key:`${ai}-${bi}`,title,kind:'speed',input,side:'a',cross,defaultOn:cross&&involvesOwn,savable:involvesOwn,why:involvesOwn?undefined:"Doesn't involve this Pokémon: save it from the page of the Pokémon it is about."});
  }
  return rows;
}
// Spread move into both targets -> one damage benchmark per target, each judged on its own target. `own` says whether the
// open Pokémon is the attacker (then both targets can be saved here); a second target that is the player's own Pokémon belongs
// to that Pokémon's page.
export function targetRows(input:any,opts:{outgoing:boolean}):SaveRow[]{
  if(!input?.secondDefender)return [];
  const {secondDefender,secondDefenderSide,...single}=input;
  const first:SaveRow={key:'target-1',kind:'damage',side:opts.outgoing?'attacker':'defender',input:single,defaultOn:true,savable:true,title:`${input.move} vs ${[input.defender?.nature,input.defender?.species].filter(Boolean).join(' ')} · first target of a spread move`};
  const side=single.field?.defenderSide??{};
  const secondInput={...single,defender:secondDefender,field:{...single.field,defenderSide:secondDefenderSide??Object.fromEntries(Object.entries(side).filter(([k])=>!PER_POKEMON_SIDE.includes(k)))}};
  const second:SaveRow={key:'target-2',kind:'damage',side:opts.outgoing?'attacker':'defender',input:secondInput,defaultOn:true,savable:opts.outgoing,why:opts.outgoing?undefined:"The second target is another of your Pokémon: save it from that Pokémon's page.",
    title:`${input.move} vs ${[secondDefender?.nature,secondDefender?.species].filter(Boolean).join(' ')} · second target of ${input.move}`};
  return [first,second];
}
