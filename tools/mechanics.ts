import calc from '@smogon/calc';
import {getFinalSpeed} from '@smogon/calc/dist/mechanics/util.js';
import ps from 'pokemon-showdown';
import {id} from './io.ts';
import {PER_POKEMON_SIDE} from '../shared/benchmarks.ts';

export const STATS = ['hp','atk','def','spa','spd','spe'] as const;
export type Stat = typeof STATS[number];
export type Points = Record<Stat,number>;
export interface SetInput {species: string; nickname?:string; nature?: string; statPoints?: Partial<Points>; ability?:string; item?:string; moves?:string[]; boosts?:Partial<Points>; status?:string; curHP?:number; abilityOn?:boolean; alliesFainted?:number; gender?:string;}
export const FORMAT = 'gen9championsvgc2026regmc';
export const dex = ps.Dex.mod('champions');
// A species' identity for usage and roster matching: Megas and other battle forms count as their base species, but a
// regional form is its own Pokémon (Arcanine-Hisui is not Arcanine; Tauros-Paldea-Aqua is Tauros-Paldea).
export function speciesKey(name:string):string{const s=dex.species.get(name);const base=s.baseSpecies||name;
  const region=/(^|-)(Alola|Galar|Hisui|Paldea)(-|$)/.exec(s.forme?String(s.forme).replace(/^/,'-'):'');return region?`${base}-${region[2]}`:base;}
export const generation = calc.Generations.get(0);
export const VERSIONS = {calculator:'@smogon/calc@0.12.0',showdown:'c046106cbe075931b1ff8d8b800ff5be47a85f96',mechanics:'native-champions-0',format:FORMAT};

export function points(input: Partial<Points> = {}): Points {
  for(const k of Object.keys(input))if(!STATS.includes(k as Stat))throw new Error(`Unknown stat ${k}`);
  const result = Object.fromEntries(STATS.map(s=>[s,input[s]??0])) as Points;
  for(const [s,v] of Object.entries(result))if(!Number.isInteger(v)||v<0||v>32)throw new Error(`${s}: Champions points must be integers 0–32`);
  if(Object.values(result).reduce((a,b)=>a+b,0)>66)throw new Error('Champions budget exceeded: maximum 66 SP');
  return result;
}
export function species(name: string) {
  const p=dex.species.get(name); if(!p.exists)throw new Error(`Unknown Champions species: ${name}`);if(p.isNonstandard)throw new Error(`${p.name} is not available in the pinned Champions M-C roster`); return p;
}
export function finalStats(set: SetInput): Points {
  const sp=points(set.statPoints); const p=species(set.species); const nature=dex.natures.get(set.nature??'Serious');
  if(!nature.exists)throw new Error(`Unknown nature: ${set.nature}`);
  return Object.fromEntries(STATS.map(s=>[s,s==='hp'?p.baseStats.hp+sp.hp+75:Math.floor((p.baseStats[s]+sp[s]+20)*(nature.plus===s?110:nature.minus===s?90:100)/100)])) as Points;
}
export function pokemon(set: SetInput) {
  const p=species(set.species); const sp=points(set.statPoints); const stats=finalStats(set);
  const found=generation.species.get(id(p.name) as any);
  if(!found)throw new Error(`Calculator does not support ${p.name}; no fallback to SV`);
  if(JSON.stringify(found.baseStats)!==JSON.stringify(p.baseStats) && STATS.some(s=>found.baseStats[s]!==p.baseStats[s]))throw new Error(`Calculator/Showdown base stat disagreement for ${p.name}`);
  if(JSON.stringify(found.types)!==JSON.stringify(p.types))throw new Error(`Calculator/Showdown type disagreement for ${p.name}`);
  const ability=set.ability??p.abilities[0];
  if(!generation.abilities.get(id(ability) as any))throw new Error(`Unsupported ability: ${ability}`);
  if(set.item&&!generation.items.get(id(set.item) as any))throw new Error(`Unsupported item: ${set.item}`);
  if(set.status&&!['slp','psn','brn','frz','par','tox'].includes(set.status))throw new Error('Unknown status code');
  if(set.abilityOn!==undefined&&typeof set.abilityOn!=='boolean')throw new Error('Ability activation must be boolean');
  if(set.alliesFainted!==undefined&&(!Number.isInteger(set.alliesFainted)||set.alliesFainted<0||set.alliesFainted>3))throw new Error('VGC alliesFainted must be 0–3');
  if(set.boosts)for(const [s,b]of Object.entries(set.boosts))if(s==='hp'||!STATS.includes(s as Stat)||!Number.isInteger(b)||b!< -6||b!>6)throw new Error('Boosts must use non-HP stats and integer stages -6..6');
  if(set.curHP!==undefined&&(!Number.isInteger(set.curHP)||set.curHP<1||set.curHP>stats.hp))throw new Error('curHP must be a living exact HP value');
  const result=new calc.Pokemon(generation,p.name,{nature:set.nature as any,evs:sp,ability:ability as any,item:set.item as any,boosts:set.boosts,status:set.status as any,curHP:set.curHP,abilityOn:set.abilityOn,alliesFainted:set.alliesFainted,gender:set.gender as any});
  // Upstream calculate clones its inputs. Keep integer nature rounding on clones too.
  function exact(p: typeof result): typeof result {
    for(const s of STATS){p.rawStats[s]=stats[s];p.stats[s]=stats[s];}
    if(set.curHP===undefined)p.originalCurHP=stats.hp;
    const clone=p.clone.bind(p);p.clone=()=>exact(clone());return p;
  }
  return exact(result);
}

