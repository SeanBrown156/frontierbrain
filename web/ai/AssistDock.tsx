import {useState,useEffect,useRef} from 'react';
import type {PokemonSet} from '../../shared/workbench.ts';
import {api,Art,Markdown} from '../ui.tsx';
import {Px,Sparkles,Message,Trash,Close} from '../icons.tsx';
import {AIKeySettings} from './keys.tsx';
import {useAccount,canUseAI,requireAccount,SignInForAI} from '../auth.tsx';
import SetTile from './SetTile.tsx';
import {getView} from '../team/editors.tsx';
import {teamHref,addPlans} from '../team/Hub.tsx';
import {offer,leaveOffer,useOffers} from '../save-state.ts';

export interface Proposal {kind:'set'|'team'|'lead'|'matchup'|'objective'|'strategy';status?:'accepted'|'rejected'|'saving';error?:string;[k:string]:any;}
export interface DockContext {page:'overview'|'slot'|'strategy'|'replays'|'versions'|'general';versionId:string;slot?:number;label?:string;}
interface Turn {role:'user'|'assistant';content:string;page?:string;proposals?:Proposal[];jobId?:string;failed?:boolean;model?:string;seconds?:number;note?:string;}
const stepNames:Record<string,string>={get_team:'Reading the team',team_pool_sets:'Looking up pool sets',meta_overview:'Reading the meta',standard_set:'Typical set',usage_data:'Usage data',calc_damage:'Damage calc',calc_speed:'Speed check',spread_search:'Spread search',dex_lookup:'Dex',validation:'Fixing a rules problem'};
const load=(key:string):Turn[]=>{try{return JSON.parse(localStorage.getItem(key)??'[]');}catch{return [];}};
// Old per-panel chats (before the dock) are cleared once.
try{for(const k of Object.keys(localStorage))if(/^pokecoach\.assist\.(slot|strategy|coaching)-/.test(k))localStorage.removeItem(k);}catch{}
const describe=(p:Proposal)=>p.kind==='set'?`${p.set.species} for slot ${p.slot+1}`:p.kind==='team'?p.name:p.lead?.join(' + ')??p.opponent??p.text?.slice(0,60);
// What the model sees: the last 10 turns, with the page each question was asked from and what the player did with proposals.
const asMessage=(t:Turn)=>t.role==='user'?{role:'user' as const,content:t.page?`[Asked from: ${t.page}]\n${t.content}`:t.content}:{role:'assistant' as const,content:[t.content,...(t.proposals??[]).map(p=>`[${p.kind} proposal ${describe(p)}: ${p.status??'no decision yet'}]`)].join('\n')};
const suggestionsFor=(page:string,species?:string)=>page==='slot'?[`What do top players run on ${species}? Match the best set`,`Retune ${species}'s spread for the most common threats`,`How much does ${species} do to a typical Incineroar?`]
  :page==='strategy'?['Write the overall game plan','Fill out lead plans for this team','Matchup plans for the 5 most common threats']
  :page==='general'?['What’s winning in Regulation M-C right now?','What’s the most common Incineroar spread?','Which Pokémon handle Trick Room best?']
  :page==='replays'?['What do my games say about this team so far?','Which matchups should I plan for, given my results?']
  :['What are this team’s biggest weaknesses in the current meta?','Rewrite the strategy as a one-page game plan','Suggest one slot swap to handle Trick Room better'];

