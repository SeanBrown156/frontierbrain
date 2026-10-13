// Copies shared reference data (tournament pool, usage snapshots, news, icon sheet) from a local data directory into
// the hosted site's shared_files table. Needs SUPABASE_URL and SUPABASE_SECRET_KEY. Users' own data is never copied.
//   node tools/hosted-seed.ts [--dry-run] [--only <path prefix>]   (e.g. --only knowledge/pool/ seeds just the pool files)
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {ROOT,CODE} from './io.ts';
import {sharedFiles} from './hosted.ts';

const dry=process.argv.includes('--dry-run');
const onlyAt=process.argv.indexOf('--only'),only=onlyAt>=0?process.argv[onlyAt+1]:undefined;
try{process.loadEnvFile(resolve(CODE,'.env'));}catch{}
const url=process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL,secret=process.env.SUPABASE_SECRET_KEY;
if(!dry&&(!url||!secret))throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env');
const files:string[]=['knowledge/pool/status.json','knowledge/pool/teams.json','knowledge/news/weeks.json','knowledge/sources/checks.json',
  'knowledge/metagame/latest.json','knowledge/metagame/events.json','knowledge/metagame/events-check.json','knowledge/metagame/history-check.json',
  'knowledge/artwork/manifest.json','knowledge/artwork/icon-index.json','knowledge/artwork/pokemonicons-sheet.png'];
// Regulation records, index and player-facing notices (written by the regulation routine).
for(const f of await readdir(resolve(ROOT,'knowledge/regulations')).catch(()=>[]))if(f.endsWith('.json'))files.push(`knowledge/regulations/${f}`);
// Monthly usage snapshots (the dashboard's history; the large per-set files are only a labelled fallback) and the
// newest day of cached PokéBase pages.
for(const month of await readdir(resolve(ROOT,'knowledge/metagame/snapshots')).catch(()=>[]))for(const f of await readdir(resolve(ROOT,'knowledge/metagame/snapshots',month)))if(f.endsWith('.json')&&!f.includes('-sets-'))files.push(`knowledge/metagame/snapshots/${month}/${f}`);
for(const source of ['pokebase','pokebase-ladder']){const days=(await readdir(resolve(ROOT,'knowledge/metagame',source)).catch(()=>[])).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();const day=days.at(-1);if(day)for(const f of await readdir(resolve(ROOT,'knowledge/metagame',source,day)))files.push(`knowledge/metagame/${source}/${day}/${f}`);}
const present=[];for(const f of files.filter(f=>!only||f.startsWith(only))){try{const s=await stat(resolve(ROOT,f));present.push({path:f,size:s.size});}catch{}}
console.log(`${present.length} files, ${(present.reduce((n,f)=>n+f.size,0)/1e6).toFixed(1)} MB`);
if(dry){for(const f of present)console.log(f.path,f.size);process.exit(0);}
const client=createClient(url!,secret!,{auth:{persistSession:false,autoRefreshToken:false}});
const shared=sharedFiles(client,client);
for(const f of present){const bytes=await readFile(resolve(ROOT,f.path));let error:Error|null=null;
  try{await shared.write(f.path,f.path.endsWith('.png')?bytes:bytes.toString('utf8'));}catch(e){error=e as Error;}
  console.log(error?`FAILED ${f.path}: ${error.message}`:`ok ${f.path}`);}
