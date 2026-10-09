// The team pool as relational rows (Supabase `pool_*` tables), so usage questions become SQL.
// poolRows() is a pure transform of knowledge/pool/teams.json; the CLI upserts the rows with the server's secret key:
//   node tools/pool-db.ts --env .env.hosted [--pool <teams.json>] [--dry-run]
// Lanes stay separate (official | online | shared) and every team keeps its source URL. Names are checked against
// the Showdown engine (`dex`): resolved names are stored in canonical spelling; anything the engine does not know is
// stored exactly as the source wrote it and listed in the set's `unresolved` column, never guessed or corrected.
// Stat points are stored as the source gave them (VGCPastes only); final stats are derived, not stored.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {dex,resolveSpecies} from './mechanics.ts';
export {resolveSpecies};
import {ROOT} from './io.ts';
import {playerKey,type PoolTeam,type PoolSet,type Lane} from './pool.ts';

export interface EventRow {id:string;lane:Lane;source_event_id:string;name:string;event_date:string|null;format:string;players_count:number|null;source:string;url:string|null;refreshed_at:string;}
export interface PlayerRow {id:string;name:string;refreshed_at:string;}
export interface SetRow {id:string;species:string;base_species:string;item:string|null;ability:string|null;nature:string|null;moves:string[];
  hp_sp:number|null;atk_sp:number|null;def_sp:number|null;spa_sp:number|null;spd_sp:number|null;spe_sp:number|null;unresolved:string[];refreshed_at:string;}
export interface TeamRow {id:string;lane:Lane;event_id:string|null;event_label:string|null;player_id:string|null;player_name:string;place:number|null;
  wins:number|null;losses:number|null;ties:number|null;source_url:string;shared_paste_url:string|null;observed_on:string|null;refreshed_at:string;}
export interface MemberRow {team_id:string;slot:number;set_id:string;}
export interface PoolRows {events:EventRow[];players:PlayerRow[];sets:SetRow[];teams:TeamRow[];members:MemberRow[];
  unresolved:Record<'species'|'item'|'ability'|'nature'|'moves',Record<string,number>>;}

const STATS=['hp','atk','def','spa','spd','spe'] as const;
const EVENT_SOURCES:Record<'official'|'online',{source:string;url:(id:string)=>string}>={
  official:{source:'Limitless',url:id=>`https://limitlessvgc.com/tournaments/${id}`},
  online:{source:'Limitless online',url:id=>`https://play.limitlesstcg.com/tournament/${id}/standings`},
};
const plain=(s:string)=>s.normalize("NFKD").replace(/\p{M}/gu,"").trim();
const lookup=(table:{get(n:string):{exists:boolean;name:string}},raw:string|undefined|null)=>{const v=plain(raw??'');if(!v)return {value:null,ok:true};const d=table.get(v);return d.exists?{value:d.name,ok:true}:{value:(raw??'').trim(),ok:false};};
const hash=(v:unknown)=>createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0,20);
const RECORD=/^(\d+)-(\d+)(?:-(\d+))?$/;
export const playerId=(name:string)=>playerKey(name)||name.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim()||null;

export function poolRows(teams:PoolTeam[],{refreshedAt,format='M-C'}:{refreshedAt:string;format?:string}):PoolRows{
  const events=new Map<string,EventRow>(),players=new Map<string,PlayerRow>(),sets=new Map<string,SetRow>();const out:TeamRow[]=[],members:MemberRow[]=[];
  const unresolved:PoolRows['unresolved']={species:{},item:{},ability:{},nature:{},moves:{}};const miss=(k:keyof PoolRows['unresolved'],v:string)=>{unresolved[k][v]=(unresolved[k][v]??0)+1;};
  // Newest appearance names the player, so display names follow how the player currently writes theirs.
  const ordered=[...teams].sort((a,b)=>(b.date??'').localeCompare(a.date??'')||a.id.localeCompare(b.id));
  for(const t of ordered){
    let event_id:string|null=null;
    if(t.lane!=='shared'&&t.eventId){event_id=`${t.lane}:${t.eventId}`;
      if(!events.has(event_id)){const src=EVENT_SOURCES[t.lane];events.set(event_id,{id:event_id,lane:t.lane,source_event_id:t.eventId,name:t.event,event_date:t.date,format,players_count:t.players,source:src.source,url:src.url(t.eventId),refreshed_at:refreshedAt});}}
    const pid=playerId(t.player??'');if(pid&&!players.has(pid))players.set(pid,{id:pid,name:t.player.trim(),refreshed_at:refreshedAt});
    const rec=t.record?.match(RECORD);
    out.push({id:t.id,lane:t.lane,event_id,event_label:t.event||null,player_id:pid,player_name:t.player??'',place:t.placing&&t.placing>0?t.placing:null,
      wins:rec?Number(rec[1]):null,losses:rec?Number(rec[2]):null,ties:rec?Number(rec[3]??0):null,source_url:t.sources[0]?.url??'',
      shared_paste_url:t.spreadsFrom?.url??(t.lane==='shared'?t.sources[0]?.url??null:null),observed_on:t.date,refreshed_at:refreshedAt});
    // Sets are the team's six; a list published without sets (none in the current pool) keeps its species only.
    const six:PoolSet[]=t.sets.length?t.sets:t.pokemon.map(species=>({species,item:"",ability:"",nature:"",moves:[]}));
    six.slice(0,6).forEach((s,i)=>{
      const flags:string[]=[];const species=resolveSpecies(s.species);if(!species){flags.push('species');miss('species',s.species);}
      const item=lookup(dex.items,s.item),ability=lookup(dex.abilities,s.ability),nature=lookup(dex.natures,s.nature);
      if(!item.ok){flags.push('item');miss('item',item.value!);}if(!ability.ok){flags.push('ability');miss('ability',ability.value!);}if(!nature.ok){flags.push('nature');miss('nature',nature.value!);}
      // "-" marks an empty move slot in some team sheets; it is not a move.
      const moves=s.moves.filter(m=>plain(m)&&plain(m)!=='-').map(m=>{const r=lookup(dex.moves,m);if(!r.ok)miss('moves',r.value!);return r;});if(moves.some(m=>!m.ok))flags.push('moves');
      const sp=s.statPoints;const name=species??s.species.trim();
      const row:Omit<SetRow,'id'>={species:name,base_species:species?dex.species.get(species).baseSpecies:name,item:item.value,ability:ability.value,nature:nature.value,moves:moves.map(m=>m.value!),
        hp_sp:sp?sp.hp:null,atk_sp:sp?sp.atk:null,def_sp:sp?sp.def:null,spa_sp:sp?sp.spa:null,spd_sp:sp?sp.spd:null,spe_sp:sp?sp.spe:null,unresolved:flags,refreshed_at:refreshedAt};
      const id=hash([row.species,row.item,row.ability,row.nature,row.moves,STATS.map(k=>sp?.[k]??null)]);
      if(!sets.has(id))sets.set(id,{id,...row});members.push({team_id:t.id,slot:i+1,set_id:id});});
  }
  return {events:[...events.values()],players:[...players.values()],sets:[...sets.values()],teams:out,members,unresolved};
}

