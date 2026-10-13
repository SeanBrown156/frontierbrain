import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {emptyStore,makeTeam,applyAction,currentTeam,Conflict,mutateStore,readStore} from '../workbench-store.ts';
import {BENCH_LIMIT} from '../../shared/workbench.ts';
import {withData,fileBackend,CODE} from '../io.ts';
import {createBackup,restoreBackup} from '../backup.ts';
import type {Workbench} from '../../shared/workbench.ts';
import type {StoreBackend} from '../workbench-store.ts';

function memoryStore():StoreBackend&{db:Workbench}{const s:any={db:emptyStore(),
  async read(){return structuredClone(s.db);},
  async mutate(revision:number,fn:(db:Workbench)=>unknown){const db=structuredClone(s.db);if(db.revision!==revision)throw new Conflict('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s;}

const pastes=JSON.parse(await readFile(resolve(import.meta.dirname,'fixtures/teams.json'),'utf8'));
const golisopod={species:'Golisopod',nature:'Adamant',ability:'Emergency Exit',item:'Chople Berry',statPoints:{hp:32,atk:32,spd:2},moves:['First Impression','Liquidation','Leech Life','Close Combat']};
const setup=()=>{const db=emptyStore();const team=makeTeam(db,'Perish',pastes[0].paste);return {db,team,view:()=>currentTeam(db,team)};};

test('Bench: add keeps a library set per team, refuses repeats, and the team stays untouched',()=>{
  const {db,team,view}=setup();const before=JSON.stringify(view().configuration);
  const added:any=applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod,replaces:'Farigiraf',notes:{role:'## Role\nSwap in for Farigiraf.',benchmarks:''}});
  assert.equal(added.species,'Golisopod');assert.equal(team.bench!.length,1);assert.equal(team.bench![0].replaces,'Farigiraf');assert.equal(team.bench![0].source,'player');
  assert.equal(JSON.stringify(view().configuration),before,'adding never changes the six');assert.equal(team.versions[0].configurations.length,1);
  assert.match(db.bank.find(b=>b.id===added.bankId)!.revisions[0].notes.role,/Role/);
  assert.throws(()=>applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod}),/already on the bench/);
  assert.throws(()=>applyAction(db,{type:'bench-add',teamId:team.id,set:{...golisopod,moves:['First Impression']}}),/four moves/);
  assert.throws(()=>applyAction(db,{type:'bench-add',teamId:team.id,set:{...golisopod,statPoints:{hp:32,atk:32,def:32}}}),/budget|66/i);
  const pasted:any=applyAction(db,{type:'bench-add',teamId:team.id,paste:'Garchomp @ Yache Berry\nAbility: Rough Skin\nEVs: 32 Atk / 32 Spe / 2 HP\nJolly Nature\n- Earthquake\n- Dragon Claw\n- Rock Slide\n- Protect'});assert.equal(pasted.species,'Garchomp');
  assert.throws(()=>applyAction(db,{type:'bench-add',teamId:team.id,paste:'Garchomp\n- Earthquake\n\nGengar\n- Shadow Ball'}),/one Pokémon/);
  // an existing library set can be benched too (My sets, a set a promote displaced)
  const slot=view().configuration.slots[0];const again:any=applyAction(db,{type:'bench-add',teamId:team.id,bankId:slot.bankId,revisionId:slot.revisionId,source:'assistant'});assert.equal(again.source,'assistant');
  assert.throws(()=>applyAction(db,{type:'bench-add',teamId:team.id,bankId:slot.bankId,revisionId:slot.revisionId}),/already on the bench/);
  assert.throws(()=>applyAction(db,{type:'bench-add',teamId:team.id,bankId:'nope',revisionId:'nope'}),/Unknown/);
});

test('Bench: the bench is limited and each team has its own',()=>{
  const {db,team}=setup();const other=makeTeam(db,'Other',pastes[1].paste);
  for(let i=0;i<BENCH_LIMIT;i++)applyAction(db,{type:'bench-add',teamId:team.id,set:{...golisopod,nature:i%2?'Adamant':'Jolly',statPoints:{hp:i,atk:32,spd:2}}});
  assert.throws(()=>applyAction(db,{type:'bench-add',teamId:team.id,set:{...golisopod,statPoints:{hp:0,atk:30}}}),/up to 12/);assert.equal(other.bench,undefined);
});

