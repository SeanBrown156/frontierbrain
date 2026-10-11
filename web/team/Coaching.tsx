import {useState,useEffect,useRef} from 'react';
import type {TeamCoaching,LeadPlan,MatchupPlan,Objective,TeamBrief} from '../../shared/workbench.ts';
import {api,Art,Panel,Modal,Notice,pct,Markdown,SetArt} from '../ui.tsx';
import {useDirty} from '../save-state.ts';
import {speciesOptions} from '../ai/SpeciesPicker.tsx';
import {versionName} from './editors.tsx';
import {Px,Plus,Pencil,Check} from '../icons.tsx';

const newId=()=>Math.random().toString(36).slice(2,12);
const empty=(teamId:string):TeamCoaching=>({teamId,version:0,updatedAt:'',leads:[],matchups:[],objectives:[]});
const SMALL=5;
// A lead's role: set explicitly, or read from an older plan's "CORE · …" prefix (shown as the pill, not repeated in the text).
const ROLE_PREFIX=/^\s*(core|situational|niche)\s*[·:\-–]\s*/i;
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
    <Brief team={team} brief={coaching.brief} art={data.art} mutate={mutate}/>
    <div className="team-detail-grid">
      <Panel title="Lead strategy" action={<button onClick={()=>setEditLead({id:newId(),lead:['',''],back:[],when:'',plan:'',calcIds:[],versionIds:scopeIds,status:'active'})}><Px icon={Plus}/>New</button>}>
        {coaching.leads.filter(inScope).map(l=><article key={l.id} className={'plan-card '+l.status}><header><div className="pair">{l.lead.map(p=><SetArt key={p} set={setOf(p)} art={data.art} small/>)}<h3>{l.lead.join(' + ')}</h3><RolePill role={leadRole(l)}/>{l.back.length>0&&<span className="muted lead-back">Back: {l.back.join(', ')}</span>}</div>{l.status==='proposed'&&<span className="tag">AI draft</span>}</header>
          {whenText(l)&&<p className="plan-when"><b>When:</b> {whenText(l)}</p>}<div className="plan-text"><Markdown text={l.plan}/></div><LeadRecord stats={stats} lead={l.lead}/><footer><span className="muted">{versionLabel(l.versionIds)}</span>{l.status==='proposed'&&<button onClick={()=>void save({leads:upsert(coaching.leads,{...l,status:'active'})})}>Accept</button>}<button onClick={()=>setEditLead(l)}>Edit</button><button onClick={()=>{if(confirm(`Delete the ${l.lead.join(' + ')} lead plan?`))void save({leads:coaching.leads.filter(x=>x.id!==l.id)});}}>Delete</button></footer></article>)}
        {!coaching.leads.filter(inScope).length&&<p className="muted">No lead plans yet. Add one, start from a combo you've led with below, or ask Frontier Brain.</p>}
        {leads.length>0&&<><h3 className="subhead">Lead combos in replays</h3><div className="table-scroll"><table className="stat-table"><thead><tr><th>Lead</th><th>Games</th><th>W–L</th><th>Win %</th><th/></tr></thead><tbody>{leads.map(([pair,r])=><tr key={pair}><td>{pair}</td><td>{r.games}</td><td>{r.wins}–{r.losses}</td><td>{r.games>=SMALL?pct(r.wins,r.games):<span className="muted">n={r.games}</span>}</td><td><button className="text-button" onClick={()=>setEditLead({id:newId(),lead:pair.split(' + '),back:[],when:'',plan:'',calcIds:[],versionIds:scopeIds,status:'active'})}>Plan →</button></td></tr>)}</tbody></table></div></>}
      </Panel>
      <Panel title="Matchup strategy" action={<button onClick={()=>setEditMatchup({id:newId(),opponent:'',threat:'medium',bring:[],plan:'',calcIds:[],versionIds:scopeIds,status:'active'})}><Px icon={Plus}/>New</button>}>
        {coaching.matchups.filter(inScope).sort((a,b)=>['high','medium','low'].indexOf(a.threat)-['high','medium','low'].indexOf(b.threat)).map(m=><article key={m.id} className={'plan-card '+m.status}><header><h3><span className={'threat '+m.threat}>{m.threat}</span> {m.opponent}</h3>{m.status==='proposed'&&<span className="tag">AI draft</span>}</header>{m.bring.length>0&&<div className="pair">{m.bring.map(p=><SetArt key={p} set={setOf(p)} art={data.art} small/>)}<span className="muted">bring {m.bring.join(', ')}</span></div>}<div className="plan-text"><Markdown text={m.plan}/></div>
          <footer><span className="muted">{versionLabel(m.versionIds)}</span>{m.status==='proposed'&&<button onClick={()=>void save({matchups:upsert(coaching.matchups,{...m,status:'active'})})}>Accept</button>}<button onClick={()=>setEditMatchup(m)}>Edit</button><button onClick={()=>{if(confirm(`Delete the ${m.opponent} matchup plan?`))void save({matchups:coaching.matchups.filter(x=>x.id!==m.id)});}}>Delete</button></footer></article>)}
        {!coaching.matchups.filter(inScope).length&&<p className="muted">No matchup plans yet. Add one, pick an opponent below, or ask Frontier Brain.</p>}{opponents.length>0&&<><h3 className="subhead">Opponents at team preview</h3><div className="table-scroll"><table className="stat-table"><thead><tr><th>Pokémon</th><th>Seen</th><th>W–L when seen</th><th>Brought</th><th/></tr></thead><tbody>{opponents.slice(0,20).map(([mon,r])=><tr key={mon}><td><Art name={mon} art={data.art} small/> {mon}</td><td>{r.preview}</td><td>{r.previewWins}–{r.preview-r.previewWins}</td><td>{r.observed}{r.unknown?` (+${r.unknown} unknown)`:''}</td><td><button className="text-button" onClick={()=>setEditMatchup({id:newId(),opponent:mon,threat:'medium',bring:[],plan:'',calcIds:[],versionIds:scopeIds,status:'active'})}>Plan →</button></td></tr>)}</tbody></table></div></>}
      </Panel>
    </div>
    {(versionId||games.length>0)&&<p className="footnote">{versionId?'Plans for this version plus all-version plans. ':''}{games.length>0&&<>Replay tables use {games.length} linked game{games.length===1?'':'s'}; below {SMALL} games a record is an observation, not a diagnosis.</>}</p>}
    {editLead&&<LeadEditor plan={editLead} team={team} members={members} onClose={()=>setEditLead(null)} save={async l=>{await save({leads:upsert(coaching.leads,l)});setEditLead(null);}}/>}
    {editMatchup&&<MatchupEditor plan={editMatchup} team={team} members={members} onClose={()=>setEditMatchup(null)} save={async m=>{await save({matchups:upsert(coaching.matchups,m)});setEditMatchup(null);}}/>}
  </div>;
}
function LeadRecord({stats,lead}:{stats:any;lead:string[]}){const key=[...lead].sort().join(' + ');const r=stats?.leads?.[key];return r?<p className="muted">In replays: {r.wins}–{r.losses} over {r.games} game(s){r.games<SMALL?' (small sample)':''}.</p>:null;}
const csv=(s:string)=>s.split(',').map(x=>x.trim()).filter(Boolean);
function Pick({label,value,options,onChange}:{label:string;value:string;options:string[];onChange:(v:string)=>void}){return <label>{label}<select value={value} onChange={e=>onChange(e.target.value)}><option value="">—</option>{options.map(o=><option key={o}>{o}</option>)}</select></label>;}
function Choose({label,value,options,max,onChange}:{label:string;value:string[];options:string[];max:number;onChange:(v:string[])=>void}){return <fieldset><legend>{label} ({value.length}/{max})</legend><div className="choose-row">{options.map(o=><label key={o} className={'choose'+(value.includes(o)?' on':'')}><input type="checkbox" checked={value.includes(o)} disabled={!value.includes(o)&&value.length>=max} onChange={e=>onChange(e.target.checked?[...value,o]:value.filter(x=>x!==o))}/>{o}</label>)}</div></fieldset>;}
// Closing a plan editor with changes asks first.
const useGuardedClose=(key:string,dirty:boolean,onClose:()=>void)=>{useDirty(key,dirty,'plan');return ()=>{if(!dirty||confirm('Discard changes to this plan?'))onClose();};};
function LeadEditor({plan,team,members,save,onClose}:{plan:LeadPlan;team:any;members:string[];save:(l:LeadPlan)=>Promise<void>;onClose:()=>void}){const [start]=useState(()=>({...plan,role:leadRole(plan),when:plan.when.replace(ROLE_PREFIX,'')}));const [p,setP]=useState(start),[error,setError]=useState(''),[busy,setBusy]=useState(false);const lead=[p.lead[0]??'',p.lead[1]??''];const close=useGuardedClose('lead-'+plan.id,JSON.stringify(p)!==JSON.stringify(start)&&!busy,onClose);
  return <Modal title="Lead plan" onClose={close}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{if(!p.lead.filter(Boolean).length)throw new Error('Choose the lead');await save({...p,lead:p.lead.filter(Boolean)});}catch(err){setError((err as Error).message);setBusy(false);}}}>
    <div className="form-grid"><Pick label="Lead 1" value={lead[0]} options={members.filter(m=>m!==lead[1])} onChange={v=>setP({...p,lead:[v,lead[1]]})}/><Pick label="Lead 2" value={lead[1]} options={members.filter(m=>m!==lead[0])} onChange={v=>setP({...p,lead:[lead[0],v]})}/></div>
    <Choose label="Back" value={p.back} options={members.filter(m=>!lead.includes(m))} max={2} onChange={v=>setP({...p,back:v})}/>
    <label>Role<select value={p.role??''} onChange={e=>setP({...p,role:(e.target.value||undefined) as LeadPlan['role']})}><option value="">Not set</option><option value="core">Core: your default lead</option><option value="situational">Situational: into specific teams</option><option value="niche">Niche: a pocket option</option></select></label>
    <label>When to use it<textarea rows={2} value={p.when} onChange={e=>setP({...p,when:e.target.value})}/></label><label>Turn 1–2 plan<textarea rows={5} value={p.plan} onChange={e=>setP({...p,plan:e.target.value})}/></label>{error&&<p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy?'Saving…':'Save lead plan'}</button></form></Modal>;}
