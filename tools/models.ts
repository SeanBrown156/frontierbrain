// Which model each kind of AI work uses, per provider (OpenAI or Anthropic, whichever key the user brings).
// Chats default to a light model, team builds to the flagship. The player picks them in the Ask Frontier Brain panel
// and the New team dialog, which write settings.json in their data. Saved settings win over .env OPENAI_MODEL.
import {optionalJSON,save,activeAI,type AIProvider} from './io.ts';

export type Tier='chat'|'build';
export type Effort='minimal'|'low'|'medium'|'high';
export interface ModelChoice {model:string;effort:Effort;}
export interface ModelSettings {chat:ModelChoice;build:ModelChoice;}
export const DEFAULTS:Record<AIProvider,ModelSettings>={
  openai:{chat:{model:'gpt-6-luna',effort:'low'},build:{model:'gpt-6-astra',effort:'medium'}},
  anthropic:{chat:{model:'claude-haiku-4-5',effort:'low'},build:{model:'claude-sonnet-5-5',effort:'medium'}},
};
export const DEFAULT_SETTINGS=DEFAULTS.openai;
export const defaultModel=(provider:AIProvider,tier:Tier)=>DEFAULTS[provider][tier].model;
const FILE='settings.json';const efforts:Effort[]=['minimal','low','medium','high'];
const provider=():AIProvider=>activeAI()?.provider??'openai';
const settingsKey=(p:AIProvider)=>p==='openai'?'models':'anthropicModels';
const belongs=(p:AIProvider,model:string)=>p==='anthropic'?model.startsWith('claude'):!model.startsWith('claude');
// Only reasoning models accept `reasoning.effort`; older chat models (gpt-4.x, gpt-4o) reject it.
export const supportsReasoning=(model:string)=>/^(gpt-5|gpt-6|o\d)/.test(model)&&!/chat-latest/.test(model);
export async function modelSettings(p:AIProvider=provider()):Promise<ModelSettings&{provider:AIProvider}>{
  const saved=(await optionalJSON<any>(FILE,{}).catch(()=>({})))?.[settingsKey(p)];
  const pick=(t:Tier):ModelChoice=>{const model=typeof saved?.[t]?.model==='string'&&belongs(p,saved[t].model)?saved[t].model:(p==='openai'&&t==='chat'&&process.env.OPENAI_MODEL)||DEFAULTS[p][t].model;return {model,effort:efforts.includes(saved?.[t]?.effort)?saved[t].effort:DEFAULTS[p][t].effort};};
  return {provider:p,chat:pick('chat'),build:pick('build')};
}
export async function saveModelSettings(input:any){
  const p=provider();const {provider:_,...current}=await modelSettings(p);const next:ModelSettings={...current};
  for(const t of ['chat','build'] as Tier[]){const v=input?.[t];if(!v)continue;if(typeof v.model!=='string'||!/^[a-z0-9.\-]{2,60}$/.test(v.model))throw new Error('Invalid model name');if(!efforts.includes(v.effort))throw new Error('Invalid effort');next[t]={model:v.model,effort:v.effort};}
  const saved=await optionalJSON<any>(FILE,{}).catch(()=>({}));await save(FILE,{...saved,[settingsKey(p)]:next});return {provider:p,...next};
}
// Models the caller's key can use, filtered to text models worth offering.
export async function availableModels(all=false){
  const creds=activeAI();if(!creds)return [];
  if(creds.provider==='anthropic'){
    const r=await fetch('https://api.anthropic.com/v1/models?limit=100',{headers:{'x-api-key':creds.key,'anthropic-version':'2023-06-01'},signal:AbortSignal.timeout(15000)});if(!r.ok)return [];
    const d:any=await r.json();const ids=(d.data??[]).map((m:any)=>m.id as string);return all?ids:ids.filter((id:string)=>id.startsWith('claude'));
  }
  const r=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${creds.key}`},signal:AbortSignal.timeout(15000)});if(!r.ok)return [];
  const d:any=await r.json();const ids=(d.data??[]).map((m:any)=>m.id as string);if(all)return ids;return ids.filter((id:string)=>/^(gpt-6|gpt-5\.[4-9]|gpt-5\.\d+-mini|gpt-4\.1)/.test(id)&&!/(audio|realtime|transcribe|tts|image|search|codex|\d{4}-\d{2}-\d{2})/.test(id)).sort().reverse();
}
// Keyed by key fingerprint so two users' keys never share a model list.
const cache=new Map<string,{at:number;ids:string[]}>();
// The tier's model if this key can use it; otherwise the provider's flagship, with a note the UI shows next to the reply.
export async function resolveTier(t:Tier):Promise<ModelChoice&{note?:string}>{
  const p=provider();const choice=(await modelSettings(p))[t];const key=`${p}:${(activeAI()?.key??'').slice(-8)}`;
  let entry=cache.get(key);if(!entry||Date.now()-entry.at>3600_000){try{entry={at:Date.now(),ids:await availableModels(true)};}catch{entry={at:Date.now(),ids:[]};}cache.set(key,entry);}
  const flagship=DEFAULTS[p].build;
  if(entry.ids.length&&!entry.ids.includes(choice.model)&&choice.model!==flagship.model)return {...flagship,note:`${choice.model} isn't available to this key; used ${flagship.model}.`};
  return choice;
}
