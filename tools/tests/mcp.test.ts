import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {withData,fileBackend,CODE} from '../io.ts';
import {emptyStore,Conflict,type StoreBackend} from '../workbench-store.ts';
import {handleMcp} from '../mcp.ts';
import {readFileSync} from 'node:fs';
import type {Workbench} from '../../shared/workbench.ts';

function memoryStore():StoreBackend&{db:Workbench}{const s:any={db:emptyStore(),
  async read(){return structuredClone(s.db);},
  async mutate(revision:number,fn:(db:Workbench)=>unknown){const db=structuredClone(s.db);if(db.revision!==revision)throw new Conflict('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s;}

test('MCP connector: lists tools, imports a team, proposes plans and runs calcs',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-mcp-'));const store=memoryStore();
  const ctx={user:fileBackend(root),shared:fileBackend(root,CODE),store,hosted:true};
  const server=createServer((req,res)=>withData(ctx,async()=>{let raw='';for await(const c of req)raw+=c;await handleMcp(req,res,raw?JSON.parse(raw):undefined);}));
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const port=(server.address() as any).port;
  const client=new Client({name:'test',version:'1'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`)));
    const names=(await client.listTools()).tools.map(t=>t.name);for(const n of ['list_teams','get_team','calc_damage','import_team','propose_plans'])assert.ok(names.includes(n),n);
    const text=async(name:string,args:any)=>{const r:any=await client.callTool({name,arguments:args});assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
    const paste=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste;
    const made=await text('import_team',{name:'From Claude',paste});assert.ok(made.created);
    const teams=await text('list_teams',{});assert.equal(teams.length,1);assert.equal(teams[0].name,'From Claude');assert.equal(teams[0].pokemon.length,6);
    const team=await text('get_team',{teamId:made.created});assert.ok(team.sets?.length===6||team.team?.length===6||JSON.stringify(team).includes(teams[0].pokemon[0]));
    const [a,b]=teams[0].pokemon;await text('propose_plans',{teamId:made.created,leads:[{lead:[a,b],plan:'Test lead'}]});
    assert.equal(store.db.coaching![made.created].leads[0].status,'proposed','plans arrive as proposals');
    const calc=await text('calc_damage',{attacker:{species:'Gholdengo',nature:'Modest',statPoints:{spa:32}},defender:{species:'Incineroar',nature:'Careful',statPoints:{hp:32,spd:20}},move:'Shadow Ball'});assert.ok(calc.range?.length===2);
    const bad:any=await client.callTool({name:'nope',arguments:{}});assert.ok(bad.isError);
  }finally{await client.close();server.close();await rm(root,{recursive:true});}
});
