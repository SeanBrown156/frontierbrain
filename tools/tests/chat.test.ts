import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chat,runTool,tools} from '../chat.ts';
import {damage} from '../mechanics.ts';
import {readStore,emptyStore,makeTeam} from '../workbench-store.ts';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ROOT} from '../io.ts';
// A scripted model: first asks for a damage calc, then answers using the returned numbers.
function scriptedModel(log:any[]){let turn=0;return (async(_url:string,init:any)=>{const body=JSON.parse(init.body);log.push(body);turn++;
  const output=turn===1?[{type:'function_call',call_id:'c1',name:'calc_damage',arguments:JSON.stringify({attacker:{species:'Gengar',nature:'Modest',statPoints:{spa:32,spe:32,hp:2}},defender:{species:'Incineroar',nature:'Careful',ability:'Intimidate',statPoints:{hp:32,def:2,spd:32}},move:'Shadow Ball'})}]
    :[{type:'message',content:[{type:'output_text',text:'Shadow Ball does the range reported by the tool.'}]}];
  const sse=`event: response.created\ndata: {"type":"response.created"}\n\nevent: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:{output}})}\n\n`;
  return new Response(sse,{status:200,headers:{'Content-Type':'text/event-stream'}});}) as typeof fetch;}
test('Chat runs model tool calls through the local engine and returns exactly the engine result',async()=>{
  const log:any[]=[],events:any[]=[];const result=await chat([{role:'user',content:'How much does Shadow Ball do to a typical Incineroar?'}],{},(e,d)=>events.push([e,d]),{apiKey:'test',fetchImpl:scriptedModel(log),keepTranscript:false});
  const expected=damage({attacker:{species:'Gengar',nature:'Modest',statPoints:{spa:32,spe:32,hp:2}},defender:{species:'Incineroar',nature:'Careful',ability:'Intimidate',statPoints:{hp:32,def:2,spd:32}},move:'Shadow Ball'});
  assert.deepEqual(result.tools[0].output.range,expected.range);assert.equal(events[0][0],'tool');assert.equal(events.at(-1)[0],'message');
  const followUp=log[1].input.find((i:any)=>i.type==='function_call_output');assert.equal(JSON.parse(followUp.output).range[0],expected.range[0]);
  assert.match(log[0].instructions,/MUST come from a tool result/);assert.equal(log[0].store,false);assert.equal(log[0].stream,true);assert.ok(log[0].tools.some((t:any)=>t.name==='standard_set'));
});
test('Chat refuses without a key and surfaces engine rejections instead of approximating',async()=>{
  const saved=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  try{await assert.rejects(chat([{role:'user',content:'hi'}],{},()=>{},{keepTranscript:false,root:'/nonexistent-poke-coach'}),/OPENAI_API_KEY is not set/);}finally{if(saved)process.env.OPENAI_API_KEY=saved;}
  await assert.rejects(runTool('calc_damage',{attacker:{species:'Cinccino'},defender:{species:'Incineroar'},move:'Fling'},{},await readStore()),/Fling requires/);
  assert.equal(new Set(tools.map(t=>t.name)).size,tools.length);
});
test('get_team exposes the open configuration with final stats and provenance',async()=>{
  const db=emptyStore();const pastes=JSON.parse(await readFile(resolve(import.meta.dirname,'fixtures/teams.json'),'utf8'));const team=makeTeam(db,'Test',pastes[0].paste);
  const r:any=await runTool('get_team',{},{teamId:team.id,versionId:team.activeVersionId},db);assert.equal(r.sets.length,6);assert.equal(r.sets[0].provenance,'paste');assert.ok(r.sets[0].finalStats.hp>0);
});
// A model that answers with invalid JSON once, then valid JSON when repaired; it rejects the reasoning setting first.
function repairModel(log:any[]){let rejected=false;return (async(_url:string,init:any)=>{const body=JSON.parse(init.body);log.push(body);
  if(body.reasoning&&!rejected){rejected=true;return new Response(JSON.stringify({error:{message:"Unsupported parameter: 'reasoning.effort'"}}),{status:400});}
  const text=body.text?.format?.type==='json_object'?'{"ok":true}':'{"ok":false}';
  const sse=`event: response.completed\ndata: ${JSON.stringify({type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text}]}]}})}\n\n`;
  return new Response(sse,{status:200,headers:{'Content-Type':'text/event-stream'}});}) as typeof fetch;}
