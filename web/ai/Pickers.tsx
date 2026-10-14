import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {TYPE_COLOURS,IconButton} from '../ui.tsx';
import {TEAM_STYLES} from '../../shared/team-styles.ts';

// A searchable list that opens under its field, like the species picker: type to filter, arrows to move, Enter or
// click to choose, Escape to close. Free text is kept on blur, so an unlisted item or move can still be entered.
interface Row {value:string;label:ReactNode;hint?:ReactNode;group?:string;off?:boolean}
// `resolve` makes the field strict: text that is not one of the listed values (case aside) snaps back instead of being kept.
function Combo({value,onChange,rows,placeholder,label,icon,className='',resolve,title,after}:{value:string;onChange:(v:string)=>void;rows:(q:string)=>Row[];placeholder?:string;label:string;icon?:ReactNode;className?:string;resolve?:(text:string)=>string|null;title?:string;after?:ReactNode}){
  const [text,setText]=useState(value),[open,setOpen]=useState(false),[active,setActive]=useState(0);const id=useId();const list=useRef<HTMLUListElement>(null);const input=useRef<HTMLInputElement>(null);
  // The close button only shows on phones, where the open list is a full-screen sheet. Same as Escape, then the field lets go.
  const close=()=>{setOpen(false);setText(value);requestAnimationFrame(()=>input.current?.blur());};
  useEffect(()=>setText(value),[value]);
  const q=open&&text!==value?text.trim().toLowerCase():'';const shown=open?rows(q).slice(0,60):[];
  useEffect(()=>{setActive(0);},[q,open]);
  useEffect(()=>{list.current?.querySelector('.active')?.scrollIntoView({block:'nearest'});},[active]);
  const pick=(v:string)=>{onChange(v);setText(v);setOpen(false);};
  return <div className={'combo picker '+className+(open?' open':'')}>{icon&&<span className="picker-icon">{icon}</span>}
    <input ref={input} role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} aria-autocomplete="list" placeholder={placeholder} value={text} title={title}
      onFocus={e=>{setOpen(true);e.target.select();}} onChange={e=>{setText(e.target.value);setOpen(true);}}
      onBlur={()=>setTimeout(()=>{setOpen(false);if(text.trim()&&text!==value){const v=resolve?resolve(text.trim()):text.trim();if(v)onChange(v);else setText(value);}if(!text.trim())setText(value);},120)}
      onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(a=>Math.min(a+1,shown.length-1));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(a-1,0));}
        else if(e.key==='Enter'&&open&&shown[active]&&!shown[active].off){e.preventDefault();pick(shown[active].value);}else if(e.key==='Escape'){setOpen(false);setText(value);}}}/>
    {open&&<IconButton label="Close list" icon={<X width={18} height={18} strokeWidth={2} aria-hidden="true"/>} className="combo-close" type="button" onMouseDown={e=>e.preventDefault()} onClick={close}/>}
    {open&&shown.length>0&&<ul className="combo-list" id={id} role="listbox" ref={list}>{shown.map((r,i)=><li key={r.value} role="option" aria-selected={i===active} aria-disabled={r.off} className={(i===active?'active ':'')+(r.off?'off ':'')+(r.group&&(i===0||shown[i-1].group!==r.group)?'group-start':'')} data-group={r.group&&(i===0||shown[i-1].group!==r.group)?r.group:undefined}
      onMouseDown={e=>{e.preventDefault();if(!r.off)pick(r.value);}} onMouseEnter={()=>setActive(i)}><span className="row-main">{r.label}</span>{r.hint&&<small>{r.hint}</small>}</li>)}</ul>}
    {after}
  </div>;
}

