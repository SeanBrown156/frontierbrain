import {useState,useEffect,useRef} from 'react';
import type {PokemonSet} from '../../shared/workbench.ts';
import {api,Markdown,date} from '../ui.tsx';
import {Px,Sparkles,Message,Trash,Close} from '../icons.tsx';
import {Maximize2,Minimize2,History,Plus,ArrowLeft as Back} from 'lucide-react';
import {aiKey} from './keys.tsx';
import {useAccount,canUseAI,requireAccount,SignInForAI} from '../auth.tsx';
import {ProposalCard,acceptProposal,saveCoaching,describeProposal,type Proposal,type AcceptEnv} from './proposals.tsx';
import {getView} from '../team/editors.tsx';
import {BENCH_LABEL} from '../../shared/workbench.ts';
import {offer,leaveOffer,useOffers} from '../save-state.ts';

export type {Proposal};
export interface DockContext {page:'overview'|'slot'|'strategy'|'replays'|'versions'|'bench'|'general';versionId:string;slot?:number;benchId?:string;label?:string;}
interface Turn {role:'user'|'assistant';content:string;page?:string;proposals?:Proposal[];jobId?:string;failed?:boolean;model?:string;seconds?:number;note?:string;}
const stepNames:Record<string,string>={get_team:'Reading the team',team_pool_sets:'Looking up pool sets',meta_overview:'Reading the meta',standard_set:'Typical set',usage_data:'Usage data',calc_damage:'Damage calc',calc_speed:'Speed check',spread_search:'Spread search',dex_lookup:'Dex',validation:'Fixing a rules problem'};
// One chat per team, kept for the browser session. Opening Frontier Brain in a new session (a new tab or window)
// archives the previous chat into History and starts a clean one; History keeps the last 30 to look back at.
interface Chat {session:string;turns:Turn[];at?:string;}
interface Archived {id:string;teamId:string|null;teamName:string;at:string;turns:Turn[];}
const HISTORY='pokecoach.assist.history';
const session=(()=>{try{let s=sessionStorage.getItem('fb.session');if(!s){s=Math.random().toString(36).slice(2);sessionStorage.setItem('fb.session',s);}return s;}catch{return 'x';}})();
const readChat=(key:string):Chat=>{try{const v=JSON.parse(localStorage.getItem(key)??'null');return Array.isArray(v)?{session:'',turns:v}:v&&Array.isArray(v.turns)?v:{session:'',turns:[]};}catch{return {session:'',turns:[]};}};
const readHistory=():Archived[]=>{try{const v=JSON.parse(localStorage.getItem(HISTORY)??'[]');return Array.isArray(v)?v:[];}catch{return [];}};
const archive=(a:Archived)=>{if(!a.turns.some(t=>t.role==='user'))return;try{localStorage.setItem(HISTORY,JSON.stringify([a,...readHistory().filter(x=>x.id!==a.id)].slice(0,30)));}catch{}};
const asked=(turns:Turn[])=>turns.find(t=>t.role==='user')?.content??'Chat';
// Old per-panel chats (before the dock) are cleared once.
try{for(const k of Object.keys(localStorage))if(/^pokecoach\.assist\.(slot|strategy|coaching)-/.test(k))localStorage.removeItem(k);}catch{}
const describe=describeProposal;
// What the model sees: the last 10 turns, with the page each question was asked from and what the player did with proposals.
const asMessage=(t:Turn)=>t.role==='user'?{role:'user' as const,content:t.page?`[Asked from: ${t.page}]\n${t.content}`:t.content}:{role:'assistant' as const,content:[t.content,...(t.proposals??[]).map(p=>`[${p.kind} proposal ${describe(p)}: ${p.status??'no decision yet'}]`)].join('\n')};
const suggestionsFor=(page:string,species?:string)=>page==='slot'?[`What do top players run on ${species}? Match the best set`,`Retune ${species}'s spread for the most common threats`,`How much does ${species} do to a typical Incineroar?`]
  :page==='strategy'?['Write the overall game plan','Fill out lead plans for this team','Matchup plans for the 5 most common threats']
  :page==='bench'?['Suggest a Pokémon that could replace my weakest slot','What could replace the Pokémon that loses to Trick Room?','Add the most common Mega that fits this team']
  :page==='general'?['What’s winning in Regulation M-C right now?','What’s the most common Incineroar spread?','Which Pokémon handle Trick Room best?']
  :page==='replays'?['What do my games say about this team so far?','Which matchups should I plan for, given my results?']
  :['What are this team’s biggest weaknesses in the current meta?','Rewrite the strategy as a one-page game plan','Suggest one slot swap to handle Trick Room better'];

