import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {generateAccountKey,accountName} from '../worker/accounts.mjs';
import {accountEnvironment,fixtureCookie,fixtureName,fixtureKey} from './fixtures/account-session.mjs';
import {blank} from '../src/web/state.mjs';

async function call(env,path,{body,cookie,method=body===undefined?'GET':'POST',ip='192.0.2.1',headers={}}={}){
  return worker.fetch(new Request('https://h3x.example'+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':ip,...cookie?{Cookie:cookie}:{},...headers},...body===undefined?{}:{body:JSON.stringify(body)}}),env);
}
async function create(env,name='Investigator'){
  const response=await call(env,'/api/accounts',{body:{name}});assert.equal(response.status,201);return response.json();
}
async function login(env,account,ip){
  const response=await call(env,'/api/login',{body:{name:account.account.name,key:account.key},ip});assert.equal(response.status,200);
  const value=await response.json();assert.equal(value.key,undefined);return response.headers.get('set-cookie').split(';')[0];
}
test('Account keys contain exactly eight digits and preserve leading zeros',()=>{
  assert.equal(generateAccountKey(()=>7),'00000007');assert.equal(generateAccountKey(()=>0),'00000000');assert.equal(generateAccountKey(()=>99999999),'99999999');
  for(let i=0;i<20;i++)assert.match(generateAccountKey(),/^\d{8}$/);
});
test('Creation reserves a case-insensitive name, returns a key once, and stores only its hash',async()=>{
  const env=accountEnvironment(),created=await create(env,'CaseWorker');
  assert.match(created.key,/^\d{8}$/);assert.equal(created.account.name,'CaseWorker');
  const meta=await env.H3X_ACCOUNTS.context(created.account.id).storage.get('account');
  assert.equal(meta.key,undefined);assert.match(meta.keyHash,/^[a-f0-9]{64}$/);assert.notEqual(meta.keyHash,created.key);assert.ok(meta.salt);
  assert.equal((await call(env,'/api/accounts',{body:{name:'caseworker'}})).status,409);
  assert.equal((await call(env,'/api/session')).status,200);
  assert.equal((await (await call(env,'/api/session')).json()).authenticated,false);
  const cookie=await login(env,{...created,account:{...created.account,name:'caseworker'}});
  const session=await (await call(env,'/api/session',{cookie})).json();assert.equal(session.account.name,'CaseWorker');assert.equal(session.key,undefined);
});
test('Names and keys are validated on the server',async()=>{
  const env=accountEnvironment();
  for(const name of ['',null,'ab','x'.repeat(33),'has space','<script>'])assert.equal((await call(env,'/api/accounts',{body:{name}})).status,400);
  for(const key of [12345678,'1234567','123456789','abcdefgh',null])assert.equal((await call(env,'/api/login',{body:{name:'Investigator',key}})).status,400);
  assert.equal(accountName('  Investigator ').id,accountName('investigator').id);
});

test('Rotating a login key requires the current key, revokes other sessions and preserves the workspace',async()=>{
  const env=accountEnvironment(),created=await create(env),cookie=await login(env,created),other=await login(env,created),state=blank();
  state.cases=[{id:'keep',title:'Keep this investigation',people:[]}];
  assert.equal((await call(env,'/api/workspace',{cookie,body:{state,revision:0}})).status,200);
  assert.equal((await call(env,'/api/account/key',{body:{currentKey:created.key}})).status,401);
  const wrong=created.key==='00000000'?'11111111':'00000000';
  assert.equal((await call(env,'/api/account/key',{cookie,body:{currentKey:wrong}})).status,400);
  assert.equal((await call(env,'/api/account/key',{cookie,body:{currentKey:12345678}})).status,400);
  assert.equal((await call(env,'/api/account/key',{cookie,method:'GET'})).status,405);
  assert.equal((await call(env,'/api/account/key',{cookie,body:{currentKey:created.key},headers:{'X-H3X-Account':'different'}})).status,401);
  const rotated=await call(env,'/api/account/key',{cookie,body:{currentKey:created.key}});assert.equal(rotated.status,200);
  const {key}=await rotated.json();assert.match(key,/^\d{8}$/);assert.notEqual(key,created.key);
  assert.equal((await call(env,'/api/workspace',{cookie:other})).status,401);
  assert.deepEqual((await (await call(env,'/api/workspace',{cookie})).json()).state.cases,state.cases);
  assert.equal((await call(env,'/api/login',{body:{name:created.account.name,key:created.key}})).status,401);
  const next=await login(env,{...created,key});
  assert.deepEqual((await (await call(env,'/api/workspace',{cookie:next})).json()).state.cases,state.cases);
  const meta=await env.H3X_ACCOUNTS.context(created.account.id).storage.get('account');assert.equal(meta.key,undefined);
});

test('Incorrect current codes are rate limited before key rotation',async()=>{
  const env=accountEnvironment();
  for(let i=0;i<5;i++)assert.equal((await call(env,'/api/account/key',{cookie:fixtureCookie,body:{currentKey:'00000000'}})).status,400);
  assert.equal((await call(env,'/api/account/key',{cookie:fixtureCookie,body:{currentKey:fixtureKey}})).status,429);
});
test('Investigations persist across login sessions, Worker requests, and logout',async()=>{
  const env=accountEnvironment(),created=await create(env),cookie=await login(env,created),state=blank();
  state.cases=[{id:'synthetic',title:'Saved investigation',people:[]}];
  const saved=await call(env,'/api/workspace',{cookie,body:{state,revision:0}});assert.equal(saved.status,200);assert.equal((await saved.json()).revision,1);
  assert.equal((await call(env,'/api/logout',{cookie,body:{}})).status,200);
  assert.equal((await call(env,'/api/workspace',{cookie})).status,401);
  const nextCookie=await login(env,created,'192.0.2.2');
  const loaded=await (await call(env,'/api/workspace',{cookie:nextCookie})).json();assert.deepEqual(loaded.state.cases,state.cases);assert.equal(loaded.revision,1);
});
test('Other accounts cannot read or replace investigations, including stale tabs',async()=>{
  const env=accountEnvironment(),a=await create(env,'AccountOne'),b=await create(env,'AccountTwo'),cookieA=await login(env,a),cookieB=await login(env,b),state=blank();
  state.cases=[{id:'secret',title:'Only account one',people:[]}];
  assert.equal((await call(env,'/api/workspace',{cookie:cookieA,body:{state,revision:0}})).status,200);
  assert.deepEqual((await (await call(env,'/api/workspace',{cookie:cookieB})).json()).state.cases,[]);
  for(const body of [undefined,{state,revision:0}])assert.equal((await call(env,'/api/workspace',{cookie:cookieB,body,headers:{'X-H3X-Account':a.account.id}})).status,401);
  assert.equal((await call(env,'/api/logout',{cookie:cookieB,body:{},headers:{'X-H3X-Account':a.account.id}})).status,401);
  assert.equal((await (await call(env,'/api/session',{cookie:cookieB})).json()).authenticated,true);
});
test('A stale device revision cannot overwrite newer investigations',async()=>{
  const env=accountEnvironment(),state=blank();state.cases=[{id:'one',title:'Latest',people:[]}];
  assert.equal((await call(env,'/api/workspace',{cookie:fixtureCookie,body:{state,revision:0}})).status,200);
  assert.equal((await call(env,'/api/workspace',{cookie:fixtureCookie,body:{state:blank(),revision:0}})).status,409);
  assert.equal((await (await call(env,'/api/workspace',{cookie:fixtureCookie})).json()).state.cases[0].title,'Latest');
});
test('Large Unicode account workspaces are chunked and validated',async()=>{
  const env=accountEnvironment(),state=blank();state.cases=[{id:'unicode',title:'Synthetic',notes:'é 漢字 '.repeat(30000),people:[]}];
  assert.equal((await call(env,'/api/workspace',{cookie:fixtureCookie,body:{state,revision:0}})).status,200);
  const stored=await env.H3X_ACCOUNTS.context(accountName(fixtureName).id).storage.get('workspace');assert.ok(stored.chunks>1);
  assert.deepEqual((await (await call(env,'/api/workspace',{cookie:fixtureCookie})).json()).state.cases,state.cases);
  assert.equal((await call(env,'/api/workspace',{cookie:fixtureCookie,body:{state:{},revision:1}})).status,400);
  state.settings.notes='x'.repeat(8*1024*1024);
  assert.equal((await call(env,'/api/workspace',{cookie:fixtureCookie,body:{state,revision:1}})).status,400);
});
test('Five wrong keys lock an account across IP addresses, then allow login after expiry',async()=>{
  const env=accountEnvironment();
  for(let i=0;i<5;i++)assert.equal((await call(env,'/api/login',{body:{name:fixtureName,key:'00000000'},ip:'192.0.2.'+(i+1)})).status,401);
  const locked=await call(env,'/api/login',{body:{name:fixtureName,key:fixtureKey},ip:'192.0.2.80'});assert.equal(locked.status,429);assert.ok(locked.headers.get('retry-after'));
  const storage=env.H3X_ACCOUNTS.context(accountName(fixtureName).id).storage;await storage.put('attempts',{failed:5,lockedUntil:Date.now()-1});
  assert.equal((await call(env,'/api/login',{body:{name:fixtureName,key:fixtureKey},ip:'192.0.2.81'})).status,200);
});
test('Workspaces near 8 MB respect Durable Object multi-key and value-size limits',async()=>{
  const env=accountEnvironment(),state=blank();state.cases=[{id:'large',title:'Large fixture',notes:'x'.repeat(8*1024*1024-4096),people:[]}];
  const storage=env.H3X_ACCOUNTS.context(accountName(fixtureName).id).storage,put=storage.put,remove=storage.delete;
  storage.put=async(key,value)=>{
    if(typeof key==='object'){assert.ok(Object.keys(key).length<=128);for(const part of Object.values(key))if(part instanceof Uint8Array)assert.ok(part.length<128*1024);}
    return put(key,value);
  };
  storage.delete=async keys=>{if(Array.isArray(keys))assert.ok(keys.length<=128);return remove(keys);};
  const saved=await call(env,'/api/workspace',{cookie:fixtureCookie,body:{state,revision:0}});assert.equal(saved.status,200);
  assert.equal((await (await call(env,'/api/workspace',{cookie:fixtureCookie})).json()).state.cases[0].notes.length,state.cases[0].notes.length);
  assert.equal((await call(env,'/api/workspace',{cookie:fixtureCookie,body:{state:blank(),revision:1}})).status,200);
});
test('Registration rate limits and same-origin protection apply before account creation',async()=>{
  const env=accountEnvironment();
  assert.equal((await call(env,'/api/accounts',{body:{name:'Blocked'},headers:{Origin:'https://other.example'}})).status,403);
  for(let i=0;i<10;i++)await create(env,'Limited'+i);
  assert.equal((await call(env,'/api/accounts',{body:{name:'AnotherAccount'}})).status,429);
});