export interface CalcInput {attacker:SetInput;defender:SetInput;move:string;field?:Record<string,any>;moveOptions?:Record<string,any>;secondDefender?:SetInput;secondDefenderSide?:Record<string,boolean>;}
const SPREAD_TARGETS=['allAdjacent','allAdjacentFoes'];
// Held items that act between two hits in a turn (berries, Focus Sash, Weakness Policy, Air Balloon, Red Card…): a combined
// two-attack calc would need battle sequencing, so those are reported as unsupported instead of approximated.
const midTurnItem=(name?:string)=>{if(!name)return false;const i:any=dex.items.get(name);return !!i.exists&&(i.isBerry||['onDamage','onDamagingHit','onUpdate','onAfterMoveSecondary','onAfterSubDamage'].some(k=>k in i));};
function rollList(damage: number | number[] | number[][]):number[] {
  if(typeof damage==='number')return [damage];
  return damage.some(Array.isArray)?(damage as number[][]).flat():damage as number[];
}
// Exact distribution of a total when each hit rolls its own damage independently (as in battle): sum -> probability.
type Dist=Map<number,number>;
const distOf=(rolls:number[]):Dist=>{const d:Dist=new Map();for(const r of rolls)d.set(r,(d.get(r)??0)+1/rolls.length);return d;};
const convolve=(a:Dist,b:Dist):Dist=>{const out:Dist=new Map();for(const [x,p] of a)for(const [y,q] of b)out.set(x+y,(out.get(x+y)??0)+p*q);return out;};
const chanceAtLeast=(d:Dist,hp:number)=>[...d].reduce((n,[v,p])=>n+(v>=hp?p:0),0);
// Moves whose power depends on battle state Champions doesn't track. Each takes one plain input; when it's missing the
// base state is used and stated in the assumptions (never guessed silently).
export const contextMoves:Record<string,{field:string;label:string;max?:number;power:(v:any)=>number;base:string}>={
  'Rage Fist':{field:'timesHit',label:'Times the user has been hit (0–6)',max:6,power:n=>Math.min(350,50+50*(n??0)),base:'not hit yet (50 BP)'},
  'Last Respects':{field:'faintedAllies',label:'Fainted allies (0–3)',max:3,power:n=>50+50*(n??0),base:'no fainted allies (50 BP)'},
  'Stomping Tantrum':{field:'lastMoveFailed',label:"The user's last move failed",power:b=>b?150:75,base:'last move did not fail (75 BP)'},
  'Avalanche':{field:'hitFirst',label:'The target hit the user first this turn',power:b=>b?120:60,base:'not hit first (60 BP)'},
  'Assurance':{field:'targetDamaged',label:'The target was already damaged this turn',power:b=>b?120:60,base:'target not yet damaged (60 BP)'},
  'Payback':{field:'movesLast',label:'The user moves after the target',power:b=>b?100:50,base:'moves before the target (50 BP)'},
};
export function damage(input: CalcInput) {
  const m=dex.moves.get(input.move); const cm=generation.moves.get(id(input.move) as any);
  if(!m.exists||!cm)throw new Error(`Unsupported move: ${input.move}`);
  if(m.basePower!==cm.basePower||m.type!==cm.type||m.category!==cm.category)throw new Error(`Move data disagreement: ${m.name}`);
  if(m.category==='Status')throw new Error('Status moves have no attack damage roll');
  const conditional=['Return','Frustration','Trump Card','Revenge','Retaliate','Pursuit','Rollout','Ice Ball','Magnitude','Present','Natural Gift'];
  if(conditional.includes(m.name)&&input.moveOptions?.basePower===undefined)throw new Error(`${m.name} requires explicit moveOptions.basePower and documented context`);
  if(m.name==='Fling'&&!input.attacker.item)throw new Error('Fling requires the actual held item');
  if(input.field&&Object.keys(input.field).some(k=>!['gameType','weather','terrain','isMagicRoom','isWonderRoom','isGravity','isAuraBreak','isFairyAura','isDarkAura','isBeadsOfRuin','isSwordOfRuin','isTabletsOfRuin','isVesselOfRuin','attackerSide','defenderSide'].includes(k)))throw new Error('Unknown field option; use calculator Field names, not implied prose conditions');
  if(input.field?.gameType&&!['Singles','Doubles'].includes(input.field.gameType))throw new Error('gameType must be Singles or Doubles');
  if(input.field?.weather&&!['Sand','Sun','Rain','Hail','Snow','Harsh Sunshine','Heavy Rain','Strong Winds'].includes(input.field.weather))throw new Error('Unknown calculator weather');
  if(input.field?.terrain&&!['Electric','Grassy','Psychic','Misty'].includes(input.field.terrain))throw new Error('Unknown calculator terrain');
  const sideKeys=['spikes','steelsurge','vinelash','wildfire','cannonade','volcalith','isSR','isReflect','isLightScreen','isProtected','isSeeded','isNightmared','isSaltCured','isForesight','isCharge','isTailwind','isHelpingHand','isFlowerGift','isPowerTrick','isFriendGuard','isAuroraVeil','isBattery','isPowerSpot','isSteelySpirit','isSwitching'];
  for(const side of [input.field?.attackerSide,input.field?.defenderSide])if(side&&Object.keys(side).some(k=>!sideKeys.includes(k)))throw new Error('Unknown side option; e.g. screens use isReflect/isLightScreen');
  if(input.moveOptions&&Object.keys(input.moveOptions).some(k=>!['basePower','isCrit','timesUsed','timesUsedWithMetronome','hits','context','spread'].includes(k)))throw new Error('Unsupported move option; Champions excludes Z/Max moves and arbitrary data overrides');
  for(const set of [input.attacker,input.defender]) {
    const p=species(set.species); const a=set.ability??p.abilities[0];
    if(a==='Supreme Overlord'&&set.alliesFainted===undefined)throw new Error('Supreme Overlord requires alliesFainted');
  }
  const attacker=pokemon(input.attacker), defender=pokemon(input.defender);
  const {basePower:explicitPower,context,hits,spread,...options}=input.moveOptions??{};const notes:string[]=[];
  // Spread moves: Doubles reduces damage to 0.75x when the move has more than one target. `spread:false` is the move hitting
  // one target (the partner is Protected, fainted or untargetable), so there is no reduction; absent means both targets.
  // Expanding Force becomes a spread move (both foes, so the 0.75x applies) in Psychic Terrain when the user is grounded.
  const expanding=m.name==='Expanding Force'&&input.field?.terrain==='Psychic'&&(input.field?.gameType??'Doubles')==='Doubles';
  const spreadMove=SPREAD_TARGETS.includes(m.target)||expanding;const doubles=(input.field?.gameType??'Doubles')==='Doubles';
  if(spread!==undefined){if(typeof spread!=='boolean')throw new Error('spread must be true (hits both targets) or false (hits one)');
    if(!spreadMove)throw new Error(`${m.name} hits one target; the spread option applies only to moves that can hit both opposing Pokémon`);}
  const reduced=spreadMove&&doubles&&spread!==false;
  if(expanding&&spread===false)throw new Error('Expanding Force in Psychic Terrain always hits both opposing Pokémon in this calculator, so it cannot be calculated as hitting one target.');
  if(expanding)notes.push('Expanding Force: in Psychic Terrain it hits both opposing Pokémon, so the 0.75x spread reduction applies (the calculator also needs the user grounded for the boost).');
  if(spreadMove)notes.push(!doubles?`${m.name}: Singles has one target, so no spread reduction.`:spread===false?`${m.name}: hits one target (partner Protected, fainted or untargetable), so no 0.75x spread reduction.`:`${m.name}: spread move hitting both targets in Doubles, 0.75x${m.target==='allAdjacent'?'; it also hits the user\'s ally, which is not calculated unless supplied as the second target':''}. Set “hits one target” if the other target is out.`);
  if(explicitPower!==undefined&&!conditional.includes(m.name))throw new Error('Base-power override only allowed for untracked contextual moves; native dynamic moves calculate power from their supplied state');
  if(explicitPower!==undefined&&(!Number.isInteger(explicitPower)||explicitPower<1))throw new Error('Explicit basePower must be a positive integer');
  let basePower=explicitPower;const ctx=contextMoves[m.name];
  if(ctx){const v=context?.[ctx.field];if(typeof v==='number'&&(!Number.isInteger(v)||v<0||v>(ctx.max??99)))throw new Error(`${ctx.label}: out of range`);basePower=ctx.power(v);notes.push(v===undefined?`${m.name}: assumed ${ctx.base}; set “${ctx.label}” for other states.`:`${m.name}: ${basePower} BP from ${ctx.label.toLowerCase()} = ${v===true?'yes':v===false?'no':v}.`);}
  // Multi-hit: the hit count is explicit when it varies (default as Showdown: 3 for 2–5 moves, more with Skill Link/Loaded Dice).
  const range=Array.isArray(m.multihit)?m.multihit:m.multihit?[m.multihit,m.multihit]:null;
  if(hits!==undefined){if(!range)throw new Error(`${m.name} is not a multi-hit move`);if(!Number.isInteger(hits)||hits<1||hits>range[1])throw new Error(`${m.name} hits 1–${range[1]} times`);}
  const make=(h?:number)=>new calc.Move(generation,m.name,{...options,...(h!==undefined?{hits:h}:{}),overrides:basePower===undefined&&spread!==false?options.overrides:{...options.overrides,...basePower!==undefined?{basePower}:{},...spread===false?{target:'normal'}:{}}} as any);
  const field=new calc.Field({gameType:'Doubles',...input.field} as any);
  let move=make(hits);let result:any;
  try{result=calc.calculate(generation,attacker,defender,move,field);}
  catch(e){// The calculator rejects multi-hit moves into an immunity; confirm the single hit does 0 and report 0.
    const single=calc.calculate(generation,attacker,defender,make(1),field);if(rollList(single.damage as any).some(r=>r>0))throw e;result=single;move=make(1);}
  const nested=Array.isArray(result.damage)&&(result.damage as any[]).some(Array.isArray);
  const perHit:number[][]=nested?result.damage as number[][]:[rollList(result.damage)];
  const total=perHit.reduce((d,h)=>convolve(d,distOf(h)),new Map([[0,1]]) as Dist);
  const hp=defender.curHP();
  // For a single hit these are the 16 rolls; for several hits, the total when every hit takes the same roll (as Showdown shows).
  const rolls=perHit[0].map((_,i)=>perHit.reduce((n,h)=>n+h[i],0));
  if(perHit.length>1){notes.push(`${m.name}: ${perHit.length} hits${range&&range[0]!==range[1]&&hits===undefined?` (calculator default; ${range[0]}–${range[1]} possible)`:''}, each rolling independently; KO chance is exact over all roll combinations and assumes every hit connects.`);}
  const out:any={versions:VERSIONS,input,attackerStats:finalStats(input.attacker),defenderStats:finalStats(input.defender),rolls,range:[Math.min(...rolls),Math.max(...rolls)],percentOfMaxHP:[Math.min(...rolls)/defender.maxHP()*100,Math.max(...rolls)/defender.maxHP()*100],koChanceOnHit:chanceAtLeast(total,hp),hits:perHit.length,perHit:perHit.length>1?perHit:undefined,spread:{spreadMove,hitsBothTargets:reduced,reduction:reduced?0.75:null},description:Math.max(...rolls)===0?`${input.attacker.species} using ${m.name} deals 0 damage to ${input.defender.species} under the supplied conditions.`:result.desc(),defaults:{weather:input.field?.weather??null,terrain:input.field?.terrain??null,attackerHP:attacker.curHP(),defenderHP:defender.curHP(),attackerStatus:input.attacker.status??'',defenderStatus:input.defender.status??''},assumptions:[...notes,'Damage/KO probability is conditional on the attack connecting. Exact opponent set and all field conditions are supplied assumptions. Missing HP means full, missing status means healthy, missing weather/terrain means absent. Default Intimidate/seed/charge-move activation follows the calculator; record an already-applied boost explicitly and check against Showdown for repeated entry effects.']};
  const slim=(r:any)=>({defender:r.input.defender,defenderStats:r.defenderStats,rolls:r.rolls,range:r.range,percentOfMaxHP:r.percentOfMaxHP,koChanceOnHit:r.koChanceOnHit,hits:r.hits,perHit:r.perHit,description:r.description,defaults:r.defaults,assumptions:r.assumptions});
  if(input.secondDefender){
    // Second target: the same spread move on the other opposing Pokémon, each target rolling independently.
    if(!spreadMove)throw new Error(`${m.name} hits one target; a second target only applies to spread moves`);
    if(!doubles)throw new Error('A second target needs Doubles');
    if(spread===false)throw new Error('“Hits one target” and a second target contradict each other');
    const f:any={...input.field},side=input.field?.defenderSide??{};
    f.defenderSide=input.secondDefenderSide??Object.fromEntries(Object.entries(side).filter(([k])=>!PER_POKEMON_SIDE.includes(k)));
    const second=damage({...input,defender:input.secondDefender,field:f,secondDefender:undefined,secondDefenderSide:undefined});
    out.secondTarget=slim(second);
    out.secondTarget.assumptions=[input.secondDefenderSide?'Second target uses the supplied secondDefenderSide.':`Second target uses the same side-wide conditions (screens, Tailwind); per-Pokémon ones (${PER_POKEMON_SIDE.join(', ')}) are not carried over unless given in secondDefenderSide.`,...second.assumptions.slice(0,-1)];
  }
  Object.defineProperty(out,'distribution',{value:total,enumerable:false});
  return out;
}

