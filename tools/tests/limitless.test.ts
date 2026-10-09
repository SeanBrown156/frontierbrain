import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStandings,parseTeamList,parseEventList,speciesName} from '../limitless.ts';
const row=(place:number,team:string)=>`<tr><td>${place}</td><td><a href="/players/1">Eric Rios</a></td><td><img class="flag" alt="ES"></td><td><div class="vgc-team"><a href="/pokemon/floette-eternal" data-tooltip="Eternal Flower Floette"><img class="pokemon" alt=""></a><a href="/pokemon/incineroar" data-tooltip="Incineroar"><img class="pokemon" alt=""></a></div></td><td><a href="/teams/${team}"><i></i></a></td></tr>`;
test('Limitless standings keep placing, player and dex-mapped species for every Day 2 team',()=>{
  const rows=parseStandings(`<table><tr><th>#</th></tr>${row(1,'7038')}${row(2,'7039')}</table>`);
  assert.equal(rows.length,2);assert.deepEqual(rows[0],{place:1,player:'Eric Rios',country:'ES',pokemon:['Floette-Eternal','Incineroar'],teamId:'7038'});assert.equal(speciesName('notamon','Label'),'Label');
  assert.deepEqual(parseEventList('<a href="/tournaments/443">Regional Frankfurt</a>'),[{id:'443',name:'Regional Frankfurt'}]);
});
test('Team lists give item, ability, nature and moves, and never invent stat points',()=>{
  const sets=parseTeamList('<div class="pkmn" data-id="incineroar"><div class="name"><a>Incineroar</a></div><div class="details"><div class="item">Sitrus Berry</div><div class="ability">Ability: Intimidate</div><div class="nature">Impish Nature</div></div><ul class="moves"><li>Fake Out</li><li>Parting Shot</li></ul></div>');
  assert.deepEqual(sets,[{species:'Incineroar',item:'Sitrus Berry',ability:'Intimidate',nature:'Impish',moves:['Fake Out','Parting Shot']}]);assert.equal('statPoints'in sets[0],false);
});
