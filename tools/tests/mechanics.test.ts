import {test} from 'node:test';
import assert from 'node:assert/strict';
import ps from 'pokemon-showdown';
import {STATS,finalStats,points,pokemon,damage,speed,speedOrder,spreadSearch,validateTeam,dex,type SetInput} from '../mechanics.ts';
import {importText,exportText,teamImport} from '../teams.ts';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('Champions stat allocation, nature rounding and budget boundaries',()=>{
  assert.deepEqual(finalStats({species:'Rillaboom',nature:'Adamant',statPoints:{hp:32,atk:32,spe:2}}),{hp:207,atk:194,def:110,spa:72,spd:90,spe:107});
  assert.throws(()=>points({atk:33}));assert.throws(()=>points({hp:32,atk:32,spe:3}));assert.throws(()=>points({spe:-1}));assert.throws(()=>points({spe:1.5}));assert.throws(()=>points({spc:1} as any));assert.throws(()=>finalStats({species:'Rillaboom',nature:'made up'}));
  assert.throws(()=>finalStats({species:'Flutter Mane'}),/not available/);
  for(const nature of ['Adamant','Modest','Jolly','Quiet','Serious'])for(let sp=0;sp<=32;sp++){
    const set={species:'Rillaboom',nature,statPoints:{atk:sp,spa:32-sp}};
    const p=pokemon(set);assert.deepEqual(p.clone().rawStats,finalStats(set));
    for(const s of STATS)assert.equal(finalStats(set)[s],dex.data.Scripts.statModify.call({trunc:Math.trunc,ruleTable:new Map(),dex},dex.species.get(set.species).baseStats,{...set,evs:points(set.statPoints)},s));
  }
});
test('Saved team versions are immutable and retain validated import/export files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vgc-team-test-'));try{
    await mkdir(join(root,'teams'));const path=join(root,'input.txt');await writeFile(path,exportText(legal));
    await teamImport(path,'sample-v1',undefined,root);const saved=JSON.parse(await readFile(join(root,'teams/sample-v1/team.json'),'utf8'));
    assert.equal(saved.status,'candidate');assert.equal(saved.sets.length,6);const first=await readFile(join(root,'teams/sample-v1/showdown.txt'),'utf8');
    await assert.rejects(()=>teamImport(path,'sample-v1',undefined,root),/EEXIST/);assert.equal(await readFile(join(root,'teams/sample-v1/showdown.txt'),'utf8'),first);
  }finally{await rm(root,{recursive:true});}
});

function simulatorDamage(attacker:SetInput,defender:SetInput,move:string,seed:number,isCrit=false){
  const battle=new ps.Battle({formatid:'gen9championsdoublescustomgame',seed:[seed,2,3,4]});
  const convert=(s:SetInput,moves:string[])=>({species:s.species,name:s.species,nature:s.nature??'Serious',ability:s.ability??dex.species.get(s.species).abilities[0],item:s.item??'',moves,level:50,evs:points(s.statPoints)});
  const partner={species:'Clefable',ability:'Magic Guard',nature:'Serious'};
  battle.setPlayer('p1',{name:'A',team:[convert(attacker,[move]),convert(partner,['Splash'])]});
  battle.setPlayer('p2',{name:'B',team:[convert(defender,['Splash']),convert(partner,['Splash'])]});
  battle.makeChoices('team 12','team 12');
  const before=battle.p2.active[0].hp;const p=battle.p1.active[0];
  for(const s of STATS.filter(s=>s!=='hp'))assert.equal(p.storedStats[s],finalStats(attacker)[s]);
  if(isCrit)battle.p1.active[0].addVolatile('laserfocus');
  battle.makeChoices('move 1 1, move 1','move 1, move 1');
  const line=battle.log.find((l:string)=>l.startsWith('|-damage|p2a:'));
  const after=Number(line?.split('|')[3].split('/')[0]);const crit=battle.log.some((l:string)=>l.startsWith('|-crit|p2a:'));battle.destroy();return {damage:before-after,crit};
}

