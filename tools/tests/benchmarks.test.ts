import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {CODE} from '../io.ts';
import {damage,speed,speedOrder} from '../mechanics.ts';
import {emptyStore,makeTeam,applyAction} from '../workbench-store.ts';
import {withSet,outcome,holds,ownSide,autoTitle,speedPairs,targetRows} from '../../shared/benchmarks.ts';

const gholdengo={species:'Gholdengo',nature:'Modest',statPoints:{hp:17,spa:7,spd:22,spe:20},item:'Life Orb',ability:'Good as Gold',moves:['Shadow Ball','Make It Rain','Nasty Plot','Protect']};
const incineroar={species:'Incineroar',nature:'Careful',statPoints:{hp:32,def:14,spd:20},item:'Sitrus Berry',ability:'Intimidate'};

test('Benchmarks re-run with the current set swapped in and say whether they still hold',()=>{
  const input={attacker:{...gholdengo,boosts:{spa:2}},defender:incineroar,move:'Shadow Ball',field:{gameType:'Doubles'}};
  const b:any={kind:'damage',side:'attacker',input,result:damage(input)};
  assert.equal(ownSide({kind:'damage',input},'Gholdengo'),'attacker');assert.equal(ownSide({kind:'damage',input},'Incineroar'),'defender');
  assert.equal(autoTitle('damage','attacker',input),'Shadow Ball vs Careful Incineroar');
  const same=withSet(b,gholdengo);assert.deepEqual(same.attacker.boosts,{spa:2},'battle conditions are kept');
  const saved=outcome('damage',b.result);assert.ok(holds('damage','attacker',saved,outcome('damage',damage(same))));
  const weaker={...gholdengo,nature:'Bold',statPoints:{hp:32,def:32,spe:2},item:'Leftovers'};
  assert.equal(holds('damage','attacker',saved,outcome('damage',damage(withSet(b,weaker)))),false,'less damage breaks an attacking benchmark');
  const fast={...incineroar,nature:'Jolly',statPoints:{spe:32}};const s:any={kind:'speed',side:'a',input:{a:gholdengo,b:fast},result:speed({a:gholdengo,b:fast})};assert.equal(s.result.first,'a');
  assert.equal(holds('speed','a',outcome('speed',s.result),outcome('speed',speed(withSet(s,{...gholdengo,statPoints:{hp:32,spa:32,spe:0},nature:'Quiet'})))),false,'slower than the target breaks a speed benchmark');
});
test('Benchmarks are saved with an automatic title and side, and can be deleted',()=>{
  const db=emptyStore();makeTeam(db,'T',JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste);
  const entry=db.bank.find(e=>e.revisions[0].set.species!=='Incineroar')!;const mine={...entry.revisions[0].set};
  const b:any=applyAction(db,{type:'benchmark-save',bankId:entry.id,revisionId:entry.revisions[0].id,kind:'damage',input:{attacker:incineroar,defender:mine,move:'Flare Blitz',field:{gameType:'Doubles'}}} as any);
  assert.equal(b.side,'defender');assert.equal(b.title,"Takes Careful Incineroar's Flare Blitz");assert.equal(b.input.defender.species,mine.species);
  applyAction(db,{type:'benchmark-delete',benchmarkId:b.id} as any);assert.equal(db.benchmarks!.length,0);
});

