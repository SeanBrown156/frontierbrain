// Which OpenAI model each kind of AI work uses. Chats default to the light gpt-6-luna with low reasoning effort; full
// team builds keep the flagship. the player picks them in the Ask Frontier Brain panel and the New team dialog, which write
// settings.json (gitignored). Saved settings win over .env OPENAI_MODEL.
import {optionalJSON,save,CODE} from './io.ts';

export type Tier='chat'|'build';
export type Effort='minimal'|'low'|'medium'|'high';
export interface ModelChoice {model:string;effort:Effort;}
export interface ModelSettings {chat:ModelChoice;build:ModelChoice;}
export const DEFAULT_SETTINGS:ModelSettings={chat:{model:'gpt-6-luna',effort:'low'},build:{model:'gpt-6-astra',effort:'medium'}};
const FILE='settings.json';const efforts:Effort[]=['minimal','low','medium','high'];
// Only reasoning models accept `reasoning.effort`; older chat models (gpt-4.x, gpt-4o) reject it.
export const supportsReasoning=(model:string)=>/^(gpt-5|gpt-6|o\d)/.test(model)&&!/chat-latest/.test(model);
export async function modelSettings():Promise<ModelSettings>{
  const saved=await optionalJSON<any>(FILE,{}).catch(()=>({}));const pick=(t:Tier):ModelChoice=>({model:typeof saved?.models?.[t]?.model==='string'?saved.models[t].model:(t==='chat'&&process.env.OPENAI_MODEL)||DEFAULT_SETTINGS[t].model,effort:efforts.includes(saved?.models?.[t]?.effort)?saved.models[t].effort:DEFAULT_SETTINGS[t].effort});
  return {chat:pick('chat'),build:pick('build')};
}
export async function saveModelSettings(input:any){
  const current=await modelSettings();const next:ModelSettings={...current};
  for(const t of ['chat','build'] as Tier[]){const v=input?.[t];if(!v)continue;if(typeof v.model!=='string'||!/^[a-z0-9.\-]{2,60}$/.test(v.model))throw new Error('Invalid model name');if(!efforts.includes(v.effort))throw new Error('Invalid effort');next[t]={model:v.model,effort:v.effort};}
  const saved=await optionalJSON<any>(FILE,{}).catch(()=>({}));await save(FILE,{...saved,models:next});return next;
}
// Models the key can use, filtered to text models worth offering.
export async function availableModels(all=false){
  try{process.loadEnvFile(`${CODE}/.env`);}catch{}const key=process.env.OPENAI_API_KEY;if(!key)return [];
  const r=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});if(!r.ok)return [];
  const d:any=await r.json();const ids=(d.data??[]).map((m:any)=>m.id as string);if(all)return ids;return ids.filter((id:string)=>/^(gpt-6|gpt-5\.[4-9]|gpt-5\.\d+-mini|gpt-4\.1)/.test(id)&&!/(audio|realtime|transcribe|tts|image|search|codex|\d{4}-\d{2}-\d{2})/.test(id)).sort().reverse();
}
let cache:{at:number;ids:string[]}|null=null;
// The tier's model if this key can use it; otherwise the flagship, with a note the UI shows next to the reply.
export async function resolveTier(t:Tier):Promise<ModelChoice&{note?:string}>{
  const choice=(await modelSettings())[t];
  if(!cache||Date.now()-cache.at>3600_000){try{cache={at:Date.now(),ids:await availableModels(true)};}catch{cache={at:Date.now(),ids:[]};}}
  if(cache.ids.length&&!cache.ids.includes(choice.model)&&choice.model!==DEFAULT_SETTINGS.build.model)return {...DEFAULT_SETTINGS.build,note:`${choice.model} isn't available to this key; used ${DEFAULT_SETTINGS.build.model}.`};
  return choice;
}
