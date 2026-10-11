import {optionalJSON,save,id,hash,modifiedAt,readBytes} from './io.ts';
import {fetchText} from './research.ts';
import {dex} from './mechanics.ts';

// Box icons (the small menu sprites) come from Pokémon Showdown's icon sheet: 12 columns of 40×30 cells.
// The sheet and its form index are downloaded once into the local artwork cache. The index is read from the
// client's data file as plain "name:number+number" pairs; the downloaded script is never executed.
const SHEET_URL='https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png';
const INDEX_URL='https://play.pokemonshowdown.com/js/battle-dex-data.js';
const SHEET='knowledge/artwork/pokemonicons-sheet.png',INDEX='knowledge/artwork/icon-index.json';
export const ICON={width:40,height:30,columns:12};

export function parseIconIndex(source:string):Record<string,number>{
  const start=source.indexOf('BattlePokemonIconIndexes={');if(start<0)throw new Error('Icon index not found in the Showdown data file');
  const body=source.slice(start,source.indexOf('}',start));const out:Record<string,number>={};
  for(const m of body.matchAll(/^\s*([a-z0-9]+):\s*(\d+)(?:\s*\+\s*(\d+))?,?\s*$/gm))out[m[1]]=Number(m[2])+Number(m[3]??0);
  if(Object.keys(out).length<100)throw new Error('Icon index looks incomplete');return out;
}
// Same rule as the Showdown client: a form's own icon when it has one, else the species' National Dex number.
export function iconNumber(name:string,index:Record<string,number>){
  const s=dex.species.get(name);if(!s.exists)return 0;const own=index[id(s.name)];if(own!==undefined)return own;
  const base=dex.species.get(s.baseSpecies);return base.num>0&&base.num<=1025?base.num:0;
}
let loading:Promise<Record<string,number>>|null=null;
export function iconIndex(){return loading??=(async()=>{
  const cached=await optionalJSON<{index:Record<string,number>}|null>(INDEX,null);
  if(cached&&await modifiedAt(SHEET))return cached.index;
  const res=await fetch(SHEET_URL,{signal:AbortSignal.timeout(20000)});if(!res.ok||!res.headers.get('content-type')?.startsWith('image/png'))throw new Error(`Icon sheet HTTP ${res.status}`);
  const bytes=Buffer.from(await res.arrayBuffer());await save(SHEET,bytes);
  const index=parseIconIndex((await fetchText(INDEX_URL,2_000_000)).text);
  await save(INDEX,{source:INDEX_URL,sheet:SHEET_URL,sheetSha256:hash(bytes),retrievedAt:new Date().toISOString(),attribution:'Pokémon box icons via Pokémon Showdown. © Pokémon / Nintendo / Creatures / GAME FREAK. Personal local reference.',index});
  return index;
})().catch(e=>{loading=null;throw e;});}
export const iconSheet=()=>readBytes(SHEET);

// Pokémon HOME renders (the soft 3D models) from Pokémon Showdown's sprite folder, keyed by Showdown's sprite id
// (e.g. "gengar-mega"). Cached on first request like the artwork; a form without a render is a 404 and the page
// falls back to the official illustration.
const HOME_URL='https://play.pokemonshowdown.com/sprites/home/';
export function homeSpriteId(name:string){const s=dex.species.get(name);return s.exists&&s.num>0?s.spriteid as string:null;}
export const homeSpriteURL=(spriteId:string)=>`${HOME_URL}${spriteId}.png`;
export async function homeSprite(name:string):Promise<Buffer|null>{
  const sprite=homeSpriteId(name);if(!sprite||!/^[a-z0-9-]+$/.test(sprite))return null;const file=`knowledge/artwork/home/${sprite}.png`;
  try{return await readBytes(file);}catch{}
  const res=await fetch(homeSpriteURL(sprite),{signal:AbortSignal.timeout(15000)});if(!res.ok)return null;
  const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>2_000_000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return null;
  await save(file,bytes);return bytes;
}
// Held-item icons: Showdown's item sheet, 16 columns of 24×24 cells, indexed by each item's spritenum.
export const ITEM_SHEET_URL='https://play.pokemonshowdown.com/sprites/itemicons-sheet.png';
export async function itemSheet():Promise<Buffer>{
  const file='knowledge/artwork/itemicons-sheet.png';try{return await readBytes(file);}catch{}
  const res=await fetch(ITEM_SHEET_URL,{signal:AbortSignal.timeout(20000)});if(!res.ok||!res.headers.get('content-type')?.startsWith('image/png'))throw new Error(`Item sheet HTTP ${res.status}`);
  const bytes=Buffer.from(await res.arrayBuffer());await save(file,bytes);return bytes;
}
// Types for species and sheet positions for items, for badges and icons on cards.
export function dexInfo(species:string[],items:string[]){
  const known=species.slice(0,60).map(n=>[n,dex.species.get(n)] as const);
  return {types:Object.fromEntries(known.map(([n,s])=>[n,s.exists?s.types:[]])),base:Object.fromEntries(known.filter(([,s])=>s.exists).map(([n,s])=>[n,s.baseStats])),
    // Mega forms a species can take, with the stone that triggers each (a holder battles as the Mega).
    megas:Object.fromEntries(known.filter(([,s])=>s.exists).map(([n,s])=>[n,(s.otherFormes??[]).map((f:string)=>dex.species.get(f)).filter((f:any)=>f.isMega&&f.requiredItem).map((f:any)=>({name:f.name,item:f.requiredItem,types:f.types,ability:Object.values(f.abilities)[0],baseStats:f.baseStats}))])),
    items:Object.fromEntries(items.slice(0,60).map(n=>{const i=dex.items.get(n);return [n,i.exists?i.spritenum??0:0];}))};
}

// Site icons for the reference links: fetched once per host from Google's favicon service (which resolves each site's
// real icon at a consistent 64px) and cached, so the menus never wait on dozens of third-party /favicon.ico requests.
export const faviconURL=(host:string)=>`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
export const validHost=(host:string)=>/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)&&host.length<=253;
export async function favicon(host:string):Promise<Buffer|null>{
  if(!validHost(host))return null;const file=`knowledge/artwork/favicons/${host.toLowerCase()}.png`;
  try{return await readBytes(file);}catch{}
  const res=await fetch(faviconURL(host),{signal:AbortSignal.timeout(8000)}).catch(()=>null);if(!res?.ok)return null;
  const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>200_000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return null;
  await save(file,bytes);return bytes;
}
