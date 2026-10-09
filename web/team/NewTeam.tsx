import {useState} from 'react';
import {api,Modal,Notice,Tabs,Markdown} from '../ui.tsx';
import {Px,Sparkles} from '../icons.tsx';
import {teamHref} from './Hub.tsx';
import {ModelPicker} from '../ai/AssistDock.tsx';

const newId=()=>Math.random().toString(36).slice(2,12);
// "+ New team": build from a prompt (AI researches with usage data and calcs, rules-checked locally),
// or import a Showdown paste / PokePaste link. Nothing is saved until "Create team".
export default function NewTeam({mutate,load,onClose,notify,review}:{mutate:(a:any)=>Promise<any>;load:()=>Promise<void>;onClose:()=>void;notify:(s:string)=>void;review?:{jobId:string;proposal:any}}){
  const [tab,setTab]=useState(review?'Paste or PokePaste link':'Build from a prompt'),[prompt,setPrompt]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const initial=review?{...review.proposal,sets:review.proposal.roles??[]}:null;
  const [draft]=useState<any>(initial),[name,setName]=useState(initial?.name??''),[paste,setPaste]=useState(initial?.paste??''),[strategy,setStrategy]=useState(initial?.strategy??''),[link,setLink]=useState('');
  // Builds run as background jobs: the dialog closes and progress shows on the Teams page.
  const build=async()=>{setBusy(true);setError('');try{await api('/ai-jobs',{area:'build',messages:[{role:'user',content:prompt}]});notify('Building in the background. Progress is on the Teams page.');onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const fetchPaste=async()=>{setBusy(true);setError('');try{const r=await api('/pokepaste?url='+encodeURIComponent(link.trim()));setPaste(r.paste);if(r.title)setName(r.title);setStrategy([r.notes,`Imported from ${r.source}${r.author?` (by ${r.author})`:''}.`].filter(Boolean).join('\n\n'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const create=async()=>{setBusy(true);setError('');try{
      const setNotes=draft?Object.fromEntries(draft.sets.map((x:any)=>[x.species,{role:x.role,benchmarks:x.notes}])):undefined;
      const r=await mutate({type:'import',name:name.trim()||'New team',paste,notes:strategy,setNotes});const team=r.result;
      if(draft&&(draft.leads.length||draft.matchups.length)){const v=[team.activeVersionId];
        await api('/action',{revision:r.revision,action:{type:'coaching-save',teamId:team.id,parentVersion:0,coaching:{leads:draft.leads.map((l:any)=>({...l,id:newId(),calcIds:[],versionIds:v,status:'proposed'})),matchups:draft.matchups.map((m:any)=>({...m,id:newId(),calcIds:[],versionIds:v,status:'proposed'})),objectives:[]}}});}
      if(review)await api('/ai-job-dismiss',{id:review.jobId}).catch(()=>{});await load();location.hash=teamHref(team.id,'overview');onClose();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const hasPaste=paste.trim().length>0;
  return <Modal title={review?'Review AI draft':'New team'} onClose={onClose}><div className="new-team">{!review&&<Tabs tabs={['Build from a prompt','Paste or PokePaste link']} value={tab} onChange={setTab}/>}
    {tab==='Build from a prompt'&&<><label>What should this team do?<textarea rows={5} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="e.g. A Trick Room team around Mega Gengar Perish Song with a Belly Drum Kommo-o win condition. It should handle Rillaboom/Incineroar balance and Tailwind offense."/></label>
      <div className="button-row"><button className="primary" disabled={busy||!prompt.trim()} onClick={()=>void build()}><Px icon={Sparkles}/>{busy?'Starting…':'Build team'}</button><span className="muted">Model</span><ModelPicker tier="build"/></div>
      <p className="footnote">Takes a few minutes: it researches the data pool, runs calcs and checks the rules. You can keep using the app meanwhile.</p></>}
    {tab==='Paste or PokePaste link'&&!review&&<><div className="form-grid"><label>PokePaste link<input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://pokepast.es/…"/></label><button disabled={busy||!link.trim()} onClick={()=>void fetchPaste()}>Fetch paste</button></div><p className="footnote">Or paste a Showdown export straight into the box below.</p></>}
    {error&&<p role="alert" className="error">{error}</p>}
    {(review||hasPaste||tab!=='Build from a prompt')&&<div className="draft-review"><label>Team name<input value={name} onChange={e=>setName(e.target.value)} maxLength={120}/></label>
      <label>Showdown paste<textarea rows={14} value={paste} onChange={e=>setPaste(e.target.value)} spellCheck={false}/></label>
      <Notice>Champions “EVs:” are stat points: 0–32 per stat, 66 total. Illegal teams are rejected with the reason.</Notice>
      <label>Strategy<textarea rows={8} value={strategy} onChange={e=>setStrategy(e.target.value)}/></label>{strategy&&<details><summary>Preview strategy</summary><Markdown text={strategy}/></details>}
      {draft&&<details open><summary>Roles, leads and matchups from the build</summary><ul>{draft.sets.map((s:any)=><li key={s.species}><b>{s.species}</b>: {s.role}</li>)}</ul><p className="footnote">{draft.leads.length} lead plan(s) and {draft.matchups.length} matchup plan(s) will be added to the team's Coaching tab as drafts.</p></details>}
      <button className="primary" disabled={busy||!paste.trim()} onClick={()=>void create()}>Create team</button></div>}
  </div></Modal>;
}
