export interface PokemonSet {species:string;nickname?:string;nature?:string;statPoints?:Partial<Record<'hp'|'atk'|'def'|'spa'|'spd'|'spe',number>>;ability?:string;item?:string;moves?:string[];gender?:string;}
export interface SetNotes {role:string;benchmarks:string;partners:string;matchups:string;}
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
export interface LeadPlan {id:string;lead:string[];back:string[];when:string;plan:string;calcIds:string[];versionIds:string[];status:'active'|'proposed';}
export interface MatchupPlan {id:string;opponent:string;threat:'low'|'medium'|'high';bring:string[];leadId?:string;plan:string;calcIds:string[];versionIds:string[];status:'active'|'proposed';}
export interface Objective {id:string;kind:'test'|'todo';text:string;done:boolean;}
// Why the team exists, agreed with the player while building it (with an assistant or by hand).
export interface TeamBrief {goal:string;core:string[];gamePlan:string;ruledOut:string;updatedAt:string;}
export interface TeamCoaching {teamId:string;version:number;updatedAt:string;leads:LeadPlan[];matchups:MatchupPlan[];objectives:Objective[];brief?:TeamBrief;}
export interface Workbench {schemaVersion:1;revision:number;bank:BankEntry[];teams:Formula[];associations:Record<string,ReplayAssociation>;matches:MatchRecord[];benchmarks?:Benchmark[];coaching?:Record<string,TeamCoaching>;}
export interface Article {id:string;title:string;url:string;source:string;publishedAt:string;category:'tournament'|'report'|'official'|'community';format:string;summary:string;}
// News describes the week's metagame only. It never refers to the player's teams, replays or workspace data.
export interface NewsSignal {kind:'measured'|'report'|'community';title:string;summary:string;whyItMatters?:string;articleIds:string[];}
export interface NewsWeek {start:string;end:string;partial:boolean;digest:string[];articles:Article[];coverage:string[];researchedAt:string;signals?:NewsSignal[];}
