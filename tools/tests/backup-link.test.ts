import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,readdir,writeFile,mkdir,utimes,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ROOT is read when io.ts loads, so the local-mode data directory is set first (each test file is its own process).
const LOCAL=await mkdtemp(resolve(tmpdir(),'fb-bl-local-'));process.env.APP_DATA=LOCAL;
const SERVER_SECRET=['sb','secret','test_value_that_must_never_leak'].join('_'); // built at runtime so secret scanners do not flag a fake value
process.env.SUPABASE_SECRET_KEY=SERVER_SECRET;delete process.env.BACKUP_LINK_SECRET;
const link=await import('../backup-link.ts');const {withData,fileBackend,CODE,save}=await import('../io.ts');const {handleMcp}=await import('../mcp.ts');
const {emptyStore,Conflict}=await import('../workbench-store.ts');
const {signToken,verifyToken,createExport,redeemExport,purgeExports,localExports,exportKey,hostedSecret,serveBackupDownload,LinkError,EXPORT_TTL_MS,EXPORT_MAX_LIVE}=link;

const nonce=(c='a')=>c.repeat(32);
const payload=(o:any={})=>({userId:'u1',backupKey:exportKey(nonce(),true),exp:Date.now()+60_000,nonce:nonce(),...o});
const status=(fn:()=>any)=>{try{fn();}catch(e){return (e as any).status;}return 0;};
const asyncStatus=async(p:Promise<any>)=>{try{await p;}catch(e){return (e as any).status??-1;}return 0;};
const secretA=Buffer.alloc(32,1),secretB=Buffer.alloc(32,2);

test('Token: valid, tampered, expired, wrong secret, wrong path and junk are told apart',()=>{
  const now=Date.now(),t=signToken(payload({exp:now+1000}),secretA);
  assert.equal(verifyToken(t,secretA,true,now).userId,'u1');
  const [body,sig]=t.split('.');
  const forged=Buffer.from(JSON.stringify({...payload({exp:now+1000}),userId:'u2'})).toString('base64url');
  assert.equal(status(()=>verifyToken(`${forged}.${sig}`,secretA,true,now)),403,'payload edited, signature kept');
  assert.equal(status(()=>verifyToken(`${body}.${sig.slice(0,-2)}AA`,secretA,true,now)),403,'signature edited');
  assert.equal(status(()=>verifyToken(t,secretB,true,now)),403,'another server secret');
  assert.equal(status(()=>verifyToken(t,secretA,true,now+1000)),410,'expired');
  assert.equal(status(()=>verifyToken(t,secretA,false,now)),403,'a hosted key is not valid in local mode');
  for(const bad of [undefined,'',null,'abc','a.b.c','x'.repeat(2000),'{}.{}'])assert.equal(status(()=>verifyToken(bad,secretA,true,now)),403,String(bad).slice(0,10));
  // validly signed but pointing at a path outside the reserved export path is refused
  for(const backupKey of ['.exports/../config.json','config.json','teams/index.json',`.exports/${nonce()}.json.gz/../../x`,exportKey(nonce('b'),true)])
    assert.equal(status(()=>verifyToken(signToken(payload({backupKey,exp:now+1000}),secretA),secretA,true,now)),403,backupKey);
  assert.equal(status(()=>verifyToken(signToken(payload({nonce:'../..',exp:now+1000}),secretA),secretA,true,now)),403,'nonce is hex only');
});

test('Secret: derived from the server key, BACKUP_LINK_SECRET overrides, fails closed without one',()=>{
  const a=hostedSecret({SUPABASE_SECRET_KEY:'k1'} as any),b=hostedSecret({SUPABASE_SECRET_KEY:'k1'} as any),c=hostedSecret({SUPABASE_SECRET_KEY:'k1',BACKUP_LINK_SECRET:'dedicated'} as any);
  assert.deepEqual(a,b);assert.notDeepEqual(a,c);assert.equal(a.length,32);assert.ok(!a.toString('utf8').includes('k1'));
  assert.equal(status(()=>hostedSecret({} as any)),503);assert.equal(status(()=>hostedSecret({BACKUP_LINK_SECRET:'x'} as any)),503,'the download needs the server key too');
});

