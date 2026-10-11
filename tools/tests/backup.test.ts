import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {withData,fileBackend,CODE,save,readText,listDir} from '../io.ts';
import {emptyStore,Conflict,type StoreBackend} from '../workbench-store.ts';
import {addSamples} from '../samples.ts';
import {createBackup,restoreBackup} from '../backup.ts';
import {loadGames,addReplays,deleteReplays} from '../replays.ts';
import {readFile,readdir} from 'node:fs/promises';
import {mutateStore,associateReplay,currentTeam,makeTeam} from '../workbench-store.ts';
import {parseReplay} from '../replays.ts';
import type {Workbench} from '../../shared/workbench.ts';

function memoryStore():StoreBackend&{db:Workbench}{const s:any={db:emptyStore(),
  async read(){return structuredClone(s.db);},
  async mutate(revision:number,fn:(db:Workbench)=>unknown){const db=structuredClone(s.db);if(db.revision!==revision)throw new Conflict('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s;}

test('A backup restores into another workspace, merging without duplicating same-named teams',async()=>{
  const a=await mkdtemp(resolve(tmpdir(),'fb-backup-a-')),b=await mkdtemp(resolve(tmpdir(),'fb-backup-b-'));const storeA=memoryStore(),storeB=memoryStore();
  try{
    const backup=await withData({user:fileBackend(a),shared:fileBackend(a,CODE),store:storeA,hosted:true},async()=>{await addSamples();await save('config.json',{player:'Someone'});
      const dir=resolve(CODE,'tools/tests/fixtures/corpus');const file=(await readdir(dir)).find(f=>f.endsWith('game04.html'))!;const html=await readFile(resolve(dir,file),'utf8');
      const saved=await addReplays([{html,filename:file}],{as:'Player'});const game=parseReplay(html,file,'Player');game.id=saved.results[0].id;
      const rain=JSON.parse(await readFile(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[2].paste;
      await mutateStore(storeA.db.revision,db=>{const t=makeTeam(db,'My rain team',rain) as any;associateReplay(db,game,{teamId:t.id,versionId:currentTeam(db,t).version.id,certainty:'family'});});
      return createBackup();});
    assert.equal(backup.store.teams.length,5);assert.equal(backup.games.length,1);assert.ok(Object.keys(backup.files).some(p=>p.startsWith('replays/originals/')));
    await withData({user:fileBackend(b),shared:fileBackend(b,CODE),store:storeB,hosted:true},async()=>{
      const sent=JSON.parse(JSON.stringify(backup));sent.store.teams[0].name='Renamed team';
      const r=await restoreBackup(sent);assert.equal(r.teams,5);assert.equal(r.games,1);assert.equal(r.replays,1);
      assert.equal((await loadGames()).length,1);assert.match(await readText('config.json'),/Someone/);
      const again=await restoreBackup(sent);assert.equal(again.teams,0,'same ids and names are skipped');assert.equal(again.games,0);
      await assert.rejects(restoreBackup({format:'nope'}),/not a Frontier Brain backup/);
    });
  }finally{await rm(a,{recursive:true});await rm(b,{recursive:true});}
});

test('Deleting replays removes the original, parsed copy, index entry and summary',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-delete-'));
  try{await withData({user:fileBackend(root),shared:fileBackend(root,CODE),store:memoryStore(),hosted:true},async()=>{
    const dir=resolve(CODE,'tools/tests/fixtures/corpus');const file=(await readdir(dir)).find(f=>f.endsWith('game05.html'))!;
    const saved=await addReplays([{html:await readFile(resolve(dir,file),'utf8'),filename:file}],{as:'Player'});const id=saved.results[0].id;
    await save(`reports/replay-summaries/${id}.json`,{summary:'x'});assert.equal((await loadGames()).length,1);
    assert.equal(await deleteReplays([id]),1);assert.equal((await loadGames()).length,0);
    await assert.rejects(readText(`reports/replay-summaries/${id}.json`));assert.equal((await listDir('replays/originals')).length,0);
  });}finally{await rm(root,{recursive:true});}
});
