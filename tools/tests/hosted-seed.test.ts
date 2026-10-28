import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CODE} from '../io.ts';

test('The seed command exits nonzero on an upload error or an empty requested prefix',async t=>{
  const root=await mkdtemp(join(tmpdir(),'hosted-seed-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'knowledge/pool'),{recursive:true});
  const refreshedAt='2026-10-20T00:00:00Z';
  await writeFile(join(root,'knowledge/pool/status.json'),JSON.stringify({refreshedAt,counts:{total:1},errors:[]}));
  await writeFile(join(root,'knowledge/pool/teams.json'),JSON.stringify({refreshedAt,teams:[{id:'online:a:alice'}]}));
  for(const [prefix,expected] of [['knowledge/pool/','2 shared file(s) failed to seed'],['knowledge/not-present/','No files found']]){
    const result=spawnSync(process.execPath,['--input-type=module','-e',`
      globalThis.fetch=async()=>new Response(JSON.stringify({message:'synthetic upload denied'}),{status:403,headers:{'content-type':'application/json'}});
      process.argv=['node','tools/hosted-seed.ts','--only',${JSON.stringify(prefix)}];
      await import('./tools/hosted-seed.ts');
    `],{cwd:CODE,encoding:'utf8',env:{...process.env,APP_DATA:root,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'test-secret'}});
    assert.equal(result.status,1,result.stderr);assert.ok(result.stderr.includes(expected),result.stderr);
  }
});
