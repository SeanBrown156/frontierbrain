import {useEffect,useRef,useState} from 'react';
import {api,Panel} from './ui.tsx';
import {Px,Download,Upload,Sparkles,Check} from './icons.tsx';
import {supabase,useAccount,requireAccount,hostedSite} from './auth.tsx';
import {aiKey,setAIKey,type AIKey} from './ai/keys.tsx';

// Settings (#account): who you are, your Showdown name, your AI key, backups. The avatar in the header opens it.
export default function Settings({profile,reload,notify}:{profile?:any;reload:()=>Promise<void>;notify:(text:string,error?:boolean)=>void}){
  const account=useAccount();
  return <div className="settings">
    <h1>Settings</h1>
    <Panel title="Account">
      {account.kind==='account'?<div className="settings-row"><p>Signed in as <b>{account.email}</b></p><button onClick={()=>void supabase!.auth.signOut()}>Sign out</button></div>
        :account.kind==='guest'?<div className="settings-row"><p>You're using Frontier Brain as a guest. Sign in for free to keep your teams on any device and use AI with your own key.</p><button className="primary" onClick={()=>requireAccount()}>Sign in</button></div>
        :<p className="muted">Local workspace on this computer. No account needed.</p>}
    </Panel>
    <ShowdownName profile={profile} reload={reload} notify={notify}/>
    <AIPanel/>
    <Backup reload={reload} notify={notify}/>
  </div>;
}

function ShowdownName({profile,reload,notify}:{profile?:any;reload:()=>Promise<void>;notify:(t:string,e?:boolean)=>void}){
  const [name,setName]=useState(''),[aliases,setAliases]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{setName(profile?.player??'');setAliases((profile?.aliases??[]).join(', '));},[profile?.player,(profile?.aliases??[]).join(',')]);
  const dirty=name.trim()!==(profile?.player??'')||aliases!==(profile?.aliases??[]).join(', ');
  const save=async()=>{setBusy(true);try{await api('/profile',{player:name.trim(),aliases:aliases.split(',').map(a=>a.trim()).filter(Boolean)});await reload();notify('Showdown name saved.');}catch(e){notify((e as Error).message,true);}finally{setBusy(false);}};
  return <Panel title="Showdown name"><p className="muted">Replays are read from your side, so Frontier Brain needs to know which player is you.</p>
    <form className="settings-form" onSubmit={e=>{e.preventDefault();void save();}}>
      <label>Showdown name<input value={name} onChange={e=>setName(e.target.value)} placeholder="YourName"/></label>
      <label>Other names (optional)<input value={aliases} onChange={e=>setAliases(e.target.value)} placeholder="alt1, alt2"/></label>
      <button className="primary" disabled={busy||!dirty||!name.trim()}>{busy?'Saving…':!dirty&&profile?.player?<><Px icon={Check}/>Saved</>:'Save'}</button>
    </form></Panel>;
}

