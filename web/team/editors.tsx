import type {BankEntry,SetRevision,Slot,SetNotes,PokemonSet} from '../../shared/workbench.ts';
// Shared helpers for the team hub and Pokémon page: the six sets of a version's current (or a given) change.
export const stats=['hp','atk','def','spa','spd','spe'] as const;
export const statLabel:Record<string,string>={hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'};
export const noteTitles:Record<keyof SetNotes,string>={role:'Role & game plan',benchmarks:'Damage & speed benchmarks',partners:'Partners & positioning',matchups:'Matchups & testing goals'};
export function getView(team:any,db:any,versionId:string,configId?:string){const version=team.versions.find((v:any)=>v.id===versionId)??team.versions.at(-1);const config=version.configurations.find((c:any)=>c.id===(configId??version.currentConfigurationId))??version.configurations.at(-1);return {version,config,slots:config.slots as Slot[],revisions:config.slots.map((s:Slot)=>{const entry=db.bank.find((b:BankEntry)=>b.id===s.bankId);return {entry,revision:entry?.revisions.find((r:SetRevision)=>r.id===s.revisionId)};}) as {entry:BankEntry;revision:SetRevision}[],sets:config.slots.map((s:Slot)=>db.bank.find((b:BankEntry)=>b.id===s.bankId)?.revisions.find((r:SetRevision)=>r.id===s.revisionId)?.set) as PokemonSet[]};}
export const versionName=(v:any)=>`V${v.number}${v.label?` · ${v.label}`:''}`;