test('Native Champions damage rolls contain independently simulated damage',()=>{
  const attacker={species:'Rillaboom',nature:'Adamant',ability:'Grassy Surge',statPoints:{atk:32,hp:32,spe:2}};
  const defender={species:'Incineroar',nature:'Impish',ability:'Blaze',statPoints:{hp:32,def:32,spe:2}};
  const calc=damage({attacker,defender,move:'Drain Punch',field:{terrain:'Grassy'}});
  for(let seed=1;seed<=24;seed++){const simulated=simulatorDamage(attacker,defender,'Drain Punch',seed);const expected=simulated.crit?damage({attacker,defender,move:'Drain Punch',field:{terrain:'Grassy'},moveOptions:{isCrit:true}}):calc;assert.ok(expected.rolls.includes(simulated.damage),`simulator damage outside rolls for seed ${seed}`);}
  const critical=damage({attacker,defender,move:'Drain Punch',field:{terrain:'Grassy'},moveOptions:{isCrit:true}});
  assert.ok(critical.rolls.includes(simulatorDamage(attacker,defender,'Drain Punch',42,true).damage));
});

test('Weather, screens, spread damage and Mega data change benchmarks',()=>{
  const attacker={species:'Pelipper',nature:'Modest',ability:'Drizzle',statPoints:{spa:32}};
  const defender={species:'Incineroar',nature:'Careful',ability:'Intimidate',statPoints:{hp:32,spd:32}};
  const base=damage({attacker,defender,move:'Surf'});
  const rain=damage({attacker,defender,move:'Surf',field:{weather:'Rain'}});
  const screens=damage({attacker,defender,move:'Surf',field:{weather:'Rain',defenderSide:{isLightScreen:true}}});
  const singles=damage({attacker,defender,move:'Surf',field:{gameType:'Singles'}});
  assert.ok(rain.range[0]>base.range[0]);assert.ok(screens.range[1]<rain.range[1]);assert.ok(singles.range[0]>base.range[0]);
  assert.equal(finalStats({species:'Salamence-Mega',nature:'Jolly',statPoints:{spe:32}}).spe,189);
  assert.equal(pokemon({species:'Garchomp-Mega-Z'}).ability,'Levitate');
  const weatherBall=damage({attacker,defender,move:'Weather Ball',field:{weather:'Rain'}});assert.ok(weatherBall.range[0]>0);
  assert.throws(()=>damage({attacker,defender,move:'Weather Ball',field:{weather:'Rain'},moveOptions:{basePower:100}}),/override/);
});

test('Speed priority, ties, Tailwind, paralysis and Trick Room',()=>{
  const a={species:'Rillaboom',statPoints:{spe:32}},b={species:'Salamence-Mega',statPoints:{spe:32}};
  assert.equal(speed({a,b}).first,'b');assert.equal(speed({a:{...a,tailwind:true},b}).first,'a');assert.equal(speed({a,b,trickRoom:true}).first,'a');assert.equal(speed({a,b:{...b,paralyzed:true}}).first,'a');assert.equal(speed({a,b:a}).first,'tie');assert.equal(speed({a:{...a,priority:1},b,trickRoom:true}).first,'a');assert.throws(()=>speed({a:{...a,stage:7},b}));
});