// The key lives only in this browser. Each AI request carries it to our server, which passes it to OpenAI or
// Anthropic for that one request and drops it: never written to the database or logs. The code is public to check.
// Two ways to use AI: your own API key inside Frontier Brain, or your Claude/ChatGPT subscription connected over MCP.
function AIPanel(){
  const [mode,setMode]=useState<'key'|'mcp'>('key');
  return <Panel title={<><Px icon={Sparkles}/> AI</>}>
    <div className="segmented ai-mode" role="tablist"><button role="tab" aria-selected={mode==='key'} className={mode==='key'?'on':''} onClick={()=>setMode('key')}>Your API key</button><button role="tab" aria-selected={mode==='mcp'} className={mode==='mcp'?'on':''} onClick={()=>setMode('mcp')}>Connect Claude or ChatGPT</button></div>
    {mode==='key'?<AIKey/>:<Connectors/>}
  </Panel>;
}
// MCP connector: Claude or ChatGPT uses Frontier Brain's tools (your teams, calcs, pool data) with your own subscription.
function Connectors(){
  const account=useAccount();
  return <div className="ai-explainer">
    <p><b>Use Frontier Brain from Claude or ChatGPT.</b> Add Frontier Brain as a connector and your own assistant can read your teams, run exact calcs, look up the data pool and save changes you approve. It runs on your Claude or ChatGPT subscription, with no API key needed.</p>
    <ul className="privacy-points">
      <li><b>You approve access.</b> Connecting asks you to sign in to Frontier Brain and allow it. You can disconnect at any time.</li>
      <li><b>Only your workspace.</b> The connector sees your teams and replays, nobody else's.</li>
      <li><b>Changes stay proposals.</b> Anything it suggests waits for you to accept, like it does here.</li>
    </ul>
    <p className="notice">Coming next: connectors aren't switched on yet.{account.kind==='guest'?' They will need a free account.':' This is where you\'ll find the address to add in Claude or ChatGPT.'}</p>
  </div>;
}
function AIKey(){
  const account=useAccount();const [saved,setSaved]=useState<AIKey|null>(()=>aiKey());const [provider,setProvider]=useState<AIKey['provider']>(saved?.provider??'openai'),[key,setKey]=useState(''),[status,setStatus]=useState('');
  const locked=account.kind==='guest';
  const save=async()=>{const next={provider,key:key.trim()};setAIKey(next);setSaved(next);setKey('');setStatus('Checking the key…');
    try{const models=await api('/models');setStatus(models.length?`Key works: ${models.length} models available.`:'Saved, but the provider didn’t accept it. Check the key and try again.');}catch(e){setStatus((e as Error).message);}};
  const remove=()=>{setAIKey(null);setSaved(null);setStatus('Key removed from this browser.');};
  return <>
    <div className="ai-explainer">
      <p><Px icon={Sparkles}/> <b>AI runs on your own OpenAI or Anthropic (Claude) key, so you pay the provider directly for what you use.</b> Frontier Brain never charges you and never pays for anyone else's usage.</p>
      <ul className="privacy-points">
        <li><b>Stays in this browser.</b> Your key is kept on this device only. It isn't saved to your account or our database, so you'll add it again on another device.</li>
        <li><b>Used only for your requests.</b> When you ask Frontier Brain something, the key travels with that request to our server, which passes it to {provider==='anthropic'?'Anthropic':'OpenAI'} and then discards it. It's never logged or stored.</li>
        <li><b>Your questions and answers</b> are saved in your workspace so you can come back to them. The key isn't.</li>
        <li><b>You're in control.</b> Remove it here any time, set a spending limit with your provider, or revoke it there.</li>
        <li><b>Check for yourself.</b> Frontier Brain is open source: <a href="https://github.com/SeanBrown156/frontierbrain" target="_blank" rel="noreferrer">see how keys are handled ↗</a></li>
      </ul>
    </div>
    {locked?<div className="settings-row"><p>Sign in for free to use AI with your preferred AI tool.</p><button className="primary" onClick={()=>requireAccount('Sign in for free to use AI with your preferred AI tool.')}>Sign in</button></div>:<>
      {saved&&<p className="key-saved"><Px icon={Check}/>{saved.provider==='anthropic'?'Anthropic (Claude)':'OpenAI'} key saved in this browser, ending …{saved.key.slice(-4)}</p>}
      <form className="settings-form" onSubmit={e=>{e.preventDefault();if(key.trim())void save();}}>
        <label>Provider<select value={provider} onChange={e=>setProvider(e.target.value as AIKey['provider'])}><option value="openai">OpenAI</option><option value="anthropic">Anthropic (Claude)</option></select></label>
        <label>{saved?'Replace key':'API key'}<input type="password" autoComplete="off" spellCheck={false} placeholder={provider==='openai'?'sk-…':'sk-ant-…'} value={key} onChange={e=>setKey(e.target.value)}/></label>
        <button className="primary" disabled={!key.trim()}>Save key</button>
      </form>
      <p className="footnote">Get a key at {provider==='openai'?<a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com ↗</a>:<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com ↗</a>}.{!hostedSite&&' Locally, a key in .env is used when none is saved here.'}</p>
      {status&&<p className="notice">{status}</p>}
      {saved&&<button className="danger" onClick={remove}>Remove key from this browser</button>}
    </>}
  </>;
}

function Backup({reload,notify}:{reload:()=>Promise<void>;notify:(t:string,e?:boolean)=>void}){
  const file=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false);
  const download=async()=>{setBusy(true);try{const b=await api('/backup');const url=URL.createObjectURL(new Blob([JSON.stringify(b)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`frontierbrain-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);}catch(e){notify((e as Error).message,true);}setBusy(false);};
  const restore=async(f:File)=>{setBusy(true);try{const r=await api('/restore',JSON.parse(await f.text()));await reload();notify(`Restored ${r.teams} team${r.teams===1?'':'s'} and ${r.games} replay${r.games===1?'':'s'}. Anything already here was kept.`);}catch(e){notify(e instanceof SyntaxError?'That file is not a Frontier Brain backup.':(e as Error).message,true);}setBusy(false);if(file.current)file.current.value='';};
  return <Panel title="Backup"><p className="muted">One file with your teams, sets, strategy, replays and summaries. Restoring adds what's missing and never overwrites anything already here.</p>
    <div className="settings-actions"><button disabled={busy} onClick={()=>void download()}><Px icon={Download}/>Download backup</button><button disabled={busy} onClick={()=>file.current?.click()}><Px icon={Upload}/>Restore from a backup</button></div>
    <input ref={file} type="file" accept="application/json,.json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void restore(f);}}/></Panel>;
}
