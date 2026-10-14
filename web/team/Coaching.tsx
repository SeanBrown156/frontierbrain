import type React from 'react';
import {useState,useEffect,useLayoutEffect,useRef} from 'react';
import {TEAM_STYLES,type TeamCoaching,type LeadPlan,type MatchupPlan,type Objective} from '../../shared/workbench.ts';
import {api,Art,Panel,Modal,Notice,pct,Markdown,SetArt} from '../ui.tsx';
import {useDirty} from '../save-state.ts';
import SpeciesPicker from '../ai/SpeciesPicker.tsx';
import {formName} from '../BenchmarkLab.tsx';
import {versionName} from './editors.tsx';
import {Px,Plus,Pencil,Check,Trash,ChevronDown} from '../icons.tsx';

const newId=()=>Math.random().toString(36).slice(2,12);
const empty=(teamId:string):TeamCoaching=>({teamId,version:0,updatedAt:'',leads:[],matchups:[],objectives:[]});
const SMALL=5;
// One plan, lead or matchup, with the same header: title on the left, actions top right (above it on very small
// screens). On a phone a long write-up folds to its first lines with a More toggle; desktop always shows it all.
const FOLD=112;
export function PlanCard({status,head,meta,summary,body,foot,accept,edit,remove}:{status:string;head:React.ReactNode;meta?:React.ReactNode;summary?:string;body:string;foot?:React.ReactNode;accept?:()=>void;edit:()=>void;remove:()=>void}){
  const [open,setOpen]=useState(false),[long,setLong]=useState(false);const inner=useRef<HTMLDivElement>(null);
  // Measured from the children, which the fold never resizes, so toggling it can't flip the measurement.
  useLayoutEffect(()=>{const el=inner.current;if(!el)return;const check=()=>setLong([...el.children].reduce((h,c)=>h+(c as HTMLElement).offsetHeight,0)>FOLD);check();const ro=new ResizeObserver(check);ro.observe(el);return()=>ro.disconnect();},[summary,body]);
  return <article className={'plan-card '+status}><header className="plan-top"><div className="plan-head">{head}{status==='proposed'&&<span className="tag">AI draft</span>}</div>
      <div className="plan-actions">{accept&&<button className="compact primary" onClick={accept}>Accept</button>}<button className="icon" title="Edit" aria-label="Edit" onClick={edit}><Px icon={Pencil} size={16}/></button><button className="icon" title="Delete" aria-label="Delete" onClick={remove}><Px icon={Trash} size={16}/></button></div></header>
    {meta}
    {(summary||body.trim())&&<div className={'plan-body'+(long&&!open?' folded':'')}><div className="plan-copy" ref={inner}>{summary&&<p className="plan-summary">{summary}</p>}{body.trim()&&<Markdown text={body}/>}</div>
      {long&&<button type="button" className="text-button plan-more" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Less':'More'}<Px icon={ChevronDown} size={14}/></button>}</div>}
    {foot&&<div className="plan-foot">{foot}</div>}
  </article>;
}
// Lead and matchup plans share one panel: title, New, the list, and an empty line.
function PlanPanel({title,onNew,empty,children}:{title:string;onNew:()=>void;empty?:string;children:React.ReactNode}){
  return <Panel title={title} className="plan-panel" action={<button onClick={onNew}><Px icon={Plus}/>New</button>}><div className="plan-list">{children}</div>{empty&&<p className="muted">{empty}</p>}</Panel>;
}
// A lead's role: set explicitly, or read from an older plan's "CORE · …" prefix (shown as the pill, not repeated in the text).
const ROLE_PREFIX=/^\s*(core|situational|niche|avoid)\s*[·:\-–]\s*/i;
export const leadRole=(l:Pick<LeadPlan,'role'|'when'>)=>l.role??(l.when.match(ROLE_PREFIX)?.[1].toLowerCase() as LeadPlan['role']|undefined);
const whenText=(l:LeadPlan)=>l.when.replace(ROLE_PREFIX,'');
export function RolePill({role}:{role?:string}){return role?<span className={'role-pill '+role}>{role}</span>:null;}
// Lead and matchup plans for one team (shown under Strategy; older saved objectives are kept but not shown). Observed tables are computed from linked replays;
// plans are the player's (or AI drafts he accepts). Every save is a stale-checked revision of teams/<id>/coaching.json.
export default function Coaching({team,data,mutate,notify,versionId,games}:{team:any;data:any;mutate:(a:any)=>Promise<any>;notify:(s:string)=>void;versionId?:string;games:any[]}){
  const coaching:TeamCoaching=data.db.coaching?.[team.id]??empty(team.id);const [stats,setStats]=useState<any>(null),[editLead,setEditLead]=useState<LeadPlan|null>(null),[editMatchup,setEditMatchup]=useState<MatchupPlan|null>(null),[objective,setObjective]=useState('');
  const ids=games.map(g=>g.id).join(',');useEffect(()=>{let alive=true;api('/coach-stats?ids='+encodeURIComponent(ids)).then(s=>{if(alive)setStats(s);}).catch(e=>notify(e.message));return()=>{alive=false;};},[ids]);
  const roster=versionId?team.versions.find((v:any)=>v.id===versionId):team.versions.find((v:any)=>v.id===team.activeVersionId);
  const members:string[]=roster.configurations.find((c:any)=>c.id===roster.currentConfigurationId).slots.map((sl:any)=>data.db.bank.find((b:any)=>b.id===sl.bankId)?.revisions.find((r:any)=>r.id===sl.revisionId)?.set.species).filter(Boolean);
  const rosterSets:any[]=roster.configurations.find((c:any)=>c.id===roster.currentConfigurationId).slots.map((sl:any)=>data.db.bank.find((b:any)=>b.id===sl.bankId)?.revisions.find((r:any)=>r.id===sl.revisionId)?.set).filter(Boolean);const setOf=(p:string)=>rosterSets.find(x=>x.species===p)??{species:p};
  const inScope=(p:{versionIds:string[]})=>!versionId||!p.versionIds.length||p.versionIds.includes(versionId);
  const save=async(next:Partial<TeamCoaching>)=>{await mutate(coachingUpdate(team.id,coaching,{...coaching,...next}));};
  const upsert=<T extends {id:string}>(list:T[],item:T)=>list.some(x=>x.id===item.id)?list.map(x=>x.id===item.id?item:x):[...list,item];
  const scopeIds=versionId?[versionId]:[];const versionLabel=(ids:string[])=>ids.length?ids.map(id=>{const v=team.versions.find((v:any)=>v.id===id);return v?`V${v.number}`:'?';}).join(', '):'All versions';
  const leads=Object.entries<any>(stats?.leads??{}).sort((a,b)=>b[1].games-a[1].games);const opponents=Object.entries<any>(stats?.matchups??{}).sort((a,b)=>b[1].preview-a[1].preview);
  return <div className="coaching">
    <div className="team-detail-grid">
      <PlanPanel title="Lead strategy" onNew={()=>setEditLead({id:newId(),lead:['',''],back:[],when:'',plan:'',calcIds:[],versionIds:scopeIds,status:'active'})} empty={coaching.leads.filter(inScope).length?undefined:'No lead plans yet. Add one, or ask Frontier Brain to draft them.'}>
        {coaching.leads.filter(inScope).map(l=><PlanCard key={l.id} status={l.status}
          head={<><RolePill role={leadRole(l)??'lead'}/><h3>{l.title||l.lead.join(' + ')}</h3></>}
          meta={<div className="front-back"><span className="fb-label">Front</span><span className="fb-mons">{l.lead.map(p=><span key={p} className="fb-mon"><SetArt set={setOf(p)} art={data.art} small/>{p}</span>)}</span>
            {l.back.length>0&&<><span className="fb-divider"/><span className="fb-label">Back</span><span className="fb-mons">{l.back.map(p=><span key={p} className="fb-mon"><SetArt set={setOf(p)} art={data.art} small/>{p}</span>)}</span></>}</div>}
          summary={whenText(l)} body={l.plan} foot={<><LeadRecord stats={stats} lead={l.lead}/>{l.versionIds.length>0&&<span className="tag">{versionLabel(l.versionIds)}</span>}</>}
          accept={l.status==='proposed'?()=>void save({leads:upsert(coaching.leads,{...l,status:'active'})}):undefined} edit={()=>setEditLead(l)} remove={()=>{if(confirm(`Delete the ${l.lead.join(' + ')} lead plan?`))void save({leads:coaching.leads.filter(x=>x.id!==l.id)});}}/>)}
      </PlanPanel>
      <PlanPanel title="Matchup strategy" onNew={()=>setEditMatchup({id:newId(),opponent:'',threat:'medium',bring:[],plan:'',calcIds:[],versionIds:scopeIds,status:'active'})} empty={coaching.matchups.filter(inScope).length?undefined:'No matchup plans yet. Add one, or ask Frontier Brain to draft them.'}>
        {coaching.matchups.filter(inScope).sort((a,b)=>['high','medium','low'].indexOf(a.threat)-['high','medium','low'].indexOf(b.threat)).map(m=>{const o=splitOpponent(m);return <PlanCard key={m.id} status={m.status}
          head={<><span className={'threat '+m.threat}>{m.threat}</span><h3>{o.title}</h3></>}
          meta={<div className="front-back">{o.examples.length>0&&<><span className="fb-label">Examples</span><span className="fb-mons">{o.examples.map(p=><span key={p} className="fb-mon"><Art name={p} fallback={p.replace(/-(Mega(-[XYZ])?|[XYZ])$/,'')} art={data.art} small/>{formName(p)}</span>)}</span></>}
            {m.bring.length>0&&<><span className="fb-divider"/><span className="fb-label">Bring</span><span className="fb-mons">{m.bring.map(p=><span key={p} className="fb-mon"><SetArt set={setOf(p)} art={data.art} small/>{p}</span>)}</span></>}</div>}
          body={m.plan} foot={m.versionIds.length>0?<span className="tag">{versionLabel(m.versionIds)}</span>:undefined}
          accept={m.status==='proposed'?()=>void save({matchups:upsert(coaching.matchups,{...m,status:'active'})}):undefined} edit={()=>setEditMatchup(m)} remove={()=>{if(confirm(`Delete the ${o.archetype} matchup plan?`))void save({matchups:coaching.matchups.filter(x=>x.id!==m.id)});}}/>;})}
      </PlanPanel>
    </div>
    
    {editLead&&<LeadEditor plan={editLead} team={team} members={members} onClose={()=>setEditLead(null)} save={async l=>{await save({leads:upsert(coaching.leads,l)});setEditLead(null);}}/>}
    {editMatchup&&<MatchupEditor plan={editMatchup} team={team} members={members} onClose={()=>setEditMatchup(null)} save={async m=>{await save({matchups:upsert(coaching.matchups,m)});setEditMatchup(null);}}/>}
  </div>;
}
function LeadRecord({stats,lead}:{stats:any;lead:string[]}){const key=[...lead].sort().join(' + ');const r=stats?.leads?.[key];return r?<span className="lead-record">{r.wins}–{r.losses} in replays</span>:null;}
const csv=(s:string)=>s.split(',').map(x=>x.trim()).filter(Boolean);
function Pick({label,value,options,onChange}:{label:string;value:string;options:string[];onChange:(v:string)=>void}){return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}><option value="">—</option>{options.map(o=><option key={o}>{o}</option>)}</select></label>;}
function Choose({label,value,options,max,onChange}:{label:string;value:string[];options:string[];max:number;onChange:(v:string[])=>void}){return <fieldset><legend>{label} ({value.length}/{max})</legend><div className="choose-row">{options.map(o=><label key={o} className={'choose'+(value.includes(o)?' on':'')}><input type="checkbox" checked={value.includes(o)} disabled={!value.includes(o)&&value.length>=max} onChange={e=>onChange(e.target.checked?[...value,o]:value.filter(x=>x!==o))}/>{o}</label>)}</div></fieldset>;}
// Closing a plan editor with changes asks first.
const useGuardedClose=(key:string,dirty:boolean,onClose:()=>void)=>{useDirty(key,dirty,'plan');return ()=>{if(!dirty||confirm('Discard changes to this plan?'))onClose();};};
function LeadEditor({plan,team,members,save,onClose}:{plan:LeadPlan;team:any;members:string[];save:(l:LeadPlan)=>Promise<void>;onClose:()=>void}){const [start]=useState(()=>({...plan,role:leadRole(plan),when:plan.when.replace(ROLE_PREFIX,'')}));const [p,setP]=useState(start),[error,setError]=useState(''),[busy,setBusy]=useState(false);const lead=[p.lead[0]??'',p.lead[1]??''];const close=useGuardedClose('lead-'+plan.id,JSON.stringify(p)!==JSON.stringify(start)&&!busy,onClose);
  return <Modal title="Lead plan" onClose={close}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{if(!p.lead.filter(Boolean).length)throw new Error('Choose the lead');await save({...p,lead:p.lead.filter(Boolean)});}catch(err){setError((err as Error).message);setBusy(false);}}}>
    <label>Title<input value={p.title??''} onChange={e=>setP({...p,title:e.target.value||undefined})} placeholder="e.g. Rain blitz"/></label>
    <div className="form-grid"><Pick label="Lead 1" value={lead[0]} options={members.filter(m=>m!==lead[1])} onChange={v=>setP({...p,lead:[v,lead[1]]})}/><Pick label="Lead 2" value={lead[1]} options={members.filter(m=>m!==lead[0])} onChange={v=>setP({...p,lead:[lead[0],v]})}/></div>
    <Choose label="Back" value={p.back} options={members.filter(m=>!lead.includes(m))} max={2} onChange={v=>setP({...p,back:v})}/>
    <label>Role<select value={p.role??''} onChange={e=>setP({...p,role:(e.target.value||undefined) as LeadPlan['role']})}><option value="">Not set</option><option value="core">Core: your default lead</option><option value="situational">Situational: into specific teams</option><option value="niche">Niche: a pocket option</option><option value="avoid">Avoid: don't lead this pair</option></select></label>
    <label>When to use it<textarea rows={2} value={p.when} onChange={e=>setP({...p,when:e.target.value})}/></label><label>Turn 1–2 plan<textarea rows={5} value={p.plan} onChange={e=>setP({...p,plan:e.target.value})}/></label>{error&&<p className="error">{error}</p>}<div className="modal-footer"><button className="primary" disabled={busy}>{busy?'Saving…':'Save lead plan'}</button></div></form></Modal>;}
