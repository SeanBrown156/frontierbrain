import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {withData,fileBackend,CODE} from '../io.ts';
import {emptyStore,StaleWorkspace,mutateLatest,applyAction,makeTeam,currentTeam,type StoreBackend} from '../workbench-store.ts';
import type {Workbench} from '../../shared/workbench.ts';

// An in-memory hosted store that can pretend another writer commits first.
function memoryStore(){const s:any={db:emptyStore(),races:0,
  async read(){return structuredClone(s.db);},
  async mutate(revision:number,fn:(db:Workbench)=>unknown){if(s.races>0){s.races--;s.db.revision++;}const db=structuredClone(s.db);if(db.revision!==revision)throw new StaleWorkspace('stale');const result=await fn(db);db.revision++;s.db=db;return {db,result};}};return s as StoreBackend&{db:Workbench;races:number};}
const paste=async()=>JSON.parse(await readFile(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[2].paste as string;
const within=<T>(store:StoreBackend,fn:()=>Promise<T>)=>withData({user:fileBackend(CODE),shared:fileBackend(CODE),store,hosted:true},fn);

test('Saves apply to the latest workspace and retry when another writer commits first',async()=>{
  const store=memoryStore();const text=await paste();
  await within(store,async()=>{
    await mutateLatest(db=>makeTeam(db,'First',text));
    store.races=2; // two other writers sneak in
    const r=await mutateLatest(db=>makeTeam(db,'Second',text));
    assert.ok(r.result);assert.deepEqual(store.db.teams.map(t=>t.name),['First','Second']);
  });
});

test('A burst of autosaves to one Pokémon amends one history entry; a starred set is never amended',async()=>{
  const db=emptyStore();const team:any=makeTeam(db,'Rain',await paste());const view=()=>currentTeam(db,team);
  const configs=()=>view().version.configurations.length;const before=configs();const slot=0;const base=view().configuration.slots[slot].revisionId;
  const set=structuredClone(view().sets[slot]);
  const save=(s:any,baseRevisionId:string,amend:boolean)=>applyAction(db,{type:'team-replace-sets',teamId:team.id,versionId:view().version.id,sets:[{slot,set:s,baseRevisionId,amend}],summary:'edit'}) as any;
  const first=save({...set,nickname:'A'},base,false);assert.equal(configs(),before+1);const mine=first.revisionIds[slot];
  const second=save({...set,nickname:'AB'},mine,true);assert.equal(second.amended,true);assert.equal(configs(),before+1);
  assert.equal(view().sets[slot].nickname,'AB');assert.equal(second.revisionIds[slot],mine);
  applyAction(db,{type:'set-star',teamId:team.id,versionId:view().version.id,slot,label:'Mine'});
  const third=save({...set,nickname:'ABC'},mine,true);assert.equal(third.amended,undefined);assert.equal(configs(),before+2);
});

test('Strategy edits merge item by item, keeping plans added meanwhile',async()=>{
  const db=emptyStore();const team:any=makeTeam(db,'Rain',await paste());
  const plan=(id:string,status='proposed')=>({id,lead:['Pelipper','Archaludon'],back:[],when:'',plan:'Rain up.',calcIds:[],versionIds:[],status});
  applyAction(db,{type:'coaching-update',teamId:team.id,upsert:{leads:[plan('a')]}});
  applyAction(db,{type:'coaching-update',teamId:team.id,upsert:{leads:[plan('b')]}}); // e.g. a connector, meanwhile
  applyAction(db,{type:'coaching-update',teamId:team.id,upsert:{leads:[plan('a','active')]}}); // the player accepts the first
  const c=db.coaching![team.id];assert.deepEqual(c.leads.map(l=>[l.id,l.status]),[['a','active'],['b','proposed']]);
  applyAction(db,{type:'coaching-update',teamId:team.id,remove:{leads:['b']}});assert.deepEqual(db.coaching![team.id].leads.map(l=>l.id),['a']);
});
