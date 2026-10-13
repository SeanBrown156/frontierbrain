import test from 'node:test';
import assert from 'node:assert/strict';
import {damage} from '../mechanics.ts';

const mons:any={attacker:{species:'Hatterene',nature:'Modest',ability:'Magic Bounce',item:'Life Orb',statPoints:{hp:0,atk:0,def:0,spa:32,spd:0,spe:0}},
  defender:{species:'Rillaboom',nature:'Adamant',ability:'Grassy Surge',statPoints:{hp:32,atk:0,def:0,spa:0,spd:0,spe:0}},move:'Expanding Force'};

test('Expanding Force is a spread move only in Psychic Terrain (second target allowed, hits-one refused)',()=>{
  const plain=damage({...mons,field:{gameType:'Doubles'}}) as any;
  assert.ok(!plain.assumptions.some((n:string)=>/spread/i.test(n)),'no spread note without the terrain');
  const terrain=damage({...mons,field:{gameType:'Doubles',terrain:'Psychic'}}) as any;
  assert.ok(terrain.assumptions.some((n:string)=>/Expanding Force: in Psychic Terrain it hits both/.test(n)));
  assert.throws(()=>damage({...mons,field:{gameType:'Doubles',terrain:'Psychic'},moveOptions:{spread:false}}),/always hits both/);
  const two=damage({...mons,field:{gameType:'Doubles',terrain:'Psychic'},secondDefender:{...mons.defender,species:'Incineroar',ability:'Intimidate'}}) as any;
  assert.ok(two.secondTarget,'a second target is calculated');
});