function MatchupEditor({plan,team,members,save,onClose}:{plan:MatchupPlan;team:any;members:string[];save:(m:MatchupPlan)=>Promise<void>;onClose:()=>void}){const [p,setP]=useState(plan),[error,setError]=useState(''),[options,setOptions]=useState<any[]>([]),[busy,setBusy]=useState(false);const close=useGuardedClose('matchup-'+plan.id,JSON.stringify(p)!==JSON.stringify(plan)&&!busy,onClose);
  useEffect(()=>{speciesOptions().then(o=>setOptions(o.slice(0,80))).catch(()=>{});},[]);
  return <Modal title="Matchup plan" onClose={close}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await save(p);}catch(err){setError((err as Error).message);setBusy(false);}}}>
    <div className="form-grid"><label>Opponent, core or archetype<input required list="opponent-options" value={p.opponent} onChange={e=>setP({...p,opponent:e.target.value})} placeholder="Pick a Pokémon or type e.g. Trick Room"/><datalist id="opponent-options">{options.map(o=><option key={o.name} value={o.name}>{o.usage}% of pooled teams</option>)}{['Trick Room','Tailwind offense','Rain','Sun','Psychic Terrain'].map(a=><option key={a} value={a}/>)}</datalist></label>
      <Pick label="Threat" value={p.threat} options={['high','medium','low']} onChange={v=>setP({...p,threat:(v||'medium') as MatchupPlan['threat']})}/></div>
    <Choose label="Bring" value={p.bring} options={members} max={4} onChange={v=>setP({...p,bring:v})}/>
    <label>Game plan<textarea rows={6} value={p.plan} onChange={e=>setP({...p,plan:e.target.value})}/></label>{error&&<p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy?'Saving…':'Save matchup plan'}</button></form></Modal>;}

