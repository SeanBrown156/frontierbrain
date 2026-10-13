import type {BankEntry,SetRevision,Slot,SetNotes,PokemonSet} from '../../shared/workbench.ts';
// Shared helpers for the team hub and Pokémon page: the six sets of a version's current (or a given) change.
export const stats=['hp','atk','def','spa','spd','spe'] as const;
export const statLabel:Record<string,string>={hp:'HP',atk:'Atk',def:'Def',spa:'SpA',spd:'SpD',spe:'Spe'};

export function getView(team:any,db:any,versionId:string,configId?:string){const version=team.versions.find((v:any)=>v.id===versionId)??team.versions.at(-1);const config=version.configurations.find((c:any)=>c.id===(configId??version.currentConfigurationId))??version.configurations.at(-1);return {version,config,slots:config.slots as Slot[],revisions:config.slots.map((s:Slot)=>{const entry=db.bank.find((b:BankEntry)=>b.id===s.bankId);return {entry,revision:entry?.revisions.find((r:SetRevision)=>r.id===s.revisionId)};}) as {entry:BankEntry;revision:SetRevision}[],sets:config.slots.map((s:Slot)=>db.bank.find((b:BankEntry)=>b.id===s.bankId)?.revisions.find((r:SetRevision)=>r.id===s.revisionId)?.set) as PokemonSet[]};}
export const versionName=(v:any)=>`V${v.number}${v.label?` · ${v.label}`:''}`;

// Which stat each nature raises (+10%) and lowers (−10%). Neutral natures are absent.
export const NATURES:Record<string,[string,string]>={Lonely:['atk','def'],Brave:['atk','spe'],Adamant:['atk','spa'],Naughty:['atk','spd'],Bold:['def','atk'],Relaxed:['def','spe'],Impish:['def','spa'],Lax:['def','spd'],Timid:['spe','atk'],Hasty:['spe','def'],Jolly:['spe','spa'],Naive:['spe','spd'],Modest:['spa','atk'],Mild:['spa','def'],Quiet:['spa','spe'],Rash:['spa','spd'],Calm:['spd','atk'],Gentle:['spd','def'],Sassy:['spd','spe'],Careful:['spd','spa']};
export const natureEffect=(nature:string|undefined,stat:string)=>{const n=NATURES[nature??''];return !n?0:n[0]===stat?1:n[1]===stat?-1:0;};
