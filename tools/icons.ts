import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ROOT,optionalJSON,save,id,hash} from './io.ts';
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
  try{await readFile(resolve(ROOT,SHEET));if(cached)return cached.index;}catch{}
  const res=await fetch(SHEET_URL,{signal:AbortSignal.timeout(20000)});if(!res.ok||!res.headers.get('content-type')?.startsWith('image/png'))throw new Error(`Icon sheet HTTP ${res.status}`);
  const bytes=Buffer.from(await res.arrayBuffer());await mkdir(resolve(ROOT,'knowledge/artwork'),{recursive:true});await writeFile(resolve(ROOT,SHEET),bytes);
  const index=parseIconIndex((await fetchText(INDEX_URL,2_000_000)).text);
  await save(INDEX,{source:INDEX_URL,sheet:SHEET_URL,sheetSha256:hash(bytes),retrievedAt:new Date().toISOString(),attribution:'Pokémon box icons via Pokémon Showdown. © Pokémon / Nintendo / Creatures / GAME FREAK. Personal local reference.',index});
  return index;
})().catch(e=>{loading=null;throw e;});}
export const iconSheet=()=>readFile(resolve(ROOT,SHEET));