// One "Ask Frontier Brain" conversation per team, docked on every team page. It knows which page the player is on, runs each
// request as a background job (polling survives navigation because the dock lives in App) and returns proposals
// as tiles. Accepting routes each kind to its normal store action; a set for the open Pokémon loads into its draft.
export default function AssistDock({team,data,context,mutate,notify,open,setOpen,dataRef}:{team:any|null;data:any;context:DockContext;mutate:(a:any)=>Promise<any>;notify:(s:string)=>void;open:boolean;setOpen:(b:boolean)=>void;dataRef:{current:any}}){
  const key=team?`pokecoach.assist.team-${team.id}`:'pokecoach.assist.general';const [turns,setTurns]=useState<Turn[]>(()=>load(key)),[draft,setDraft]=useState(''),[steps,setSteps]=useState<any[]>([]),[showSteps,setShowSteps]=useState(false);
  const end=useRef<HTMLDivElement>(null);const input=useRef<HTMLTextAreaElement>(null);const ai=canUseAI(useAccount());
  const versionId=!team?'':context.versionId==='all'?team.activeVersionId:context.versionId;const view=team?getView(team,data.db,versionId):null;
  const species=context.slot!==undefined?view?.sets[context.slot]?.species:undefined;
  const pageLabel=!team?context.label??'Frontier Brain':context.page==='slot'?`${species} (slot ${(context.slot??0)+1})`:context.page==='strategy'?'Strategy':context.page==='replays'?'Replays':context.page==='versions'?'Versions':'Team overview';
  const last=turns.at(-1);const pending=last?.jobId&&!last.proposals&&!last.failed?last.jobId:undefined;
  const save=(next:Turn[]|((prev:Turn[])=>Turn[]))=>setTurns(prev=>{const value=typeof next==='function'?next(prev):next;try{localStorage.setItem(key,JSON.stringify(value.slice(-40)));}catch{}return value;});
  useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[turns.length,steps.length,open]);
  useEffect(()=>{if(open)setTimeout(()=>input.current?.focus(),50);},[open]);
  useEffect(()=>{if(!pending)return;let alive=true;const tick=async()=>{try{const job=await api('/ai-job?id='+pending);if(!alive)return;setSteps(job.steps);
      if(job.status!=='running'){const seconds=job.finishedAt?Math.round((Date.parse(job.finishedAt)-Date.parse(job.startedAt))/1000):undefined;
        save(prev=>prev.map(t=>t.jobId!==pending?t:job.status==='done'?{role:'assistant',content:job.result.reply||'Here is what I found.',proposals:job.result.proposals,model:job.model,seconds,note:job.modelNote}:{role:'assistant',content:job.error??'The request failed.',failed:true,model:job.model,seconds}));setSteps([]);}}catch{}};
    void tick();const t=setInterval(()=>void tick(),1500);return()=>{alive=false;clearInterval(t);};},[pending]);
  const send=async(text:string,history=turns)=>{if(!text.trim()||pending)return;if(!ai){setDraft(text);requireAccount('Sign in for free to ask questions with your preferred AI tool.');return;}const next=[...history,{role:'user' as const,content:text.trim(),page:pageLabel}];
    try{const {id}=await api('/ai-jobs',{area:'assist',context:team?{teamId:team.id,versionId,configurationId:view!.version.currentConfigurationId,slot:context.slot,page:context.page}:{page:'general'},messages:next.filter(t=>!t.failed&&!t.jobId).slice(-10).map(asMessage)});save([...next,{role:'assistant',content:'',jobId:id}]);setDraft('');}
    catch(e){save([...next,{role:'assistant',content:(e as Error).message,failed:true}]);}};
  const retry=(ti:number)=>{const question=[...turns.slice(0,ti)].reverse().find(t=>t.role==='user');if(!question)return;const history=turns.slice(0,turns.lastIndexOf(question));void send(question.content,history);};
  // The calc can hand over a question (e.g. "find a spread that survives this").
  useOffers('dock:ask',q=>{setOpen(true);setDraft(q);setTimeout(()=>input.current?.focus(),60);return true;});
  const cancel=async()=>{if(pending)await api('/ai-job-cancel',{id:pending}).catch(()=>{});};

  // Accepting: every kind goes through the existing store actions, reading the latest data (not this render's).
  const accept=async(p:Proposal):Promise<string|void>=>{
    const latest=dataRef.current;const t=latest.teams.find((x:any)=>x.id===team.id);const v=getView(t,latest.db,versionId);
    if(p.kind==='set'){
      if(context.page==='slot'&&context.slot===p.slot&&offer(`set:${team.id}:${p.slot}`,p))return 'Loaded into the set card. Review it, then Save.';
      const now=v.sets[p.slot];if(p.forSpecies&&now?.species!==p.forSpecies&&!confirm(`Slot ${p.slot+1} is now ${now?.species}, not ${p.forSpecies}. Replace it with ${p.set.species} anyway?`))throw new Error('Not applied.');
      await mutate({type:'team-replace-sets',teamId:team.id,versionId,sets:[{slot:p.slot,set:p.set,baseRevisionId:v.slots[p.slot].revisionId,note:`AI: ${p.why}`}],summary:`AI: ${p.set.species} in slot ${p.slot+1}`});return;}
    if(p.kind==='team'){const r=await mutate({type:'team-replace-sets',teamId:team.id,versionId,parentConfigurationId:v.version.currentConfigurationId,sets:p.sets.map((set:any,slot:number)=>({slot,set})),summary:`AI rebuild: ${p.name}`,newVersion:true,notes:p.strategy||v.version.notes});
      await addPlans(t,dataRef.current,mutate,p,r.result.versionId);location.hash=teamHref(team.id,'overview',r.result.versionId);return 'Saved as a new version (not active). Make it active from its page when you are happy.';}
    if(p.kind==='strategy'){if(offer(`strategy:${team.id}`,p.text))return 'Loaded into the strategy editor. Review it, then Save.';leaveOffer(`strategy:${team.id}`,p.text);location.hash=teamHref(team.id,'strategy',context.versionId);return 'Opened in the strategy editor.';}
    await saveCoaching([p]);};
  const saveCoaching=async(ps:Proposal[])=>{const latest=dataRef.current;const c=latest.db.coaching?.[team.id]??{teamId:team.id,version:0,leads:[],matchups:[],objectives:[]};const id=()=>Math.random().toString(36).slice(2,12);const scope=context.versionId==='all'?[]:[context.versionId];
    const leads=[...c.leads],matchups=[...c.matchups],objectives=[...c.objectives];
    for(const p of ps){if(p.kind==='lead')leads.push({id:id(),lead:p.lead,back:p.back,when:p.when,plan:p.plan,calcIds:[],versionIds:scope,status:'active'});else if(p.kind==='matchup')matchups.push({id:id(),opponent:p.opponent,threat:p.threat,bring:p.bring,plan:p.plan,calcIds:[],versionIds:scope,status:'active'});else if(p.kind==='objective')objectives.push({id:id(),kind:p.type,text:p.text,done:false});}
    await mutate({type:'coaching-save',teamId:team.id,parentVersion:c.version,coaching:{...c,leads,matchups,objectives}});};
  const update=(ti:number,pi:number,patch:Partial<Proposal>)=>save(prev=>{const next=structuredClone(prev);Object.assign(next[ti].proposals![pi],patch);return next;});
  const decide=async(ti:number,pi:number,yes:boolean)=>{if(!yes){update(ti,pi,{status:'rejected'});return;}update(ti,pi,{status:'saving',error:undefined});
    try{const note=await accept(turns[ti].proposals![pi]);update(ti,pi,{status:'accepted',error:note||undefined});}catch(e){update(ti,pi,{status:undefined,error:(e as Error).message});}};
  const acceptAll=async(ti:number)=>{const open=turns[ti].proposals!.map((p,pi)=>({p,pi})).filter(({p})=>!p.status&&['lead','matchup','objective'].includes(p.kind));for(const {pi} of open)update(ti,pi,{status:'saving'});
    try{await saveCoaching(open.map(x=>x.p));for(const {pi} of open)update(ti,pi,{status:'accepted'});notify(`${open.length} plans added to Coaching.`);}catch(e){for(const {pi} of open)update(ti,pi,{status:undefined,error:(e as Error).message});}};

  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{const el=e.target as HTMLElement;const typing=el.closest('input,textarea,select,[contenteditable]');
    if(e.key==='/'&&!typing&&!e.metaKey&&!e.ctrlKey){e.preventDefault();setOpen(true);}else if(e.key==='Escape'&&open&&!document.querySelector('dialog[open]'))setOpen(false);};addEventListener('keydown',onKey);return()=>removeEventListener('keydown',onKey);},[open]);
  if(!open)return <button className={'dock-toggle'+(pending?' busy':'')} onClick={()=>setOpen(true)} title="Ask Frontier Brain (press /)"><Px icon={Sparkles}/>Ask Frontier Brain{pending&&<span className="dot" aria-label="working"/>}</button>;
  return <aside className="dock" aria-label="Ask Frontier Brain">
    <header className="dock-head"><h2><Px icon={Sparkles}/>Ask Frontier Brain</h2><div className="button-row">{ai&&<><AIKeySettings onChange={()=>location.reload()}/><ModelPicker tier="chat"/></>}{turns.length>0&&!pending&&<button className="icon" title="New chat" aria-label="New chat" onClick={()=>save([])}><Px icon={Trash}/></button>}<button className="icon" aria-label="Close" title="Close (Esc)" onClick={()=>setOpen(false)}><Px icon={Close}/></button></div></header>
    <div className={"dock-body"+(ai?"":" locked")}><div className="dock-log" {...(ai?{}:{inert:true} as any)}>{!turns.length&&<div className="chat-empty"><p>{team?<>Ask anything about {team.name}.{' Frontier Brain checks the data pool and runs calcs, then proposes changes you can accept or reject.'}</>:'Ask about the metagame, sets, spreads and calcs. Open a team to ask about it or change it.'}</p></div>}
      {turns.map((t,ti)=>t.jobId&&!t.proposals&&!t.failed?<div key={ti} className="chat-turn assistant working"><p><Px icon={Sparkles}/>{steps.length?`${stepNames[steps.at(-1).name]??steps.at(-1).name}${steps.at(-1).input?`: ${steps.at(-1).input}`:''}`:'Starting…'} <span className="muted">· {steps.length} step{steps.length===1?'':'s'}</span></p>
          <div className="button-row"><button className="text-button" onClick={()=>setShowSteps(!showSteps)}>{showSteps?'Hide':'Show'} steps</button><button className="text-button" onClick={()=>void cancel()}>Cancel</button></div>{showSteps&&<ol className="steps">{steps.map((s,i)=><li key={i} className={s.error?'error':''}>{stepNames[s.name]??s.name}{s.input?`: ${s.input}`:''}</li>)}</ol>}</div>
        :<div key={ti} className={'chat-turn '+t.role+(t.failed?' error':'')}>{t.role==='user'&&t.page&&<span className="asked-from">{t.page}</span>}{t.role==='assistant'&&!t.failed?<Markdown text={t.content}/>:<p>{t.content}</p>}
          {t.failed&&<button onClick={()=>retry(ti)} disabled={!!pending}>Retry</button>}
          {t.proposals?.length?<div className="proposals">{t.proposals.map((p,pi)=><ProposalCard key={pi} p={p} art={data.art} current={slot=>view?.sets[slot]} decide={yes=>void decide(ti,pi,yes)}/>)}</div>:null}
          {(t.proposals?.filter(p=>!p.status&&['lead','matchup'].includes(p.kind)).length??0)>1&&<button className="primary" onClick={()=>void acceptAll(ti)}>Accept all plans</button>}
          {t.role==='assistant'&&(t.model||t.note)&&<p className="model-line">{t.model}{t.seconds!==undefined?` · ${t.seconds} s`:''}{t.note?` · ${t.note}`:''}</p>}</div>)}<div ref={end}/></div>
    {<div className="dock-rest" {...(ai?{}:{inert:true} as any)}>{!turns.length&&<div className="chat-suggestions">{suggestionsFor(context.page,species).map(s=><button key={s} onClick={()=>void send(s)}>{s}</button>)}</div>}
    <form className="dock-input" onSubmit={e=>{e.preventDefault();void send(draft);}}><span className="context-chip" title="What Frontier Brain is looking at">Looking at: {pageLabel}</span>
      <div className="chat-input"><textarea ref={input} rows={2} value={draft} placeholder={context.page==='slot'?`e.g. Make ${species} survive a typical Mega Gengar Shadow Ball`:team?'Ask about this team…':'Ask about the metagame, sets or calcs…'} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send(draft);}}}/><button className="primary" disabled={!!pending||!draft.trim()} aria-label="Send"><Px icon={Message}/></button></div></form></div>}{!ai&&<div className="dock-lock"><SignInForAI verb="ask questions"/></div>}</div>
  </aside>;
}

