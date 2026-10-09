// In-page calc chat. An OpenAI Responses-API tool loop where every number comes from a local tool:
// the pinned Champions engine (mechanics.ts) or labelled standard sets (meta-sets.ts). The model never
// computes damage itself. Transcripts stay local in reports/chats/.
import {randomUUID} from 'node:crypto';
import {ROOT,CODE,save,config} from './io.ts';
import {damage,speed,spreadSearch,finalStats,dex} from './mechanics.ts';
import {metaSets,standardSet,type MetaSource} from './meta-sets.ts';
import {poolSets,poolOverview} from './pool.ts';
import {readStore,currentTeam} from './workbench-store.ts';
import type {Workbench} from '../shared/workbench.ts';

export const DEFAULT_MODEL='gpt-6-astra';
import {supportsReasoning} from './models.ts';
export interface ChatContext {teamId?:string;versionId?:string;configurationId?:string;slot?:number;page?:string;}
export interface ChatTurn {role:'user'|'assistant';content:string;}
export interface ToolEvent {name:string;input:any;output?:any;error?:string;}
type Emit=(event:'tool'|'message'|'error',data:unknown)=>void;

const setSchema={type:'object',description:'A Pokémon. statPoints are Champions stat points (0–32 each, 66 total), keys hp/atk/def/spa/spd/spe. Optional boosts (−6..6), status, curHP (percent), abilityOn.',
  properties:{species:{type:'string'},nature:{type:'string'},ability:{type:'string'},item:{type:'string'},statPoints:{type:'object'},boosts:{type:'object'},status:{type:'string'},curHP:{type:'number'},abilityOn:{type:'boolean'}},required:['species']};
