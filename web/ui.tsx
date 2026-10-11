import {useEffect,useRef,useState,useId,type ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {accessToken} from './auth.tsx';
import {aiHeaders} from './ai/keys.tsx';
import {hostedSite} from './auth.tsx';
// Every request carries the session token on the hosted site (accounts and guests); locally there is none.
async function headers(json:boolean){const h:Record<string,string>={...json?{'Content-Type':'application/json'}:{},...aiHeaders()};const token=await accessToken();if(token)h.Authorization=`Bearer ${token}`;return h;}
// Errors keep their HTTP status so callers can tell a real clash (409) from a dropped connection.
export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// Reads retry quietly on a dropped connection or a server hiccup (5xx); writes are retried by the caller's queue.
export async function api(path:string,input?:unknown,{retries=input===undefined?2:0}:{retries?:number}={}):Promise<any>{
  for(let attempt=0;;attempt++){
    let response:Response;
    try{response=await fetch('/api'+path,input===undefined?{headers:await headers(false)}:{method:'POST',headers:await headers(true),body:JSON.stringify(input)});}
    catch{if(attempt<retries){await wait(400*(attempt+1));continue;}throw new ApiError('Can\'t reach Frontier Brain. Check your connection.',0);}
    const text=await response.text();let data:any={};try{data=text?JSON.parse(text):{};}catch{data={error:response.ok?undefined:`Server error (${response.status})`};}
    if(response.ok)return data;
    if(response.status>=500&&attempt<retries){await wait(400*(attempt+1));continue;}
    throw new ApiError(data.error??`Request failed (${response.status})`,response.status);
  }
}
// Saved replay originals download through the API with the session token (plain links can't send it).
export async function downloadOriginal(id:string){const response=await fetch('/api/original?id='+encodeURIComponent(id),{headers:await headers(false)});if(!response.ok)throw new Error(`Download failed (${response.status})`);const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`${id}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const speciesId=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
export const date=(s:string)=>new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(new Date(s.length===10?s+'T12:00:00Z':s));
export const pct=(wins:number,games:number)=>games?`${(100*wins/games).toFixed(1)}%`:'—';
export function Art({name,art,small=false}:{name:string;art:any;small?:boolean}){const [failed,setFailed]=useState(false);const record=art[speciesId(name)];return <span className={'art '+(small?'small':'')} title={name}>{record?.state==='cached'&&!failed?<img src={hostedSite&&/^https:\/\/raw\.githubusercontent\.com\//.test(record.url??'')?record.url:`/api/art?id=${speciesId(name)}`} alt={name} loading="lazy" onError={()=>setFailed(true)}/>:<span className="art-fallback" aria-label={`${name}; artwork unavailable`}>?<small>{name}</small></span>}</span>;}
// Box icon from the locally cached Showdown sheet (12 columns of 40×30); blank cell when unknown.
export function PokeIcon({n}:{n?:number}){return <span className="poke-icon" aria-hidden="true" style={n?{backgroundPosition:`-${(n%12)*40}px -${Math.floor(n/12)*30}px`}:{backgroundImage:'none'}}/>;}
export function Panel({title,kicker,children,className='',action}:{title:ReactNode;kicker?:string;children:ReactNode;className?:string;action?:ReactNode}){return <section className={'panel '+className}><header className="panel-heading"><div>{kicker&&<span className="eyebrow">{kicker}</span>}<h2>{title}</h2></div>{action}</header>{children}</section>;}
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){const ref=useRef<HTMLDialogElement>(null);const titleId=useId();useEffect(()=>{const dialog=ref.current!;dialog.showModal();dialog.focus();return()=>dialog.close();},[]);return <dialog ref={ref} tabIndex={-1} aria-labelledby={titleId} onCancel={onClose} className="modal"><header><h2 id={titleId}>{title}</h2><button aria-label="Close dialog" onClick={onClose}>×</button></header>{children}</dialog>;}
export function Markdown({text}:{text:string}){return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{table:({children})=><div className="table-scroll"><table>{children}</table></div>,a:({href,children})=>{if(href?.startsWith('http://')||href?.startsWith('https://'))return <a href={href} target="_blank" rel="noreferrer">{children} ↗</a>;return <span>{children}</span>;}}}>{text}</ReactMarkdown></div>;}
export function Empty({children}:{children:ReactNode}){return <div className="empty">{children}</div>;}
export function Tabs({tabs,value,onChange,icons={}}:{tabs:string[];value:string;onChange:(s:string)=>void;icons?:Record<string,ReactNode>}){return <div className="tabs" role="tablist">{tabs.map(t=><button key={t} role="tab" aria-selected={t===value} className={value===t?'selected':''} onClick={()=>onChange(t)}>{icons[t]}{t}</button>)}</div>;}
export function Notice({children}:{children:ReactNode}){return <p className="notice">{children}</p>;}
export function JobStatus({jobs,kinds}:{jobs:any;kinds:string[]}){return <div className="context-jobs" aria-live="polite">{jobs?.current.filter((j:any)=>kinds.includes(j.kind)).slice(0,2).map((j:any)=><div className="job" key={j.id}><span className={'status '+j.status}>{j.status}</span><span>{j.phase}</span>{j.error&&<p role="alert">{j.error}</p>}</div>)}</div>;}
