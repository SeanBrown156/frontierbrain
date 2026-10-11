// What makes a Pokémon itself in Champions doubles, from the dex and the team pool: its forms (Megas), the support,
// speed-control and spread moves it can learn, its strongest STAB options, and a type-and-base-Speed sheet against
// the most-used Pokémon in the pool. Type chart and base stats only: real damage and speed need calc_damage/calc_speed.
import {dex} from './mechanics.ts';
import {poolOverview} from './pool.ts';

const ROLES:Record<string,string[]>={
  'speed control':['tailwind','trickroom','icywind','electroweb','thunderwave','scaryface','bulldoze','rocktomb','stringshot','glare','nuzzle','quash','afteryou'],
  'redirection':['followme','ragepowder','spotlight'],
  'disruption':['fakeout','encore','taunt','disable','imprison','willowisp','snarl','partingshot','spore','sleeppowder','yawn','haze','clearsmog','torment','nobleroar','faketears','eerieimpulse','coaching'],
  'protection':['wideguard','quickguard','allyswitch','detect','spikyshield','kingsshield','banefulbunker','silktrap','burningbulwark','craftyshield','matblock'],
  'support':['helpinghand','healpulse','lifedew','pollenpuff','reflect','lightscreen','auroraveil','perishsong','safeguard','tailwind','decorate','instruct','skillswap','wish','junglehealing'],
  'setup':['swordsdance','nastyplot','calmmind','bulkup','dragondance','quiverdance','shellsmash','bellydrum','coil','irondefense','agility','shiftgear','victorydance','tidyup'],
};
const name=(id:string)=>dex.moves.get(id).name;
const effect=(type:string,defender:string[],abilities:string[]=[])=>{
  if(!dex.getImmunity(type,defender))return 0;
  if(abilities.length===1&&((type==='Ground'&&abilities[0]==='Levitate')||(type==='Water'&&['Water Absorb','Storm Drain','Dry Skin'].includes(abilities[0]))||(type==='Electric'&&['Volt Absorb','Lightning Rod','Motor Drive'].includes(abilities[0]))||(type==='Fire'&&abilities[0]==='Flash Fire')||(type==='Grass'&&abilities[0]==='Sap Sipper')))return 0;
  return 2**dex.getEffectiveness(type,defender);
};
const formOf=(s:ReturnType<typeof dex.species.get>)=>({name:s.name,types:[...s.types] as string[],baseStats:s.baseStats,abilities:Object.values(s.abilities) as string[],...s.requiredItem?{item:s.requiredItem}:{}});

export async function pokemonProfile(species:string,{top=20}:{top?:number}={}){
  const s=dex.species.get(species);if(!s.exists)throw new Error(`Unknown species ${species}`);
  const root=dex.species.get(s.baseSpecies);
  const megas=(root.otherFormes??[]).map((f:string)=>dex.species.get(f)).filter((f:any)=>f.exists&&/-Mega/.test(f.name));
  const forms=[root,...megas].map(formOf);
  const pool=new Set<string>([...((dex.species as any).getMovePool(root.id) as Set<string>)]);
  const moves=[...pool].map(id=>dex.moves.get(id)).filter(m=>m.exists&&!m.isNonstandard);
  const roles=Object.fromEntries(Object.entries(ROLES).map(([k,ids])=>[k,ids.filter(id=>pool.has(id)).map(name)]).filter(([,v])=>v.length));
  const spread=moves.filter(m=>m.basePower>0&&['allAdjacentFoes','allAdjacent'].includes(m.target)).sort((a,b)=>b.basePower-a.basePower).slice(0,8).map(m=>`${m.name} (${m.type}, ${m.basePower})`);
  const stabTypes=[...new Set(forms.flatMap(f=>f.types))];
  const stab=Object.fromEntries(stabTypes.map(t=>[t,moves.filter(m=>m.type===t&&m.basePower>0&&m.category!=='Status').sort((a,b)=>b.basePower-a.basePower).slice(0,4).map(m=>`${m.name} (${m.category}, ${m.basePower}${m.target.startsWith('all')?', spread':''})`)]));
  const coverage=moves.filter(m=>m.basePower>=70&&!stabTypes.includes(m.type)).reduce((acc:Record<string,string>,m)=>{if(!acc[m.type]||dex.moves.get(acc[m.type]).basePower<m.basePower)acc[m.type]=m.name;return acc;},{});

  const overview=await poolOverview({top:400});
  const usage=overview.usage.find((u:any)=>u.name===root.name)??null;const threats=overview.usage.filter((u:any)=>u.name!==root.name).slice(0,top);
  const vs=forms.map(f=>({form:f.name,threats:threats.map((u:any)=>{const t=dex.species.get(u.name);const tTypes=[...t.types] as string[],tAbilities=Object.values(t.abilities) as string[];
    return {pokemon:u.name,usage:u.percent,types:tTypes,
      yourBestStab:Math.max(...f.types.map((x:string)=>effect(x,tTypes,tAbilities))),
      theirBestStab:Math.max(...tTypes.map((x:string)=>effect(x,f.types,f.abilities))),
      baseSpeed:{yours:f.baseStats.spe,theirs:t.baseStats.spe}};})}));
  const summary=vs.map(v=>({form:v.form,
    stabHitsSuperEffectively:v.threats.filter(t=>t.yourBestStab>=2).map(t=>t.pokemon),
    threatenedBySuperEffectiveStab:v.threats.filter(t=>t.theirBestStab>=2).map(t=>t.pokemon),
    resistsOrImmuneToTheirStab:v.threats.filter(t=>t.theirBestStab<1).map(t=>t.pokemon),
    outspeedsOnBaseSpeed:v.threats.filter(t=>t.baseSpeed.yours>t.baseSpeed.theirs).map(t=>t.pokemon),
    underTrickRoomOutspeeds:v.threats.filter(t=>t.baseSpeed.yours<t.baseSpeed.theirs).map(t=>t.pokemon)}));
  return {species:root.name,forms,usageInPool:usage?{percent:usage.percent,teams:usage.count,of:overview.teams}:{percent:0,of:overview.teams,note:'Not on any pooled team: opponents won\'t have a plan for it.'},
    roles,spreadMoves:spread,strongestStab:stab,coverage,
    metaSheet:{basis:`Top ${top} Pokémon in the team pool (${overview.teams} teams). Type chart and base Speed only, before items, abilities beyond single-ability immunities, spreads and Mega timing; confirm anything important with calc_damage / calc_speed.`,summary,detail:vs}};
}