test('chatJSON repairs without redoing research, sends the model tier, and drops an unsupported reasoning setting',async()=>{
  const {chatJSON}=await import('../chat.ts');const log:any[]=[];const events:any[]=[];
  const r=await chatJSON('check',{},(e,d)=>events.push([e,d]),v=>{if(!v.ok)throw new Error('ok must be true');return v;},{apiKey:'test',fetchImpl:repairModel(log),keepTranscript:false,model:'gpt-6-sol',effort:'low'});
  assert.deepEqual(r.value,{ok:true});
  assert.equal(log[0].model,'gpt-6-sol');assert.deepEqual(log[0].reasoning,{effort:'low'});assert.equal(log[1].reasoning,undefined);
  const repair=log.at(-1);assert.equal(repair.tools,undefined);assert.equal(repair.text.format.type,'json_object');assert.ok(repair.input.some((i:any)=>typeof i.content==='string'&&i.content.includes('failed validation')));
  assert.ok(events.some(([,d])=>d.name==='validation'));
  const old:any[]=[];await chatJSON('check',{},()=>{},v=>v,{apiKey:'test',fetchImpl:repairModel(old),keepTranscript:false,model:'gpt-4.1',effort:'low'});assert.equal(old[0].reasoning,undefined);
});
// Anthropic: same tool loop over the Messages API (tool_use → tool_result), with the caller's own key.
function scriptedClaude(log:any[]){let turn=0;return (async(url:string,init:any)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');log.push({headers:init.headers,body:JSON.parse(init.body)});turn++;
  const content=turn===1?[{type:'text',text:'Checking.'},{type:'tool_use',id:'tu1',name:'calc_damage',input:{attacker:{species:'Gengar',nature:'Modest',statPoints:{spa:32,spe:32,hp:2}},defender:{species:'Incineroar',nature:'Careful',ability:'Intimidate',statPoints:{hp:32,def:2,spd:32}},move:'Shadow Ball'}}]
    :[{type:'text',text:'Shadow Ball does the range reported by the tool.'}];
  return new Response(JSON.stringify({content,stop_reason:turn===1?'tool_use':'end_turn'}),{status:200,headers:{'Content-Type':'application/json'}});}) as typeof fetch;}
test('Anthropic keys run the same tool loop through the Messages API',async()=>{
  const log:any[]=[];const result=await chat([{role:'user',content:'Shadow Ball on Incineroar?'}],{},()=>{},{apiKey:'sk-ant-test',provider:'anthropic',fetchImpl:scriptedClaude(log),keepTranscript:false});
  assert.equal(result.text,'Shadow Ball does the range reported by the tool.');assert.equal(log[0].headers['x-api-key'],'sk-ant-test');assert.equal(log[0].body.model,'claude-haiku-4-5');
  assert.match(log[0].body.system,/MUST come from a tool result/);assert.ok(log[0].body.tools.some((t:any)=>t.name==='calc_damage'&&t.input_schema));
  const reply=log[1].body.messages.at(-1);assert.equal(reply.role,'user');assert.equal(reply.content[0].type,'tool_result');assert.equal(reply.content[0].tool_use_id,'tu1');
  assert.deepEqual(JSON.parse(reply.content[0].content).range,result.tools[0].output.range);
  // The repair turn keeps the tools defined but forbids calling them.
  const fixed=await result.repair('Reply as JSON.');assert.equal(log[2].body.tool_choice.type,'none');assert.equal(typeof fixed,'string');
});

test('calc_speed_order returns the engine order for four Pokémon, ties and flags included',async()=>{
  const db=emptyStore();
  const r:any=await runTool('calc_speed_order',{pokemon:[{species:'Incineroar',side:'mine',move:'Fake Out'},{species:'Rillaboom',side:'mine',statPoints:{spe:32}},{species:'Incineroar',side:'foe'},{species:'Incineroar',side:'foe'}],tailwind:{foe:true}},{},db);
  // Incineroar 80 (Tailwind doubles the foes to 160); Fake Out (+3) first, then the two tied 160s, then Rillaboom 137.
  assert.deepEqual(r.order.map((o:any)=>o.speed),[80,160,160,137]);assert.deepEqual(r.order.map((o:any)=>o.rank),[1,2,2,3]);assert.deepEqual(r.ties,[['Incineroar','Incineroar']]);
  assert.ok(tools.some(t=>t.name==='calc_speed_order'));
});
