import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {regulationStatus,formatPrimer,formatRules} from '../format.ts';
import {FORMATS} from '../../shared/formats.ts';
import {emptyStore,makeTeam,teamPaste,currentTeam} from '../workbench-store.ts';
import {CODE} from '../io.ts';

const day=(iso:string)=>Date.parse(iso+'T12:00:00Z');
test('A regulation says when it is active, ending (21 days) or ended, from its record',()=>{
  assert.equal(regulationStatus(undefined,day('2026-10-13'))!.status,'active');
  assert.equal(regulationStatus(undefined,day('2026-11-20'))!.status,'ending');
  assert.equal(regulationStatus(undefined,day('2026-12-01'))!.daysLeft,1);
  assert.equal(regulationStatus(undefined,day('2026-12-03'))!.status,'ended');
  assert.equal(regulationStatus(undefined,day('2026-09-01'))!.status,'upcoming');
  assert.equal(regulationStatus('gen9ou'),null,'a format with no record has no status');
  assert.equal(formatRules().regulation!.id,'M-C');
});
test('The assistant primer says so when the regulation has ended',()=>{
  const real=Date.now;try{Date.now=()=>day('2026-12-03');assert.match(formatPrimer(),/IMPORTANT: Regulation M-C ended on 2026-12-02/);
    Date.now=()=>day('2026-11-25');assert.match(formatPrimer(),/ends on 2026-12-02 \(\d+ days? left\)/);
    Date.now=()=>day('2026-10-13');assert.doesNotMatch(formatPrimer(),/IMPORTANT|ends on/);}finally{Date.now=real;}
});
test('Only current formats are offered; a team that is no longer legal can still be exported',()=>{
  assert.deepEqual(FORMATS.map(f=>f.id),['gen9championsvgc2026regmc']);
  const paste=JSON.parse(readFileSync(resolve(CODE,'tools/tests/fixtures/teams.json'),'utf8'))[0].paste;
  const db=emptyStore();const team=makeTeam(db,'Old',paste);team.format='gen9championsvgc2026regmb';
  assert.ok(currentTeam(db,team).errors.length>0,'it is shown as not legal');
  assert.match(teamPaste(db,team),/@/,'but its paste can still be exported');
});
