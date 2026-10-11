import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {CODE} from '../io.ts';
import {damage,speed} from '../mechanics.ts';
import {emptyStore,makeTeam,applyAction} from '../workbench-store.ts';
import {withSet,outcome,holds,ownSide,autoTitle} from '../../shared/benchmarks.ts';

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
