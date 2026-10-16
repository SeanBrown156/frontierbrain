import {useRolling} from './fx.ts';
import {useState,useEffect,useLayoutEffect,useRef,type ReactNode} from 'react';
import type {BankEntry,SetRevision,PokemonSet} from '../shared/workbench.ts';
import {api,Tabs,Notice,Art,TypeBadges,ItemIcon,useDex,MegaOrb,type MegaForm,Button,Field,Toggle,Checkbox} from './ui.tsx';
import SpeciesPicker,{type SavedOption} from './ai/SpeciesPicker.tsx';
import {ItemPicker,MovePicker} from './ai/Pickers.tsx';
import {offer,useOffers} from './save-state.ts';
import {setFocusDetail} from './focus.ts';
import PartnerCard,{SaveChecklist} from './CalcPartners.tsx';
import {speedPairs,targetRows,type SaveRow} from '../shared/benchmarks.ts';
const stats=['hp','atk','def','spa','spd','spe'] as const;
const statLabel:Record<string,string>={hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'};
// Until a standard set loads, the target is species-only; nothing is presented as a typical spread.
const pendingTarget:PokemonSet={species:'Incineroar',nature:'Serious',ability:'Intimidate',item:'',statPoints:{},moves:[]};
const spLine=(s:any)=>stats.map(k=>s.statPoints?.[k]??0).join('/');
const reduced=()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
// Standard opponent sets come from one labelled source at a time, never blended. The picker offers the sources that
// have real spreads (PokéBase tournaments, PokéBase ladder, VGCPastes, Smogon); the pool and Limitless stay labelled
// here because the assistant and saved benchmarks can still carry them.
const sourceNames:Record<string,string>={pool:'Frontier Brain pool · deduplicated teams',pokebase:'PokéBase · Champions M-C tournament teams (spreads from teams that placed)',vgcpastes:'VGCPastes · exact spreads players shared',limitless:'Limitless · official Day 2 team lists (no spreads)','pokebase-ladder':'PokéBase · Champions in-game ranked ladder, this season',smogon:'Smogon · Showdown ladder (fallback, not Champions)'};
const sourceShort:Record<string,string>={pool:'Pool',pokebase:'PokéBase · tournaments',vgcpastes:'VGCPastes',limitless:'Limitless','pokebase-ladder':'PokéBase · ladder',smogon:'Smogon'};
const pickerSources=['pokebase','pokebase-ladder','vgcpastes','smogon'];
// When a source has nothing for a Pokémon, try the next one and say so in the picker.
const nextSource:Record<string,string>={pokebase:'pokebase-ladder','pokebase-ladder':'vgcpastes',vgcpastes:'smogon'};
// Where each effect lives. Side effects belong to a Pokémon's side (they follow it when you swap who attacks);
// a card only shows the ones that matter for its current role. Field effects apply to everyone.
const ATTACK_SIDE=[['isHelpingHand','Helping Hand'],['isBattery','Battery'],['isPowerSpot','Power Spot'],['isSteelySpirit','Steely Spirit']] as const;
const DEFEND_SIDE=[['isReflect','Reflect'],['isLightScreen','Light Screen'],['isAuroraVeil','Aurora Veil'],['isFriendGuard','Friend Guard'],['isProtected','Protect']] as const;
const FIELD_FLAGS=[['isGravity','Gravity'],['isMagicRoom','Magic Room'],['isWonderRoom','Wonder Room'],['isBeadsOfRuin','Beads of Ruin'],['isSwordOfRuin','Sword of Ruin'],['isTabletsOfRuin','Tablets of Ruin'],['isVesselOfRuin','Vessel of Ruin']] as const;
const BATTLE_KEYS=['curHP','status','boosts','abilityOn','alliesFainted','stage','multiplier','priority','tailwind','paralyzed','move','quickClaw','itemUsed','intimidated'] as const;
type Pick={kind:'current'}|{kind:'saved';id:string;label:string;set:PokemonSet}|{kind:'spread';index:number}|{kind:'custom';set?:PokemonSet};
type Side='mine'|'foe';
const megaName=(name:string)=>/-Mega(-[A-Z])?$/.test(name);const baseName=(name:string)=>name.replace(/-Mega(-[A-Z])?$/,'');
const REGIONS:Record<string,string>={Hisui:'Hisuian',Alola:'Alolan',Galar:'Galarian',Paldea:'Paldean'};
export const formName=(name:string)=>name.replace(/^(.*)-Mega(?:-([A-Z]))?$/,(_,b:string,x?:string)=>`Mega ${b}${x?' '+x:''}`).replace(/^(.*)-(Hisui|Alola|Galar|Paldea)$/,(_,b:string,r:string)=>`${REGIONS[r]} ${b}`);
const onlyTrue=(f:Record<string,boolean>)=>Object.fromEntries(Object.entries(f).filter(([,v])=>v));
// A calc flag: a Toggle with its label, reporting the new value.
function Flag({on,label,set}:{on:boolean;label:string;set:(v:boolean)=>void}){return <Toggle on={on} onChange={()=>set(!on)}>{label}</Toggle>;}

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
  const [source,setSource]=useState('pokebase'),[meta,setMeta]=useState<any>(null),[metaError,setMetaError]=useState(''),[loading,setLoading]=useState(false);
  const [other,setOther]=useState<any>(structuredClone(pendingTarget)),[foe,setFoe]=useState<Pick>({kind:'custom'}),[targetLabel,setTargetLabel]=useState('');
  const [tab,setTab]=useState('Damage'),[direction,setDirection]=useState<'outgoing'|'incoming'>('outgoing'),[move,setMove]=useState(draftSet.moves?.find(m=>m!=='Protect')??draftSet.moves?.[0]??'Tackle'),[options,setOptions]=useState<any>({}),[result,setResult]=useState<any>(null),[error,setError]=useState(''),[calculating,setCalculating]=useState(false),[dex,setDex]=useState<any>(null),[trickRoom,setTrickRoom]=useState(false),[saved,setSaved]=useState(''),[fromAsk,setFromAsk]=useState('');
  const [field,setField]=useState<any>({gameType:'Doubles'}),[flags,setFlags]=useState<Record<Side,Record<string,boolean>>>({mine:{},foe:{}}),[megaOn,setMegaOn]=useState<Record<Side,boolean>>({mine:true,foe:true});
  // Four-way speed order: each side's second Pokémon, whether each is shown as its Mega, and Tailwind per side.
  const [four,setFour]=useState(false),[partner,setPartner]=useState<Record<Side,any>>({mine:null,foe:null}),[pMega,setPMega]=useState<Record<Side,boolean>>({mine:true,foe:true}),[sideTw,setSideTw]=useState<Record<Side,boolean>>({mine:false,foe:false});
  // Doubles damage: a spread move hitting one target instead of both, or a second target for the same spread move.
  const [spreadOne,setSpreadOne]=useState(false),[secondTgt,setSecondTgt]=useState(false);
  const pickSpread=(m:any,i:number)=>{const s=m.spreads[i];if(!s)return;const nature=s.nature??m.natures[0]?.name??'Serious';
    setOther((o:any)=>({...o,species:m.species,nature,statPoints:s.statPoints,ability:m.abilities[0]?.name,item:m.items[0]?.name,moves:(m.moves??[]).slice(0,4).map((x:any)=>x.name),boosts:undefined}));setFoe({kind:'spread',index:i});setMegaOn(x=>({...x,foe:true}));
    setTargetLabel(`${sourceNames[m.source]} · ${m.species} ${nature} ${Object.values(s.statPoints).join('/')} · spread ${s.percent}%${s.nature?'':`, nature ${m.natures[0]?.percent??'?'}%`} · ${m.items[0]?.name??'no item'} · ${m.period}`);};
  // Choosing a species loads its sets from the chosen source and uses the most common one (PokéBase tournaments first, the next source if it has none).
  const loadFoe=async(species:string,src:string,fallback=false)=>{setLoading(true);setMetaError('');
    try{const m=await api(`/meta-sets?species=${encodeURIComponent(species)}&source=${src}`);if(!m.spreads.length&&fallback&&nextSource[src]){setSource(nextSource[src]);return loadFoe(species,nextSource[src],true);}
      setMeta(m);if(m.spreads.length)pickSpread(m,0);else{setOther((o:any)=>({...pendingTarget,...o,species}));setFoe({kind:'custom'});setTargetLabel('');}}
    catch(e){setMeta(null);setMetaError((e as Error).message);setOther((o:any)=>({...o,species}));setFoe({kind:'custom'});setTargetLabel('');}finally{setLoading(false);}};
  useEffect(()=>{void loadFoe(other.species,'pokebase',true);},[]);
  const pickFoeSaved=(o:SavedOption)=>{setOther((x:any)=>({...x,...structuredClone(o.value),boosts:undefined}));setFoe({kind:'saved',id:o.id,label:o.label,set:o.value});setTargetLabel(`My sets · ${o.label} · ${o.species} ${o.value.nature} ${spLine(o.value)}${o.value.item?` · ${o.value.item}`:''}`);};
  const editFoe=(s:any)=>{setOther(s);const {set}=splitBattle(s),{set:was}=splitBattle(other);if(foe.kind!=='custom'&&JSON.stringify(set)!==JSON.stringify(was)){setFoe({kind:'custom'});setTargetLabel(t=>t?`${t} (edited)`:'');}};
  useEffect(()=>{let alive=true;api('/dex?species='+encodeURIComponent(draftSet.species)).then(d=>{if(alive)setDex(d);}).catch(e=>setError(e.message));return()=>{alive=false;};},[draftSet.species]);
  // Mega forms: a holder of its Mega Stone battles as the Mega by default.
  const dx=useDex([mineBase.species,other.species,...[partner.mine,partner.foe].filter(Boolean).map((p:any)=>p.species)],[]);
  const megaFor=(s:any)=>(dx.megas[s.species]??[]).find((m:MegaForm)=>m.item===s.item);
  const mineMega=megaFor(own),foeMega=megaFor(other);
  const asForm=(s:any,m:MegaForm|undefined,on:boolean)=>{const {itemUsed,intimidated,...x}=s;const f=m&&on?{...x,species:m.name,ability:m.ability}:x;return itemUsed?{...f,item:''}:f;};
  const ownC=asForm(own,mineMega,megaOn.mine),otherC=asForm(other,foeMega,megaOn.foe);
  const partnerMega=(s:Side)=>partner[s]?megaFor(partner[s]):undefined;const partnerC=(s:Side)=>partner[s]?asForm(partner[s],partnerMega(s),pMega[s]):null;
  const outgoing=direction==='outgoing';const attackerSide:Side=outgoing?'mine':'foe',defenderSide:Side=outgoing?'foe':'mine';
  const attackerSet=outgoing?mineBase:other;
  // Attack with the attacker's first damaging move whenever the attacker (or its moves) change.
  const status=new Set<string>(dex?.statusMoves??[]);const attackerMoves=(attackerSet.moves??[]).filter((m:string)=>m&&!status.has(m));
  useEffect(()=>{if(!attackerMoves.includes(move)&&attackerMoves.length)setMove(attackerMoves[0]);},[direction,JSON.stringify(attackerSet.moves),dex]);
  const fieldInput={...field,attackerSide:onlyTrue(flags[attackerSide]),defenderSide:onlyTrue(flags[defenderSide])};
  // Expanding Force only hits both foes in Psychic Terrain; that one cannot be calculated as hitting a single target.
  const expandingSpread=move==='Expanding Force'&&field.terrain==='Psychic';
  const isSpread=!!dex?.spreadMoves?.includes(move)||expandingSpread;
  const secTgt=tab==='Damage'&&outgoing&&secondTgt&&isSpread&&!spreadOne?partnerC(defenderSide):null;
  const damageInput={attacker:outgoing?ownC:otherC,defender:outgoing?otherC:ownC,move,field:fieldInput,moveOptions:{...options,...isSpread&&spreadOne?{spread:false}:{}},
    ...secTgt?{secondDefender:secTgt}:{}};
  const speedField={weather:field.weather,terrain:field.terrain};
  const fourWay=tab==='Speed'&&four;
  const roster=[{...ownC,side:'mine'},partnerC('mine')&&{...partnerC('mine'),side:'mine'},{...otherC,side:'foe'},partnerC('foe')&&{...partnerC('foe'),side:'foe'}].filter(Boolean) as any[];
  const speedInput=fourWay?{pokemon:roster,trickRoom,field:speedField,tailwind:sideTw}:{a:ownC,b:otherC,trickRoom,field:speedField};
  const key=JSON.stringify(tab==='Speed'?speedInput:damageInput);
  useEffect(()=>{if(!dex){setCalculating(false);return;}let alive=true;setCalculating(true);const timer=setTimeout(()=>{api('/calculate',{kind:tab==='Speed'?(fourWay?'speed-order':'speed'):'damage',input:JSON.parse(key)}).then(r=>{if(alive){setResult({...r,kind:tab});setError('');}}).catch(e=>{if(alive){setResult(null);setError(e.message);}}).finally(()=>{if(alive)setCalculating(false);});},250);return()=>{alive=false;clearTimeout(timer);};},[key,tab,!!dex]);
  useEffect(()=>setSaved(''),[key,tab]);
  // The calc on screen is part of what an assistant sees (inputs only); leaving the page clears it.
  useEffect(()=>{setFocusDetail({calc:{kind:tab==='Speed'?'speed':'damage',input:JSON.parse(key)}});},[key,tab]);useEffect(()=>()=>setFocusDetail({calc:undefined}),[]);
  // The other side of the crit question: if the main result isn't a crit, also show the crit range (and vice versa).
  const [alt,setAlt]=useState<any>(null);useEffect(()=>{setAlt(null);if(tab!=='Damage'||!dex)return;let alive=true;const t=setTimeout(()=>{api('/calculate',{kind:'damage',input:{...damageInput,moveOptions:{...options,isCrit:!options.isCrit}}}).then(r=>{if(alive)setAlt(r);}).catch(()=>{});},400);return()=>{alive=false;clearTimeout(t);};},[key,tab,!!dex]);
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
      takeSet(out?input.attacker:input.defender,'mine');takeSet(out?input.defender:input.attacker,'foe');setDirection(out?'outgoing':'incoming');setMove(input.move);const {spread,...opts}=input.moveOptions??{};setOptions(opts);setSpreadOne(spread===false);
      const attS:Side=out?'mine':'foe',defS:Side=out?'foe':'mine';const asPartner=(x:any,s:Side,extra?:any)=>{const mega=megaName(x.species);const {b:bb,set:ss}=splitBattle(x);setPartner(p=>({...p,[s]:{...ss,species:baseName(ss.species),...bb,...extra}}));setPMega(m=>({...m,[s]:mega}));};
      setSecondTgt(false);
      if(input.secondDefender){asPartner(input.secondDefender,defS);setSecondTgt(true);}
      const {attackerSide:aS={},defenderSide:dS={},...global}=input.field??{};setField({gameType:'Doubles',...global});
      setFlags({mine:out?aS:dS,foe:out?dS:aS});setTab('Damage');}
    const foeSet=p.kind==='speed'?(isMine(input.a)?input.b:input.a):(isMine(input.attacker)?input.defender:input.attacker);
    setTargetLabel(`${p.from??'Ask Frontier Brain'} · ${foeSet?.species} ${foeSet?.nature??''} ${spLine(foeSet??{})}${foeSet?.item?` · ${foeSet.item}`:''} · assumed by the assistant`);
    setFromAsk(`Loaded from ${p.from??'Ask Frontier Brain'}`);setTimeout(()=>panel.current?.scrollIntoView({behavior:reduced()?'auto':'smooth',block:'start'}),50);return true;});
  useEffect(()=>{if(!fromAsk)return;const t=setTimeout(()=>setFromAsk(''),6000);return()=>clearTimeout(t);},[fromAsk]);
  // Benchmarks re-check against your real set, so they're saved only from it (not from a theoretical or other saved set).
  const realSet=mine.kind==='current';
  const saveBenchmark=async()=>{try{const kind=tab==='Speed'?'speed':'damage';await mutate({type:'benchmark-save',bankId:entry.id,revisionId:revision.id,kind,side:kind==='speed'?'a':outgoing?'attacker':'defender',input:kind==='speed'?speedInput:damageInput,context:targetLabel,sources:[]});setSaved('Saved to this Pokémon\'s benchmarks.');}catch(e){setError((e as Error).message);}};
  // Multi-Pokémon results save as independent benchmarks: a speed benchmark per pair, a damage benchmark per target.
  const rows:SaveRow[]=tab==='Speed'?(result?.order?speedPairs(roster,result,{trickRoom,field:speedField,tailwind:sideTw,own:0}):[]):(result?.secondTarget&&damageInput.secondDefender?targetRows(damageInput,{outgoing}):[]);
  const [picked,setPicked]=useState<Record<string,boolean>>({});useEffect(()=>setPicked({}),[rows.map(r=>r.title).join('|')]);
  const saveRows=async()=>{try{let n=0;for(const r of rows)if(r.savable&&(picked[r.key]??r.defaultOn)){await mutate({type:'benchmark-save',bankId:entry.id,revisionId:revision.id,kind:r.kind,side:r.side,input:r.input,origin:r.origin,context:targetLabel,sources:[]});n++;}setSaved(`Saved ${n} benchmark${n===1?'':'s'}`);}catch(e){setError((e as Error).message);}};
  const checklist=<SaveChecklist rows={rows} picked={picked} setPicked={setPicked} disabled={calculating||!realSet||!targetLabel} reason={!realSet?'Benchmarks re-check against your current set: switch back to it to save':!targetLabel?'Pick an opponent set first':undefined} onSave={()=>void saveRows()} done={saved}/>;
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
  const context=(side:Side,s:any,update:(x:any)=>void)=>{const base=side==='mine'?mineBase:other;const moves:string[]=(base.moves??[]).filter(Boolean);const itemId=String(s.item??'').toLowerCase();const abilityName=side==='mine'?ownC.ability:otherC.ability;
    const used=<Flag on={!!s.itemUsed} label={s.item?`${s.item} used up`:'Item used up'} set={v=>update({...s,itemUsed:v})}/>;
    return tab==='Speed'?<div className="ctx">
      <span className="ctx-label">Move this turn</span><div className="move-chips"><Toggle on={!s.move} onChange={()=>update({...s,move:undefined})}>Any (no priority)</Toggle>{moves.map(m=><Toggle key={m} on={s.move===m} onChange={()=>update({...s,move:m})}>{m}</Toggle>)}</div>
      <div className="lab-row"><Field label="Speed stage"><input type="number" min="-6" max="6" value={s.stage??0} onChange={e=>update({...s,stage:Number(e.target.value)})}/></Field><Field title="Anything the calculator doesn't already include" label="Extra multiplier"><input type="number" min="0.1" step="0.1" value={s.multiplier??1} onChange={e=>update({...s,multiplier:Number(e.target.value)})}/></Field><Field title="Leave blank to work it out from the move and ability" label="Priority"><input type="number" min="-7" max="7" placeholder="Auto" value={s.priority??''} onChange={e=>update({...s,priority:e.target.value===''?undefined:Number(e.target.value)})}/></Field></div>
      <div className="toggles">{!four&&<Flag on={!!s.tailwind} label="Tailwind" set={v=>update({...s,tailwind:v})}/>}<Flag on={!!s.paralyzed} label="Paralysed" set={v=>update({...s,paralyzed:v})}/>
        {/unburden/i.test(abilityName??'')&&<Flag on={!!s.abilityOn} label="Unburden active" set={v=>update({...s,abilityOn:v||undefined})}/>}
        {(itemId==='quick claw'||itemId==='custap berry')&&<Flag on={!!s.quickClaw} label={`${s.item} activates`} set={v=>update({...s,quickClaw:v})}/>}{s.item&&used}</div></div>
    :side===attackerSide?<div className="ctx"><span className="ctx-label">Move</span>
      {attackerMoves.length>0&&<div className="move-chips">{attackerMoves.map((m:string)=><Toggle key={m} on={m===move} onChange={()=>{setMove(m);setOptions(({hits,context,...o}:any)=>o);}}>{m}</Toggle>)}</div>}
      <div className="move-input"><MovePicker label="Another move" dex={dex} value={attackerMoves.includes(move)?'':move} onChange={v=>{setMove(v);setOptions(({hits,context,...o}:any)=>o);}}/></div>
      <MoveContext move={move} dex={dex} options={options} setOptions={setOptions}/>
      {isSpread&&!expandingSpread&&<><span className="ctx-label">Targets</span><div className="toggles"><Flag on={!spreadOne} label="Hits both targets (×0.75)" set={()=>setSpreadOne(false)}/><Flag on={spreadOne} label="Hits one target" set={()=>setSpreadOne(true)}/></div></>}
      <span className="ctx-label">Boosting this attack</span><div className="toggles">{ATTACK_SIDE.map(([k,l])=><Flag key={k} on={!!flags[side][k]} label={l} set={v=>setFlag(side,k,v)}/>)}<Flag on={!!options.isCrit} label="Critical hit" set={v=>setOptions({...options,isCrit:v})}/></div>
      <span className="ctx-label">Already happened</span><div className="toggles"><Flag on={(s.boosts?.atk??0)<0&&s.intimidated} label="Intimidated (−1 Atk)" set={v=>update({...s,intimidated:v,boosts:{...s.boosts,atk:(s.boosts?.atk??0)+(v?-1:1)}})}/>{s.item&&used}</div></div>
    :<div className="ctx"><span className="ctx-label">Protecting this Pokémon</span><div className="toggles">{DEFEND_SIDE.map(([k,l])=><Flag key={k} on={!!flags[side][k]} label={l} set={v=>setFlag(side,k,v)}/>)}</div>{s.item&&<><span className="ctx-label">Already happened</span><div className="toggles">{used}</div></>}</div>;};
  const sideCard=(side:Side)=>side==='mine'
    ?<Combatant key="mine" side="mine" cardRef={el=>{cards.current.mine=el;}} role={role('mine')} set={own} art={data.art} mega={mineMega} megaOn={megaOn.mine} setMega={v=>setMegaOn(x=>({...x,mine:v}))}
        picker={<Field className="combatant-pick" label={<span className="sr-only">Your set</span>}><select value={mineValue} onChange={e=>{const v=e.target.value;if(v==='current')setMine({kind:'current'});else if(v==='custom')setMine({kind:'custom',set:structuredClone(mineBase)});else{const o=mySaved.find(x=>'saved:'+x.id===v);if(o)setMine({kind:'saved',id:o.id,label:o.label,set:o.value});}}}>
          <option value="current">Current set</option>{mySaved.length>0&&<optgroup label="My sets">{mySaved.map(o=><option key={o.id} value={'saved:'+o.id}>★ {o.label}</option>)}</optgroup>}<option value="custom">{mine.kind==='custom'?'Custom set':'Try a custom set…'}</option></select></Field>}
        note={mine.kind==='saved'?`My sets · ${mine.label}`:''}
        context={context('mine',own,setOwn)} editor={<SetFields set={own} update={setOwn} dex={dex} form={ownC.species}/>} conditions={<BattleConditions set={own} update={setOwn}/>} editOpen={mine.kind==='custom'}/>
    :<Combatant key="foe" side="foe" cardRef={el=>{cards.current.foe=el;}} role={role('foe')} set={other} art={data.art} mega={foeMega} megaOn={megaOn.foe} setMega={v=>setMegaOn(x=>({...x,foe:v}))}
        species={<SpeciesPicker label="Opponent species" value={other.species} saved={starred} onPick={sp=>void loadFoe(sp,source)} onPickSaved={pickFoeSaved}/>}
        picker={<div className="combatant-pick two"><Field label={<span className="sr-only">Opponent set</span>}><select value={foeValue} disabled={loading} onChange={e=>{const v=e.target.value;if(v.startsWith('spread:'))pickSpread(meta,Number(v.slice(7)));else if(v.startsWith('saved:')){const o=starred.find(x=>'saved:'+x.id===v);if(o)pickFoeSaved(o);}else setFoe({kind:'custom'});}}>
            {meta?.spreads?.length>0&&<optgroup label={`Most used · ${sourceShort[meta.source]??meta.source}`}>{meta.spreads.slice(0,8).map((sp:any,i:number)=><option key={i} value={'spread:'+i}>{sp.nature?sp.nature+' ':''}{Object.values(sp.statPoints).join('/')} · {sp.percent}%</option>)}</optgroup>}
            {starred.some(o=>o.species===other.species)&&<optgroup label="My sets">{starred.filter(o=>o.species===other.species).map(o=><option key={o.id} value={'saved:'+o.id}>★ {o.label}</option>)}</optgroup>}
            <option value="custom">Custom set</option></select></Field>
          <Field label={<span className="sr-only">Source</span>}><select value={source} title={sourceNames[source]} onChange={e=>{setSource(e.target.value);void loadFoe(other.species,e.target.value);}}>{[...new Set([...pickerSources,source])].map(k=><option key={k} value={k}>{sourceShort[k]}</option>)}</select></Field></div>}
        note={loading?'Loading sets…':metaError?metaError:foe.kind==='spread'&&meta?.source!=='pool'&&meta?.url?.startsWith('http')?<a href={meta.url} target="_blank" rel="noreferrer" title={`${sourceNames[meta.source]} · ${meta.period}`}>source ↗</a>:''}
        context={context('foe',other,editFoe)} editor={<SetFields set={other} update={editFoe} dex={dex} form={otherC.species}/>} conditions={<BattleConditions set={other} update={editFoe}/>} editOpen={foe.kind==='custom'&&!targetLabel}/>;
  const swap=<Button className="direction" type="button" onClick={()=>setDirection(outgoing?'incoming':'outgoing')} title="Swap who attacks"><span aria-hidden="true">↓</span>{formName((outgoing?ownC:otherC).species)} attacks {formName((outgoing?otherC:ownC).species)}<small>swap</small></Button>;
  const axis=<div className="matchup-axis" key="axis">{tab==='Damage'?<>{swap}<div className="field-box"><div className="field-row"><span className="ctx-label">Field</span><Field label={<span className="sr-only">Weather</span>}><select value={field.weather??''} onChange={e=>setField({...field,weather:e.target.value||undefined})}>{['','Sun','Rain','Sand','Snow','Harsh Sunshine','Heavy Rain','Strong Winds'].map(v=><option key={v} value={v}>{v?v:'No weather'}</option>)}</select></Field><Field label={<span className="sr-only">Terrain</span>}><select value={field.terrain??''} onChange={e=>setField({...field,terrain:e.target.value||undefined})}>{['','Electric','Grassy','Psychic','Misty'].map(v=><option key={v} value={v}>{v?`${v} Terrain`:'No terrain'}</option>)}</select></Field></div>
      <div className="toggles field-flags">{FIELD_FLAGS.map(([k,l])=><Flag key={k} on={!!field[k]} label={l} set={v=>setField({...field,[k]:v})}/>)}</div></div></>
      :<div className="field-box"><div className="field-row"><span className="ctx-label">Field</span><Field label={<span className="sr-only">Weather</span>}><select value={field.weather??''} onChange={e=>setField({...field,weather:e.target.value||undefined})}>{['','Sun','Rain','Sand','Snow','Harsh Sunshine','Heavy Rain'].map(v=><option key={v} value={v}>{v?v:'No weather'}</option>)}</select></Field><Field label={<span className="sr-only">Terrain</span>}><select value={field.terrain??''} onChange={e=>setField({...field,terrain:e.target.value||undefined})}>{['','Electric','Grassy','Psychic','Misty'].map(v=><option key={v} value={v}>{v?`${v} Terrain`:'No terrain'}</option>)}</select></Field><div className="toggles"><Flag on={trickRoom} label="Trick Room" set={setTrickRoom}/><Flag on={four} label="Four-way order" set={setFour}/>{four&&<><Flag on={sideTw.mine} label="Your Tailwind" set={v=>setSideTw(t=>({...t,mine:v}))}/><Flag on={sideTw.foe} label="Their Tailwind" set={v=>setSideTw(t=>({...t,foe:v}))}/></>}</div></div></div>}</div>;
  const footer=<div className="result-foot">{rows.length>0?checklist:<Button variant="primary" disabled={calculating||!result||!!saved||!targetLabel||!realSet} title={!realSet?'Benchmarks re-check against your current set: switch back to it to save':targetLabel?undefined:'Pick an opponent set first'} onClick={()=>void saveBenchmark()}>{saved?'Saved as benchmark ✓':'Save as benchmark'}</Button>}{tab==='Damage'&&<Button onClick={askSpread}>{outgoing?'Find a spread that guarantees this KO':'Find a spread that survives this'} →</Button>}</div>;
  const body=<div className="lab"><Tabs block tabs={['Damage','Speed']} value={tab} onChange={setTab}/>
    {fromAsk&&<p className="from-ask" role="status"><img src="/brand/icon-64.png" alt="" width={18} height={18}/>{fromAsk}</p>}
    <div className="matchup">{sideCard(order[0])}{axis}{sideCard(order[1])}</div>
    {tab==='Damage'&&outgoing&&<div className="doubles"><div className="toggles">
      <Toggle on={secondTgt} disabled={!isSpread} title={isSpread?undefined:'Only spread moves hit a second target: Rock Slide, Heat Wave, or Expanding Force in Psychic Terrain'} onChange={()=>setSecondTgt(!secondTgt)}>+ Second target</Toggle></div>
      {secondTgt&&spreadOne&&<p className="footnote">The move hits one target, so no second target is hit. Switch to “Hits both targets” to see it.</p>}
      {secondTgt&&<div className="partners"><PartnerCard key={'tgt'+defenderSide} role="target" side={defenderSide} set={partner[defenderSide]} setSet={v=>setPartner(p=>({...p,[defenderSide]:v}))} saved={starred} art={data.art} mega={partnerMega(defenderSide)} megaOn={pMega[defenderSide]} setMega={v=>setPMega(m=>({...m,[defenderSide]:v}))} formName={formName} dex={dex}
          editor={partner[defenderSide]&&<SetFields set={partner[defenderSide]} update={(x:any)=>setPartner(p=>({...p,[defenderSide]:x}))} dex={dex} form={partnerC(defenderSide)?.species??partner[defenderSide].species}/>}/></div>}</div>}
    {fourWay&&<div className="partners">{(['mine','foe'] as Side[]).map(s=><PartnerCard key={s} side={s} set={partner[s]} setSet={v=>setPartner(p=>({...p,[s]:v}))} saved={starred} art={data.art} mega={partnerMega(s)} megaOn={pMega[s]} setMega={v=>setPMega(m=>({...m,[s]:v}))} formName={formName} dex={dex}/>)}</div>}
    {error&&<p role="alert" className="error">{error}</p>}
    {result?.kind==='Damage'&&tab==='Damage'&&<div className={'lab-result'+(calculating?' busy':'')}><DamageViz result={result} name={formName((outgoing?otherC:ownC).species)} attackerName={formName((outgoing?ownC:otherC).species)} defender={(outgoing?otherC:ownC).species} fallback={(outgoing?other:own).species} art={data.art} move={move} attacker={(outgoing?ownC:otherC).species}/>
      {alt&&<p className="crit-alt"><span className="ctx-label">{options.isCrit?'Without a crit':'If it crits'}</span><b>{alt.percentOfMaxHP.map((v:number)=>v.toFixed(1)).join('–')}%</b><span className="muted">{alt.range.join('–')} HP{alt.koChanceOnHit>0?` · ${(alt.koChanceOnHit*100).toFixed(1)}% to KO`:''}</span></p>}{result.secondTarget&&secTgt&&<DamageViz result={result.secondTarget} name={formName(secTgt.species)} attackerName={formName((outgoing?ownC:otherC).species)} defender={secTgt.species} fallback={baseName(secTgt.species)} art={data.art} move={move}/>}
      <details><summary>Rolls, description and assumptions</summary><p className="lab-desc">{result.description}</p>{result.perHit&&<p className="muted">Per hit: {result.perHit.map((h:number[])=>`${h[0]}–${h.at(-1)}`).join(' + ')}</p>}<p className="mono">{result.rolls.join(', ')}</p>{result.assumptions.map((a:string,i:number)=><p key={i}>{a}</p>)}{result.secondTarget?.assumptions?.map((a:string,i:number)=><p key={'t'+i}>{a}</p>)}{result.combined&&<p>{result.combined.assumptions}</p>}<pre>{JSON.stringify(result.versions,null,2)}</pre></details>{saved&&<Notice>{saved}</Notice>}{footer}</div>}
    {result?.kind==='Speed'&&tab==='Speed'&&result.order&&<div className={'lab-result'+(calculating?' busy':'')}><SpeedRace trickRoom={trickRoom} art={data.art} watch={result.watch} ties={result.ties}
      runners={result.order.map((o:any)=>{const m=roster[o.index]??{species:o.species};return {name:m.species,fallback:baseName(m.species),speed:o.speed,side:o.side,move:o.move,priority:o.priority,rank:o.rank,tied:o.tied,decidedBy:o.decidedBy};})}/>
      {saved&&<Notice>{saved}</Notice>}<div className="result-foot">{checklist}</div></div>}
    {result?.kind==='Speed'&&tab==='Speed'&&!result.order&&<div className={'lab-result'+(calculating?' busy':'')}><SpeedRace a={{name:ownC.species,fallback:own.species,speed:result.a}} b={{name:otherC.species,fallback:other.species,speed:result.b}} first={result.first} trickRoom={trickRoom} art={data.art} decidedBy={result.decidedBy}/>
      {saved&&<Notice>{saved}</Notice>}{footer}</div>}
    {calculating&&!result&&<p role="status" className="muted">Calculating…</p>}
    <datalist id="lab-moves">{dex?.moves.map((m:string)=><option key={m} value={m}/>)}</datalist><datalist id="lab-items">{dex?.items.map((s:string)=><option key={s} value={s}/>)}</datalist><datalist id="lab-abilities">{dex?.abilities.map((s:string)=><option key={s} value={s}/>)}</datalist></div>;
  return <section ref={panel} className="panel lab-inline" aria-label="Calc"><header className="panel-heading"><h2>Calc</h2></header>{body}</section>;
}
// One side of the matchup: render (the Mega when it's on), the set dropdown(s), a summary, what matters for its role,
// then the full set and its battle condition behind disclosures.
function Combatant({side,cardRef,role,set,art,mega,megaOn,setMega,species,picker,note,context,editor,conditions,editOpen}:{side:Side;cardRef:(el:HTMLElement|null)=>void;role:string;set:any;art:any;mega?:MegaForm;megaOn:boolean;setMega:(v:boolean)=>void;species?:ReactNode;picker:ReactNode;note?:ReactNode;context:ReactNode;editor:ReactNode;conditions:ReactNode;editOpen:boolean}){
  const shown=mega&&megaOn?mega.name:set.species;
  return <section ref={cardRef} className={'combatant is-'+side+(role.includes('attacking')?' attacking':role.includes('defending')?' defending':'')}>
    <div className="combatant-art"><Art name={shown} fallback={set.species} art={art}/></div>
    <div className="combatant-main"><div className="combatant-head"><span className="eyebrow">{role}</span><span className="name-row">{species??<h3>{formName(shown)}</h3>}{mega&&<Toggle variant="mega" on={megaOn} onChange={setMega} title={megaOn?`Battling as ${formName(mega.name)}: switch off to use ${set.species}`:`Switch on to battle as ${formName(mega.name)}`}><MegaOrb size={14}/>Mega</Toggle>}</span><TypeBadges species={shown}/></div>
      {picker}
      <p className="combatant-sum"><ItemIcon item={set.item}/><span>{set.item||'No item'}</span><span>{mega&&megaOn?mega.ability:set.ability||'—'}</span><span>{set.nature}</span><span className="mono">{spLine(set)}</span></p>
      {note&&<p className="footnote">{note}</p>}
      {context}
      <details className="combatant-edit" open={editOpen}><summary>Edit set</summary>{editor}</details>{conditions}</div></section>;
}