test('Four-way speed order: priority, brackets, Tailwind, paralysis, Trick Room and explicit ties',()=>{
  // Level-50 Champions Speed = base + SP + 20 (neutral nature): Rillaboom 85+32+20 = 137, Salamence-Mega 120+32+20 = 172,
  // Incineroar 60+0+20 = 80. Tailwind doubles (160 / 274 / 344), paralysis halves (floor(137/2) = 68).
  const rilla={species:'Rillaboom',statPoints:{spe:32},side:'mine' as const},mega={species:'Salamence-Mega',statPoints:{spe:32},side:'foe' as const},inc={species:'Incineroar',side:'mine' as const},foeInc={species:'Incineroar',side:'foe' as const};
  const labels=(r:any)=>r.order.map((o:any)=>`${o.species}${o.side?.[0]}`);
  // Fake Out (+3) first despite 80 Speed, then 172, 137, then the other 80.
  const a=speedOrder({pokemon:[rilla,mega,{...inc,move:'Fake Out'},foeInc]});
  assert.deepEqual(labels(a),['Incineroarm','Salamence-Megaf','Rillaboomm','Incineroarf']);assert.deepEqual(a.order.map((o:any)=>o.speed),[80,172,137,80]);
  assert.deepEqual(a.order.map((o:any)=>o.priority),[3,0,0,0]);assert.deepEqual(a.order.map((o:any)=>o.decidedBy),['first','priority','speed','speed']);assert.deepEqual(a.ties,[]);
  // Trick Room reverses speed within a bracket only: Fake Out stays first, then 80, 137, 172.
  const tr=speedOrder({pokemon:[rilla,mega,{...inc,move:'Fake Out'},foeInc],trickRoom:true});
  assert.deepEqual(labels(tr),['Incineroarm','Incineroarf','Rillaboomm','Salamence-Megaf']);
  // Two Incineroar at 80 with no priority are one rank and listed as a tie; the tie is explicit on both rows.
  const tie=speedOrder({pokemon:[inc,foeInc,rilla,mega]});
  assert.deepEqual(tie.order.map((o:any)=>o.rank),[1,2,3,3]);assert.deepEqual(tie.ties,[['Incineroar','Incineroar']]);
  assert.ok(tie.order[2].tied&&tie.order[3].tied&&tie.order[2].tiedWith.includes(tie.order[3].index));assert.equal(tie.order[3].decidedBy,'tie');
  // Side Tailwind: Rillaboom 137*2 = 274 beats Salamence 172; their Incineroar 80 stays slow; our Incineroar 80*2 = 160 < 172.
  const tw=speedOrder({pokemon:[rilla,inc,mega,foeInc],tailwind:{mine:true}});
  assert.deepEqual(tw.order.map((o:any)=>o.speed),[274,172,160,80]);assert.deepEqual(labels(tw),['Rillaboomm','Salamence-Megaf','Incineroarm','Incineroarf']);
  // Paralysis halves: Rillaboom 68 falls below both 80s and above nothing.
  assert.equal(speedOrder({pokemon:[{...rilla,paralyzed:true},foeInc]}).order[1].speed,68);
  // Quick Claw (when it activates) goes first in its priority bracket whatever the Speed; Stall goes last (Sableye 50+0+20 = 70,
  // slower than everything here anyway, so it is also last by Speed; under Trick Room it would otherwise be first).
  const qc=speedOrder({pokemon:[{...inc,item:'Quick Claw',quickClaw:true},mega,rilla,{species:'Sableye',ability:'Stall',side:'foe'}]});
  assert.deepEqual(labels(qc),['Incineroarm','Salamence-Megaf','Rillaboomm','Sableyef']);assert.equal(qc.order[0].decidedBy,'first');assert.equal(qc.order[1].decidedBy,'item or ability order');
  assert.equal(speedOrder({pokemon:[inc,{species:'Sableye',ability:'Stall',side:'foe'}],trickRoom:true}).order[0].species,'Incineroar');
  // Items the pinned calculator does not model are rejected, not approximated.
  assert.throws(()=>speedOrder({pokemon:[{...rilla,item:'Lagging Tail'},foeInc]}),/Unsupported item/);
  // Mid-turn changes are flagged, not simulated.
  const watch=speedOrder({pokemon:[{...rilla,move:'Tailwind'},{...inc,move:'After You'},{...mega,move:'Trick Room'},{species:'Alakazam',item:'Alakazite',side:'foe',statPoints:{spe:32}}]}).watch;
  assert.equal(watch.length,4);assert.match(watch.join('\n'),/Tailwind this turn[\s\S]*Trick Room this turn[\s\S]*After You[\s\S]*Alakazam-Mega its Speed is/);
  assert.throws(()=>speedOrder({pokemon:[rilla]}),/2–4/);assert.throws(()=>speedOrder({pokemon:[rilla,mega,inc,foeInc,rilla]}),/2–4/);
  // A pair agrees with speed(): same Speeds and same winner.
  const pair=speedOrder({pokemon:[rilla,mega]});assert.equal(pair.order[0].species,speed({a:rilla,b:mega}).first==='a'?'Rillaboom':'Salamence-Mega');
});