// A matchup plan's parts: the team style (shared with replay tags), example opposing Pokémon, threat, who to bring and
// the game plan. Older plans that kept everything in one "Style: Pokémon list" line are split on opening.
export function splitOpponent(m:MatchupPlan){if(m.archetype||m.examples?.length)return {title:m.opponent||m.archetype!,archetype:m.archetype??m.opponent,examples:m.examples??[]};
  const [head,...rest]=m.opponent.split(':');const list=rest.join(':').replace(/\([^)]*%[^)]*\)/g,'').split(/,|\/|\band\b/).map(x=>x.trim()).filter(x=>x&&x.length<30);return {title:head.trim(),archetype:head.trim(),examples:list};}
function MatchupEditor({plan,team,members,save,onClose,styles=[]}:{plan:MatchupPlan;team:any;members:string[];save:(m:MatchupPlan)=>Promise<void>;onClose:()=>void;styles?:string[]}){
  const [start]=useState(()=>{const o=splitOpponent(plan);return {...plan,archetype:o.archetype,examples:o.examples};});const [p,setP]=useState(start),[error,setError]=useState(''),[busy,setBusy]=useState(false);const close=useGuardedClose('matchup-'+plan.id,JSON.stringify(p)!==JSON.stringify(start)&&!busy,onClose);
  const styleList=[...new Set([...TEAM_STYLES,...styles])];const ex=p.examples??[];
  return <Modal title="Matchup plan" onClose={close}><form className="plan-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{if(!p.archetype?.trim())throw new Error('Choose the team style');await save({...p,opponent:(p.opponent&&p.opponent!==plan.opponent?p.opponent:plan.archetype?plan.opponent:p.archetype!).trim()});}catch(err){setError((err as Error).message);setBusy(false);}}}>
    <div className="form-grid"><label>Opponent team style<input required list="style-options" value={p.archetype??''} onChange={e=>setP({...p,archetype:e.target.value})} placeholder="e.g. Tailwind offense"/><datalist id="style-options">{styleList.map(a=><option key={a} value={a}/>)}</datalist></label>
      <label>Threat<select value={p.threat} onChange={e=>setP({...p,threat:e.target.value as MatchupPlan['threat']})}><option value="high">HIGH</option><option value="medium">MEDIUM</option><option value="low">LOW</option></select></label></div>
    <div className="examples-field"><span className="field-label">Example Pokémon</span><div className="example-chips">{ex.map(m=><button type="button" key={m} className="chip on" onClick={()=>setP({...p,examples:ex.filter(x=>x!==m)})}>{m} ×</button>)}</div>{ex.length<8&&<SpeciesPicker label="Add an example Pokémon" placeholder="Add a Pokémon…" value="" onPick={sp=>setP({...p,examples:ex.includes(sp)?ex:[...ex,sp]})}/>}</div>
    <Choose label="Bring" value={p.bring} options={members} max={4} onChange={v=>setP({...p,bring:v})}/>
    <label>Game plan<textarea rows={5} value={p.plan} onChange={e=>setP({...p,plan:e.target.value})} placeholder="The lead, the key move or switch, what wins it. A few sentences."/></label>{error&&<p className="error">{error}</p>}<div className="modal-footer"><button className="primary" disabled={busy}>{busy?'Saving…':'Save matchup plan'}</button></div></form></Modal>;}

// The difference between two copies of a team's strategy, as one item-level update the server merges into the latest.
export function coachingUpdate(teamId:string,before:Pick<TeamCoaching,'leads'|'matchups'|'objectives'>,after:Pick<TeamCoaching,'leads'|'matchups'|'objectives'>){
  const upsert:any={},remove:any={};
  for(const k of ['leads','matchups','objectives'] as const){const old=new Map<string,any>(before[k].map((x:any)=>[x.id,x]));const now=new Set(after[k].map((x:any)=>x.id));
    upsert[k]=after[k].filter((x:any)=>JSON.stringify(old.get(x.id))!==JSON.stringify(x));remove[k]=before[k].filter((x:any)=>!now.has(x.id)).map((x:any)=>x.id);}
  return {type:'coaching-update',teamId,upsert,remove};
}

