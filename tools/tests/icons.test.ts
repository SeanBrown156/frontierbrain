import test from 'node:test';
import assert from 'node:assert/strict';
import {homeSpriteId,homeSpriteURL,dexInfo} from '../icons.ts';

test('HOME render ids follow Showdown sprite ids, including forms', ()=>{
  assert.equal(homeSpriteId('Kommo-o'),'kommoo');
  assert.equal(homeSpriteId('Gengar-Mega'),'gengar-mega');
  assert.equal(homeSpriteId('Ninetales-Alola'),'ninetales-alola');
  assert.equal(homeSpriteId('Not A Pokemon'),null);
  assert.equal(homeSpriteURL('kommoo'),'https://play.pokemonshowdown.com/sprites/home/kommoo.png');
});

test('dex info gives types, base stats and item sheet positions; unknown names are empty', ()=>{
  const d=dexInfo(['Incineroar','Nope'],['Sitrus Berry','Nope']);
  assert.deepEqual(d.types.Incineroar,['Fire','Dark']);
  assert.deepEqual(d.types.Nope,[]);
  assert.equal(d.base.Incineroar.hp,95);
  assert.equal(d.base.Nope,undefined);
  assert.ok(d.items['Sitrus Berry']>0);
  assert.equal(d.items.Nope,0);
});
