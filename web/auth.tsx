import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createClient,type Session} from '@supabase/supabase-js';
import {Sparkles} from './icons.tsx';
import {X} from 'lucide-react';
import BrainBackdrop from './brain/BrainBackdrop.tsx';

// Hosted site only: Supabase Auth. Without VITE_SUPABASE_URL the app runs in local mode with no sign-in at all.
// Nobody is asked to sign in up front: a first visit starts an anonymous guest session, so work saves straight away.
// AI features and connecting Claude/ChatGPT need an account; those places call requireAccount(), which goes straight
// to Google (accounts are Google only). No intermediate dialog.
const url=import.meta.env.VITE_SUPABASE_URL as string|undefined,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string|undefined;
export const supabase=url&&key?createClient(url,key):null;
export const hostedSite=!!supabase;
export async function accessToken(){if(!supabase)return null;const {data}=await supabase.auth.getSession();return data.session?.access_token??null;}
export type Account={kind:'local'}|{kind:'guest'}|{kind:'account';email:string};
const AccountContext=createContext<Account>({kind:'local'});
export const useAccount=()=>useContext(AccountContext);
// AI needs an account on the hosted site; locally everything is allowed.
export const canUseAI=(a:Account)=>a.kind!=='guest';

// The sign-in dialog only reports the outcome: "You're all set" when someone comes back signed in, or a sign-in that
// didn't finish. Starting a sign-in goes straight to Google.
let showDialog:(state:{step:Step;email?:string;error?:string})=>void=()=>{};
export function requireAccount(_reason?:string){void signInWithGoogle();}
export async function signInWithGoogle(){if(!supabase)return;await stashGuestWork();markPending('google');
  const {error}=await supabase.auth.linkIdentity({provider:'google',options:{redirectTo:redirectTo()}});if(error){takePending();showDialog({step:'error',error:error.message});}}
// The Google "G" (four-colour mark) on the sign-in buttons.
const G=()=><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" className="google-g"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>;
export function GoogleButton({label='Sign in with Google',className='primary'}:{label?:string;className?:string}){
  const [busy,setBusy]=useState(false);
  return <button className={className+' google-button'} disabled={busy} onClick={()=>{setBusy(true);void signInWithGoogle().finally(()=>setBusy(false));}}><span className="google-g-wrap"><G/></span>{busy?'Opening Google…':label}</button>;
}

