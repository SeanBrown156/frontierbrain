import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {CODE} from '../io.ts';
import {emptyStore,makeTeam,applyAction,currentTeam} from '../workbench-store.ts';
import {parseReplay} from '../replays.ts';
import {dex} from '../mechanics.ts';
import {observedSets,autoLink} from '../replay-link.ts';

const dir=resolve(CODE,'tools/tests/fixtures/corpus');
const game=(n:string)=>{const f=readdirSync(dir).find(x=>x.endsWith(`game${n}.html`))!;return parseReplay(readFileSync(resolve(dir,f),'utf8'),f,'Player');};
const rain=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[2].paste;

test('Replays link to the team whose six they match, at the edit current when they were played',()=>{
  const g=game('04');const seen=observedSets(g);assert.ok(seen.size>0&&[...seen.values()].some(o=>o.moves.size>0),'battle reveals moves');
  const db=emptyStore();const other=makeTeam(db,'Other',JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste);const team=makeTeam(db,'Rain',rain);
  for(const v of team.versions)for(const c of v.configurations)c.createdAt=new Date(Date.parse(g.date!)-86400000).toISOString();
  const first=autoLink(db,g).association!;
  assert.equal(first.teamId,team.id);assert.equal(first.certainty,'exact');assert.equal(first.basis,'auto');assert.equal(first.configurationId,team.versions[0].currentConfigurationId);
  assert.equal(autoLink(db,g,other.id).association?.certainty,'family','a different six on the chosen team links by team only');
  // An edit after the game that drops a move the game used: the game still matches the earlier edit.
  const view=currentTeam(db,team);const slot=view.sets.findIndex(s=>(seen.get(dex.species.get(s.species).baseSpecies)?.moves.size??0)>0);const used=[...seen.get(dex.species.get(view.sets[slot].species).baseSpecies)!.moves][0];
  const changed={...view.sets[slot],moves:view.sets[slot].moves!.map(m=>m===used?'Protect':m).filter((m,i,a)=>a.indexOf(m)===i)};while(changed.moves.length<4)changed.moves.push(['Endure','Substitute','Rest'].find(m=>!changed.moves.includes(m))!);
  applyAction(db,{type:'team-replace-sets',teamId:team.id,versionId:team.activeVersionId,sets:[{slot,set:changed,baseRevisionId:view.configuration.slots[slot].revisionId}],summary:'later edit'} as any);
  const later=team.versions[0].configurations.at(-1)!;later.createdAt=new Date(Date.parse(g.date!)+86400000).toISOString();
  assert.equal(autoLink(db,g).association!.configurationId,team.versions[0].configurations[0].id,'the edit current at play time wins');
  // If no saved edit fits what the battle showed, it links by six only and says why.
  team.versions[0].configurations=[later];team.versions[0].currentConfigurationId=later.id;
  const differed=autoLink(db,g).association!;assert.equal(differed.certainty,'family');assert.match(differed.note!,new RegExp(`used ${used}`));
});
