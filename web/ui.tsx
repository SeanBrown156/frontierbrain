import {useSpriteStyle,spriteUrls} from './fx.ts';
import {useEffect,useRef,useState,useId,type ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
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
// Long summaries read better a sentence at a time: split on sentence ends (not decimals like 85.5% or initials).
export const sentences=(text:string)=>text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).map(t=>t.trim()).filter(Boolean);
export const speciesId=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
export const date=(s:string)=>new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',year:'numeric'}).format(new Date(s.length===10?s+'T12:00:00Z':s));
export const pct=(wins:number,games:number)=>games?`${(100*wins/games).toFixed(1)}%`:'—';
// Pokémon render: the HOME 3D model by default (soft, lit, consistent across forms), falling back to the official
// illustration and then a placeholder. `kind="art"` asks for the illustration first.
export function Art({name,art,small=false,kind='home',fallback}:{name:string;art:any;small?:boolean;kind?:'home'|'art';fallback?:string}){
  const urls=(n:string)=>{const record=art?.[speciesId(n)];const official=record?.state==='cached'?(hostedSite&&/^https:\/\/raw\.githubusercontent\.com\//.test(record.url??'')?record.url:`/api/art?id=${speciesId(n)}`):null;const home=`/api/home?species=${encodeURIComponent(n)}`;return kind==='home'?[home,official]:[official,home];};
  // A Mega without its own HOME render shows the base form's HOME render before any illustration, so every
  // render on a page keeps the same 3D style.
  const alt=fallback&&fallback!==name?urls(fallback):[];
  // The sprite setting (Settings) puts Showdown's animated sprites first; HOME renders stay the fallback.
  const sprite=useSpriteStyle();const illustrated=sprite==='art';const sprites=kind==='home'&&sprite!=='home'&&!illustrated?[...spriteUrls(name,sprite),...(fallback&&fallback!==name?spriteUrls(fallback,sprite):[])]:[];
  const homeFirst=kind==='home'&&!illustrated;const sources=[...sprites,...(homeFirst&&alt.length?[urls(name)[0],alt[0],urls(name)[1],alt[1]]:illustrated&&kind==='home'?[...urls(name).slice().reverse(),...alt.slice().reverse()]:[...urls(name),...alt])].filter(Boolean) as string[];
  const [step,setStep]=useState(0);useEffect(()=>setStep(0),[name,sprite]);const src=sources[step];const isSprite=step<sprites.length;
  return <span className={'art '+(small?'small':'')+(isSprite?' sprite sprite-'+sprite:'')} title={name}>{src?<img key={src} src={src} alt={name} loading="lazy" onError={()=>setStep(step+1)}/>:<span className="art-fallback" aria-label={`${name}; artwork unavailable`}>?<small>{name}</small></span>}</span>;}
// Species types and item sheet positions, fetched once per name and shared by every card on the page.
export type MegaForm={name:string;item:string;types:string[];ability:string;baseStats:Record<string,number>};
const dexCache={types:{} as Record<string,string[]>,base:{} as Record<string,Record<string,number>>,megas:{} as Record<string,MegaForm[]>,moves:{} as Record<string,string>,items:{} as Record<string,number>};let dexWaiting:Promise<void>|null=null;const dexWant={species:new Set<string>(),items:new Set<string>(),moves:new Set<string>()};
function requestDex(){return dexWaiting??=new Promise<void>(r=>setTimeout(r,30)).then(async()=>{const species=[...dexWant.species].filter(n=>!(n in dexCache.types)),items=[...dexWant.items].filter(n=>!(n in dexCache.items)),moves=[...dexWant.moves].filter(n=>!(n in dexCache.moves));dexWant.species.clear();dexWant.items.clear();dexWant.moves.clear();
  if(species.length||items.length||moves.length){try{const r=await api(`/dex-info?species=${encodeURIComponent(species.join('|'))}&items=${encodeURIComponent(items.join('|'))}&moves=${encodeURIComponent(moves.join('|'))}`);Object.assign(dexCache.moves,r.moves??{});Object.assign(dexCache.types,r.types);Object.assign(dexCache.base,r.base);Object.assign(dexCache.megas,r.megas??{});Object.assign(dexCache.items,r.items);}catch{for(const n of species)dexCache.types[n]=[];for(const n of items)dexCache.items[n]=0;for(const n of moves)dexCache.moves[n]='';}}}).finally(()=>{dexWaiting=null;});}
export function useDex(species:string[],items:string[],moves:string[]=[]){const [,tick]=useState(0);const key=species.join('|')+'#'+items.join('|')+'#'+moves.join('|');
  useEffect(()=>{const missing=species.some(n=>!(n in dexCache.types))||items.some(n=>!(n in dexCache.items))||moves.some(n=>!(n in dexCache.moves));if(!missing)return;let alive=true;species.forEach(n=>dexWant.species.add(n));items.forEach(n=>dexWant.items.add(n));moves.forEach(n=>dexWant.moves.add(n));void requestDex().then(()=>{if(alive)tick(x=>x+1);});return()=>{alive=false;};},[key]);
  return dexCache;}
// The form a set battles as: its Mega when it holds that Mega's stone, otherwise the species itself.
export function useBattleForm(species:string,item?:string){const m=(useDex([species],[]).megas[species]??[]).find(x=>x.item===item);return m?.name??species;}
// A set's render: its Mega when it holds that Mega's stone (what it battles as), else the species.
export function SetArt({set,art,small=false}:{set:{species:string;item?:string};art:any;small?:boolean}){const form=useBattleForm(set.species,set.item);return <span className={'set-art'+(form!==set.species?' is-mega':'')}><Art name={form} fallback={set.species} art={art} small={small}/>{form!==set.species&&small&&<MegaOrb size={14}/>}</span>;}
// Mega marker: an original rainbow keystone orb (not the official Mega Evolution mark), alone or with the word.
export function MegaOrb({size=16}:{size?:number}){return <span className="mega-orb" style={{width:size,height:size}} aria-hidden="true"/>;}
export function MegaBadge({title}:{title?:string}){return <span className="mega-badge" title={title??'Battles as its Mega'}><MegaOrb size={14}/>Mega</span>;}
export const TYPE_COLOURS:Record<string,string>={Normal:'#9a9a7c',Fire:'#ef6a3a',Water:'#4b8ff0',Electric:'#f2c531',Grass:'#4fb05a',Ice:'#5cc9d6',Fighting:'#d0443e',Poison:'#a557c4',Ground:'#d29a4a',Flying:'#8aa4ec',Psychic:'#ef5a8c',Bug:'#93b02c',Rock:'#b8a35a',Ghost:'#6f5ca8',Dragon:'#5f5ae0',Dark:'#5d5068',Steel:'#7fa2b4',Fairy:'#e58fc8',Stellar:'#40b5a5'};
export function TypeBadges({species}:{species:string}){const d=useDex([species],[]);const types=d.types[species]??[];
  return types.length?<span className="type-badges">{types.map(t=><span key={t} className="type-badge" style={{'--type':TYPE_COLOURS[t]??'#888'} as any}>{t}</span>)}</span>:null;}
// Held item icon from Showdown's item sheet (16 columns of 24×24).
export function ItemIcon({item}:{item?:string}){const d=useDex([],item?[item]:[]);const n=item?d.items[item]:undefined;
  return <span className="item-icon" aria-hidden="true" style={n?{backgroundPosition:`-${(n%16)*24}px -${Math.floor(n/16)*24}px`}:{backgroundImage:'none'}}/>;}
// A site's icon for reference links: the curated one in /public/icons if there is one, else its favicon through the
// local cache; while loading or if none exists, a tidy monogram tile in the same footprint.
export function SiteIcon({url,icon,size=20}:{url:string;icon?:string;size?:number}){
  let host='';try{host=new URL(url).hostname.replace(/^www\./,'');}catch{}
  const [failed,setFailed]=useState(false),[loaded,setLoaded]=useState(false);const src=icon??(host?`/api/favicon?host=${encodeURIComponent(host)}`:'');
  return <span className={'site-icon'+(loaded&&!failed?' loaded':'')+(failed||!src?' failed':'')} style={{width:size,height:size}} aria-hidden="true"><span className="mono-tile">{(host[0]??'?').toUpperCase()}</span>{src&&!failed&&<img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)}/>}</span>;
}
// Box icon from the locally cached Showdown sheet (12 columns of 40×30); blank cell when unknown.
export function PokeIcon({n}:{n?:number}){return <span className="poke-icon" aria-hidden="true" style={n?{backgroundPosition:`-${(n%12)*40}px -${Math.floor(n/12)*30}px`}:{backgroundImage:'none'}}/>;}
export function Panel({title,kicker,children,className='',action}:{title:ReactNode;kicker?:string;children:ReactNode;className?:string;action?:ReactNode}){return <section className={'panel '+className}><header className="panel-heading"><div>{kicker&&<span className="eyebrow">{kicker}</span>}<h2>{title}</h2></div>{action}</header>{children}</section>;}
// Dialog: the title and a close (X) button on one row, the body, then `footer` holding only the actions (primary last).
// A form dialog puts <ModalFooter> as the form's last child instead, so its submit button stays inside the form.
export function Modal({title,children,onClose,footer}:{title:string;children:ReactNode;onClose:()=>void;footer?:ReactNode}){const ref=useRef<HTMLDialogElement>(null);const titleId=useId();useEffect(()=>{const dialog=ref.current!;dialog.showModal();dialog.focus();return()=>dialog.close();},[]);// Rendered at the end of <body>, so styles scoped to the page section that opened it never reach the dialog.
  return createPortal(<dialog ref={ref} tabIndex={-1} aria-labelledby={titleId} onCancel={onClose} className="modal"><header><h2 id={titleId}>{title}</h2><button className="icon dialog-close" aria-label="Close dialog" onClick={onClose}><X width={18} height={18} strokeWidth={2} aria-hidden="true"/></button></header>{children}{footer&&<ModalFooter>{footer}</ModalFooter>}</dialog>,document.body);}
