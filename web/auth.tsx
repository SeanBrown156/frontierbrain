import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createClient,type Session} from '@supabase/supabase-js';

// Hosted site only: Supabase Auth. Without VITE_SUPABASE_URL the app runs in local mode with no sign-in at all.
// Nobody is asked to sign in up front: a first visit starts an anonymous guest session, so work saves straight away.
// AI features and connecting Claude/ChatGPT need an account; those places call requireAccount() to ask.
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;
export const supabase=url&&key?createClient(url,key):null;
export const hostedSite=!!supabase;
export async function accessToken(){if(!supabase)return null;const {data}=await supabase.auth.getSession();return data.session?.access_token??null;}
export type Account={kind:'local'}|{kind:'guest'}|{kind:'account';email:string};
const AccountContext=createContext<Account>({kind:'local'});
export const useAccount=()=>useContext(AccountContext);
// AI needs an account on the hosted site; locally everything is allowed.
export const canUseAI=(a:Account)=>a.kind!=='guest';

// One sign-in dialog for the whole app, opened from the avatar menu or from an AI feature.
let openDialog:(reason?:string)=>void=()=>{};
export function requireAccount(reason?:string){openDialog(reason);}

const redirectTo=()=>location.origin+location.pathname;
// Signing in to an account that already exists from a guest session switches users. The guest's own teams
// (not the samples) travel with a backup kept in this browser and are merged into the account after sign-in.
const CARRY='frontierbrain.carry';
async function call(path:string,init:RequestInit={}){const token=await accessToken();const r=await fetch('/api'+path,{...init,headers:{'Content-Type':'application/json',...token?{Authorization:`Bearer ${token}`}:{}}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error??r.statusText);return d;}
async function stashGuestWork(){
  try{const {data}=await supabase!.auth.getSession();if(!data.session?.user.is_anonymous)return;const b=await call('/backup');
    b.store.teams=b.store.teams.filter((t:any)=>!t.name.startsWith('Sample · '));if(!b.store.teams.length)return localStorage.removeItem(CARRY);
    for(const p of Object.keys(b.files))if(p.startsWith('replays/samples/'))delete b.files[p];b.games=b.games.filter((g:any)=>!String(g.source).startsWith('replays/samples/'));
    localStorage.setItem(CARRY,JSON.stringify({from:data.session.user.id,backup:b}));}catch{}
}
async function bringGuestWork(session:Session){
  let carry:any;try{carry=JSON.parse(localStorage.getItem(CARRY)??'null');}catch{}
  if(!carry||session.user.is_anonymous)return null;localStorage.removeItem(CARRY);if(carry.from===session.user.id)return null;
  try{const r=await call('/restore',{method:'POST',body:JSON.stringify(carry.backup)});return r.teams?`Brought ${r.teams} team${r.teams===1?'':'s'} from your guest session into this account.`:null;}catch(e){return `Couldn't bring your guest teams over: ${(e as Error).message}`;}
}

function useSession(){
  const [session,setSession]=useState<Session|null|undefined>(supabase?undefined:null);
  useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe();},[]);
  return session;
}
export function AuthGate({children}:{children:(account:Account)=>ReactNode}){
  const session=useSession(),[error,setError]=useState(''),[note,setNote]=useState(''),[dialog,setDialog]=useState<{reason?:string}|null>(null),starting=useRef(false);
  openDialog=reason=>setDialog({reason});
  useEffect(()=>{if(!supabase||session!==null||starting.current)return;
    starting.current=true;supabase.auth.signInAnonymously().then(({error})=>{starting.current=false;if(error)setError(error.message);});},[session]);
  useEffect(()=>{if(!supabase||!session)return;
    // Google said this identity already belongs to an account: sign in to that account instead (guest work is carried).
    const params=new URLSearchParams(location.hash.slice(1)+'&'+location.search.slice(1));
    if(params.get('error_code')==='identity_already_exists'){history.replaceState(null,'',redirectTo());void supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo()}});return;}
    void bringGuestWork(session).then(m=>{if(m){setNote(m);setTimeout(()=>location.reload(),1500);}});},[session]);
  if(!supabase)return <AccountContext.Provider value={{kind:'local'}}>{children({kind:'local'})}</AccountContext.Provider>;
  if(error)return <main className="welcome"><div className="welcome-card"><h1>Frontier Brain</h1><p className="error">Couldn't start a session: {error}</p><button className="primary" onClick={()=>location.reload()}>Try again</button></div></main>;
  if(!session)return <main className="welcome"><p className="muted">Opening Frontier Brain…</p></main>;
  const account:Account=session.user.is_anonymous?{kind:'guest'}:{kind:'account',email:session.user.email??''};
  return <AccountContext.Provider value={account}>{children(account)}
    {note&&<div className="toast" role="status">{note}</div>}
    {dialog&&<SignInDialog reason={dialog.reason} onClose={()=>setDialog(null)}/>}
  </AccountContext.Provider>;
}

