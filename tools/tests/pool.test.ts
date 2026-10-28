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
  assert.equal(keepPreviousPool([team({})],null,['Online: fetch failed']),false,'with nothing to keep, the refresh must refuse to publish');
  assert.deepEqual(laneCounts(prev.teams),{official:1,online:1,shared:1,mergedSpreads:0,total:3,withSpreads:1});
});
test('A cold refresh with failed sources records the attempt without creating a partial pool',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {fileBackend,withData,optionalJSON}=await import('../io.ts');const {refreshPool}=await import('../pool.ts');
  const dir=await mkdtemp(join(tmpdir(),'pool-failed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:403}));
  const backend=fileBackend(dir);
  await withData({user:backend,shared:backend},async()=>{
    await assert.rejects(refreshPool({log:()=>{}}),/Pool not saved/);
    assert.equal(await optionalJSON('knowledge/pool/teams.json',null),null);
    const attempt=await optionalJSON<any>('knowledge/pool/last-attempt.json',null);
    assert.ok(attempt.errors.length);assert.ok(attempt.at);
  });
});
test('A failed refresh retains the restored pool and reports errors before any publisher can proceed',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {fileBackend,withData,save,json}=await import('../io.ts');const {refreshPool}=await import('../pool.ts');
  const dir=await mkdtemp(join(tmpdir(),'pool-retained-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:403}));
  const backend=fileBackend(dir);
  await withData({user:backend,shared:backend},async()=>{
    const previous={refreshedAt:'2026-10-20T00:57:43.652Z',teams:[team({})]};
    await save('knowledge/pool/teams.json',previous);
    const status=await refreshPool({log:()=>{}}) as any;
    assert.ok(status.errors.length);assert.equal(status.refreshedAt,previous.refreshedAt);
    assert.deepEqual(await json('knowledge/pool/teams.json'),previous);
    assert.ok(status.lastAttempt.errors.length);
  });
});