export function ModalFooter({children}:{children:ReactNode}){return <div className="modal-footer">{children}</div>;}

// The design system's controls (docs/DESIGN.md, live at #design-system). Each renders the component's class, so a
// new screen needs no CSS of its own.
// Buttons keep the native default type (submit inside a form), exactly like a plain <button>; pass type="button" for
// an action inside a form that must not submit it.
type Variant='secondary'|'primary'|'danger'|'quiet'|'ghost';
const buttonClass=(variant:Variant,size:'regular'|'compact',className?:string)=>[variant==='quiet'?'text-button':variant==='secondary'?'':variant,size==='compact'?'compact':'',className??''].filter(Boolean).join(' ')||undefined;
type ButtonProps=React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:Variant;size?:'regular'|'compact';icon?:ReactNode};
export function Button({variant='secondary',size='regular',icon,className,children,...rest}:ButtonProps){
  return <button className={buttonClass(variant,size,className)} {...rest}>{icon}{children}</button>;}
// A link that looks like a button (opens a page or a download, never runs an action).
export function LinkButton({variant='secondary',size='regular',className,children,...rest}:React.AnchorHTMLAttributes<HTMLAnchorElement>&{variant?:Variant;size?:'regular'|'compact'}){
  return <a className={'button'+(buttonClass(variant,size,className)?' '+buttonClass(variant,size,className):'')} {...rest}>{children}</a>;}