test('Bench: update edits the candidate (new revision, note in place, amend a burst) with stale checks',()=>{
  const {db,team}=setup();const c:any=applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod});const item=team.bench![0];
  const entry=db.bank.find(b=>b.id===c.bankId)!;
  // notes alone update the revision in place; replaces is a plain hint
  applyAction(db,{type:'bench-update',teamId:team.id,benchId:item.id,baseRevisionId:item.revisionId,notes:{role:'## Role\nPivot',benchmarks:''},replaces:'Farigiraf'});
  assert.equal(entry.revisions.length,1);assert.equal(entry.revisions[0].notes.role,'## Role\nPivot');assert.equal(item.replaces,'Farigiraf');
  // a changed set is a new revision of the same library entry; the item follows it
  const base=item.revisionId;applyAction(db,{type:'bench-update',teamId:team.id,benchId:item.id,baseRevisionId:base,set:{...golisopod,item:'Sitrus Berry'},notes:entry.revisions[0].notes});
  assert.equal(entry.revisions.length,2);assert.equal(item.revisionId,entry.revisions[1].id);assert.equal(entry.revisions[1].set.item,'Sitrus Berry');
  // a stale base revision is a conflict
  assert.throws(()=>applyAction(db,{type:'bench-update',teamId:team.id,benchId:item.id,baseRevisionId:base,set:{...golisopod,item:'Leftovers'}}),Conflict);
  // autosave bursts amend the revision they created, never a starred or benchmarked one
  applyAction(db,{type:'bench-update',teamId:team.id,benchId:item.id,baseRevisionId:item.revisionId,set:{...golisopod,item:'Leftovers'},amend:true});assert.equal(entry.revisions.length,2);assert.equal(entry.revisions[1].set.item,'Leftovers');
  applyAction(db,{type:'set-star',bankId:entry.id,revisionId:item.revisionId,label:'Mine'});
  applyAction(db,{type:'bench-update',teamId:team.id,benchId:item.id,baseRevisionId:item.revisionId,set:{...golisopod,item:'Mystic Water'},amend:true});assert.equal(entry.revisions.length,3,'a starred set is not amended');
  // a different species starts a new library entry; the old one stays in the library
  const bankBefore=db.bank.length;applyAction(db,{type:'bench-update',teamId:team.id,benchId:item.id,baseRevisionId:item.revisionId,set:{species:'Garchomp',nature:'Jolly',ability:'Rough Skin',item:'Yache Berry',statPoints:{atk:32,spe:32,hp:2},moves:['Earthquake','Dragon Claw','Rock Slide','Protect']}});
  assert.equal(db.bank.length,bankBefore+1);assert.notEqual(item.bankId,entry.id);assert.throws(()=>applyAction(db,{type:'bench-update',teamId:team.id,benchId:'missing',replaces:'x'}),/no longer on the bench/);
  // reuse points at an already saved set so its benchmarks stay attached
  const slot=currentTeam(db,team).configuration.slots[2];const saved=db.bank.find(b=>b.id===slot.bankId)!.revisions[0];
  applyAction(db,{type:'bench-update',teamId:team.id,benchId:item.id,baseRevisionId:item.revisionId,set:saved.set,reuse:true});assert.equal(item.revisionId,saved.id);assert.equal(item.bankId,slot.bankId);
});

test('Bench: promote swaps into a slot as a History step, keeps benchmarks, and the displaced set takes its place',()=>{
  const {db,team,view}=setup();const c:any=applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod,replaces:'Farigiraf',notes:{role:'## Role\nR\n\n## How to play\nH\n\n## Watch out for\nW',benchmarks:''}});
  const bm:any=applyAction(db,{type:'benchmark-save',bankId:c.bankId,revisionId:c.revisionId,kind:'speed',input:{a:{species:'Golisopod',nature:'Adamant',statPoints:{spe:0}},b:{species:'Incineroar',nature:'Careful',statPoints:{spe:0}}},title:'Speed'});
  const item=team.bench![0];const out=view().configuration.slots[1];const before=view().configuration.id;const steps=team.versions[0].configurations.length;
  const r:any=applyAction(db,{type:'bench-promote',teamId:team.id,benchId:item.id,slot:1,baseRevisionId:out.revisionId});
  assert.equal(r.promoted,'Golisopod');assert.equal(r.displaced,'Farigiraf');assert.equal(team.versions[0].configurations.length,steps+1,'one new History step');assert.notEqual(view().configuration.id,before);
  assert.equal(view().sets[1].species,'Golisopod');assert.equal(view().configuration.slots[1].revisionId,c.revisionId,'the saved revision itself goes in');
  assert.ok((db.benchmarks??[]).some(b=>b.id===bm.id&&b.revisionId===view().configuration.slots[1].revisionId),'benchmarks travel with it');
  assert.match(db.bank.find(b=>b.id===c.bankId)!.revisions[0].notes.role,/How to play/);
  assert.equal(team.bench!.length,1);assert.equal(team.bench![0].revisionId,out.revisionId,'the displaced Pokémon is on the bench');assert.equal(team.bench![0].replaces,'Golisopod');assert.match(view().configuration.summary!,/Promoted Golisopod/);
  // and back again
  const back=applyAction(db,{type:'bench-promote',teamId:team.id,benchId:team.bench![0].id,slot:1}) as any;assert.equal(back.promoted,'Farigiraf');assert.equal(view().sets[1].species,'Farigiraf');assert.equal(team.bench![0].revisionId,c.revisionId);
  assert.equal(team.versions[0].configurations.length,steps+2);
});