export interface SpeedInput {a:SetInput & {stage?:number;tailwind?:boolean;paralyzed?:boolean;multiplier?:number;priority?:number;move?:string;quickClaw?:boolean};b:SpeedInput['a'];trickRoom?:boolean;field?:{weather?:string;terrain?:string};}
// Effective Speed on the pinned calculator's own rules (getFinalSpeed): stat stage, Tailwind, weather and terrain
// abilities (Swift Swim, Chlorophyll, Sand Rush, Slush Rush, Surge Surfer), Unburden, Quick Feet, Protosynthesis/Quark
// Drive, Choice Scarf and Iron Ball, then paralysis. An explicit multiplier is applied on top for anything else.
export function effectiveSpeed(set:SpeedInput['a'],field:SpeedInput['field']={}) {
  const stage=set.stage??0;if(!Number.isInteger(stage)||stage< -6||stage>6)throw new Error('Speed stage must be -6..6');
  const multiplier=set.multiplier??1;if(!Number.isFinite(multiplier)||multiplier<=0)throw new Error('Speed multiplier must be positive');
  const mon=pokemon({...set,boosts:{...set.boosts,spe:stage},status:set.paralyzed?'par':set.status});
  const f=new calc.Field({gameType:'Doubles',weather:field?.weather as any,terrain:field?.terrain as any} as any);
  const side=new calc.Side({isTailwind:!!set.tailwind} as any);
  const v=Math.floor(getFinalSpeed(generation as any,mon,f,side)*multiplier);
  return Math.max(1,Math.min(10000,v));
}
// Priority from the move and ability: the move's own bracket, +1 for Prankster on status moves, +1 for Gale Wings on
// Flying moves at full HP, +3 for Triage on healing moves. An explicit priority overrides it.
export function movePriority(set:SpeedInput['a']){
  if(set.priority!==undefined)return set.priority;if(!set.move)return 0;const m=dex.moves.get(set.move);if(!m.exists)throw new Error(`Unknown move ${set.move}`);
  const ability=id(set.ability??'');let p=m.priority??0;
  if(ability==='prankster'&&m.category==='Status')p+=1;
  if(ability==='galewings'&&m.type==='Flying'&&(set.curHP===undefined||set.curHP>=finalStats(set).hp))p+=1;
  if(ability==='triage'&&(m.flags as any)?.heal)p+=3;
  return p;
}
// Within a priority bracket: Quick Claw/Custap (when they activate) go first; Lagging Tail, Full Incense and Stall go last.
const bracket=(set:SpeedInput['a'])=>{const item=id(set.item??''),ability=id(set.ability??'');if(set.quickClaw)return 1;if(item==='laggingtail'||item==='fullincense'||ability==='stall')return -1;return 0;};
export function speed(input:SpeedInput) {
  const a=effectiveSpeed(input.a,input.field),b=effectiveSpeed(input.b,input.field);const pa=movePriority(input.a),pb=movePriority(input.b);
  if([pa,pb].some(p=>!Number.isInteger(p)||p< -7||p>7))throw new Error('Move priority must be an integer -7..7');
  const ba=bracket(input.a),bb=bracket(input.b);
  const order=pa!==pb?(pa>pb?'a':'b'):ba!==bb?(ba>bb?'a':'b'):a===b?'tie':(input.trickRoom?a<b:a>b)?'a':'b';
  const w=input.field?.weather,t=input.field?.terrain;const why=pa!==pb?'priority':ba!==bb?'item or ability order':'speed';
  return {a,b,priorityA:pa,priorityB:pb,first:order,decidedBy:why,trickRoom:!!input.trickRoom,versions:VERSIONS,assumptions:`Speed from the calculator's rules: stages, Tailwind, ${w?w+' ':''}${t?t+' Terrain ':''}weather/terrain abilities, Unburden, Choice Scarf, Iron Ball and paralysis. Priority from the move and Prankster/Gale Wings/Triage; Quick Claw/Custap when set; Lagging Tail, Full Incense and Stall move last in their bracket.`};
}

