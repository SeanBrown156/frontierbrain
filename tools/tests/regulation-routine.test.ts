import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {CODE} from '../io.ts';
import {runRegulationRoutine,regulationCheck,parseAnnouncements,listingRegulations,type RoutineResult} from '../regulation-routine.ts';
import {loadRegulationsSync,validateRegulations,validateNotices,regulationStatusFor,type RegulationIndex,type RegulationRecord,type RegulationNotice} from '../regulation.ts';

// Everything here runs on a fake clock and a fake fetch: no network. Fixtures: tools/tests/fixtures/regulation/
// (page 816 and the listing are real copies retrieved 2026-10-13; the M-D and M-E pages are INVENTED).
const fx=(f:string)=>readFileSync(resolve(CODE,'tools/tests/fixtures/regulation',f),'utf8');
const MC:RegulationRecord=JSON.parse(readFileSync(resolve(CODE,'knowledge/regulations/m-c.json'),'utf8'));
const LIST='https://champions-news.pokemon-home.com/en/json/list.json',P816=MC.officialURL!;
const P900='https://champions-news.pokemon-home.com/en/page/900.html',P901='https://champions-news.pokemon-home.com/en/page/901.html';
const T=(s:string)=>Date.parse(s);
const DAY=86_400_000;
const index=(over:Partial<RegulationIndex>={}):RegulationIndex=>({active:'M-C',next:null,nextCheckAt:'2026-10-20T06:30:00Z',lastCheckedAt:null,history:[],...over});
const net=(pages:Record<string,string>)=>{const calls:string[]=[];const fetchText=async(u:string)=>{calls.push(u);if(!(u in pages))throw new Error('HTTP 404');return pages[u];};return {fetchText,calls};};
const withMD=()=>({[LIST]:fx('list-with-md.json'),[P816]:fx('m-c-page-816.html'),[P900]:fx('m-d-announcement.html')});
const withoutMD=()=>({[LIST]:fx('list.json'),[P816]:fx('m-c-page-816.html')});
const mdRecord=(over:Partial<RegulationRecord>={}):RegulationRecord=>({id:'M-D',game:MC.game,battleType:MC.battleType,officialURL:P900,startsAt:'2026-12-02T02:00:00Z',endsAt:'2027-02-24T01:59:00Z',status:'upcoming',confidence:'official',engine:{verified:false},showdownFormats:[],evidence:['fixture'],...over});
const run=(o:{now:string;index?:RegulationIndex;records?:Record<string,RegulationRecord>;pages:Record<string,string>;notices?:RegulationNotice[];force?:boolean})=>{
  const n=net(o.pages);return runRegulationRoutine({now:T(o.now),index:o.index??index(),records:o.records??{'M-C':MC},fetchText:n.fetchText,notices:o.notices,force:o.force}).then(r=>({r,calls:n.calls}));
};
const apply=(r:RoutineResult)=>({index:r.index,records:r.records});

test('Parser: page 816 and the invented successor pages give both timestamps; partial pages stay partial',()=>{
  assert.deepEqual(parseAnnouncements(fx('m-c-page-816.html')),[{id:'M-C',startsAt:'2026-09-09T02:00:00Z',endsAt:'2026-12-02T01:59:00Z'}]);
  assert.deepEqual(parseAnnouncements(fx('m-d-announcement.html')),[{id:'M-D',startsAt:'2026-12-02T02:00:00Z',endsAt:'2027-02-24T01:59:00Z'}]);
  assert.deepEqual(parseAnnouncements(fx('m-d-partial.html')),[{id:'M-D',startsAt:'2026-12-02T02:00:00Z'}]);
  assert.deepEqual(parseAnnouncements('<p>nothing to see</p>'),[]);
  assert.deepEqual(parseAnnouncements('<h1>Regulation Set M-D</h1> Wednesday, February 31, 2027, at 02:00 UTC'),[{id:'M-D'}],'an impossible date is not a date');
  const two=parseAnnouncements('<p>Regulation M-C ends on Wednesday, December 2, 2026, at 01:59 UTC.</p><p>Regulation Set M-D starts Wednesday, December 2, 2026, at 02:00 UTC.</p>');
  assert.deepEqual(two,[{id:'M-C',endsAt:'2026-12-02T01:59:00Z'},{id:'M-D',startsAt:'2026-12-02T02:00:00Z'}]);
});
test('Parser: the listing JSON yields regulation entries with article URLs; an HTML listing falls back to anchors',()=>{
  const l=listingRegulations(fx('list.json'),LIST);
  assert.deepEqual(l.map(e=>e.id),['M-C','M-B','M-A']);assert.equal(l[0].url,P816);
  const html=listingRegulations('<a href="page/77.html"><span>Regulation Set M-Q</span></a><a href="page/1.html">Maintenance</a>','https://champions-news.pokemon-home.com/en/list');
  assert.deepEqual(html.map(e=>[e.id,e.url]),[['M-Q','https://champions-news.pokemon-home.com/en/page/77.html']]);
});