test('Bench: illegal promotions are refused and nothing changes; stale slots conflict',()=>{
  const {db,team,view}=setup();
  // Incineroar already holds Sitrus Berry's neighbour? use a duplicate item (Leftovers is on Gholdengo) and a duplicate species
  applyAction(db,{type:'bench-add',teamId:team.id,set:{...golisopod,item:'Leftovers'}});applyAction(db,{type:'bench-add',teamId:team.id,set:{...golisopod,item:'Sitrus Berry',nature:'Jolly'}});
  const [a,b]=team.bench!;const sixBefore=JSON.stringify(view().configuration.slots);const bankBefore=db.bank.length;
  assert.throws(()=>applyAction(db,{type:'bench-promote',teamId:team.id,benchId:a.id,slot:0}),/Item Clause|Leftovers|duplicate/i);
  assert.equal(JSON.stringify(view().configuration.slots),sixBefore);assert.equal(team.bench!.length,2);assert.equal(db.bank.length,bankBefore);
  // promoting into the slot that holds the displaced item's own clause is fine: Gholdengo (Leftovers) -> Golisopod (Leftovers)
  const gholdengo=view().sets.findIndex(s=>s.species==='Gholdengo');const ok:any=applyAction(db,{type:'bench-promote',teamId:team.id,benchId:a.id,slot:gholdengo,baseRevisionId:view().configuration.slots[gholdengo].revisionId});assert.equal(ok.displaced,'Gholdengo');
  // a slot edited elsewhere (different base revision) is a conflict
  assert.throws(()=>applyAction(db,{type:'bench-promote',teamId:team.id,benchId:b.id,slot:0,baseRevisionId:'set-stale'}),Conflict);
  assert.throws(()=>applyAction(db,{type:'bench-promote',teamId:team.id,benchId:b.id,slot:9}),/slot/);
});

test('Bench: remove keeps the set in the library; deleting a team clears its bench and queued promotions',()=>{
  const {db,team}=setup();const c:any=applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod});const item=team.bench![0];
  applyAction(db,{type:'pending-add',teamId:team.id,summary:'x',proposal:{kind:'promote',benchId:item.id,slot:1}});assert.equal(db.pending!.length,1);
  const gone:any=applyAction(db,{type:'bench-remove',teamId:team.id,benchId:item.id});assert.equal(gone.species,'Golisopod');assert.equal(team.bench!.length,0);assert.equal(db.pending!.length,0);
  assert.ok(db.bank.some(b=>b.id===c.bankId),'the set stays in the library');
  applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod});applyAction(db,{type:'team-delete',teamId:team.id});assert.equal(db.teams.length,0);
});

test('Bench: importing from another team (duplicate) copies the bench with fresh ids',()=>{
  const {db,team}=setup();applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod,replaces:'Farigiraf'});
  const copy:any=applyAction(db,{type:'import',name:'Perish (copy)',paste:pastes[0].paste,benchFrom:team.id});
  assert.equal(copy.bench.length,1);assert.notEqual(copy.bench[0].id,team.bench![0].id);assert.equal(copy.bench[0].bankId,team.bench![0].bankId);assert.equal(copy.bench[0].replaces,'Farigiraf');
  const plain:any=applyAction(db,{type:'import',name:'Plain',paste:pastes[0].paste});assert.equal(plain.bench,undefined);
});

test('Bench: stored with the team on disk and dangling entries are refused',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-bench-'));
  try{const made=await mutateStore(0,db=>{const t=makeTeam(db,'Perish',pastes[0].paste);applyAction(db,{type:'bench-add',teamId:t.id,set:golisopod,replaces:'Farigiraf'});return t.id;},root);
    const db=await readStore(root);const team=db.teams.find(t=>t.id===made.result)!;assert.equal(team.bench!.length,1);assert.equal(team.bench![0].replaces,'Farigiraf');
    const json=JSON.parse(await readFile(resolve(root,`teams/${made.result}/team.json`),'utf8'));assert.equal(json.bench.length,1);
    await assert.rejects(mutateStore(db.revision,d=>{d.teams[0].bench![0].revisionId='set-missing';},root),/Dangling bench/);
  }finally{await rm(root,{recursive:true});}
});

