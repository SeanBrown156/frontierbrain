// "From tournaments" in + New team: any pooled team becomes an editable team. Exact spreads are used when the
// player shared their paste (VGCPastes); otherwise items, abilities, natures and moves come from the team sheet and
// each Pokémon's stat points are filled from the pool's most common spread (same nature first), labelled per slot.
import {dex} from './mechanics.ts';
import {exportText} from './teams.ts';
import {cleanSet,validation} from './workbench-store.ts';
import {poolTeams,poolSets,type PoolTeam,type Lane} from './pool.ts';
import {metaSets} from './meta-sets.ts';
import {MIN_POOL_SPREADS} from './chat.ts';

const exact=(t:PoolTeam)=>t.sets.length===6&&t.sets.every(s=>s.statPoints&&Object.values(s.statPoints).some(v=>v>0));
const ordinal=(n:number)=>n+(['th','st','nd','rd'][n%100>10&&n%100<14?0:n%10]??'th');
// Best results first: official before online before shared pastes, newest events, best placings.
const rank=(t:PoolTeam)=>({official:0,online:1,shared:2}[t.lane]*1e6)-(Date.parse(t.date??'2000-01-01')/864e5)+(t.placing??999)/1000;
export async function searchPoolTeams({q='',lane,limit=40}:{q?:string;lane?:Lane;limit?:number}={}){
  const words=q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits=(await poolTeams()).filter(t=>(!lane||t.lane===lane)&&words.every(w=>[t.player,t.event,...t.pokemon].some(f=>(f??'').toLowerCase().includes(w))));
  return {total:hits.length,teams:hits.sort((a,b)=>rank(a)-rank(b)).slice(0,Math.min(limit,100)).map(t=>({id:t.id,lane:t.lane,event:t.event,date:t.date,players:t.players,player:t.player,placing:t.placing,record:t.record,pokemon:t.pokemon,exactSpreads:exact(t),source:t.sources[0]?.url??null}))};
}
async function filledSpread(species:string,nature:string){
  try{const pool=await poolSets(species);const total=pool.spreads.reduce((n:number,s:any)=>n+s.count,0);
    if(total>=MIN_POOL_SPREADS){const same=pool.spreads.filter((s:any)=>s.nature===nature);const pick:any=same[0]??pool.spreads[0];const pickTotal=same.length?same.reduce((n:number,s:any)=>n+s.count,0):total;
      return {statPoints:pick.statPoints,basis:`most common ${same.length?nature+' ':''}spread in the team pool (${pick.count} of ${pickTotal})`};}}catch{}
  try{const pb=await metaSets(species,'pokebase');const s:any=pb.spreads.find((x:any)=>x.nature===nature)??pb.spreads[0];if(s)return {statPoints:s.statPoints,basis:`most common spread in PokéBase M-C tournaments (${s.percent}%)`};}catch{}
  return {statPoints:{hp:32,atk:0,def:0,spa:0,spd:0,spe:32},basis:'no published spread found: placeholder 32 HP / 32 Spe'};
}
export async function poolTeamDraft(id:string){
  const t=(await poolTeams()).find(x=>x.id===id);if(!t)throw new Error('That team is no longer in the pool');
  const slots:{species:string;spread:'exact'|'filled';basis:string}[]=[];const sets=[];
  for(const s of t.sets){const species=dex.species.get(s.species).name||s.species;
    if(s.statPoints&&Object.values(s.statPoints).some(v=>v>0)){sets.push(cleanSet({...s,species}));slots.push({species,spread:'exact',basis:`player's shared paste${t.spreadsFrom?` (${t.spreadsFrom.url})`:''}`});continue;}
    const f=await filledSpread(species,s.nature);sets.push(cleanSet({...s,species,statPoints:f.statPoints}));slots.push({species,spread:'filled',basis:f.basis});}
  const where=t.event?`${t.placing?`${ordinal(t.placing)}, `:''}${t.event}`:'shared paste';
  const name=`${t.player}: ${where}`.slice(0,120);const errors=validation(sets as any);
  const lines=slots.map(s=>`- **${s.species}**: ${s.spread==='exact'?'exact spread':'spread filled'} (${s.basis})`);
  const notes=`Team from ${t.lane==='shared'?'a shared VGCPastes paste':`${t.event}${t.date?` (${t.date})`:''}${t.players?`, ${t.players} players`:''}`} by ${t.player}${t.placing?`, finished ${ordinal(t.placing)}`:''}${t.record?` (${t.record})`:''}.\n\nTeam sheet: ${t.sources.map(s=>`${s.name} ${s.url}`).join(' · ')}.\n\n${slots.every(s=>s.spread==='exact')?'All spreads are the player\'s own.':'Items, abilities, natures and moves are from the team sheet. Spreads marked "filled" are the most common published spread for that Pokémon, not the player\'s.'}\n\n${lines.join('\n')}`;
  return {name,paste:exportText(sets as any,'gen9championsvgc2026regmc'),notes,slots,errors};
}
