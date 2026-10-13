import {useState,useEffect} from 'react';
import {api} from '../ui.tsx';
import {Px,Sparkles,Close} from '../icons.tsx';
import {offer} from '../save-state.ts';
import {hostedSite} from '../auth.tsx';
// Calcs an assistant ran over the connector (calc_damage / calc_speed) that involve this Pokémon. Open loads the same
// inputs into the calc panel below; saving a benchmark stays a separate, explicit step there.
const base=(s?:string)=>String(s??'').replace(/-Mega(-[A-Z])?$/,'');
const involves=(c:any,species:string)=>[c.input?.attacker,c.input?.defender,c.input?.a,c.input?.b].some(x=>base(x?.species)===species);
const ago=(at:string)=>{const m=Math.round((Date.now()-Date.parse(at))/60000);return m<1?'just now':m<60?`${m} min ago`:`${Math.round(m/60)} h ago`;};
export default function AssistantCalcs({teamId,slot,species}:{teamId:string;slot:number|string;species:string}){
  const [list,setList]=useState<any[]>([]),[note,setNote]=useState('');
  useEffect(()=>{let alive=true;const tick=()=>{if(document.visibilityState==='visible')api('/assistant-calcs').then(l=>{if(alive)setList(l);}).catch(()=>{});};
    tick();const t=setInterval(tick,hostedSite?6000:4000);document.addEventListener('visibilitychange',tick);
    return()=>{alive=false;clearInterval(t);document.removeEventListener('visibilitychange',tick);};},[]);
  const mine=list.filter(c=>involves(c,species)),others=list.length-mine.length;
  const open=(c:any)=>{setNote(offer(`calc:${teamId}:${slot}`,{kind:c.kind,input:c.input,from:'Your assistant'})?'':'The calc panel is not ready yet. Try again in a moment.');};
  const dismiss=async(c:any)=>{try{setList(await api('/assistant-calcs/remove',{id:c.id}));}catch{}};
  if(!mine.length)return others?<p className="muted tiny assistant-calcs-more">{others} calc{others===1?'':'s'} from your assistant involve other Pokémon.</p>:null;
  return <section className="queued assistant-calcs" aria-label="From your assistant">
    <h3 className="queued-h"><Px icon={Sparkles}/>From your assistant</h3>
    <ul className="assistant-calc-list">{mine.map(c=><li key={c.id}><span className="tag">{c.kind==='speed'?'Speed':'Damage'}</span><span className="assistant-calc-label">{c.label}</span><span className="muted tiny">{ago(c.at)}</span>
      <span className="button-row"><button className="primary compact" onClick={()=>open(c)}>Open in calc</button><button className="icon" aria-label={`Dismiss ${c.label}`} title="Dismiss" onClick={()=>void dismiss(c)}><Px icon={Close} size={14}/></button></span></li>)}</ul>
    {note&&<p className="muted" role="status">{note}</p>}
    {others>0&&<p className="muted tiny">{others} more involve other Pokémon.</p>}
  </section>;
}
