import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {withData,fileBackend,CODE,save} from '../io.ts';
import {emptyStore,Conflict,type StoreBackend,makeTeam} from '../workbench-store.ts';
import {handleMcp} from '../mcp.ts';
import {createWorkbenchHandler} from '../workbench-server.ts';
import {cleanFocus,FOCUS_FILE,CALC_LIMIT} from '../focus.ts';
import type {Workbench} from '../../shared/workbench.ts';

function memoryStore():StoreBackend&{db:Workbench}{const s:any={db:emptyStore(),
  async read(){return structuredClone(s.db);},
  async mutate(revision:number,fn:(db:Workbench)=>unknown){const db=structuredClone(s.db);if(db.revision!==revision)throw new Conflict('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s;}
const paste=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste;

test('focus records keep ids and calc inputs only',()=>{
  const f=cleanFocus({page:'slot',teamId:'team-1',versionId:'formula-2',slot:2,replayId:'a b c',note:'typing this',calc:{kind:'damage',input:{attacker:{species:'Mawile',nickname:'Secret',moves:['Play Rough']},defender:{species:'Incineroar'},move:'Play Rough'}},tab:'t1'});
  assert.equal(f.page,'slot');assert.equal(f.slot,2);assert.equal(f.replayId,undefined,'ids with spaces are dropped');assert.equal('note' in f,false);
  assert.equal(JSON.stringify(f).includes('Secret'),false,'nicknames are free text and are stripped');assert.equal(f.calc!.kind,'damage');
  assert.equal(cleanFocus({page:'<script>',slot:9}).page,'teams');assert.equal(cleanFocus({slot:9}).slot,undefined);
  assert.equal(cleanFocus({calc:{kind:'damage',input:{x:'y'.repeat(9000)}}}).calc,undefined,'oversized calcs are dropped');
});

test('focus and assistant calcs: stored outside the workspace, stale after 10 minutes, calcs queue for the app',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-focus-'));const store=memoryStore();
  const t=makeTeam(store.db,'Perish Drum',paste);const ctx={user:fileBackend(root),shared:fileBackend(root,CODE),store,hosted:true};
  const api=createWorkbenchHandler(root,0,{hostedMode:true});
  const server=createServer((req,res)=>withData(ctx,async()=>{if(req.url!=='/api/mcp')return api(req,res);
    let raw='';for await(const c of req)raw+=c;await handleMcp(req,res,raw?JSON.parse(raw):undefined);}));
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const port=(server.address() as any).port,base=`http://127.0.0.1:${port}`;
  const post=async(p:string,b:any)=>{const r=await fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});return {status:r.status,body:await r.json() as any};};
  const get=async(p:string)=>(await (await fetch(base+p)).json()) as any;
  const client=new Client({name:'test',version:'1'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
    const text=async(name:string,args:any={})=>{const r:any=await client.callTool({name,arguments:args});assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
    assert.ok((await client.listTools()).tools.some(x=>x.name==='get_focus'));
    assert.match((client.getInstructions()??''),/get_focus/);
    assert.equal((await text('get_focus')).focus,null,'nothing reported yet');
    const rev=store.db.revision;
    // the app reports where the player is; the workspace revision does not move
    const r1=await post('/api/focus',{page:'slot',teamId:t.id,versionId:t.activeVersionId,slot:1,tab:'abc'});assert.equal(r1.status,200);
    await post('/api/focus',{page:'slot',teamId:t.id,versionId:t.activeVersionId,slot:2,tab:'abc'});
    assert.equal(store.db.revision,rev,'focus does not bump the workspace revision');
    const f=await text('get_focus');const sp=(await text('get_team',{teamId:t.id})).sets?.[2]?.species;
    assert.equal(f.stale,false);assert.equal(f.focus.slot,2,'latest record only');assert.equal(f.ids.teamId,t.id);assert.equal(f.ids.pokemon,sp);
    assert.match(f.description,new RegExp(`^Viewing Perish Drum › Pokémon › .+\\(slot 3\\)$`));assert.equal((await get('/api/focus')).focus.tab,'abc');
    // 11 minutes old: flagged stale
    const old=await fetch(base+'/api/focus').then(r=>r.json()) as any;await withData(ctx,()=>save(FOCUS_FILE,{...old.focus,at:new Date(Date.now()-11*60_000).toISOString()}));
    const s=await text('get_focus');assert.equal(s.stale,true);assert.match(s.note,/minutes ago/);
    // an assistant's calc lands in the queue with an id, and the app can list and dismiss it
    const input={attacker:{species:'Gholdengo',nature:'Modest',statPoints:{spa:32}},defender:{species:'Incineroar',nature:'Careful',statPoints:{hp:32,spd:20}},move:'Shadow Ball'};
    const c1=await text('calc_damage',input);assert.ok(c1.calcId&&c1.range?.length===2);
    const sp2=await text('calc_speed',{a:{species:'Gholdengo',nature:'Timid',statPoints:{spe:32}},b:{species:'Incineroar',nature:'Careful'}});assert.ok(sp2.calcId);
    const q=await get('/api/assistant-calcs');assert.equal(q.length,2);assert.equal(q[0].id,sp2.calcId);assert.equal(q[0].kind,'speed');assert.equal(q[1].kind,'damage');assert.deepEqual(q[1].input.move,'Shadow Ball');assert.match(q[1].label,/Gholdengo → Incineroar/);
    assert.equal(store.db.revision,rev,'calcs do not touch the workspace');
    assert.equal((await post('/api/assistant-calcs/remove',{id:c1.calcId})).body.length,1);
    for(let i=0;i<CALC_LIMIT+3;i++)await text('calc_damage',{...input,move:i%2?'Shadow Ball':'Make It Rain'});
    assert.equal((await get('/api/assistant-calcs')).length,CALC_LIMIT,'oldest are dropped past the cap');
  }finally{await client.close();server.close();}
});