const icon=(n?:number)=><span className="item-icon" aria-hidden="true" style={n?{backgroundPosition:`-${(n%16)*24}px -${Math.floor(n/16)*24}px`}:{backgroundImage:'none'}}/>;
// Held items with their sprites. Items another team member already holds are shown but can't be picked (Item Clause).
export function ItemPicker({value,onChange,dex,taken=[],label='Item'}:{value:string;onChange:(v:string)=>void;dex:any;taken?:string[];label?:string}){
  const info:Record<string,[number,string]>=dex?.itemInfo??{};const names:string[]=dex?.items??[];
  return <Combo label={label} value={value} onChange={onChange} placeholder="Search items" icon={icon(info[value]?.[0])}
    rows={q=>names.filter(n=>!q||n.toLowerCase().includes(q)).sort((a,b)=>q?(a.toLowerCase().startsWith(q)?0:1)-(b.toLowerCase().startsWith(q)?0:1)||a.localeCompare(b):0)
      .map(n=>({value:n,label:<>{icon(info[n]?.[0])}<span>{n}</span></>,hint:taken.includes(n)&&n!==value?'held by a teammate':undefined,off:taken.includes(n)&&n!==value}))}/>;
}
const typePill=(t:string)=><span className="type-badge mini" style={{'--type':TYPE_COLOURS[t]??'#888'} as any}>{t}</span>;
const cat=(c:string)=><span className={'move-cat '+c.toLowerCase()} title={c}>{c==='Physical'?'Phys':c==='Special'?'Spec':'Status'}</span>;
// Moves with type, category and power. Only moves the species can learn that are legal in the format are listed (a move
// it cannot learn is never offered, and typed text that is not one of them snaps back). With no learnset to go on the
// whole format list is used. On desktop the highlighted move's row opens in place with what it does and the chosen move
// has a tooltip. On touch there is no hover: tapping a chosen move first opens its details as a panel attached under
// the field, and a second tap opens the picker.
type MoveInfo=[string,string,number,string?,(number|boolean)?,number?];
const moveLine=(m:MoveInfo)=>[m[1],m[2]?`${m[2]} power`:null,typeof m[4]==='number'?`${m[4]}% accuracy`:null,m[5]?`PP ${m[5]}`:null].filter(Boolean).join(' · ');
const touchLike=()=>typeof window!=='undefined'&&(window.matchMedia('(hover:none)').matches||window.innerWidth<=620);
export function MovePicker({value,onChange,dex,label,exclude=[]}:{value:string;onChange:(v:string)=>void;dex:any;label:string;exclude?:string[]}){
  const info:Record<string,MoveInfo>=dex?.moveInfo??{};const learn:string[]=dex?.learnset??[];const all:string[]=dex?.moves??[];const m=info[value];
  const [open,setOpen]=useState(false);const field=useRef<HTMLDivElement>(null);useEffect(()=>setOpen(false),[value]);
  useEffect(()=>{if(!open)return;const away=(e:Event)=>{if(!field.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',away);return()=>document.removeEventListener('pointerdown',away);},[open]);
  const pool=(learn.length?learn:all).filter(n=>!Object.keys(info).length||info[n]);const byLower=new Map(pool.map(n=>[n.toLowerCase(),n]));
  const text=m?`${value}: ${m[3]||'No description.'} (${moveLine(m)})`:undefined;
  // First tap on a chosen move (touch only) opens the details instead of the picker; the next tap goes through.
  const firstTap=(e:{preventDefault:()=>void;stopPropagation:()=>void})=>{if(m&&!open&&touchLike()){e.preventDefault();e.stopPropagation();setOpen(true);}};
  return <div className={'move-field'+(m&&open?' details':'')} ref={field} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false);}}>
    <div className="move-field-input" onMouseDownCapture={firstTap} onClickCapture={e=>{if(m&&!open&&touchLike())e.stopPropagation();}}>
      <Combo label={label} value={value} onChange={onChange} placeholder="Search moves" className="move-picker" icon={m?typePill(m[0]):undefined} title={touchLike()?undefined:text}
        resolve={t=>byLower.get(t.toLowerCase())??null}
        rows={q=>{const match=(n:string)=>!q||n.toLowerCase().includes(q)||info[n]?.[0].toLowerCase()===q;
          return pool.filter(match).map(n=>({value:n,label:<>{info[n]&&typePill(info[n][0])}<span>{n}</span>{info[n]&&<em className="row-sub">{info[n][3]||'No description.'}<small>{moveLine(info[n])}</small></em>}</>,hint:info[n]?<>{cat(info[n][1])}{info[n][2]?<b>{info[n][2]}</b>:null}</>:undefined,off:exclude.includes(n)&&n!==value}));}}/>
    </div>
    {m&&open&&<div className="move-desc" role="note" onClick={()=>{setOpen(false);field.current?.querySelector('input')?.focus();}}><p>{m[3]||'No description.'}</p><small>{moveLine(m)}</small></div>}</div>;
}

// Team styles (shared/team-styles.ts), grouped; styles already chosen are shown but can't be picked again. Anything
// typed that isn't listed is kept as written.
export function StylePicker({onPick,taken=[],label,placeholder}:{onPick:(v:string)=>void;taken?:string[];label:string;placeholder?:string}){
  const rows=(q:string)=>TEAM_STYLES.flatMap(g=>g.styles.filter(s=>!q||s.toLowerCase().includes(q)).map(s=>({value:s,label:s,group:g.group,off:taken.includes(s)})));
  return <Combo value="" onChange={v=>{if(v&&!taken.includes(v))onPick(v);}} rows={rows} label={label} placeholder={placeholder} className="style-picker"/>;
}
