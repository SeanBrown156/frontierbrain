import {useEffect,useRef,useState} from 'react';
import {api,Panel} from './ui.tsx';
import {Px,Download,Upload,Sparkles,Check} from './icons.tsx';
import {supabase,useAccount,requireAccount,hostedSite} from './auth.tsx';
import {aiKey,setAIKey,type AIKey} from './ai/keys.tsx';
import {useSpriteStyle,setSpriteStyle,type SpriteStyle} from './fx.ts';

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
    <Looks/>
    <AboutYou/>
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

// What Frontier Brain remembers about you. Claude, ChatGPT and the in-app assistant all read it (and save what you
// tell them), so no app asks twice. Edits save themselves.
const listText=(v:string[])=>v.join(', ');const toList=(t:string)=>t.split(',').map(x=>x.trim()).filter(Boolean);
function AboutYou(){
  const [p,setP]=useState<any>(null),[state,setState]=useState<''|'saved'|'error'>('');const touched=useRef(false);
  // Only your edits are saved, and a slow first load never overwrites what you've started typing.
  useEffect(()=>{api('/preferences').then(r=>touched.current?undefined:setP({...r,likes:listText(r.likes),dislikes:listText(r.dislikes),hateFacing:listText(r.hateFacing),notes:r.notes.join('\n')})).catch(()=>setP(null));},[]);
  useEffect(()=>{if(!p||!touched.current)return;const t=setTimeout(()=>{
    api('/preferences',{playstyle:p.playstyle,formats:p.formats,explain:p.explain,goals:p.goals,likes:toList(p.likes),dislikes:toList(p.dislikes),hateFacing:toList(p.hateFacing),notes:p.notes.split('\n').map((x:string)=>x.trim()).filter(Boolean)})
      .then(()=>setState('saved'),()=>setState('error'));},700);return()=>clearTimeout(t);},[p&&JSON.stringify(p)]);
  if(!p)return null;const set=(k:string)=>(e:any)=>{touched.current=true;setState('');setP({...p,[k]:e.target.value});};
  const choice=(k:string,options:[string,string][])=><div className="segmented" role="group">{options.map(([v,l])=><button key={v} type="button" className={p[k]===v?'on':''} aria-pressed={p[k]===v} onClick={()=>{touched.current=true;setState('');setP({...p,[k]:p[k]===v?'':v});}}>{l}</button>)}</div>;
  return <Panel title="About you" action={state==='saved'?<span className="muted"><Px icon={Check} size={12}/> Saved</span>:state==='error'?<span className="error">Couldn't save</span>:undefined}>
    <p className="muted">What Frontier Brain remembers about how you play. Claude, ChatGPT and Ask Frontier Brain all read this and add what you tell them, so you only say it once. Preferences, not rules.</p>
    <div className="settings-form about-you">
      <label>Playstyle<input value={p.playstyle} onChange={set('playstyle')} placeholder="e.g. bulky balance, hyper offense, Trick Room"/></label>
      <div className="field"><span>I play</span>{choice('formats',[['Bo1','Bo1 ladder'],['Bo3','Bo3 tournaments'],['both','Both']])}</div>
      <div className="field"><span>Explanations</span>{choice('explain',[['brief','Brief'],['standard','Standard'],['detailed','Detailed']])}</div>
      <label>Goals<input value={p.goals} onChange={set('goals')} placeholder="e.g. reach 1800 on ladder, top cut a regional"/></label>
      <label>Pokémon I like using<input value={p.likes} onChange={set('likes')} placeholder="Comma separated"/></label>
      <label>Pokémon I'd rather not use<input value={p.dislikes} onChange={set('dislikes')} placeholder="Comma separated"/></label>
      <label>I hate facing<input value={p.hateFacing} onChange={set('hateFacing')} placeholder="Pokémon or strategies, comma separated"/></label>
      <label>Notes<textarea rows={3} value={p.notes} onChange={set('notes')} placeholder="One per line"/></label>
    </div></Panel>;
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
// MCP connector: Claude, ChatGPT or a coding agent uses Frontier Brain's tools (teams, calcs, pool data) on the
// player's own subscription. Hosted, it signs in with your Frontier Brain account (OAuth); locally there's no sign-in.
const CLIENTS=['Claude','ChatGPT','Claude Code','Codex CLI','Cursor & VS Code'] as const;
function Copy({text}:{text:string}){const [done,setDone]=useState(false);return <div className="copy-line"><code>{text}</code><button className="compact" onClick={()=>{void navigator.clipboard.writeText(text).then(()=>{setDone(true);setTimeout(()=>setDone(false),1500);});}}>{done?'Copied':'Copy'}</button></div>;}
function Connectors(){
  const account=useAccount();const url=`${location.origin}/api/mcp`;const [client,setClient]=useState<typeof CLIENTS[number]>('Claude');
  const local=!hostedSite;const web=client==='Claude'||client==='ChatGPT';
  return <div className="connectors">
    <div className="ai-explainer">
      <p><b>Use Frontier Brain from Claude, ChatGPT or your coding agent.</b> Add it as a connector and your assistant can read your teams, run exact calcs, look up the data pool, create teams and propose plans. It runs on your own subscription, with no API key needed.</p>
      <ul className="privacy-points">
        <li><b>You approve access.</b> {local?'Locally, only apps on this computer can connect.':'Connecting opens Frontier Brain so you can sign in and click Allow. Disconnect any time from the app you connected.'}</li>
        <li><b>Only your workspace.</b> The connector sees your teams and replays, nobody else's.</li>
        <li><b>Changes wait for you.</b> New plans arrive as proposals in the team's Strategy tab; nothing about an existing team changes until you accept it.</li>
      </ul>
    </div>
    {account.kind==='guest'?<div className="settings-row"><p>Connectors need a free account.</p><button className="primary" onClick={()=>requireAccount('Sign in for free to connect Claude or ChatGPT.')}>Sign in</button></div>:<>
      <label className="connector-url">Connector address<Copy text={url}/></label>
      <div className="segmented client-tabs" role="tablist">{CLIENTS.map(c=><button key={c} role="tab" aria-selected={client===c} className={client===c?'on':''} onClick={()=>setClient(c)}>{c}</button>)}</div>
      {local&&web?<p className="notice">{client} connects to sites on the internet, not to this computer. Use the hosted site (frontierbrain.vercel.app) to connect {client}, or use Claude Code, Codex or Cursor here.</p>
      :client==='Claude'?<ol className="steps"><li>In Claude (web or desktop), open <b>Customize → Connectors</b>, click <b>+</b> and choose <b>Add custom connector</b>.</li><li>Name it <b>Frontier Brain</b> and paste the connector address above. Leave the advanced OAuth fields empty.</li><li>Click <b>Add</b>, then <b>Connect</b>. Frontier Brain opens: sign in if asked and click <b>Allow</b>.</li><li>In a chat, click <b>+ → Connectors</b> and switch on Frontier Brain. Try: “List my Frontier Brain teams.”</li></ol>
      :client==='ChatGPT'?<ol className="steps"><li>In ChatGPT, open <b>Settings → Apps & Connectors → Advanced settings</b> and turn on <b>Developer mode</b> (Plus, Pro, Business, Enterprise or Edu).</li><li>Back in <b>Apps & Connectors</b>, click <b>Create</b>. Name it <b>Frontier Brain</b>, paste the connector address and choose <b>OAuth</b>.</li><li>Save. Frontier Brain opens: sign in if asked and click <b>Allow</b>.</li><li>Start a chat with the connector enabled and ask: “List my Frontier Brain teams.”</li></ol>
      :client==='Claude Code'?<ol className="steps"><li>Add the connector:<Copy text={`claude mcp add --transport http frontier-brain ${url}`}/></li>{!local&&<li>In Claude Code, run <code>/mcp</code>, pick <b>frontier-brain</b> and authenticate. Frontier Brain opens in your browser: click <b>Allow</b>.</li>}<li>Ask: “Use frontier-brain to list my teams.”</li></ol>
      :client==='Codex CLI'?<ol className="steps"><li>Add the connector:<Copy text={`codex mcp add frontier-brain --url ${url}`}/></li>{!local&&<li>Sign in:<Copy text="codex mcp login frontier-brain"/>Frontier Brain opens in your browser: click <b>Allow</b>.</li>}<li>Ask Codex to use frontier-brain to list your teams.</li></ol>
      :<ol className="steps"><li>Cursor: add to <code>~/.cursor/mcp.json</code><Copy text={JSON.stringify({mcpServers:{'frontier-brain':{url}}})}/></li><li>VS Code: add to <code>.vscode/mcp.json</code><Copy text={JSON.stringify({servers:{'frontier-brain':{type:'http',url}}})}/></li>{!local&&<li>When the editor asks you to sign in, Frontier Brain opens: click <b>Allow</b>.</li>}</ol>}
      <p className="footnote">Tools: list_teams, get_team, list_replays, replay_transcript, calc_damage, calc_speed, spread_search, standard_set, usage_data, team_pool_sets, meta_overview, dex_lookup, import_team, propose_plans.</p>
    </>}
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
      <p className="footnote">Get a key at {provider==='openai'?<a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com ↗</a>:<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com ↗</a>}. Spending limits and usage live with your provider, not here: {provider==='openai'?<><a href="https://platform.openai.com/settings/organization/limits" target="_blank" rel="noreferrer">set a monthly budget ↗</a> · <a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer">see usage ↗</a></>:<><a href="https://console.anthropic.com/settings/limits" target="_blank" rel="noreferrer">set a spend limit ↗</a> · <a href="https://console.anthropic.com/usage" target="_blank" rel="noreferrer">see usage ↗</a></>}.{!hostedSite&&' Locally, a key in .env is used when none is saved here.'}</p>
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

// How Pokémon are drawn everywhere: HOME 3D renders, or Showdown's animated sprites. Kept in this browser.
function Looks(){
  const style=useSpriteStyle();const options:[SpriteStyle,string,string][]=[['home','HOME renders','3D renders from Pokémon HOME'],['gen5','Black/White sprites','Animated pixel sprites (Gen 5)'],['xy','XY sprites','Animated 3D sprites (Gen 6 onward)']];
  return <Panel title="Pokémon art"><div className="sprite-choice" role="radiogroup" aria-label="Pokémon art">{options.map(([k,label,note])=><button key={k} type="button" role="radio" aria-checked={style===k} className={'toggle'+(style===k?' on':'')} onClick={()=>setSpriteStyle(k)}><b>{label}</b><small>{note}</small></button>)}</div></Panel>;
}