test('Not due: no fetch, no writes, nothing changes',async()=>{
  const {r,calls}=await run({now:'2026-10-19T12:00:00Z',pages:{}});
  assert.equal(r.due,false);assert.equal(calls.length,0);assert.deepEqual(r.writes,[]);assert.equal(r.nextCheckAt,'2026-10-20T06:30:00Z');assert.equal(r.actions[0].kind,'skipped');
});
test('Unknown successor far from the end: checks again in a month, never later than the end date',async()=>{
  const {r}=await run({now:'2026-09-20T07:00:00Z',index:index({nextCheckAt:'2026-09-20T00:00:00Z'}),pages:withoutMD()});
  assert.equal(r.index.next,null);assert.equal(r.nextCheckAt,'2026-10-20T07:00:00Z');assert.equal(r.index.active,'M-C');assert.equal(r.index.lastError,null);
  assert.equal(r.index.lastCheckedAt,'2026-09-20T07:00:00Z');
});
test('Within 60 days of the end with no successor: weekly',async()=>{
  const {r}=await run({now:'2026-10-20T07:00:00Z',pages:withoutMD()});
  assert.equal(r.nextCheckAt,'2026-10-27T07:00:00Z');assert.equal(r.notices.length,0);
  const late=await run({now:'2026-11-28T07:00:00Z',index:index({nextCheckAt:'2026-11-28T00:00:00Z'}),pages:withoutMD()});
  assert.equal(late.r.nextCheckAt,'2026-12-02T01:59:00Z','the last week wakes at the end itself');
});
test('Discovery: an official announcement with both dates becomes an upcoming, official next regulation',async()=>{
  const {r,calls}=await run({now:'2026-10-20T07:00:00Z',pages:withMD()});
  assert.equal(r.index.active,'M-C');assert.equal(r.index.next,'M-D');
  const d=r.records['M-D'];assert.equal(d.status,'upcoming');assert.equal(d.confidence,'official');assert.equal(d.startsAt,'2026-12-02T02:00:00Z');assert.equal(d.endsAt,'2027-02-24T01:59:00Z');
  assert.equal(d.engine?.verified,false,'the engine is never assumed to know the new legal list');
  assert.ok(calls.includes(P900));assert.ok(!calls.some(c=>/page\/(776|751)/.test(c)),'earlier regulations are not fetched');
  assert.deepEqual(r.notices.map(n=>n.id),['reg-next-M-D']);assert.equal(r.issues.length,0);
  assert.ok(T(r.nextCheckAt)>T('2026-10-20T07:00:00Z')&&T(r.nextCheckAt)<=T(d.startsAt!),'wakes at or before the start');
  assert.equal(r.nextCheckAt,new Date(T('2026-10-20T07:00:00Z')+14*DAY).toISOString().replace('.000Z','Z'),'re-reads a confirmed date fortnightly');
  assert.deepEqual(r.writes.map(w=>w.path).sort(),['knowledge/regulations/index.json','knowledge/regulations/m-d.json','knowledge/regulations/notices.json']);
  assert.deepEqual(validateRegulations(r.index,r.records),[]);
});
test('Changeover: M-C has ended, the official M-D start is re-verified, then the app switches; history and notice are written',async()=>{
  const records={'M-C':MC,'M-D':mdRecord()};
  const {r,calls}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records,pages:{...withMD(),[LIST]:fx('list-with-md.json')}});
  assert.ok(calls.includes(P900),'re-fetched the official source before switching');
  assert.equal(r.index.active,'M-D');assert.equal(r.index.next,null);assert.equal(r.records['M-C'].status,'ended');assert.equal(r.records['M-D'].status,'active');
  assert.equal(r.index.history.length,1);const h=r.index.history[0];
  assert.equal(h.from,'M-C');assert.equal(h.to,'M-D');assert.equal(h.confidence,'official');assert.equal(h.switchedAt,'2026-12-02T06:30:00Z');assert.ok(h.evidence.length>0);
  const n=r.notices.find(x=>x.id==='reg-switched-M-D')!;assert.match(n.title,/Now on Regulation M-D/);assert.equal(n.kind,'regulation');assert.match(n.body,/not verified yet/);
  assert.ok(T(r.nextCheckAt)>T('2026-12-02T06:30:00Z'));
  assert.deepEqual(validateRegulations(r.index,r.records),[]);
  // Teams and data are not part of any write.
  assert.ok(r.writes.every(w=>w.path.startsWith('knowledge/regulations/')));
});
test('After a switch, discovery runs at once for the following regulation and sets the routine for its date',async()=>{
  const list=JSON.parse(fx('list-with-md.json'));
  list.data.unshift({id:'901',title:'Regulation Set M-E',kindTxt:'Regulations',link:'page/901.html',pubAt:1_800_000_000});
  const pages={...withMD(),[LIST]:JSON.stringify(list),[P900]:fx('m-d-announcement.html'),[P901]:fx('m-e-announcement.html')};
  const {r}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':mdRecord()},pages});
  assert.equal(r.index.active,'M-D');assert.equal(r.index.next,'M-E');assert.equal(r.records['M-E'].startsAt,'2027-02-24T02:00:00Z');
  assert.equal(r.records['M-E'].status,'upcoming');
  assert.ok(r.notices.some(n=>n.id==='reg-switched-M-D')&&r.notices.some(n=>n.id==='reg-next-M-E'));
  assert.ok(T(r.nextCheckAt)<=T('2027-02-24T02:00:00Z'));
});
test('After a switch with no announced successor: monthly (the new end is more than 60 days away)',async()=>{
  const {r}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':mdRecord()},
    pages:{[P900]:fx('m-d-announcement.html'),[LIST]:fx('list-with-md.json')}});
  assert.equal(r.index.active,'M-D');assert.equal(r.index.next,null);assert.equal(r.nextCheckAt,'2027-01-01T06:30:00Z');
});
test('Idempotent: a second run at the same time does nothing; a forced re-run does not switch twice',async()=>{
  const first=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':mdRecord()},pages:withMD()});
  const second=await run({now:'2026-12-02T06:30:00Z',...apply(first.r),pages:withMD(),notices:first.r.notices});
  assert.equal(second.r.due,false);assert.deepEqual(second.r.writes,[]);assert.equal(second.calls.length,0);
  const forced=await run({now:'2026-12-02T06:31:00Z',force:true,...apply(first.r),pages:withMD(),notices:first.r.notices});
  assert.equal(forced.r.index.history.length,1);assert.equal(forced.r.index.active,'M-D');
  assert.ok(forced.r.notices.every(n=>n.id!=='reg-switched-M-D'),'no duplicate notice');
});
test('Fetch failure: records lastError, never switches, retries tomorrow',async()=>{
  const {r}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':mdRecord()},pages:{}});
  assert.equal(r.index.active,'M-C');assert.equal(r.index.history.length,0);assert.equal(r.records['M-D'].status,'upcoming');
  assert.match(r.index.lastError!,/404/);assert.equal(r.nextCheckAt,'2026-12-03T06:30:00Z');assert.ok(r.actions.some(a=>a.kind==='fetch-failed'));
  assert.equal(r.index.errorStreak,1);
  // Three failed runs in a row ask the owner to look.
  let s=r;let last=r;for(let i=0;i<2;i++){const at=new Date(T(s.nextCheckAt)).toISOString();last=(await run({now:at,...apply(s),pages:{}})).r;s=last;}
  assert.ok(last.issues.some(i=>i.key==='fetch-failing'));
});
test('A page that stops stating the dates blocks the switch and asks for a human',async()=>{
  const {r}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':mdRecord()},pages:{...withMD(),[P900]:'<html><body>Page moved.</body></html>'}});
  assert.equal(r.index.active,'M-C');assert.ok(r.issues.some(i=>i.key==='unverified-M-D'));assert.ok(r.notices.some(n=>n.id==='reg-ended-M-C'&&n.level==='warning'));
});
test('Secondary or draft evidence never switches: an issue is requested and the previous regulation is reported ended',async()=>{
  const draft=mdRecord({status:'draft',confidence:'secondary',endsAt:undefined});
  const {r}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':draft},pages:withoutMD()});
  assert.equal(r.index.active,'M-C');assert.equal(r.index.next,'M-D');assert.equal(r.records['M-D'].status,'draft');
  assert.ok(r.issues.some(i=>i.key==='unconfirmed-M-D'));assert.ok(r.notices.some(n=>n.id==='reg-ended-M-C'&&/not confirmed/.test(n.body)));
  const again=await run({now:'2026-12-03T06:30:00Z',notices:r.notices,...apply(r),pages:withoutMD()});
  assert.equal(again.r.issues.length,0,'the same issue is not requested twice');
});
test('Found on a non-official site: stored as a draft with an issue request, not as the next regulation',async()=>{
  const blog='https://example.test/champions-regulations';
  const {r}=await run({now:'2026-10-20T07:00:00Z',index:index({sources:{secondary:[blog]}}),pages:{...withoutMD(),[blog]:fx('m-d-announcement.html')}});
  assert.equal(r.index.next,'M-D');assert.equal(r.records['M-D'].status,'draft');assert.equal(r.records['M-D'].confidence,'secondary');
  assert.ok(r.issues.some(i=>i.key==='draft-M-D'));assert.equal(r.index.active,'M-C');
  assert.deepEqual(validateRegulations(r.index,r.records),[]);
});
test('An official page with only a start date is a draft; once both dates appear it is promoted',async()=>{
  const list=JSON.parse(fx('list-with-md.json'));
  const a=await run({now:'2026-10-20T07:00:00Z',pages:{...withMD(),[LIST]:JSON.stringify(list),[P900]:fx('m-d-partial.html')}});
  assert.equal(a.r.records['M-D'].status,'draft');assert.equal(a.r.records['M-D'].endsAt,undefined);assert.ok(a.r.issues.some(i=>i.key==='draft-M-D'));
  assert.ok(T(a.r.nextCheckAt)<=T('2026-10-27T07:00:00Z'),'a draft is re-checked weekly');
  const b=await run({now:'2026-10-27T07:00:00Z',...apply(a.r),notices:a.r.notices,pages:withMD()});
  assert.equal(b.r.records['M-D'].status,'upcoming');assert.equal(b.r.records['M-D'].confidence,'official');assert.ok(b.r.actions.some(x=>x.kind==='promoted'));
});
test('A start date that moved is corrected from the official page, and the switch waits for the new date',async()=>{
  const {r}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':mdRecord()},pages:{...withMD(),[P900]:fx('m-d-moved.html')}});
  assert.equal(r.index.active,'M-C');assert.equal(r.records['M-D'].startsAt,'2026-12-09T02:00:00Z');assert.ok(r.actions.some(a=>a.kind==='dates-updated'));
  assert.equal(r.nextCheckAt,'2026-12-09T02:00:00Z');assert.ok(r.notices.some(n=>/dates changed/.test(n.title)));
});
test('Ended with no announced successor: reported once, checked daily, current regulation unchanged',async()=>{
  const {r}=await run({now:'2026-12-03T06:30:00Z',index:index({nextCheckAt:'2026-12-02T00:00:00Z'}),pages:withoutMD()});
  assert.equal(r.index.active,'M-C');assert.ok(r.notices.some(n=>n.id==='reg-ended-M-C'));assert.equal(r.nextCheckAt,'2026-12-04T06:30:00Z');
  assert.ok(r.actions.some(a=>a.kind==='ended-unconfirmed'));
  const status=regulationStatusFor(apply(r),undefined,T('2026-12-03T06:30:00Z'));assert.equal(status!.status,'ended');
});

