// Doubles fundamentals for assistants (knowledge/playbook): the short primer rides along in every prompt; the full
// playbook is looked up by section. Paraphrased strategy guidance with sources, never rules or numbers.
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {CODE} from './io.ts';

const read=(file:string)=>{const path=resolve(CODE,'knowledge/playbook',file);return existsSync(path)?readFileSync(path,'utf8'):'';};
export const playbookPrimer=()=>read('primer.md').replace(/^#.*\n+/,'').trim();
export function playbook(section?:string){
  const text=read('vgc-fundamentals.md');const parts=text.split(/\n(?=## )/);const sections=parts.slice(1).map(p=>p.split('\n')[0].replace(/^##\s*/,''));
  if(!section)return {sections,note:'Ask for a section by number or a word from its title.',intro:parts[0].trim()};
  const q=section.toLowerCase();const hit=parts.slice(1).find(p=>{const title=p.split('\n')[0].toLowerCase();return title.startsWith(`## ${q}.`)||title.includes(q);});
  if(!hit)throw new Error(`No playbook section matching "${section}". Sections: ${sections.join(' | ')}`);
  return {section:hit.split('\n')[0].replace(/^##\s*/,''),text:hit.trim()};
}