function ProposalCard({p,art,current,decide}:{p:Proposal;art:any;current:(slot:number)=>PokemonSet|undefined;decide:(accept:boolean)=>void}){
  const actions=p.status==='accepted'?<span className="tag ok">Accepted</span>:p.status==='rejected'?<span className="tag">Rejected</span>:<><button className="primary" disabled={p.status==='saving'} onClick={()=>decide(true)}>{p.status==='saving'?'Saving…':'Accept'}</button><button disabled={p.status==='saving'} onClick={()=>decide(false)}>Reject</button></>;
  const note=p.error&&<p className={p.status==='accepted'?'muted':'error'}>{p.error}</p>;
  const foot=<>{note}<div className="button-row">{actions}</div></>;
  if(p.kind==='set')return <SetTile set={p.set} current={current(p.slot)} art={art} note={p.why} actions={<>{note}{actions}</>}/>;
  if(p.kind==='team')return <article className="proposal-card"><h3>{p.name}</h3><div className="team-six">{p.sets.map((s:PokemonSet)=><Art key={s.species} name={s.species} art={art} small/>)}</div><details><summary>Sets, strategy and plans</summary><pre className="paste">{p.paste}</pre><Markdown text={p.strategy}/><p className="muted">{p.leads.length} lead plan(s) and {p.matchups.length} matchup plan(s) come with it as drafts.</p></details><p className="muted">Accepting saves it as a new version; your current version stays active.</p>{foot}</article>;
  if(p.kind==='lead')return <article className="proposal-card"><div className="pair">{p.lead.map((m:string)=><Art key={m} name={m} art={art} small/>)}<h3>{p.lead.join(' + ')}</h3></div>{p.back?.length>0&&<p className="muted">Back: {p.back.join(', ')}</p>}{p.when&&<p><b>When:</b> {p.when}</p>}<Markdown text={p.plan}/>{foot}</article>;
  if(p.kind==='matchup')return <article className="proposal-card"><h3><span className={'threat '+p.threat}>{p.threat}</span> {p.opponent}</h3><div className="pair">{p.bring.map((m:string)=><Art key={m} name={m} art={art} small/>)}</div><Markdown text={p.plan}/>{foot}</article>;
  if(p.kind==='objective')return <article className="proposal-card"><p>{p.type==='test'?'Test:':'To-do:'} {p.text}</p>{foot}</article>;
  return <article className="proposal-card"><span className="eyebrow">Strategy rewrite</span><Markdown text={p.text}/>{foot}</article>;
}

