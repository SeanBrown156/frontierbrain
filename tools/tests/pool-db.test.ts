import {test} from 'node:test';
import assert from 'node:assert/strict';
import {poolRows,resolveSpecies,playerId,shrinkage} from '../pool-db.ts';
import type {PoolTeam} from '../pool.ts';

// A tiny synthetic pool: one official team (Limitless display names, a merged paste), one online team (record,
// a typo'd item, an empty move slot) and one shared paste by the same player as the online team.
const sp={hp:32,atk:0,def:14,spa:0,spd:20,spe:0};
const set=(species:string,extra={})=>({species,item:'Sitrus Berry',ability:'Intimidate',nature:'Careful',moves:['Fake Out','Protect'],...extra});
const six=['Incineroar','Eternal Flower Floette','Rillaboom','Sneasler','Female Indeedee','Wash Rotom'];
const teams:PoolTeam[]=[
  {id:'official:444:1:alice',lane:'official',event:'Regional Recife',eventId:'444',date:'2026-10-03',players:222,player:'Alice',placing:1,record:null,pokemon:six,
    sets:six.map(s=>set(s,s==='Incineroar'?{statPoints:sp}:{})),sources:[{name:'Limitless',url:'https://limitlessvgc.com/teams/1'},{name:'VGCPastes',url:'https://pokepast.es/aaa'}],spreadsFrom:{name:'VGCPastes',url:'https://pokepast.es/aaa'}},
  {id:'online:abc:bob',lane:'online',event:'Weekly #1',eventId:'abc',date:'2026-10-05',players:40,player:'Bob ',placing:3,record:'4-1-1',pokemon:six,
    sets:six.map(s=>set(s,s==='Sneasler'?{item:'Focus Slash',moves:['Close Combat','-','Protect']}:{})),sources:[{name:'Limitless online',url:'https://play.limitlesstcg.com/tournament/abc/standings'}]},
  {id:'shared:MC1',lane:'shared',event:'Video',eventId:'',date:'2026-10-06',players:null,player:'bob',placing:null,record:null,pokemon:six,
    sets:six.map(s=>set(s,{nature:'naïve',statPoints:sp})),sources:[{name:'VGCPastes',url:'https://pokepast.es/bbb'}]},
];
const rows=poolRows(teams,{refreshedAt:'2026-10-08T00:00:00.000Z'});

test('Limitless display names resolve to Showdown forms; unknown names do not',()=>{
  assert.equal(resolveSpecies('Eternal Flower Floette'),'Floette-Eternal');
  assert.equal(resolveSpecies('Female Indeedee'),'Indeedee-F');
  assert.equal(resolveSpecies('Paldean Tauros Aqua Breed'),'Tauros-Paldea-Aqua');
  assert.equal(resolveSpecies('Low Key Toxtricity'),'Toxtricity-Low-Key');
  assert.equal(resolveSpecies('Wash Rotom'),'Rotom-Wash');
  assert.equal(resolveSpecies('Notamon'),null);
});

test('Events only for tournament lanes, players by normalised name, teams keep lane, record and sources',()=>{
  assert.deepEqual(rows.events.map(e=>[e.id,e.source,e.players_count,e.format]).sort(),[['official:444','Limitless',222,'M-C'],['online:abc','Limitless online',40,'M-C']]);
  assert.deepEqual(rows.players.map(p=>p.id).sort(),['alice','bob']);
  assert.equal(rows.players.find(p=>p.id==='bob')!.name,'bob','newest appearance names the player');
  const [official,online,shared]=['official:444:1:alice','online:abc:bob','shared:MC1'].map(id=>rows.teams.find(t=>t.id===id)!);
  assert.equal(official.shared_paste_url,'https://pokepast.es/aaa');assert.equal(official.source_url,'https://limitlessvgc.com/teams/1');assert.equal(official.wins,null);
  assert.deepEqual([online.wins,online.losses,online.ties,online.place],[4,1,1,3]);
  assert.equal(shared.event_id,null);assert.equal(shared.event_label,'Video');assert.equal(shared.shared_paste_url,'https://pokepast.es/bbb');assert.equal(shared.player_id,'bob');
  assert.equal(playerId('สายฟ้า คล้ายสอน'),'สายฟ้า คล้ายสอน','non-Latin names still get an id');
});

test('Six members per team; identical sets share one row; SP all-or-nothing within the Champions limits',()=>{
  assert.equal(rows.members.length,18);
  for(const t of rows.teams)assert.deepEqual(rows.members.filter(m=>m.team_id===t.id).map(m=>m.slot),[1,2,3,4,5,6]);
  // Official and online Rillaboom are the same set (no SP); the shared one differs (nature, SP).
  const rilla=rows.sets.filter(s=>s.species==='Rillaboom');assert.equal(rilla.length,2);
  for(const s of rows.sets){const v=[s.hp_sp,s.atk_sp,s.def_sp,s.spa_sp,s.spd_sp,s.spe_sp];assert.ok(v.every(x=>x===null)||v.every(x=>x!==null&&x>=0&&x<=32));
    if(v[0]!==null)assert.ok((v as number[]).reduce((a,b)=>a+b,0)<=66);assert.ok(s.moves.length<=4);}
  const floette=rows.sets.find(s=>s.species==='Floette-Eternal')!;assert.equal(floette.base_species,'Floette');
  assert.equal(rows.sets.find(s=>s.species==='Rotom-Wash')!.base_species,'Rotom');
});

test('Names are canonicalised when the engine knows them, otherwise kept as written and flagged',()=>{
  const sneasler=rows.sets.find(s=>s.species==='Sneasler'&&s.item==='Focus Slash')!;
  assert.deepEqual(sneasler.unresolved,['item']);assert.deepEqual(sneasler.moves,['Close Combat','Protect'],'"-" is an empty slot, not a move');
  assert.equal(rows.unresolved.item['Focus Slash'],1);
  const pasted=rows.sets.filter(s=>s.hp_sp!==null&&s.nature!=='Careful');assert.equal(pasted.length,6);
  assert.ok(pasted.every(s=>s.nature==='Naive'&&!s.unresolved.length),'"naïve" resolves to Naive');
  assert.equal(Object.keys(rows.unresolved.species).length,0);
});
test('A load that would shrink the hosted pool sharply is flagged; normal turnover is not',()=>{
  assert.match(shrinkage(396,7759)!,/396 teams .* 7759 \(95% fewer\)/);
  assert.equal(shrinkage(7500,7759),null);assert.equal(shrinkage(8000,7759),null);assert.equal(shrinkage(10,null),null);
});