test('Bench: a backup restores the bench and the candidates it points at into another workspace',async()=>{
  const a=await mkdtemp(resolve(tmpdir(),'fb-bench-a-')),b=await mkdtemp(resolve(tmpdir(),'fb-bench-b-'));const storeA=memoryStore(),storeB=memoryStore();
  try{
    const backup=await withData({user:fileBackend(a),shared:fileBackend(a,CODE),store:storeA,hosted:true},async()=>{
      await mutateStore(0,db=>{const t=makeTeam(db,'Perish',pastes[0].paste);const c:any=applyAction(db,{type:'bench-add',teamId:t.id,set:golisopod,replaces:'Farigiraf',notes:{role:'## Role\nSwap',benchmarks:''}});
        applyAction(db,{type:'benchmark-save',bankId:c.bankId,revisionId:c.revisionId,kind:'speed',input:{a:{species:'Golisopod',nature:'Adamant',statPoints:{}},b:{species:'Incineroar',nature:'Careful',statPoints:{}}},title:'Speed'});});
      return createBackup();});
    assert.equal(backup.store.teams[0].bench!.length,1);
    await withData({user:fileBackend(b),shared:fileBackend(b,CODE),store:storeB,hosted:true},async()=>{
      const r=await restoreBackup(JSON.parse(JSON.stringify(backup)));assert.equal(r.teams,1);
      const team=storeB.db.teams[0];assert.equal(team.bench!.length,1);assert.equal(team.bench![0].replaces,'Farigiraf');
      const entry=storeB.db.bank.find(x=>x.id===team.bench![0].bankId)!;assert.equal(entry.revisions[0].set.species,'Golisopod');assert.match(entry.revisions[0].notes.role,/Swap/);
      assert.equal((storeB.db.benchmarks??[]).filter(x=>x.bankId===entry.id).length,1,'the candidate keeps its benchmarks');
    });
  }finally{await rm(a,{recursive:true});await rm(b,{recursive:true});}
});

test('Bench: accepting a chat promote proposal swaps the slot, and a slot changed since is a conflict',()=>{
  const {db,team,view}=setup();const c:any=applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod});const item=team.bench![0];
  const proposed={benchId:item.id,slot:1,baseRevisionId:view().configuration.slots[1].revisionId};
  const out=view().configuration.slots[1];
  // the slot is retuned after the proposal: accepting with the proposal's own base revision is refused
  const slot=view().configuration.slots[1];const set={...db.bank.find(b=>b.id===slot.bankId)!.revisions[0].set,item:'Occa Berry'};
  applyAction(db,{type:'team-replace-sets',teamId:team.id,versionId:view().version.id,sets:[{slot:1,set,baseRevisionId:slot.revisionId}]});
  assert.throws(()=>applyAction(db,{type:'bench-promote',teamId:team.id,...proposed}),Conflict);
  // the dock accepts against the slot as it is now when the same Pokémon is still there
  const r:any=applyAction(db,{type:'bench-promote',teamId:team.id,benchId:item.id,slot:1,baseRevisionId:view().configuration.slots[1].revisionId});
  assert.equal(r.promoted,'Golisopod');assert.equal(view().sets[1].species,'Golisopod');assert.equal(team.bench![0].replaces,'Golisopod');assert.notEqual(team.bench![0].revisionId,out.revisionId,'the retuned Farigiraf is the one on the bench');void c;
});

test('Bench: a Pokémon outside the current regulation roster is refused on add and on species change',()=>{
  const {db,team}=setup();
  const ironHands={species:'Iron Hands',nature:'Adamant',ability:'Quark Drive',item:'Assault Vest',statPoints:{hp:32,atk:32,spd:2},moves:['Fake Out','Drain Punch','Wild Charge','Close Combat']};
  assert.throws(()=>applyAction(db,{type:'bench-add',teamId:team.id,set:ironHands}),/not available in the pinned Champions M-C roster/);
  assert.equal((team.bench??[]).length,0);
  const added:any=applyAction(db,{type:'bench-add',teamId:team.id,set:golisopod});
  assert.throws(()=>applyAction(db,{type:'bench-update',teamId:team.id,benchId:added.id,baseRevisionId:added.revisionId,set:ironHands}),/not available/);
});
