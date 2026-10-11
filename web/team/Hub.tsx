import {FORMATS,formatLabel} from '../../shared/formats.ts';
import {useState,useEffect} from 'react';
import {api,Art,Panel,Modal,Notice,date,Markdown} from '../ui.tsx';
import {Px,Share,Home,Target,Play,Clock,ArrowLeft,Download,Pencil,Plus,Upload,Eye} from '../icons.tsx';
import Replays from './Replays.tsx';
import Coaching from './Coaching.tsx';
import {getView,versionName,stats} from './editors.tsx';
import {useDraft,useOffers,takeOffer} from '../save-state.ts';
import SetTile from '../ai/SetTile.tsx';

export const teamHref=(teamId:string,tab:string,versionId='all')=>`#team/${teamId}/${tab}/${versionId}`;
export const monHref=(teamId:string,versionId:string,slot:number,swap=false)=>`#team/${teamId}/mon/${versionId}/${slot}${swap?'/swap':''}`;
export function record(games:any[]){const w=games.filter(g=>g.result==='win').length,l=games.filter(g=>g.result==='loss').length;return {w,l,n:games.length,label:games.length?`${w}–${l}`:'no games'};}
const tabs=[['overview','Overview',Home],['strategy','Strategy',Target],['replays','Replays',Play],['history','History',Clock]] as const;
const statLabel:Record<string,string>={hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'};
export const sourceName=(v:any)=>v.source==='observed'?'from replays':v.source==='paste'||v.number===1?'from paste':v.configurations?.[0]?.summary?.startsWith('Restored')?v.configurations[0].summary.toLowerCase():'saved version';

export default function TeamHub({team,data,mutate,notify,load,tab,versionId}:{team:any;data:any;mutate:(a:any)=>Promise<any>;notify:(s:string)=>void;load:()=>Promise<void>;tab:string;versionId:string}){
  const all=versionId==='all'||!team.versions.some((v:any)=>v.id===versionId);
  const teamGames=data.games.filter((g:any)=>g.association?.teamId===team.id);const scopedGames=all?teamGames:teamGames.filter((g:any)=>g.association?.versionId===versionId);
  const [exported,setExported]=useState<string|null>(null),[renaming,setRenaming]=useState(false),[name,setName]=useState(team.name);
  const shown=all?team.versions.find((v:any)=>v.id===team.activeVersionId):team.versions.find((v:any)=>v.id===versionId);
  const paste=async()=>{try{setExported((await api(`/export?team=${team.id}&version=${shown.id}&configuration=${shown.currentConfigurationId}`)).paste);}catch(e){notify((e as Error).message);}};
  const rename=async()=>{setRenaming(false);if(name.trim()&&name.trim()!==team.name)await mutate({type:'team-rename',teamId:team.id,name:name.trim()}).catch(()=>setName(team.name));};
  return <div className="team-hub">
    <a href="#teams" className="text-button"><Px icon={ArrowLeft} size={12}/>Teams</a>
    <div className="hub-head"><div className="hub-title">{renaming?<input className="rename" aria-label="Team name" autoFocus value={name} onChange={e=>setName(e.target.value)} onBlur={()=>void rename()} onKeyDown={e=>{if(e.key==='Enter')void rename();if(e.key==='Escape'){setName(team.name);setRenaming(false);}}}/>
        :<h1><button className="title-button" title="Rename" onClick={()=>setRenaming(true)}>{team.name}<Px icon={Pencil} size={16}/></button></h1>}</div></div>
    <div className="hub-nav"><nav className="hub-tabs" role="tablist">{tabs.map(([key,label,icon])=><a key={key} role="tab" aria-selected={tab===key||(key==='strategy'&&tab==='coaching')} className={tab===key||(key==='strategy'&&tab==='coaching')?'selected':''} href={teamHref(team.id,key,versionId)}><Px icon={icon}/>{label}</a>)}</nav>
      <div className="version-bar"><label className="format-picker"><span className="sr-only">Format</span><select title="Format" value={team.format} onChange={e=>void mutate({type:'team-format',teamId:team.id,format:e.target.value}).catch(()=>{})}>{FORMATS.some(f=>f.id===team.format)?null:<option value={team.format}>{team.format}</option>}{FORMATS.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></label><button onClick={()=>void paste()}><Px icon={Share}/>Export</button></div></div>
    {tab==='overview'&&<Overview team={team} data={data} version={shown} mutate={mutate}/>}
    {(tab==='strategy'||tab==='coaching')&&<><Strategy key={shown.id} team={team} version={shown} all={all} mutate={mutate}/><Coaching team={team} data={data} mutate={mutate} notify={notify} versionId={all?undefined:versionId} games={scopedGames}/></>}
    {tab==='replays'&&<Replays team={team} data={data} versionId={all?'all':versionId} load={load} notify={notify}/>}
    {tab==='history'&&<Versions team={team} data={data} games={teamGames} mutate={mutate}/>}
    {exported!==null&&<Modal title="Showdown export" onClose={()=>setExported(null)}><Notice>Champions stat points use the “EVs:” label only for Showdown compatibility.{shown.source==='observed'?' This version was rebuilt from replays; guessed fields are assumptions.':''}</Notice><textarea className="paste" aria-label="Team export" readOnly rows={20} value={exported}/><button className="primary" onClick={()=>{void navigator.clipboard.writeText(exported).then(()=>notify('Paste copied.')).catch(()=>notify('Select and copy the paste manually.'));}}>Copy paste</button></Modal>}
  </div>;
}
function Overview({team,data,version,mutate}:{team:any;data:any;version:any;mutate:(a:any)=>Promise<any>}){
  const view=getView(team,data.db,version.id);const active=version.id===team.activeVersionId;const current=team.versions.find((v:any)=>v.id===team.activeVersionId);
  return <div className="hub-overview">
    {!active&&<div className="notice warn">Viewing {versionName(version)}, an older version (read-only). <a className="button" href={teamHref(team.id,'overview',team.activeVersionId)}>Back to {versionName(current)}</a><button onClick={()=>{if(confirm(`Bring back ${versionName(version)}'s six as a new version (V${team.versions.length+1})? Nothing is deleted.`))void mutate({type:'team-milestone',teamId:team.id,fromVersionId:version.id}).then(r=>{location.hash=teamHref(team.id,'overview',r.result.versionId);}).catch(()=>{});}}>Make it the current team</button></div>}
    {version.source==='observed'&&<p className="footnote">Rebuilt from replays: <b>bold</b> moves were seen in battle; anything tagged “guess” is an assumption.</p>}
    <div className="six-grid">{view.revisions.map(({revision},i)=>{const s=revision.set;const obs=revision.provenance==='observed';return <a key={i} className={'mon-card'+(active?'':' read-only')} href={monHref(team.id,version.id,i)} aria-label={`${s.species}: open set and calc`}>
      <div className="mon-card-head"><Art name={s.species} art={data.art}/><div><h3>{s.nickname?`${s.nickname} (${s.species})`:s.species}</h3><span>{s.item?'@ '+s.item:'No item'}{obs&&revision.fields?.item==='inferred'&&<span className="guess">guess</span>}</span><p>{s.ability} · {s.nature}</p></div></div>
      <p className="sp-line">{stats.filter(k=>(s.statPoints?.[k]??0)>0).map(k=><span key={k}>{statLabel[k]} {s.statPoints![k]}</span>)}{!stats.some(k=>(s.statPoints?.[k]??0)>0)&&'No stat points'}</p>
      <ul className="move-list">{s.moves?.map(m=><li key={m} className={obs&&!revision.knownMoves?.includes(m)?'inferred':obs?'known':''}>{m}</li>)}</ul>
</a>;})}</div>
  </div>;
}
// Lead and matchup drafts that came with an AI team are added to Coaching as proposals to accept there.
export async function addPlans(team:any,data:any,mutate:(a:any)=>Promise<any>,p:any,versionId:string){
  if(!p.leads?.length&&!p.matchups?.length)return;const c=data.db.coaching?.[team.id]??{version:0,leads:[],matchups:[],objectives:[]};const id=()=>Math.random().toString(36).slice(2,12);
  await mutate({type:'coaching-save',teamId:team.id,parentVersion:c.version,coaching:{...c,leads:[...c.leads,...p.leads.map((l:any)=>({...l,id:id(),calcIds:[],versionIds:[versionId],status:'proposed'}))],matchups:[...c.matchups,...p.matchups.map((m:any)=>({...m,id:id(),calcIds:[],versionIds:[versionId],status:'proposed'}))]}});
}
// The version's game plan. Editing (or a rewrite accepted from Ask Frontier Brain) is a draft until Save.
function Strategy({team,version,all,mutate}:{team:any;version:any;all:boolean;mutate:(a:any)=>Promise<any>}){
  const d=useDraft<string>(`strategy-${version.id}`,version.notes??'',version.notes??'','Strategy');const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useOffers(`strategy:${team.id}`,text=>{d.setDraft(text);setEditing(true);return true;});
  useEffect(()=>{const t=takeOffer(`strategy:${team.id}`);if(t){d.setDraft(t);setEditing(true);}},[]);
  const save=async()=>{setBusy(true);setError('');d.markSaving();try{await mutate({type:'version-notes',teamId:team.id,versionId:version.id,notes:d.draft});setEditing(false);}catch(e){d.markFailed();setError((e as Error).message);}finally{setBusy(false);}};
  return <section className={'strategy-block'+(d.dirty?' dirty':'')}><div className="strategy-head"><h2>Overall strategy</h2>{all&&<span className="muted">{versionName(version)} (active)</span>}<span className="grow"/>{!editing&&<button onClick={()=>setEditing(true)}><Px icon={Pencil}/>Edit</button>}</div>
    {editing?<textarea aria-label="Strategy" rows={14} value={d.draft} onChange={e=>d.setDraft(e.target.value)} placeholder="Game plan, win conditions, leads at a glance, threats…"/>:<Markdown text={version.notes||'No game plan yet. Write one here, or ask Frontier Brain to draft it.'}/>}
    {editing&&<div className="save-bar">{error?<span className="error">{error}</span>:<span>{d.dirty?'Unsaved changes':'No changes'}</span>}<div className="button-row"><button disabled={busy} onClick={()=>{d.discard();setEditing(false);setError('');}}>{d.dirty?'Discard':'Close'}</button><button className="primary" disabled={busy||!d.dirty} onClick={()=>void save()}>{busy?'Saving…':'Save'}</button></div></div>}
  </section>;
}
// "Save as V2": versions are milestones the player chooses (e.g. before an event). Edits in between are logged quietly.
// Version picker: switch versions, or "Save as new version…" to keep the current six as a milestone you can come back
// to (e.g. before a tournament). Edits between milestones are logged quietly on the version.
function VersionPicker({team,tab,versionId,all,games,mutate}:{team:any;tab:string;versionId:string;all:boolean;games:any[];mutate:(a:any)=>Promise<any>}){
  const current=team.versions.find((v:any)=>v.id===team.activeVersionId);const edits=current.configurations.length-1;const next=team.versions.length+1;
  const [busy,setBusy]=useState(false);
  const save=async()=>{setBusy(true);try{const r=await mutate({type:'team-milestone',teamId:team.id,parentConfigurationId:current.currentConfigurationId,label:team.name});location.hash=teamHref(team.id,'overview',r.result.versionId);}catch{}finally{setBusy(false);}};
  const describe=(v:any)=>`V${v.number}${v.label?`: ${v.label}`:''}${v.id===team.activeVersionId?` (current${edits?` · ${edits} edit${edits===1?'':'s'}`:''})`:''}${(r=>r.n?` · ${r.label}`:'')(record(games.filter((x:any)=>x.association?.versionId===v.id)))}`;
  return <><label className="version-select"><span className="sr-only">Version</span><select value={all?'all':versionId} onChange={e=>{if(e.target.value==='new'){e.target.value=all?'all':versionId;if(!busy)void save();return;}location.hash=teamHref(team.id,tab,e.target.value);}}>
    {team.versions.length>1&&<option value="all">All versions</option>}
    {team.versions.map((v:any)=><option key={v.id} value={team.versions.length>1?v.id:'all'}>{describe(v)}</option>)}
    <option disabled>──────────</option>
    <option value="new">{busy?`Saving V${next}…`:`Save as new version (V${next})`}</option></select></label></>;
}
// Every version, newest first, each with its edit log. Older edits can be viewed and restored; nothing is overwritten.
// History: every saved change, newest first, across the team's whole life. Versions are kept in the data (and older
// milestones still exist) but the player never manages them; restoring an edit records it as a new change.
function Versions({team,data,mutate}:{team:any;data:any;games?:any[];mutate:(a:any)=>Promise<any>}){
  const [viewing,setViewing]=useState<{version:any;config:any}|null>(null);
  const active=team.versions.find((v:any)=>v.id===team.activeVersionId);
  const entries=team.versions.flatMap((v:any)=>v.configurations.map((c:any,n:number)=>({v,c,first:n===0}))).sort((a:any,b:any)=>b.c.createdAt.localeCompare(a.c.createdAt));
  const label=(e:any)=>e.first?(e.v.number===1?'Team created':`Saved as V${e.v.number}${e.v.label?`: ${e.v.label}`:''}`):e.c.summary||'Edit';
  const restore=async(e:any)=>{if(!confirm(`Restore the team as it was on ${date(e.c.createdAt)}? The current sets are kept in history.`))return;
    await mutate({type:'team-configure',teamId:team.id,versionId:active.id,parentConfigurationId:active.currentConfigurationId,slots:e.c.slots,summary:`Restored from ${date(e.c.createdAt)}`}).catch(()=>{});};
  return <div className="versions history">
    <ol className="history-list">{entries.map((e:any)=>{const now=e.c.id===active.currentConfigurationId;const sets=getView(team,data.db,e.v.id,e.c.id).sets;
      return <li key={e.c.id} className={now?'current':''}><span className="when">{date(e.c.createdAt)}</span><span className="what">{label(e)}</span>
        <span className="team-six mini">{sets.map((s:any,i:number)=><Art key={i} name={s.species} art={data.art} small/>)}</span>
        {now?<span className="tag ok">Current</span>:<span className="button-row"><button className="compact" onClick={()=>setViewing({version:e.v,config:e.c})}><Px icon={Eye} size={12}/>View</button><button className="compact" onClick={()=>void restore(e)}>Restore</button></span>}</li>;})}</ol>
    {viewing&&<Modal title={`Team on ${date(viewing.config.createdAt)}`} onClose={()=>setViewing(null)}><p className="muted">{viewing.config.summary||'Saved'}</p><div className="proposals">{getView(team,data.db,viewing.version.id,viewing.config.id).sets.map((s:any,i:number)=><SetTile key={i} set={s} art={data.art}/>)}</div></Modal>}
    <section className="danger-zone"><div><h3>Delete this team</h3><p className="muted">Removes the team, its history and strategy. Its sets stay in your Pokémon library and its replays stay saved, just unlinked.</p></div>
      <button className="danger" onClick={()=>{if(confirm(`Delete “${team.name}”? This can't be undone.`))void mutate({type:'team-delete',teamId:team.id}).then(()=>{location.hash='#teams';}).catch(()=>{});}}>Delete team</button></section>
  </div>;
}

export function TeamsLanding({data,onImport,onReview,reload}:{data:any;onImport:()=>void;onReview:(r:{jobId:string;proposal:any})=>void;reload?:()=>Promise<void>}){
  const inbox=data.games.filter((g:any)=>!g.association);
  return <div className="teams-landing"><div className="landing-head"><h1>Your teams</h1></div>
    <BuildJobs onReview={onReview} art={data.art}/>
    <div className="team-list">{data.teams.map((t:any)=>{const games=data.games.filter((g:any)=>g.association?.teamId===t.id);const r=record(games);return <a className="team-card" href={teamHref(t.id,'overview')} key={t.id}><div className="team-card-title"><h3>{t.name}</h3><span className="tag">V{t.view.version.number}{t.view.version.label?` · ${t.view.version.label}`:''}</span></div><div className="team-six">{t.view.sets.map((s:any,i:number)=><Art key={i} name={s.species} art={data.art} small/>)}</div><div className="card-footer"><span className="tag">{formatLabel(t.format)}</span><span>{r.n?`${r.label} in ${r.n} game${r.n===1?'':'s'}`:'No games yet'}</span></div></a>;})}<button className="team-card new-team-slot" onClick={onImport}><Px icon={Plus} size={24}/><span>New team</span><small>From a tournament list, a paste, or a prompt</small></button></div>
    {inbox.length>0?<Notice>{inbox.length} replay(s) aren't linked to a team. <a href="#inbox">Open the inbox →</a></Notice>:null}
    <SampleTeams data={data} reload={reload}/>
    </div>;
}

// Background team builds: live steps while running, then a draft to review.
const buildSteps:Record<string,string>={meta_overview:'Read the meta',team_pool_sets:'Pool sets',standard_set:'Typical set',calc_damage:'Damage calc',calc_speed:'Speed check',spread_search:'Spread search',usage_data:'Usage data',dex_lookup:'Dex',get_team:'Team',validation:'Rules check'};
function BuildJobs({onReview,art}:{onReview:(r:{jobId:string;proposal:any})=>void;art:any}){
  const [jobs,setJobs]=useState<any[]>([]);
  // Polls only while a build is running (checked once on load, then after starting one, which reloads this page).
  useEffect(()=>{let alive=true,timer:any;const tick=()=>api('/ai-jobs').then(j=>{if(!alive)return;const builds=j.filter((x:any)=>x.area==='build'&&!x.dismissed);setJobs(builds);if(builds.some((x:any)=>x.status==='running'))timer=setTimeout(tick,2500);}).catch(()=>{});void tick();return()=>{alive=false;clearTimeout(timer);};},[]);
  if(!jobs.length)return null;
  return <div className="build-jobs">{jobs.map(j=>{const team=j.result?.proposals?.find((p:any)=>p.kind==='team');const last=j.steps.at(-1);return <article key={j.id} className={'build-job '+j.status}><div><span className="eyebrow">{j.status==='running'?'BUILDING…':j.status==='done'?'DRAFT READY':j.status==='failed'?'BUILD FAILED':'INTERRUPTED'}</span><h3>{team?.name??j.title}</h3>
      {j.status==='running'&&<p className="muted">{j.steps.length} research step(s){last?` · ${buildSteps[last.name]??last.name}${last.input?`: ${last.input}`:''}`:' · starting'}</p>}
      {team&&<div className="team-six">{team.sets.map((s:any)=><Art key={s.species} name={s.species} art={art} small/>)}</div>}{j.error&&<p className="error">{j.error}</p>}</div>
    <div className="button-row">{team&&<button className="primary" onClick={()=>onReview({jobId:j.id,proposal:team})}>Review draft</button>}{j.status!=='running'&&<button onClick={()=>void api('/ai-job-dismiss',{id:j.id}).then(()=>setJobs(jobs.filter(x=>x.id!==j.id)))}>Dismiss</button>}</div></article>;})}</div>;
}

// Replays are read from the player's side, so Frontier Brain needs their Showdown name (and any alts).

// Starter teams: recent tournament top-8 lists with the players' shared spreads, plus a ladder team with replays.
function SampleTeams({data,reload}:{data:any;reload?:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(data.teams.length)return null;
  const add=async()=>{setBusy(true);setError('');try{await api('/samples',{});await reload?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="sample-offer"><p>Want examples to explore? Add five sample teams: recent Regional top-8 teams with the players' own spreads, and a ladder team with replays.</p><button disabled={busy} onClick={()=>void add()}>{busy?'Adding…':'Add sample teams'}</button>{error&&<p className="error">{error}</p>}</div>;
}