// Which model answers. Saved locally (settings.json); chats default to gpt-6-luna, team builds to gpt-6-astra.
let modelList:Promise<string[]>|null=null;
export function ModelPicker({tier}:{tier:'chat'|'build'}){
  const [models,setModels]=useState<any>(null),[list,setList]=useState<string[]>([]);
  useEffect(()=>{api('/settings').then(r=>setModels(r.models)).catch(()=>{});(modelList??=api('/models').catch(()=>[])).then(setList);},[]);
  if(!models)return null;const current=models[tier].model;const claude=models.provider==='anthropic';const options=[...new Set([current,...(claude?['claude-haiku-4-5','claude-sonnet-5-5','claude-opus-5-5',...list.filter(m=>m.startsWith('claude'))]:['gpt-6-luna','gpt-6-sol','gpt-6-astra',...list.filter(m=>m.startsWith('gpt-6'))])])];
  const choose=async(model:string)=>{try{setModels((await api('/settings',{models:{[tier]:{...models[tier],model}}})).models);}catch{}};
  return <label className="model-picker" title="Which model answers"><span className="sr-only">Model</span><select value={current} onChange={e=>void choose(e.target.value)}>{options.map(m=><option key={m} value={m}>{m.replace('gpt-','').replace('claude-','')}</option>)}</select></label>;
}
