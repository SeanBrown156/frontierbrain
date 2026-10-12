// Where to look things up: the verified source catalogue (knowledge/sources), the dated research routes to current
// results and reports, and the articles the playbook draws on, grouped by what the player is asking. Assistants with
// browsing go straight to these pages instead of a generic web search; numbers still come from Frontier Brain's tools.
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {CODE} from './io.ts';

const read=(path:string)=>{const p=resolve(CODE,path);return existsSync(p)?readFileSync(p,'utf8'):'';};
const links=(text:string)=>[...text.matchAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g)].map(m=>({title:m[1],url:m[2]}));
const sections=(text:string)=>text.split(/\n(?=## )/).slice(1).map(p=>({title:p.split('\n')[0].replace(/^##\s*/,''),body:p}));

const TOPICS:Record<string,{about:string;categories:string[]}>={
  rules:{about:'Official rules, the regulation and what changed',categories:['rules','official']},
  results:{about:'Tournament results, placings and event team lists',categories:['results','events']},
  teams:{about:'Full teams and pastes to study or import',categories:['teams']},
  reports:{about:'Player-written team reports: why a team works, its game plan and matchups',categories:['reports']},
  usage:{about:'Usage and sets (cross-check only; Frontier Brain\'s team_pool_sets / meta_overview / standard_set are primary)',categories:['usage','sets']},
  speed:{about:'Speed tiers and outside calculators (cross-check only; calc_damage / calc_speed are primary)',categories:['speed','calculators']},
  fundamentals:{about:'Doubles fundamentals and teambuilding articles (classic Nugget Bridge, VGCGuide, Smogon)',categories:['strategy','teambuilding','iteration']},
  community:{about:'Discussion and change discovery; hypotheses, never verified facts',categories:['community']},
  mechanics:{about:'Mechanics references and engine sources',categories:['mechanics']},
  practice:{about:'Testing, replays and practice',categories:['testing','replays','practice']},
};
const role=(notes:string)=>/^(UPSTREAM|COMPOSITE|MIRROR)\b/.exec(notes)?.[1].toLowerCase()??null;

export const LIBRARY_GUIDE='For anything current or written (event results, team lists, team reports, regulation news, articles), go straight to the pages where_to_look lists (by topic) instead of a generic web search, and cite the page and its date. Frontier Brain\'s tools stay primary for numbers: usage, sets and spreads from the team pool, damage and speed from the calcs. Keep each source labelled (upstream, composite or mirror) and never blend them; don\'t mix ladder with tournaments, Bo1 with Bo3, or regulations.';

export function whereToLook(topic?:string){
  const catalogue:any[]=JSON.parse(read('knowledge/sources/catalogue.json')||'[]');
  const routesText=read('knowledge/sources/research-routes.md');const routes=sections(routesText);
  const verified=/verified on ([^\n]+)/i.exec(routesText)?.[1]??null;
  const articles=sections(read('knowledge/playbook/vgc-fundamentals.md')).map(s=>({section:s.title,articles:links(s.body)})).filter(s=>s.articles.length);
  const key=topic?.toLowerCase().trim();
  if(!key)return {guide:LIBRARY_GUIDE,topics:Object.entries(TOPICS).map(([k,v])=>({topic:k,about:v.about})),note:'Call again with a topic for its sites, current links and articles.'};
  const hit=Object.keys(TOPICS).find(k=>k===key||k.startsWith(key)||TOPICS[k].about.toLowerCase().includes(key));
  if(!hit)throw new Error(`No topic matching "${topic}". Topics: ${Object.keys(TOPICS).join(', ')}`);
  const t=TOPICS[hit];
  const sites=catalogue.filter(s=>s.categories?.some((c:string)=>t.categories.includes(c))).map(s=>({name:s.name,url:s.url,useFor:s.notes,...role(s.notes)?{role:role(s.notes)}:{}}));
  const routeFor:Record<string,string>={results:'tournament results',teams:'team sheets',reports:'authored reports'};
  const current=routeFor[hit]?routes.filter(r=>r.title.toLowerCase().includes(routeFor[hit])).flatMap(r=>r.body.split('\n').filter(l=>l.startsWith('- ')&&links(l).length).map(l=>({what:l.slice(2).replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/\*\*/g,''),links:links(l)}))):[];
  const caveats=routes.find(r=>/access gaps/i.test(r.title))?.body.replace(/^##.*\n+/,'').trim();
  return {topic:hit,about:t.about,guide:LIBRARY_GUIDE,sites,
    ...current.length?{currentLinks:{verified,items:current,note:'Dated starting points; newer events and reports may exist, so check the site\'s home page too.'}}:{},
    ...hit==='fundamentals'?{articles}:{},
    ...['results','teams','reports'].includes(hit)&&caveats?{accessNotes:caveats}:{}};
}