// Back to the same page after Google; the connector consent page also needs its ?authorization_id.
// A sign-in that leaves the page (Google) is marked here, so the same dialog can reopen with
// "You're all set" when the person comes back signed in. Per browser tab session; cleared once shown.
const PENDING='frontierbrain.signin-pending';
const markPending=(how:'google',email?:string)=>{try{sessionStorage.setItem(PENDING,JSON.stringify({how,email}));}catch{}};
const takePending=():{how:'google';email?:string}|null=>{try{const v=sessionStorage.getItem(PENDING);sessionStorage.removeItem(PENDING);return v?JSON.parse(v):null;}catch{return null;}};
const redirectTo=()=>location.origin+location.pathname+(location.pathname.startsWith('/oauth/')?location.search:'');
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
// Before a session exists: the wireframe brain and the loader title, never a plain text line.
function Splash(){
  useEffect(()=>{const t=setInterval(()=>dispatchEvent(new CustomEvent('fb-boot-progress',{detail:Math.min(.5,.1+Math.random()*.4)})),400);return()=>clearInterval(t);},[]);
  return <div className="shell booting"><BrainBackdrop route="teams" booting/>
    <div className="boot" role="status" aria-label="Starting Frontier Brain"><div className="boot-inner"><p className="boot-exe">loading frontier-brain<span className="ext">.exe</span><span className="caret" aria-hidden="true"/></p></div></div></div>;
}
export function AuthGate({children}:{children:(account:Account)=>ReactNode}){
  const session=useSession(),[error,setError]=useState(''),[note,setNote]=useState(''),[dialog,setDialog]=useState<{step:Step;email?:string;error?:string}|null>(null),starting=useRef(false);
  showDialog=setDialog;
  useEffect(()=>{if(!supabase||session!==null||starting.current)return;
    starting.current=true;supabase.auth.signInAnonymously().then(({error})=>{starting.current=false;if(error)setError(error.message);});},[session]);
  useEffect(()=>{if(!supabase||!session)return;
    // Google said this identity already belongs to an account: sign in to that account instead (guest work is carried).
    const params=new URLSearchParams(location.hash.slice(1)+'&'+location.search.slice(1));
    if(params.get('error_code')==='identity_already_exists'){history.replaceState(null,'',redirectTo());void supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectTo()}});return;}
    // Back from a Google sign-in that didn't finish (cancelled, refused): say so in the sign-in dialog.
    const failed=params.get('error_description');if(failed){history.replaceState(null,'',redirectTo());takePending();setDialog({step:'error',error:failed.replace(/\+/g,' ').replace(/([^.!?])$/,'$1.')});return;}
    // Back signed in after Google, started from this tab: finish in the same dialog.
    if(!session.user.is_anonymous){const pending=takePending();if(pending)setDialog({step:'done',email:session.user.email??pending.email});}
    void bringGuestWork(session).then(m=>{if(m){setNote(m);setTimeout(()=>location.reload(),1500);}});},[session]);
  if(!supabase)return <AccountContext.Provider value={{kind:'local'}}>{children({kind:'local'})}</AccountContext.Provider>;
  if(error)return <main className="welcome"><div className="welcome-card"><h1>Frontier Brain</h1><p className="error">Couldn't start a session: {error}</p><button className="primary" onClick={()=>location.reload()}>Try again</button></div></main>;
  if(!session)return <Splash/>;
  const account:Account=session.user.is_anonymous?{kind:'guest'}:{kind:'account',email:session.user.email??''};
  return <AccountContext.Provider value={account}>{children(account)}
    {note&&<div className="toast" role="status">{note}</div>}
    {dialog&&<SignInDialog step={dialog.step} email={dialog.email} error={dialog.error} onClose={()=>setDialog(null)}/>}
  </AccountContext.Provider>;
}

// The outcome of a Google sign-in: "You're all set" when someone comes back signed in from this tab, or "Sign-in didn't
// finish" (cancelled, or Google refused) with a button to try again.
type Step='done'|'error';
function SignInDialog({step,email,error:failure,onClose}:{step:Step;email?:string;error?:string;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current!;d.showModal();return()=>d.close();},[]);
  return <dialog ref={ref} className="modal signin-dialog" aria-labelledby="signin-title" onCancel={onClose}>
    <header><h2 id="signin-title">{step==='done'?"You're all set":"Sign-in didn't finish"}</h2><button className="icon dialog-close" aria-label="Close" onClick={onClose}><X width={18} height={18} strokeWidth={2} aria-hidden="true"/></button></header>
    <div className="signin-body">
      {step==='done'?<>
        <p>{email?<>Signed in as <b>{email}</b>. </>:null}Your teams are saved to your account and follow you to any device. AI features are unlocked.</p>
        <div className="button-row"><button className="primary" onClick={onClose}>Done</button></div>
      </>:<>
        <p>{failure??'Google didn\'t complete the sign-in.'} Your guest work is still here.</p>
        <div className="button-row"><GoogleButton label="Try again with Google"/><button onClick={onClose}>Close</button></div>
      </>}
    </div>
  </dialog>;
}

// Shown in place of an AI control for guests. `verb` completes "Sign in for free to … with your preferred AI tool."
export function SignInForAI({verb='do this'}:{verb?:string}){
  const text=`Sign in for free to ${verb} with your preferred AI tool.`;
  return <div className="signin-for-ai"><p><Sparkles width={16} height={16} aria-hidden="true" className="px-icon"/> {text}</p><GoogleButton/></div>;
}