// Upserts in batches, then removes rows that the current pool no longer contains (older refreshed_at).
async function load(args:string[]){
  const flag=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};const dry=args.includes('--dry-run');
  const env=flag('--env');if(env)process.loadEnvFile(resolve(env));
  const file=resolve(flag('--pool')??resolve(ROOT,'knowledge/pool/teams.json'));
  const pool=JSON.parse(readFileSync(file,'utf8')) as {refreshedAt:string;teams:PoolTeam[]};
  const rows=poolRows(pool.teams,{refreshedAt:pool.refreshedAt});
  const counts={events:rows.events.length,players:rows.players.length,sets:rows.sets.length,teams:rows.teams.length,members:rows.members.length};
  const flagged=Object.fromEntries(Object.entries(rows.unresolved).map(([k,v])=>[k,Object.values(v).reduce((a,b)=>a+b,0)]));
  console.log(`Pool ${file} · refreshed ${pool.refreshedAt}`);console.log('Rows',counts);console.log('Unresolved names (stored as written, flagged)',flagged);
  if(dry){for(const [k,v] of Object.entries(rows.unresolved))if(Object.keys(v).length)console.log(`  ${k}:`,Object.entries(v).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([n,c])=>`${n} ×${c}`).join(', '));return;}
  const url=process.env.SUPABASE_URL??process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
  if(!url||!key)throw new Error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SECRET_KEY are required; pass --env <file>.');
  const {createClient}=await import('@supabase/supabase-js');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const fail=(what:string,error:{message:string}|null)=>{if(error)throw new Error(`${what}: ${error.message}`);};
  const upsert=async(table:string,list:object[],onConflict:string)=>{for(let i=0;i<list.length;i+=500){const {error}=await db.from(table).upsert(list.slice(i,i+500),{onConflict});fail(`${table} upsert`,error);}console.log(`  ${table}: ${list.length} upserted`);};
  const {error:snapErr}=await db.from('pool_snapshots').upsert({refreshed_at:pool.refreshedAt,loaded_at:null,counts,unresolved:flagged},{onConflict:'refreshed_at'});fail('pool_snapshots',snapErr);
  await upsert('pool_events',rows.events,'id');await upsert('pool_players',rows.players,'id');await upsert('pool_sets',rows.sets,'id');
  await upsert('pool_teams',rows.teams,'id');await upsert('pool_team_members',rows.members,'team_id,slot');
  // Stale rows: teams first (members cascade), then whatever only they referenced.
  for(const table of ['pool_teams','pool_sets','pool_events','pool_players']){const {error,count}=await db.from(table).delete({count:'exact'}).neq('refreshed_at',pool.refreshedAt);fail(`${table} cleanup`,error);if(count)console.log(`  ${table}: ${count} stale removed`);}
  const {error:doneErr}=await db.from('pool_snapshots').update({loaded_at:new Date().toISOString()}).eq('refreshed_at',pool.refreshedAt);fail('pool_snapshots',doneErr);
  const {error:oldErr}=await db.from('pool_snapshots').delete().neq('refreshed_at',pool.refreshedAt);fail('pool_snapshots cleanup',oldErr);
  console.log('Loaded.');
}
if(import.meta.main)await load(process.argv.slice(2));