// The difference between two copies of a team's strategy, as one item-level update the server merges into the latest.
export function coachingUpdate(teamId:string,before:Pick<TeamCoaching,'leads'|'matchups'|'objectives'>,after:Pick<TeamCoaching,'leads'|'matchups'|'objectives'>){
  const upsert:any={},remove:any={};
  for(const k of ['leads','matchups','objectives'] as const){const old=new Map<string,any>(before[k].map((x:any)=>[x.id,x]));const now=new Set(after[k].map((x:any)=>x.id));
    upsert[k]=after[k].filter((x:any)=>JSON.stringify(old.get(x.id))!==JSON.stringify(x));remove[k]=before[k].filter((x:any)=>!now.has(x.id)).map((x:any)=>x.id);}
  return {type:'coaching-update',teamId,upsert,remove};
}

// The team brief: why the team exists, agreed while building it (with Claude, ChatGPT or by hand). Every assistant
// reads it. Edits save themselves.
function Brief({team,brief,art,mutate}:{team:any;brief?:TeamBrief;art:any;mutate:(a:any,o?:any)=>Promise<any>}){
  const [editing,setEditing]=useState(false),[b,setB]=useState(()=>({goal:brief?.goal??'',core:(brief?.core??[]).join(', '),gamePlan:brief?.gamePlan??'',ruledOut:brief?.ruledOut??''}));
  const touched=useRef(false);
  useEffect(()=>{if(!editing&&brief){setB({goal:brief?.goal??'',core:(brief?.core??[]).join(', '),gamePlan:brief?.gamePlan??'',ruledOut:brief?.ruledOut??''});}},[brief?.updatedAt,editing]);
  const core=(t:string)=>t.split(',').map(x=>x.trim()).filter(Boolean).slice(0,6);
  const save=()=>{if(!touched.current)return;touched.current=false;void mutate({type:'coaching-update',teamId:team.id,brief:{...b,core:core(b.core)}},{quiet:true}).catch(()=>{});};
  useEffect(()=>{if(!editing||!touched.current)return;const t=setTimeout(save,800);return()=>clearTimeout(t);},[JSON.stringify(b)]);
  // Until the save lands, show what was just written rather than flicking back to the empty state.
  const shown:TeamBrief|undefined=brief??(b.goal||b.gamePlan||b.core?{goal:b.goal,core:core(b.core),gamePlan:b.gamePlan,ruledOut:b.ruledOut,updatedAt:''}:undefined);
  const set=(k:string)=>(e:any)=>{touched.current=true;setB({...b,[k]:e.target.value});};
  if(!shown&&!editing)return <p className="brief-empty muted">No team brief yet: why this team exists, what it's built around and how it wins. <button className="text-button" onClick={()=>{touched.current=false;setEditing(true);}}>Write one</button> or build it with Claude or ChatGPT and they'll save it.</p>;
  return <section className="brief panel"><header className="panel-heading"><h2>Team brief</h2>{editing?<button onClick={()=>{save();setEditing(false);}}><Px icon={Check}/>Done</button>:<button onClick={()=>{touched.current=false;setEditing(true);}}><Px icon={Pencil}/>Edit</button>}</header>
    {editing?<div className="settings-form brief-form">
      <label>Why this team<input value={b.goal} onChange={set('goal')} placeholder="e.g. a Trick Room team that still beats Tailwind"/></label>
      <label>Built around<input value={b.core} onChange={set('core')} placeholder="Pokémon, comma separated"/></label>
      <label>Game plan<textarea rows={4} value={b.gamePlan} onChange={set('gamePlan')} placeholder="Modes, leads, win conditions"/></label>
      <label>Ruled out<input value={b.ruledOut} onChange={set('ruledOut')} placeholder="What you considered and why not"/></label></div>
    :<div className="brief-body">
      {shown!.goal&&<p className="brief-goal">{shown!.goal}</p>}
      {shown!.core.length>0&&<div className="brief-core"><span className="muted">Built around</span>{shown!.core.map(c=><span key={c} className="pair"><Art name={c} art={art} small/>{c}</span>)}</div>}
      {shown!.gamePlan&&<Markdown text={shown!.gamePlan}/>}
      {shown!.ruledOut&&<p className="muted"><b>Ruled out:</b> {shown!.ruledOut}</p>}</div>}
  </section>;
}
