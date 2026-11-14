export {};
declare global { interface Window { h3x: {
  inspectQuery?:(query:string,type?:string)=>Promise<{query:string;type:string;label:string;field:string}>;
  cancelSearch:(runId:string)=>Promise<boolean>;
  deepSearch:(payload:{runId:string;plan:import('./peopleDeepModel').DeepPlan})=>Promise<import('./peopleDeepModel').DeepRun>;
  cancelDeepSearch:(runId:string)=>Promise<boolean>;
  onDeepProgress:(callback:(progress:import('./peopleDeepModel').DeepProgress)=>void)=>()=>void;
  usernameCatalog:(refresh?:boolean)=>Promise<import('./UsernameSearch').UsernameCatalog>;
  scanUsername:(payload:import('./UsernameSearch').UsernameOptions&{query:string;runId:string})=>Promise<import('./UsernameSearch').UsernameRun>;
  cancelUsernameScan:()=>Promise<boolean>;
  onUsernameProgress:(callback:(progress:import('./UsernameSearch').UsernameProgress)=>void)=>()=>void;
  geocode:(query:string,refresh?:boolean)=>Promise<{lat:number;lng:number;label:string}|null>;
  telegram:(action:'status'|'restore'|'begin'|'beginQr'|'verify'|'send'|'replies'|'logout',payload?:any)=>Promise<any>;
  stealerTree:(payload:{logId:string})=>Promise<any>;
  exportSearch:(payload:any)=>Promise<boolean>; openBotReplies:()=>Promise<boolean>;
  logs:()=>Promise<any[]>; exportLogs:()=>Promise<boolean>; prepareEvidence:(p:any)=>Promise<any>; importCase:(p:any)=>Promise<any>; openExports:()=>Promise<void>;
  load:()=>Promise<any>; save:(state:any)=>Promise<boolean>; credentials:()=>Promise<Record<string,boolean>>; setCredential:(name:string,value:string)=>Promise<boolean>;
  providerMatches:(query:string)=>Promise<string[]>; searchBatch:(p:any)=>Promise<any>; search:(p:any)=>Promise<any>; scanFile:(p:any)=>Promise<import('./FileSearcher').ScanResult|null>;
  cancelFileScan:()=>Promise<boolean>; onFileProgress:(callback:(progress:import('./FileSearcher').ScanProgress)=>void)=>()=>void;
  exportCase:(p:any)=>Promise<boolean>; openExternal:(url:string)=>Promise<boolean>;
  clipboard:(value:string)=>Promise<boolean>; checkTool:(p:any)=>Promise<boolean>; runGhunt:(p:any)=>Promise<string>;
  updateStatus:()=>Promise<any>; configureUpdates:(value:{repository:string;enabled:boolean})=>Promise<any>; checkUpdates:()=>Promise<any>; installUpdate:()=>Promise<boolean>;
}}}
