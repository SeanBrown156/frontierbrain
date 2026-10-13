// Publish a team's export to pokepast.es. This is a public, outward action: callers only run it when the player asked
// (the app's "Create PokePaste" button, or the MCP create_pokepaste tool with the player's agreement).
import {teamPaste} from './workbench-store.ts';
import type {Workbench} from '../shared/workbench.ts';

const clip=(v:string,n:number)=>v.slice(0,n);
export async function createPokepaste(db:Workbench,input:{teamId:string;versionId?:string;configurationId?:string;author?:string;notes?:string},post:typeof fetch=fetch){
  const team=db.teams.find(t=>t.id===input.teamId);if(!team)throw new Error('Team not found');
  const paste=teamPaste(db,team,input.versionId,input.configurationId);
  const form=new URLSearchParams({paste,title:clip(team.name,100),author:clip(String(input.author??''),60),notes:clip(String(input.notes??''),1000)});
  const r=await post('https://pokepast.es/create',{method:'POST',body:form,redirect:'manual',signal:AbortSignal.timeout(15000)});const link=r.headers.get('location');
  if(!link||!/^https:\/\/pokepast\.es\/[a-f0-9]+$/.test(link))throw new Error(`PokePaste didn't return a link (HTTP ${r.status})`);
  return {url:link,name:team.name};
}
