import {useState,useEffect,useId,useRef} from 'react';
import {api,PokeIcon} from '../ui.tsx';
// Species combobox: type to filter (data pool's most used first), arrows to move, Enter or click to choose.
// It never commits while typing. Choosing a species (even the current one) loads its most common set; the player's starred
// "My sets" for a species are listed under it. Species already on the team are shown but disabled.
export interface SavedOption {id:string;label:string;species:string;value:any;}
let cache:Promise<any[]>|null=null;
export const speciesOptions=()=>(cache??=api('/species-options').catch(e=>{cache=null;throw e;}));
export default function SpeciesPicker({value='',placeholder,onPick,onPickSaved,disabled=[],saved=[],autoFocus=false,label}:{value?:string;placeholder?:string;onPick:(species:string)=>void;onPickSaved?:(o:SavedOption)=>void;disabled?:string[];saved?:SavedOption[];autoFocus?:boolean;label?:string}){
  const [options,setOptions]=useState<any[]>([]),[text,setText]=useState(value),[open,setOpen]=useState(false),[active,setActive]=useState(0);const id=useId();const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{speciesOptions().then(setOptions).catch(()=>{});},[]);useEffect(()=>{setText(value);},[value]);
  useEffect(()=>{if(autoFocus)input.current?.focus();},[autoFocus]);
  const q=text.trim().toLowerCase();const filtering=open&&!!q&&q!==value.toLowerCase();
  // Each species row means "its most common set"; the player's saved sets ("My sets") for that species sit underneath it.
  type Row={kind:'species';key:string;o:any;off:boolean}|{kind:'saved';key:string;o:SavedOption};
  const presets=(species:string)=>saved.filter(p=>p.species===species).map(p=>({kind:'saved' as const,key:'saved:'+p.id,o:p}));
  const rows:Row[]=[];
  if(!filtering){if(value){const own=options.find(o=>o.name===value)??{name:value};rows.push({kind:'species',key:value,o:own,off:false},...presets(value));}
    for(const o of options.filter(o=>o.name!==value).slice(0,40))rows.push({kind:'species',key:o.name,o,off:disabled.includes(o.name)});}
  else{for(const o of options.filter(o=>o.name.toLowerCase().includes(q)).slice(0,30)){const off=disabled.includes(o.name)&&o.name!==value;rows.push({kind:'species',key:o.name,o,off},...(off?[]:presets(o.name)));}
    for(const p of saved.filter(p=>p.label.toLowerCase().includes(q)&&!rows.some(r=>r.key==='saved:'+p.id)))rows.push({kind:'saved',key:'saved:'+p.id,o:p});}
  const choose=(i:number)=>{const r=rows[i];if(!r||(r.kind==='species'&&r.off))return;setOpen(false);setText(value);if(r.kind==='saved')onPickSaved?.(r.o);else onPick(r.o.name);};
  const iconOf=(name:string)=>options.find(o=>o.name===name)?.icon;const showing=open&&text?options.find(o=>o.name.toLowerCase()===text.trim().toLowerCase()):null;
  return <div className="combo with-icon" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node)){setOpen(false);setText(value);}}}>
    <PokeIcon n={showing?showing.icon:iconOf(value)}/>
    <input ref={input} role="combobox" aria-label={label??placeholder??'Pokémon'} aria-expanded={open} aria-controls={id} aria-activedescendant={open&&rows[active]?`${id}-${active}`:undefined} value={text} placeholder={value||placeholder}
      onFocus={e=>{e.currentTarget.select();setText('');setOpen(true);setActive(0);}} onChange={e=>{setText(e.target.value);setOpen(true);setActive(0);}}
      onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setActive(Math.min(active+1,rows.length-1));}else if(e.key==='ArrowUp'){e.preventDefault();setActive(Math.max(active-1,0));}
        else if(e.key==='Enter'){e.preventDefault();const exact=rows.findIndex(r=>r.kind==='species'&&r.o.name.toLowerCase()===q);choose(exact>=0?exact:active);}else if(e.key==='Escape'){if(open){e.stopPropagation();setOpen(false);setText(value);}}}}/>
    {open&&rows.length>0&&<ul className="combo-list" role="listbox" id={id}>{rows.map((r,i)=><li key={r.key} id={`${id}-${i}`} role="option" aria-selected={i===active} aria-disabled={r.kind==='species'&&r.off} className={(i===active?'active ':'')+(r.kind==='species'&&r.off?'off ':'')+r.kind}
      onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(i)} onClick={()=>choose(i)}>
      {r.kind==='saved'?<><PokeIcon n={iconOf(r.o.species)}/><span>★ {r.o.label}</span><small>My set</small></>:<><PokeIcon n={r.o.icon}/><span>{r.o.name}{r.o.name===value?' · most common set':''}</span><small>{r.off?'on the team':r.o.usage?`${r.o.usage}% of teams`:''}</small></>}</li>)}</ul>}
  </div>;
}