export const tools=[
  {type:'function',name:'get_team',description:'The open team configuration: six sets with final level-50 stats, and which fields are confirmed vs inferred. Call this first for questions about "my" Pokémon.',parameters:{type:'object',properties:{},additionalProperties:false}},
  {type:'function',name:'standard_set',description:'A typical opponent set built from published usage: the n-th most common stat-point spread with the most common nature, ability and item. Default source "pokebase" = Regulation M-C tournament team lists. Returns a set to pass to calc tools plus a label to cite.',
    parameters:{type:'object',properties:{species:{type:'string'},spreadIndex:{type:'integer',minimum:0,description:'0 = most common spread'},source:{type:'string',enum:['pool','pokebase','pokebase-ladder','vgcpastes','smogon']}},required:['species']}},
  {type:'function',name:'usage_data',description:'Published usage distributions for one species (moves, items, abilities, natures, spreads, teammates) with source, period and population. Sources are never combined.',
    parameters:{type:'object',properties:{species:{type:'string'},source:{type:'string',enum:['pool','pokebase','pokebase-ladder','vgcpastes','limitless','pikalytics','smogon']}},required:['species']}},
  {type:'function',name:'calc_damage',description:'Exact Champions damage rolls (doubles by default). Field keys: gameType, weather (Sun/Rain/Sand/Snow…), terrain (Electric/Grassy/Psychic/Misty), attackerSide/defenderSide objects (isReflect, isLightScreen, isHelpingHand, isFriendGuard, isTailwind…). moveOptions: isCrit; hits (multi-hit count); context (battle state for Rage Fist/Last Respects/Stomping Tantrum/Avalanche/Assurance/Payback). Optional secondMove/secondAttacker for a combined two-attack KO check.',
    parameters:{type:'object',properties:{attacker:setSchema,defender:setSchema,move:{type:'string'},field:{type:'object'},moveOptions:{type:'object'},secondMove:{type:'string'},secondAttacker:setSchema},required:['attacker','defender','move']}},
  {type:'function',name:'calc_speed',description:'Effective speed comparison. Each side may add stage (−6..6), tailwind, paralyzed, priority, multiplier (e.g. 1.5 Choice Scarf). trickRoom flips order.',
    parameters:{type:'object',properties:{a:setSchema,b:setSchema,trickRoom:{type:'boolean'}},required:['a','b']}},
  {type:'function',name:'spread_search',description:'Minimum stat points meeting final-stat minimums and damage benchmarks. benchmarks: [{direction:"outgoing"|"incoming", other:<set>, move, survive?:true, minimumDamage?, maximumDamage?, field?}]. Up to three free stats; lock others with fixedPoints.',
    parameters:{type:'object',properties:{species:{type:'string'},ability:{type:'string'},item:{type:'string'},natures:{type:'array',items:{type:'string'}},minStats:{type:'object'},fixedPoints:{type:'object'},budget:{type:'integer'},benchmarks:{type:'array',items:{type:'object'}}},required:['species','natures']}},
  {type:'function',name:'team_pool_sets',description:'PRIMARY data for real usage: Frontier Brain\'s deduplicated team pool (Limitless official Day 2 lists + Limitless online tournaments + VGCPastes spreads merged into the matching team). For one species: usage share, items, abilities, natures, moves, teammates, exact spreads, and the best-placed example sets with player, event and placing. lanes filters to official/online/shared.',parameters:{type:'object',properties:{species:{type:'string'},lanes:{type:'array',items:{type:'string',enum:['official','online','shared']}},sinceDays:{type:'integer',minimum:7,maximum:365}},required:['species']}},
  {type:'function',name:'meta_overview',description:'Team-pool overview: most-used Pokémon and pairs across all pooled teams, plus recent top-4 teams (official and online). Use for meta context, threat lists and team building.',parameters:{type:'object',properties:{lanes:{type:'array',items:{type:'string',enum:['official','online','shared']}},sinceDays:{type:'integer',minimum:7,maximum:365},top:{type:'integer',minimum:5,maximum:60}}}},
  {type:'function',name:'dex_lookup',description:'Champions dex entry: types, base stats, legal abilities.',parameters:{type:'object',properties:{species:{type:'string'}},required:['species']}},
];
export const instructions=`You are Frontier Brain's calc assistant for a player of Pokémon Champions VGC Regulation M-C doubles. Coach at the player's level (default advanced): concise, with the reasoning and tradeoffs that matter.
Rules:
- Every damage number, speed comparison, stat, spread or usage percentage MUST come from a tool result in this conversation. Never estimate or recall numbers.
- "Typical"/"standard"/"common" opponent = standard_set with no source: it uses the team pool when it has enough exact spreads, else PokéBase M-C tournaments (spread 0). Always state the label you used, e.g. "vs PokéBase M-C Careful 32/0/2/0/32/0 Incineroar (22.4% of spreads)". Offer to rerun on the 2nd/3rd spread when the top share is small.
- Real usage, sets and results come from team_pool_sets and meta_overview first (one deduplicated pool: Limitless official + online team lists, VGCPastes spreads). Cite examples by player, event and placing. usage_data is for a single named outside source.
- The player's own sets come from get_team. If a field is "inferred", say the result depends on that assumption.
- Report damage as % range and KO chance from the tool, plus the conditions (field, items, abilities, boosts). Mention Intimidate, spread-move reduction or terrain only if they were in the calc input.
- A Pokémon holding its Mega Stone (e.g. Gengar @ Gengarite) fights as its Mega form once evolved: calc species "Gengar-Mega" unless the question is about the turn before Mega Evolution, and say which form you used.
- If the engine rejects an input, say so plainly; do not approximate. Multi-hit moves report per-hit rolls and an exact KO chance; set moveOptions.hits when the hit count matters. Rage Fist, Last Respects, Stomping Tantrum, Avalanche, Assurance and Payback take moveOptions.context ({timesHit}, {faintedAllies}, {lastMoveFailed}, {hitFirst}, {targetDamaged}, {movesLast}); state the battle state you assumed.
- Distinguish observations, assumptions and hypotheses. No win probabilities.`;

