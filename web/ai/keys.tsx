import {useState} from 'react';
// The user's own AI key lives only in this browser (localStorage) and is sent with each request over HTTPS.
// The server uses it for that request and never stores it. Nobody else's usage is ever billed to it.
export type AIKey={provider:'openai'|'anthropic';key:string};
const STORE='frontierbrain.ai';
export function aiKey():AIKey|null{try{const v=JSON.parse(localStorage.getItem(STORE)??'null');return v&&typeof v.key==='string'&&['openai','anthropic'].includes(v.provider)?v:null;}catch{return null;}}
function setAIKey(v:AIKey|null){try{if(v)localStorage.setItem(STORE,JSON.stringify(v));else localStorage.removeItem(STORE);}catch{}}
export function aiHeaders():Record<string,string>{const k=aiKey();return k?{'X-AI-Provider':k.provider,'X-AI-Key':k.key}:{};}

export function AIKeySettings({onChange}:{onChange?:()=>void}){
  const saved=aiKey();const [provider,setProvider]=useState<AIKey['provider']>(saved?.provider??'openai'),[key,setKey]=useState(''),[open,setOpen]=useState(false);
  const save=()=>{if(!key.trim())return;setAIKey({provider,key:key.trim()});setKey('');setOpen(false);onChange?.();};
  return <div className="ai-key">
    <button className="compact" onClick={()=>setOpen(!open)} title="Use your own OpenAI or Anthropic key">{saved?`${saved.provider==='openai'?'OpenAI':'Claude'} key ✓`:'Add AI key'}</button>
    {open&&<div className="account-pop" role="dialog" aria-label="AI key">
      <p>Ask Frontier Brain runs on <b>your own</b> key. It stays in this browser and is only sent with your requests; it's never stored on the server.</p>
      <label>Provider<select value={provider} onChange={e=>setProvider(e.target.value as AIKey['provider'])}><option value="openai">OpenAI</option><option value="anthropic">Anthropic (Claude)</option></select></label>
      <label>API key<input type="password" autoComplete="off" placeholder={provider==='openai'?'sk-…':'sk-ant-…'} value={key} onChange={e=>setKey(e.target.value)}/></label>
      <p className="footnote">Get one at {provider==='openai'?<a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com</a>:<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>}. You pay the provider directly for what you use.</p>
      <div className="button-row"><button className="primary" disabled={!key.trim()} onClick={save}>Save key</button>{saved&&<button onClick={()=>{setAIKey(null);setOpen(false);onChange?.();}}>Remove key</button>}</div>
    </div>}
  </div>;
}
