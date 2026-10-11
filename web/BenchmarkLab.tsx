import {useState,useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import type {BankEntry,SetRevision,PokemonSet} from '../shared/workbench.ts';
import {api,Tabs,Notice,Art,TypeBadges,ItemIcon,useDex,type MegaForm} from './ui.tsx';
import SpeciesPicker,{type SavedOption} from './ai/SpeciesPicker.tsx';
import {offer,useOffers} from './save-state.ts';
const stats=['hp','atk','def','spa','spd','spe'] as const;
const statLabel:Record<string,string>={hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'};
// Until a standard set loads, the target is species-only; nothing is presented as a typical spread.
const pendingTarget:PokemonSet={species:'Incineroar',nature:'Serious',ability:'Intimidate',item:'',statPoints:{},moves:[]};
const spLine=(s:any)=>stats.map(k=>s.statPoints?.[k]??0).join('/');
const reduced=()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
// Standard opponent sets come from one labelled source at a time (default: the Frontier Brain pool), never blended.
const sourceNames:Record<string,string>={pool:'Frontier Brain pool · deduplicated teams',pokebase:'PokéBase · M-C tournaments',vgcpastes:'VGCPastes · shared team pastes',limitless:'Limitless · official Day 2 team lists (no spreads)','pokebase-ladder':'PokéBase · in-game ladder season',smogon:'Smogon · Showdown ladder (fallback)'};
const sourceShort:Record<string,string>={pool:'Pool',pokebase:'PokéBase',vgcpastes:'VGCPastes',limitless:'Limitless','pokebase-ladder':'PokéBase ladder',smogon:'Smogon'};
// Where each effect lives. Side effects belong to a Pokémon's side (they follow it when you swap who attacks);
// a card only shows the ones that matter for its current role. Field effects apply to everyone.
const ATTACK_SIDE=[['isHelpingHand','Helping Hand'],['isBattery','Battery'],['isPowerSpot','Power Spot'],['isSteelySpirit','Steely Spirit']] as const;
const DEFEND_SIDE=[['isReflect','Reflect'],['isLightScreen','Light Screen'],['isAuroraVeil','Aurora Veil'],['isFriendGuard','Friend Guard'],['isProtected','Protect']] as const;
const FIELD_FLAGS=[['isGravity','Gravity'],['isMagicRoom','Magic Room'],['isWonderRoom','Wonder Room'],['isBeadsOfRuin','Beads of Ruin'],['isSwordOfRuin','Sword of Ruin'],['isTabletsOfRuin','Tablets of Ruin'],['isVesselOfRuin','Vessel of Ruin']] as const;
const BATTLE_KEYS=['curHP','status','boosts','abilityOn','alliesFainted','stage','multiplier','priority','tailwind','paralyzed'] as const;
type Pick={kind:'current'}|{kind:'saved';id:string;label:string;set:PokemonSet}|{kind:'spread';index:number}|{kind:'custom';set?:PokemonSet};
type Side='mine'|'foe';
const megaName=(name:string)=>/-Mega(-[A-Z])?$/.test(name);const baseName=(name:string)=>name.replace(/-Mega(-[A-Z])?$/,'');
export const formName=(name:string)=>name.replace(/^(.*)-Mega(?:-([A-Z]))?$/,(_,b:string,x?:string)=>`Mega ${b}${x?' '+x:''}`);
const onlyTrue=(f:Record<string,boolean>)=>Object.fromEntries(Object.entries(f).filter(([,v])=>v));
function Toggle({on,label,set}:{on:boolean;label:string;set:(v:boolean)=>void}){return <button type="button" className={'toggle'+(on?' on':'')} aria-pressed={on} onClick={()=>set(!on)}>{label}</button>;}

// The calc for one Pokémon, as one matchup. The attacker's card sits on top and the defender's below; the swap in the
// middle flips them. Your side: the card's current draft, one of your starred sets, or a theoretical one. The
// opponent: a sourced spread, a starred set or a custom one. Mega Stone holders battle as the Mega (switchable).
// Battle conditions live here; nothing in the calc saves to the set.
export default function BenchmarkLab({entry,revision,own:draftSet,data,mutate,offerKey}:{entry:BankEntry;revision:SetRevision;own:PokemonSet;data:any;mutate:(a:any)=>Promise<any>;onUseSpread?:(nature:string,statPoints:any)=>void;offerKey?:string}){
  const starred:SavedOption[]=data.db.bank.flatMap((b:BankEntry)=>b.revisions.filter(r=>r.starred).map(r=>({id:r.id,label:r.starred!.label,species:r.set.species,value:r.set})));
  // Your side
  const [mine,setMine]=useState<Pick>({kind:'current'});useEffect(()=>setMine({kind:'current'}),[draftSet.species]);
  const [battle,setBattle]=useState<any>({});
  const mineBase:PokemonSet=mine.kind==='saved'?mine.set:mine.kind==='custom'?(mine.set??draftSet):draftSet;const own={...mineBase,...battle};
  const splitBattle=(s:any)=>{const b:any={},set:any={};for(const [k,v] of Object.entries(s))((BATTLE_KEYS as readonly string[]).includes(k)?b:set)[k]=v;return {b,set};};
  const setOwn=(s:any)=>{const {b,set}=splitBattle(s);setBattle(b);if(JSON.stringify(set)!==JSON.stringify({...mineBase}))setMine({kind:'custom',set:set as PokemonSet});};
  const mySaved=starred.filter(o=>o.species===draftSet.species&&o.id!==revision.id);
  // Opponent side
  const [source,setSource]=useState('pool'),[meta,setMeta]=useState<any>(null),[metaError,setMetaError]=useState(''),[loading,setLoading]=useState(false);
  const [other,setOther]=useState<any>(structuredClone(pendingTarget)),[foe,setFoe]=useState<Pick>({kind:'custom'}),[targetLabel,setTargetLabel]=useState('');
  const [tab,setTab]=useState('Damage'),[direction,setDirection]=useState<'outgoing'|'incoming'>('outgoing'),[move,setMove]=useState(draftSet.moves?.find(m=>m!=='Protect')??draftSet.moves?.[0]??'Tackle'),[options,setOptions]=useState<any>({}),[result,setResult]=useState<any>(null),[error,setError]=useState(''),[calculating,setCalculating]=useState(false),[dex,setDex]=useState<any>(null),[trickRoom,setTrickRoom]=useState(false),[saved,setSaved]=useState(''),[fromAsk,setFromAsk]=useState('');
  const [field,setField]=useState<any>({gameType:'Doubles'}),[flags,setFlags]=useState<Record<Side,Record<string,boolean>>>({mine:{},foe:{}}),[megaOn,setMegaOn]=useState<Record<Side,boolean>>({mine:true,foe:true});
  const pickSpread=(m:any,i:number)=>{const s=m.spreads[i];if(!s)return;const nature=s.nature??m.natures[0]?.name??'Serious';
    setOther((o:any)=>({...o,species:m.species,nature,statPoints:s.statPoints,ability:m.abilities[0]?.name,item:m.items[0]?.name,moves:(m.moves??[]).slice(0,4).map((x:any)=>x.name),boosts:undefined}));setFoe({kind:'spread',index:i});setMegaOn(x=>({...x,foe:true}));
    setTargetLabel(`${sourceNames[m.source]} · ${m.species} ${nature} ${Object.values(s.statPoints).join('/')} · spread ${s.percent}%${s.nature?'':`, nature ${m.natures[0]?.percent??'?'}%`} · ${m.items[0]?.name??'no item'} · ${m.period}`);};
  // Choosing a species loads its sets from the chosen source and uses the most common one (pool first, PokéBase if the pool has none).
  const loadFoe=async(species:string,src:string,fallback=false)=>{setLoading(true);setMetaError('');
    try{const m=await api(`/meta-sets?species=${encodeURIComponent(species)}&source=${src}`);if(!m.spreads.length&&fallback&&src==='pool'){setSource('pokebase');return loadFoe(species,'pokebase');}
      setMeta(m);if(m.spreads.length)pickSpread(m,0);else{setOther((o:any)=>({...pendingTarget,...o,species}));setFoe({kind:'custom'});setTargetLabel('');}}
    catch(e){setMeta(null);setMetaError((e as Error).message);setOther((o:any)=>({...o,species}));setFoe({kind:'custom'});setTargetLabel('');}finally{setLoading(false);}};
  useEffect(()=>{void loadFoe(other.species,'pool',true);},[]);
  const pickFoeSaved=(o:SavedOption)=>{setOther((x:any)=>({...x,...structuredClone(o.value),boosts:undefined}));setFoe({kind:'saved',id:o.id,label:o.label,set:o.value});setTargetLabel(`My sets · ${o.label} · ${o.species} ${o.value.nature} ${spLine(o.value)}${o.value.item?` · ${o.value.item}`:''}`);};
  const editFoe=(s:any)=>{setOther(s);const {set}=splitBattle(s),{set:was}=splitBattle(other);if(foe.kind!=='custom'&&JSON.stringify(set)!==JSON.stringify(was)){setFoe({kind:'custom'});setTargetLabel(t=>t?`${t} (edited)`:'');}};
  useEffect(()=>{let alive=true;api('/dex?species='+encodeURIComponent(draftSet.species)).then(d=>{if(alive)setDex(d);}).catch(e=>setError(e.message));return()=>{alive=false;};},[draftSet.species]);
  // Mega forms: a holder of its Mega Stone battles as the Mega by default.
  const dx=useDex([mineBase.species,other.species],[]);
  const megaFor=(s:any)=>(dx.megas[s.species]??[]).find((m:MegaForm)=>m.item===s.item);
  const mineMega=megaFor(own),foeMega=megaFor(other);
  const asForm=(s:any,m:MegaForm|undefined,on:boolean)=>m&&on?{...s,species:m.name,ability:m.ability}:s;
  const ownC=asForm(own,mineMega,megaOn.mine),otherC=asForm(other,foeMega,megaOn.foe);
  const outgoing=direction==='outgoing';const attackerSide:Side=outgoing?'mine':'foe',defenderSide:Side=outgoing?'foe':'mine';
  const attackerSet=outgoing?mineBase:other;
  // Attack with the attacker's first damaging move whenever the attacker (or its moves) change.
  const status=new Set<string>(dex?.statusMoves??[]);const attackerMoves=(attackerSet.moves??[]).filter((m:string)=>m&&!status.has(m));
  useEffect(()=>{if(!attackerMoves.includes(move)&&attackerMoves.length)setMove(attackerMoves[0]);},[direction,JSON.stringify(attackerSet.moves),dex]);
  const fieldInput={...field,attackerSide:onlyTrue(flags[attackerSide]),defenderSide:onlyTrue(flags[defenderSide])};
  const damageInput={attacker:outgoing?ownC:otherC,defender:outgoing?otherC:ownC,move,field:fieldInput,moveOptions:options};
  const speedInput={a:ownC,b:otherC,trickRoom};
  const key=JSON.stringify(tab==='Speed'?speedInput:damageInput);
  useEffect(()=>{if(!dex){setCalculating(false);return;}let alive=true;setCalculating(true);const timer=setTimeout(()=>{api('/calculate',{kind:tab==='Speed'?'speed':'damage',input:JSON.parse(key)}).then(r=>{if(alive){setResult({...r,kind:tab});setError('');}}).catch(e=>{if(alive){setResult(null);setError(e.message);}}).finally(()=>{if(alive)setCalculating(false);});},250);return()=>{alive=false;clearTimeout(timer);};},[key,tab,!!dex]);
  useEffect(()=>setSaved(''),[key,tab]);
  // A calc run by Ask Frontier Brain on this Pokémon lands here with its exact inputs.
  const panel=useRef<HTMLElement>(null);
  const isMine=(s:any)=>!!s&&baseName(s.species)===draftSet.species;
  const takeSet=(s:any,side:Side)=>{const {b,set}=splitBattle(s);const base={...set,species:baseName(set.species)};const mega=megaName(set.species);
    if(side==='mine'){const same=['item','nature','ability'].every(k=>k==='ability'&&mega||(base as any)[k]===(draftSet as any)[k])&&spLine(base)===spLine(draftSet);
      setMine(same?{kind:'current'}:{kind:'custom',set:{...draftSet,...base,ability:mega?draftSet.ability:base.ability}});setBattle(b);}
    else{setOther({...pendingTarget,...base,ability:mega?(base.ability??''):base.ability,...b});setFoe({kind:'custom'});}
    setMegaOn(x=>({...x,[side]:mega}));};
  useOffers(offerKey??'calc:none',(p:any)=>{const input=p.input??{};
    if(p.kind==='speed'){const [m,f]=isMine(input.a)?[input.a,input.b]:isMine(input.b)?[input.b,input.a]:[null,null];if(!m){setError(`Ask's speed check didn't involve ${draftSet.species}, so it isn't shown here.`);return true;}
      takeSet(m,'mine');takeSet(f,'foe');setTrickRoom(!!input.trickRoom);setTab('Speed');}
    else{const out=isMine(input.attacker);if(!out&&!isMine(input.defender)){setError(`Ask's calc didn't involve ${draftSet.species}, so it isn't shown here.`);return true;}
      takeSet(out?input.attacker:input.defender,'mine');takeSet(out?input.defender:input.attacker,'foe');setDirection(out?'outgoing':'incoming');setMove(input.move);setOptions(input.moveOptions??{});
      const {attackerSide:aS={},defenderSide:dS={},...global}=input.field??{};setField({gameType:'Doubles',...global});
      setFlags({mine:out?aS:dS,foe:out?dS:aS});setTab('Damage');}
    const foeSet=p.kind==='speed'?(isMine(input.a)?input.b:input.a):(isMine(input.attacker)?input.defender:input.attacker);
    setTargetLabel(`${p.from??'Ask Frontier Brain'} · ${foeSet?.species} ${foeSet?.nature??''} ${spLine(foeSet??{})}${foeSet?.item?` · ${foeSet.item}`:''} · assumed by the assistant`);
    setFromAsk(`Loaded from ${p.from??'Ask Frontier Brain'}`);setTimeout(()=>panel.current?.scrollIntoView({behavior:reduced()?'auto':'smooth',block:'start'}),50);return true;});
  useEffect(()=>{if(!fromAsk)return;const t=setTimeout(()=>setFromAsk(''),6000);return()=>clearTimeout(t);},[fromAsk]);
  // Benchmarks re-check against your real set, so they're saved only from it (not from a theoretical or other saved set).
  const realSet=mine.kind==='current';
  const saveBenchmark=async()=>{try{const kind=tab==='Speed'?'speed':'damage';await mutate({type:'benchmark-save',bankId:entry.id,revisionId:revision.id,kind,side:kind==='speed'?'a':outgoing?'attacker':'defender',input:kind==='speed'?speedInput:damageInput,context:targetLabel,sources:[]});setSaved('Saved to this Pokémon\'s benchmarks.');}catch(e){setError((e as Error).message);}};
  // Spread searches live in Ask Frontier Brain (it has the same spread search tool); this hands it the question.
  const askSpread=()=>{const foeText=`${otherC.species} (${other.nature} ${spLine(other)}${other.item?`, ${other.item}`:''})`;const q=outgoing?`Find the lightest ${ownC.species} spread that guarantees the KO on ${foeText} with ${move}${options.hits?` (${options.hits} hits)`:''}${field.weather?` in ${field.weather}`:''}, keeping the rest of the set.`:`Find the lightest ${ownC.species} spread that survives ${foeText}'s ${move}${field.weather?` in ${field.weather}`:''}, keeping the rest of the set.`;if(!offer('dock:ask',q))setError('Open Ask Frontier Brain to search for a spread.');};
  const setFlag=(side:Side,k:string,v:boolean)=>setFlags(f=>({...f,[side]:{...f[side],[k]:v}}));
  // Swapping who attacks moves the cards: the attacker always sits on top. Positions animate from where they were.
  const cards=useRef<Record<string,HTMLElement|null>>({}),tops=useRef<Record<string,number>>({}),lastOrder=useRef('');
  const order:Side[]=tab==='Damage'&&!outgoing?['foe','mine']:['mine','foe'];
  useLayoutEffect(()=>{const now=order.join();const moved=lastOrder.current&&lastOrder.current!==now;lastOrder.current=now;
    for(const k of order){const el=cards.current[k];if(!el)continue;const top=el.offsetTop,prev=tops.current[k];tops.current[k]=top;
      if(moved&&prev!==undefined&&prev!==top&&!reduced())el.animate([{transform:`translateY(${prev-top}px)`},{transform:'none'}],{duration:520,easing:'cubic-bezier(.2,.8,.2,1)'});}});
  const mineValue=mine.kind==='saved'?'saved:'+mine.id:mine.kind;
  const foeValue=foe.kind==='spread'?'spread:'+foe.index:foe.kind==='saved'?'saved:'+foe.id:'custom';
  const role=(side:Side)=>tab==='Speed'?(side==='mine'?'You':'Opponent'):`${side==='mine'?'You':'Opponent'} · ${side===attackerSide?'attacking':'defending'}`;
  // What each card shows for its role: the attacker chooses the move and its boosts; the defender its protection.
  const context=(side:Side,s:any,update:(x:any)=>void)=>tab==='Speed'?<div className="ctx">
      <div className="lab-row"><label>Speed stage<input type="number" min="-6" max="6" value={s.stage??0} onChange={e=>update({...s,stage:Number(e.target.value)})}/></label><label title="Item or ability multiplier, entered explicitly (e.g. 1.5 for Choice Scarf)">Multiplier<input type="number" min="0.1" step="0.1" value={s.multiplier??1} onChange={e=>update({...s,multiplier:Number(e.target.value)})}/></label><label>Move priority<input type="number" min="-7" max="7" value={s.priority??0} onChange={e=>update({...s,priority:Number(e.target.value)})}/></label></div>
      <div className="toggles"><Toggle on={!!s.tailwind} label="Tailwind" set={v=>update({...s,tailwind:v})}/><Toggle on={!!s.paralyzed} label="Paralysed" set={v=>update({...s,paralyzed:v})}/></div></div>
    :side===attackerSide?<div className="ctx"><span className="ctx-label">Move</span>
      {attackerMoves.length>0&&<div className="move-chips">{attackerMoves.map((m:string)=><button type="button" key={m} className={'toggle'+(m===move?' on':'')} aria-pressed={m===move} onClick={()=>{setMove(m);setOptions(({hits,context,...o}:any)=>o);}}>{m}</button>)}</div>}
      <label className="move-input"><span className="sr-only">Move</span><input list="lab-moves" value={attackerMoves.includes(move)?'':move} placeholder={attackerMoves.length?'Or type any other move':'Type a move'} onChange={e=>{setMove(e.target.value);setOptions(({hits,context,...o}:any)=>o);}}/></label>
      <MoveContext move={move} dex={dex} options={options} setOptions={setOptions}/>
      <span className="ctx-label">Boosting this attack</span><div className="toggles">{ATTACK_SIDE.map(([k,l])=><Toggle key={k} on={!!flags[side][k]} label={l} set={v=>setFlag(side,k,v)}/>)}<Toggle on={!!options.isCrit} label="Critical hit" set={v=>setOptions({...options,isCrit:v})}/></div></div>
    :<div className="ctx"><span className="ctx-label">Protecting this Pokémon</span><div className="toggles">{DEFEND_SIDE.map(([k,l])=><Toggle key={k} on={!!flags[side][k]} label={l} set={v=>setFlag(side,k,v)}/>)}</div></div>;
  const sideCard=(side:Side)=>side==='mine'
    ?<Combatant key="mine" side="mine" cardRef={el=>{cards.current.mine=el;}} role={role('mine')} set={own} art={data.art} mega={mineMega} megaOn={megaOn.mine} setMega={v=>setMegaOn(x=>({...x,mine:v}))}
        picker={<label className="combatant-pick"><span className="sr-only">Your set</span><select value={mineValue} onChange={e=>{const v=e.target.value;if(v==='current')setMine({kind:'current'});else if(v==='custom')setMine({kind:'custom',set:structuredClone(mineBase)});else{const o=mySaved.find(x=>'saved:'+x.id===v);if(o)setMine({kind:'saved',id:o.id,label:o.label,set:o.value});}}}>
          <option value="current">Current set</option>{mySaved.length>0&&<optgroup label="My sets">{mySaved.map(o=><option key={o.id} value={'saved:'+o.id}>★ {o.label}</option>)}</optgroup>}<option value="custom">{mine.kind==='custom'?'Custom set':'Try a custom set…'}</option></select></label>}
        note={mine.kind==='custom'?'Theoretical: edits here never touch the saved set.':mine.kind==='saved'?`From My sets: ${mine.label}.`:''}
        context={context('mine',own,setOwn)} editor={<SetFields set={own} update={setOwn} dex={dex} form={ownC.species}/>} conditions={<BattleConditions set={own} update={setOwn}/>} editOpen={mine.kind==='custom'}/>
    :<Combatant key="foe" side="foe" cardRef={el=>{cards.current.foe=el;}} role={role('foe')} set={other} art={data.art} mega={foeMega} megaOn={megaOn.foe} setMega={v=>setMegaOn(x=>({...x,foe:v}))}
        species={<SpeciesPicker label="Opponent species" value={other.species} saved={starred} onPick={sp=>void loadFoe(sp,source)} onPickSaved={pickFoeSaved}/>}
        picker={<div className="combatant-pick two"><label><span className="sr-only">Opponent set</span><select value={foeValue} disabled={loading} onChange={e=>{const v=e.target.value;if(v.startsWith('spread:'))pickSpread(meta,Number(v.slice(7)));else if(v.startsWith('saved:')){const o=starred.find(x=>'saved:'+x.id===v);if(o)pickFoeSaved(o);}else setFoe({kind:'custom'});}}>
            {meta?.spreads?.length>0&&<optgroup label={`Most used · ${sourceShort[meta.source]??meta.source}`}>{meta.spreads.slice(0,8).map((sp:any,i:number)=><option key={i} value={'spread:'+i}>{sp.nature?sp.nature+' ':''}{Object.values(sp.statPoints).join('/')} · {sp.percent}%</option>)}</optgroup>}
            {starred.some(o=>o.species===other.species)&&<optgroup label="My sets">{starred.filter(o=>o.species===other.species).map(o=><option key={o.id} value={'saved:'+o.id}>★ {o.label}</option>)}</optgroup>}
            <option value="custom">Custom set</option></select></label>
          <label><span className="sr-only">Source</span><select value={source} title={sourceNames[source]} onChange={e=>{setSource(e.target.value);void loadFoe(other.species,e.target.value);}}>{Object.entries(sourceNames).map(([k])=><option key={k} value={k}>{sourceShort[k]}</option>)}</select></label></div>}
        note={loading?'Loading sets…':metaError?metaError:targetLabel&&foe.kind!=='spread'?targetLabel:meta?<>{sourceNames[meta.source]} · {meta.population} · {meta.period}{meta.sample?` · ${meta.sample}`:''} · {meta.url?.startsWith('http')?<a href={meta.url} target="_blank" rel="noreferrer">source ↗</a>:<a href="#data">data pool</a>}{other.moves?.length?' · moves are the most used':''}</>:'Species only until a set loads.'}
        context={context('foe',other,editFoe)} editor={<SetFields set={other} update={editFoe} dex={dex} form={otherC.species}/>} conditions={<BattleConditions set={other} update={editFoe}/>} editOpen={foe.kind==='custom'&&!targetLabel}/>;
  const swap=<button type="button" className="direction" onClick={()=>setDirection(outgoing?'incoming':'outgoing')} title="Swap who attacks"><span aria-hidden="true">↓</span>{formName((outgoing?ownC:otherC).species)} attacks {formName((outgoing?otherC:ownC).species)}<small>swap</small></button>;
  const axis=<div className="matchup-axis" key="axis">{tab==='Damage'?<>{swap}<div className="field-box"><div className="field-row"><span className="ctx-label">Field</span><label><span className="sr-only">Weather</span><select value={field.weather??''} onChange={e=>setField({...field,weather:e.target.value||undefined})}>{['','Sun','Rain','Sand','Snow','Harsh Sunshine','Heavy Rain','Strong Winds'].map(v=><option key={v} value={v}>{v?v:'No weather'}</option>)}</select></label><label><span className="sr-only">Terrain</span><select value={field.terrain??''} onChange={e=>setField({...field,terrain:e.target.value||undefined})}>{['','Electric','Grassy','Psychic','Misty'].map(v=><option key={v} value={v}>{v?`${v} Terrain`:'No terrain'}</option>)}</select></label></div>
      <div className="toggles field-flags">{FIELD_FLAGS.map(([k,l])=><Toggle key={k} on={!!field[k]} label={l} set={v=>setField({...field,[k]:v})}/>)}</div><p className="footnote">Abilities don't set weather or terrain here: choose them above. An Intimidate that's already happened is a −1 Atk boost on the attacker.</p></div></>
      :<div className="field-box"><div className="field-row"><span className="ctx-label">Field</span><div className="toggles"><Toggle on={trickRoom} label="Trick Room" set={setTrickRoom}/></div></div></div>}</div>;
  const footer=<div className="result-foot"><button className="primary" disabled={calculating||!result||!!saved||!targetLabel||!realSet} title={!realSet?'Benchmarks re-check against your current set: switch back to it to save':targetLabel?undefined:'Pick an opponent set first'} onClick={()=>void saveBenchmark()}>{saved?'Saved as benchmark ✓':'Save as benchmark'}</button>{tab==='Damage'&&<button onClick={askSpread}>{outgoing?'Find a spread that guarantees this KO':'Find a spread that survives this'} →</button>}{!realSet&&<span className="muted">Switch back to your current set to save a benchmark.</span>}</div>;
  const body=<div className="lab"><Tabs tabs={['Damage','Speed']} value={tab} onChange={setTab}/>
    {fromAsk&&<p className="from-ask" role="status"><img src="/favicon.svg" alt="" width={18} height={18}/>{fromAsk}</p>}
    <div className="matchup">{sideCard(order[0])}{axis}{sideCard(order[1])}</div>
    {error&&<p role="alert" className="error">{error}</p>}
    {result?.kind==='Damage'&&tab==='Damage'&&<div className={'lab-result'+(calculating?' busy':'')}><DamageViz result={result} name={formName((outgoing?otherC:ownC).species)} attackerName={formName((outgoing?ownC:otherC).species)} defender={(outgoing?otherC:ownC).species} fallback={(outgoing?other:own).species} art={data.art} move={move} attacker={(outgoing?ownC:otherC).species}/>
      <details><summary>Rolls, description and assumptions</summary><p className="lab-desc">{result.description}</p>{result.perHit&&<p className="muted">Per hit: {result.perHit.map((h:number[])=>`${h[0]}–${h.at(-1)}`).join(' + ')}</p>}<p className="mono">{result.rolls.join(', ')}</p>{result.assumptions.map((a:string,i:number)=><p key={i}>{a}</p>)}<pre>{JSON.stringify(result.versions,null,2)}</pre></details>{saved&&<Notice>{saved}</Notice>}{footer}</div>}
    {result?.kind==='Speed'&&tab==='Speed'&&<div className={'lab-result'+(calculating?' busy':'')}><SpeedRace a={{name:ownC.species,fallback:own.species,speed:result.a}} b={{name:otherC.species,fallback:other.species,speed:result.b}} first={result.first} trickRoom={trickRoom} art={data.art}/>
      <p className="footnote">{result.assumptions} Item and ability speed changes are entered as multipliers, not read from the set.</p>{saved&&<Notice>{saved}</Notice>}{footer}</div>}
    {calculating&&!result&&<p role="status" className="muted">Calculating…</p>}
    <datalist id="lab-moves">{dex?.moves.map((m:string)=><option key={m} value={m}/>)}</datalist><datalist id="lab-items">{dex?.items.map((s:string)=><option key={s} value={s}/>)}</datalist><datalist id="lab-abilities">{dex?.abilities.map((s:string)=><option key={s} value={s}/>)}</datalist></div>;
  return <section ref={panel} className="panel lab-inline" aria-label="Calc"><header className="panel-heading"><h2>Calc</h2></header>{body}</section>;
}
// One side of the matchup: render (the Mega when it's on), the set dropdown(s), a summary, what matters for its role,
// then the full set and its battle condition behind disclosures.
function Combatant({side,cardRef,role,set,art,mega,megaOn,setMega,species,picker,note,context,editor,conditions,editOpen}:{side:Side;cardRef:(el:HTMLElement|null)=>void;role:string;set:any;art:any;mega?:MegaForm;megaOn:boolean;setMega:(v:boolean)=>void;species?:ReactNode;picker:ReactNode;note?:ReactNode;context:ReactNode;editor:ReactNode;conditions:ReactNode;editOpen:boolean}){
  const shown=mega&&megaOn?mega.name:set.species;
  return <section ref={cardRef} className={'combatant is-'+side+(role.includes('attacking')?' attacking':role.includes('defending')?' defending':'')}>
    <div className="combatant-art"><Art name={shown} fallback={set.species} art={art}/>{mega&&<button type="button" className={'mega-switch'+(megaOn?' on':'')} aria-pressed={megaOn} onClick={()=>setMega(!megaOn)} title={megaOn?`Battling as ${formName(mega.name)}: switch off to use ${set.species}`:`Switch on to battle as ${formName(mega.name)}`}><span className="knob"/>Mega</button>}</div>
    <div className="combatant-main"><div className="combatant-head"><span className="eyebrow">{role}</span>{species??<h3>{formName(shown)}</h3>}<TypeBadges species={shown}/></div>
      {picker}
      <p className="combatant-sum"><ItemIcon item={set.item}/><span>{set.item||'No item'}</span><span>{mega&&megaOn?mega.ability:set.ability||'—'}</span><span>{set.nature}</span><span className="mono">{spLine(set)}</span></p>
      {note&&<p className="footnote">{note}</p>}
      {context}
      <details className="combatant-edit" open={editOpen}><summary>Edit set</summary>{editor}</details>{conditions}</div></section>;
}

// Damage: the defender's HP bar drains to the damage range (min–max shaded), with half and quarter marks, the verdict,
// and the 16 rolls. Every number is the calc result's own; the animation only sequences it.
function DamageViz({result,name,attackerName,defender,fallback,move,art}:{result:any;name:string;attackerName:string;attacker?:string;defender:string;fallback:string;move:string;art:any}){
  const max=result.defenderStats?.hp??0,cur=result.defaults?.defenderHP??max;const [lo,hi]=result.range as [number,number];
  const pct=(v:number)=>max?Math.max(0,Math.min(100,v/max*100)):0;const leftHi=pct(cur-hi),leftLo=pct(cur-lo),now=pct(cur);
  const rolls:number[]=result.rolls??[];const top=Math.max(...rolls,1),bottom=Math.min(...rolls,top);
  const [go,setGo]=useState(false);const k=rolls.join()+':'+cur+':'+max;useEffect(()=>{setGo(false);const t=setTimeout(()=>setGo(true),reduced()?0:120);return()=>clearTimeout(t);},[k]);
  const ko=result.koChanceOnHit;const phrase=String(result.description??'').split(' -- ')[1]??'';
  const verdict=ko>=1?'Guaranteed KO':ko>0?`${(ko*100).toFixed(1)}% chance to KO`:phrase?phrase[0].toUpperCase()+phrase.slice(1):'No KO from this HP';
  const tone=(leftHi>50?'ok':leftHi>20?'warn':'low');
  return <div className="dmg">
    <div className="dmg-head"><span className="eyebrow">{attackerName} · {move} → {name}</span><div className="lab-big"><b>{result.percentOfMaxHP.map((v:number)=>v.toFixed(1)).join('–')}%</b><span>{lo}–{hi} HP</span></div><span className={'verdict'+(ko>=1?' ko':ko>0?' maybe':'')}>{verdict}</span></div>
    <div className="dmg-target"><div className="dmg-art"><Art name={defender} fallback={fallback} art={art} small/></div><div className="grow">
      <div className="hp-head"><b>{name}</b><span>{go?`${Math.max(0,cur-hi)}–${Math.max(0,cur-lo)}`:cur} / {max} HP</span></div>
      <div className={'hp-track '+(go?tone:'ok')} role="img" aria-label={`${name} goes from ${cur} to ${Math.max(0,cur-hi)}–${Math.max(0,cur-lo)} of ${max} HP`}>
        <i className="hp-left" style={{width:(go?leftHi:now)+'%'}}/><i className="hp-band" style={{left:leftHi+'%',width:(go?leftLo-leftHi:0)+'%'}}/><i className="hp-lost" style={{left:(go?leftLo:now)+'%',width:(go?now-leftLo:0)+'%'}}/>
        <i className="hp-mark" style={{left:'50%'}}/><i className="hp-mark" style={{left:'25%'}}/></div>
      <div className="hp-scale"><span>0</span><span style={{left:'25%'}}>25%</span><span style={{left:'50%'}}>50%</span><span className="end">{max}</span></div></div></div>
    {rolls.length>1&&<div className="rolls" aria-label={`${rolls.length} damage rolls from ${lo} to ${hi}`}>{rolls.map((r,i)=><i key={i} className={r>=cur?'ko':''} title={`${r} HP`} style={{height:go?`${top===bottom?100:30+70*(r-bottom)/(top-bottom)}%`:'4%',transitionDelay:`${i*24}ms`}}/>)}<span className="rolls-label">{rolls.length} rolls</span></div>}
  </div>;
}

// Speed: a race. Each runner's pace comes from its effective Speed (reversed under Trick Room); whoever acts first,
// including by priority, reaches the line first.
function SpeedRace({a,b,first,trickRoom,art}:{a:{name:string;fallback:string;speed:number};b:{name:string;fallback:string;speed:number};first:'a'|'b'|'tie';trickRoom:boolean;art:any}){
  const [go,setGo]=useState(false);const k=`${a.name}${a.speed}-${b.name}${b.speed}-${trickRoom}-${first}`;
  useEffect(()=>{setGo(false);const t=setTimeout(()=>setGo(true),reduced()?0:80);return()=>clearTimeout(t);},[k]);
  // Distance covered when the leader crosses: proportional to Speed (inverted under Trick Room). Priority can put the
  // slower one first, so whoever acts first is always the one at the line.
  const fast=Math.max(a.speed,b.speed,1),slow=Math.max(1,Math.min(a.speed,b.speed));
  const reach=(s:number)=>trickRoom?slow/Math.max(1,s):Math.max(1,s)/fast;
  let da=reach(a.speed),db=reach(b.speed);if(first==='tie')da=db=1;else if(first==='a'){da=1;db=Math.min(db,.94);}else{db=1;da=Math.min(da,.94);}
  const lane=(side:'a'|'b',r:typeof a,d:number)=>{const wins=first===side||first==='tie';return <div className={'lane'+(wins?' wins':'')}>
    <div className="track"><span className="finish"/><span className="runner" style={{left:go?`calc((100% - 72px) * ${d.toFixed(3)})`:'0px',transitionDuration:go&&!reduced()?'1.6s':'0s'}}><Art name={r.name} fallback={r.fallback} art={art} small/></span></div>
    <div className="lane-stat"><b>{r.speed}</b><span>{formName(r.name)}</span>{go&&wins&&<em style={{animationDelay:reduced()?'0s':'1.5s'}}>{first==='tie'?'Tie':'1st'}</em>}</div></div>;};
  return <div className={'race'+(trickRoom?' tr':'')}><span className="eyebrow">{trickRoom?'Trick Room · slower moves first':'Speed · faster moves first'}</span>{lane('a',a,da)}{lane('b',b,db)}
    <p className="race-verdict">{first==='tie'?'Speed tie: a coin flip each turn.':`${formName(first==='a'?a.name:b.name)} acts first under these conditions.`}</p></div>;
}
function SetFields({set,update,dex,form}:{set:any;update:(s:any)=>void;dex:any;form:string}){const [final,setFinal]=useState<any>(null);const key=JSON.stringify({species:form,nature:set.nature,statPoints:set.statPoints});useEffect(()=>{let alive=true;api('/calculate',{kind:'stats',input:JSON.parse(key)}).then(s=>{if(alive)setFinal(s);}).catch(()=>{if(alive)setFinal(null);});return()=>{alive=false;};},[key]);return <div className="set-edit"><div className="lab-row"><label>Nature<select value={set.nature??'Serious'} onChange={e=>update({...set,nature:e.target.value})}>{(dex?.natures??[set.nature??'Serious']).map((s:string)=><option key={s}>{s}</option>)}</select></label><label>Ability<input list="lab-abilities" value={set.ability??''} onChange={e=>update({...set,ability:e.target.value})}/></label></div><label>Item<input list="lab-items" value={set.item??''} onChange={e=>update({...set,item:e.target.value})}/></label><SpEditBars set={set} form={form} final={final} update={update}/></div>;}
// Stat points as bars: base stat in emerald, points stacked on the end in gold, the change beside it, then the final stat.
function SpEditBars({set,form,final,update}:{set:any;form:string;final:any;update:(s:any)=>void}){
  const base=useDex([form],[]).base[form];const total=stats.reduce((n,k)=>n+(set.statPoints?.[k]??0),0);const w=(v:number)=>`${Math.min(100,100*v/220)}%`;
  return <div className="stat-bars sp-edit"><div className="stat-bars-head"><span className="muted">Stat points</span><b className={total>66?'error':''}>{total} / 66</b></div>{stats.map(k=>{const b=base?.[k]??0,sp=set.statPoints?.[k]??0;
    return <label key={k} className="stat-row"><span className="stat-name">{statLabel[k]}</span><span className="stat-bar"><span className="base" style={{width:w(b)}}/><span className="sp" style={{width:w(sp)}}/></span><span className="stat-base">{base?b:'—'}{sp>0&&<b className="stat-plus">+{sp}</b>}</span>
      <input type="number" min="0" max="32" aria-label={`${statLabel[k]} stat points`} value={sp} onChange={e=>update({...set,statPoints:{...set.statPoints,[k]:Math.max(0,Math.min(32,Number(e.target.value)||0))}})}/><output className="stat-final">{final?.[k]??'—'}</output></label>;})}</div>;
}
function BattleConditions({set,update,final}:{set:any;update:(s:any)=>void;final?:any}){return <details className="combatant-edit"><summary>HP, status and stat boosts</summary><label>Current exact HP (blank = full)<input type="number" min="1" max={final?.hp} value={set.curHP??''} onChange={e=>update({...set,curHP:e.target.value?Number(e.target.value):undefined})}/></label><label>Status<select value={set.status??''} onChange={e=>update({...set,status:e.target.value||undefined})}>{[['','Healthy'],['brn','Burn'],['par','Paralysis'],['psn','Poison'],['tox','Toxic'],['slp','Sleep'],['frz','Frozen']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><div className="sp-inputs">{stats.filter(k=>k!=='hp').map(k=><label key={k}>{statLabel[k]} boost<input type="number" min="-6" max="6" value={set.boosts?.[k]??0} onChange={e=>update({...set,boosts:{...set.boosts,[k]:Number(e.target.value)}})}/></label>)}</div><label>Ability activation<select value={set.abilityOn===undefined?'default':String(set.abilityOn)} onChange={e=>update({...set,abilityOn:e.target.value==='default'?undefined:e.target.value==='true'})}><option value="default">Calculator default</option><option value="true">Active</option><option value="false">Inactive / already accounted for</option></select></label><label>Allies fainted (Supreme Overlord)<input type="number" min="0" max="3" value={set.alliesFainted??''} onChange={e=>update({...set,alliesFainted:e.target.value?Number(e.target.value):undefined})}/></label></details>;}

// Inputs the calc needs for some moves: hit count for variable multi-hit moves, battle state for power-changing moves.
function MoveContext({move,dex,options,setOptions}:{move:string;dex:any;options:any;setOptions:(f:any)=>void}){
  const hits=dex?.multiHit?.[move];const ctx=dex?.contextMoves?.[move];if(!hits&&!ctx)return null;
  const setCtx=(v:any)=>setOptions((o:any)=>({...o,context:v===undefined?undefined:{[ctx.field]:v}}));const value=options.context?.[ctx?.field];
  return <div className="move-context">{hits&&<label>Hits<select value={options.hits??''} onChange={e=>setOptions((o:any)=>({...o,hits:e.target.value?Number(e.target.value):undefined}))}><option value="">Usual (3; 5 with Skill Link)</option>{Array.from({length:hits[1]-hits[0]+1},(_,i)=>hits[0]+i).map(n=><option key={n} value={n}>{n}</option>)}</select></label>}
    {ctx&&(ctx.max!==undefined?<label>{ctx.label}<input type="number" min="0" max={ctx.max} value={value??''} placeholder="0" onChange={e=>setCtx(e.target.value===''?undefined:Number(e.target.value))}/></label>
      :<label className="radio"><input type="checkbox" checked={!!value} onChange={e=>setCtx(e.target.checked||undefined)}/>{ctx.label}</label>)}</div>;
}