test('regulationStatus follows the index: after a switch the active record is M-D, unverified, with a 14-day "now on" window',async()=>{
  const {r}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':mdRecord()},pages:withMD()});
  const state=apply(r);
  const s=regulationStatusFor(state,undefined,T('2026-12-03T00:00:00Z'))!;
  assert.equal(s.id,'M-D');assert.equal(s.status,'active');assert.equal(s.engineVerified,false);assert.equal(s.switched?.from,'M-C');
  assert.equal(regulationStatusFor(state,undefined,T('2026-12-17T00:00:00Z'))!.switched,null,'the notice window is 14 days');
  const old=regulationStatusFor(state,'gen9championsvgc2026regmc',T('2026-12-03T00:00:00Z'))!;assert.equal(old.id,'M-C');assert.equal(old.status,'ended');assert.equal(old.engineVerified,true);
  assert.equal(regulationStatusFor(state,'gen9ou',T('2026-12-03T00:00:00Z')),null);
});
test('format.ts reads the active record from the index and says legality is not verified (data directory with M-D active)',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'regulation-'));mkdirSync(resolve(dir,'knowledge/regulations'),{recursive:true});
  const w=(f:string,v:unknown)=>writeFileSync(resolve(dir,'knowledge/regulations',f),JSON.stringify(v));
  w('index.json',index({active:'M-D',nextCheckAt:'2027-01-01T00:00:00Z',history:[{id:'switch-M-C-M-D',switchedAt:'2026-12-02T06:30:00Z',from:'M-C',to:'M-D',confidence:'official',evidence:['x']}]}));
  w('m-d.json',mdRecord({status:'active'}));w('m-c.json',{...MC,status:'ended'});
  const script=`const f=await import(${JSON.stringify(resolve(CODE,'tools/format.ts'))});Date.now=()=>Date.parse('2026-12-10T00:00:00Z');
    console.log(JSON.stringify({s:f.regulationStatus(),p:f.formatPrimer(),r:f.formatRules().regulation?.id}));`;
  const out=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,APP_DATA:dir},encoding:'utf8'}));
  assert.equal(out.s.id,'M-D');assert.equal(out.r,'M-D');assert.equal(out.s.engineVerified,false);
  assert.match(out.p,/Legality data for M-D is not verified yet/);
  assert.doesNotMatch(out.p,/Regulation M-C ended/);
});