// Square icon-only button; `label` is its accessible name.
export function IconButton({label,icon,variant='secondary',className,...rest}:Omit<React.ButtonHTMLAttributes<HTMLButtonElement>,'children'>&{label:string;icon:ReactNode;variant?:'secondary'|'ghost'}){
  return <button className={'icon'+(variant==='ghost'?' ghost':'')+(className?' '+className:'')} aria-label={label} {...rest}>{icon}</button>;}
export function Field({label,children,className}:{label:ReactNode;children:ReactNode;className?:string}){return <label className={className}>{label}{children}</label>;}
export function Tag({tone,className,children,...rest}:React.HTMLAttributes<HTMLSpanElement>&{tone?:'ok'|'warn'}){return <span className={'tag'+(tone?' '+tone:'')+(className?' '+className:'')} {...rest}>{children}</span>;}
export function CountBadge({count}:{count:number}){return count>0?<span className="count-badge" aria-hidden="true">{count>9?'9+':count}</span>:null;}
// Pills that switch something on and off (Toggle, calc effects) or pick and filter (Chip). Both show `.on`.
export function Toggle({on,onChange,className,children,...rest}:Omit<React.ButtonHTMLAttributes<HTMLButtonElement>,'onChange'>&{on:boolean;onChange:(on:boolean)=>void}){return <button type="button" className={'toggle'+(on?' on':'')+(className?' '+className:'')} aria-pressed={on} onClick={()=>onChange(!on)} {...rest}>{children}</button>;}
export function Chip({on,className,children,...rest}:React.ButtonHTMLAttributes<HTMLButtonElement>&{on?:boolean}){return <button className={'chip'+(on?' on':'')+(className?' '+className:'')} {...rest}>{children}</button>;}
export function Segmented<T extends string>({label,options,value,onChange}:{label:string;options:{value:T;label:ReactNode}[];value:T;onChange:(v:T)=>void}){
  return <div className="segmented" role="group" aria-label={label}>{options.map(o=><button key={o.value} type="button" aria-pressed={o.value===value} className={o.value===value?'on':undefined} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>;}
export function Card({children,className}:{children:ReactNode;className?:string}){return <div className={'card'+(className?' '+className:'')}>{children}</div>;}
// Team members named in the text appear as small linked sprites beside their name (Mega names included).
export type MonRef={name:string;set:{species:string;item?:string};href:string};
function withMons(children:ReactNode,mons:MonRef[],art:any):ReactNode{
  if(!mons.length)return children;const names=mons.flatMap(m=>[`Mega ${m.name}`,m.name]).sort((a,b)=>b.length-a.length);
  const re=new RegExp(`\\b(${names.map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})\\b`,'g');
  const walk=(c:ReactNode,k:string):ReactNode=>{if(typeof c==='string'){const parts=c.split(re);if(parts.length===1)return c;return parts.map((t,i)=>{const m=i%2?mons.find(x=>t===x.name||t===`Mega ${x.name}`):null;return m?<a key={k+i} className="mon-chip" href={m.href}><SetArt set={m.set} art={art} small/>{t}</a>:t;});}
    if(Array.isArray(c))return c.map((x,i)=>walk(x,k+i));return c;};
  return walk(children,'m');
}
export function Markdown({text,mons=[],art}:{text:string;mons?:MonRef[];art?:any}){const deco=(Tag:any)=>({children}:{children?:ReactNode})=><Tag>{withMons(children,mons,art)}</Tag>;
  return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{table:({children})=><div className="table-scroll"><table>{children}</table></div>,...mons.length?{p:deco('p'),li:deco('li'),td:deco('td'),strong:deco('strong')}:{},a:({href,children})=>{if(href?.startsWith('http://')||href?.startsWith('https://'))return <a href={href} target="_blank" rel="noreferrer">{children} ↗</a>;return <span>{children}</span>;}}}>{text}</ReactMarkdown></div>;}
export function Empty({children,className}:{children:ReactNode;className?:string}){return <div className={'empty'+(className?' '+className:'')}>{children}</div>;}
// Tabs: the segmented track. `block` stretches the options across the row; an option can carry a second line (`sub`).
type TabOption=string|{value:string;label:ReactNode;sub?:ReactNode};
export function Tabs({tabs,value,onChange,icons={},block=false,className}:{tabs:TabOption[];value:string;onChange:(s:string)=>void;icons?:Record<string,ReactNode>;block?:boolean;className?:string}){
  return <div className={'tabs'+(block?' block':'')+(className?' '+className:'')} role="tablist">{tabs.map(t=>{const o=typeof t==='string'?{value:t,label:t}:t;return <button key={o.value} role="tab" aria-selected={o.value===value} className={value===o.value?'selected':''} onClick={()=>onChange(o.value)}>{icons[o.value]}{o.label}{'sub' in o&&o.sub!=null&&<small>{o.sub}</small>}</button>;})}</div>;}
export function Notice({children,className,...rest}:React.HTMLAttributes<HTMLParagraphElement>){return <p className={'notice'+(className?' '+className:'')} {...rest}>{children}</p>;}
// The status line at the top of the page: a message and a close button.
export function Toast({error=false,children,onDismiss}:{error?:boolean;children:ReactNode;onDismiss?:()=>void}){return <div className={'toast'+(error?' error':'')} role={error?'alert':'status'}>{children}{onDismiss&&<button className="icon" aria-label="Dismiss notification" onClick={onDismiss}><X width={16} height={16} strokeWidth={1.75} aria-hidden="true" className="px-icon"/></button>}</div>;}
export function JobStatus({jobs,kinds}:{jobs:any;kinds:string[]}){return <div className="context-jobs" aria-live="polite">{jobs?.current.filter((j:any)=>kinds.includes(j.kind)).slice(0,2).map((j:any)=><div className="job" key={j.id}><span className={'status '+j.status}>{j.status}</span><span>{j.phase}</span>{j.error&&<p role="alert">{j.error}</p>}</div>)}</div>;}

// A two-way toggle switch: one pill, a thumb that slides to the chosen side with that label inside it; the other label is
// plain text on the track. The whole pill is a single control (role "switch"), so there are no buttons inside it.
// `short` replaces the label on narrow screens (CSS swaps them); `icon` sits before it.
export function ModeSwitch<T extends string>({value,options,onChange,label}:{value:T;options:{value:T;label:string;short?:string;icon?:React.ReactNode}[];onChange:(v:T)=>void;label:string}){
  const right=value===options[1].value;
  const side=(o:typeof options[number])=><span className={'ms-side'+(o.value===value?' on':'')}>{o.icon}<span className="ms-full">{o.label}</span><span className="ms-short">{o.short??o.label}</span></span>;
  return <button type="button" role="switch" aria-checked={right} aria-label={`${label}: ${options[right?1:0].label}. Switch to ${options[right?0:1].label}`} className={'mode-switch'+(right?' right':'')}
    onClick={e=>{const r=e.currentTarget.getBoundingClientRect();const x=e.clientX-r.left;onChange(options[e.clientX&&x>0?(x>r.width/2?1:0):(right?0:1)].value);}}>
    <span className="ms-thumb" aria-hidden="true"/>{side(options[0])}{side(options[1])}
  </button>;
}
