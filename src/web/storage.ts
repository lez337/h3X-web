import {blank,validateState} from './state.mjs';
let database:Promise<IDBDatabase>|undefined;
function open(){return database??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('h3x-v2-web',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('workspace');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export async function read(key:string){const db=await open();return new Promise<any>((resolve,reject)=>{
  const request=db.transaction('workspace').objectStore('workspace').get(key);
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});}
export async function write(key:string,value:any){const db=await open();return new Promise<void>((resolve,reject)=>{
  const transaction=db.transaction('workspace','readwrite');transaction.objectStore('workspace').put(value,key);
  transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('Workspace write aborted.'));
});}
export const loadWorkspace=async()=>validateState(await read('state')??blank());
export async function saveWorkspace(state:any){await write('state',validateState(state));return true;}
let pendingLog=Promise.resolve();
export function log(action:string,detail='',level='info'){
  pendingLog=pendingLog.catch(()=>{}).then(async()=>{const entries=await read('logs')||[];
    await write('logs',[...entries,{id:crypto.randomUUID(),time:new Date().toISOString(),event:action,detail,scope:'web',level}].slice(-500));
  });return pendingLog;
}