test('Doubles spread: both targets vs one target, the second target, and two attackers into one target',()=>{
  // Level 50. Rillaboom Adamant 32 Atk: (125+32+20)*1.1 = 194. Farigiraf Serious 0 SP: Def 70+20 = 90, HP 120+75 = 195.
  // Rock Slide: BP 75, no STAB, neutral. baseDamage = floor(floor(22*75*194/90)/50)+2 = floor(3556/50)+2 = 73.
  // Hitting one target: rolls floor(73*r/100), r = 85..100 -> 62..73.
  const attacker={species:'Rillaboom',nature:'Adamant',statPoints:{atk:32},ability:'Grassy Surge'},defender={species:'Farigiraf',nature:'Serious',ability:'Armor Tail'};
  const one=damage({attacker,defender,move:'Rock Slide',moveOptions:{spread:false}});
  assert.deepEqual(one.range,[62,73]);assert.equal(one.spread.hitsBothTargets,false);assert.equal(one.spread.reduction,null);
  // Hitting both targets: baseDamage = pokeRound(73*3072/4096) = pokeRound(54.75) = 55; rolls floor(55*r/100) -> 46..55.
  const both=damage({attacker,defender,move:'Rock Slide'});
  assert.deepEqual(both.range,[46,55]);assert.equal(both.spread.hitsBothTargets,true);assert.equal(both.spread.reduction,0.75);
  assert.deepEqual(damage({attacker,defender,move:'Rock Slide',moveOptions:{spread:true}}).rolls,both.rolls);
  // Singles has no reduction at all.
  assert.deepEqual(damage({attacker,defender,move:'Rock Slide',field:{gameType:'Singles'}}).range,[62,73]);
  // Second target: Incineroar Serious 0 SP: Def 90+20 = 110, HP 95+75 = 170; Rock is 2x vs Fire.
  // baseDamage = floor(floor(22*75*194/110)/50)+2 = floor(2910/50)+2 = 60; spread -> 45; rolls floor(45*r/100)*2 -> 76..90.
  const two=damage({attacker,defender,move:'Rock Slide',secondDefender:{species:'Incineroar',nature:'Serious',ability:'Intimidate'}});
  assert.deepEqual(two.range,[46,55]);assert.deepEqual(two.secondTarget.range,[76,90]);assert.equal(two.secondTarget.defenderStats.hp,170);assert.equal(two.secondTarget.defender.species,'Incineroar');
  // Side-wide screens carry to the second target; Friend Guard (one Pokémon's) does not unless given.
  const screens=damage({attacker,defender,move:'Rock Slide',field:{defenderSide:{isReflect:true,isFriendGuard:true}},secondDefender:{species:'Incineroar',nature:'Serious',ability:'Intimidate'}});
  assert.ok(screens.secondTarget.range[1]<90);assert.match(screens.secondTarget.assumptions[0],/not carried over/);
  const guarded=damage({attacker,defender,move:'Rock Slide',secondDefender:{species:'Incineroar',nature:'Serious',ability:'Intimidate'},secondDefenderSide:{isFriendGuard:true}});
  assert.ok(guarded.secondTarget.range[1]<90);
  // Rejections are explicit: single-target moves can't be spread, contradictions, second target with second attacker.
  assert.throws(()=>damage({attacker,defender,move:'Wood Hammer',moveOptions:{spread:true}}),/hits one target/);
  assert.throws(()=>damage({attacker,defender,move:'Wood Hammer',secondDefender:defender}),/only applies to spread moves/);
  assert.throws(()=>damage({attacker,defender,move:'Rock Slide',moveOptions:{spread:false},secondDefender:defender}),/contradict/);
  assert.throws(()=>damage({attacker,defender,move:'Rock Slide',secondDefender:defender,secondMove:'Wood Hammer'}),/Unsupported/);
  assert.throws(()=>damage({attacker,defender,move:'Rock Slide',secondDefender:defender,field:{gameType:'Singles'}}),/Doubles/);
  // Two attackers into one target: the combined range is the sum of both ranges, and Helping Hand applies only to the
  // second attacker when given as its own side. Sitrus Berry would activate between the hits: unsupported, not guessed.
  const first=damage({attacker,defender,move:'Rock Slide',moveOptions:{spread:false}});
  const hhSecond=damage({attacker,defender,move:'Wood Hammer',field:{attackerSide:{isHelpingHand:true}}}),plain=damage({attacker,defender,move:'Wood Hammer'});
  const combo=damage({attacker,defender,move:'Rock Slide',moveOptions:{spread:false},secondMove:'Wood Hammer',secondAttackerSide:{isHelpingHand:true}});
  assert.deepEqual(combo.second.range,hhSecond.range);assert.ok(hhSecond.range[1]>plain.range[1]);
  assert.deepEqual(combo.combined.range,[first.range[0]+hhSecond.range[0],first.range[1]+hhSecond.range[1]]);
  assert.equal(combo.combined.koChanceOnBothHits,1);assert.ok(combo.combined.percentOfMaxHP[1]>100);
  assert.throws(()=>damage({attacker,defender:{...defender,item:'Sitrus Berry'},move:'Rock Slide',secondMove:'Wood Hammer'}),/Unsupported: Sitrus Berry/);
  assert.ok(damage({attacker,defender:{...defender,item:'Leftovers'},move:'Rock Slide',secondMove:'Wood Hammer'}).combined);
});