function SignInDialog({reason,onClose}:{reason?:string;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null),[mode,setMode]=useState<'start'|'create'|'signin'>('start');
  useEffect(()=>{const d=ref.current!;d.showModal();return()=>d.close();},[]);
  const google=async()=>{await stashGuestWork();await supabase!.auth.linkIdentity({provider:'google',options:{redirectTo:redirectTo()}});};
  return <dialog ref={ref} className="modal signin-dialog" aria-labelledby="signin-title" onCancel={onClose}>
    <header><h2 id="signin-title">Sign in to Frontier Brain</h2><button aria-label="Close" onClick={onClose}>×</button></header>
    <div className="signin-body">
      {reason&&<p className="notice">{reason}</p>}
      <p>An account keeps your teams on any device and unlocks AI: Ask Frontier Brain, AI team builds, replay summaries, and connecting Claude or ChatGPT. Everything you've done as a guest comes with you.</p>
      {mode==='start'?<div className="welcome-actions">
        <button className="primary" onClick={()=>void google()}>Continue with Google</button>
        <button onClick={()=>setMode('create')}>Create an account with email</button>
        <button className="text-button" onClick={()=>setMode('signin')}>I already have an account</button>
      </div>:<EmailForm mode={mode} onBack={()=>setMode('start')} onDone={onClose}/>}
    </div>
  </dialog>;
}
function EmailForm({mode,onBack,onDone}:{mode:'create'|'signin';onBack:()=>void;onDone:()=>void}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[error,setError]=useState('');
  const submit=async()=>{setBusy(true);setError('');setNote('');
    // Creating an account upgrades the guest in place (same user id, nothing moves). Signing in switches users.
    if(mode==='signin')await stashGuestWork();
    const r=mode==='create'?await supabase!.auth.updateUser({email,password},{emailRedirectTo:redirectTo()}):await supabase!.auth.signInWithPassword({email,password});
    setBusy(false);if(r.error)return setError(r.error.message);
    if(mode==='create'&&(r.data as any)?.user?.new_email)return setNote('Check your inbox to confirm your email. Your work is already saved.');onDone();};
  return <form className="welcome-form" onSubmit={e=>{e.preventDefault();void submit();}}>
    <label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Password<input type="password" autoComplete={mode==='create'?'new-password':'current-password'} required minLength={8} value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error&&<p className="error">{error}</p>}{note&&<p className="notice">{note}</p>}
    <div className="button-row"><button className="primary" disabled={busy}>{mode==='create'?'Create account':'Sign in'}</button><button type="button" onClick={onBack}>Back</button></div>
  </form>;
}

// Shown in place of an AI control for guests.
export function SignInForAI({what='AI features'}:{what?:string}){
  return <div className="signin-for-ai"><p>{what} need an account. Your guest work comes with you.</p><button className="primary" onClick={()=>requireAccount(`Sign in to use ${what}.`)}>Sign in</button></div>;
}
