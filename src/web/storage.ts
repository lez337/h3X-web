import {blank,validateState} from './state.mjs';
let database:Promise<IDBDatabase>|undefined;
function open(){return database??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('h3x-v2-web',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function localRead(key:string){const db=await open();return new Promise<any>((resolve,reject)=>{
  const request=db.transaction('workspace').objectStore('workspace').get(key);
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
async function localWrite(key:string,value:any){const db=await open();return new Promise<void>((resolve,reject)=>{
  const transaction=db.transaction('workspace','readwrite');transaction.objectStore('workspace').put(value,key);
  transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('Workspace write aborted.'));
});}
type AccountWorkspace={id:string;revision:number;state:any;saved:string;pending:number;generation:number;dirty:boolean;queue:Promise<unknown>;closed:boolean};
let active:AccountWorkspace|undefined;
export type SyncStatus={status:'saved'|'saving'|'error';message:string};
let sync:SyncStatus={status:'saved',message:'Saved to account'};
const emitSync=(value:SyncStatus)=>{sync=value;window.dispatchEvent(new CustomEvent('h3x-sync-status',{detail:value}));};
export const syncStatus=()=>sync;
export const accountId=()=>active?.id;
export function closeWorkspace(){if(active)active.closed=true;active=undefined;}
async function remote(session:AccountWorkspace,body?:any){
  if(session.closed)throw Error('This account session has ended.');
  const response=await fetch('/api/workspace',{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-H3X-Account':session.id},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();
  if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('h3x-auth-required'));throw Error(value.error||'Account save failed.');}
  if(session.closed)throw Error('This account session has ended.');
  return value;
}
export async function openWorkspace(id:string){
  closeWorkspace();
  const session:AccountWorkspace={id,revision:0,state:blank(),saved:'',pending:0,generation:0,dirty:false,queue:Promise.resolve(),closed:false};active=session;
  try{const value=await remote(session);session.state=validateState(value.state);session.saved=JSON.stringify(session.state);session.revision=value.revision;emitSync({status:'saved',message:'Saved to account'});}
  catch(error){if(active===session)closeWorkspace();throw error;}
}
export async function read(key:string){return localRead(active?active.id+':'+key:key);}
export async function write(key:string,value:any){return localWrite(active?active.id+':'+key:key,value);}
export const legacyWorkspace=async()=>{const state=await localRead('state');return state?validateState(state):null;};
export const loadWorkspace=async()=>{if(!active)throw Error('Sign in to load your investigations.');return structuredClone(active.state);};
// Track edits before the debounced save, so a background read cannot replace them.
export function stageWorkspace(state:any){
  if(!active||active.closed)return;
  active.state=structuredClone(state);active.generation++;
  active.dirty=JSON.stringify(state)!==active.saved;
  if(active.dirty)emitSync({status:'saving',message:'Saving to account.'});
}
export async function refreshWorkspace(){
  const session=active;
  if(!session||session.closed||session.pending||session.dirty||sync.status==='error')return false;
  const generation=session.generation,value=await remote(session);
  if(active!==session||session.pending||session.dirty||session.generation!==generation)return false;
  if(value.revision===session.revision)return false;
  session.state=validateState(value.state);session.saved=JSON.stringify(session.state);session.revision=value.revision;
  window.dispatchEvent(new CustomEvent('h3x-workspace-refreshed',{detail:structuredClone(session.state)}));
  emitSync({status:'saved',message:'Synced from another device'});return true;
}
export async function saveWorkspace(state:any){
  const session=active;if(!session||session.closed)throw Error('Sign in to save your investigations.');
  const next=structuredClone(validateState(state)),serialized=JSON.stringify(next);session.state=next;session.pending++;session.generation++;
  emitSync({status:'saving',message:'Saving to account…'});
  const task=session.queue.catch(()=>{}).then(async()=>{
    try{
      if(session.closed)throw Error('This account session has ended.');
      if(serialized!==session.saved){const result=await remote(session,{state:next,revision:session.revision});session.revision=result.revision;session.saved=serialized;}
      session.dirty=JSON.stringify(session.state)!==session.saved;
      if(active===session&&session.pending===1&&!session.dirty)emitSync({status:'saved',message:'Saved to account'});
      return true;
    }catch(error){if(active===session)emitSync({status:'error',message:(error as Error).message});throw error;}finally{session.pending--;}
  });session.queue=task;return task;
}
let pendingLog=Promise.resolve();
export function log(action:string,detail='',level='info'){
  const key=active?.id+':logs';
  pendingLog=pendingLog.catch(()=>{}).then(async()=>{if(!active||key!==active.id+':logs')return;const entries=await localRead(key)||[];
    await localWrite(key,[...entries,{id:crypto.randomUUID(),time:new Date().toISOString(),event:action,detail,scope:'web',level}].slice(-500));
  });return pendingLog;
}