// One "Ask Frontier Brain" conversation per team, docked on every team page. It knows which page the player is on, runs each
// request as a background job (polling survives navigation because the dock lives in App) and returns proposals
// as tiles. Accepting routes each kind to its normal store action; a set for the open Pokémon loads into its draft.
export default function AssistDock({team,data,context,mutate,notify,open,setOpen,dataRef}:{team:any|null;data:any;context:DockContext;mutate:(a:any,o?:any)=>Promise<any>;notify:(s:string)=>void;open:boolean;setOpen:(b:boolean)=>void;dataRef:{current:any}}){
  const key=team?`pokecoach.assist.team-${team.id}`:'pokecoach.assist.general';
  // A chat from an earlier session is archived (its undecided suggestions go to the Inbox) and this one starts clean.
  const stale=useRef<Proposal[]>([]);
  const [turns,setTurns]=useState<Turn[]>(()=>{const c=readChat(key);if(c.session===session)return c.turns;stale.current=c.turns.flatMap(t=>t.proposals??[]).filter(p=>!p.status);if(c.turns.length){archive({id:`${key}:${c.at??''}:${c.turns.length}`,teamId:team?.id??null,teamName:team?.name??'General',at:c.at??new Date().toISOString(),turns:c.turns});try{localStorage.setItem(key,JSON.stringify({session,at:new Date().toISOString(),turns:[]}));}catch{}}return [];});
  const [draft,setDraft]=useState(''),[steps,setSteps]=useState<any[]>([]),[showSteps,setShowSteps]=useState(false),[expanded,setExpanded]=useState(false),[view_,setViewMode]=useState<'chat'|'history'>('chat'),[past,setPast]=useState<Archived|null>(null);
  const turnsRef=useRef(turns);turnsRef.current=turns;
  const end=useRef<HTMLDivElement>(null);const input=useRef<HTMLTextAreaElement>(null);const ai=canUseAI(useAccount());
  const versionId=!team?'':context.versionId==='all'?team.activeVersionId:context.versionId;const view=team?getView(team,data.db,versionId):null;
  const species=context.slot!==undefined?view?.sets[context.slot]?.species:undefined;
  const pageLabel=!team?context.label??'Frontier Brain':context.page==='slot'?`${species} (slot ${(context.slot??0)+1})`:context.page==='strategy'?'Strategy':context.page==='replays'?'Replays':context.page==='bench'?(context.benchId?`${(team.bench??[]).find((b:any)=>b.id===context.benchId)?.replaces??'Candidate'} candidate · ${BENCH_LABEL}`:BENCH_LABEL):context.page==='versions'?'Versions':'Team overview';
  const last=turns.at(-1);const pending=last?.jobId&&!last.proposals&&!last.failed?last.jobId:undefined;
  const save=(next:Turn[]|((prev:Turn[])=>Turn[]))=>setTurns(prev=>{const value=typeof next==='function'?next(prev):next;turnsRef.current=value;try{localStorage.setItem(key,JSON.stringify({session,at:new Date().toISOString(),turns:value.slice(-40)}));}catch{}return value;});
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[turns.length,steps.length,open]);
  useEffect(()=>{if(open)setTimeout(()=>input.current?.focus(),50);},[open]);
  useEffect(()=>{if(!pending)return;let alive=true;const tick=async()=>{try{const job=await api('/ai-job?id='+pending);if(!alive)return;setSteps(job.steps);showCalcs(job.steps);
      if(job.status!=='running'){const seconds=job.finishedAt?Math.round((Date.parse(job.finishedAt)-Date.parse(job.startedAt))/1000):undefined;
        save(prev=>prev.map(t=>t.jobId!==pending?t:job.status==='done'?{role:'assistant',content:job.result.reply||'Here is what I found.',proposals:job.result.proposals,model:job.model,seconds,note:job.modelNote}:{role:'assistant',content:job.error??'The request failed.',failed:true,model:job.model,seconds}));setSteps([]);}}catch{}};
    void tick();const t=setInterval(()=>void tick(),1500);return()=>{alive=false;clearInterval(t);};},[pending]);
  // On a Pokémon page, each damage or speed calc the assistant runs is replayed in the calc panel beside the chat.
  const shownCalcs=useRef(0);useEffect(()=>{shownCalcs.current=0;},[pending]);
  const showCalcs=(list:any[])=>{if(context.page!=='slot'||!team)return;const calcs=list.filter(x=>x.calc);for(const c of calcs.slice(shownCalcs.current))offer(`calc:${team.id}:${context.slot}`,{...c.calc,from:'Ask Frontier Brain'});shownCalcs.current=calcs.length;};
  const send=async(text:string,history=turns)=>{if(!text.trim()||pending)return;if(!ai){setDraft(text);requireAccount('Sign in for free to ask questions with your preferred AI tool.');return;}const next=[...history,{role:'user' as const,content:text.trim(),page:pageLabel}];
    try{const {id}=await api('/ai-jobs',{area:'assist',context:team?{teamId:team.id,versionId,configurationId:view!.version.currentConfigurationId,slot:context.slot,page:context.page}:{page:'general'},messages:next.filter(t=>!t.failed&&!t.jobId).slice(-10).map(asMessage)});save([...next,{role:'assistant',content:'',jobId:id}]);setDraft('');}
    catch(e){save([...next,{role:'assistant',content:(e as Error).message,failed:true}]);}};
  const retry=(ti:number)=>{const question=[...turns.slice(0,ti)].reverse().find(t=>t.role==='user');if(!question)return;const history=turns.slice(0,turns.lastIndexOf(question));void send(question.content,history);};
  // The calc can hand over a question (e.g. "find a spread that survives this").
  useOffers('dock:ask',q=>{setOpen(true);setDraft(q);setTimeout(()=>input.current?.focus(),60);return true;});
  const cancel=async()=>{if(pending)await api('/ai-job-cancel',{id:pending}).catch(()=>{});};

  // Accepting goes through the shared routine (also used by the Inbox); here a set for the open Pokémon loads into its draft.
  const env=():AcceptEnv=>({team,dataRef,mutate,versionId,page:{page:context.page,slot:context.slot,versionId:context.versionId,offer,leave:leaveOffer}});
  const accept=(p:Proposal)=>acceptProposal(p,env());
  const update=(ti:number,pi:number,patch:Partial<Proposal>)=>save(prev=>{const next=structuredClone(prev);Object.assign(next[ti].proposals![pi],patch);return next;});
  const decide=async(ti:number,pi:number,yes:boolean)=>{if(!yes){update(ti,pi,{status:'rejected'});return;}update(ti,pi,{status:'saving',error:undefined});
    try{const note=await accept(turns[ti].proposals![pi]);update(ti,pi,{status:'accepted',error:note||undefined});}catch(e){update(ti,pi,{status:undefined,error:(e as Error).message});}};
  const acceptAll=async(ti:number)=>{const open=turns[ti].proposals!.map((p,pi)=>({p,pi})).filter(({p})=>!p.status&&['lead','matchup','objective'].includes(p.kind));for(const {pi} of open)update(ti,pi,{status:'saving'});
    try{await saveCoaching(open.map(x=>x.p),env());for(const {pi} of open)update(ti,pi,{status:'accepted'});notify(`${open.length} plans added to Coaching.`);}catch(e){for(const {pi} of open)update(ti,pi,{status:undefined,error:(e as Error).message});}};
  // Anything proposed in the chat that was neither accepted nor rejected moves to the Inbox when the chat is closed,
  // replaced by a new one, or left for another team, so nothing is lost and nothing is applied behind the player's back.
  const flush=async()=>{if(!team)return;const list=turnsRef.current;const open:{ti:number;pi:number;p:Proposal}[]=[];
    list.forEach((t,ti)=>t.proposals?.forEach((p,pi)=>{if(!p.status)open.push({ti,pi,p});}));if(!open.length)return;
    save(prev=>{const next=structuredClone(prev);for(const {ti,pi} of open)if(next[ti]?.proposals?.[pi]&&!next[ti].proposals![pi].status)next[ti].proposals![pi].status='queued';return next;});
    for(const {p} of open){const {status,error,...clean}=p;await mutate({type:'pending-add',teamId:team.id,summary:'From Ask Frontier Brain',proposal:clean,source:'chat'},{quiet:true}).catch(()=>{});}
    notify(`${open.length} suggestion${open.length===1?'':'s'} moved to your Inbox.`);};
  // Suggestions left undecided in last session's chat go to the Inbox now, once.
  useEffect(()=>{const list=stale.current;stale.current=[];if(!team||!list.length)return;void (async()=>{for(const p of list){const {status,error,...clean}=p;await mutate({type:'pending-add',teamId:team.id,summary:'From Ask Frontier Brain',proposal:clean,source:'chat'},{quiet:true}).catch(()=>{});}notify(`${list.length} suggestion${list.length===1?'':'s'} from your last chat moved to your Inbox.`);})();},[]);
  const wasOpen=useRef(open);useEffect(()=>{if(wasOpen.current&&!open)void flush();wasOpen.current=open;},[open]);
  const flushRef=useRef(flush);flushRef.current=flush;useEffect(()=>()=>{void flushRef.current();},[]);
  const newChat=async()=>{await flush();archive({id:`${key}:${Date.now()}`,teamId:team?.id??null,teamName:team?.name??'General',at:new Date().toISOString(),turns:turnsRef.current});save([]);setViewMode('chat');setPast(null);};
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const el=e.target as HTMLElement;const typing=el.closest('input,textarea,select,[contenteditable]');
    if(e.key==='/'&&!typing&&!e.metaKey&&!e.ctrlKey){e.preventDefault();setOpen(true);}else if(e.key==='Escape'&&open&&!document.querySelector('dialog[open]'))setOpen(false);};addEventListener('keydown',onKey);return()=>removeEventListener('keydown',onKey);},[open]);
  if(!open)return <button className={'dock-toggle'+(pending?' busy':'')} onClick={()=>setOpen(true)} title="Ask Frontier Brain (press /)"><img className="dock-mark" src="/brand/icon-64.png" alt="" width={22} height={22}/>Ask Frontier Brain{pending&&<span className="dot" aria-label="working"/>}</button>;
  const shown=view_==='history'&&past?past.turns:turns;const readOnly=view_==='history';
  const dockEl=<aside className={'dock'+(expanded?' expanded':'')} aria-label="Ask Frontier Brain" {...(expanded?{role:'dialog','aria-modal':true} as any:{})}>
    <header className="dock-head"><h2><img className="dock-mark" src="/brand/icon-64.png" alt="" width={28} height={28}/>Ask Frontier Brain</h2>
      <div className="dock-corner"><button className="icon" aria-label={expanded?'Back to the side panel':'Expand to the centre of the screen'} title={expanded?'Side panel':'Expand'} onClick={()=>setExpanded(!expanded)}><Px icon={expanded?Minimize2:Maximize2}/></button><button className="icon dock-close" aria-label="Close" title="Close (Esc)" onClick={()=>setOpen(false)}><Px icon={Close}/></button></div></header>
    <nav className="dock-tabs" aria-label="Chat views"><button className={view_==='chat'?'on':''} aria-pressed={view_==='chat'} onClick={()=>{setPast(null);setViewMode('chat');}}>Chat</button><button className={view_==='history'?'on':''} aria-pressed={view_==='history'} onClick={()=>{setPast(null);setViewMode('history');}}><Px icon={History} size={14}/>Past chats</button>
      {turns.length>0&&!pending&&view_==='chat'&&<button className="text-button dock-new" onClick={()=>void newChat()}><Px icon={Plus} size={14}/>New chat</button>}</nav>
    {view_==='history'&&!past?<div className="dock-body"><div className="dock-log"><HistoryList onPick={setPast} onNew={()=>setViewMode('chat')}/></div></div>:null}
    {(view_==='chat'||past)&&<div className={"dock-body"+(ai?"":" locked")}><div className="dock-log" {...(ai?{}:{inert:true} as any)}>{past&&<div className="past-bar"><button className="text-button" onClick={()=>setPast(null)}><Px icon={Back} size={12}/>Past chats</button><span className="muted">{date(past.at)} · read only</span></div>}{!shown.length&&<div className="chat-empty"><p>{team?<>Ask anything about {team.name}.{' Frontier Brain checks the data pool and runs calcs, then proposes changes you can accept or reject.'}</>:'Ask about the metagame, sets, spreads and calcs. Open a team to ask about it or change it.'}</p></div>}
      {shown.map((t,ti)=>t.jobId&&!t.proposals&&!t.failed&&!readOnly?<div key={ti} className="chat-turn assistant working"><p><Px icon={Sparkles}/>{steps.length?`${stepNames[steps.at(-1).name]??steps.at(-1).name}${steps.at(-1).input?`: ${steps.at(-1).input}`:''}`:'Starting…'} <span className="muted">· {steps.length} step{steps.length===1?'':'s'}</span></p>
          <div className="button-row"><button className="text-button" onClick={()=>setShowSteps(!showSteps)}>{showSteps?'Hide':'Show'} steps</button><button className="text-button" onClick={()=>void cancel()}>Cancel</button></div>{showSteps&&<ol className="steps">{steps.map((s,i)=><li key={i} className={s.error?'error':''}>{stepNames[s.name]??s.name}{s.input?`: ${s.input}`:''}</li>)}</ol>}</div>
        :<div key={ti} className={'chat-turn '+t.role+(t.failed?' error':'')}>{t.role==='user'&&t.page&&<span className="asked-from">{t.page}</span>}{t.role==='assistant'&&!t.failed?<Markdown text={t.content}/>:<p>{t.content}</p>}
          {t.failed&&!readOnly&&<button onClick={()=>retry(ti)} disabled={!!pending}>Retry</button>}
          {t.proposals?.length?<div className="proposals">{t.proposals.map((p,pi)=><ProposalCard key={pi} p={p} art={data.art} current={slot=>view?.sets[slot]} decide={yes=>void decide(ti,pi,yes)} readOnly={readOnly}/>)}</div>:null}
          {!readOnly&&(t.proposals?.filter(p=>!p.status&&['lead','matchup'].includes(p.kind)).length??0)>1&&<button className="primary" onClick={()=>void acceptAll(ti)}>Accept all plans</button>}
          {t.role==='assistant'&&(t.model||t.note)&&<p className="model-line">{t.model}{t.seconds!==undefined?` · ${t.seconds} s`:''}{t.note?` · ${t.note}`:''}</p>}</div>)}<div ref={end}/></div>
    {!readOnly&&<div className="dock-rest" {...(ai?{}:{inert:true} as any)}>{!turns.length&&<div className="chat-suggestions">{suggestionsFor(context.page,species).map(s=><button key={s} onClick={()=>void send(s)}>{s}</button>)}</div>}
    <form className="dock-input" onSubmit={e=>{e.preventDefault();void send(draft);}}><div className="dock-meta"><span className="context-chip" title="What Frontier Brain is looking at">Looking at: {pageLabel}</span>{ai&&<KeyOrModel/>}</div>
      <div className="chat-input"><textarea ref={input} rows={2} value={draft} placeholder={context.page==='slot'?`e.g. Make ${species} survive a typical Mega Gengar Shadow Ball`:team?'Ask about this team…':'Ask about the metagame, sets or calcs…'} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(draft);}}}/><button className="primary" disabled={!!pending||!draft.trim()} aria-label="Send"><Px icon={Message}/></button></div></form></div>}{!ai&&<div className="dock-lock"><SignInForAI verb="ask questions"/></div>}</div>}
  </aside>;
  return expanded?<div className="dock-scrim" onMouseDown={e=>{if(e.target===e.currentTarget)setExpanded(false);}}>{dockEl}</div>:dockEl;
}

