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
    const refused:any=await client.callTool({name:'import_team',arguments:{name:'Rushed',paste,brief:{goal:'x',core:['Pelipper'],gamePlan:'y',playerAgreed:false}}});assert.ok(refused.isError,'no team without the player agreeing');
    const made=await text('import_team',{name:'From Claude',paste,brief:{goal:'Rain that beats Trick Room',core:['Pelipper','Archaludon'],gamePlan:'Rain mode with Tailwind backup',ruledOut:'Kingdra: too frail',playerAgreed:true}});assert.ok(made.created);
    assert.equal(store.db.coaching![made.created].brief?.goal,'Rain that beats Trick Room');
    await text('update_player_profile',{playstyle:'Bulky balance',hateFacing:['Trick Room']});const prefs=await text('get_player_profile',{});assert.deepEqual(prefs.hateFacing,['Trick Room']);
    const teams=await text('list_teams',{});assert.equal(teams.length,1);assert.equal(teams[0].name,'From Claude');assert.equal(teams[0].pokemon.length,6);
    const team=await text('get_team',{teamId:made.created});assert.ok(team.sets?.length===6||team.team?.length===6||JSON.stringify(team).includes(teams[0].pokemon[0]));
    const [a,b]=teams[0].pokemon;await text('propose_plans',{teamId:made.created,leads:[{lead:[a,b],plan:'Test lead'}]});
    assert.equal(store.db.coaching![made.created].leads[0].status,'proposed','plans arrive as proposals');
    const calc=await text('calc_damage',{attacker:{species:'Gholdengo',nature:'Modest',statPoints:{spa:32}},defender:{species:'Incineroar',nature:'Careful',statPoints:{hp:32,spd:20}},move:'Shadow Ball'});assert.ok(calc.range?.length===2);
    const prompts=(await client.listPrompts()).prompts.map(p=>p.name);assert.ok(prompts.includes('build_around'));
    const pr=await client.getPrompt({name:'build_around',arguments:{pokemon:'Mega Chimecho, Trevenant'}});assert.match((pr.messages[0].content as any).text,/pokemon_profile/);
    assert.match(client.getInstructions()??'',/collaborator/);
    const book=await text('vgc_playbook',{});assert.ok(book.sections.length>=10);const sc=await text('vgc_playbook',{section:'speed control'});assert.match(sc.text,/Trick Room/);
    const where=await text('where_to_look',{});assert.ok(where.topics.some((t:any)=>t.topic==='reports'));
    const results=await text('where_to_look',{topic:'results'});assert.ok(results.sites.some((s:any)=>s.name==='Limitless VGC'&&s.role==='upstream'));assert.ok(results.currentLinks.items.flatMap((i:any)=>i.links).some((l:any)=>/limitlessvgc\.com\/tournaments/.test(l.url)));
    const reading=await text('where_to_look',{topic:'fundamentals'});assert.ok(reading.articles.some((s:any)=>s.articles.some((a:any)=>/nuggetbridge/.test(a.url))));
    assert.match(client.getInstructions()??'',/Think in fours/);
    const rules=await text('format_rules',{});assert.equal(rules.bring,4);assert.equal(rules.megaEvolutionPerBattle,1);assert.match(rules.primer,/several Mega Stone holders/);
    assert.match(client.getInstructions()??'',/one Mega Evolution per battle/i);
    const profile=await text('pokemon_profile',{species:'Chimecho',top:10});assert.ok(profile.forms.some((f:any)=>f.name==='Chimecho-Mega'));assert.ok(profile.roles['speed control'].includes('Trick Room'));assert.equal(profile.metaSheet.summary.length,profile.forms.length);
    const bad:any=await client.callTool({name:'nope',arguments:{}});assert.ok(bad.isError);
  }finally{await client.close();server.close();await rm(root,{recursive:true});}
});
