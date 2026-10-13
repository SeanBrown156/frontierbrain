import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer,request} from 'node:http';
import {emptyStore,makeTeam,applyAction,currentTeam,mutateStore,readStore,teamPaste,Conflict,sameRoster,blankNotes,legacyTeams,cleanSet,associateReplay} from '../workbench-store.ts';
import {coachStats,weekStart,newsWindow,comparableDelta,parseTournamentUsage,dashboard} from '../workbench-data.ts';
import {handler,allowedRequest} from '../workbench-server.ts';
import {importText,teamImport} from '../teams.ts';
import {corpusGames as loadGames} from './corpus.ts';
import {ROOT,json,hash,optionalJSON} from '../io.ts';

const pastes=JSON.parse(await readFile(resolve(import.meta.dirname,'fixtures/teams.json'),'utf8'));
test('Three user pastes validate and shared exact sets are reused in the bank',()=>{const db=emptyStore();for(const p of pastes)makeTeam(db,p.name,p.paste);assert.equal(db.teams.length,3);assert.equal(db.bank.length,16);for(const t of db.teams)assert.deepEqual(currentTeam(db,t).errors,[]);assert.equal(currentTeam(db,db.teams[0]).configuration.slots[5].bankId,currentTeam(db,db.teams[1]).configuration.slots[1].bankId);});
test('Bank revisions do not change teams; explicit adoption freezes configurations without a formula bump',()=>{
  const db=emptyStore();const team=makeTeam(db,'Rain',pastes[2].paste);const initial=currentTeam(db,team);const original=JSON.stringify(initial.configuration);const slot=initial.configuration.slots[0];const bank=db.bank.find(b=>b.id===slot.bankId)!;const parent=bank.revisions[0];
  const revised:any=applyAction(db,{type:'bank-revise',bankId:bank.id,parentRevisionId:parent.id,set:{...parent.set,statPoints:{hp:31,atk:32,spd:3}},notes:{...blankNotes(),role:'Slow rain partner'}});
  assert.equal(currentTeam(db,team).sets[0].statPoints!.hp,32);assert.equal(bank.revisions.length,2);assert.equal(team.versions.length,1);
  const slots=structuredClone(initial.configuration.slots);slots[0].revisionId=revised.id;
  applyAction(db,{type:'team-configure',teamId:team.id,versionId:initial.version.id,parentConfigurationId:initial.configuration.id,slots});
  assert.equal(team.versions.length,1);assert.equal(team.versions[0].configurations.length,2);assert.equal(currentTeam(db,team).sets[0].statPoints!.hp,31);assert.equal(JSON.stringify(team.versions[0].configurations[0]),original);
  assert.throws(()=>applyAction(db,{type:'bank-revise',bankId:bank.id,parentRevisionId:parent.id,set:parent.set,notes:blankNotes()}),Conflict);
});
test('User can create a formula version or configuration; invalid slot references fail',()=>{const db=emptyStore();const team=makeTeam(db,'Rain',pastes[2].paste);const old=currentTeam(db,team);const r:any=applyAction(db,{type:'team-version',teamId:team.id,versionId:old.version.id,parentConfigurationId:old.configuration.id,slots:old.configuration.slots,notes:'New approach'});assert.equal(r.number,2);assert.equal(team.activeVersionId,r.id);assert.equal(old.version.notes,'Imported paste.');assert.throws(()=>applyAction(db,{type:'team-configure',teamId:team.id,versionId:r.id,parentConfigurationId:r.currentConfigurationId,slots:[{bankId:'unknown',revisionId:'unknown'}]}));assert.deepEqual(importText(teamPaste(db,team)).map(cleanSet),currentTeam(db,team).sets);});
test('Atomic store saves reject stale global revisions and preserve files after failed saves',async()=>{const root=await mkdtemp(resolve(tmpdir(),'vgc-workbench-'));try{const first=await mutateStore(0,db=>makeTeam(db,'Rain',pastes[2].paste),root);const contents=await readFile(resolve(root,'teams/index.json'),'utf8');await assert.rejects(mutateStore(0,db=>{db.teams=[];},root),Conflict);assert.equal(await readFile(resolve(root,'teams/index.json'),'utf8'),contents);await assert.rejects(mutateStore(1,()=>{throw new Error('failed');},root));assert.equal((await readStore(root)).revision,first.db.revision);assert.equal(await readFile(resolve(root,'teams/index.json'),'utf8'),contents);}finally{await rm(root,{recursive:true});}});
test('Legacy immutable team files remain readable and unmodified',async()=>{const root=await mkdtemp(resolve(tmpdir(),'vgc-legacy-'));try{await mkdir(resolve(root,'teams'));const {writeFile}=await import('node:fs/promises');const pastePath=resolve(root,'rain.txt');await writeFile(pastePath,pastes[2].paste);await teamImport(pastePath,'rain-v1',undefined,root);const before=hash(await readFile(resolve(root,'teams/rain-v1/team.json')));const legacy=await legacyTeams(root);assert.equal(legacy.length,1);assert.equal(hash(await readFile(resolve(root,'teams/rain-v1/team.json'))),before);}finally{await rm(root,{recursive:true});}});
test('Coach counts losses/ties and lead matchups correctly; unknown selections have bounds',async()=>{const games=await loadGames();const stats=coachStats(games);assert.equal(stats.games,9);assert.equal(stats.wins,3);assert.equal(stats.losses,6);assert.equal(Object.values(stats.leads).reduce((n:number,r:any)=>n+r.losses,0),6);const example=structuredClone(games[0]);example.result='tie';example.revealed[example.ownSide]=example.leads[example.ownSide];example.unknownBackSlots[example.ownSide]=2;const s=coachStats([example]);assert.equal(s.ties,1);assert.equal(s.wins,0);assert.ok(Object.values(s.bring).some((r:any)=>r.unknown===1));example.result='incomplete';assert.equal(coachStats([example]).games,0);});
test('Weekly windows use Monday and roll forward without pretending partial weeks are finished',()=>{assert.equal(weekStart('2026-10-08'),'2026-10-05');assert.equal(weekStart('2026-10-04'),'2026-09-28');const windows=newsWindow([],'2026-10-08');assert.deepEqual(windows.map(w=>w.start),['2026-10-05','2026-09-28','2026-09-21']);assert.equal(windows[0].partial,true);assert.equal(windows[1].partial,false);});
test('Usage changes require comparable populations and distinct published periods',()=>{const base={source:'Smogon',format:'mc',rating:1500,period:'2026-09',rows:[{species:'Rillaboom',usagePercent:42}]};assert.equal(comparableDelta(base,base,'Rillaboom'),null);assert.equal(comparableDelta(base,{...base,period:'2026-08',rating:0},'Rillaboom'),null);assert.equal(comparableDelta(base,{...base,period:'2026-08',rows:[{species:'Rillaboom',usagePercent:40}]},'Rillaboom'),2);});
test('Tournament parser retains event share/counts and canonical form artwork IDs',()=>{const html='<table><tr><td>1</td><td><img/></td><td><a>Rillaboom</a></td><td>92</td><td>56.44%</td><td>576</td></tr></table>';assert.deepEqual(parseTournamentUsage(html),[{rank:1,species:'Rillaboom',rawCount:92,usagePercent:56.44}]);const form=html.replace('<img/>','<img alt="arcanine-hisui"/>').replace('Rillaboom','Hisuian Arcanine');assert.equal(parseTournamentUsage(form)[0].species,'Arcanine-Hisui');assert.equal(parseTournamentUsage(form)[0].sourceSpeciesName,'Hisuian Arcanine');assert.throws(()=>parseTournamentUsage('<table></table>'));});
test('Historical roster suggestions cannot establish the exact configuration',async()=>{const games=await loadGames();const db=emptyStore();for(const p of pastes)makeTeam(db,p.name,p.paste);assert.equal(games.filter(g=>sameRoster(g.preview[g.ownSide],currentTeam(db,db.teams[0]).sets.map(s=>s.species))).length,0);assert.equal(games.filter(g=>sameRoster(g.preview[g.ownSide],currentTeam(db,db.teams[1]).sets.map(s=>s.species))).length,2);assert.equal(games.filter(g=>sameRoster(g.preview[g.ownSide],currentTeam(db,db.teams[2]).sets.map(s=>s.species))).length,5);assert.deepEqual(db.associations,{});});
test('Exact associations require confirmation, reject recorded conflicting moves and stay pinned after adoption',async()=>{
  const games=await loadGames();const db=emptyStore();const team=makeTeam(db,'Snow',pastes[1].paste);const view=currentTeam(db,team);const game=games.find(g=>g.id==='gen9championsvgc2026regmc-1000000002')!;const input={teamId:team.id,certainty:'exact',confirm:true,versionId:view.version.id,configurationId:view.configuration.id};
  assert.throws(()=>associateReplay(db,game,{...input,confirm:false}),/confirmation/);assert.throws(()=>associateReplay(db,game,input),/Earth Power/);assert.deepEqual(db.associations,{});
  associateReplay(db,game,{...input,certainty:'family'});assert.equal(db.associations[game.id].certainty,'family');
  const rain=makeTeam(db,'Rain',pastes[2].paste);const rainView=currentTeam(db,rain);const synthetic=structuredClone(game);synthetic.preview[synthetic.ownSide]=rainView.sets.map(s=>s.species);synthetic.events=[];
  associateReplay(db,synthetic,{...input,teamId:rain.id,versionId:rainView.version.id,configurationId:rainView.configuration.id});const frozen=db.associations[game.id].configurationId;
  applyAction(db,{type:'team-configure',teamId:rain.id,versionId:rainView.version.id,parentConfigurationId:rainView.configuration.id,slots:rainView.configuration.slots});assert.equal(db.associations[game.id].configurationId,frozen);assert.notEqual(currentTeam(db,rain).configuration.id,frozen);
});
test('Local API serves real data, rejects foreign origins/traversal and downloads HTML without executing it',async()=>{
  assert.equal(allowedRequest({headers:{host:'evil.example:5173'}} as any),false);assert.equal(allowedRequest({headers:{host:'127.0.0.1:5173',origin:'https://evil.example'}} as any),false);
  const server=createServer(handler);await new Promise<void>(accept=>server.listen(0,'127.0.0.1',accept));const address=server.address() as {port:number};const base=`http://127.0.0.1:${address.port}`;const headers={host:'127.0.0.1:5174'};
  const localRequest=(path:string,options:any={})=>new Promise<Response>((accept,reject)=>{const req=request(base+path,{method:options.method??'GET',headers:{...headers,...options.headers}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>accept(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers as any})));});req.on('error',reject);req.end(options.body);});
  try{const response=await localRequest('/api/dashboard');assert.equal(response.status,200);const data=await response.json() as any;const index=await optionalJSON<any>('replays/index.json',{games:[]});assert.equal(data.games.length,index.games.length);assert.equal(data.teams.length,(await optionalJSON<any>('teams/index.json',{teamIds:[]})).teamIds.length);assert.equal(data.news.length,3);
    const blocked=await localRequest('/api/action',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
    const traversal=await localRequest('/api/report?path='+encodeURIComponent('reports/../../package.json'));assert.equal(traversal.status,400);
    if(data.games.length){const original=await localRequest('/api/original?id='+data.games[0].id);assert.equal(original.headers.get('content-type'),'application/octet-stream');assert.ok(original.headers.get('content-disposition')?.includes('attachment'));assert.ok(original.headers.get('content-security-policy')?.includes('sandbox'));
    const stats=await localRequest('/api/coach-stats?ids='+data.games.map((g:any)=>g.id).join(',')).then(r=>r.json()) as any;assert.equal(stats.losses,data.games.filter((g:any)=>g.result==='loss').length);}
    const badLink=await localRequest('/api/replays',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{url:'https://evil.example/x'}]})}).then(r=>r.json()) as any;assert.match(badLink.results[0].error,/replay.pokemonshowdown.com/);
  }finally{await new Promise<void>(accept=>server.close(()=>accept()));}
});
test('Replacing sets: AI versions stay inactive, edits keep unedited guesses inferred, restores reuse saved sets, stale slots conflict',()=>{
  const db=emptyStore();const team=makeTeam(db,'Rain',pastes[2].paste);const start=currentTeam(db,team);const slot0=start.configuration.slots[0];const entry=db.bank.find(b=>b.id===slot0.bankId)!;const original=entry.revisions[0];
  // Pretend slot 0 was rebuilt from replays: moves seen, everything else guessed.
  Object.assign(original,{provenance:'observed',knownMoves:original.set.moves!.slice(0,2),fields:{item:'inferred',ability:'known',nature:'inferred',statPoints:'inferred',moves:'inferred'}});
  const r:any=applyAction(db,{type:'team-replace-sets',teamId:team.id,versionId:team.activeVersionId,sets:[{slot:0,baseRevisionId:original.id,set:{...original.set,item:'Shell Bell'}}],summary:'Item'});
  const edited=entry.revisions.at(-1)!;assert.equal(edited.provenance,'observed');assert.equal(edited.fields!.item,'known');assert.equal(edited.fields!.nature,'inferred');assert.equal(edited.fields!.statPoints,'inferred');assert.deepEqual(edited.knownMoves,original.set.moves!.slice(0,2));
  // The old revision id is no longer in the slot, so a save that started from it conflicts.
  assert.throws(()=>applyAction(db,{type:'team-replace-sets',teamId:team.id,versionId:team.activeVersionId,sets:[{slot:0,baseRevisionId:original.id,set:original.set}]}),Conflict);
  // Another slot can still be saved on top of the newer configuration.
  const s1=currentTeam(db,team).configuration.slots[1];applyAction(db,{type:'team-replace-sets',teamId:team.id,versionId:team.activeVersionId,sets:[{slot:1,baseRevisionId:s1.revisionId,set:currentTeam(db,team).sets[1]}]});
  // Restoring the original set points at the saved revision instead of copying it.
  const count=entry.revisions.length;applyAction(db,{type:'team-replace-sets',teamId:team.id,versionId:team.activeVersionId,sets:[{slot:0,baseRevisionId:edited.id,set:original.set,reuse:true}]});
  assert.equal(entry.revisions.length,count);assert.equal(currentTeam(db,team).configuration.slots[0].revisionId,original.id);
  // A new version from an AI team is not activated unless asked.
  const active=team.activeVersionId;const v:any=applyAction(db,{type:'team-replace-sets',teamId:team.id,versionId:active,parentConfigurationId:currentTeam(db,team).configuration.id,sets:[{slot:0,set:original.set}],newVersion:true});
  assert.notEqual(v.versionId,active);assert.equal(team.activeVersionId,active);assert.ok(r.configurationId);
});