function teamPayload(db:Workbench,ctx:ChatContext){
  const team=db.teams.find(t=>t.id===ctx.teamId);if(!team)return {error:'No team is open in this chat context.'};
  const view=currentTeam(db,team,ctx.versionId,ctx.configurationId);
  return {team:team.name,version:`V${view.version.number}${view.version.label?` · ${view.version.label}`:''}`,focus:ctx.slot!==undefined?view.sets[ctx.slot]?.species:undefined,
    sets:view.configuration.slots.map((slot,i)=>{const r=db.bank.find(b=>b.id===slot.bankId)!.revisions.find(r=>r.id===slot.revisionId)!;return {slot:i,...r.set,finalStats:finalStats(r.set),provenance:r.provenance??'paste',fields:r.fields,knownMoves:r.knownMoves};})};
}
const trim=(m:any)=>({source:m.source,species:m.species,period:m.period,population:m.population,sample:m.sample,url:m.url,notes:m.notes,moves:m.moves.slice(0,10),items:m.items.slice(0,8),abilities:m.abilities.slice(0,4),natures:m.natures.slice(0,6),spreads:m.spreads.slice(0,8),teammates:m.teammates.slice(0,8)});
const brief=(r:any)=>({description:r.description,range:r.range,percentOfMaxHP:r.percentOfMaxHP.map((x:number)=>Math.round(x*10)/10),koChanceOnHit:r.koChanceOnHit,...r.hits>1?{hits:r.hits,perHitRange:r.perHit.map((h:number[])=>[h[0],h.at(-1)])}:{},notes:r.assumptions.slice(0,-1),attackerStats:r.attackerStats,defenderStats:r.defenderStats,...r.combined?{combined:r.combined}:{}});
// "Typical" spreads: the team pool when it holds enough exact spreads for the species, else PokéBase M-C.
export const MIN_POOL_SPREADS=8;
async function defaultSetSource(species:string,source?:MetaSource){if(source)return metaSets(species,source);try{const p=await poolSets(species);if(p.spreads.reduce((n,s:any)=>n+(s.count??0),0)>=MIN_POOL_SPREADS)return p;}catch{}return metaSets(species,'pokebase');}
export async function runTool(name:string,input:any,ctx:ChatContext,db:Workbench){
  switch(name){
    case 'get_team':return teamPayload(db,ctx);
    case 'standard_set':{const m=await defaultSetSource(input.species,input.source as MetaSource|undefined);const s=standardSet(m,input.spreadIndex??0);return {set:{species:s.species,nature:s.nature,ability:s.ability,item:s.item,statPoints:s.statPoints},label:s.label,source:m.url,spreadsAvailable:m.spreads.length};}
    case 'usage_data':return trim(await metaSets(input.species,(input.source??'pokebase') as MetaSource));
    case 'calc_damage':return brief(damage(input));
    case 'calc_speed':return speed(input);
    case 'spread_search':{const r=spreadSearch(input);return {...r,solutions:r.solutions.map((s:any)=>({nature:s.nature,statPoints:s.statPoints,stats:s.stats,spent:s.spent,unused:s.unused,benchmarks:s.benchmarks.map(brief)}))};}
    case 'team_pool_sets':{const m=await poolSets(input.species,{lanes:input.lanes,sinceDays:input.sinceDays});return {population:m.population,period:m.period,sample:m.sample,items:m.items.slice(0,8),abilities:m.abilities,natures:m.natures.slice(0,6),moves:m.moves.slice(0,12),spreads:m.spreads.slice(0,8),teammates:m.teammates.slice(0,10),examples:(m.examples??[]).slice(0,8),notes:m.notes};}
    case 'meta_overview':return poolOverview({lanes:input.lanes,sinceDays:input.sinceDays,top:input.top});
    case 'dex_lookup':{const s=dex.species.get(input.species);if(!s.exists)throw new Error(`Unknown species ${input.species}`);return {name:s.name,types:s.types,baseStats:s.baseStats,abilities:Object.values(s.abilities)};}
  }
  throw new Error(`Unknown tool ${name}`);
}
// Streaming keeps bytes flowing while the model reasons, so long turns don't hit fetch's header timeout.
// Only the final response object matters here; it arrives in the "response.completed" event.
async function streamedResponse(r:Response){
  const reader=r.body!.getReader();const decoder=new TextDecoder();let buffer='',done:any=null,failure:any=null;
  for(;;){const {done:end,value}=await reader.read();if(end)break;buffer+=decoder.decode(value,{stream:true});let cut;
    while((cut=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,cut);buffer=buffer.slice(cut+2);const line=block.split('\n').find(l=>l.startsWith('data: '));if(!line)continue;const payload=line.slice(6);if(payload==='[DONE]')continue;
      try{const event=JSON.parse(payload);if(event.type==='response.completed')done=event.response;else if(event.type==='response.failed'||event.type==='error')failure=event.response?.error??event.error??event;}catch{}}}
  if(failure&&!done)throw new Error(`OpenAI response failed: ${failure.message??JSON.stringify(failure).slice(0,300)}`);if(!done)throw new Error('OpenAI stream ended without a completed response');return done;
}
async function withRetry(call:()=>Promise<Response>,tries=3):Promise<Response>{
  for(let i=1;;i++){try{const r=await call();if((r.status===429||r.status>=500)&&i<tries){await new Promise(ok=>setTimeout(ok,1500*i));continue;}return r;}catch(e){const cause=(e as any).cause;if(i>=tries)throw new Error(`OpenAI request failed after ${tries} attempts: ${(e as Error).message}${cause?` (${cause.code??''} ${cause.message??''})`.trimEnd():''}`);await new Promise(ok=>setTimeout(ok,1500*i));}}
}
export interface ChatOptions {apiKey?:string;model?:string;fetchImpl?:typeof fetch;root?:string;maxSteps?:number;keepTranscript?:boolean;extraInstructions?:string;effort?:'minimal'|'low'|'medium'|'high';signal?:AbortSignal;}
const outputText=(data:any)=>(data.output??[]).filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content??[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('\n').trim();
// One Responses API call. Transient network failures and 429/5xx get two retries with backoff; long reasoning turns
// get 15 minutes. If a model rejects the reasoning setting, the call is repeated once without it.
async function respond(body:any,opts:ChatOptions,apiKey:string){
  const f=opts.fetchImpl??fetch;const signal=opts.signal?AbortSignal.any([opts.signal,AbortSignal.timeout(900000)]):AbortSignal.timeout(900000);
  const send=(b:any)=>withRetry(()=>f('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},signal,body:JSON.stringify({...b,store:false,stream:true})}));
  let r=await send(body);let data:any=r.ok?await streamedResponse(r):await r.json().catch(()=>({}));
  if(!r.ok&&r.status===400&&body.reasoning&&/reasoning|effort/i.test(data?.error?.message??'')){const {reasoning,...rest}=body;r=await send(rest);data=r.ok?await streamedResponse(r):await r.json().catch(()=>({}));}
  if(!r.ok)throw new Error(`OpenAI ${r.status}: ${data?.error?.message??'request failed'}${r.status===404?` — model ${body.model} isn't available to this key; pick another in Settings`:''}`);
  return data;
}
export async function chat(messages:ChatTurn[],ctx:ChatContext,emit:Emit,opts:ChatOptions={}){
  if(!opts.apiKey&&!process.env.OPENAI_API_KEY){try{process.loadEnvFile(`${opts.root??CODE}/.env`);}catch{}}
  const apiKey=opts.apiKey??process.env.OPENAI_API_KEY;if(!apiKey)throw new Error('OPENAI_API_KEY is not set. Add OPENAI_API_KEY=… to .env in the workspace root, then ask again.');
  const model=opts.model??process.env.OPENAI_MODEL??DEFAULT_MODEL;const db=await readStore(opts.root??ROOT);
  if(!Array.isArray(messages)||!messages.length||messages.length>60)throw new Error('Send 1–60 chat turns');
  const input:any[]=messages.map(m=>{if(!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>8000)throw new Error('Invalid chat turn');return {role:m.role,content:m.content};});
  const context=teamPayload(db,ctx);const toolLog:ToolEvent[]=[];
  const profile=await config();
  const base={model,instructions:`${instructions}${profile.player?`\nPlayer: ${profile.player}.`:''}${profile.coachingLevel?` Coaching level: ${profile.coachingLevel}.`:''}${opts.extraInstructions?`\n\n${opts.extraInstructions}`:''}\nOpen context: ${'error'in context?'none':`${context.team} ${context.version}${context.focus?`, focused on ${context.focus}`:''}`}.`,...(opts.effort&&supportsReasoning(model)?{reasoning:{effort:opts.effort}}:{})};
  for(let step=0;step<(opts.maxSteps??12);step++){
    const data=await respond({...base,input,tools},opts,apiKey);
    const calls=(data.output??[]).filter((o:any)=>o.type==='function_call');
    if(!calls.length){const text=outputText(data);
      emit('message',{text,model});if(opts.keepTranscript!==false)await saveTranscript(messages,text,toolLog,ctx,model);
      // `repair` re-asks for the final answer only (no tools), reusing everything researched so far.
      const repair=async(feedback:string)=>{input.push(...(data.output??[]).filter((o:any)=>o.type!=='reasoning'),{role:'user',content:feedback});const d=await respond({...base,input,text:{format:{type:'json_object'}}},opts,apiKey);return outputText(d);};
      return {text,tools:toolLog,repair};}
    input.push(...data.output);
    for(const call of calls){let args:any={};const event:ToolEvent={name:call.name,input:args};
      try{args=JSON.parse(call.arguments||'{}');event.input=args;event.output=await runTool(call.name,args,ctx,db);}catch(e){event.error=(e as Error).message;}
      toolLog.push(event);emit('tool',event);input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(event.error?{error:event.error}:event.output)});}
  }
  throw new Error('Stopped after too many tool steps; narrow the question.');
}
async function saveTranscript(messages:ChatTurn[],answer:string,tools:ToolEvent[],ctx:ChatContext,model:string){
  const at=new Date().toISOString();await save(`reports/chats/${at.slice(0,10)}-${randomUUID().slice(0,8)}.json`,{at,model,context:ctx,messages,answer,tools});
}

// Ask for a JSON object and validate it locally. Validation errors go back to the model as a repair turn without
// tools (the research isn't redone), up to `attempts` times in total.
export async function chatJSON<T>(prompt:string|ChatTurn[],ctx:ChatContext,emit:Emit,validate:(value:any)=>T,opts:ChatOptions&{attempts?:number}={}):Promise<{value:T;text:string;tools:ToolEvent[]}>{
  const messages:ChatTurn[]=typeof prompt==='string'?[{role:'user',content:prompt}]:[...prompt];
  const r=await chat(messages,ctx,(e,d)=>{if(e==='tool')emit(e,d);},{...opts,extraInstructions:`${opts.extraInstructions??''}\nFinish with ONLY one JSON object (no prose, no code fence).`});
  const parse=(text:string)=>{const start=text.indexOf('{');if(start<0)throw new Error('No JSON object in the reply');return validate(JSON.parse(text.slice(start,text.lastIndexOf('}')+1)));};
  let text=r.text,lastError='';
  for(let attempt=1;attempt<=(opts.attempts??3);attempt++){
    try{return {value:parse(text),text,tools:r.tools};}
    catch(e){lastError=(e as Error).message;emit('tool',{name:'validation',input:{attempt},error:lastError});if(attempt===(opts.attempts??3))break;
      text=await r.repair(`That failed validation: ${lastError.slice(0,1500)}\nFix it and reply with the complete corrected JSON object only.`);}
  }
  throw new Error(`The model could not produce a valid result: ${lastError}`);
}