// The sets in the shape the validator and the Showdown exporter read. No legality checks: a team that stopped being
// legal (a regulation ended, a rule changed) must still be exportable and duplicable so the player can revise it.
export function teamSets(sets:SetInput[]) {
  return sets.map(s=>({name:s.nickname??s.species,species:species(s.species).name,item:s.item??'',ability:s.ability??species(s.species).abilities[0],moves:s.moves??[],nature:s.nature??'Serious',evs:points(s.statPoints),level:50,gender:s.gender??'',ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}}));
}

// Four-way order: your two leads and their two, each with its chosen move. Same per-Pokémon pieces as speed() (effective
// Speed, move priority, the Quick Claw / Lagging Tail bracket), sorted: priority, then bracket, then Speed (Trick Room
// reversed). Pokémon with identical keys are tied and shown as one rank. Mid-turn changes are flagged, never simulated.
export type SpeedOrderMon=SpeedInput['a']&{side?:'mine'|'foe';label?:string};
export interface SpeedOrderInput {pokemon:SpeedOrderMon[];trickRoom?:boolean;field?:SpeedInput['field'];tailwind?:{mine?:boolean;foe?:boolean};}
export function speedOrder(input:SpeedOrderInput) {
  const list=input?.pokemon;if(!Array.isArray(list)||list.length<2||list.length>4)throw new Error('Speed order takes 2–4 Pokémon (your two leads and their two)');
  const rows=list.map((m,index)=>{
    const tw=m.side?input.tailwind?.[m.side]:undefined;const set={...m,tailwind:m.tailwind||!!tw};
    const speed=effectiveSpeed(set,input.field),priority=movePriority(set),br=bracket(set);
    if(!Number.isInteger(priority)||priority< -7||priority>7)throw new Error('Move priority must be an integer -7..7');
    return {index,side:m.side??null,label:m.label??m.nickname??m.species,species:m.species,move:m.move??null,speed,priority,bracket:br,tailwind:set.tailwind,paralyzed:!!m.paralyzed,stage:m.stage??0,set};
  });
  const cmp=(x:typeof rows[0],y:typeof rows[0])=>y.priority-x.priority||y.bracket-x.bracket||(input.trickRoom?x.speed-y.speed:y.speed-x.speed);
  const sorted=[...rows].sort((x,y)=>cmp(x,y)||x.index-y.index);
  const order:any[]=[];let rank=0;
  for(const [i,r] of sorted.entries()){
    const prev=sorted[i-1];if(prev&&cmp(prev,r)!==0)rank++;
    const tiedWith=sorted.filter(o=>o!==r&&cmp(o,r)===0).map(o=>o.index);
    const decidedBy=!prev?'first':cmp(prev,r)===0?'tie':prev.priority!==r.priority?'priority':prev.bracket!==r.bracket?'item or ability order':'speed';
    order.push({position:i+1,rank:rank+1,index:r.index,side:r.side,label:r.label,species:r.species,move:r.move,speed:r.speed,priority:r.priority,bracket:r.bracket===1?'first in bracket (Quick Claw / Custap)':r.bracket===-1?'last in bracket (Lagging Tail / Full Incense / Stall)':'normal',tied:tiedWith.length>0,tiedWith,decidedBy,tailwind:r.tailwind,paralyzed:r.paralyzed,stage:r.stage});
  }
  const watch:string[]=[];
  const named=(m:string)=>rows.filter(r=>r.move&&id(r.move)===id(m));
  for(const r of named('Tailwind'))watch.push(`${r.label} uses Tailwind this turn: Speed doubles for its side only after it resolves, so slower moves that come after it act at the new Speed. The order above is the state at the start of the turn.`);
  for(const r of named('Trick Room'))watch.push(`${r.label} uses Trick Room this turn (priority -7, so it resolves last): ${input.trickRoom?'Trick Room is already up, so this ends it.':'it reverses the order from the next turn.'} The order above is the state at the start of the turn.`);
  for(const r of named('Quash'))watch.push(`${r.label} uses Quash: its target moves last among the remaining Pokémon this turn, ignoring the order above.`);
  for(const r of named('After You'))watch.push(`${r.label} uses After You: its target moves immediately after it, ignoring the order above.`);
  for(const r of rows){const stone=r.set.item?dex.items.get(r.set.item):null;const megaForm=(stone as any)?.megaStone as Record<string,string>|string|undefined;
    const formName=typeof megaForm==='string'?megaForm:megaForm?.[dex.species.get(r.species).name];
    if(formName){const f=dex.species.get(formName);if(f.exists&&f.name!==dex.species.get(r.species).name){let ifMega:number|undefined;try{ifMega=effectiveSpeed({...r.set,species:f.name,ability:f.abilities[0],priority:undefined,move:r.move??undefined},input.field);}catch{}
      watch.push(`${r.label} holds its Mega Stone: the order above uses ${r.species}; as ${f.name} its Speed is ${ifMega??'not calculable'}, and the order follows the Mega form once it evolves.`);}}}
  const ties=order.filter((o,i)=>o.tied&&order.findIndex(p=>p.rank===o.rank)===i).map(o=>order.filter(p=>p.rank===o.rank).map(p=>p.label));
  return {order,ties,trickRoom:!!input.trickRoom,watch,versions:VERSIONS,assumptions:`Order by priority bracket, then Quick Claw/Custap and Lagging Tail/Full Incense/Stall, then effective Speed (reversed under Trick Room). Speed from the calculator's rules: stages, Tailwind, paralysis, Choice Scarf, Iron Ball, Unburden and weather/terrain abilities${input.field?.weather?` (${input.field.weather})`:''}. Ties are shown as ties (the game flips a coin). State is the start of the turn: Tailwind or Trick Room set, Quash, After You and Mega Evolution this turn are flagged, not simulated.`};
}

