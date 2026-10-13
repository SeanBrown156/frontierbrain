export interface PokemonSet {species:string;nickname?:string;nature?:string;statPoints?:Partial<Record<'hp'|'atk'|'def'|'spa'|'spd'|'spe',number>>;ability?:string;item?:string;moves?:string[];gender?:string;}
// A Pokémon's strategy is one Markdown write-up (`role`); `benchmarks` holds the reasons recorded when a set is changed.
// Older records also had `partners` and `matchups`; those are folded into the write-up when a record is saved.
export interface SetNotes {role:string;benchmarks:string;}
export const NOTE_TITLES={benchmarks:'Damage & speed benchmarks',partners:'Partners & positioning',matchups:'Matchups & testing goals'} as const;
// The text shown as a Pokémon's Strategy: the write-up, then any recorded benchmark reasons (and, for older records, the
// retired partner and matchup notes) under their headings.
export const setStrategyText=(n?:Partial<Record<'role'|'benchmarks'|'partners'|'matchups',string>>|null):string=>
  [n?.role,...(['benchmarks','partners','matchups'] as const).filter(k=>n?.[k]?.trim()).map(k=>`## ${NOTE_TITLES[k]}\n${n![k]!.trim()}`)].filter(t=>t?.trim()).join('\n\n');
export type FieldCertainty='known'|'inferred'|'unknown';
export interface SetRevision {id:string;number:number;createdAt:string;set:PokemonSet;notes:SetNotes;provenance?:'paste'|'observed'|'manual';knownMoves?:string[];fields?:Partial<Record<'moves'|'item'|'ability'|'nature'|'statPoints',FieldCertainty>>;basis?:string;starred?:{label:string;at:string};}
export interface BankEntry {id:string;name:string;revisions:SetRevision[];}
export interface Slot {bankId:string;revisionId:string;}
export interface Configuration {id:string;createdAt:string;slots:Slot[];summary?:string;}
export interface FormulaVersion {id:string;number:number;createdAt:string;notes:string;configurations:Configuration[];currentConfigurationId:string;label?:string;source?:'paste'|'observed';}
export interface Formula {id:string;name:string;format:string;activeVersionId:string;versions:FormulaVersion[];}
// basis 'auto': linked by tools/replay-link.ts (consistent with the game, never proof of spreads); 'player': confirmed by the player.
export interface ReplayAssociation {teamId:string;versionId?:string;configurationId?:string;certainty:'family'|'exact';basis?:'auto'|'player';note?:string;}
export interface MatchRecord {id:string;replayIds:string[];notes:string;}
export interface Benchmark {id:string;bankId:string;revisionId:string;createdAt:string;title:string;kind:'damage'|'speed'|'spread';input:any;result:any;context:string;sources:string[];side?:'attacker'|'defender'|'a';}
export interface ReviewScope {teamId?:string;versionId?:string;configurationId?:string;replayIds:string[];}
export interface CoachingFinding {category:'play'|'building'|'variance';title:string;detail:string;confidence:'high'|'medium'|'low';evidence:{replayId:string;turn:number;line:number}[];practiceGoal:string;experiment?:string;}
export interface CoachingReview {id:string;createdAt:string;scope:ReviewScope;associationFingerprint:string;status:'complete'|'partial';findings:CoachingFinding[];limitations:string[];report:string;}
export const LEAD_ROLES=['core','situational','niche','avoid'] as const;export type LeadRole=typeof LEAD_ROLES[number];
export interface LeadPlan {id:string;title?:string;lead:string[];back:string[];role?:LeadRole;when:string;plan:string;calcIds:string[];versionIds:string[];status:'active'|'proposed';}
// Team styles shared by matchup plans and replay summaries, so a plan and the games it covers use the same words.
export const TEAM_STYLES=['Trick Room','Tailwind','Rain','Sun','Sand','Snow','Psychic Terrain','Grassy Terrain','Electric Terrain','Perish Song','Hyper offense','Balance','Redirection','Setup'] as const;
export interface MatchupPlan {id:string;opponent:string;archetype?:string;examples?:string[];threat:'low'|'medium'|'high';bring:string[];leadId?:string;plan:string;calcIds:string[];versionIds:string[];status:'active'|'proposed';}
export interface Objective {id:string;kind:'test'|'todo';text:string;done:boolean;}
// Why the team exists, agreed with the player while building it (with an assistant or by hand).
export interface TeamCoaching {teamId:string;version:number;updatedAt:string;leads:LeadPlan[];matchups:MatchupPlan[];objectives:Objective[];}
export interface Workbench {schemaVersion:1;revision:number;bank:BankEntry[];teams:Formula[];associations:Record<string,ReplayAssociation>;matches:MatchRecord[];benchmarks?:Benchmark[];coaching?:Record<string,TeamCoaching>;pending?:PendingProposal[];}
// A change an assistant connected over MCP suggests for the player to accept or reject in the app (the same tiles as the
// in-app chat). `proposal` has the in-app proposal shape: {kind:'set'|'team'|'strategy', ...}.
export interface PendingProposal {id:string;teamId:string;createdAt:string;source:'mcp';summary:string;proposal:{kind:'set'|'team'|'strategy';[k:string]:any};}
export interface Article {id:string;title:string;url:string;source:string;publishedAt:string;category:'tournament'|'report'|'official'|'community';format:string;summary:string;}
// News describes the week's metagame only. It never refers to the player's teams, replays or workspace data.
export interface NewsSignal {kind:'measured'|'report'|'community';title:string;summary:string;whyItMatters?:string;articleIds:string[];}
export interface NewsWeek {start:string;end:string;partial:boolean;digest:string[];articles:Article[];coverage:string[];researchedAt:string;signals?:NewsSignal[];}
