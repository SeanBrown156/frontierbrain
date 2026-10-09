import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {withData,fileBackend,CODE} from '../io.ts';
import {emptyStore,applyAction,Conflict,type StoreBackend} from '../workbench-store.ts';
import {seedNewWorkspace,addSamples} from '../samples.ts';
import {loadGames} from '../replays.ts';
import type {Workbench} from '../../shared/workbench.ts';

// An in-memory workspace row, revision-checked like the hosted one.
function memoryStore():StoreBackend&{db:Workbench}{const s:any={db:emptyStore(),
  async read(){return structuredClone(s.db);},
  async mutate(revision:number,fn:(db:Workbench)=>unknown){const db=structuredClone(s.db);if(db.revision!==revision)throw new Conflict('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s;}

test('A new hosted workspace gets the sample teams once; replays link as same-six; deleting a team keeps its replays',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-samples-'));const store=memoryStore();
  try{await withData({user:fileBackend(root),shared:fileBackend(root,CODE),store,hosted:true},async()=>{
    assert.equal(await seedNewWorkspace(),true);
    assert.equal(store.db.teams.length,5);assert.ok(store.db.teams.every(t=>t.name.startsWith('Sample · ')));
    const rain=store.db.teams.find(t=>t.name.includes('Ladder rain'))!;const links=Object.values(store.db.associations);
    assert.equal(links.length,5);assert.ok(links.every(a=>a.teamId===rain.id&&a.certainty==='family'&&a.versionId));
    const games=await loadGames();assert.equal(games.length,5);assert.ok(games.every(g=>g.players[g.ownSide].name==='Player'));
    assert.equal(await seedNewWorkspace(),false,'never seeds twice');assert.deepEqual(await addSamples(),{added:0});
    const db=structuredClone(store.db);const r:any=applyAction(db,{type:'team-delete',teamId:rain.id});
    assert.equal(r.unlinked,5);assert.equal(db.teams.length,4);assert.deepEqual(db.associations,{});assert.ok(db.bank.length>0,'sets stay in the library');
    assert.throws(()=>applyAction(db,{type:'team-delete',teamId:'nope'}),/not found/);
  });}finally{await rm(root,{recursive:true});}
});