test('Export: single use, expiry, per-user isolation, cleanup of expired objects, live cap and size cap',async()=>{
  const dirA=await mkdtemp(resolve(tmpdir(),'fb-bl-a-')),dirB=await mkdtemp(resolve(tmpdir(),'fb-bl-b-'));
  const backends:Record<string,any>={u1:localExports(dirA),u2:localExports(dirB)};const backendFor=(u:string)=>backends[u];
  const mk=(userId:string,json='{"ok":1}',now?:number)=>createExport({backend:backends[userId],userId,secret:secretA,hostedMode:true,json,now});
  try{
    const e=await mk('u1','{"hello":"world"}');assert.ok(existsSync(resolve(dirA,e.backupKey)));assert.match(e.backupKey,/^\.exports\/[a-f0-9]{32}\.json\.gz$/);
    // another user's token (valid, signed) cannot reach this object, and the object stays put
    const other=await mk('u2');const mixed=signToken({userId:'u2',backupKey:e.backupKey,exp:Date.now()+60_000,nonce:e.backupKey.slice(9,41)},secretA);
    assert.equal(await asyncStatus(redeemExport(mixed,{secret:secretA,hostedMode:true,backendFor})),410);assert.ok(existsSync(resolve(dirA,e.backupKey)),'u1 object untouched');
    const got=await redeemExport(e.token,{secret:secretA,hostedMode:true,backendFor});assert.equal(got.body.toString(),'{"hello":"world"}');assert.equal(got.userId,'u1');
    assert.ok(!existsSync(resolve(dirA,e.backupKey)),'deleted on first download');
    assert.equal(await asyncStatus(redeemExport(e.token,{secret:secretA,hostedMode:true,backendFor})),410,'second use refused');
    assert.ok(existsSync(resolve(dirB,other.backupKey)));
    // concurrent redemptions: exactly one wins
    const c=await mk('u1');const results=await Promise.allSettled([1,2,3,4].map(()=>redeemExport(c.token,{secret:secretA,hostedMode:true,backendFor})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    // expired: the token is refused and the object is removed by the next purge
    const old=await mk('u1','{"old":1}',Date.now()-EXPORT_TTL_MS-1000);assert.equal(await asyncStatus(redeemExport(old.token,{secret:secretA,hostedMode:true,backendFor})),410);
    const stale=resolve(dirA,old.backupKey),past=new Date(Date.now()-EXPORT_TTL_MS-120_000);await utimes(stale,past,past);
    assert.equal(await purgeExports(backends.u1,true),0);assert.ok(!existsSync(stale),'expired object cleaned up');
    // an expired object is cleaned by the next export call, a live one is kept
    const keep=await mk('u1');const dead=await mk('u1');await utimes(resolve(dirA,dead.backupKey),past,past);await mk('u1');
    assert.ok(existsSync(resolve(dirA,keep.backupKey)));assert.ok(!existsSync(resolve(dirA,dead.backupKey)));
    // at most EXPORT_MAX_LIVE waiting
    const live=(await readdir(resolve(dirA,'.exports'))).length;for(let i=live;i<EXPORT_MAX_LIVE;i++)await mk('u1');
    assert.equal(await asyncStatus(mk('u1')),429);
    // size cap: refused with a clear message and nothing stored
    const before=(await readdir(resolve(dirB,'.exports'))).length;
    await assert.rejects(mk('u2','x'.repeat(41*1024*1024)),(e:any)=>e.status===413&&/40 MB/.test(e.message)&&/Settings/.test(e.message));
    assert.equal((await readdir(resolve(dirB,'.exports'))).length,before);
  }finally{await rm(dirA,{recursive:true});await rm(dirB,{recursive:true});}
});

test('Download endpoint: headers, single use, HEAD does not consume, bad and missing tokens',async()=>{
  const dir=await mkdtemp(resolve(tmpdir(),'fb-bl-http-'));const backend=localExports(dir);
  const server=createServer((req,res)=>void serveBackupDownload(req,res,{secret:()=>secretA,hostedMode:true,backendFor:()=>backend}));
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const base=`http://127.0.0.1:${(server.address() as any).port}/api/backup-download`;
  try{
    const e=await createExport({backend,userId:'u1',secret:secretA,hostedMode:true,json:'{"format":"x"}'});
    assert.equal((await fetch(`${base}?token=${e.token}`,{method:'HEAD'})).status,405);
    const ok=await fetch(`${base}?token=${e.token}`);assert.equal(ok.status,200);assert.equal(await ok.text(),'{"format":"x"}');
    assert.equal(ok.headers.get('cache-control'),'no-store');assert.match(ok.headers.get('content-disposition')!,/^attachment; filename="frontierbrain-backup-\d{4}-\d{2}-\d{2}\.json"$/);assert.equal(ok.headers.get('x-content-type-options'),'nosniff');
    const again=await fetch(`${base}?token=${e.token}`);assert.equal(again.status,410);assert.ok(!(await again.text()).includes(e.token),'the token is never echoed');
    assert.equal((await fetch(base)).status,403);assert.equal((await fetch(`${base}?token=${e.token.slice(0,-3)}xyz`)).status,403);
  }finally{server.close();await rm(dir,{recursive:true});}
});

function memoryStore(){const s:any={db:emptyStore(),async read(){return structuredClone(s.db);},async mutate(revision:number,fn:any){const db=structuredClone(s.db);if(db.revision!==revision)throw new Conflict('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s;}
async function withMcp<T>(ctx:any|null,fn:(call:(name:string,args?:any)=>Promise<any>,port:number)=>Promise<T>){
  const server=createServer((req,res)=>{const run=async()=>{let raw='';for await(const c of req)raw+=c;await handleMcp(req,res,raw?JSON.parse(raw):undefined);};void(ctx?withData(ctx,run):run());});
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const port=(server.address() as any).port;const client=new Client({name:'t',version:'1'});
  try{await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`)));
    return await fn(async(name,args={})=>{const r:any=await client.callTool({name,arguments:args});return {isError:!!r.isError,text:r.content[0].text,json:r.isError?null:JSON.parse(r.content[0].text)};},port);
  }finally{await client.close();server.close();}
}

test('MCP export_backup (hosted shape): returns a link not the file, the link downloads once, restore only explains',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-bl-mcp-'));const store=memoryStore();
  const user=fileBackend(root);const ctx={user,shared:fileBackend(root,CODE),store,userId:'user-1',hosted:true};
  try{await withMcp(ctx,async(call,port)=>{
    await withData(ctx,async()=>{await save('config.json',{player:'Someone'});await save('replays/originals/a.html','<html>'+'log '.repeat(1000)+'</html>');});
    const names=(await call('backup_info')).json;assert.match(names.available,/export_backup/);
    const r=await call('export_backup');assert.ok(!r.isError,r.text);const out=r.json;
    assert.ok(r.text.length<3000,'a small result, never the backup');assert.ok(!r.text.includes(SERVER_SECRET),'no server secret in the result');
    assert.match(out.downloadUrl,new RegExp(`^http://127\\.0\\.0\\.1:${port}/api/backup-download\\?token=[\\w-]+\\.[\\w-]+$`));
    assert.equal(out.singleUse,true);assert.equal(out.expiresInMinutes,15);assert.ok(Date.parse(out.expiresAt)>Date.now());assert.ok(out.sizeBytes>0);assert.equal(typeof out.contains.teams,'number');assert.ok(!('file' in out));
    assert.ok((await withData(ctx,()=>user.list('.exports'))).length===1,'stored under the reserved path');
    // the link is redeemed with the same secret derivation, from a different request context (no session)
    const token=new URL(out.downloadUrl).searchParams.get('token')!;
    const server=createServer((req,res)=>void serveBackupDownload(req,res,{secret:()=>hostedSecret(),hostedMode:true,backendFor:u=>{assert.equal(u,'user-1');return localExports(root);}}));
    await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const dl=`http://127.0.0.1:${(server.address() as any).port}/api/backup-download?token=${token}`;
    try{const f=await fetch(dl);assert.equal(f.status,200);const backup=JSON.parse(await f.text());assert.equal(backup.format,'frontierbrain-backup');assert.ok(Object.keys(backup.files).includes('config.json'));
      assert.equal((await fetch(dl)).status,410);}finally{server.close();}
    assert.equal((await withData(ctx,()=>user.list('.exports'))).length,0,'object removed after download');
    const rb=await call('restore_backup');assert.ok(!rb.isError);assert.match(rb.json.where,/Settings/);assert.match(rb.json.note,/cannot restore/);
    assert.ok(!(await call('restore_backup',{backup:{format:'frontierbrain-backup'}})).isError,'a supplied blob is ignored, never restored');
    assert.equal(store.db.teams.length,0);
    // fails closed without a server key
    const keep=process.env.SUPABASE_SECRET_KEY;delete process.env.SUPABASE_SECRET_KEY;
    try{const no=await call('export_backup');assert.ok(no.isError);assert.match(no.text,/not available on this site/);}finally{process.env.SUPABASE_SECRET_KEY=keep;}
    // guests/unknown users have no id
    const anon=await withMcp({...ctx,userId:undefined},c=>c('export_backup'));assert.ok(anon.isError);
  });}finally{await rm(root,{recursive:true});}
});

test('MCP export_backup (local mode): file under .cache/exports and a localhost link, single use',async()=>{
  await withMcp(null,async call=>{
    const r=await call('export_backup');assert.ok(!r.isError,r.text);const out=r.json;
    assert.match(out.downloadUrl,/^http:\/\/127\.0\.0\.1:\d+\/api\/backup-download\?token=/);assert.ok(out.file.startsWith(resolve(LOCAL,'.cache/exports')+'/'));assert.ok(existsSync(out.file));
    assert.ok(!r.text.includes((await readFile(resolve(LOCAL,'.cache/exports/.key'))).toString('hex')),'the local key is not in the result');
    const {gunzipSync}=await import('node:zlib');assert.equal(JSON.parse(gunzipSync(await readFile(out.file)).toString()).format,'frontierbrain-backup');
    // serve it through the real local route's pieces
    const server=createServer((req,res)=>void serveBackupDownload(req,res,{secret:()=>link.localSecret(LOCAL),hostedMode:false,backendFor:()=>localExports(LOCAL)}));
    await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const url=`http://127.0.0.1:${(server.address() as any).port}/api/backup-download?token=${new URL(out.downloadUrl).searchParams.get('token')}`;
    try{assert.equal((await fetch(url)).status,200);assert.equal((await fetch(url)).status,410);assert.ok(!existsSync(out.file));}finally{server.close();}
  });
  await rm(LOCAL,{recursive:true,force:true});
});