test('Minimum SP search supports infeasible and damage constraints',()=>{
  const search=spreadSearch({species:'Rillaboom',nature:'Adamant',minStats:{atk:180,spe:120}});assert.equal(search.solutions[0].spent,34);
  assert.equal(spreadSearch({species:'Rillaboom',nature:'Jolly',minStats:{atk:180}}).solutions.length,0);
  assert.equal(spreadSearch({species:'Rillaboom',nature:'Serious',minStats:{hp:207,atk:177,def:142}}).solutions.length,0);
  const other={species:'Incineroar',ability:'Blaze',statPoints:{hp:32}};
  const result=spreadSearch({species:'Rillaboom',nature:'Adamant',benchmarks:[{direction:'outgoing',other,move:'Drain Punch',minimumDamage:90}]});
  assert.ok(result.solutions.length);assert.ok(result.solutions[0].benchmarks[0].range[0]>=90);
});

const legal:SetInput[]=[
  {species:'Rillaboom',ability:'Grassy Surge',nature:'Adamant',item:'Miracle Seed',statPoints:{hp:32,atk:32,spe:2},moves:['Fake Out','Wood Hammer','Grassy Glide','U-turn']},
  {species:'Incineroar',ability:'Intimidate',nature:'Careful',item:'Sitrus Berry',statPoints:{hp:32,spd:32,spe:2},moves:['Fake Out','Flare Blitz','Parting Shot','Protect']},
  {species:'Pelipper',ability:'Drizzle',nature:'Modest',item:'Focus Sash',statPoints:{spa:32,spe:32,hp:2},moves:['Hurricane','Weather Ball','Tailwind','Protect']},
  {species:'Archaludon',ability:'Stamina',nature:'Modest',item:'Life Orb',statPoints:{hp:32,spa:32,spe:2},moves:['Electro Shot','Dragon Pulse','Flash Cannon','Protect']},
  {species:'Farigiraf',ability:'Armor Tail',nature:'Quiet',item:'Leftovers',statPoints:{hp:32,spa:32,def:2},moves:['Trick Room','Psychic','Shadow Ball','Protect']},
  {species:'Mawile',ability:'Intimidate',nature:'Adamant',item:'Mawilite',statPoints:{hp:32,atk:32,def:2},moves:['Play Rough','Iron Head','Sucker Punch','Protect']}
];
test('Six-slot Champions team validation and SP export round-trip',()=>{
  const text=exportText(legal.map((s,i)=>i===0?{...s,nickname:'Drum King'}:s));const result=importText(text);assert.equal(result[0].nickname,'Drum King');assert.equal(result.length,6);validateTeam(result);
  for(let i=0;i<6;i++)assert.deepEqual(finalStats(result[i]),finalStats(legal[i]));
  assert.throws(()=>validateTeam(legal.slice(0,5)));assert.throws(()=>validateTeam(legal.map((s,i)=>i===1?{...s,item:'Miracle Seed'}:s)),/Illegal team/);
  assert.throws(()=>validateTeam(legal.map((s,i)=>i===0?{...s,moves:['Astral Barrage']}:s)),/Illegal team/);
  assert.throws(()=>importText(text+'\nIVs: 0 Atk'));assert.throws(()=>importText(text+'\nTera Type: Water'));
});

