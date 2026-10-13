import {useState,type ReactNode} from 'react';
import {api,Art,TypeBadges,ItemIcon,MegaOrb,type MegaForm} from './ui.tsx';
import SpeciesPicker,{type SavedOption} from './ai/SpeciesPicker.tsx';
import {ItemPicker,MovePicker} from './ai/Pickers.tsx';
import './calc-lab.css';
// The second Pokémon on each side for the four-way speed order. Same pieces as the lead cards, kept compact: species
// (its most used set from the Frontier Brain pool, labelled), the move it picks this turn, and the speed conditions.
const spLine=(s:any)=>['hp','atk','def','spa','spd','spe'].map(k=>s.statPoints?.[k]??0).join('/');
export default function PartnerCard({side,set,setSet,saved,art,mega,megaOn,setMega,formName,dex,role='speed',editor,extra}:{side:'mine'|'foe';set:any|null;setSet:(s:any|null)=>void;saved:SavedOption[];art:any;mega?:MegaForm;megaOn:boolean;setMega:(v:boolean)=>void;formName:(n:string)=>string;dex:any;role?:'speed'|'attacker'|'target';editor?:ReactNode;extra?:ReactNode}){
  const [note,setNote]=useState(''),[loading,setLoading]=useState(false);
  const load=async(species:string)=>{setLoading(true);
    try{let m=await api(`/meta-sets?species=${encodeURIComponent(species)}&source=pool`);let src='Pool';if(!m.spreads.length){m=await api(`/meta-sets?species=${encodeURIComponent(species)}&source=pokebase`);src='PokéBase';}
      const sp=m.spreads[0];if(!sp){setSet({species,nature:'Serious',statPoints:{},ability:m.abilities?.[0]?.name,item:'',moves:[]});setNote('No published set found: neutral nature, no stat points. Edit it below.');return;}
      const nature=sp.nature??m.natures?.[0]?.name??'Serious';
      setSet({species:m.species,nature,statPoints:sp.statPoints,ability:m.abilities?.[0]?.name,item:m.items?.[0]?.name??'',moves:(m.moves??[]).slice(0,4).map((x:any)=>x.name)});
      setNote(`${src} · most used set · ${nature} ${spLine(sp)}${m.items?.[0]?.name?` · ${m.items[0].name}`:''} · ${m.period}`);}
    catch(e){setSet({species,nature:'Serious',statPoints:{},ability:undefined,item:'',moves:[]});setNote(`No published set could be loaded (${(e as Error).message}). Neutral nature and 0 points: set its Speed below.`);}finally{setLoading(false);}};
  const pickSaved=(o:SavedOption)=>{setSet({...structuredClone(o.value)});setNote(`My sets · ${o.label}`);};
  const label=role==='attacker'?'Second attacker':role==='target'?'Second target':side==='mine'?'Your partner':'Opponent partner';const upd=(p:any)=>setSet({...set,...p});
  const status=new Set<string>(dex?.statusMoves??[]);const itemId=String(set?.item??'').toLowerCase();
  const moveChips=(set?.moves??[]).filter(Boolean).map((m:string)=><button type="button" key={m} className={'toggle'+(set?.move===m?' on':'')} aria-pressed={set?.move===m} onClick={()=>upd({move:m})}>{m}</button>);
  const morePicker=<div className="move-input"><MovePicker label="Another move" dex={dex} value={(set?.moves??[]).includes(set?.move)?'':set?.move??''} onChange={(v:string)=>upd({move:v||undefined})}/></div>;const shown=mega&&megaOn?mega.name:set?.species;
  return <section className={'partner is-'+side} aria-label={label}>
    <div className="partner-art">{set?<Art name={shown} fallback={set.species} art={art}/>:<span className="partner-empty" aria-hidden="true">+</span>}</div>
    <div className="partner-main"><span className="eyebrow">{label}</span>
      <div className="name-row"><SpeciesPicker label={`${label} species`} placeholder="Choose a Pokémon" value={set?.species??''} saved={saved} onPick={sp=>void load(sp)} onPickSaved={pickSaved}/>
        {mega&&set&&<button type="button" className={'mega-switch mega-badge mega-toggle'+(megaOn?' on':'')} aria-pressed={megaOn} onClick={()=>setMega(!megaOn)} title={megaOn?`Battling as ${formName(mega.name)}`:`Switch on to battle as ${formName(mega.name)}`}><MegaOrb size={14}/>Mega</button>}</div>
      {set&&<TypeBadges species={shown}/>}
      {loading&&<p className="footnote" role="status">Loading its set…</p>}
      {set&&<>
        <p className="combatant-sum"><ItemIcon item={set.item}/><span>{set.item||'No item'}</span><span>{mega&&megaOn?mega.ability:set.ability||'—'}</span><span>{set.nature}</span><span className="mono">{spLine(set)}</span></p>
        {note&&<p className="footnote">{note}</p>}
        {role==='speed'?<>
          <div className="lab-row"><label>Nature<select value={set.nature??'Serious'} onChange={e=>upd({nature:e.target.value})}>{(dex?.natures??[set.nature??'Serious']).map((n:string)=><option key={n}>{n}</option>)}</select></label>
            <label>Speed points<input type="number" min="0" max="32" value={set.statPoints?.spe??0} onChange={e=>upd({statPoints:{...set.statPoints,spe:Math.max(0,Math.min(32,Number(e.target.value)||0))}})}/></label></div>
          <label>Item<ItemPicker value={set.item??''} onChange={v=>upd({item:v})} dex={dex}/></label>
          <span className="ctx-label">Move this turn</span>
          <div className="move-chips"><button type="button" className={'toggle'+(!set.move?' on':'')} aria-pressed={!set.move} onClick={()=>upd({move:undefined})}>Any (no priority)</button>{moveChips}</div>
          {morePicker}
          <div className="lab-row"><label>Speed stage<input type="number" min="-6" max="6" value={set.stage??0} onChange={e=>upd({stage:Math.max(-6,Math.min(6,Number(e.target.value)||0))})}/></label></div>
          <div className="toggles"><button type="button" className={'toggle'+(set.paralyzed?' on':'')} aria-pressed={!!set.paralyzed} onClick={()=>upd({paralyzed:!set.paralyzed})}>Paralysed</button>
            {itemId==='quick claw'&&<button type="button" className={'toggle'+(set.quickClaw?' on':'')} aria-pressed={!!set.quickClaw} onClick={()=>upd({quickClaw:!set.quickClaw})}>Quick Claw activates</button>}
            {set.item&&<button type="button" className={'toggle'+(set.itemUsed?' on':'')} aria-pressed={!!set.itemUsed} onClick={()=>upd({itemUsed:!set.itemUsed})}>{set.item} used up</button>}
            <button type="button" className="toggle" onClick={()=>{setSet(null);setNote('');}}>Remove</button></div></>
        :<>
          {role==='attacker'&&<><span className="ctx-label">Its attack</span><div className="move-chips">{moveChips}</div>{morePicker}{!set.move&&<p className="footnote">Pick its attack to see the combined result.</p>}</>}
          {extra}
          {editor&&<details className="combatant-edit"><summary>Edit set</summary>{editor}</details>}
          <div className="toggles"><button type="button" className="toggle" onClick={()=>{setSet(null);setNote('');}}>Remove</button></div></>}
      </>}
    </div></section>;
}
