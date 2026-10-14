import {useEffect,useState} from 'react';
import {api,Button,Chip} from '../ui.tsx';

// Showdown names as chips: type a name and press Enter (or a comma) to add it; × removes it. The first name is the main
// one, the rest are alternates (up to 10); every change saves straight away. Used in Settings and on the Replays tab.
export function ShowdownNamesField({profile,reload,onError}:{profile?:any;reload?:()=>Promise<void>;onError:(message:string)=>void}){
  const saved:string[]=[profile?.player,...(profile?.aliases??[])].filter(Boolean);
  const [names,setNames]=useState<string[]>(saved),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{setNames(saved);},[saved.join('|')]);
  const save=async(next:string[])=>{const before=names;setNames(next);setBusy(true);
    try{await api('/profile',{player:next[0]??'',aliases:next.slice(1)});await reload?.();}catch(e){setNames(before);onError((e as Error).message);}finally{setBusy(false);}};
  const add=()=>{const n=draft.replace(/,/g,'').trim();setDraft('');if(!n||names.some(x=>x.toLowerCase()===n.toLowerCase()))return;void save([...names,n]);};
  return <div className="examples-field"><label className="field-label" htmlFor="showdown-name">Add Showdown names</label>
    {names.length<11&&<input id="showdown-name" value={draft} disabled={busy} placeholder="Type a name and press Enter" onChange={e=>setDraft(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();add();}else if(e.key==='Backspace'&&!draft&&names.length)void save(names.slice(0,-1));}} onBlur={add}/>}
    {names.length>0&&<div className="example-chips">{names.map((n,i)=><Chip on type="button" key={n} disabled={busy} title={i===0?'Main name':'Other name'} aria-label={`Remove ${n}`} onClick={()=>void save(names.filter(x=>x!==n))}>{n} ×</Chip>)}</div>}
  </div>;
}

// Shown on the Replays tab until a name is set: replays are read from the player's side.
export default function ShowdownName({reload}:{reload?:()=>Promise<void>}){
  const [error,setError]=useState('');
  return <div className="profile-card"><div><h3>Which player are you?</h3><p className="muted">Add your Showdown name before adding replays, so they're read from your side. You can change it any time in Settings.</p></div>
    <ShowdownNamesField reload={reload} onError={setError}/>{error&&<p className="error">{error}</p>}</div>;
}
