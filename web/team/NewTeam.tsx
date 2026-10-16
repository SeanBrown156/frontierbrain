import {FORMATS} from '../../shared/formats.ts';
import {useState} from 'react';
import {useEffect} from 'react';
import {api,Modal,Notice,Tabs,Markdown,PokeIcon,Button,Field,Tag,Switch} from '../ui.tsx';
import {Px,Sparkles} from '../icons.tsx';
import {teamHref} from './Hub.tsx';
import {ModelPicker} from '../ai/AssistDock.tsx';
import {useAccount,canUseAI,SignInForAI} from '../auth.tsx';

const newId=()=>Math.random().toString(36).slice(2,12);
// "+ New team": build from a prompt (AI researches with usage data and calcs, rules-checked locally),
// or import a Showdown paste / PokePaste link. Nothing is saved until "Create team".
export default function NewTeam({mutate,load,onClose,notify,review}:{mutate:(a:any)=>Promise<any>;load:()=>Promise<void>;onClose:()=>void;notify:(s:string)=>void;review?:{jobId:string;proposal:any}}){
  const account=useAccount();
  const [tab,setTab]=useState(review?'Paste or PokePaste link':'From tournaments'),[prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const initial=review?{...review.proposal,sets:review.proposal.roles??[]}:null;
  const [format,setFormat]=useState<string>(FORMATS[0].id),[draft]=useState<any>(initial),[name,setName]=useState(initial?.name??''),[paste,setPaste]=useState(initial?.paste??''),[strategy,setStrategy]=useState(initial?.strategy??''),[link,setLink]=useState(''),[slots,setSlots]=useState<{species:string;spread:string;basis:string}[]>([]);
  // Builds run as background jobs: the dialog closes and progress shows on the Teams page.
  const build=async()=>{setBusy(true);setError('');try{await api('/ai-jobs',{area:'build',messages:[{role:'user',content:prompt}]});notify('Building in the background. Progress is on the Teams page.');onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const fetchPaste=async()=>{setBusy(true);setError('');try{const r=await api('/pokepaste?url='+encodeURIComponent(link.trim()));setPaste(r.paste);if(r.title)setName(r.title);setStrategy([r.notes,`Imported from ${r.source}${r.author?` (by ${r.author})`:''}.`].filter(Boolean).join('\n\n'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const create=async()=>{setBusy(true);setError('');try{
      const setNotes=draft?Object.fromEntries(draft.sets.map((x:any)=>[x.species,{role:x.role,benchmarks:x.notes}])):undefined;
      const r=await mutate({type:'import',name:name.trim()||'New team',paste,format,notes:strategy,setNotes});const team=r.result;
      if(draft&&(draft.leads.length||draft.matchups.length)){const v=[team.activeVersionId];
        await api('/action',{revision:r.revision,action:{type:'coaching-save',teamId:team.id,parentVersion:0,coaching:{leads:draft.leads.map((l:any)=>({...l,id:newId(),calcIds:[],versionIds:v,status:'proposed'})),matchups:draft.matchups.map((m:any)=>({...m,id:newId(),calcIds:[],versionIds:v,status:'proposed'})),objectives:[]}}});}
      if(review)await api('/ai-job-dismiss',{id:review.jobId}).catch(()=>{});await load();location.hash=teamHref(team.id,'overview');onClose();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const hasPaste=paste.trim().length>0;
  return <Modal title={review?'Review AI draft':'New team'} onClose={onClose}><div className="new-team"><Field label="Format" className="format-choice"><select value={format} onChange={e=>setFormat(e.target.value)}>{FORMATS.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></Field>{!review&&<Tabs block tabs={['From tournaments','Build from a prompt','Paste or PokePaste link']} value={tab} onChange={setTab} icons={{'Build from a prompt':<Px icon={Sparkles}/>}}/>}
    {tab==='Build from a prompt'&&!canUseAI(account)&&<SignInForAI verb="build"/>}{tab==='Build from a prompt'&&canUseAI(account)&&<><Field label="What should this team do?"><textarea rows={5} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="e.g. A Trick Room team around Mega Gengar Perish Song with a Belly Drum Kommo-o win condition. It should handle Rillaboom/Incineroar balance and Tailwind offense."/></Field>
      <div className="button-row model-row"><span className="muted">Model</span><ModelPicker tier="build"/></div>
      <p className="footnote">Takes a few minutes. You can keep using the app meanwhile.</p>
      <div className="modal-footer"><Button variant="primary" disabled={busy||!prompt.trim()} onClick={()=>void build()}><Px icon={Sparkles}/>{busy?'Starting…':'Build team'}</Button></div></>}
    {tab==='From tournaments'&&!review&&(slots.length?<div className="picked-team"><span>Picked <b>{name}</b></span><Button variant="quiet" onClick={()=>{setSlots([]);setPaste('');setName('');setStrategy('');}}>Choose a different team</Button></div>:<TournamentPicker onPick={d=>{setName(d.name);setPaste(d.paste);setStrategy(d.notes);setSlots(d.slots);}} busy={busy} setError={setError}/>)}
    {tab==='From tournaments'&&slots.length>0&&<ul className="slot-basis">{slots.map(s=><li key={s.species}><b>{s.species}</b> <Tag tone={s.spread==='exact'?'ok':undefined}>{s.spread==='exact'?'★ Exact spread':'Spread filled'}</Tag> <span className="muted">{s.basis}</span></li>)}</ul>}
    {tab==='Paste or PokePaste link'&&!review&&<><Field label="PokePaste link" className="paste-source"><span className="paste-row"><input value={link} onChange={e=>setLink(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&link.trim()&&!busy)void fetchPaste();}} placeholder="https://pokepast.es/…"/><Button variant="primary" disabled={busy||!link.trim()} onClick={e=>{e.preventDefault();void fetchPaste();}}>{busy?'Fetching…':'Fetch paste'}</Button></span></Field></>}
    {error&&<p role="alert" className="error">{error}</p>}
    {(review||hasPaste||tab==='Paste or PokePaste link')&&<div className="draft-review"><Field label="Team name"><input value={name} onChange={e=>setName(e.target.value)} maxLength={120}/></Field>
      <Field label="Showdown paste"><textarea rows={14} value={paste} onChange={e=>setPaste(e.target.value)} spellCheck={false}/></Field>
      {review&&<><Field label="Strategy"><textarea rows={8} value={strategy} onChange={e=>setStrategy(e.target.value)}/></Field>{strategy&&<details><summary>Preview strategy</summary><Markdown text={strategy}/></details>}</>}
      {draft&&<details open><summary>Roles, leads and matchups from the build</summary><ul>{draft.sets.map((s:any)=><li key={s.species}><b>{s.species}</b>: {s.role}</li>)}</ul><p className="footnote">{draft.leads.length} lead plan(s) and {draft.matchups.length} matchup plan(s) will be added to the team's Coaching tab as drafts.</p></details>}
      <div className="modal-footer"><Button variant="primary" disabled={busy||!paste.trim()} onClick={()=>void create()}>Create team</Button></div></div>}
  </div></Modal>;
}

// Search the team pool (official and online events, shared pastes) and turn any team into a draft. Exact spreads
// come from the player's shared paste; otherwise each Pokémon's stat points are filled and labelled.
type PoolHit={id:string;lane:string;event:string;date:string|null;players:number|null;player:string;placing:number|null;record:string|null;pokemon:string[];exactSpreads:boolean};
let iconCache:Promise<Record<string,number>>|null=null;
// The search survives choosing a different team.
let lastSearch={q:'',lane:'',exact:false};
function TournamentPicker({onPick,busy,setError}:{onPick:(d:any)=>void;busy:boolean;setError:(s:string)=>void}){
  const [q,setQ]=useState(lastSearch.q),[lane,setLane]=useState(lastSearch.lane),[exact,setExact]=useState(lastSearch.exact),[result,setResult]=useState<{total:number;teams:PoolHit[]}|null>(null),[loading,setLoading]=useState(''),[icons,setIcons]=useState<Record<string,number>>({});
  useEffect(()=>{(iconCache??=api('/species-options').then((o:any[])=>Object.fromEntries(o.map(x=>[x.name,x.icon])))).then(setIcons).catch(()=>{});},[]);
  useEffect(()=>{lastSearch={q,lane,exact};let alive=true;const t=setTimeout(()=>{api(`/pool-teams?q=${encodeURIComponent(q)}${lane?`&lane=${lane}`:''}${exact?'&exact=1':''}&limit=40`).then(r=>{if(alive)setResult(r);}).catch(e=>setError(e.message));},250);return()=>{alive=false;clearTimeout(t);};},[q,lane,exact]);
  const pick=async(id:string)=>{setLoading(id);setError('');try{onPick(await api('/pool-team?id='+encodeURIComponent(id)));}catch(e){setError((e as Error).message);}finally{setLoading('');}};
    return <div className="pool-picker">
    <div className="form-grid"><Field label="Search players, events or Pokémon"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="e.g. Brisbane, Incineroar Gholdengo, Kiran"/></Field>
      <Field label="Source"><select value={lane} onChange={e=>setLane(e.target.value)}><option value="">All</option><option value="official">Official events</option><option value="online">Online events</option><option value="shared">VGCPastes</option></select></Field></div>
    <div className="pool-filter"><Switch checked={exact} onChange={e=>setExact(e.target.checked)}>Exact spreads only</Switch>
      <span className="muted">{result?`${result.total.toLocaleString()} team${result.total===1?'':'s'}`:'Loading teams…'}{!exact&&' · best results first'}</span></div>
    {!exact&&<p className="footnote">★ Exact spreads come from the player's own VGCPastes paste. Other teams get the most common spread for each Pokémon, labelled.</p>}
    {result&&!result.teams.length&&<p className="muted pool-empty">No teams match{exact?' with exact spreads':''}. Try fewer words{exact?' or turn off the filter':''}.</p>}
    <ul className="pool-list">{result?.teams.map(t=><li key={t.id}><Button variant="tile" className="pool-row" disabled={busy||!!loading} onClick={()=>void pick(t.id)}>
      <span className="pool-who"><span className="pool-name">{t.placing?<span className={'pool-place place-'+t.placing}>#{t.placing}</span>:null}<b>{t.player}</b>{t.exactSpreads&&<Tag tone="ok">★ Exact</Tag>}</span>
        <small>{[t.event||'VGCPastes',t.date,t.record,t.players?`${t.players} players`:''].filter(Boolean).join(' · ')}{loading===t.id?' · Loading…':''}</small></span>
      <span className="pool-six" aria-label={t.pokemon.join(', ')}>{t.pokemon.map((p,i)=><span key={i} title={p}><PokeIcon n={icons[p]}/></span>)}</span>
    </Button></li>)}</ul>
  </div>;
}
