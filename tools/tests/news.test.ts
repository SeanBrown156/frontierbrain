import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {CODE} from '../io.ts';
import {mergeNews,weekStart} from '../workbench-data.ts';
import type {NewsWeek} from '../../shared/workbench.ts';

// The committed news file (written weekly by the frontier-brain-news routine) must match the dashboard's NewsWeek shape.
const weeks=JSON.parse(readFileSync(resolve(CODE,'knowledge/news/weeks.json'),'utf8')) as NewsWeek[];
const DAY=/^\d{4}-\d{2}-\d{2}$/;
test('knowledge/news/weeks.json: Monday–Sunday weeks, newest first, one entry per week',()=>{
  assert.ok(Array.isArray(weeks)&&weeks.length>0);
  for(const w of weeks){
    assert.match(w.start,DAY);assert.match(w.end,DAY);assert.equal(weekStart(w.start),w.start,`${w.start} is not a Monday`);
    const end=new Date(w.start+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+6);assert.equal(w.end,end.toISOString().slice(0,10),`${w.start}: end must be the Sunday`);
    assert.equal(typeof w.partial,'boolean');assert.ok(Number.isFinite(Date.parse(w.researchedAt)),`${w.start}: researchedAt`);
    assert.ok(Array.isArray(w.digest)&&w.digest.every(d=>typeof d==='string'&&d.trim()));
    assert.ok(Array.isArray(w.coverage)&&w.coverage.length>0,`${w.start}: coverage gaps must be stated`);
  }
  assert.deepEqual(weeks.map(w=>w.start),[...weeks.map(w=>w.start)].sort().reverse(),'newest week first');
  assert.equal(new Set(weeks.map(w=>w.start)).size,weeks.length,'one entry per week');
});
test('knowledge/news/weeks.json: articles are sourced and dated; signals cite articles of their week',()=>{
  for(const w of weeks){const ids=new Set<string>();
    for(const a of w.articles){
      assert.ok(a.id&&!ids.has(a.id),`${w.start}: duplicate or empty article id ${a.id}`);ids.add(a.id);
      assert.ok(a.title&&a.source&&a.format&&a.summary,`${w.start}/${a.id}: title, source, format and summary are required`);
      assert.match(a.url,/^https:\/\//,`${w.start}/${a.id}: url`);assert.match(a.publishedAt,DAY,`${w.start}/${a.id}: publishedAt`);
      assert.ok(['tournament','report','official','community'].includes(a.category),`${w.start}/${a.id}: category ${a.category}`);
    }
    for(const s of w.signals??[]){
      assert.ok(['measured','report','community'].includes(s.kind),`${w.start}: signal kind ${s.kind}`);assert.ok(s.title&&s.summary);
      assert.ok(s.articleIds.length>0&&s.articleIds.every(id=>ids.has(id)),`${w.start}: signal "${s.title}" must cite this week's articles`);
    }
  }
});
test('Repository and data-directory news merge per week; the more recently researched copy wins',()=>{
  const wk=(start:string,researchedAt:string,digest:string):NewsWeek=>({start,end:'',partial:false,digest:[digest],articles:[],coverage:['x'],researchedAt});
  const merged=mergeNews([wk('2026-10-05','2026-10-12T00:00:00Z','repo'),wk('2026-09-28','2026-10-01T00:00:00Z','repo')],[wk('2026-10-05','2026-10-08T00:00:00Z','local'),wk('2026-09-21','2026-09-25T00:00:00Z','local')]);
  assert.deepEqual(merged.map(w=>[w.start,w.digest[0]]),[['2026-10-05','repo'],['2026-09-28','repo'],['2026-09-21','local']]);
});