test('Committed records pass the validator; exactly one is active and it matches the index',()=>{
  const s=loadRegulationsSync([CODE])!;assert.ok(s);assert.deepEqual(validateRegulations(s.index,s.records),[]);
  assert.equal(s.index.active,'M-C');assert.equal(s.records['M-C'].engine?.verified,true);assert.equal(s.records['M-C'].confidence,'official');
});
test('Validator rejects two active records, an unofficial upcoming next and inverted dates',()=>{
  const bad=validateRegulations(index({next:'M-D'}),{'M-C':MC,'M-D':mdRecord({status:'upcoming',confidence:'secondary',startsAt:'2027-03-01T00:00:00Z'}),'M-E':{...mdRecord({id:'M-E'}),status:'active'},'M-X':{...MC,id:'M-X',status:'active'}});
  assert.ok(bad.some(p=>/more than one record is active/.test(p)));assert.ok(bad.some(p=>/official confidence/.test(p)));assert.ok(bad.some(p=>/startsAt must be before endsAt/.test(p)));
});
test('knowledge/regulations/notices.json and the notices the routine writes match the schema the Inbox reads; the file keeps 50',async()=>{
  const committed=JSON.parse(readFileSync(resolve(CODE,'knowledge/regulations/notices.json'),'utf8'));
  assert.deepEqual(validateNotices(committed),[]);
  const old:RegulationNotice[]=Array.from({length:50},(_,i)=>({id:`old-${i}`,at:'2026-10-01T00:00:00Z',kind:'regulation',level:'info',title:'t',body:'b'}));
  const {r}=await run({now:'2026-12-02T06:30:00Z',index:index({next:'M-D',nextCheckAt:'2026-12-02T02:00:00Z'}),records:{'M-C':MC,'M-D':mdRecord()},pages:withMD(),notices:old});
  const file=r.writes.find(w=>w.path==='knowledge/regulations/notices.json')!.data as {notices:RegulationNotice[]};
  assert.equal(file.notices.length,50);assert.equal(file.notices.at(-1)!.id,r.notices.at(-1)!.id);assert.equal(file.notices[0].id,`old-${r.notices.length}`);
  assert.deepEqual(validateNotices(file),[]);
  for(const n of r.notices){assert.deepEqual(Object.keys(n).filter(k=>!['id','at','kind','level','title','body','url'].includes(k)),[]);}
});
test('regulationCheck --dry-run prints what it would do and writes nothing',async()=>{
  const n=net(withMD());
  const s=await regulationCheck({dryRun:true,force:true,now:T('2026-10-20T07:00:00Z'),fetchText:n.fetchText});
  assert.equal(s.dryRun,true);assert.equal(s.next,'M-D');assert.deepEqual(s.wrote,[]);assert.ok(s.wouldWrite!.includes('knowledge/regulations/index.json'));
  assert.equal(JSON.parse(readFileSync(resolve(CODE,'knowledge/regulations/index.json'),'utf8')).next,null,'the committed index is untouched');
});
