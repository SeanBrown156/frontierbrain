import {useState} from 'react';
import {api} from '../ui.tsx';

// Asked for where it matters: on a team's Replays tab, until the player has set it.
export default function ShowdownName({reload}:{reload?:()=>Promise<void>}){
  const [name,setName]=useState(''),[aliases,setAliases]=useState(''),[error,setError]=useState('');
  const save=async()=>{try{await api('/profile',{player:name,aliases:aliases.split(',').map(a=>a.trim()).filter(Boolean)});await reload?.();}catch(e){setError((e as Error).message);}};
  return <form className="profile-card" onSubmit={e=>{e.preventDefault();void save();}}><div><h3>Which player are you?</h3><p className="muted">Add your Showdown name so replays are read from your side. You can change it any time in Settings.</p></div>
    <label>Showdown name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="YourName"/></label>
    <label>Other names (optional)<input value={aliases} onChange={e=>setAliases(e.target.value)} placeholder="alt1, alt2"/></label>
    <button className="primary" disabled={!name.trim()}>Save</button>{error&&<p className="error">{error}</p>}</form>;
}
