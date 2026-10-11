import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {withData,fileBackend,CODE} from '../io.ts';
import {emptyStore,applyAction,Conflict,type StoreBackend} from '../workbench-store.ts';
import {seedNewWorkspace,addSamples} from '../samples.ts';
import type {Workbench} from '../../shared/workbench.ts';

// An in-memory workspace row, revision-checked like the hosted one.
function memoryStore():StoreBackend&{db:Workbench}{const s:any={db:emptyStore(),
  async read(){return structuredClone(s.db);},
  async mutate(revision:number,fn:(db:Workbench)=>unknown){const db=structuredClone(s.db);if(db.revision!==revision)throw new Conflict('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s;}

test('A new hosted workspace gets the sample teams once; deleting a team keeps its sets in the library',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-samples-'));const store=memoryStore();
  try{await withData({user:fileBackend(root),shared:fileBackend(root,CODE),store,hosted:true},async()=>{
    assert.equal(await seedNewWorkspace(),true);
    assert.equal(store.db.teams.length,4);assert.ok(store.db.teams.every(t=>t.name.startsWith('Sample · ')));
    for(const t of store.db.teams){const notes=t.versions.find(v=>v.id===t.activeVersionId)!.notes;const c=store.db.coaching?.[t.id];
      assert.match(notes,/## Game plan/);assert.ok(notes.split(/\s+/).length>250,`${t.name}: strategy notes`);assert.ok(c,`${t.name}: coaching saved`);
      assert.ok(c.leads.filter(l=>l.status==='active').length>=3&&c.matchups.filter(m=>m.status==='active').length>=4,`${t.name}: active plans`);
      const mons=new Set(t.versions[0].configurations[0].slots.map(s=>store.db.bank.find(b=>b.id===s.bankId)!.revisions.find(r=>r.id===s.revisionId)!.set.species));
      for(const p of [...c.leads,...c.matchups]){assert.deepEqual([p.calcIds,p.versionIds],[[],[]]);for(const n of 'bring' in p?p.bring:[...p.lead,...p.back])assert.ok(mons.has(n),`${t.name}: ${n} is on the team`);}}
    assert.equal(await seedNewWorkspace(),false,'never seeds twice');assert.deepEqual(await addSamples(),{added:0});
    const db=structuredClone(store.db);const r:any=applyAction(db,{type:'team-delete',teamId:db.teams[0].id});
    assert.equal(r.unlinked,0);assert.equal(db.teams.length,3);assert.ok(db.bank.length>0,'sets stay in the library');
    assert.throws(()=>applyAction(db,{type:'team-delete',teamId:'nope'}),/not found/);
  });}finally{await rm(root,{recursive:true});}
});

test('A team\'s format can be changed to a known format only',()=>{
  const db=emptyStore();const paste=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste;
  const team:any=applyAction(db,{type:'import',name:'T',paste} as any);const id=team.id??db.teams[0].id;
  applyAction(db,{type:'team-format',teamId:id,format:'gen9championsvgc2026regmb'} as any);assert.equal(db.teams[0].format,'gen9championsvgc2026regmb');
  assert.throws(()=>applyAction(db,{type:'team-format',teamId:id,format:'gen9ou'} as any),/Unknown format/);
});
