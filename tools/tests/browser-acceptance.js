// Run with the Playwright MCP/CLI against `npm run dev` plus tools/tests/browser-fixture.ts (port 5184).
// Every API call is rerouted to the isolated fixture copy, so the player's teams are never written. No model is launched.
async page => {
  const check=(condition,message)=>{if(!condition)throw new Error(message);};
  const fixture='http://127.0.0.1:5184';
  await page.context().route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:fixture+url.pathname+url.search});await route.fulfill({response});});
  await page.addInitScript(()=>{window.confirm=()=>true;});
  await page.setViewportSize({width:1440,height:1000});
  const db=await page.request.get(fixture+'/api/dashboard').then(r=>r.json());const team=db.teams[0];check(team,'Fixture has no team');
  const activeBefore=team.activeVersionId;const version=team.versions.find(v=>v.id===activeBefore);
  // One sans family everywhere (the pixel display font was retired 2026-10-09).
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/overview/all`);await page.evaluate(()=>{localStorage.setItem('pokecoach.dock','closed');});await page.reload();
  await page.getByRole('heading',{name:team.name}).waitFor();
  check(await page.evaluate(()=>getComputedStyle(document.body).fontFamily.includes('IBM Plex Sans')),'Body font is not Plex');
  check(await page.evaluate(()=>getComputedStyle(document.querySelector('h1')).fontFamily.includes('IBM Plex Sans')),'Headings are not Plex');
  check(await page.evaluate(()=>[...document.querySelectorAll('button')].every(b=>!getComputedStyle(b).fontFamily.includes('DotGothic'))),'A button still uses the pixel font');
  check(await page.getByPlaceholder('Swap Pokémon…').count()===0,'Old swap inputs are still on the cards');
  check(await page.getByText('All changes saved').count()===1,'Save pill missing');
  // Pokémon page: typing in the species box never changes the set; choosing does (as a draft).
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/mon/${version.id}/2`);const species=page.getByRole('combobox',{name:'Species'});await species.waitFor();
  const before=await species.inputValue();await species.click();await species.pressSequentially('Indee');
  check(await page.getByText('All changes saved').count()===1,'Typing alone made the set dirty');
  const option=page.getByRole('option',{name:/^Indeedee-F\b.*of teams/});
  check(await option.locator('.poke-icon').evaluate(e=>getComputedStyle(e).backgroundImage.includes('/api/icon-sheet')&&e.style.backgroundPosition!==''),'Species options have no box icon');await option.click();
  await page.getByText(/^Unsaved:/).waitFor();check(await species.inputValue()==='Indeedee-F','Picked species not in the card');
  await page.getByRole('region',{name:'Unsaved changes'}).getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText(/^Saved \d/).waitFor();
  let now=await page.request.get(fixture+'/api/dashboard').then(r=>r.json());let t=now.teams.find(x=>x.id===team.id);
  check(t.activeVersionId===activeBefore,'A slot save changed the active version');check(t.view.sets[2].species==='Indeedee-F','Swap did not save');
  // My sets: star the current set, then it's offered under its species in the picker.
  await page.getByRole('button',{name:'☆ Save to My sets'}).click();await page.getByLabel('Name for My sets').fill('Acceptance preset');await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByText('In My sets as “Acceptance preset”').waitFor();
  await species.click();await page.getByRole('option',{name:/★ Acceptance preset/}).waitFor();await species.press('Escape');
  // Versions are milestones: "Save as new version" in the version picker makes V2 the current team; V1 stays, read-only.
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/overview/all`);await page.getByLabel('Version').selectOption('new');await page.getByLabel('Version name').fill('Acceptance');await page.getByRole('button',{name:'Save V2'}).click();
  await page.waitForURL(/overview\/formula-/);now=await page.request.get(fixture+'/api/dashboard').then(r=>r.json());t=now.teams.find(x=>x.id===team.id);
  check(t.versions.length===team.versions.length+1,'No V2');check(t.activeVersionId!==activeBefore,'V2 is not current');
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/overview/${activeBefore}`);await page.getByText(/an older version \(read-only\)/).waitFor();
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/mon/${t.activeVersionId}/2`);await species.waitFor();
  // Leaving with unsaved changes asks first (accepted here by the dialog handler).
  await page.getByLabel('Nickname').fill('Draft');await page.getByText(/^Unsaved:/).waitFor();
  // Versions list the change by name.
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/history/all`);await page.getByText(/Edit log/).first().click();await page.getByText('Swapped Farigiraf → Indeedee-F').first().waitFor();
  // Replays: one page, no sub-tabs; digest, add bar and filters.
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/replays/all`);await page.getByRole('heading',{name:'What to work on'}).waitFor();
  check(await page.getByRole('button',{name:'Game Stats'}).count()===0&&await page.getByRole('button',{name:'Help'}).count()===0,'Old replay sub-tabs remain');
  check(await page.getByLabel('Showdown replay links').count()===1,'Single add-replays box missing');
  // The overview is just the six (one row); the Strategy tab holds the game plan, leads and matchups.
  now=await page.request.get(fixture+'/api/dashboard').then(r=>r.json());t=now.teams.find(x=>x.id===team.id);
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/overview/${t.activeVersionId}`);await page.locator('.mon-card').first().waitFor();
  check(await page.locator('.strategy-block').count()===0,'Strategy is still on the overview');
  check(await page.evaluate(()=>new Set([...document.querySelectorAll('.mon-card')].map(c=>Math.round(c.getBoundingClientRect().top))).size===1),'The six are not in one row');
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/strategy/${t.activeVersionId}`);check(await page.getByText('Practice').count()===0,'Testing section still shown');await page.locator('.strategy-block').getByRole('button',{name:'Edit'}).click();
  await page.getByLabel('Strategy').fill('## Plan\n\n| Lead | When |\n|---|---|\n| A + B | default |');await page.getByText(/^Unsaved:/).waitFor();
  await page.locator('.strategy-block').getByRole('button',{name:'Save',exact:true}).click();await page.locator('.strategy-block table').waitFor();
  // Dock: opens with "/", knows the page, and renders markdown tables.
  await page.goto(`http://127.0.0.1:5173/#team/${team.id}/strategy/all`);await page.locator('body').press('/');
  await page.getByText('Looking at: Strategy').waitFor();
  await page.evaluate(id=>localStorage.setItem(`pokecoach.assist.team-${id}`,JSON.stringify([{role:'user',content:'q',page:'Strategy'},{role:'assistant',content:'Answer.\n\n| Mon | Spe |\n|---|---|\n| A | 1 |',model:'gpt-6-sol',seconds:9}])),team.id);
  await page.reload();await page.locator('.dock table').waitFor();await page.getByText('gpt-6-sol · 9 s').waitFor();
  return 'Frontier Brain UX acceptance passed';
}