export function validateTeam(sets:SetInput[], format=FORMAT) {
  if(![FORMAT,`${FORMAT}bo3`].includes(format))throw new Error('Only configured Champions M-C formats are supported');
  if(sets.length!==6)throw new Error('A VGC team must contain six Pokémon');
  const team=teamSets(sets);
  const errors=new ps.TeamValidator(format).validateTeam(team as any);
  if(errors?.length)throw new Error(`Illegal team:\n${errors.join('\n')}`);
  return team;
}

export function spreadSearch(input:any) {
  const budget=input.budget??66;if(!Number.isInteger(budget)||budget<0||budget>66)throw new Error('Budget must be 0–66');
  const fixed=input.fixedPoints??{};points(fixed);
  const natures:string[]=input.natures??[input.nature??'Serious'];
  if(!Array.isArray(natures)||!natures.length||natures.length>25||natures.some(n=>!dex.natures.get(n).exists))throw new Error('Choose 1–25 valid natures');
  for(const [key,value] of Object.entries(input.minStats??{}))if(!STATS.includes(key as Stat)||!Number.isInteger(value)||Number(value)<0)throw new Error('Minimum stats must be nonnegative integers for known stats');
  const benchmarks=input.benchmarks??[]; const solutions=[];
  if(!Array.isArray(benchmarks)||benchmarks.length>12)throw new Error('Choose up to 12 benchmark constraints');
  for(const b of benchmarks){if(b.survive&&b.direction!=='incoming')throw new Error('Survival goals must be incoming');for(const k of ['minimumDamage','maximumDamage'])if(b[k]!==undefined&&(!Number.isInteger(b[k])||b[k]<0))throw new Error('Damage thresholds must be nonnegative integers');}
  const relevant=new Set<Stat>();
  for(const b of benchmarks){const m=dex.moves.get(b.move);if(!m.exists||m.category==='Status')throw new Error('Invalid benchmark move');
    if(['Body Press','Foul Play','Psyshock','Psystrike','Secret Sword'].includes(m.name))throw new Error('Cross-stat moves require a dedicated search; use manual benchmarks');
    if(b.direction==='outgoing')relevant.add(m.category==='Physical'?'atk':'spa');else if(b.direction==='incoming'){relevant.add('hp');relevant.add(m.category==='Physical'?'def':'spd');}else throw new Error('Benchmark direction must be incoming or outgoing');
  }
  for(const nature of natures){
    const seed:Points=points(fixed);
    for(const s of STATS){if(input.minStats?.[s]!==undefined){let v=seed[s];while(v<=32&&finalStats({...input,nature,statPoints:{[s]:v}})[s]<input.minStats[s])v++;
      if(v>32 || (fixed[s]!==undefined&&v!==fixed[s])){seed[s]=33;break;}seed[s]=v;}}
    if(Object.values(seed).some(v=>v>32)||Object.values(seed).reduce((a,b)=>a+b,0)>budget)continue;
    const free=[...relevant].filter(s=>fixed[s]===undefined);
    if(free.length>3)throw new Error('Search exceeds three free benchmark dimensions; lock stats with fixedPoints or split objectives');
    let best:any=null;
    function visit(index:number,sp:Points){const spent=Object.values(sp).reduce((a,b)=>a+b,0);if(spent>budget||best&&spent>=best.spent)return;
      if(index<free.length){const s=free[index];for(let v=seed[s];v<=32;v++)visit(index+1,{...sp,[s]:v});return;}
      const set={...input,nature,statPoints:sp};const results=[];
      for(const b of benchmarks){const result=damage({attacker:b.direction==='outgoing'?set:b.other,defender:b.direction==='outgoing'?b.other:set,move:b.move,field:b.field,moveOptions:b.moveOptions});
        if(b.survive&&result.range[1]>=pokemon(set).curHP())return;
        if(b.minimumDamage!==undefined&&result.range[0]<b.minimumDamage)return;if(b.maximumDamage!==undefined&&result.range[1]>b.maximumDamage)return;results.push(result);}
      best={nature,statPoints:sp,stats:finalStats(set),spent,unused:budget-spent,benchmarks:results};}
    visit(0,seed);if(best)solutions.push(best);
  }
  return {versions:VERSIONS,solutions,objective:'Minimum points satisfying supplied final-stat and worst-roll damage constraints; no claim of global team optimality.'};
}

// Limitless writes some forms as display names ("Eternal Flower Floette", "Paldean Tauros Aqua Breed"). They are
// rewritten to Showdown's Species-Form spelling only when that name exists and is a form of the named species.
const FORM_WORDS:Record<string,string>={female:'F',male:'M',paldean:'Paldea',alolan:'Alola',galarian:'Galar',hisuian:'Hisui'};
const FORM_FILLER=new Set(['breed','flower','form','forme']);
export function resolveSpecies(raw:string):string|null{
  const name=raw.normalize('NFKD').replace(/\p{M}/gu,'').trim();if(!name)return null;const direct=dex.species.get(name);if(direct.exists)return direct.name;
  const words=name.split(/\s+/);
  for(const [i,w] of words.entries()){const base=dex.species.get(w);if(!base.exists||base.name!==base.baseSpecies)continue;
    const form=words.filter((_,j)=>j!==i&&!FORM_FILLER.has(words[j].toLowerCase())).map(x=>FORM_WORDS[x.toLowerCase()]??x);if(!form.length)continue;
    const candidate=dex.species.get(`${base.name}-${form.join('-')}`);if(candidate.exists&&candidate.baseSpecies===base.name)return candidate.name;}
  return null;
}
