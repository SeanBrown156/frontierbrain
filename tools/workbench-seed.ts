import {readStore,mutateStore,makeTeam,legacyTeams} from './workbench-store.ts';
import {optionalJSON,save} from './io.ts';
import {usageHistory,cacheArtwork,backfillUsage,refreshEvents} from './workbench-data.ts';
import {loadGames} from './replays.ts';
import {exportText} from './teams.ts';

const db=await readStore();if(!db.teams.length){const pastes=await optionalJSON<{name:string;paste:string}[]>('context/initial-teams.json',[]);const legacy=await legacyTeams();await mutateStore(db.revision,state=>{for(const p of pastes)makeTeam(state,p.name,p.paste);for(const old of legacy)makeTeam(state,old.id,exportText(old.sets,old.format),old.format);});console.log('Initial teams imported; historical sets unconfirmed.');}
const history=await backfillUsage();console.log('History',history);
await refreshEvents();const state=await readStore();const usage=await usageHistory();const games=await loadGames();const names=[...state.bank.flatMap(b=>b.revisions.map(r=>r.set.species)),...usage.flatMap(s=>s.rows.map((r:any)=>r.species)),...games.flatMap(g=>Object.values(g.preview).flat())];
console.log('Artwork',await cacheArtwork(names));await save('reports/runs/workbench-setup.json',{finishedAt:new Date().toISOString(),teams:state.teams.length,bank:state.bank.length,history});