// Damage: the defender's HP bar drains to the damage range (min–max shaded), with half and quarter marks, the verdict,
// and the 16 rolls. Every number is the calc result's own; the animation only sequences it.
export function DamageViz({result,name,attackerName,defender,fallback,move,art}:{result:any;name:string;attackerName:string;attacker?:string;defender:string;fallback:string;move:string;art:any}){
  const max=result.defenderStats?.hp??0,cur=result.defaults?.defenderHP??max;const [lo,hi]=result.range as [number,number];
  const pct=(v:number)=>max?Math.max(0,Math.min(100,v/max*100)):0;const leftHi=pct(cur-hi),leftLo=pct(cur-lo),now=pct(cur);
  const rolls:number[]=result.rolls??[];const top=Math.max(...rolls,1),bottom=Math.min(...rolls,top);
  const [go,setGo]=useState(false);const k=rolls.join()+':'+cur+':'+max;useEffect(()=>{setGo(false);const t=setTimeout(()=>setGo(true),reduced()?0:120);return()=>clearTimeout(t);},[k]);
  const ko=result.koChanceOnHit;const phrase=String(result.description??'').split(' -- ')[1]??'';
  const verdict=hi===0?'No effect':ko>=1?'Guaranteed KO':ko>0?`${(ko*100).toFixed(1)}% chance to KO`:phrase?phrase[0].toUpperCase()+phrase.slice(1):'No KO from this HP';
  const tone=(leftHi>50?'ok':leftHi>20?'warn':'low');
  const big=useRolling(result.percentOfMaxHP.map((v:number)=>v.toFixed(1)).join('–')+'%',k,560),hp=useRolling(`${lo}–${hi} HP`,k,560);
  return <div className="dmg">
    <div className="calc-run" key={k} aria-hidden="true"><span>CALC ▸ {attackerName} · {move} → {name}</span><i/><b>{rolls.length} {rolls.length===1?'ROLL':'ROLLS'}</b></div>
    <div className="dmg-head"><span className="eyebrow">{attackerName} · {move} → {name}</span><div className="lab-big"><b>{big}</b><span>{hp}</span></div><span className={'verdict'+(ko>=1?' ko':ko>0?' maybe':'')}>{verdict}</span></div>
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
export type Runner={name:string;fallback:string;speed:number;side?:'mine'|'foe'|null;move?:string|null;priority?:number;rank:number;tied:boolean;decidedBy?:string};
type Duel={name:string;fallback:string;speed:number};
// One or two lanes as before (a, b); or `runners`: up to four Pokémon already in turn order (rank shared when tied).
export function SpeedRace(p:{a?:Duel;b?:Duel;first?:'a'|'b'|'tie';trickRoom:boolean;art:any;decidedBy?:string;runners?:Runner[];watch?:string[];ties?:string[][]}){
  return p.runners?<RaceOrder runners={p.runners} trickRoom={p.trickRoom} art={p.art} watch={p.watch??[]}/>:<SpeedRaceDuel a={p.a!} b={p.b!} first={p.first!} trickRoom={p.trickRoom} art={p.art} decidedBy={p.decidedBy}/>;
}
// Four lanes: the order is the engine's (priority, then bracket, then Speed). Distance only shows pace: each runner stops
// short of the one before it, and tied runners stop together.
function RaceOrder({runners,trickRoom,art,watch}:{runners:Runner[];trickRoom:boolean;art:any;watch:string[]}){
  const [go,setGo]=useState(false);const k=runners.map(r=>`${r.name}${r.speed}${r.rank}`).join('-')+trickRoom;
  useEffect(()=>{setGo(false);const t=setTimeout(()=>setGo(true),reduced()?0:80);return()=>clearTimeout(t);},[k]);
  const fast=Math.max(1,...runners.map(r=>r.speed)),slow=Math.max(1,Math.min(...runners.map(r=>r.speed)));
  const reach=(s:number)=>trickRoom?slow/Math.max(1,s):Math.max(1,s)/fast;
  const dist:number[]=[];runners.forEach((r,i)=>{const prev=runners[i-1];dist.push(i===0?1:prev.rank===r.rank?dist[i-1]:Math.max(.08,Math.min(reach(r.speed),dist[i-1]-.05)));});
  const ordinal=['1st','2nd','3rd','4th'];const tag=(r:Runner)=>r.side==='mine'?'You':r.side==='foe'?'Opp':'';
  const sub=(r:Runner)=>[r.move,r.priority?`priority ${r.priority>0?'+':''}${r.priority}`:'',r.tied?'tied':r.decidedBy&&r.decidedBy!=='first'?`behind on ${r.decidedBy}`:''].filter(Boolean).join(' · ');
  const tiedGroups=[...new Set(runners.filter(r=>r.tied).map(r=>r.rank))].map(rk=>runners.filter(r=>r.rank===rk));
  return <div className={'race four'+(trickRoom?' tr':'')}><div className="calc-run" key={k} aria-hidden="true"><span>ORDER ▸ {runners.map(r=>formName(r.name)).join(' · ')}{trickRoom?' · TRICK ROOM':''}</span><i/><b>{tiedGroups.length?'TIE':'RESOLVED'}</b></div>
    <span className="eyebrow">{trickRoom?'Trick Room · slower moves first':'Turn order · faster moves first'}</span>
    <ol className="race-lanes" style={{listStyle:'none',margin:0,padding:0,display:'grid',gap:12}}>{runners.map((r,i)=>{const first=r.rank===1;
      return <li key={i} className={'lane is-'+(r.side??'x')+(first?' wins':'')+(r.tied?' tied':'')}>
        <div className="track"><span className="finish"/><span className="runner" style={{left:go?`calc((100% - 72px) * ${dist[i].toFixed(3)})`:'0px',transitionDuration:go&&!reduced()?'1.6s':'0s'}}><Art name={r.name} fallback={r.fallback} art={art} small/></span></div>
        <div className="lane-stat"><b>{r.speed}</b><span>{formName(r.name)}</span>{tag(r)&&<span className="lane-side">{tag(r)}</span>}<em style={{animationDelay:reduced()?'0s':'1.5s'}}>{r.tied?`${ordinal[r.rank-1]??r.rank} · tie`:ordinal[r.rank-1]??r.rank}</em>{sub(r)&&<span className="lane-sub">{sub(r)}</span>}</div></li>;})}</ol>
    <p className="race-verdict">{tiedGroups.length?`Speed tie: ${tiedGroups.map(g=>g.map(r=>formName(r.name)).join(' and ')).join('; ')} — a coin flip each turn.`:`${formName(runners[0].name)} acts first, ${formName(runners.at(-1)!.name)} last.`}</p>
    {watch.length>0&&<ul className="race-watch" aria-label="Flagged, not simulated">{watch.map((w,i)=><li key={i}>{w}</li>)}</ul>}</div>;
}
function SpeedRaceDuel({a,b,first,trickRoom,art,decidedBy}:{a:Duel;b:Duel;first:'a'|'b'|'tie';trickRoom:boolean;art:any;decidedBy?:string}){
  const [go,setGo]=useState(false);const k=`${a.name}${a.speed}-${b.name}${b.speed}-${trickRoom}-${first}`;
  useEffect(()=>{setGo(false);const t=setTimeout(()=>setGo(true),reduced()?0:80);return()=>clearTimeout(t);},[k]);
  // Distance covered when the leader crosses: proportional to Speed (inverted under Trick Room). Priority can put the
  // slower one first, so whoever acts first is always the one at the line.
  const fast=Math.max(a.speed,b.speed,1),slow=Math.max(1,Math.min(a.speed,b.speed));
  const reach=(s:number)=>trickRoom?slow/Math.max(1,s):Math.max(1,s)/fast;
  let da=reach(a.speed),db=reach(b.speed);if(first==='tie')da=db=1;else if(first==='a'){da=1;db=Math.min(db,.94);}else{db=1;da=Math.min(da,.94);}
  const sa=useRolling(String(a.speed),k,520),sb=useRolling(String(b.speed),k,520);
  const lane=(side:'a'|'b',r:typeof a,d:number)=>{const wins=first===side||first==='tie';return <div className={'lane'+(wins?' wins':'')}>
    <div className="track"><span className="finish"/><span className="runner" style={{left:go?`calc((100% - 72px) * ${d.toFixed(3)})`:'0px',transitionDuration:go&&!reduced()?'1.6s':'0s'}}><Art name={r.name} fallback={r.fallback} art={art} small/></span></div>
    <div className="lane-stat"><b>{side==='a'?sa:sb}</b><span>{formName(r.name)}</span>{go&&wins&&<em style={{animationDelay:reduced()?'0s':'1.5s'}}>{first==='tie'?'Tie':'1st'}</em>}</div></div>;};
  return <div className={'race'+(trickRoom?' tr':'')}><div className="calc-run" key={k} aria-hidden="true"><span>SPEED ▸ {formName(a.name)} {a.speed} · {formName(b.name)} {b.speed}{trickRoom?' · TRICK ROOM':''}</span><i/><b>{first==='tie'?'TIE':'RESOLVED'}</b></div><span className="eyebrow">{trickRoom?'Trick Room · slower moves first':'Speed · faster moves first'}</span>{lane('a',a,da)}{lane('b',b,db)}
    <p className="race-verdict">{first==='tie'?'Speed tie: a coin flip each turn.':`${formName(first==='a'?a.name:b.name)} acts first${decidedBy==='priority'?' on priority':decidedBy==='item or ability order'?' (item or ability order)':''}.`}</p></div>;
}
export function SetFields({set,update,dex,form}:{set:any;update:(s:any)=>void;dex:any;form:string}){const [final,setFinal]=useState<any>(null);const key=JSON.stringify({species:form,nature:set.nature,statPoints:set.statPoints});useEffect(()=>{let alive=true;api('/calculate',{kind:'stats',input:JSON.parse(key)}).then(s=>{if(alive)setFinal(s);}).catch(()=>{if(alive)setFinal(null);});return()=>{alive=false;};},[key]);return <div className="set-edit"><div className="lab-row"><Field label="Nature"><select value={set.nature??'Serious'} onChange={e=>update({...set,nature:e.target.value})}>{(dex?.natures??[set.nature??'Serious']).map((s:string)=><option key={s}>{s}</option>)}</select></Field><Field label="Ability"><input list="lab-abilities" value={set.ability??''} onChange={e=>update({...set,ability:e.target.value})}/></Field></div><Field label="Item"><ItemPicker value={set.item??''} onChange={v=>update({...set,item:v})} dex={dex}/></Field><SpEditBars set={set} form={form} final={final} update={update}/></div>;}
// Stat points as bars: base stat in emerald, points stacked on the end in gold, the change beside it, then the final stat.
function SpEditBars({set,form,final,update}:{set:any;form:string;final:any;update:(s:any)=>void}){
  const base=useDex([form],[]).base[form];const total=stats.reduce((n,k)=>n+(set.statPoints?.[k]??0),0);const w=(v:number)=>`${Math.min(100,100*v/220)}%`;
  return <div className="stat-bars sp-edit"><div className="stat-bars-head"><span className="muted">Stat points</span><b className={total>66?'error':''}>{total} / 66</b></div>{stats.map(k=>{const b=base?.[k]??0,sp=set.statPoints?.[k]??0;
    return <Field key={k} className="stat-row" label={<span className="stat-name">{statLabel[k]}</span>}><span className="stat-bar"><span className="base" style={{width:w(b)}}/><span className="sp" style={{width:w(sp)}}/></span><span className="stat-base">{base?b:'—'}{sp>0&&<b className="stat-plus">+{sp}</b>}</span>
      <input className="compact num" type="number" min="0" max="32" aria-label={`${statLabel[k]} stat points`} value={sp} onChange={e=>update({...set,statPoints:{...set.statPoints,[k]:Math.max(0,Math.min(32,Number(e.target.value)||0))}})}/><output className="stat-final">{final?.[k]??'—'}</output></Field>;})}</div>;
}
function BattleConditions({set,update,final}:{set:any;update:(s:any)=>void;final?:any}){return <details className="combatant-edit"><summary>HP, status and stat boosts</summary><Field label="Current exact HP (blank = full)"><input type="number" min="1" max={final?.hp} value={set.curHP??''} onChange={e=>update({...set,curHP:e.target.value?Number(e.target.value):undefined})}/></Field><Field label="Status"><select value={set.status??''} onChange={e=>update({...set,status:e.target.value||undefined})}>{[['','Healthy'],['brn','Burn'],['par','Paralysis'],['psn','Poison'],['tox','Toxic'],['slp','Sleep'],['frz','Frozen']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><div className="sp-inputs">{stats.filter(k=>k!=='hp').map(k=><Field key={k} label={statLabel[k]}> boost<input className="compact num" type="number" min="-6" max="6" value={set.boosts?.[k]??0} onChange={e=>update({...set,boosts:{...set.boosts,[k]:Number(e.target.value)}})}/></Field>)}</div><Field label="Ability activation"><select value={set.abilityOn===undefined?'default':String(set.abilityOn)} onChange={e=>update({...set,abilityOn:e.target.value==='default'?undefined:e.target.value==='true'})}><option value="default">Calculator default</option><option value="true">Active</option><option value="false">Inactive / already accounted for</option></select></Field><Field label="Allies fainted (Supreme Overlord)"><input type="number" min="0" max="3" value={set.alliesFainted??''} onChange={e=>update({...set,alliesFainted:e.target.value?Number(e.target.value):undefined})}/></Field></details>;}

// Inputs the calc needs for some moves: hit count for variable multi-hit moves, battle state for power-changing moves.
function MoveContext({move,dex,options,setOptions}:{move:string;dex:any;options:any;setOptions:(f:any)=>void}){
  const hits=dex?.multiHit?.[move];const ctx=dex?.contextMoves?.[move];if(!hits&&!ctx)return null;
  const setCtx=(v:any)=>setOptions((o:any)=>({...o,context:v===undefined?undefined:{[ctx.field]:v}}));const value=options.context?.[ctx?.field];
  return <div className="move-context">{hits&&<Field label="Hits"><select value={options.hits??''} onChange={e=>setOptions((o:any)=>({...o,hits:e.target.value?Number(e.target.value):undefined}))}><option value="">Usual (3; 5 with Skill Link)</option>{Array.from({length:hits[1]-hits[0]+1},(_,i)=>hits[0]+i).map(n=><option key={n} value={n}>{n}</option>)}</select></Field>}
    {ctx&&(ctx.max!==undefined?<Field label={ctx.label}><input type="number" min="0" max={ctx.max} value={value??''} placeholder="0" onChange={e=>setCtx(e.target.value===''?undefined:Number(e.target.value))}/></Field>
      :<Checkbox checked={!!value} onChange={e=>setCtx(e.target.checked||undefined)}>{ctx.label}</Checkbox>)}</div>;
}
