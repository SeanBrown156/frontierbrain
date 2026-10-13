import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {withData,fileBackend,CODE,save} from '../io.ts';
import {addReplays,parseReplay} from '../replays.ts';
import {mutateStore,associateReplay,currentTeam,makeTeam} from '../workbench-store.ts';
import {readdir} from 'node:fs/promises';
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
    const made=await text('import_team',{name:'From Claude',paste,notes:'Rain that beats Trick Room. Built around Pelipper and Archaludon.'});assert.ok(made.created);
    assert.equal((await text('get_strategy',{teamId:made.created})).strategy,'Rain that beats Trick Room. Built around Pelipper and Archaludon.');assert.equal('brief' in (store.db.coaching?.[made.created]??{}),false,'no separate brief is kept');
    assert.equal((await client.listTools()).tools.some(x=>x.name==='save_team_brief'),false,'the brief tool is retired');
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
    // a Pokémon's Strategy write-up is editable the same way: suggestion first, apply:true saves it in place (no new set revision)
    const stratSug=await text('update_set',{teamId:made.created,pokemon:a,changes:{strategy:'## Role\nLead and set Trick Room.\n\n## How to play\nTurn one Trick Room.\n\n## Watch out for\nFake Out.'},summary:'Write its role'});
    assert.equal(stratSug.proposed,true);assert.match(stratSug.message,/Strategy/);assert.equal(store.db.pending!.some((x:any)=>x.proposal.kind==='set'&&x.proposal.strategy?.includes('Trick Room')),true);
    const stepsBefore=store.db.teams.find((x:any)=>x.id===made.created)!.versions[0].configurations.length;
    await text('update_set',{teamId:made.created,pokemon:a,changes:{strategy:'## Role\nLead and set Trick Room.\n\n## How to play\nTurn one Trick Room.\n\n## Watch out for\nFake Out.'},summary:'Write its role',apply:true});
    assert.equal((await text('get_team',{teamId:made.created})).sets.find((x:any)=>x.species===a).strategy,'## Role\nLead and set Trick Room.\n\n## How to play\nTurn one Trick Room.\n\n## Watch out for\nFake Out.');
    assert.equal(store.db.bank.some((b:any)=>b.revisions.some((r:any)=>'partners' in r.notes||'matchups' in r.notes)),false,'retired note fields do not linger');
    assert.ok(store.db.teams.find((x:any)=>x.id===made.created)!.versions[0].configurations.length<=stepsBefore+1);
    const loose:any=await client.callTool({name:'update_set',arguments:{teamId:made.created,pokemon:a,changes:{strategy:'It sets Trick Room.'},summary:'x'}});assert.ok(loose.isError);assert.match(loose.content[0].text,/How to play/);
    const same:any=await client.callTool({name:'update_set',arguments:{teamId:made.created,pokemon:a,changes:{strategy:'## Role\nLead and set Trick Room.\n\n## How to play\nTurn one Trick Room.\n\n## Watch out for\nFake Out.'},summary:'again'}});assert.ok(same.isError);assert.match(same.content[0].text,/nothing to change/);
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

test('MCP replays: with no AI key, games wait for the assistant, which saves a summary and a digest that show up in the app',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'fb-mcp-replays-'));const store=memoryStore();
  const ctx={user:fileBackend(root),shared:fileBackend(root,CODE),store,hosted:true};
  const server=createServer((req,res)=>withData(ctx,async()=>{let raw='';for await(const c of req)raw+=c;await handleMcp(req,res,raw?JSON.parse(raw):undefined);}));
  await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const port=(server.address() as any).port;
  const client=new Client({name:'test',version:'1'});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`)));
    const text=async(name:string,args:any)=>{const r:any=await client.callTool({name,arguments:args});assert.ok(!r.isError,r.content?.[0]?.text);return JSON.parse(r.content[0].text);};
    const names=(await client.listTools()).tools.map(t=>t.name);for(const n of ['save_replay_summary','save_team_digest'])assert.ok(names.includes(n),n);
    const ids:string[]=[];let teamId='';
    await withData(ctx,async()=>{await save('config.json',{player:'Player'});
      const dir=resolve(CODE,'tools/tests/fixtures/corpus');const files=(await readdir(dir)).filter(f=>/game0[4-6]\.html$/.test(f));
      const rain=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[2].paste;
      const html=files.map(f=>({f,html:readFileSync(resolve(dir,f),'utf8')}));const saved=await addReplays(html.map(h=>({html:h.html,filename:h.f})),{as:'Player'});
      await mutateStore(store.db.revision,db=>{const t=makeTeam(db,'Rain',rain) as any;teamId=t.id;saved.results.forEach((r:any,i:number)=>{const g=parseReplay(html[i].html,html[i].f,'Player');g.id=r.id;ids.push(r.id);associateReplay(db,g,{teamId:t.id,versionId:currentTeam(db,t).version.id,certainty:'family'});});});});
    const waiting=await text('list_replays',{teamId});assert.equal(waiting.length,3);assert.ok(waiting.every((r:any)=>r.needsSummary===true&&r.summary===null),'all games wait for a summary');
    const t=(await text('replay_transcript',{replayId:ids[0]})).transcript as string;assert.match(t,/Turn 1:/);
    const bad:any=await client.callTool({name:'save_replay_summary',arguments:{replayId:ids[0],summary:'x',keyMoments:[{turn:999,text:'?'}],workOn:[]}});assert.ok(bad.isError);assert.match(bad.content[0].text,/not in this game/);
    const one=await text('save_replay_summary',{replayId:ids[0],summary:'Won through Trick Room.',keyMoments:[{turn:1,text:'Set Trick Room on turn 1.'}],workOn:[{title:'Keep the lead',detail:'Fine.',category:'play',turn:1}],opponentStyle:['Trick Room']});
    assert.equal(one.stillWaiting,2);
    const after=await text('list_replays',{teamId});const row=after.find((r:any)=>r.id===ids[0]);assert.equal(row.needsSummary,false);assert.equal(row.summarisedBy,'Your assistant (MCP)');assert.equal(after.filter((r:any)=>r.needsSummary).length,2);
    const early:any=await client.callTool({name:'save_team_digest',arguments:{teamId,themes:[{title:'x',detail:'y',games:[ids[0]]}]}});assert.ok(early.isError);assert.match(early.content[0].text,/at least two/);
    await text('save_replay_summary',{replayId:ids[1],summary:'Lost to Fake Out.',keyMoments:[{turn:1,text:'Flinched.'}],workOn:[{title:'Respect Fake Out',detail:'Lead around it.',category:'play'}]});
    const dig=await text('save_team_digest',{teamId,themes:[{title:'Respect Fake Out',detail:'Lead around it.',games:[ids[0],ids[1],'bogus'],of:'games'}],strengths:['Trick Room sets reliably']});assert.equal(dig.games,2);assert.match(dig.themes[0],/2 of 2/);
  }finally{await client.close();server.close();await rm(root,{recursive:true});}
});