// Earlier chats, newest first. Opening one shows it read only; the Inbox has anything that was left undecided.
function HistoryList({onPick,onNew}:{onPick:(a:Archived)=>void;onNew:()=>void}){
  const list=readHistory();
  if(!list.length)return <div className="chat-empty"><p>No past chats yet. A chat is kept here once you start a new one, or when you open Frontier Brain in a new session.</p><button onClick={onNew}>Back to the chat</button></div>;
  return <ul className="history-list">{list.map(a=><li key={a.id}><button onClick={()=>onPick(a)}><b>{asked(a.turns).slice(0,90)}</b><span className="muted">{a.teamName} · {date(a.at)} · {a.turns.filter(t=>t.role==='user').length} question{a.turns.filter(t=>t.role==='user').length===1?'':'s'}</span></button></li>)}</ul>;
}


// Which model answers. Saved locally (settings.json); chats default to gpt-6-luna, team builds to gpt-6-astra.
let modelList:Promise<string[]>|null=null;
// Does an AI key work right now (one in Settings, or the local .env key)? Cached once it does.
export async function aiReady():Promise<boolean>{const l=await (modelList??=api('/models').catch(()=>[]));if(!l.length)modelList=null;return l.length>0;}
// Before a key works there's nothing to choose between: show "Add AI key". Once the provider lists models (a key in
// Settings, or the local .env key), show the model picker instead.
function KeyOrModel(){const [list,setList]=useState<string[]|null>(null);useEffect(()=>{(modelList??=api('/models').catch(()=>[])).then(l=>{if(!l.length)modelList=null;setList(l);});},[]);
  if(list===null)return null;return list.length?<ModelPicker tier="chat"/>:<a className="button compact" href="#account" title="Your AI key lives in Account">Add AI key</a>;}
export function ModelPicker({tier}:{tier:'chat'|'build'}){
  const [models,setModels]=useState<any>(null),[list,setList]=useState<string[]>([]);
  useEffect(()=>{api('/settings').then(r=>setModels(r.models)).catch(()=>{});(modelList??=api('/models').catch(()=>[])).then(setList);},[]);
  if(!models||!list.length)return null;const current=models[tier].model;const claude=models.provider==='anthropic';const options=[...new Set([current,...(claude?['claude-haiku-4-5','claude-sonnet-5-5','claude-opus-5-5',...list.filter(m=>m.startsWith('claude'))]:['gpt-6-luna','gpt-6-sol','gpt-6-astra',...list.filter(m=>m.startsWith('gpt-6'))])])];
  const choose=async(model:string)=>{try{setModels((await api('/settings',{models:{[tier]:{...models[tier],model}}})).models);}catch{}};
  return <label className="model-picker" title="Which model answers"><span className="sr-only">Model</span><select value={current} onChange={e=>void choose(e.target.value)}>{options.map(m=><option key={m} value={m}>{m.replace('gpt-','').replace('claude-','')}</option>)}</select></label>;
}
