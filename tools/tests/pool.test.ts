import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consolidate,matchShared,NONSTANDARD,keepPreviousPool,laneCounts,type PoolTeam} from '../pool.ts';
const six=['Gholdengo','Volcarona','Garchomp','Incineroar','Rillaboom','Raichu'];
const set=(species:string,extra={})=>({species,item:'',ability:'',nature:'Impish',moves:['Protect'],...extra});
const team=(over:Partial<PoolTeam>):PoolTeam=>({id:'x',lane:'official',event:'Regional Frankfurt',eventId:'443',date:'2026-09-26',players:1129,player:'Eric Rios',placing:1,record:null,pokemon:six,sets:six.map(s=>set(s)),sources:[{name:'Limitless',url:'l'}],...over});
const sp={hp:30,atk:0,def:20,spa:0,spd:14,spe:2};
test('A shared paste of the same team merges into the tournament list: spreads attached, counted once',()=>{
  const official=team({});const shared=team({id:'shared:MC1',lane:'shared',event:'Frankfurt Regional',eventId:'',date:'2026-09-28',players:null,player:'eric rios',sets:six.map(s=>set(s,s==='Incineroar'?{statPoints:sp}:{})),sources:[{name:'VGCPastes',url:'p'}]});
  const r=consolidate([official],[],[shared]);assert.equal(r.teams.length,1);assert.equal(r.merged,1);
  assert.deepEqual(r.teams[0].sets.find(s=>s.species==='Incineroar')!.statPoints,sp);assert.equal(r.teams[0].spreadsFrom!.url,'p');assert.equal(r.teams[0].lane,'official');
});
test('Different six, a paste shared before the event, or no player/placing link stays separate',()=>{
  const official=team({});
  assert.equal(matchShared(team({lane:'shared',pokemon:[...six.slice(0,5),'Sneasler']}),[official]),undefined);
  assert.equal(matchShared(team({lane:'shared',date:'2026-09-01'}),[official]),undefined);
  assert.equal(matchShared(team({lane:'shared',player:'Someone Else',event:'',placing:null}),[official]),undefined);
  assert.ok(matchShared(team({lane:'shared',player:'Other Name',event:'Frankfurt',placing:1}),[official]),'same event words and placing also match');
});
test('Re-shared identical pastes collapse; custom-rule online events are recognised',()=>{
  const a=team({id:'shared:1',lane:'shared',date:null,event:'',placing:null,sets:six.map(s=>set(s,{statPoints:sp}))});const r=consolidate([],[],[a,{...a,id:'shared:2'}]);
  assert.equal(r.teams.length,1);assert.equal(r.duplicates,1);
  for(const n of ['Copa Oak Stadium #12 - MonoType','Cheese #17 - GEN 3 Edition','Little Cup Open'])assert.ok(NONSTANDARD.test(n),n);
  for(const n of ["Maddo's Cup #12 | 100€","The Grim Cup #1 Reg M-C",'Alpensee Tour (Reg M-C) #78'])assert.ok(!NONSTANDARD.test(n),n);
});
test('A refresh with a failed lane keeps the previous pool instead of shrinking it',()=>{
  const prev={teams:[team({}),team({id:'online:1:a',lane:'online'}),team({id:'shared:1',lane:'shared',sets:[set('Incineroar',{statPoints:sp})]})]};
  assert.equal(keepPreviousPool([team({})],prev,['Online: fetch failed']),true,'any lane error keeps the previous pool');
  assert.equal(keepPreviousPool([],prev,[]),true,'an empty result keeps the previous pool');
  assert.equal(keepPreviousPool([team({})],prev,[]),false,'a clean refresh replaces it');
  assert.equal(keepPreviousPool([team({})],null,['Online: fetch failed']),false,'with nothing to keep, the partial pool is saved');
  assert.deepEqual(laneCounts(prev.teams),{official:1,online:1,shared:1,mergedSpreads:0,total:3,withSpreads:1});
});
