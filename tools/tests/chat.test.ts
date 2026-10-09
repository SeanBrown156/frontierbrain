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
