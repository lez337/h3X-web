import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import worker from '../dist/server/index.js';
import {accountEnvironment,fixtureCookie,fixtureName} from './fixtures/account-session.mjs';
import {accountName} from '../worker/accounts.mjs';

const code=(await build({entryPoints:['src/web/storage.ts'],bundle:true,format:'esm',platform:'browser',write:false})).outputFiles[0].text;
let moduleId=0;
async function storage(){return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64')+'#'+moduleId++);}
const id=accountName(fixtureName).id;
async function setup(run){
  const original=globalThis.fetch;globalThis.window=new EventTarget();const env=accountEnvironment(),calls=[];
  const route=async(url,options)=>{calls.push({url,options});return worker.fetch(new Request('https://h3x.example'+url,{...options,headers:{...options.headers,Cookie:fixtureCookie}}),env)};
  globalThis.fetch=route;
  try{await run({env,calls,route})}finally{globalThis.fetch=original}
}
test('Browser account storage loads saved investigations and skips unchanged writes',()=>setup(async({calls})=>{
  const s=await storage();await s.openWorkspace(id);const state=await s.loadWorkspace();await s.saveWorkspace(state);
  assert.equal(calls.filter(c=>c.options.method==='POST').length,0);
  state.cases=[{id:'saved',title:'Account investigation',people:[]}];await s.saveWorkspace(state);s.closeWorkspace();
  await s.openWorkspace(id);assert.equal((await s.loadWorkspace()).cases[0].title,'Account investigation');assert.equal(s.syncStatus().status,'saved');
}));
test('Queued browser saves keep immutable snapshots, update revisions, and end with the latest state',()=>setup(async()=>{
  const s=await storage();await s.openWorkspace(id);const state=await s.loadWorkspace();state.cases=[{id:'one',title:'First',people:[]}];
  const first=s.saveWorkspace(state);state.cases[0].title='Second';const second=s.saveWorkspace(state);
  await first;assert.equal(s.syncStatus().status,'saving');await second;
  s.closeWorkspace();await s.openWorkspace(id);assert.equal((await s.loadWorkspace()).cases[0].title,'Second');
}));
test('Stale browser saves preserve unsaved changes for backup and do not overwrite the server',()=>setup(async()=>{
  const a=await storage(),b=await storage();await a.openWorkspace(id);await b.openWorkspace(id);
  const stateA=await a.loadWorkspace(),stateB=await b.loadWorkspace();stateA.cases=[{id:'latest',title:'Latest',people:[]}];stateB.cases=[{id:'unsaved',title:'Keep for backup',people:[]}];
  await a.saveWorkspace(stateA);await assert.rejects(()=>b.saveWorkspace(stateB),/another tab or device/);
  assert.equal(b.syncStatus().status,'error');assert.equal((await b.loadWorkspace()).cases[0].title,'Keep for backup');
  await a.openWorkspace(id);assert.equal((await a.loadWorkspace()).cases[0].title,'Latest');
}));
test('Network failures are visible, retain the draft in memory, and allow a retry',()=>setup(async({route})=>{
  const s=await storage();await s.openWorkspace(id);const state=await s.loadWorkspace();state.cases=[{id:'draft',title:'Draft',people:[]}];
  globalThis.fetch=async()=>{throw Error('Offline fixture')};await assert.rejects(()=>s.saveWorkspace(state),/Offline/);
  assert.equal(s.syncStatus().status,'error');assert.equal((await s.loadWorkspace()).cases[0].title,'Draft');
  globalThis.fetch=route;await s.saveWorkspace(state);assert.equal(s.syncStatus().status,'saved');
}));
test('Closing an account cancels queued writes and clears its investigation state',()=>setup(async({calls})=>{
  const s=await storage();await s.openWorkspace(id);const state=await s.loadWorkspace();state.cases=[{id:'closed',title:'Closed account',people:[]}];
  const pending=s.saveWorkspace(state);s.closeWorkspace();await assert.rejects(pending,/session has ended/);
  assert.equal(calls.filter(c=>c.options.method==='POST').length,0);await assert.rejects(()=>s.loadWorkspace(),/Sign in/);
}));
test('A failed initial account load never opens an empty replacement workspace',()=>setup(async()=>{
  const s=await storage();globalThis.fetch=async()=>Response.json({error:'Unavailable fixture'},{status:503});
  await assert.rejects(()=>s.openWorkspace(id),/Unavailable/);assert.equal(s.accountId(),undefined);await assert.rejects(()=>s.saveWorkspace({}),/Sign in/);
}));