test('Multi-hit moves: per-hit rolls, exact KO chance over independent rolls, explicit hit counts and immunities',()=>{
  const defender={species:'Incineroar',nature:'Careful',ability:'Intimidate',statPoints:{hp:32,spd:32}};
  const seed=damage({attacker:{species:'Rillaboom',nature:'Adamant',statPoints:{atk:32}},defender,move:'Bullet Seed'});
  assert.equal(seed.hits,3);assert.equal(seed.perHit.length,3);assert.equal(seed.range[0],seed.perHit.reduce((n:number,h:number[])=>n+h[0],0));
  const five=damage({attacker:{species:'Rillaboom',nature:'Adamant',statPoints:{atk:32}},defender,move:'Bullet Seed',moveOptions:{hits:5}});assert.equal(five.hits,5);assert.ok(five.range[0]>seed.range[0]);
  assert.throws(()=>damage({attacker:{species:'Rillaboom'},defender,move:'Bullet Seed',moveOptions:{hits:6}}),/hits 1–5/);
  // Exact KO chance: brute force over all 16^2 roll pairs for a two-hit move agrees with the engine.
  const darts=damage({attacker:{species:'Dragapult',nature:'Adamant',statPoints:{atk:32}},defender:{species:'Hydreigon',statPoints:{}},move:'Dragon Darts'});
  const [a,b]=darts.perHit;const hp=darts.defenderStats.hp;let ko=0;for(const x of a)for(const y of b)if(x+y>=hp)ko++;assert.equal(darts.koChanceOnHit,ko/256);
  const beam=damage({attacker:{species:'Farigiraf',nature:'Modest',statPoints:{spa:32}},defender,move:'Twin Beam'});assert.deepEqual(beam.range,[0,0]);
});
test('Battle-state moves use stated inputs, and say when the base state was assumed',()=>{
  const attacker={species:'Annihilape',nature:'Adamant',statPoints:{atk:32}},defender={species:'Incineroar',statPoints:{}};
  const fresh=damage({attacker,defender,move:'Rage Fist'});assert.match(fresh.assumptions[0],/assumed not hit yet/);
  const hit=damage({attacker,defender,move:'Rage Fist',moveOptions:{context:{timesHit:2}}});assert.ok(hit.range[0]>fresh.range[0]*2.5);assert.match(hit.assumptions[0],/150 BP/);
  assert.throws(()=>damage({attacker,defender,move:'Rage Fist',moveOptions:{context:{timesHit:9}}}),/out of range/);
  const late=damage({attacker:{species:'Kingambit',statPoints:{atk:32}},defender,move:'Payback',moveOptions:{context:{movesLast:true}}});assert.match(late.assumptions[0],/100 BP/);
});
