import {useEffect,useState,type ReactNode} from 'react';
import {createClient,type Session} from '@supabase/supabase-js';

// Hosted site only: Supabase Auth. Without VITE_SUPABASE_URL the app runs in local mode with no sign-in at all.
// Guests are anonymous Supabase users, so their work saves like anyone's; signing up later keeps it (same user id).
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;
export const supabase=url&&key?createClient(url,key):null;
export const hostedSite=!!supabase;
export async function accessToken(){if(!supabase)return null;const {data}=await supabase.auth.getSession();return data.session?.access_token??null;}

function useSession(){
  const [session,setSession]=useState<Session|null|undefined>(supabase?undefined:null);
  useEffect(()=>{if(!supabase)return;supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));return()=>data.subscription.unsubscribe();},[]);
  return session;
}
const redirectTo=()=>location.origin+location.pathname;

// Gate for the hosted site: shows the welcome screen until there is a session (account or guest).
export function AuthGate({children}:{children:(account:Account)=>ReactNode}){
  const session=useSession();
  if(!supabase)return <>{children({kind:'local'})}</>;
  if(session===undefined)return <div className="welcome"><p className="muted">Opening Frontier Brain…</p></div>;
  if(!session)return <Welcome/>;
  const user=session.user;return <>{children(user.is_anonymous?{kind:'guest'}:{kind:'account',email:user.email??''})}</>;
}
export type Account={kind:'local'}|{kind:'guest'}|{kind:'account';email:string};

function Welcome(){
  const [mode,setMode]=useState<'start'|'email'>('start');
  return <main className="welcome"><div className="welcome-card">
    <img src="/favicon.svg" alt="" width={48} height={48}/>
    <h1>Frontier Brain</h1>
    <p className="welcome-tag">Your competitive second brain for Pokémon Champions VGC: build teams, run exact calcs, review replays and follow the metagame.</p>
    {mode==='start'?<div className="welcome-actions">
      <GuestButton/>
      <button onClick={()=>void supabase!.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo()}})}>Continue with Google</button>
      <button className="text-button" onClick={()=>setMode('email')}>Sign in or sign up with email</button>
    </div>:<EmailForm onBack={()=>setMode('start')}/>}
    <p className="footnote">Guests can do everything except connect Claude or ChatGPT. Guest work stays in this browser until you create an account.</p>
  </div></main>;
}
function GuestButton(){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setError('');const {error}=await supabase!.auth.signInAnonymously();if(error){setError(error.message);setBusy(false);}}}>{busy?'Starting…':'Try it, no account needed'}</button>{error&&<p className="error">{error}</p>}</>;
}
function EmailForm({onBack,upgrade=false}:{onBack:()=>void;upgrade?:boolean}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[error,setError]=useState('');
  const act=async(kind:'in'|'up')=>{setBusy(true);setError('');setNote('');
    const r=upgrade?await supabase!.auth.updateUser({email,password},{emailRedirectTo:redirectTo()})
      :kind==='in'?await supabase!.auth.signInWithPassword({email,password}):await supabase!.auth.signUp({email,password,options:{emailRedirectTo:redirectTo()}});
    setBusy(false);if(r.error)return setError(r.error.message);
    // Only when Supabase is waiting on a confirmation email (sign-up with no session yet, or an email change pending).
    const data:any=r.data;if(kind==='up'&&!upgrade&&!data?.session||upgrade&&data?.user?.new_email)setNote('Check your inbox to confirm your email. Your work is already saved.');};
  return <form className="welcome-form" onSubmit={e=>{e.preventDefault();void act(upgrade?'up':'in');}}>
    <label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Password<input type="password" autoComplete={upgrade?'new-password':'current-password'} required minLength={8} value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error&&<p className="error">{error}</p>}{note&&<p className="notice">{note}</p>}
    <div className="button-row">{upgrade?<button className="primary" disabled={busy}>Create account</button>:<><button className="primary" disabled={busy}>Sign in</button><button type="button" disabled={busy} onClick={()=>void act('up')}>Create account</button></>}<button type="button" className="text-button" onClick={onBack}>Back</button></div>
  </form>;
}
// Header control: guests get "Save your work"; accounts get their email and Sign out.
export function AccountMenu({account}:{account:Account}){
  const [open,setOpen]=useState(false),[mode,setMode]=useState<'start'|'email'>('start');
  if(account.kind==='local'||!supabase)return null;
  const signOut=async()=>{if(account.kind==='guest'&&!confirm('Signing out of a guest session loses its teams. Sign out anyway?'))return;await supabase!.auth.signOut();};
  return <div className="account-menu">
    {account.kind==='guest'?<button className="primary compact" onClick={()=>setOpen(!open)}>Save your work</button>:<button className="compact" onClick={()=>setOpen(!open)}>{account.email||'Account'}</button>}
    {open&&<div className="account-pop" role="dialog" aria-label="Account">
      {account.kind==='guest'?<>{mode==='start'?<><p>You're using Frontier Brain as a guest. Create an account to keep your teams on any device and to connect Claude or ChatGPT.</p>
        <div className="welcome-actions"><button onClick={()=>void supabase!.auth.linkIdentity({provider:'google',options:{redirectTo:redirectTo()}})}>Continue with Google</button><button onClick={()=>setMode('email')}>Use email and password</button></div></>
        :<EmailForm upgrade onBack={()=>setMode('start')}/>}</>
      :<p className="muted">Signed in as {account.email}</p>}
      <button className="text-button" onClick={()=>void signOut()}>Sign out</button>
    </div>}
  </div>;
}
