import {hash} from './io.ts';
import {currentTeam} from './workbench-store.ts';
import {coachStats} from './workbench-data.ts';
import type {Workbench,ReviewScope,CoachingReview} from '../shared/workbench.ts';
import type {Game} from './replays.ts';

export function associationFingerprint(db:Workbench,ids:string[]){return hash(JSON.stringify(ids.map(id=>[id,db.associations[id]??null])));}
export function freezeReviewScope(db:Workbench,games:Game[],input:ReviewScope){
  if(!Array.isArray(input.replayIds)||input.replayIds.length>200||new Set(input.replayIds).size!==input.replayIds.length)throw new Error('Choose up to 200 distinct replay IDs');
  const selected=input.replayIds.map(id=>{const game=games.find(g=>g.id===id);if(!game)throw new Error('Unknown replay');return game;});
  let team=null;const scope:ReviewScope={replayIds:[...input.replayIds]};
  if(input.teamId){const t=db.teams.find(t=>t.id===input.teamId);if(!t)throw new Error('Unknown review team');const view=currentTeam(db,t,input.versionId,input.configurationId);scope.teamId=t.id;scope.versionId=view.version.id;scope.configurationId=view.configuration.id;team={name:t.name,format:t.format,...view};}
  else if(input.configurationId||input.versionId)throw new Error('A review configuration needs a team');
  if(!selected.length&&!team)throw new Error('Select games or a team configuration');
  for(const g of selected){const a=db.associations[g.id];if(scope.configurationId&&(a?.certainty!=='exact'||a.configurationId!==scope.configurationId))throw new Error('Configuration reviews require exact linked games; review uncertain games separately');}
  const associations=Object.fromEntries(selected.map(g=>[g.id,db.associations[g.id]??null]));
  const exactTeams=Object.fromEntries(selected.filter(g=>associations[g.id]?.certainty==='exact').map(g=>{const a=associations[g.id]!;const t=db.teams.find(t=>t.id===a.teamId)!;return [g.id,currentTeam(db,t,a.versionId,a.configurationId)];}));
  return structuredClone({scope,associationFingerprint:associationFingerprint(db,scope.replayIds),team,associations,exactTeams,games:selected,stats:coachStats(selected)});
}
export function validateReview(value:any,snapshot:ReturnType<typeof freezeReviewScope>,id:string):CoachingReview{
  if(!value||!Array.isArray(value.findings)||!Array.isArray(value.limitations)||typeof value.report!=='string'||!['complete','partial'].includes(value.status))throw new Error('Coach output is missing structured findings, limitations or report');
  if(value.report.length>150000||value.findings.length>100||value.limitations.length>50||value.limitations.some((x:any)=>typeof x!=='string'||x.length>5000))throw new Error('Invalid coach output size');
  for(const f of value.findings){if(!['play','building','variance'].includes(f.category)||!['high','medium','low'].includes(f.confidence)||['title','detail','practiceGoal'].some(k=>typeof f[k]!=='string')||!Array.isArray(f.evidence))throw new Error('Invalid coaching finding');
    if(f.title.length>300||f.detail.length>20000||f.practiceGoal.length>5000||f.evidence.length>100||f.experiment!==undefined&&(typeof f.experiment!=='string'||f.experiment.length>10000))throw new Error('Invalid coaching finding size or experiment');
    for(const e of f.evidence){const g=snapshot.games.find(g=>g.id===e.replayId);if(!g||!g.events.some(event=>event.line===e.line&&event.turn===e.turn))throw new Error('Coaching evidence must reference a selected replay event and its turn');}
    if(f.category!=='building'&&!f.evidence.length)throw new Error('Play/variance findings need replay evidence');
  }
  return {id,createdAt:new Date().toISOString(),scope:snapshot.scope,associationFingerprint:snapshot.associationFingerprint,status:value.status,findings:value.findings,limitations:value.limitations,report:value.report};
}
