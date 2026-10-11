import {useEffect,useRef,useState} from 'react';
import {User,Logout,Download,Upload} from 'pixelarticons/react';
import {api} from './ui.tsx';
import {supabase,useAccount,requireAccount} from './auth.tsx';

// The avatar in the header is the account area: who you are, your Showdown name (replays are read from that
// side), backups (how a workspace moves between this computer and an account), and sign in / sign out.
export default function AccountMenu({profile,reload,notify}:{profile?:any;reload:()=>Promise<void>;notify:(text:string,error?:boolean)=>void}){
  const account=useAccount(),[open,setOpen]=useState(false),ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);};addEventListener('mousedown',close);return()=>removeEventListener('mousedown',close);},[open]);
  const label=account.kind==='account'?account.email:account.kind==='guest'?'Guest':'This computer';
  return <div className="account-menu" ref={ref}>
    <button className="account-button" aria-expanded={open} aria-label={`Account: ${label}`} onClick={()=>setOpen(!open)}>
      <span className={'avatar'+(account.kind==='account'?'':' guest')} aria-hidden="true">{account.kind==='account'?(account.email[0]??'?').toUpperCase():<User width={16} height={16}/>}</span>
      {account.kind==='guest'&&<span>Guest</span>}
    </button>
    {open&&<div className="account-pop" role="dialog" aria-label="Account">
      <section><p className="muted">{account.kind==='account'?'Signed in as':account.kind==='guest'?'You are using Frontier Brain as a guest.':'Local workspace'}</p>{account.kind==='account'&&<b className="account-email">{account.email}</b>}</section>
      {account.kind==='guest'&&<button className="primary" onClick={()=>{setOpen(false);requireAccount();}}>Sign in or create an account</button>}
      <ShowdownName profile={profile} reload={reload} notify={notify}/>
      <Backup reload={reload} notify={notify}/>
      {account.kind==='account'&&<button onClick={()=>{setOpen(false);void supabase!.auth.signOut();}}><Logout width={16} height={16} aria-hidden="true"/>Sign out</button>}
    </div>}
  </div>;
}
function ShowdownName({profile,reload,notify}:{profile?:any;reload:()=>Promise<void>;notify:(t:string,e?:boolean)=>void}){
  const [name,setName]=useState(profile?.player??''),[aliases,setAliases]=useState((profile?.aliases??[]).join(', '));
  const dirty=name!==(profile?.player??'')||aliases!==(profile?.aliases??[]).join(', ');
  const save=async()=>{try{await api('/profile',{player:name.trim(),aliases:aliases.split(',').map((a:string)=>a.trim()).filter(Boolean)});await reload();notify('Showdown name saved.');}catch(e){notify((e as Error).message,true);}};
  return <form className="account-section" onSubmit={e=>{e.preventDefault();void save();}}>
    <label>Showdown name<input value={name} onChange={e=>setName(e.target.value)} placeholder="YourName"/></label>
    <label>Other names<input value={aliases} onChange={e=>setAliases(e.target.value)} placeholder="alt1, alt2"/></label>
    {dirty&&<button className="primary" disabled={!name.trim()}>Save</button>}
  </form>;
}
// A backup is one JSON file of everything you own here. Restoring merges: existing teams and replays are kept.
function Backup({reload,notify}:{reload:()=>Promise<void>;notify:(t:string,e?:boolean)=>void}){
  const file=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false);
  const download=async()=>{setBusy(true);try{const b=await api('/backup');const url=URL.createObjectURL(new Blob([JSON.stringify(b)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`frontierbrain-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);}catch(e){notify((e as Error).message,true);}setBusy(false);};
  const restore=async(f:File)=>{setBusy(true);try{const r=await api('/restore',JSON.parse(await f.text()));await reload();notify(`Restored ${r.teams} team${r.teams===1?'':'s'} and ${r.games} replay${r.games===1?'':'s'}. Anything already here was kept.`);}catch(e){notify(e instanceof SyntaxError?'That file is not a Frontier Brain backup.':(e as Error).message,true);}setBusy(false);if(file.current)file.current.value='';};
  return <div className="account-section"><span className="account-label">Backup</span>
    <div className="account-row"><button disabled={busy} onClick={()=>void download()}><Download width={16} height={16} aria-hidden="true"/>Download</button><button disabled={busy} onClick={()=>file.current?.click()}><Upload width={16} height={16} aria-hidden="true"/>Restore</button></div>
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void restore(f);}}/>
  </div>;
}
