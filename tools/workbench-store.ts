import {ownSide,autoTitle} from '../shared/benchmarks.ts';
import {autoLink} from './replay-link.ts';
import {FORMATS} from '../shared/formats.ts';
import {readFile,mkdir,writeFile,rename,rm,readdir,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT,dataContext} from './io.ts';
import {dex,points,finalStats,validateTeam,FORMAT,damage,speed,spreadSearch} from './mechanics.ts';
import {importText,exportText} from './teams.ts';
import type {Workbench,Slot,SetNotes,SetRevision,PokemonSet,Formula,Configuration,TeamCoaching} from '../shared/workbench.ts';
import type {Game} from './replays.ts';

export const emptyStore=():Workbench=>({schemaVersion:1,revision:0,bank:[],teams:[],associations:{},matches:[],benchmarks:[]});
const uid=(prefix:string)=>`${prefix}-${randomUUID().slice(0,12)}`;
const now=()=>new Date().toISOString();
export class Conflict extends Error {}
// The whole workspace moved on (another tab, an AI job, a connector). Saves retry on the latest copy; per-record
// checks (a set's base revision, coaching version) still catch real edit clashes.
export class StaleWorkspace extends Conflict {}
export const blankNotes=():SetNotes=>({role:'',benchmarks:'',partners:'',matchups:''});
export function checkText(value:unknown,max=30000):string {if(typeof value!=='string'||value.length>max)throw new Error('Expected bounded text');return value;}
export const cleanSet=(input:PokemonSet)=>checkSet(input,false);
// Observed (replay-derived) sets may hold fewer than four moves; nothing unseen is filled in as fact.
export const cleanObservedSet=(input:PokemonSet)=>checkSet(input,true);
function checkSet(input:PokemonSet,partialMoves:boolean):PokemonSet {
  if(!input||typeof input.species!=='string')throw new Error('Species is required');
  const set:PokemonSet={species:checkText(input.species,100),nature:checkText(input.nature??'Serious',100),statPoints:points(input.statPoints),ability:checkText(input.ability??'',100),item:checkText(input.item??'',100),moves:(input.moves??[]).map(m=>checkText(m,100))};
  if(partialMoves?set.moves!.length<1||set.moves!.length>4:set.moves!.length!==4)throw new Error(partialMoves?'An observed set needs one to four moves':'Choose four moves');if(input.nickname)set.nickname=checkText(input.nickname,100);if(input.gender)set.gender=checkText(input.gender,10);
  for(const move of set.moves!)if(!dex.moves.get(move).exists)throw new Error(`Unknown move: ${move}`);
  if(set.item&&!dex.items.get(set.item).exists)throw new Error(`Unknown item: ${set.item}`);
  if(set.ability&&!dex.abilities.get(set.ability).exists)throw new Error(`Unknown ability: ${set.ability}`);
  finalStats(set);return set;
}
function cleanNotes(notes:SetNotes):SetNotes {return Object.fromEntries(Object.keys(blankNotes()).map(k=>[k,checkText(notes?.[k as keyof SetNotes]??'')])) as unknown as SetNotes;}
export function resolveSlots(db:Workbench,slots:Slot[]):PokemonSet[] {
  if(!Array.isArray(slots)||slots.length!==6)throw new Error('A formula needs six slots');
  return slots.map(s=>{const entry=db.bank.find(b=>b.id===s.bankId);const revision=entry?.revisions.find(r=>r.id===s.revisionId);if(!revision)throw new Error('Unknown bank revision');return revision.set;});
}
export function validation(sets:PokemonSet[],format=FORMAT):string[] {try{validateTeam(sets,format);return [];}catch(e){return [(e as Error).message];}}
export function currentTeam(db:Workbench,team:Formula,versionId=team.activeVersionId,configurationId?:string) {
  const version=team.versions.find(v=>v.id===versionId);if(!version)throw new Error('Unknown formula version');
  const configuration=version.configurations.find(c=>c.id===(configurationId??version.currentConfigurationId));if(!configuration)throw new Error('Unknown configuration');
  const sets=resolveSlots(db,configuration.slots);return {version,configuration,sets,errors:validation(sets,team.format)};
}
export function makeTeam(db:Workbench,name:string,paste:string,format=FORMAT,extra:{notes?:string;setNotes?:Record<string,Partial<SetNotes>>}={}):Formula {
  const sets=importText(checkText(paste)).map(cleanSet);if(sets.length!==6)throw new Error('Paste must contain six Pokémon');
  const slots=sets.map(set=>{const existing=db.bank.find(b=>JSON.stringify(b.revisions.at(-1)?.set)===JSON.stringify(set));if(existing)return {bankId:existing.id,revisionId:existing.revisions.at(-1)!.id};
    const revision={id:uid('set'),number:1,createdAt:now(),set,notes:{...blankNotes(),...cleanNotes({...blankNotes(),...(extra.setNotes?.[set.species]??extra.setNotes?.[dex.species.get(set.species).baseSpecies])} as SetNotes)},provenance:'paste' as const};const entry={id:uid('bank'),name:`${set.species} · ${name}`,revisions:[revision]};db.bank.push(entry);return {bankId:entry.id,revisionId:revision.id};});
  const config:Configuration={id:uid('config'),createdAt:now(),slots};const version={id:uid('formula'),number:1,createdAt:now(),notes:extra.notes?checkText(extra.notes):'Imported paste.',configurations:[config],currentConfigurationId:config.id};
  const team:Formula={id:uid('team'),name:checkText(name,120).trim()||'Untitled team',format,versions:[version],activeVersionId:version.id};db.teams.push(team);return team;
}
// Editing an observed (replay-rebuilt) set keeps unedited guesses marked as inferred; only what the player changed or
// saw in battle becomes known. Once nothing is inferred the revision is an ordinary manual set.
const certaintyFields=['item','ability','nature','statPoints'] as const;
export function certainty(prev:SetRevision,set:PokemonSet):Pick<SetRevision,'provenance'|'fields'|'knownMoves'>{
  if(prev.provenance!=='observed'||!prev.fields)return {provenance:'manual'};
  const fields:NonNullable<SetRevision['fields']>={};
  for(const k of certaintyFields)fields[k]=JSON.stringify(prev.set[k]??null)===JSON.stringify(set[k]??null)?(prev.fields[k]??'known'):'known';
  const knownMoves=(set.moves??[]).filter(m=>prev.knownMoves?.includes(m)||!prev.set.moves?.includes(m));
  fields.moves=knownMoves.length===(set.moves??[]).length?'known':'inferred';
  return Object.values(fields).some(v=>v!=='known')?{provenance:'observed',fields,knownMoves}:{provenance:'manual'};
}
const AMEND_WINDOW=30*60_000;
function amendable(db:Workbench,team:Formula,old:ReturnType<typeof currentTeam>,prev:SetRevision,set:PokemonSet){
  const fresh=(t:string)=>Date.now()-Date.parse(t)<AMEND_WINDOW;
  if(!fresh(prev.createdAt)||!fresh(old.configuration.createdAt)||prev.starred)return false;
  if(dex.species.get(prev.set.species).baseSpecies!==dex.species.get(set.species).baseSpecies)return false;
  if((db.benchmarks??[]).some(b=>b.revisionId===prev.id))return false;
  if(Object.values(db.associations).some(a=>a.configurationId===old.configuration.id))return false;
  const uses=db.teams.flatMap(t=>t.versions.flatMap(v=>v.configurations)).filter(c=>c.slots.some(s=>s.revisionId===prev.id)).length;
  return uses===1&&old.version.configurations.at(-1)?.id===old.configuration.id&&team.versions.some(v=>v.id===old.version.id);
}
export function applyAction(db:Workbench,action:any):unknown {
  if(!action||typeof action.type!=='string')throw new Error('Action required');
  if(action.type==='benchmark-save'){
    const entry=db.bank.find(b=>b.id===action.bankId);if(!entry?.revisions.some(r=>r.id===action.revisionId))throw new Error('Unknown benchmark revision');
    const methods={damage,speed,spread:spreadSearch};if(!Object.hasOwn(methods,action.kind))throw new Error('Unknown benchmark kind');
    const result=methods[action.kind as keyof typeof methods](action.input);
    const sources=(action.sources??[]).map((s:unknown)=>{const url=checkText(s,2000);if(!/^https?:\/\//.test(url))throw new Error('Source must be an HTTP URL');return url;});
    const species=entry.revisions.find(r=>r.id===action.revisionId)!.set.species;const side=action.side??ownSide({kind:action.kind,input:action.input},species);if(!['attacker','defender','a'].includes(side))throw new Error('Unknown benchmark side');
    const benchmark={id:uid('benchmark'),bankId:entry.id,revisionId:action.revisionId,createdAt:now(),title:checkText(action.title||autoTitle(action.kind,side,action.input),200),kind:action.kind,input:structuredClone(action.input),result,context:checkText(action.context??''),sources,side};(db.benchmarks??=[]).push(benchmark);return benchmark;
  }
  if(action.type==='benchmark-delete'){const before=(db.benchmarks??[]).length;db.benchmarks=(db.benchmarks??[]).filter(b=>b.id!==action.benchmarkId);if(db.benchmarks.length===before)throw new Error('Benchmark not found');return {deleted:action.benchmarkId};
  }
  // Deleting a team removes it with its versions, strategy and replay links. Its sets stay in the Pokémon library
  // and the replays stay saved (unlinked), so nothing played is lost.
  if(action.type==='team-delete'){const i=db.teams.findIndex(t=>t.id===action.teamId);if(i<0)throw new Error('Team not found');db.teams.splice(i,1);if(db.coaching)delete db.coaching[action.teamId];
    const replays:string[]=[];for(const [id,a] of Object.entries(db.associations))if(a.teamId===action.teamId){delete db.associations[id];replays.push(id);}db.matches=db.matches.filter(m=>!m.replayIds.some(r=>replays.includes(r)));return {deleted:action.teamId,unlinked:replays.length,replays};}
  if(action.type==='import')return makeTeam(db,action.name,action.paste,action.format??FORMAT,{notes:action.notes,setNotes:action.setNotes&&typeof action.setNotes==='object'&&!Array.isArray(action.setNotes)?action.setNotes:undefined});
  if(action.type==='bank-import'){const sets=importText(checkText(action.paste));if(sets.length!==1)throw new Error('Paste one Pokémon for a bank entry');return applyAction(db,{type:'bank-create',name:action.name,set:sets[0],notes:blankNotes()});}
  if(action.type==='bank-create'){const set=cleanSet(action.set);const revision={id:uid('set'),number:1,createdAt:now(),set,notes:cleanNotes(action.notes)};const entry={id:uid('bank'),name:checkText(action.name,120),revisions:[revision]};db.bank.push(entry);return entry;}
  if(action.type==='bank-revise'){
    const entry=db.bank.find(b=>b.id===action.bankId);if(!entry)throw new Error('Set not found');if(entry.revisions.at(-1)!.id!==action.parentRevisionId)throw new Conflict('This set has a newer revision. Reload before saving.');
    const revision={id:uid('set'),number:entry.revisions.length+1,createdAt:now(),set:cleanSet(action.set),notes:cleanNotes(action.notes)};entry.revisions.push(revision);return revision;
  }
  if(action.type==='team-configure'||action.type==='team-version'){
    const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');const old=currentTeam(db,team,action.versionId);
    if(old.configuration.id!==action.parentConfigurationId)throw new Conflict('Team configuration changed. Reload before saving.');
    resolveSlots(db,action.slots);const slots=action.slots.map((s:Slot)=>({bankId:s.bankId,revisionId:s.revisionId}));
    const configuration={id:uid('config'),createdAt:now(),slots,summary:checkText(action.summary??'Explicit selection of Pokémon revisions',500)};
    if(action.type==='team-version'){const version={id:uid('formula'),number:team.versions.length+1,createdAt:now(),notes:checkText(action.notes??old.version.notes),configurations:[configuration],currentConfigurationId:configuration.id};team.versions.push(version);team.activeVersionId=version.id;return version;}
    old.version.configurations.push(configuration);old.version.currentConfigurationId=configuration.id;return configuration;
  }
  if(action.type==='team-notes'){
    const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');const old=currentTeam(db,team,action.versionId);
    const configuration={id:uid('config'),createdAt:now(),slots:structuredClone(old.configuration.slots)};const version={id:uid('formula'),number:team.versions.length+1,createdAt:now(),notes:checkText(action.notes),configurations:[configuration],currentConfigurationId:configuration.id};team.versions.push(version);team.activeVersionId=version.id;return version;
  }
  if(action.type==='coaching-save'){
    const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');const current=(db.coaching??={})[team.id];
    if((current?.version??0)!==action.parentVersion)throw new Conflict('Coaching notes changed. Reload before saving.');
    const coaching=cleanCoaching(team.id,action.coaching,(current?.version??0)+1);db.coaching[team.id]=coaching;return coaching;
  }
  // Item-level strategy edits (accept, edit, delete, add) merged into the latest plans, so a plan added meanwhile by
  // Ask Frontier Brain or a connector is never overwritten.
  if(action.type==='coaching-update'){
    const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');const current=(db.coaching??={})[team.id]??{teamId:team.id,version:0,updatedAt:'',leads:[],matchups:[],objectives:[]};
    const merge=(list:any[],upsert:any[]=[],remove:string[]=[])=>{const out=list.filter(x=>!remove.includes(x.id));for(const item of upsert){const i=out.findIndex(x=>x.id===item.id);if(i<0)out.push(item);else out[i]=item;}return out;};
    const next={leads:merge(current.leads,action.upsert?.leads,action.remove?.leads),matchups:merge(current.matchups,action.upsert?.matchups,action.remove?.matchups),objectives:merge(current.objectives,action.upsert?.objectives,action.remove?.objectives),brief:action.brief?{...action.brief,updatedAt:now()}:current.brief};
    const coaching=cleanCoaching(team.id,next,current.version+1);db.coaching[team.id]=coaching;return coaching;
  }
  // Replace one or more slots with new sets (slot swap, AI set, AI team). Same species → a new revision of that
  // Pokémon; different species → a new Pokémon entry. Then a new configuration (or a new version) is saved.
  if(action.type==='team-replace-sets'){
    const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');const old=currentTeam(db,team,action.versionId);
    if(!Array.isArray(action.sets)||!action.sets.length||action.sets.length>6)throw new Error('Send one to six replacement sets');
    // A save may build on a newer configuration as long as every slot it replaces is still what the editor started from.
    const perSlot=action.sets.every((r:any)=>typeof r.baseRevisionId==='string');
    if(perSlot){for(const r of action.sets)if(old.configuration.slots[r.slot]?.revisionId!==r.baseRevisionId)throw new Conflict('That Pokémon was changed elsewhere. Reload before saving.');}
    else if(old.configuration.id!==action.parentConfigurationId)throw new Conflict('Team configuration changed. Reload before saving.');
    const slots=structuredClone(old.configuration.slots);let amended=false;
    for(const r of action.sets){if(!Number.isInteger(r.slot)||r.slot<0||r.slot>5)throw new Error('Invalid slot');const set=cleanSet(r.set);const current=slots[r.slot];const entry=db.bank.find(b=>b.id===current.bankId)!;
      const prev=entry.revisions.find(x=>x.id===current.revisionId)!;const note=checkText(r.note??'',4000);
      // Reusing a set that is already saved (e.g. restoring an older one) points at it instead of duplicating it,
      // so its benchmarks stay attached.
      const same=r.reuse?db.bank.flatMap(b=>b.revisions.map(x=>({b,x}))).find(({x})=>JSON.stringify(cleanSet(x.set))===JSON.stringify(set)):undefined;
      if(same){slots[r.slot]={bankId:same.b.id,revisionId:same.x.id};continue;}
      const notes=r.notes?cleanNotes({...r.notes,benchmarks:[r.notes.benchmarks,note].filter(Boolean).join('\n\n')}):undefined;
      // Same set, new notes: notes aren't part of an exact-set claim, so they update the revision in place.
      if(!action.newVersion&&JSON.stringify(cleanSet(prev.set))===JSON.stringify(set)){if(notes)prev.notes=notes;continue;}
      // Autosave: a burst of edits to one Pokémon amends the revision that burst created, so History shows one edit,
      // not one per keystroke. Only while nothing else can point at it (no replay link, star, benchmark or other team).
      if(r.amend===true&&!action.newVersion&&amendable(db,team,old,prev,set)){Object.assign(prev,{set,createdAt:now(),...certainty(prev,set)});if(prev.provenance==='manual'){delete prev.fields;delete prev.knownMoves;}if(notes)prev.notes=notes;amended=true;continue;}
      if(dex.species.get(prev.set.species).baseSpecies===dex.species.get(set.species).baseSpecies){const revision:SetRevision={id:uid('set'),number:entry.revisions.length+1,createdAt:now(),set,notes:notes??{...prev.notes,benchmarks:[prev.notes.benchmarks,note].filter(Boolean).join('\n\n')},...certainty(prev,set)};entry.revisions.push(revision);slots[r.slot]={bankId:entry.id,revisionId:revision.id};}
      else{const revision={id:uid('set'),number:1,createdAt:now(),set,notes:notes??{...blankNotes(),benchmarks:note},provenance:'manual' as const};const fresh={id:uid('bank'),name:`${set.species} · ${team.name}`,revisions:[revision]};db.bank.push(fresh);slots[r.slot]={bankId:fresh.id,revisionId:revision.id};}}
    if(!action.newVersion&&JSON.stringify(slots)===JSON.stringify(old.configuration.slots)){
      if(amended){const errors=validation(resolveSlots(db,slots),team.format);if(errors.length)throw new Error(errors.join('\n'));if(action.summary)old.configuration.summary=checkText(action.summary,500);}
      return {versionId:old.version.id,configurationId:old.configuration.id,revisionIds:slots.map(s=>s.revisionId),...amended?{amended:true}:{unchanged:true}};}
    const sets=resolveSlots(db,slots);const errors=validation(sets,team.format);if(errors.length)throw new Error(errors.join('\n'));
    const configuration={id:uid('config'),createdAt:now(),slots,summary:checkText(action.summary??'Replaced sets',500)};
    if(action.newVersion){const version={id:uid('formula'),number:team.versions.length+1,createdAt:now(),notes:checkText(action.notes??old.version.notes),configurations:[configuration],currentConfigurationId:configuration.id};team.versions.push(version);if(action.activate===true)team.activeVersionId=version.id;return {versionId:version.id,configurationId:configuration.id};}
    old.version.configurations.push(configuration);old.version.currentConfigurationId=configuration.id;return {versionId:old.version.id,configurationId:configuration.id,revisionIds:slots.map(s=>s.revisionId)};
  }
  // Strategy notes describe a version; editing them does not change any set, so they are updated in place.
  if(action.type==='version-notes'){const team=db.teams.find(t=>t.id===action.teamId);const v=team?.versions.find(v=>v.id===action.versionId);if(!v)throw new Error('Version not found');v.notes=checkText(action.notes);return v;}
  // The format is part of the team (legality checks use it); changing it doesn't touch any set.
  if(action.type==='team-format'){const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');if(!FORMATS.some(f=>f.id===action.format))throw new Error('Unknown format');team.format=action.format;return team;}
  if(action.type==='team-rename'){const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');team.name=checkText(action.name,120).trim();if(!team.name)throw new Error('Name is required');return team;}
  // A milestone the player chooses ("Save as V2"): the current six become a new version, which becomes the active team.
  // With fromVersionId, an older version's sets come back as the new version ("Make V1 the current team").
  if(action.type==='team-milestone'){const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');
    const source=currentTeam(db,team,action.fromVersionId??team.activeVersionId);if(!action.fromVersionId&&source.configuration.id!==action.parentConfigurationId)throw new Conflict('The team changed. Reload before saving a version.');
    if(source.errors.length)throw new Error('Cannot save an illegal team as a version');
    const configuration={id:uid('config'),createdAt:now(),slots:structuredClone(source.configuration.slots),summary:action.fromVersionId?`Restored from V${source.version.number}`:'Saved as a version'};
    const version={id:uid('formula'),number:team.versions.length+1,createdAt:now(),label:checkText(action.label??'',80).trim()||undefined,notes:checkText(action.notes??source.version.notes),configurations:[configuration],currentConfigurationId:configuration.id};
    team.versions.push(version as any);team.activeVersionId=version.id;return {versionId:version.id,configurationId:configuration.id};}
  // "My sets": a star on a saved set (history stays immutable; the star is a label).
  if(action.type==='set-star'||action.type==='set-unstar'){let {bankId,revisionId}=action;if(action.teamId){const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');const slot=currentTeam(db,team,action.versionId).configuration.slots[action.slot];if(!slot)throw new Error('Invalid slot');({bankId,revisionId}=slot);}
    const entry=db.bank.find(b=>b.id===bankId);const r=entry?.revisions.find(x=>x.id===revisionId);if(!r)throw new Error('Set not found');
    if(action.type==='set-star')r.starred={label:checkText(action.label??'',80).trim()||`${r.set.species} · ${r.set.item||'no item'}`,at:now()};else delete r.starred;return r;}
  if(action.type==='team-activate'){const team=db.teams.find(t=>t.id===action.teamId);if(!team)throw new Error('Team not found');const selected=currentTeam(db,team,action.versionId);if(selected.errors.length)throw new Error('Cannot activate an illegal team');team.activeVersionId=action.versionId;return team;}
  if(action.type==='match-save'){
    if(!Array.isArray(action.replayIds)||action.replayIds.length<2||action.replayIds.length>3||new Set(action.replayIds).size!==action.replayIds.length)throw new Error('Choose two or three distinct games');
    if(db.matches.some(m=>m.id!==action.id&&m.replayIds.some(id=>action.replayIds.includes(id))))throw new Error('A game is already in another match');
    const match={id:action.id??uid('match'),replayIds:action.replayIds.map((id:string)=>checkText(id,180)),notes:checkText(action.notes??'')};const index=db.matches.findIndex(m=>m.id===match.id);if(index<0)db.matches.push(match);else db.matches[index]=match;return match;
  }
  throw new Error('Unknown action');
}
const shortId=(value:unknown)=>{const v=checkText(value??uid('c'),80);if(!/^[a-zA-Z0-9_-]+$/.test(v))throw new Error('Invalid coaching identifier');return v;};
const names=(value:unknown,max=6)=>{if(!Array.isArray(value)||value.length>max)throw new Error('Expected a short list of Pokémon');return value.map(v=>checkText(v,100));};
export function cleanBrief(b:any){return {goal:checkText(b?.goal??'',1000),core:names(b?.core??[],6),gamePlan:checkText(b?.gamePlan??'',4000),ruledOut:checkText(b?.ruledOut??'',1000),updatedAt:typeof b?.updatedAt==='string'?b.updatedAt:now()};}
export function cleanCoaching(teamId:string,input:any,version:number):TeamCoaching{
  const status=(v:unknown)=>v==='proposed'?'proposed' as const:'active' as const;const ids=(v:unknown)=>names(v??[],40).map(shortId);
  return {teamId,version,updatedAt:now(),
    leads:(input?.leads??[]).slice(0,40).map((l:any)=>({id:shortId(l.id),lead:names(l.lead,2),back:names(l.back??[],4),...(['core','situational','niche','avoid'].includes(l.role)?{role:l.role}:{}),when:checkText(l.when??'',4000),plan:checkText(l.plan??'',8000),calcIds:ids(l.calcIds),versionIds:ids(l.versionIds),status:status(l.status)})),
    matchups:(input?.matchups??[]).slice(0,80).map((m:any)=>({id:shortId(m.id),opponent:checkText(m.opponent,300),...m.archetype?{archetype:checkText(m.archetype,80)}:{},...Array.isArray(m.examples)&&m.examples.length?{examples:names(m.examples,8)}:{},threat:['low','medium','high'].includes(m.threat)?m.threat:'medium',bring:names(m.bring??[],4),...m.leadId?{leadId:shortId(m.leadId)}:{},plan:checkText(m.plan??'',8000),calcIds:ids(m.calcIds),versionIds:ids(m.versionIds),status:status(m.status)})),
    objectives:(input?.objectives??[]).slice(0,100).map((o:any)=>({id:shortId(o.id),kind:o.kind==='todo'?'todo' as const:'test' as const,text:checkText(o.text,2000),done:o.done===true})),
    ...input?.brief?{brief:cleanBrief(input.brief)}:{}};
}
const recordId=(value:string)=>{if(!/^[a-zA-Z0-9_-]+$/.test(value))throw new Error('Invalid storage identifier');return value;};
async function optionalFile<T>(path:string):Promise<T|null>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
async function atomicJSON(root:string,path:string,data:unknown){const target=resolve(root,path);await mkdir(resolve(target,'..'),{recursive:true});const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data,null,2)+'\n');await rename(temp,target);}
export function validateStoreReferences(db:Workbench){
  const ids=new Set<string>();for(const b of db.bank){recordId(b.id);for(const r of b.revisions){recordId(r.id);if(ids.has(r.id))throw new Error('Duplicate revision');ids.add(r.id);}}
  for(const t of db.teams){recordId(t.id);currentTeam(db,t);for(const v of t.versions){recordId(v.id);for(const c of v.configurations){recordId(c.id);resolveSlots(db,c.slots);}}}
  for(const a of Object.values(db.associations)){const t=db.teams.find(t=>t.id===a.teamId);if(!t)throw new Error('Dangling replay team');if(a.certainty==='exact'){if(!a.versionId||!a.configurationId)throw new Error('Missing exact replay identifiers');currentTeam(db,t,a.versionId,a.configurationId);}else if(a.versionId)currentTeam(db,t,a.versionId);}
  for(const [teamId,c] of Object.entries(db.coaching??{})){if(!db.teams.some(t=>t.id===teamId)||c.teamId!==teamId)throw new Error('Dangling coaching record');}
  for(const b of db.benchmarks??[])if(!db.bank.find(p=>p.id===b.bankId)?.revisions.some(r=>r.id===b.revisionId))throw new Error('Dangling benchmark');
}
// The atomically published journal is the commit point. Readers see its complete
// snapshot until materialization finishes, never a mixture of record revisions.
// On the hosted site the whole workspace is one row per user (see tools/hosted.ts); locally it is the file layout below.
export interface StoreBackend {read():Promise<Workbench>;mutate<T>(revision:number,fn:(db:Workbench)=>T|Promise<T>):Promise<{db:Workbench;result:Awaited<T>}>}
export async function readStore(storageRoot=ROOT):Promise<Workbench>{
  const hostedStore=storageRoot===ROOT?dataContext().store:undefined;if(hostedStore)return hostedStore.read();
  const pending=await optionalFile<{db:Workbench}>(resolve(storageRoot,'.cache/coach-transaction.json'));if(pending)return pending.db;
  const manifest=await optionalFile<any>(resolve(storageRoot,'teams/index.json'));if(!manifest)return await optionalFile<Workbench>(resolve(storageRoot,'teams/workbench.json'))??emptyStore();
  const bank=await Promise.all(manifest.pokemonIds.map(async(id:string)=>{const path=`pokemon/${recordId(id)}`;const {revisionIds,benchmarkIds,...meta}=JSON.parse(await readFile(resolve(storageRoot,path,'pokemon.json'),'utf8'));return {...meta,revisions:await Promise.all(revisionIds.map((rid:string)=>optionalFile(resolve(storageRoot,path,'revisions',recordId(rid)+'.json'))))};}));
  const teams=await Promise.all(manifest.teamIds.map(async(id:string)=>{const path=`teams/${recordId(id)}`;const {versionIds,...meta}=JSON.parse(await readFile(resolve(storageRoot,path,'team.json'),'utf8'));return {...meta,versions:await Promise.all(versionIds.map(async(vid:string)=>{const v:any=await optionalFile(resolve(storageRoot,path,'versions',recordId(vid)+'.json'));const {configurationIds,...meta}=v;return {...meta,configurations:await Promise.all(configurationIds.map((cid:string)=>optionalFile(resolve(storageRoot,path,'configurations',recordId(cid)+'.json'))))};}))};}));
  const benchmarkLists=await Promise.all(manifest.pokemonIds.map(async(id:string)=>{const meta:any=await optionalFile(resolve(storageRoot,'pokemon',recordId(id),'pokemon.json'));return Promise.all((meta.benchmarkIds??[]).map((bid:string)=>optionalFile(resolve(storageRoot,'pokemon',id,'benchmarks',recordId(bid)+'.json'))));}));
  const coachingEntries=await Promise.all(manifest.teamIds.map(async(id:string)=>[id,await optionalFile(resolve(storageRoot,'teams',recordId(id),'coaching.json'))]));
  const db={schemaVersion:1,revision:manifest.revision,bank,teams,coaching:Object.fromEntries(coachingEntries.filter(([,c])=>c)),associations:await optionalFile(resolve(storageRoot,'replays/associations.json'))??{},matches:await optionalFile(resolve(storageRoot,'replays/matches.json'))??[],benchmarks:benchmarkLists.flat()} as Workbench;
  // A writer might have committed while this reader assembled the records.
  const committed=await optionalFile<{db:Workbench}>(resolve(storageRoot,'.cache/coach-transaction.json'));if(committed)return committed.db;
  const latest:any=await optionalFile(resolve(storageRoot,'teams/index.json'));if(latest.revision!==manifest.revision)return readStore(storageRoot);return db;
}
async function materialize(db:Workbench,root:string){
  validateStoreReferences(db);
  for(const b of db.bank){const {revisions,...meta}=b;await atomicJSON(root,`pokemon/${b.id}/pokemon.json`,{...meta,revisionIds:revisions.map(r=>r.id),benchmarkIds:(db.benchmarks??[]).filter(r=>r.bankId===b.id).map(r=>r.id)});for(const r of revisions)await atomicJSON(root,`pokemon/${b.id}/revisions/${r.id}.json`,r);}
  for(const t of db.teams){const {versions,...meta}=t;await atomicJSON(root,`teams/${t.id}/team.json`,{...meta,versionIds:versions.map(v=>v.id)});for(const v of versions){const {configurations,...meta}=v;await atomicJSON(root,`teams/${t.id}/versions/${v.id}.json`,{...meta,configurationIds:configurations.map(c=>c.id)});for(const c of configurations)await atomicJSON(root,`teams/${t.id}/configurations/${c.id}.json`,c);}}
  for(const [teamId,c] of Object.entries(db.coaching??{}))await atomicJSON(root,`teams/${recordId(teamId)}/coaching.json`,c);
  for(const b of db.benchmarks??[])await atomicJSON(root,`pokemon/${b.bankId}/benchmarks/${recordId(b.id)}.json`,b);
  await atomicJSON(root,'replays/associations.json',db.associations);await atomicJSON(root,'replays/matches.json',db.matches);
  await atomicJSON(root,'teams/index.json',{schemaVersion:2,revision:db.revision,teamIds:db.teams.map(t=>t.id),pokemonIds:db.bank.map(b=>b.id)});
  await rm(resolve(root,'.cache/coach-transaction.json'),{force:true});
}
async function commit(db:Workbench,root:string){validateStoreReferences(db);await atomicJSON(root,'.cache/coach-transaction.json',{db});await materialize(db,root);}
export async function migrateStore(root=ROOT){
  return withStoreLock(root,async()=>{const pending=await optionalFile<{db:Workbench}>(resolve(root,'.cache/coach-transaction.json'));if(pending)await materialize(pending.db,root);
    if(await optionalFile(resolve(root,'teams/index.json')))return {migrated:false};const db=await readStore(root);validateStoreReferences(db);
    const old=resolve(root,'teams/workbench.json');try{await copyFile(old,resolve(root,'teams/workbench.pre-coach.json'),1);}catch(e){if(!['ENOENT','EEXIST'].includes((e as NodeJS.ErrnoException).code??''))throw e;}
    await commit(db,root);const loaded=await readStore(root);if(JSON.stringify(loaded.teams.map(t=>t.id))!==JSON.stringify(db.teams.map(t=>t.id))||loaded.bank.length!==db.bank.length)throw new Error('Migration verification failed');return {migrated:true,teams:db.teams.length,pokemon:db.bank.length};});
}
async function withStoreLock<T>(root:string,fn:()=>Promise<T>):Promise<T>{
  await mkdir(resolve(root,'teams'),{recursive:true});const lock=resolve(root,'teams/.workbench-lock');
  try{await mkdir(lock);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;let pid:number;try{pid=Number(await readFile(resolve(lock,'pid'),'utf8'));if(!Number.isInteger(pid)||pid<1)throw new Error('Unknown owner');process.kill(pid,0);}catch(err){if((err as NodeJS.ErrnoException).code==='ESRCH'){await rm(lock,{recursive:true});return withStoreLock(root,fn);}throw new StaleWorkspace('Another save is in progress. Try again.');}throw new StaleWorkspace('Another save is in progress. Try again.');}
  await writeFile(resolve(lock,'pid'),String(process.pid));try{return await fn();}finally{await rm(lock,{recursive:true});}
}
export async function mutateStore(revision:number,fn:(db:Workbench)=>unknown|Promise<unknown>,storageRoot=ROOT){
  const hostedStore=storageRoot===ROOT?dataContext().store:undefined;if(hostedStore)return hostedStore.mutate(revision,fn);
  return withStoreLock(storageRoot,async()=>{const pending=await optionalFile<{db:Workbench}>(resolve(storageRoot,'.cache/coach-transaction.json'));if(pending)await materialize(pending.db,storageRoot);const db=await readStore(storageRoot);if(db.revision!==revision)throw new StaleWorkspace('Workspace changed since you opened it. Reload before saving.');const result=await fn(db);db.revision++;await commit(db,storageRoot);return {db,result};});
}
// Apply a change to the latest workspace, retrying when another writer commits first.
export async function mutateLatest<T>(fn:(db:Workbench)=>T|Promise<T>,storageRoot=ROOT):Promise<{db:Workbench;result:Awaited<T>}>{
  for(let attempt=0;;attempt++){const db=await readStore(storageRoot);
    try{return await mutateStore(db.revision,fn,storageRoot) as any;}
    catch(e){if(!(e instanceof StaleWorkspace)||attempt>=6)throw e;await new Promise(r=>setTimeout(r,40*(attempt+1)+Math.random()*60));}}
}
export async function legacyTeams(storageRoot=ROOT){
  if(storageRoot===ROOT&&dataContext().hosted)return [];
  const names=await readdir(resolve(storageRoot,'teams')).catch(()=>[] as string[]);const output=[];
  for(const name of names){try{const record=JSON.parse(await readFile(resolve(storageRoot,'teams',name,'team.json'),'utf8'));if(record.sets&&record.id)output.push(record);}catch(e){if(!['ENOENT','ENOTDIR'].includes((e as NodeJS.ErrnoException).code??''))throw e;}}return output;
}
export function teamPaste(db:Workbench,team:Formula,versionId?:string,configId?:string){const view=currentTeam(db,team,versionId,configId);if(view.errors.length)throw new Error(view.errors.join('\n'));return exportText(view.sets,team.format);}
export function sameRoster(a:string[],b:string[]){const norm=(names:string[])=>names.map(n=>dex.species.get(n).baseSpecies).sort().join('|');return a.length===b.length&&norm(a)===norm(b);}
export function associateReplay(db:Workbench,game:Game,input:any){
  if(input.certainty==='clear'){delete db.associations[game.id];return {cleared:true};}
  if(input.certainty==='auto'){const r=autoLink(db,game,input.teamId);if(r.association)db.associations[game.id]=r.association;return r;}
  const team=db.teams.find(t=>t.id===input.teamId);if(!team)throw new Error('Team not found');
  // Family links may name a version when the six match it: "played this version, exact sets unconfirmed".
  if(input.certainty==='family'){let versionId:string|undefined;if(input.versionId){const v=currentTeam(db,team,input.versionId);if(!sameRoster(game.preview[game.ownSide],v.sets.map(s=>s.species)))throw new Error('Roster does not match that version');versionId=v.version.id;}
    db.associations[game.id]={teamId:team.id,...versionId?{versionId}:{},certainty:'family'};return db.associations[game.id];}
  if(input.certainty!=='exact'||input.confirm!==true)throw new Error('Exact sets require confirmation');
  const view=currentTeam(db,team,input.versionId,input.configurationId);if(!sameRoster(game.preview[game.ownSide],view.sets.map(s=>s.species)))throw new Error('Roster does not match configuration');if(view.errors.length)throw new Error('Cannot attach an illegal configuration');
  const identity:Record<string,string>={};for(const e of game.events){if(['switch','drag','replace','detailschange'].includes(e.type))identity[e.args[0]]=e.args[1]?.split(',')[0];
    if(e.type==='move'&&e.args[1]!=='Struggle'&&e.args[0].startsWith(game.ownSide)&&!e.args.some(a=>a.startsWith('[from]'))){const species=dex.species.get(identity[e.args[0]]??'').baseSpecies;const set=view.sets.find(s=>dex.species.get(s.species).baseSpecies===species);if(set&&!set.moves?.includes(e.args[1]))throw new Error(`Observed ${species} used ${e.args[1]}, absent from this configuration. Save the historical set first.`);}}
  db.associations[game.id]={teamId:team.id,versionId:view.version.id,configurationId:view.configuration.id,certainty:'exact',basis:'player'};return db.associations[game.id];
}
