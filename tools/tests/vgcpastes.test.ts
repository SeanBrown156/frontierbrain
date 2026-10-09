import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,parseIndex,setsFromPaste} from '../vgcpastes.ts';
const csv=`,VGCPastes Repository (Champions M-C),,\n,"Click, here",,\nTeam ID,Team Description,,Full Name,,1,Pokepaste,EVs,Date Shared,Tournament / Event,Rank,Link to Source,Pokemon Text for Copypasta,,,,,,Team ID\nMC2,"Ace's ""Rain"" team",,Ace,,,https://pokepast.es/5a9a8c047dc2566d,Yes,1 Oct 2026,Global Challenge I,3rd,https://x.com/a,Golisopod-Mega,Pelipper,Basculegion-F,Grimmsnarl,Archaludon,Garchomp,MC2\nMC1,Bob team,,Bob,,,https://pokepast.es/c7e82f90c1bd0922,No,29 Sep 2026,-,,https://x.com/b,Incineroar,,,,,,MC1\n`;
test('VGCPastes index parsing finds columns by header and keeps quoting intact',()=>{
  assert.deepEqual(parseCSV('a,"b,""c"""\n')[0],['a','b,"c"']);const rows=parseIndex(csv);
  assert.equal(rows.length,2);assert.equal(rows[0].description,'Ace\'s "Rain" team');assert.equal(rows[0].hasSpreads,true);assert.equal(rows[1].hasSpreads,false);assert.equal(rows[1].event,'');assert.deepEqual(rows[0].pokemon.slice(0,2),['Golisopod-Mega','Pelipper']);
});
test('Only Champions-format stat points are read from shared pastes; IV and Tera lines are ignored',()=>{
  const ok=setsFromPaste('Incineroar @ Sitrus Berry\nAbility: Intimidate\nLevel: 50\nTera Type: Grass\nEVs: 32 HP / 2 Def / 32 SpD\nCareful Nature\nIVs: 0 Atk\n- Fake Out\n- Parting Shot\n- Flare Blitz\n- Protect\n');
  assert.equal(ok.length,1);assert.equal(ok[0].statPoints!.spd,32);
  assert.equal(setsFromPaste('Incineroar @ Sitrus Berry\nAbility: Intimidate\nEVs: 252 HP / 4 Def / 252 SpD\nCareful Nature\n- Fake Out\n').length,0);
});
