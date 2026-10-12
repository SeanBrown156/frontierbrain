// Types for wire-brain.js: the procedural wireframe brain behind every page (built in the brain lab).
export type WireBrainMode='lattice'|'storm'|'scan'|'constellation'|'facet';
export interface WireBrainOptions {mode?:WireBrainMode;dark?:boolean;intensity?:number;spin?:number;density?:number|null;still?:boolean;offsetX?:number;maxPixelRatio?:number;angle?:number}
export interface WireBrain {click(x:number,y:number):void;pointer(x:number,y:number):void;setTheme(dark:boolean):void;setOptions(o:Partial<WireBrainOptions>):void;stats():{fps:number;nodes:number;edges:number;pulses:number;running:boolean;reducedMotion:boolean};dispose():void}
export const MODES:Record<WireBrainMode,unknown>;
export function createWireBrain(canvas:HTMLCanvasElement,options?:WireBrainOptions):WireBrain;
