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
    const names=(await client.listTools()).tools.map(t=>t.name);for(const n of ['list_teams','get_team','calc_damage','import_team','propose_plans','get_strategy','remove_plans','update_team','update_set','update_strategy','save_benchmark','list_benchmarks','delete_benchmark','rename_team','set_team_format','duplicate_team','export_team','replace_pokemon','star_set','update_todos','delete_team'])assert.ok(names.includes(n),n);
    const text=async(name:string,args:any)=>{const r:any=await client.callTool({name,arguments:args});assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
    const paste=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste;
    const made=await text('import_team',{name:'From Claude',paste,brief:{goal:'Rain that beats Trick Room',core:['Pelipper','Archaludon'],gamePlan:'Rain mode with Tailwind backup',ruledOut:'Kingdra: too frail'}});assert.ok(made.created);
    assert.equal(store.db.coaching![made.created].brief?.goal,'Rain that beats Trick Room');
    await text('update_player_profile',{playstyle:'Bulky balance',hateFacing:['Trick Room']});const prefs=await text('get_player_profile',{});assert.deepEqual(prefs.hateFacing,['Trick Room']);
    const teams=await text('list_teams',{});assert.equal(teams.length,1);assert.equal(teams[0].name,'From Claude');assert.equal(teams[0].pokemon.length,6);
    const team=await text('get_team',{teamId:made.created});assert.ok(team.sets?.length===6||team.team?.length===6||JSON.stringify(team).includes(teams[0].pokemon[0]));
    const [a,b,c,d]=teams[0].pokemon;
    // plans need the full structure: a blank role (or anything else missing) is refused with what to add
    const noRole:any=await client.callTool({name:'propose_plans',arguments:{teamId:made.created,leads:[{title:'T',lead:[a,b],back:[c,d],when:'Into anything',plan:'x'}]}});assert.ok(noRole.isError);assert.match(noRole.content[0].text,/role is required/);
    const foreign:any=await client.callTool({name:'propose_plans',arguments:{teamId:made.created,leads:[{title:'T',lead:[a,'Mew'],back:[c,d],role:'core',when:'w',plan:'x'}]}});assert.ok(foreign.isError);assert.match(foreign.content[0].text,/not on this team/);
    const made1=await text('propose_plans',{teamId:made.created,leads:[{title:'Test lead',lead:[a,b],back:[c,d],role:'core',when:'Into most teams',plan:'**T1:** go.'}],matchups:[{opponent:'Rain',archetype:'Rain',examples:['Pelipper','Archaludon','Basculegion'],threat:'high',bring:[a,b,c,d],plan:'Lead the pair; **Watch:** Tailwind.'}]});
    assert.equal(store.db.coaching![made.created].leads[0].status,'proposed','plans arrive as proposals');assert.equal(store.db.coaching![made.created].leads[0].role,'core');
    // the same pair or opponent is not added twice; it is edited by id
    const dupe:any=await client.callTool({name:'propose_plans',arguments:{teamId:made.created,leads:[{title:'Again',lead:[b,a],back:[c,d],role:'situational',when:'w',plan:'x'}]}});assert.ok(dupe.isError);assert.match(dupe.content[0].text,/already exists/);
    const strat=await text('get_strategy',{teamId:made.created});assert.equal(strat.leads.length,1);assert.equal(strat.matchups.length,1);const leadId=strat.leads[0].id;
    const edit=await text('propose_plans',{teamId:made.created,leads:[{id:leadId,title:'Test lead v2',lead:[a,b],back:[c,d],role:'situational',when:'Into Rain',plan:'**T1:** go again.'}]});assert.deepEqual(edit.edited,['Test lead']);
    assert.equal(store.db.coaching![made.created].leads.length,1);assert.equal(store.db.coaching![made.created].leads[0].title,'Test lead v2');
    // plans can be removed (active or not); the removed content comes back so it can be re-added
    store.db.coaching![made.created].leads[0].status='active';
    const gone=await text('remove_plans',{teamId:made.created,leadIds:[leadId]});assert.equal(gone.removed,1);assert.equal(store.db.coaching![made.created].leads.length,0);assert.equal(gone.restorable[0].title,'Test lead v2');
    // one Pokémon: moves/stat points change, and the previous set stays in history
    const paste2=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[1]?.paste;
    const before=store.db.teams.find((x:any)=>x.id===made.created)!.versions[0].configurations.length;
    const gt=await text('get_team',{teamId:made.created});const s0=(gt.sets??gt.team)[0];const reordered=[...s0.moves].reverse();
    // by default a change is a suggestion the player accepts in the app, with the before → after
    const sug=await text('update_set',{teamId:made.created,pokemon:a,changes:{moves:reordered},summary:'Test move reorder'});assert.equal(sug.proposed,true);assert.match(sug.message,/Suggested change to/);
    assert.equal(store.db.pending?.length,1);assert.equal(store.db.pending![0].proposal.kind,'set');assert.equal(store.db.teams.find((x:any)=>x.id===made.created)!.versions[0].configurations.length,before,'nothing is applied yet');
    // apply:true saves it now, as a new step in History
    const up=await text('update_set',{teamId:made.created,pokemon:a,changes:{moves:reordered},summary:'Test move reorder',apply:true});assert.deepEqual(up.updated.moves,reordered);
    assert.equal(store.db.teams.find((x:any)=>x.id===made.created)!.versions[0].configurations.length,before+1,'the change is a new step in History');
    const sg=await text('update_strategy',{teamId:made.created,text:'## Game plan\nRain first.'});assert.equal(sg.proposed,true);assert.equal(store.db.pending!.some((x:any)=>x.proposal.kind==='strategy'),true);
    const noMon:any=await client.callTool({name:'update_set',arguments:{teamId:made.created,pokemon:'Mew',changes:{item:'Leftovers'},summary:'x'}});assert.ok(noMon.isError);assert.match(noMon.content[0].text,/not on this team/);
    // benchmarks: a calc is saved on the Pokémon with one call, listed and removable
    const bm=await text('save_benchmark',{teamId:made.created,pokemon:a,kind:'damage',input:{attacker:{species:'Gholdengo',nature:'Modest',statPoints:{spa:32}},defender:{species:a,nature:'Careful',statPoints:{hp:32}},move:'Shadow Ball'},context:'Test benchmark'});assert.ok(bm.saved.id);assert.equal(bm.saved.kind,'damage');
    const lb=await text('list_benchmarks',{teamId:made.created});assert.equal(lb.length,1);assert.equal(lb[0].pokemon,a);
    const del=await text('delete_benchmark',{benchmarkId:bm.saved.id});assert.equal(del.restorable.kind,'damage');assert.equal((await text('list_benchmarks',{teamId:made.created})).length,0);
    // the six: replaced in one call, no extra gate
    if(paste2){const sugT=await text('update_team',{teamId:made.created,paste:paste2,summary:'Try another six'});assert.equal(sugT.proposed,true);const upd=await text('update_team',{teamId:made.created,paste:paste2,summary:'Try another six',apply:true});assert.equal(upd.updated,true);}
    // housekeeping tools
    assert.equal((await text('rename_team',{teamId:made.created,name:'Renamed'})).renamed,'Renamed');
    const exp=await text('export_team',{teamId:made.created});assert.match(exp.paste,/@/);
    const dupe2=await text('duplicate_team',{teamId:made.created});assert.ok(dupe2.created);assert.equal(store.db.teams.length,2);
    const nowTeam=(await text('list_teams',{})).find((x:any)=>x.id===made.created);const p0=nowTeam.pokemon[0];
    const star=await text('star_set',{teamId:made.created,pokemon:p0,label:'My '+p0});assert.equal(star.starred,true);
    const todo=await text('update_todos',{teamId:made.created,add:[{kind:'test',text:'Try Tailwind lead'}]});assert.equal(todo.added,1);
    const st2=await text('get_strategy',{teamId:made.created});assert.equal(st2.todos.length,1);await text('update_todos',{teamId:made.created,doneIds:[st2.todos[0].id]});
    const rp:any=await client.callTool({name:'replace_pokemon',arguments:{teamId:made.created,pokemon:'Mew',paste:'Pikachu',summary:'x'}});assert.ok(rp.isError);
    const badDel:any=await client.callTool({name:'delete_team',arguments:{teamId:made.created,confirmName:'wrong',playerAgreed:true}});assert.ok(badDel.isError);assert.match(badDel.content[0].text,/exactly/);
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