test('Benchmarks with two attackers are judged on the combined damage and say so in the title',()=>{
  const attacker={species:'Rillaboom',nature:'Adamant',statPoints:{atk:32},ability:'Grassy Surge'},defender={species:'Farigiraf',nature:'Serious',ability:'Armor Tail'};
  const input={attacker,defender,move:'Rock Slide',moveOptions:{spread:false},secondMove:'Wood Hammer',secondAttacker:attacker};
  const r=damage(input);const o=outcome('damage',r);
  // Rock Slide (one target) 62-73 plus Wood Hammer: both together are far past Farigiraf's 195 HP, a guaranteed OHKO, while the first hit alone is not.
  assert.equal(o.low,r.combined!.percentOfMaxHP[0]);assert.equal(o.guaranteed,1);assert.ok(outcome('damage',{percentOfMaxHP:r.percentOfMaxHP}).guaranteed!>1);
  assert.match(autoTitle('damage','attacker',input),/Rock Slide vs Serious Farigiraf \+ Rillaboom's Wood Hammer/);
  const two=damage({attacker,defender,move:'Rock Slide',secondDefender:{species:'Incineroar',nature:'Serious',ability:'Intimidate'}});
  // Incineroar takes 76-90 of 170 HP (derivation in mechanics.test.ts): 44.7-52.9%.
  assert.match(outcome('damage',two).text,/other target 44\.7–52\.9%/);
});

test('A four-way order saves as independent pairwise speed benchmarks, each with its own conditions and holds logic',()=>{
  const db=emptyStore();makeTeam(db,'T',JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste);
  const entry=db.bank.find(e=>e.revisions[0].set.species==='Incineroar')!;const rev=entry.revisions[0];
  // Speeds (level 50, neutral nature): our Incineroar 80 (x2 Tailwind = 160), Rillaboom 137, their Salamence-Mega 172, their Incineroar 80.
  const roster=[{...rev.set,species:'Incineroar',nature:'Serious',statPoints:{},side:'mine'},{species:'Rillaboom',statPoints:{spe:32},side:'mine'},{species:'Salamence-Mega',statPoints:{spe:32},side:'foe'},{species:'Incineroar',side:'foe'}];
  const input={pokemon:roster,trickRoom:false,tailwind:{mine:true}};const order=speedOrder(input as any);
  const rows=speedPairs(roster,order,{trickRoom:false,tailwind:{mine:true},own:0});
  assert.equal(rows.length,6);                                    // 4 Pokémon -> 6 pairs
  assert.deepEqual(rows.filter(r=>r.savable).map(r=>r.key),['0-1','0-2','0-3']); // only pairs with the open Pokémon belong on its page
  assert.deepEqual(rows.filter(r=>r.defaultOn).map(r=>r.key),['0-2','0-3']);    // cross-side on, same-side optional/off
  const titles=Object.fromEntries(rows.map(r=>[r.key,r.title]));
  // Our Incineroar 160 (Tailwind) vs Salamence-Mega 172: slower. Vs their Incineroar 80: faster.
  assert.match(titles['0-2'],/^Your Incineroar is outsped by their Salamence-Mega \(your Tailwind up\) · from a four-way order$/);
  assert.match(titles['0-3'],/^Your Incineroar outspeeds their Incineroar \(your Tailwind up\) · from a four-way order$/);
  // Each saves as an ordinary speed benchmark and is judged on its own pair.
  const saved:any[]=rows.filter(r=>r.defaultOn).map(r=>applyAction(db,{type:'benchmark-save',bankId:entry.id,revisionId:rev.id,kind:r.kind,side:r.side,input:r.input,title:r.title} as any));
  assert.deepEqual(saved.map(b=>b.kind),['speed','speed']);assert.deepEqual(saved.map(b=>b.result.first),['b','a']);
  assert.ok(saved.every(b=>b.input.a.tailwind===true&&b.input.pokemon===undefined));
  // Without Tailwind (our 80 vs their Incineroar 80) the "outspeeds" pair no longer holds (it is a tie), while the
  // "is outsped by Salamence-Mega" pair (80 vs 172) still holds: each is judged on its own.
  const noTw=(b:any)=>speed({...b.input,a:{...b.input.a,tailwind:false}});
  assert.equal(holds('speed','a',outcome('speed',saved[1].result),outcome('speed',noTw(saved[1]))),false);
  assert.equal(holds('speed','a',outcome('speed',saved[0].result),outcome('speed',noTw(saved[0]))),true);
});

test('A spread move saves one damage benchmark per target, each judged on its own target; two attackers stay one combined benchmark',()=>{
  const db=emptyStore();makeTeam(db,'T',JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste);
  const entry=db.bank.find(e=>e.revisions[0].set.species==='Incineroar')!;const rev=entry.revisions[0];
  const attacker={species:'Rillaboom',nature:'Adamant',statPoints:{atk:32},ability:'Grassy Surge'},t1={species:'Farigiraf',nature:'Serious',ability:'Armor Tail'},t2={species:'Incineroar',nature:'Serious',ability:'Intimidate'};
  const input={attacker,defender:t1,move:'Rock Slide',field:{gameType:'Doubles',defenderSide:{isReflect:true,isFriendGuard:true}},moveOptions:{},secondDefender:t2};
  const rows=targetRows(input,{outgoing:true});
  assert.deepEqual(rows.map(r=>r.key),['target-1','target-2']);assert.ok(rows.every(r=>r.defaultOn&&r.savable&&r.kind==='damage'));
  assert.match(rows[1].title,/second target of Rock Slide/);assert.match(rows[0].title,/first target of a spread move/);
  assert.equal(rows[1].input.field.defenderSide.isFriendGuard,undefined);assert.equal(rows[1].input.field.defenderSide.isReflect,true);  // per-Pokémon flag dropped, screen kept
  assert.equal(rows[0].input.secondDefender,undefined);assert.equal(rows[1].input.secondDefender,undefined);
  const saved:any[]=rows.map(r=>applyAction(db,{type:'benchmark-save',bankId:entry.id,revisionId:rev.id,kind:r.kind,side:r.side,input:r.input,title:r.title} as any));
  assert.equal(saved.length,2);assert.deepEqual(saved.map(b=>b.result.range),[damage(rows[0].input).range,damage(rows[1].input).range]);assert.notDeepEqual(saved[0].result.range,saved[1].result.range);
  // Independent: re-check both with the attacker unchanged but a bulkier second target (Def 32 SP: 110 -> 142). Incineroar's
  // 2HKO-possible result worsens and its benchmark fails; Farigiraf's result is untouched and its benchmark still holds.
  const recheck=(b:any,defender:any)=>holds('damage','attacker',outcome('damage',b.result),outcome('damage',damage({...b.input,defender})));
  assert.equal(recheck(saved[0],saved[0].input.defender),true);
  assert.equal(recheck(saved[1],{...t2,statPoints:{hp:32,def:32}}),false);
  // Composite saves are refused with a reason; two attackers into one target is still one combined benchmark.
  assert.throws(()=>applyAction(db,{type:'benchmark-save',bankId:entry.id,revisionId:rev.id,kind:'damage',input} as any),/one damage benchmark per target/);
  assert.throws(()=>applyAction(db,{type:'benchmark-save',bankId:entry.id,revisionId:rev.id,kind:'speed',input:{pokemon:[{species:'Incineroar'},{species:'Rillaboom'}]}} as any),/one speed benchmark per pair/);
  const combo:any=applyAction(db,{type:'benchmark-save',bankId:entry.id,revisionId:rev.id,kind:'damage',side:'attacker',input:{attacker,defender:t1,move:'Rock Slide',moveOptions:{spread:false},secondMove:'Wood Hammer',secondAttacker:attacker}} as any);
  assert.ok(combo.result.combined&&combo.input.secondMove==='Wood Hammer');
  // Incoming: the second target is another of the player's Pokémon, so it is listed but belongs on that Pokémon's page.
  assert.deepEqual(targetRows(input,{outgoing:false}).map(r=>r.savable),[true,false]);
});
