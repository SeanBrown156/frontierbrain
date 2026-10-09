import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {emptyStore,makeTeam,migrateStore,readStore,mutateStore,currentTeam,applyAction,blankNotes,validateStoreReferences} from '../workbench-store.ts';
import {freezeReviewScope,validateReview,associationFingerprint} from '../coaching.ts';
import {json,ROOT} from '../io.ts';
import {corpusGames as loadGames} from './corpus.ts';
import {damage,speed,spreadSearch} from '../mechanics.ts';
const pastes=JSON.parse(await readFile(resolve(import.meta.dirname,'fixtures/teams.json'),'utf8'));
test('Folder migration preserves identifiers, configurations, notes and original backup',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'poke-coach-'));try{const db=emptyStore();for(const p of pastes)makeTeam(db,p.name,p.paste);db.revision=7;const view=currentTeam(db,db.teams[0]);db.associations['saved-game']={teamId:db.teams[0].id,versionId:view.version.id,configurationId:view.configuration.id,certainty:'exact'};const original=JSON.stringify(db,null,2)+'\n';await mkdir(resolve(root,'teams'));await writeFile(resolve(root,'teams/workbench.json'),original);
    const migrated=await migrateStore(root);assert.equal(migrated.migrated,true);const loaded=await readStore(root);assert.equal(loaded.revision,7);assert.equal(loaded.bank.length,16);assert.deepEqual(loaded.associations,db.associations);assert.deepEqual(loaded.teams.map(t=>currentTeam(loaded,t).configuration),db.teams.map(t=>currentTeam(db,t).configuration));assert.equal(await readFile(resolve(root,'teams/workbench.pre-coach.json'),'utf8'),original);
    for(const b of db.bank)assert.deepEqual(JSON.parse(await readFile(resolve(root,`pokemon/${b.id}/revisions/${b.revisions[0].id}.json`),'utf8')),b.revisions[0]);assert.equal((await migrateStore(root)).migrated,false);
  }finally{await rm(root,{recursive:true});}
});
test('Committed journal is readable during interruption and is recovered on next save',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'poke-coach-recovery-'));try{await mutateStore(0,db=>makeTeam(db,'Rain',pastes[2].paste),root);const next=await readStore(root);next.revision=2;next.teams[0].name='Committed but not yet materialized';await writeFile(resolve(root,'.cache/coach-transaction.json'),JSON.stringify({db:next}));assert.equal((await readStore(root)).teams[0].name,next.teams[0].name);
    await mutateStore(2,db=>applyAction(db,{type:'team-rename',teamId:db.teams[0].id,name:'Recovered'}),root);assert.equal((await readStore(root)).revision,3);assert.equal((await readStore(root)).teams[0].name,'Recovered');await assert.rejects(readFile(resolve(root,'.cache/coach-transaction.json')),/ENOENT/);
  }finally{await rm(root,{recursive:true});}
});
test('Benchmarks are recomputed server-side, stored by revision and do not alter saved sets',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'poke-benchmark-'));try{const created=await mutateStore(0,db=>makeTeam(db,'Rain',pastes[2].paste),root);const b=created.db.bank[0];const r=b.revisions[0];const before=structuredClone(r);const saved=await mutateStore(1,db=>applyAction(db,{type:'benchmark-save',bankId:b.id,revisionId:r.id,title:'Speed test',kind:'speed',input:{a:r.set,b:r.set},result:{first:'fake'},context:'Full health',sources:['https://www.pikalytics.com/']}),root);assert.equal(saved.db.benchmarks![0].result.first,'tie');assert.deepEqual((await readStore(root)).bank[0].revisions[0],before);assert.ok(await readFile(resolve(root,`pokemon/${b.id}/benchmarks/${saved.db.benchmarks![0].id}.json`)));assert.throws(()=>applyAction(saved.db,{type:'benchmark-save',bankId:b.id,revisionId:'unknown',kind:'speed'}),/Unknown/);
  }finally{await rm(root,{recursive:true});}
});
test('Scoped reviews freeze exact sets and reject family-only games in configuration scope',async()=>{
  const db=emptyStore();const t=makeTeam(db,'Rain',pastes[2].paste);const v=currentTeam(db,t);const g=structuredClone((await loadGames())[0]);db.associations[g.id]={teamId:t.id,certainty:'family'};assert.throws(()=>freezeReviewScope(db,[g],{teamId:t.id,configurationId:v.configuration.id,replayIds:[g.id]}),/exact linked/);
  db.associations[g.id]={teamId:t.id,versionId:v.version.id,configurationId:v.configuration.id,certainty:'exact'};const snapshot=structuredClone(freezeReviewScope(db,[g],{teamId:t.id,configurationId:v.configuration.id,replayIds:[g.id]}));const original=snapshot.team!.sets[0].nature;const b=db.bank[0];applyAction(db,{type:'bank-revise',bankId:b.id,parentRevisionId:b.revisions[0].id,set:{...b.revisions[0].set,nature:'Serious'},notes:blankNotes()});assert.equal(snapshot.team!.sets[0].nature,original);const fingerprint=associationFingerprint(db,[g.id]);delete db.associations[g.id];assert.notEqual(associationFingerprint(db,[g.id]),fingerprint);assert.throws(()=>freezeReviewScope(db,[g],{replayIds:['missing']}),/Unknown replay/);assert.throws(()=>freezeReviewScope(db,[g],{replayIds:[]}),/Select games/);
});
test('Coaching output needs selected replay event evidence, not fabricated line/turn references',async()=>{
  const g=(await loadGames())[0];const snapshot=freezeReviewScope(emptyStore(),[g],{replayIds:[g.id]});const event=g.events.find(e=>e.turn>0)!;const value={status:'complete',findings:[{category:'play',title:'Positioning',detail:'Review the observed turn.',confidence:'low',evidence:[{replayId:g.id,turn:event.turn,line:event.line}],practiceGoal:'Explain both players’ options.'}],limitations:['Own exact set unconfirmed.'],report:'Scoped review'};assert.equal(validateReview(value,snapshot,'test').scope.replayIds[0],g.id);const bad=structuredClone(value);bad.findings[0].evidence[0].line=99999;assert.throws(()=>validateReview(bad,snapshot,'test'),/selected replay/);bad.findings[0].evidence=[];assert.throws(()=>validateReview(bad,snapshot,'test'),/need replay evidence/);
});
test('Storage rejects dangling historical references before committing',()=>{const db=emptyStore();const t=makeTeam(db,'Rain',pastes[2].paste);db.associations.game={teamId:t.id,certainty:'exact',versionId:t.activeVersionId,configurationId:'missing'};assert.throws(()=>validateStoreReferences(db),/Unknown configuration/);});
test('Builder calc robustness: immunity, HP, triggers, bounded search and survival goals',()=>{
  const attacker={species:'Pelipper',nature:'Modest',ability:'Drizzle',statPoints:{spa:32}},defender={species:'Gengar',ability:'Cursed Body',statPoints:{hp:32}};assert.equal(damage({attacker,defender,move:'Body Slam'}).range[1],0);
  assert.throws(()=>damage({attacker,defender:{...defender,curHP:9999},move:'Hurricane'}),/curHP/);assert.throws(()=>damage({attacker,defender,move:'Hurricane',field:{defenderSide:{lightScreen:true}}}),/Unknown side/);
  const survival=spreadSearch({species:'Rillaboom',ability:'Overgrow',nature:'Adamant',benchmarks:[{direction:'incoming',other:{species:'Incineroar',ability:'Blaze'},move:'Flare Blitz',survive:true}]});for(const s of survival.solutions)assert.ok(s.benchmarks[0].range[1]<s.stats.hp);
  assert.throws(()=>spreadSearch({species:'Rillaboom',natures:['Fake nature'],minStats:{spe:120}}),/nature/);assert.equal(speed({a:attacker,b:attacker}).first,'tie');
});
