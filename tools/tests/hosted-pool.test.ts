import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePublishedPool,seedHostedPool,restoreHostedPool} from '../hosted-pool.ts';
import {fileBackend,withData,save,json} from '../io.ts';
import type {SupabaseClient} from '@supabase/supabase-js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('Hosted recovery requires a nonempty pool and matching published status',()=>{
  const pool={refreshedAt:'2026-10-20T00:57:43.652Z',teams:[{id:'online:a:alice'}]};
  const status={refreshedAt:pool.refreshedAt,counts:{total:1}};
  assert.doesNotThrow(()=>validatePublishedPool(pool,status));
  assert.throws(()=>validatePublishedPool(null,null),/missing or invalid/);
  assert.throws(()=>validatePublishedPool({...pool,teams:[]},status),/missing or invalid/);
  assert.throws(()=>validatePublishedPool(pool,{...status,refreshedAt:'2026-10-19T00:00:00Z'}),/disagree/);
  assert.throws(()=>validatePublishedPool(pool,{...status,counts:{total:2}}),/disagree/);
  assert.throws(()=>validatePublishedPool({...pool,teams:[...pool.teams,...pool.teams]},{...status,counts:{total:2}}),/duplicate/);
});
test('A restored baseline can be seeded in one atomic request, and a failed refresh cannot be seeded',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'hosted-pool-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const backend=fileBackend(dir),refreshedAt='2026-10-20T00:57:43.652Z';
  const pool={refreshedAt,teams:[{id:'online:a:alice'}]},status={refreshedAt,counts:{total:1},errors:[]};
  const stored=[{path:'knowledge/pool/teams.json',body:JSON.stringify(pool),encoding:'utf8'},{path:'knowledge/pool/status.json',body:JSON.stringify(status),encoding:'utf8'}];
  const writes:any[]=[];
  const client={from:(table:string)=>{assert.equal(table,'shared_files');return {
    select:()=>({in:async()=>({data:stored,error:null})}),
    upsert:async(rows:any[])=>{writes.push(rows);return {error:null};},
  };}} as unknown as SupabaseClient;
  await withData({user:backend,shared:backend},async()=>{
    await restoreHostedPool(client);assert.deepEqual(await json('knowledge/pool/teams.json'),pool);
    await seedHostedPool(client);assert.equal(writes.length,1);
    assert.deepEqual(writes[0].map((r:any)=>r.path).sort(),stored.map(r=>r.path).sort());
    await save('knowledge/pool/status.json',{...status,errors:['Online: HTTP 429']});
    await assert.rejects(seedHostedPool(client),/Refusing to seed/);assert.equal(writes.length,1);
  });
});
