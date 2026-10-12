import calc from '@smogon/calc';
import {getFinalSpeed} from '@smogon/calc/dist/mechanics/util.js';
import ps from 'pokemon-showdown';
import {id} from './io.ts';

export const STATS = ['hp','atk','def','spa','spd','spe'] as const;
export type Stat = typeof STATS[number];
export type Points = Record<Stat,number>;
export interface SetInput {species: string; nickname?:string; nature?: string; statPoints?: Partial<Points>; ability?:string; item?:string; moves?:string[]; boosts?:Partial<Points>; status?:string; curHP?:number; abilityOn?:boolean; alliesFainted?:number; gender?:string;}
export const FORMAT = 'gen9championsvgc2026regmc';
export const dex = ps.Dex.mod('champions');
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

export interface CalcInput {attacker:SetInput;defender:SetInput;move:string;field?:Record<string,any>;moveOptions?:Record<string,any>;secondMove?:string;secondAttacker?:SetInput;secondMoveOptions?:Record<string,any>;}
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
  if(input.moveOptions&&Object.keys(input.moveOptions).some(k=>!['basePower','isCrit','timesUsed','timesUsedWithMetronome','hits','context'].includes(k)))throw new Error('Unsupported move option; Champions excludes Z/Max moves and arbitrary data overrides');
  for(const set of [input.attacker,input.defender]) {
    const p=species(set.species); const a=set.ability??p.abilities[0];
    if(a==='Supreme Overlord'&&set.alliesFainted===undefined)throw new Error('Supreme Overlord requires alliesFainted');
  }
  const attacker=pokemon(input.attacker), defender=pokemon(input.defender);
  const {basePower:explicitPower,context,hits,...options}=input.moveOptions??{};const notes:string[]=[];
  if(explicitPower!==undefined&&!conditional.includes(m.name))throw new Error('Base-power override only allowed for untracked contextual moves; native dynamic moves calculate power from their supplied state');
  if(explicitPower!==undefined&&(!Number.isInteger(explicitPower)||explicitPower<1))throw new Error('Explicit basePower must be a positive integer');
  let basePower=explicitPower;const ctx=contextMoves[m.name];
  if(ctx){const v=context?.[ctx.field];if(typeof v==='number'&&(!Number.isInteger(v)||v<0||v>(ctx.max??99)))throw new Error(`${ctx.label}: out of range`);basePower=ctx.power(v);notes.push(v===undefined?`${m.name}: assumed ${ctx.base}; set “${ctx.label}” for other states.`:`${m.name}: ${basePower} BP from ${ctx.label.toLowerCase()} = ${v===true?'yes':v===false?'no':v}.`);}
  // Multi-hit: the hit count is explicit when it varies (default as Showdown: 3 for 2–5 moves, more with Skill Link/Loaded Dice).
  const range=Array.isArray(m.multihit)?m.multihit:m.multihit?[m.multihit,m.multihit]:null;
  if(hits!==undefined){if(!range)throw new Error(`${m.name} is not a multi-hit move`);if(!Number.isInteger(hits)||hits<1||hits>range[1])throw new Error(`${m.name} hits 1–${range[1]} times`);}
  const make=(h?:number)=>new calc.Move(generation,m.name,{...options,...(h!==undefined?{hits:h}:{}),overrides:basePower===undefined?options.overrides:{...options.overrides,basePower}} as any);
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
  const out:any={versions:VERSIONS,input,attackerStats:finalStats(input.attacker),defenderStats:finalStats(input.defender),rolls,range:[Math.min(...rolls),Math.max(...rolls)],percentOfMaxHP:[Math.min(...rolls)/defender.maxHP()*100,Math.max(...rolls)/defender.maxHP()*100],koChanceOnHit:chanceAtLeast(total,hp),hits:perHit.length,perHit:perHit.length>1?perHit:undefined,description:Math.max(...rolls)===0?`${input.attacker.species} using ${m.name} deals 0 damage to ${input.defender.species} under the supplied conditions.`:result.desc(),defaults:{weather:input.field?.weather??null,terrain:input.field?.terrain??null,attackerHP:attacker.curHP(),defenderHP:defender.curHP(),attackerStatus:input.attacker.status??'',defenderStatus:input.defender.status??''},assumptions:[...notes,'Damage/KO probability is conditional on the attack connecting. Exact opponent set and all field conditions are supplied assumptions. Missing HP means full, missing status means healthy, missing weather/terrain means absent. Default Intimidate/seed/charge-move activation follows the calculator; record an already-applied boost explicitly and check against Showdown for repeated entry effects.']};
  if(input.secondMove){
    const defensiveAbility=input.defender.ability??species(input.defender.species).abilities[0];
    if(input.defender.item||['Stamina','Weak Armor','Multiscale','Shadow Shield','Disguise','Ice Face','Color Change','Anger Shell','Berserk','Emergency Exit','Wimp Out','Sand Spit','Seed Sower'].includes(defensiveAbility))throw new Error('Combined attacks with item/HP/stage/field triggers require battle sequencing, unsupported');
    const second=damage({...input,attacker:input.secondAttacker??input.attacker,move:input.secondMove,moveOptions:input.secondMoveOptions,secondMove:undefined});
    const both=convolve(total,second.distribution as Dist);const values=[...both.keys()];
    out.combined={range:[Math.min(...values),Math.max(...values)],koChanceOnBothHits:chanceAtLeast(both,hp),assumptions:'Independent rolls, both attacks connect; no intervening state changes or triggers. Not a sequencing or win probability.'};
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

export function validateTeam(sets:SetInput[], format=FORMAT) {
  if(![FORMAT,`${FORMAT}bo3`].includes(format))throw new Error('Only configured Champions M-C formats are supported');
  if(sets.length!==6)throw new Error('A VGC team must contain six Pokémon');
  const team=sets.map(s=>({name:s.nickname??s.species,species:species(s.species).name,item:s.item??'',ability:s.ability??species(s.species).abilities[0],moves:s.moves??[],nature:s.nature??'Serious',evs:points(s.statPoints),level:50,gender:s.gender??'',ivs:{hp:31,atk:31,def:31,spa:31,spd:31,spe:31}}));
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
