import {readFile,readdir,mkdir,copyFile,unlink,stat} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {ROOT,hash,id,json,optionalJSON,save,stamp,markdown,workspacePath,dataPath,listDir,readText,modifiedAt,config as profile} from './io.ts';

export interface Event {line:number;turn:number;type:string;args:string[];raw:string;}
export interface Mon {key:string;species:string;nickname:string;hp?:{value:number;max:number|null;precision:'exact'|'percent'|'unknown'};status?:string;boosts:Record<string,number>;moves:string[];ability?:string;item?:string;fainted?:boolean;volatiles:string[];}
export interface Game {schemaVersion:1;parserVersion:3;id:string;logHash:string;source:string;players:Record<string,{name:string;rating?:number}>;ownSide:string;format:string;date:string|null;result:'win'|'loss'|'tie'|'incomplete';winner:string|null;preview:Record<string,string[]>;leads:Record<string,string[]>;revealed:Record<string,string[]>;selectedSize:Record<string,number>;unknownBackSlots:Record<string,number>;rosterGroup:string;teamVersion:string|null;teamSheets:'available'|'not-recorded';events:Event[];turns:any[];finalState:any;warnings:string[];ratingAfter?:number;}
export function extractLog(html:string):{log:string;replayID:string|null} {
  const tags=html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);let log:string|null=null;
  for(const m of tags)if(/class\s*=\s*["'][^"']*\bbattle-log-data\b[^"']*["']/i.test(m[1])){log=m[2];break;}
  if(log===null)throw new Error('No embedded battle-log-data script. Save with Showdown’s Download button.');
  log=log.replace(/\\\//g,'/').replace(/\r\n?/g,'\n').trim();
  const replayID=html.match(/name=["']replayid["'][^>]*value=["']([^"']+)["']/i)?.[1]??null;
  return {log,replayID};
}
export function parseReplay(html:string,source:string,player:string,aliases:string[]=[]):Game {
  const {log,replayID}=extractLog(html);const logHash=hash(log);
  const events:Event[]=[];let turn=0;
  for(const [i,line]of log.split('\n').entries()){if(!line.startsWith('|'))continue;const [,type,...args]=line.split('|');if(type==='turn')turn=Number(args[0]);events.push({line:i+1,turn,type,args,raw:line});}
  const players:Game['players']={};const preview:Game['preview']={p1:[],p2:[]};const selectedSize:Game['selectedSize']={};
  for(const e of events){if(e.type==='player'&&e.args[1])players[e.args[0]]={name:e.args[1],rating:e.args[3]?Number(e.args[3]):undefined};if(e.type==='poke')preview[e.args[0]]?.push(e.args[1].split(',')[0]);if(e.type==='teamsize')selectedSize[e.args[0]]=Number(e.args[1]);}
  const ownSide=Object.keys(players).find(s=>[player,...aliases].some(p=>id(p)===id(players[s].name)));
  if(!ownSide)throw new Error(player?`Player ${player} not found; this file may be a reference game. Add your other Showdown names as aliases on the Teams page.`:'Add your Showdown name on the Teams page first, so Frontier Brain knows which side of the replay is you.');
  const leads:Game['leads']={p1:[],p2:[]},revealed:Game['revealed']={p1:[],p2:[]};const mons:Record<string,Mon>={};const active:Record<string,string>={};
  const state:any={active,mons,weather:null,terrain:null,rooms:[],sideConditions:{p1:[],p2:[]}};const turns:any[]=[];const warnings:string[]=[];const leadKeys:Record<string,string[]>={p1:[],p2:[]};
  function hp(text:string|undefined,side:string):Mon['hp'] {
    if(text===undefined)return undefined;
    if(text==='0 fnt'||text.startsWith('0 '))return {value:0,max:null,precision:'unknown'};
    const m=text.match(/^(\d+)\/(\d+)/);return m?{value:Number(m[1]),max:Number(m[2]),precision:Number(m[2])===100?'percent':Number(m[2])>100?'exact':'unknown'}:undefined;
  }
  function mon(ident:string){const current=mons[active[ident.slice(0,3)]];if(current)return current;const key=`${ident.slice(0,2)}:${ident.split(': ').slice(1).join(': ')}`;return mons[key];}
  let started=false;
  for(const e of events){const a=e.args;const side=a[0]?.slice(0,2);
    if(e.type==='start')started=true;
    if(e.type==='split')warnings.push(`Line ${e.line}: split-view protocol; raw private/public event duplication requires review`);
    if(e.type==='turn'){turns.push({turn:e.turn,knowledgeBefore:structuredClone(state),events:[]});}
    if(e.turn&&turns.length)turns.at(-1).events.push(e.line);
    if(['switch','drag','replace'].includes(e.type)){
      const nickname=a[0].split(': ').slice(1).join(': ');let key=`${side}:${nickname}`;const p=a[1].split(',')[0];
      const previous=mons[active[a[0].slice(0,3)]];
      if(e.type==='replace'&&previous){key=previous.key;previous.nickname=nickname;previous.species=p;const leadIndex=leadKeys[side].indexOf(key);if(leadIndex>=0)leads[side][leadIndex]=p;}
      else if(Object.entries(active).some(([slot,k])=>slot!==a[0].slice(0,3)&&k===key))key+=`:${a[0].slice(0,3)}`;
      if(previous&&e.type!=='replace'){previous.boosts={};previous.volatiles=[];}
      mons[key]??={key,species:p,nickname,boosts:{},moves:[],volatiles:[]};mons[key].species=p;if(a[2]){mons[key].hp=hp(a[2],side);mons[key].status=a[2].split(' ')[1]??'';}mons[key].fainted=false;
      active[a[0].slice(0,3)]=key;
      const base=preview[side]?.find(x=>p===x||p.startsWith(x+'-Mega'))??p;
      if(!revealed[side].includes(base))revealed[side].push(base);
      if(started&&!e.turn&&leads[side].length<2&&e.type==='switch'){leads[side].push(base);leadKeys[side].push(key);}
      if(e.type==='replace')warnings.push(`Line ${e.line}: identity replacement/Illusion; roster and move attribution needs review`);
    }
    const p=mon(a[0]??'');
    if(p){
      if(['-damage','-heal','-sethp'].includes(e.type)){p.hp=hp(a[1],side);if(a[1].split(' ')[1])p.status=a[1].split(' ')[1];}
      if(e.type==='move'&&!p.moves.includes(a[1]))p.moves.push(a[1]);
      if(e.type==='faint'){p.fainted=true;p.hp={value:0,max:p.hp?.max??null,precision:p.hp?.precision??'unknown'};delete active[a[0].slice(0,3)];}
      if(e.type==='-status')p.status=a[1];if(e.type==='-curestatus')p.status='';
      if(e.type==='-ability')p.ability=a[1];if(e.type==='-item')p.item=a[1];if(e.type==='-enditem')p.item='consumed/revealed: '+a[1];
      if(e.type==='detailschange'||e.type==='-formechange')p.species=a[1].split(',')[0];
      if(e.type==='-boost'||e.type==='-unboost')p.boosts[a[1]]=Math.max(-6,Math.min(6,(p.boosts[a[1]]??0)+(e.type==='-boost'?1:-1)*Number(a[2])));
      if(e.type==='-setboost')p.boosts[a[1]]=Number(a[2]);if(e.type==='-clearboost')p.boosts={};
      if(e.type==='-start'){if(/^perish\d+$/.test(a[1]))p.volatiles=p.volatiles.filter(v=>!/^perish\d+$/.test(v));if(!p.volatiles.includes(a[1]))p.volatiles.push(a[1]);}if(e.type==='-end')p.volatiles=p.volatiles.filter(v=>v!==a[1]);
    }
    if(e.type==='-clearallboost')for(const p of Object.values(mons))p.boosts={};
    if(e.type==='-weather')state.weather=a[0]==='none'?null:a[0];
    const fieldEffect=a[0]?.replace(/^move:\s*/,'');
    if(e.type==='-fieldstart'){if(fieldEffect.includes('Terrain'))state.terrain=fieldEffect;else if(!state.rooms.includes(fieldEffect))state.rooms.push(fieldEffect);}
    if(e.type==='-fieldend'){if(state.terrain===fieldEffect)state.terrain=null;state.rooms=state.rooms.filter((r:string)=>r!==fieldEffect);}
    if(e.type==='-sidestart')state.sideConditions[side]?.push(a[1]);if(e.type==='-sideend')state.sideConditions[side]=state.sideConditions[side]?.filter((v:string)=>v!==a[1]);
    if(['-transform','-swapboost','-copyboost','-invertboost','-clearpositiveboost','-clearnegativeboost'].includes(e.type))warnings.push(`Line ${e.line}: ${e.type} requires reading raw events; simplified state does not model this operation`);
  }
  const winner=events.find(e=>e.type==='win')?.args[0]??null;const tied=events.some(e=>e.type==='tie');
  const format=events.find(e=>e.type==='tier')?.args[0]??'unknown';const timestamp=events.find(e=>e.type==='t:')?.args[0];
  const group=hash([...preview[ownSide]].sort().join('|')).slice(0,12);
  const ratingLine=events.find(e=>e.type==='raw'&&e.args.join('|').includes(`${players[ownSide].name}'s rating:`));
  const ratingAfter=ratingLine?.raw.match(/→\s*(?:<[^>]+>)*(\d+)/)?.[1];
  return {schemaVersion:1,parserVersion:3,id:replayID&&/^[a-z0-9-]+$/i.test(replayID)?replayID:`local-${logHash.slice(0,20)}`,logHash,source,players,ownSide,format,date:timestamp&&Number.isFinite(Number(timestamp))?new Date(Number(timestamp)*1000).toISOString():null,result:tied?'tie':winner?id(winner)===id(players[ownSide].name)?'win':'loss':'incomplete',winner,preview,leads,revealed,selectedSize,unknownBackSlots:Object.fromEntries(['p1','p2'].map(s=>[s,Math.max(0,(selectedSize[s]??4)-revealed[s].length)])),rosterGroup:group,teamVersion:null,teamSheets:events.some(e=>e.type==='showteam')?'available':'not-recorded',events,turns,finalState:state,warnings:[...new Set(warnings)],ratingAfter:ratingAfter?Number(ratingAfter):undefined};
}

export interface IndexEntry {id:string;logHash:string;source:string;parsed:string;rosterGroup:string;teamVersion:string|null;reviewedAt:string|null;reviewPath:string|null;}
export interface ReplayIndex {schemaVersion:1;games:IndexEntry[];errors:{source:string;error:string}[];lastScan?:string;}
// One saved original into the index (parsed copy plus index entry). Works for local files and hosted rows alike.
async function indexOriginal(index:ReplayIndex,source:string,html:string,config:Awaited<ReturnType<typeof profile>>,added:string[]){
  const game=parseReplay(html,source,config.player,config.aliases);
  const existing=index.games.find(e=>e.logHash===game.logHash);
  if(existing){
    const old=await json<Game>(existing.parsed);
    if(old.parserVersion!==game.parserVersion){game.id=existing.id;game.source=existing.source;game.teamVersion=existing.teamVersion;await save(existing.parsed,game);existing.reviewedAt=null;existing.reviewPath=null;}
    return {duplicate:true,id:existing.id};
  }
  if(index.games.some(g=>g.id===game.id))throw new Error(`Replay ID conflict for ${game.id}: different logs; retain originals and inspect`);
  const parsed=`replays/parsed/${game.id}.json`;await save(parsed,game);
  index.games.push({id:game.id,logHash:game.logHash,source,parsed,rosterGroup:game.rosterGroup,teamVersion:null,reviewedAt:null,reviewPath:null});added.push(game.id);
  return {duplicate:false,id:game.id};
}
const emptyIndex=():ReplayIndex=>({schemaVersion:1,games:[],errors:[]});
// Save one uploaded replay: original first (never overwritten), then its parsed copy and index entry.
export async function addReplay(html:string,filename:string){
  const config=await profile();const folder=dataPath(config.replayFolder);const index=await optionalJSON<ReplayIndex>('replays/index.json',emptyIndex());
  const source=`${folder}/${filename}`;if(!(await modifiedAt(source)))await save(source,html);
  const added:string[]=[];const result=await indexOriginal(index,source,html,config,added);await save('replays/index.json',index);return {...result,index,added};
}
export async function ingest() {
  const config=await profile();const folder=dataPath(config.replayFolder);
  const index=await optionalJSON<ReplayIndex>('replays/index.json',emptyIndex());const added:string[]=[];let duplicates=0;index.errors=[];
  for(const file of (await listDir(folder)).filter(f=>/\.html?$/i.test(f)).sort()){
    const source=`${folder}/${file}`;
    try{const r=await indexOriginal(index,source,await readText(source),config,added);if(r.duplicate)duplicates++;}
    catch(e){index.errors.push({source,error:(e as Error).message});}
  }
  index.lastScan=new Date().toISOString();await save('replays/index.json',index);
  return {index,added,duplicates,errors:index.errors};
}

export async function migrateReplays(source:string) {
  const from=resolve(source);const destination=resolve(ROOT,'replays/originals');
  if(from===ROOT||from==='/'||from===destination)throw new Error('Refusing broad or identical migration source');
  if(!(await stat(from)).isDirectory())throw new Error('Migration source must be an explicit directory');
  await mkdir(destination,{recursive:true});const entries=[];
  for(const name of (await readdir(from)).filter(f=>/\.html?$/i.test(f)).sort()){
    const path=join(from,name);if(!(await stat(path)).isFile())continue;
    const bytes=await readFile(path);extractLog(bytes.toString());const target=join(destination,name);
    try{await copyFile(path,target,1);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    if(hash(await readFile(target))!==hash(bytes))throw new Error(`Destination conflict or checksum mismatch: ${name}; source preserved`);
    entries.push({name,bytes:bytes.length,sha256:hash(bytes),source:path,destination:target});
  }
  const journal=`replays/migrations/${stamp()}.json`;await save(journal,{phase:'verified',entries});
  // Verify again before removing only each exact copied source file; folder stays intact.
  for(const entry of entries){if(hash(await readFile(entry.source))!==entry.sha256)throw new Error(`Source changed: ${entry.name}`);await unlink(entry.source);}
  await save(journal,{phase:'complete',entries});return {moved:entries.length,journal};
}

function countRecord(){return {games:0,wins:0,losses:0,ties:0};}
export function aggregate(games:Game[]) {
  const groups:Record<string,any>={};
  for(const g of games){const key=`${g.format}::${g.teamVersion??'roster:'+g.rosterGroup}`;const o=groups[key]??={...countRecord(),roster:g.preview[g.ownSide],format:g.format,teamVersion:g.teamVersion,provisional:!g.teamVersion,leads:{},bring:{},matchups:{},moveUsage:{},ratings:[]};
    if(g.result==='incomplete')continue;o.games++;if(g.result==='win')o.wins++;if(g.result==='loss')o.losses++;if(g.result==='tie')o.ties++;
    const pair=[...g.leads[g.ownSide]].sort().join(' + ');o.leads[pair]??=countRecord();o.leads[pair].games++;if(g.result==='win')o.leads[pair].wins++;if(g.result==='loss')o.leads[pair].losses++;if(g.result==='tie')o.leads[pair].ties++;
    for(const p of g.revealed[g.ownSide]){o.bring[p]??={observedGames:0,wins:0};o.bring[p].observedGames++;if(g.result==='win')o.bring[p].wins++;}
    const other=g.ownSide==='p1'?'p2':'p1';for(const p of g.preview[other]){o.matchups[p]??={previewGames:0,wins:0,observedBrought:0,unknownSelections:0};o.matchups[p].previewGames++;if(g.result==='win')o.matchups[p].wins++;if(g.revealed[other].includes(p))o.matchups[p].observedBrought++;else if(g.unknownBackSlots[other])o.matchups[p].unknownSelections++;}
    for(const e of g.events.filter(e=>e.type==='move'&&e.args[0].startsWith(g.ownSide))){const key=e.args[0].split(': ').slice(1).join(': ')+': '+e.args[1];o.moveUsage[key]=(o.moveUsage[key]??0)+1;}
    if(g.players[g.ownSide].rating!==undefined)o.ratings.push(g.players[g.ownSide].rating);
  }
  for(const o of Object.values(groups)){o.winRate=o.games?o.wins/o.games:null;for(const v of Object.values(o.matchups) as any[]){v.highlightEligible=v.previewGames>=4;v.attendanceLowerBound=v.observedBrought/v.previewGames;v.attendanceUpperBound=(v.observedBrought+v.unknownSelections)/v.previewGames;}}
  return {groups,notes:'Roster groups are provisional, not exact set versions. Bring counts are observed lower bounds when back slots are unseen. Win rates are descriptive and have small samples; attendance records bounds, not invented selections.'};
}
export async function loadGames(){const index=await optionalJSON<ReplayIndex>('replays/index.json',emptyIndex());return Promise.all(index.games.map(g=>json<Game>(g.parsed)));}
export async function replayReports() {
  const result=await ingest();const games=await loadGames();const stats=aggregate(games);await save('reports/replay-reviews/statistics.json',stats);
  let overview='# Replay overview\n\n'+`${games.length} saved games. ${result.added.length} newly ingested. ${result.errors.length} ingestion errors.\n\n${stats.notes}\n\n`;
  overview+='| Roster | Games | W–L–T | Win rate | Version |\n| --- | ---: | --- | ---: | --- |\n';
  for(const [key,g]of Object.entries(stats.groups))overview+=`| ${g.roster.map(markdown).join(' / ')} | ${g.games} | ${g.wins}–${g.losses}–${g.ties} | ${(g.winRate*100).toFixed(1)}% | ${g.teamVersion??'provisional roster'} |\n`;
  overview+='\n## Games\n\n';
  for(const game of games){const other=game.ownSide==='p1'?'p2':'p1';overview+=`- [${game.id}](games/${game.id}.md): ${game.result}, vs ${markdown(game.players[other].name)}, ${game.turns.length} turns.\n`;
    const flags=game.events.filter(e=>['-crit','-miss','cant','-fail','-immune','-mega','-fieldstart','faint'].includes(e.type));
    let report=`# ${game.id}\n\n[Original replay](../../../${game.source.split('/').map(encodeURIComponent).join('/')}) · [Parsed log](../../../replays/parsed/${game.id}.json)\n\n${game.format}; ${game.date??'date unknown'}. ${game.players[game.ownSide].name} vs ${game.players[other].name}. Result: ${game.result}.\n\n`;
    report+=`Your preview: ${game.preview[game.ownSide].join(' / ')}.\n\nYour lead: ${game.leads[game.ownSide].join(' + ')}. Observed selections: ${game.revealed[game.ownSide].join(', ')}; ${game.unknownBackSlots[game.ownSide]} unseen slot(s). Opposing lead: ${game.leads[other].join(' + ')}. Opponent: ${game.preview[other].join(' / ')}.\n\nExact team version: ${game.teamVersion??'not attached; spread tuning awaits paste'}. Team sheets: ${game.teamSheets}.\n\n`;
    report+='## Observed sequence\n\n';for(const t of game.turns){const moves=game.events.filter(e=>e.turn===t.turn&&e.type==='move');report+=`- Turn ${t.turn}: ${moves.map(e=>`${markdown(e.args[0])} used ${markdown(e.args[1])}${e.args[2]?' → '+markdown(e.args[2]):''} (log line ${e.line})`).join('; ')}.\n`;}
    report+='\n## Review points from recorded events\n\n';for(const e of flags)report+=`- Turn ${e.turn}, log line ${e.line}: ${markdown(e.raw)}\n`;
    const review=result.index.games.find(g=>g.id===game.id);
    report+='\n## Coaching status\n\n';
    if(review?.reviewedAt&&review.reviewPath){const link=relative(resolve(ROOT,'reports/replay-reviews/games'),workspacePath(review.reviewPath));report+=`Reviewed ${review.reviewedAt}: [coaching report](${link}).\n`;}
    else report+='This is an observed summary and review queue, not completed strategic coaching. Review preview and turning points against `knowledgeBefore` in parsed JSON. Distinguish risk/variance from mistakes; do not infer unknown moves or spreads.\n';
    if(game.warnings.length)report+='\nParser limitations: '+game.warnings.join('; ')+'\n';
    await save(`reports/replay-reviews/games/${game.id}.md`,report);
  }
  await save('reports/replay-reviews/overview.md',overview);
  const pending=result.index.games.filter(g=>!g.reviewedAt);await save('reports/replay-reviews/pending.json',pending);
  const run={at:new Date().toISOString(),added:result.added,pending:pending.map(p=>p.id),errors:result.errors};await save(`reports/runs/daily-${stamp()}.json`,run);
  return run;
}
export async function markReviewed(replayID:string,path:string){
  const absolute=workspacePath(path);if(!relative(resolve(ROOT,'reports'),absolute)||relative(resolve(ROOT,'reports'),absolute).startsWith('..'))throw new Error('Coaching report must be in reports/');
  const content=await readFile(absolute,'utf8');if(!content.includes(replayID))throw new Error('Report must explicitly reference the reviewed replay ID');const index=await json<ReplayIndex>('replays/index.json');const entry=index.games.find(g=>g.id===replayID);if(!entry)throw new Error('Unknown replay ID');
  entry.reviewedAt=new Date().toISOString();entry.reviewPath=relative(ROOT,workspacePath(path));await save('replays/index.json',index);await save('reports/replay-reviews/pending.json',index.games.filter(g=>!g.reviewedAt));return entry;
}
