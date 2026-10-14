// `npm run check:phone`: opens every page of a running app (npm run dev) at 360, 390 and 430px wide, in both themes,
// and fails if any page scrolls sideways. Team pages are checked for the first team in the workspace.
// Playwright is not a dependency: if it can't be imported, the script runs itself again through
// `npx -p playwright@1.56.1` (downloaded once into the npx cache) and installs its Chromium first.
// WEB_PORT picks the app (default 5173); WIDTHS="390" narrows the run; CHROME_PATH uses a browser you already have.
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const PLAYWRIGHT='playwright@1.56.1';
const port=Number(process.env.WEB_PORT??5173),base=`http://127.0.0.1:${port}`;
const widths=(process.env.WIDTHS??'360,390,430').split(',').map(Number);
// Under npx the package is on PATH (…/node_modules/.bin), not beside this script.
const fromPath=()=>{for(const dir of (process.env.PATH??'').split(':')){const pkg=join(dir,'..','playwright','index.mjs');if(dir.endsWith(join('node_modules','.bin'))&&existsSync(pkg))return pathToFileURL(pkg).href;}return null;};
let chromium;
try{({chromium}=await import('playwright'));}
catch{const viaPath=fromPath();
  if(viaPath)({chromium}=await import(viaPath));
  else if(process.env.FB_CHECK_PHONE_NPX){console.error(`Couldn't load ${PLAYWRIGHT} through npx.`);process.exit(2);}
  else{const self=fileURLToPath(import.meta.url);const install=process.env.CHROME_PATH?'':'playwright install chromium && ';
    const r=spawnSync('npx',['--yes','-p',PLAYWRIGHT,'-c',`${install}node "${self}"`],{stdio:'inherit',env:{...process.env,FB_CHECK_PHONE_NPX:'1'}});
    process.exit(r.status??1);}}
const routes=['teams','inbox','account','news','data','references','welcome','design-system'];
try{const r=await fetch(`${base}/api/dashboard`);const d=await r.json();const t=d.teams?.[0];
  if(t){const v=t.view?.version?.id??'all';routes.push(...['overview','strategy','bench','replays','history'].map(tab=>`team/${t.id}/${tab}/all`),`team/${t.id}/mon/${v}/0`);}}
catch{console.error(`Can't reach the app at ${base}. Start it with npm run dev (or set WEB_PORT).`);process.exit(2);}
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});let failures=0;
for(const theme of ['dark','light'])for(const width of widths){
  const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce',isMobile:true,hasTouch:true});
  await ctx.addInitScript(t=>{try{localStorage.setItem('frontierbrain.theme',t);localStorage.setItem('frontierbrain.welcomed','1');sessionStorage.setItem('frontierbrain.booted','1');}catch{}},theme);
  const page=await ctx.newPage();
  for(const route of routes){
    await page.goto(`${base}/#${route}`);await page.waitForLoadState('networkidle').catch(()=>{});await page.waitForTimeout(800);
    const r=await page.evaluate(()=>{const W=document.documentElement.clientWidth;const wide=[];
      for(const el of document.querySelectorAll('body *')){const b=el.getBoundingClientRect();if(!b.width||b.right<=W+1||getComputedStyle(el).position==='fixed')continue;
        let p=el.parentElement,clipped=false;while(p&&p!==document.body){if(getComputedStyle(p).overflowX!=='visible'&&p.getBoundingClientRect().right<=W+1){clipped=true;break;}p=p.parentElement;}
        if(!clipped)wide.push(`${el.tagName.toLowerCase()}${typeof el.className==='string'&&el.className?'.'+el.className.trim().split(/\s+/).join('.'):''} (right edge ${Math.round(b.right)}px)`);}
      return {scroll:document.documentElement.scrollWidth,W,wide:wide.slice(0,3)};});
    if(r.scroll>r.W){failures++;console.log(`✗ ${width}px ${theme} #${route}: page is ${r.scroll}px wide; ${r.wide.join(', ')}`);}
  }
  await ctx.close();
}
await browser.close();
console.log(failures?`${failures} page(s) scroll sideways.`:`No sideways scroll on ${routes.length} pages at ${widths.join(', ')}px in both themes.`);
process.exit(failures?1:0);
