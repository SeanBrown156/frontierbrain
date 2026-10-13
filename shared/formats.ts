// Formats a team can be built for. The id is the Showdown format id; legality checks use it.
export const FORMATS=[
  {id:'gen9championsvgc2026regmc',label:'Champions VGC · Reg M-C'},
] as const;
export const formatLabel=(id:string)=>FORMATS.find(f=>f.id===id)?.label??id;
