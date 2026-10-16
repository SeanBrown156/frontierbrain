import {FORMATS,formatLabel} from '../../shared/formats.ts';
import {useState,useEffect,useRef} from 'react';
import {api,Art,Panel,Modal,Notice,date,Markdown,type MonRef,TypeBadges,ItemIcon,useDex,useBattleForm,SetArt,MegaBadge,TYPE_COLOURS,Button,LinkButton,Tag,Field,TabLinks} from '../ui.tsx';
import {Px,Share,Home,Target,Play,ArrowLeft,Pencil,Plus,Eye,Check,WarningDiamond,SettingsCog,Copy,Link,Swap,Users} from '../icons.tsx';
import Replays from './Replays.tsx';
import Coaching from './Coaching.tsx';
import Bench from './Bench.tsx';
import {BENCH_LABEL} from '../../shared/workbench.ts';
import {getView,versionName,stats,natureEffect} from './editors.tsx';
import {setStrategyText} from '../../shared/workbench.ts';
import {useDraft,useOffers,takeOffer} from '../save-state.ts';
import SetTile from '../ai/SetTile.tsx';
import type {Mutate} from './PokemonWorkspace.tsx';

export const teamHref=(teamId:string,tab:string,versionId='all')=>`#team/${teamId}/${tab}/${versionId}`;
export const monHref=(teamId:string,versionId:string,slot:number,swap=false)=>`#team/${teamId}/mon/${versionId}/${slot}${swap?'/swap':''}`;
export function record(games:any[]){const w=games.filter(g=>g.result==='win').length,l=games.filter(g=>g.result==='loss').length;return {w,l,n:games.length,label:games.length?`${w}–${l}`:'no games'};}
const tabs=[['overview','Pokémon',Home],['strategy','Strategy',Target],['bench',BENCH_LABEL,Users],['replays','Replays',Play],['history','Manage',SettingsCog]] as const;
const statLabel:Record<string,string>={hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'};
export const sourceName=(v:any)=>v.source==='observed'?'from replays':v.source==='paste'||v.number===1?'from paste':v.configurations?.[0]?.summary?.startsWith('Restored')?v.configurations[0].summary.toLowerCase():'saved version';

export default function TeamHub({team,data,mutate,notify,load,tab,versionId}:{team:any;data:any;mutate:Mutate;notify:(s:string)=>void;load:()=>Promise<void>;tab:string;versionId:string}){
  const all=versionId==='all'||!team.versions.some((v:any)=>v.id===versionId);
  const teamGames=data.games.filter((g:any)=>g.association?.teamId===team.id);const scopedGames=all?teamGames:teamGames.filter((g:any)=>g.association?.versionId===versionId);
  const [renaming,setRenaming]=useState(false),[name,setName]=useState(team.name);
  const shown=all?team.versions.find((v:any)=>v.id===team.activeVersionId):team.versions.find((v:any)=>v.id===versionId);
  const [copied,setCopied]=useState(false),[publishing,setPublishing]=useState(false);
  // Showdown: copy the export straight to the clipboard (the button itself says Copied).
  const copyShowdown=async()=>{const getPaste=()=>api(`/export?team=${team.id}&version=${shown.id}&configuration=${shown.currentConfigurationId}`).then((r:any)=>{if(r.errors?.length)notify('Copied. Note: this team is not legal in its format right now, so check the paste before using it.');return String(r.paste);});
    try{if(typeof ClipboardItem!=='undefined'&&navigator.clipboard?.write)await navigator.clipboard.write([new ClipboardItem({'text/plain':getPaste().then(t=>new Blob([t],{type:'text/plain'}))})]);
      else await navigator.clipboard.writeText(await getPaste());
      setCopied(true);setTimeout(()=>setCopied(false),2000);}catch(e){notify((e as Error).message||'Could not copy. Allow clipboard access and try again.');}};
  // PokePaste: the browser itself posts the team to pokepast.es into a tab opened by the click, so the paste page opens
  // directly (nothing goes through our server and there is no blank tab to land on).
  const openPokepaste=async()=>{const w=window.open('about:blank','fb-pokepaste');setPublishing(true);
    try{const r:any=await api(`/export?team=${team.id}&version=${shown.id}&configuration=${shown.currentConfigurationId}`);
      const form=document.createElement('form');form.method='POST';form.action='https://pokepast.es/create';form.target=w?'fb-pokepaste':'_blank';form.style.display='none';
      for(const [k,v] of Object.entries({paste:String(r.paste),title:team.name.slice(0,100),author:String(data.profile?.player??'').slice(0,60),notes:''})){const i=document.createElement('input');i.type='hidden';i.name=k;i.value=v;form.appendChild(i);}
      document.body.appendChild(form);form.submit();form.remove();}
    catch(e){w?.close();notify((e as Error).message);}finally{setPublishing(false);}};
  const rename=async()=>{setRenaming(false);if(name.trim()&&name.trim()!==team.name)await mutate({type:'team-rename',teamId:team.id,name:name.trim()}).catch(()=>setName(team.name));};
  return <div className="team-hub">
    <LinkButton variant="quiet" className="back-link" href="#teams"><Px icon={ArrowLeft} size={12}/>Teams</LinkButton>
    <div className="hub-head"><div className="hub-title">{renaming?<input className="rename" aria-label="Team name" autoFocus value={name} onChange={e=>setName(e.target.value)} onBlur={()=>void rename()} onKeyDown={e=>{if(e.key==='Enter')void rename();if(e.key==='Escape'){setName(team.name);setRenaming(false);}}}/>
        :<h1><Button variant="plain" className="title-button" title="Rename" onClick={()=>setRenaming(true)}>{team.name}<Px icon={Pencil} size={16}/></Button></h1>}</div></div>
    <div className="hub-nav"><TabLinks nav className="hub-tabs" items={tabs.map(([key,label,icon])=>({key,label,icon:<Px icon={icon}/>,href:teamHref(team.id,key,versionId),selected:tab===key||(key==='strategy'&&tab==='coaching')}))}/></div>
    {tab==='overview'&&<Overview team={team} data={data} version={shown} mutate={mutate}/>}
    {(tab==='strategy'||tab==='coaching')&&<><Strategy key={shown.id} team={team} data={data} version={shown} all={all} mutate={mutate}/><Coaching team={team} data={data} mutate={mutate} notify={notify} versionId={all?undefined:versionId} games={scopedGames}/></>}
    {tab==='bench'&&<Bench team={team} data={data} mutate={mutate} notify={notify}/>}
    {tab==='replays'&&<Replays team={team} data={data} versionId={all?'all':versionId} load={load} notify={notify}/>}
    {tab==='history'&&<Versions team={team} data={data} games={teamGames} mutate={mutate} notify={notify} onExport={()=>void copyShowdown()} onPokepaste={()=>void openPokepaste()} publishing={publishing} copied={copied}/>}
  </div>;
}
function Overview({team,data,version,mutate}:{team:any;data:any;version:any;mutate:Mutate}){
  const view=getView(team,data.db,version.id);const active=version.id===team.activeVersionId;const current=team.versions.find((v:any)=>v.id===team.activeVersionId);
  return <div className="hub-overview">
    {!active&&<Notice className="warn">Viewing {versionName(version)}, an older version (read-only). <LinkButton href={teamHref(team.id,'overview',team.activeVersionId)}>Back to {versionName(current)}</LinkButton><Button onClick={()=>{if(confirm(`Bring back ${versionName(version)}'s six as a new version (V${team.versions.length+1})? Nothing is deleted.`))void mutate({type:'team-milestone',teamId:team.id,fromVersionId:version.id}).then(r=>{location.hash=teamHref(team.id,'overview',r.result.versionId);}).catch(()=>{});}}>Make it the current team</Button></Notice>}
    {version.source==='observed'&&<p className="footnote">Rebuilt from replays: <b>bold</b> moves were seen in battle; anything tagged “guess” is an assumption.</p>}
    <div className="six-grid">{view.revisions.map(({revision},i)=><MonCard key={i} i={i} revision={revision} href={monHref(team.id,version.id,i)} active={active} art={data.art}/>)}</div>
  </div>;
}
// One of the six. A Mega Stone holder shows its Mega (render and types), since that's what it battles as.
export function MonCard({i,revision,href,active,art,numbered=true}:{i:number;revision:any;href:string;active:boolean;art:any;numbered?:boolean}){
  const s=revision.set;const obs=revision.provenance==='observed';const form=useBattleForm(s.species,s.item);const mt=useDex([],[],s.moves??[]).moves;
  return <a className={'mon-card'+(active?'':' read-only')} href={href} aria-label={`${s.species}: open set and calc`} style={{'--i':i} as any}>
      {numbered&&<span className="mon-slot" aria-hidden="true">{String(i+1).padStart(2,'0')}</span>}
      <div className="mon-card-head"><Art name={form} fallback={s.species} art={art}/><div><h3 className="name-row">{s.nickname?`${s.nickname} (${s.species})`:s.species}{form!==s.species&&<MegaBadge/>}</h3><div className="mon-tags"><TypeBadges species={form}/></div></div></div>
      <p className="mon-item"><ItemIcon item={s.item}/>{s.item||'No item'}{obs&&revision.fields?.item==='inferred'&&<span className="guess">guess</span>}<span className="mon-meta">{s.ability} · {s.nature}</span></p>
      <SpBars species={form} points={s.statPoints??{}} nature={s.nature}/>
      <ul className="move-list">{s.moves?.map((m:string)=><li key={m} className={obs&&!revision.knownMoves?.includes(m)?'inferred':obs?'known':''}>{mt[m]&&<span className="type-badge mini" style={{'--type':TYPE_COLOURS[mt[m]]??'#888'} as any}>{mt[m]}</span>}<span>{m}</span></li>)}</ul>
</a>;
}
// Card stat bars: the species' base stat with the set's stat points stacked on the end (the same drawing as the
// Pokémon page). Final stats live on the Pokémon page, where they come from the stat tool.
function SpBars({species,points,nature}:{species:string;points:Record<string,number>;nature?:string}){
  const base=useDex([species],[]).base[species];const scale=(v:number)=>`${Math.min(100,100*v/200)}%`;
  return <div className="sp-bars" aria-label="Base stats and stat points">{stats.map(k=>{const b=base?.[k]??0,sp=points[k]??0;
    return <div key={k} className={'sp-bar'+(sp?' has-sp':'')}><span className="k">{statLabel[k]}{natureEffect(nature,k)>0?<b className="nat up" title={`${nature}: +10%`}>↑</b>:natureEffect(nature,k)<0?<b className="nat down" title={`${nature}: −10%`}>↓</b>:null}</span><span className="track"><i className="b" style={{width:scale(b)}}/><i className="p" style={{width:scale(sp)}}/></span><span className="v">{base?b:'—'}{sp>0&&<b>+{sp}</b>}</span></div>;})}</div>;
}
// Lead and matchup drafts that came with an AI team are added to Coaching as proposals to accept there.
export async function addPlans(team:any,data:any,mutate:Mutate,p:any,versionId:string){
  if(!p.leads?.length&&!p.matchups?.length)return;const c=data.db.coaching?.[team.id]??{version:0,leads:[],matchups:[],objectives:[]};const id=()=>Math.random().toString(36).slice(2,12);
  await mutate({type:'coaching-update',teamId:team.id,upsert:{leads:p.leads.map((l:any)=>({...l,id:id(),calcIds:[],versionIds:[versionId],status:'proposed'})),matchups:p.matchups.map((m:any)=>({...m,id:id(),calcIds:[],versionIds:[versionId],status:'proposed'}))}});
}
// The team's game plan. Edits (or a rewrite accepted from Ask Frontier Brain) save themselves.
function Strategy({team,data,version,all,mutate}:{team:any;data:any;version:any;all:boolean;mutate:Mutate}){
  const d=useDraft<string>(`strategy-${version.id}`,version.notes??'',version.notes??'','Strategy',{guard:false});const [editing,setEditing]=useState(false),[error,setError]=useState('');
  useOffers(`strategy:${team.id}`,text=>{d.setDraft(text);setEditing(true);return true;});
  useEffect(()=>{const t=takeOffer(`strategy:${team.id}`);if(t){d.setDraft(t);setEditing(true);}},[]);
  // Saves itself a moment after you stop typing, and when you click Done or leave the page.
  const latest=useRef(d.draft);latest.current=d.draft;const dirty=useRef(d.dirty);dirty.current=d.dirty;
  const save=()=>{if(!dirty.current)return Promise.resolve();const text=latest.current;d.markSaving(text);
    return mutate({type:'version-notes',teamId:team.id,versionId:version.id,notes:text},{quiet:true,before:()=>d.markSaved(text)}).then(()=>setError(''),e=>{d.markFailed();setError((e as Error).message);});};
  useEffect(()=>{if(!d.dirty)return;const t=setTimeout(()=>void save(),1000);return()=>clearTimeout(t);},[d.draft]);
  useEffect(()=>()=>void save(),[]);
  return <section className="strategy-block"><div className="strategy-head"><h2>Strategy</h2><span className="grow"/>{editing?<Button onClick={()=>{void save();setEditing(false);}}><Px icon={Check}/>Done</Button>:<Button onClick={()=>setEditing(true)}><Px icon={Pencil}/>Edit</Button>}</div>
    {editing?<textarea aria-label="Strategy" rows={14} value={d.draft} onChange={e=>d.setDraft(e.target.value)} placeholder="What the team is for and how it wins, in a paragraph or two." autoFocus/>:<TeamGuide team={team} data={data} version={version} text={d.draft}/>}
    {error&&<p className="set-pending" role="status"><Px icon={WarningDiamond} size={12}/>Not saved yet: {error}</p>}
  </section>;
}
// Strategy, then the team. The write-up is the team's intent in a paragraph or two; clicking one of the six opens that
// Pokémon's own strategy (its notes from the Pokémon page) underneath, with a link through to its page.
const mergedNotes=(n:any)=>setStrategyText(n);
function TeamGuide({team,data,version,text}:{team:any;data:any;version:any;text:string}){
  const view=getView(team,data.db,version.id);const mons:MonRef[]=view.sets.map((s:any,i:number)=>({name:s.species,set:s,href:monHref(team.id,version.id,i)}));
  const [open,setOpen]=useState<number|null>(null);const r=open===null?null:view.revisions[open];
  return <div className="team-guide">
    {text.trim()?<div className="guide-intro"><Markdown text={text}/></div>:<p className="muted">No strategy yet.</p>}
    <div className="guide-team"><span className="eyebrow">The team</span>
      <div className="guide-six" role="tablist">{view.sets.map((s:any,i:number)=><Button variant="tile" key={i} role="tab" aria-selected={open===i} className={open===i?'on':undefined} onClick={()=>setOpen(open===i?null:i)}><SetArt set={s} art={data.art}/><span>{s.species}</span></Button>)}</div>
      {r&&<div className="guide-mon" role="tabpanel"><div className="guide-mon-head"><h3>{r.revision.set.species}</h3><LinkButton variant="quiet" href={monHref(team.id,version.id,open!)}>Go to {r.revision.set.species} →</LinkButton></div>
        {mergedNotes(r.revision.notes).trim()?<Markdown text={mergedNotes(r.revision.notes)}/>:<p className="muted">No strategy for {r.revision.set.species} yet. Add it on its page.</p>}</div>}
    </div>
  </div>;
}
// "Save as V2": versions are milestones the player chooses (e.g. before an event). Edits in between are logged quietly.
// Version picker: switch versions, or "Save as new version…" to keep the current six as a milestone you can come back
// to (e.g. before a tournament). Edits between milestones are logged quietly on the version.
function VersionPicker({team,tab,versionId,all,games,mutate}:{team:any;tab:string;versionId:string;all:boolean;games:any[];mutate:Mutate}){
  const current=team.versions.find((v:any)=>v.id===team.activeVersionId);const edits=current.configurations.length-1;const next=team.versions.length+1;
  const [busy,setBusy]=useState(false);
  const save=async()=>{setBusy(true);try{const r=await mutate({type:'team-milestone',teamId:team.id,parentConfigurationId:current.currentConfigurationId,label:team.name});location.hash=teamHref(team.id,'overview',r.result.versionId);}catch{}finally{setBusy(false);}};
  const describe=(v:any)=>`V${v.number}${v.label?`: ${v.label}`:''}${v.id===team.activeVersionId?` (current${edits?` · ${edits} edit${edits===1?'':'s'}`:''})`:''}${(r=>r.n?` · ${r.label}`:'')(record(games.filter((x:any)=>x.association?.versionId===v.id)))}`;
  return <><Field className="version-select" label={<span className="sr-only">Version</span>}><select value={all?'all':versionId} onChange={e=>{if(e.target.value==='new'){e.target.value=all?'all':versionId;if(!busy)void save();return;}location.hash=teamHref(team.id,tab,e.target.value);}}>
    {team.versions.length>1&&<option value="all">All versions</option>}
    {team.versions.map((v:any)=><option key={v.id} value={team.versions.length>1?v.id:'all'}>{describe(v)}</option>)}
    <option disabled>──────────</option>
    <option value="new">{busy?`Saving V${next}…`:`Save as new version (V${next})`}</option></select></Field></>;
}
// Every version, newest first, each with its edit log. Older edits can be viewed and restored; nothing is overwritten.
// History: every saved change, newest first, across the team's whole life. Versions are kept in the data (and older
// milestones still exist) but the player never manages them; restoring an edit records it as a new change.
// Manage: export (Showdown paste or PokePaste), the format, duplicating, every saved change, and deleting the team.
function Versions({team,data,mutate,notify,onExport,onPokepaste,publishing,copied}:{team:any;data:any;games?:any[];mutate:Mutate;notify:(s:string)=>void;onExport:()=>void;onPokepaste:()=>void;publishing:boolean;copied:boolean}){
  const [viewing,setViewing]=useState<{version:any;config:any}|null>(null);
  const active=team.versions.find((v:any)=>v.id===team.activeVersionId);
  const entries=team.versions.flatMap((v:any)=>v.configurations.map((c:any,n:number)=>({v,c,first:n===0}))).sort((a:any,b:any)=>b.c.createdAt.localeCompare(a.c.createdAt));
  const label=(e:any)=>e.first?(e.v.number===1?'Team created':`Saved as V${e.v.number}${e.v.label?`: ${e.v.label}`:''}`):e.c.summary||'Edit';
  const restore=async(e:any)=>{if(!confirm(`Restore the team as it was on ${date(e.c.createdAt)}? The current sets are kept in history.`))return;
    await mutate({type:'team-configure',teamId:team.id,versionId:active.id,parentConfigurationId:active.currentConfigurationId,slots:e.c.slots,summary:`Restored from ${date(e.c.createdAt)}`}).catch(()=>{});};
  return <div className="versions history manage">
    <div className="manage-tiles">
      <section className="manage-tile"><span className="eyebrow">Export</span><div className="manage-actions"><Button onClick={onExport} className={copied?'copied':undefined}><Px icon={copied?Check:Share}/>{copied?'Copied':'Showdown'}</Button><Button onClick={onPokepaste} disabled={publishing}><Px icon={Link}/>{publishing?'Opening…':'PokePaste'}</Button></div></section>
      <FormatTile team={team} mutate={mutate} notify={notify}/>
      <DuplicateTile team={team} mutate={mutate} notify={notify}/>
    </div>
    <section className="manage-history"><h2 className="manage-title">History</h2>
    <ol className="history-list">{entries.map((e:any)=>{const now=e.c.id===active.currentConfigurationId;const sets=getView(team,data.db,e.v.id,e.c.id).sets;
      return <li key={e.c.id} className={now?'current':''}><span className="when">{date(e.c.createdAt)}</span><span className="what" title={label(e)}>{label(e)}</span>
        <span className="team-six mini">{sets.map((s:any,i:number)=><SetArt key={i} set={s} art={data.art} small/>)}</span>
        {now?<Tag tone="ok">Current</Tag>:<span className="button-row"><Button size="compact" onClick={()=>setViewing({version:e.v,config:e.c})}><Px icon={Eye} size={14}/>View</Button><Button size="compact" onClick={()=>void restore(e)}>Restore</Button></span>}</li>;})}</ol></section>
    {viewing&&<Modal title={`Team on ${date(viewing.config.createdAt)}`} onClose={()=>setViewing(null)}><p className="muted">{viewing.config.summary||'Saved'}</p><div className="proposals">{getView(team,data.db,viewing.version.id,viewing.config.id).sets.map((s:any,i:number)=><SetTile key={i} set={s} art={data.art}/>)}</div></Modal>}
    <section className="danger-zone"><div><h3>Delete this team</h3><p className="muted">Deletes the team, its history, strategy, bench, replays and their analysis. Its sets stay in your Pokémon library.</p></div>
      <Button variant="danger" solid onClick={()=>{if(confirm(`Delete “${team.name}” and its replays? This can't be undone.`))void mutate({type:'team-delete',teamId:team.id}).then(()=>{location.hash='#teams';}).catch(()=>{});}}>Delete team</Button></section>
  </div>;
}

export function TeamsLanding({data,onImport,onReview,reload}:{data:any;onImport:()=>void;onReview:(r:{jobId:string;proposal:any})=>void;reload?:()=>Promise<void>}){
  return <div className="teams-landing"><div className="landing-head"><h1>Your teams</h1></div>
    <BuildJobs onReview={onReview} art={data.art}/>
    <div className="team-list">{data.teams.map((t:any)=>{const games=data.games.filter((g:any)=>g.association?.teamId===t.id);const r=record(games);return <a className="team-card" href={teamHref(t.id,'overview')} key={t.id}><div className="team-card-title"><h3>{t.name}</h3></div><div className="team-six">{t.view.sets.map((s:any,i:number)=><SetArt key={i} set={s} art={data.art} small/>)}</div><div className="card-footer"><Tag>{formatLabel(t.format)}</Tag>{r.n>0&&<span className="card-record">{`${r.label} in ${r.n} game${r.n===1?'':'s'}`}</span>}</div></a>;})}<Button variant="tile" className="team-card new-team-slot" onClick={onImport}><Px icon={Plus} size={24}/><span>New team</span><small>From a tournament list, a paste, or a prompt</small></Button></div>
    </div>;
}

// A team's format is set when it's created. Changing rules can make sets illegal, so moving to another format copies
// the current six (and the team strategy) into a new team for that format; this one is left exactly as it is.
function FormatTile({team,mutate,notify}:{team:any;mutate:Mutate;notify:(s:string)=>void}){
  const [target,setTarget]=useState<string>(team.format),[busy,setBusy]=useState(false);useEffect(()=>setTarget(team.format),[team.format]);
  const change=async()=>{setBusy(true);try{await mutate({type:'team-format',teamId:team.id,format:target});notify(`Now ${formatLabel(target)}. Check the sets against its rules.`);}catch(e){notify((e as Error).message);}finally{setBusy(false);}};
  return <section className="format-tile manage-tile"><span className="eyebrow">Format</span>
    <div className="format-copy manage-actions"><Field label={<span className="sr-only">Format</span>}><select value={target} onChange={e=>setTarget(e.target.value)}>{FORMATS.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></Field><Button disabled={busy||target===team.format} onClick={()=>void change()}><Px icon={Swap}/>{busy?'Changing…':'Change'}</Button></div></section>;
}
// A copy of the current six (sets and notes) as a new team in the same format; change its format from its own Manage tab.
function DuplicateTile({team,mutate,notify}:{team:any;mutate:Mutate;notify:(s:string)=>void}){
  const [busy,setBusy]=useState(false);
  const duplicate=async()=>{setBusy(true);try{const active=team.versions.find((v:any)=>v.id===team.activeVersionId);const {paste}=await api(`/export?team=${team.id}&version=${active.id}&configuration=${active.currentConfigurationId}`);
      const r=await mutate({type:'import',name:`${team.name} (copy)`,paste,format:team.format,notes:active.notes??'',benchFrom:team.id});notify(`Duplicated as ${team.name} (copy).`);location.hash=teamHref(r.result.id,'history');}
    catch(e){notify((e as Error).message);}finally{setBusy(false);}};
  return <section className="manage-tile"><span className="eyebrow">Duplicate</span><div className="manage-actions"><Button disabled={busy} onClick={()=>void duplicate()}><Px icon={Copy}/>{busy?'Duplicating…':'Duplicate team'}</Button></div></section>;
}
// Background team builds: live steps while running, then a draft to review.
const buildSteps:Record<string,string>={meta_overview:'Read the meta',team_pool_sets:'Pool sets',standard_set:'Typical set',calc_damage:'Damage calc',calc_speed:'Speed check',spread_search:'Spread search',usage_data:'Usage data',legal_options:'Dex',get_team:'Team',validation:'Rules check'};
function BuildJobs({onReview,art}:{onReview:(r:{jobId:string;proposal:any})=>void;art:any}){
  const [jobs,setJobs]=useState<any[]>([]);
  // Polls only while a build is running (checked once on load, then after starting one, which reloads this page).
  useEffect(()=>{let alive=true,timer:any;const tick=()=>api('/ai-jobs').then(j=>{if(!alive)return;const builds=j.filter((x:any)=>x.area==='build'&&!x.dismissed);setJobs(builds);if(builds.some((x:any)=>x.status==='running'))timer=setTimeout(tick,2500);}).catch(()=>{});void tick();return()=>{alive=false;clearTimeout(timer);};},[]);
  if(!jobs.length)return null;
  return <div className="build-jobs">{jobs.map(j=>{const team=j.result?.proposals?.find((p:any)=>p.kind==='team');const last=j.steps.at(-1);return <article key={j.id} className={'build-job '+j.status}><div><span className="eyebrow">{j.status==='running'?'BUILDING…':j.status==='done'?'DRAFT READY':j.status==='failed'?'BUILD FAILED':'INTERRUPTED'}</span><h3>{team?.name??j.title}</h3>
      {j.status==='running'&&<p className="muted">{j.steps.length} research step(s){last?` · ${buildSteps[last.name]??last.name}${last.input?`: ${last.input}`:''}`:' · starting'}</p>}
      {team&&<div className="team-six">{team.sets.map((s:any)=><SetArt key={s.species} set={s} art={art} small/>)}</div>}{j.error&&<p className="error">{j.error}</p>}</div>
    <div className="button-row">{team&&<Button variant="primary" onClick={()=>onReview({jobId:j.id,proposal:team})}>Review draft</Button>}{j.status!=='running'&&<Button onClick={()=>void api('/ai-job-dismiss',{id:j.id}).then(()=>setJobs(jobs.filter(x=>x.id!==j.id)))}>Dismiss</Button>}</div></article>;})}</div>;
}

// Replays are read from the player's side, so Frontier Brain needs their Showdown name (and any alts).

