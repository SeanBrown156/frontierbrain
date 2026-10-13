import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {withData,fileBackend,CODE,ROOT,save} from '../io.ts';
import {emptyStore,Conflict,makeTeam,type StoreBackend} from '../workbench-store.ts';
import {handleMcp} from '../mcp.ts';
import {createWorkbenchHandler} from '../workbench-server.ts';
import {intakeReplays} from '../replay-intake.ts';
import {readNotices,readInboxState,NOTICES_FILE,STATE_FILE} from '../inbox.ts';
import type {Workbench} from '../../shared/workbench.ts';

function memoryStore():StoreBackend&{db:Workbench}{const s:any={db:emptyStore(),
  async read(){return structuredClone(s.db);},
  async mutate(revision:number,fn:(db:Workbench)=>unknown){const db=structuredClone(s.db);if(db.revision!==revision)throw new Conflict('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s;}
const teams=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'));
const corpus=resolve(CODE,'tools/tests/fixtures/corpus');
const page=(n:string)=>readFileSync(resolve(corpus,readdirSync(corpus).find(f=>f.endsWith(`game${n}.html`))!),'utf8');
const fixture=readFileSync(resolve(CODE,'tools/tests/fixtures/notices.json'),'utf8');

test('Inbox: unlinked replays with why, suggestions, waiting summaries, calcs, and per-user notice dismissal',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-inbox-'));const store=memoryStore();
  const ctx={user:fileBackend(root),shared:fileBackend(root,CODE),store,hosted:true};
  const api=createWorkbenchHandler(ROOT,0,{hostedMode:true});
  const server=createServer((req,res)=>withData(ctx,async()=>{if(req.url!=='/api/mcp')return api(req,res);
    let raw='';for await(const c of req)raw+=c;await handleMcp(req,res,raw?JSON.parse(raw):undefined);}));
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const get=async(p:string)=>(await fetch(base+p)).json() as Promise<any>;
  const post=async(p:string,b:any)=>{const r=await fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json() as any};};
  const client=new Client({name:'test',version:'1'});
  try{
    await withData(ctx,()=>save('config.json',{player:'Player'}));
    const empty=await get('/api/inbox');assert.deepEqual(empty,{items:[],count:0,byKind:{'unlinked-replay':0,suggestion:0,summaries:0,calc:0,notice:0}});
    // two teams, neither has the six of the games below: they are saved with no association
    const other=makeTeam(store.db,'Sun',teams[0].paste);
    const added=await withData(ctx,()=>intakeReplays([{html:page('04'),name:'a.html'},{html:page('05'),name:'b.html'}],undefined));
    assert.ok(added.results.every(r=>r.ok&&r.certainty==='inbox'),JSON.stringify(added.results));
    const ids=added.results.map(r=>r.id!);
    const one=await get('/api/inbox');assert.equal(one.count,2);assert.equal(one.byKind['unlinked-replay'],2);
    const u=one.items.find((i:any)=>i.replayId===ids[0]);
    assert.equal(u.kind,'unlinked-replay');assert.equal(u.reason,'no-match');assert.equal(u.yours.length,6);assert.equal(u.theirs.length,6);assert.match(u.why,/doesn't match any of your teams/);
    assert.equal(u.closest[0].teamId,other.id);assert.ok(u.closest[0].missing.length>0,'roster diff names what the game had that the team lacks');
    assert.ok(u.date&&u.opponent&&['win','loss'].includes(u.result));
    // a team that does have the six: the same games now say so, and one link makes them leave the inbox
    const rain=makeTeam(store.db,'Rain',teams[2].paste);
    const two=await get('/api/inbox');const m=two.items.find((i:any)=>i.replayId===ids[0]);
    assert.equal(m.reason,'matches-one');assert.deepEqual(m.candidateTeamIds,[rain.id]);assert.match(m.why,/Rain/);
    const linked=await post('/api/associate',{revision:store.db.revision,replayId:ids[0],teamId:rain.id,certainty:'auto'});assert.equal(linked.status,200);
    assert.equal(store.db.associations[ids[0]].basis,'auto');
    const three=await get('/api/inbox');assert.equal(three.byKind['unlinked-replay'],1);
    // that linked game now waits for a summary: one item per team, with the request to copy
    const waiting=three.items.find((i:any)=>i.kind==='summaries');assert.equal(waiting.teamId,rain.id);assert.equal(waiting.count,1);assert.deepEqual(waiting.replayIds,[ids[0]]);
    assert.equal(waiting.request,'Summarise my new Frontier Brain replays for Rain.');assert.equal(waiting.href,`#team/${rain.id}/replays/all`);
    // suggestions across teams come from db.pending, each pointing at its team
    store.db.pending=[{id:'pending-1',teamId:other.id,createdAt:'2026-10-12T10:00:00Z',source:'mcp',summary:'More bulk',proposal:{kind:'set',slot:1,set:{species:'Incineroar'}} as any}];
    const sug=(await get('/api/inbox')).items.find((i:any)=>i.kind==='suggestion');
    assert.equal(sug.pendingId,'pending-1');assert.equal(sug.teamId,other.id);assert.equal(sug.href,`#team/${other.id}/overview/all`);assert.match(sug.title,/Incineroar for slot 2/);assert.equal(sug.detail,'More bulk');
    // notices: missing file is fine, a malformed one is fine, the fixture shows two valid entries and drops the bad ones
    assert.equal((await get('/api/inbox')).byKind.notice,0);
    await withData(ctx,()=>save(NOTICES_FILE,'{not json'));assert.equal((await get('/api/inbox')).byKind.notice,0);
    await withData(ctx,()=>save(NOTICES_FILE,fixture));
    const notices=(await get('/api/inbox')).items.filter((i:any)=>i.kind==='notice');assert.equal(notices.length,2);
    assert.equal(notices[0].noticeId,'reg-2026-10-14','newest first');assert.equal(notices[0].level,'warning');assert.equal(notices[0].url,'https://example.com/rules');assert.equal(notices[1].url,undefined,'only https links');
    // dismissal is per user, stored outside the workspace, and only for notices
    const rev=store.db.revision;assert.equal((await post('/api/inbox/dismiss',{id:'unlinked:'+ids[1]})).status,400);
    assert.equal((await post('/api/inbox/dismiss',{id:'reg-2026-10-14'})).status,200);assert.equal(store.db.revision,rev);
    assert.deepEqual((await get('/api/inbox')).items.filter((i:any)=>i.kind==='notice').map((i:any)=>i.noticeId),['reg-2026-10-01']);
    assert.deepEqual(JSON.parse(await readFile(resolve(root,STATE_FILE),'utf8')),{dismissed:['reg-2026-10-14']});
    // calcs the assistant ran: linked to a Pokémon page of the first team that holds that species
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
    const text=async(name:string,args:any={})=>{const r:any=await client.callTool({name,arguments:args});assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
    const sp=store.db.teams[0];
    const mine=(await text('get_team',{teamId:sp.id})).sets[0].species as string;
    const c=await text('calc_damage',{attacker:{species:mine,nature:'Modest',statPoints:{spa:32}},defender:{species:'Incineroar',nature:'Careful',statPoints:{hp:32}},move:'Tackle'}).catch(()=>null);
    // the move may not suit the species; the queue entry only needs a calc that ran, so fall back to a speed check
    const ran=c??await text('calc_speed',{a:{species:mine,nature:'Timid',statPoints:{spe:32}},b:{species:'Incineroar',nature:'Careful'}});
    const calc=(await get('/api/inbox')).items.find((i:any)=>i.kind==='calc');assert.equal(calc.calcId,ran.calcId);assert.equal(calc.teamId,sp.id);assert.match(calc.href,new RegExp(`^#team/${sp.id}/mon/.+/0$`));
    // MCP get_inbox returns the same items, with the ids the other tools take
    assert.ok((await client.listTools()).tools.some(t=>t.name==='get_inbox'));
    const viaMcp=await text('get_inbox');const viaApi=await get('/api/inbox');
    assert.equal(viaMcp.count,viaApi.count);assert.deepEqual(viaMcp.byKind,viaApi.byKind);
    const mu=viaMcp.items.find((i:any)=>i.kind==='unlinked-replay');assert.equal(mu.replayId,ids[1]);
    // deleting an unlinked replay removes it for good (the same removal the MCP delete_replay uses)
    const del=await post('/api/replay-delete',{replayId:ids[1]});assert.equal(del.status,200);assert.equal(del.body.wasLinked,false);
    assert.equal((await get('/api/inbox')).byKind['unlinked-replay'],0);
  }finally{await client.close().catch(()=>{});server.close();}
});

test('Notices reader tolerates anything in the file',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-notices-'));const ctx={user:fileBackend(root),shared:fileBackend(root)};
  await withData(ctx,async()=>{
    assert.deepEqual(await readNotices(),[],'missing file');assert.deepEqual(await readInboxState(),{dismissed:[]});
    for(const raw of ['','[]','{"notices":"x"}','null','{"notices":[null,1,{"id":"bad id","title":"t","body":"b"}]}']){await save(NOTICES_FILE,raw);assert.deepEqual(await readNotices(),[],raw);}
    await save(STATE_FILE,'oops');assert.deepEqual(await readInboxState(),{dismissed:[]});
    await save(STATE_FILE,{dismissed:['a',3,null,'b']});assert.deepEqual((await readInboxState()).dismissed,['a','b']);
  });
});
