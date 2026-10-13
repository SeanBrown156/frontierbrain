import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {json,save,optionalJSON,config as profile} from './io.ts';
import {finalStats,damage,speed,speedOrder,spreadSearch,species,VERSIONS} from './mechanics.ts';
import {replayReports,migrateReplays,markReviewed} from './replays.ts';
import {refreshResearch,weeklyReport,sourceIndex,setDistribution,type Source} from './research.ts';
import {teamImport,attachTeam} from './teams.ts';
import {workflowLock} from './workbench-jobs.ts';

const help=`VGC workspace commands:
  sources [category|search]       Source quick reference
  refresh                        Check sources and fetch newest exact-format usage/sets
  weekly                         Refresh and create metagame evidence report
  sets <species> [bo1|bo3] [rating]  Inspect current set distributions
  dex <species>                  Modded Champions species, stats, abilities
  stats <json>                   Exact Champions final stats
  calc <json>                    Damage rolls, ranges, conditional KO probability
  speed <json>                   Explicit speed/priority comparison
  speed-order <json>             Four-way turn order (your two leads vs theirs)
  spread-search <json>           Minimum-SP benchmark search
  team-import <text> <version> [format]  Validate and save immutable candidate
  team-attach <version> <replay>  Explicitly bind known exact team to game
  daily                          Ingest HTML, aggregate and queue coaching
  migrate-replays <directory>    Verified move of saved HTML into workspace
  review-mark <replay> <report>   Mark successfully completed coaching
  status                         Data and replay status
See tools/README.md for inputs and limitations.`;
const [command='help',...args]=process.argv.slice(2);
const input=async()=>{if(!args[0])throw new Error('JSON input file required');return JSON.parse(await readFile(resolve(args[0]),'utf8'));};
try{
  let result:any;
  switch(command){
    case 'help':console.log(help);break;
    case 'sources':{const checks=await optionalJSON<any[]>('knowledge/sources/checks.json',[]);let sources=await sourceIndex(checks);if(args[0])sources=sources.filter(s=>JSON.stringify(s).toLowerCase().includes(args.join(' ').toLowerCase()));result=sources;break;}
    case 'refresh':result=await workflowLock(()=>refreshResearch());break;
    case 'weekly':result=await workflowLock(()=>weeklyReport());break;
    case 'sets':{const config=await profile();result=await setDistribution(args[0],config.format+(args[1]==='bo3'?'bo3':''),args[2]?Number(args[2]):1500);break;}
    case 'dex':{const p=species(args.join(' '));result={name:p.name,baseStats:p.baseStats,types:p.types,abilities:p.abilities,weightkg:p.weightkg,requiredItem:p.requiredItem,versions:VERSIONS};break;}
    case 'stats':{const set=await input();result={set,stats:finalStats(set),versions:VERSIONS};break;}
    case 'calc':result=damage(await input());break;
    case 'speed':result=speed(await input());break;
    case 'speed-order':result=speedOrder(await input());break;
    case 'spread-search':result=spreadSearch(await input());break;
    case 'team-import':result=await teamImport(args[0],args[1],args[2]);break;
    case 'team-attach':result=await workflowLock(()=>attachTeam(args[0],args[1]));break;
    case 'daily':result=await workflowLock(()=>replayReports());break;
    case 'migrate-replays':if(!args[0])throw new Error('Explicit source directory required');result=await migrateReplays(args[0]);break;
    case 'review-mark':result=await markReviewed(args[0],args[1]);break;
    case 'status':result={versions:VERSIONS,replays:await optionalJSON('replays/index.json',null),metagame:await optionalJSON('knowledge/metagame/latest.json',null)};break;
    default:throw new Error(`Unknown command ${command}\n${help}`);
  }
  if(result!==undefined)console.log(JSON.stringify(result,null,2));
}catch(e){console.error((e as Error).message);process.exitCode=1;}