test('Retired partners/matchups note fields are folded into the Pokémon strategy write-up the next time anything is saved',()=>{
  const db=emptyStore();const team=makeTeam(db,'Rain',pastes[2].paste);const r:any=db.bank[0].revisions[0];
  r.notes={role:'Sets rain.',benchmarks:'',partners:'Pairs with Pelipper.',matchups:'Weak to Grass.'};
  applyAction(db,{type:'team-rename',teamId:team.id,name:'Rain 2'});
  assert.deepEqual(Object.keys(r.notes).sort(),['benchmarks','role']);assert.match(r.notes.role,/Sets rain\.[\s\S]*Pairs with Pelipper[\s\S]*Weak to Grass/);
});

test('A retired team brief joins the active version\'s Strategy write-up and is dropped',()=>{
  const db=emptyStore();const team=makeTeam(db,'Rain',pastes[2].paste);
  (db.coaching??={})[team.id]={teamId:team.id,version:1,updatedAt:'',leads:[],matchups:[],objectives:[],brief:{goal:'Rain that beats Trick Room',core:['Pelipper'],gamePlan:'Rain mode.',ruledOut:'Kingdra',updatedAt:''}} as any;
  applyAction(db,{type:'team-rename',teamId:team.id,name:'Rain 2'});
  assert.equal('brief' in db.coaching![team.id],false);const notes=team.versions.find(v=>v.id===team.activeVersionId)!.notes;
  assert.match(notes,/Rain that beats Trick Room[\s\S]*Built around:\*\* Pelipper[\s\S]*Rain mode\.[\s\S]*Ruled out:\*\* Kingdra/);
});
