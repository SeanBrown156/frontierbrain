import {test} from 'node:test';
import assert from 'node:assert/strict';
import ps from 'pokemon-showdown';
import {STATS,finalStats,points,pokemon,damage,speed,spreadSearch,validateTeam,dex,type SetInput} from '../mechanics.ts';
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
