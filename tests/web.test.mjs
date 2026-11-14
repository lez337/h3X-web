import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{readBody,streamOperation} from '../dist/server/index.js';
import {resolveAccount} from '../worker/accounts.mjs';
import {accountEnvironment,fixtureCookie,fixtureName,fixtureKey} from './fixtures/account-session.mjs';
import {blank,validateState} from '../src/web/state.mjs';
import {scanner,investigation,exporter} from '../src/web/shared.js';

const env=accountEnvironment();
const cookie=async()=>fixtureCookie;
async function api(action,payload={},extra={}){return worker.fetch(new Request('https://h3x.example/api/rpc',{method:'POST',headers:{'Content-Type':'application/json',Cookie:await cookie(),...extra.headers},body:JSON.stringify({action,payload,...extra.body})}),{...env,...extra.env});}

test('Workspace validation preserves investigations and rejects malformed or oversized imports',()=>{
  const state=blank();state.cases.push({id:'case-1',title:'Synthetic investigation',people:[]});
  assert.equal(validateState(state).cases[0].title,'Synthetic investigation');
  assert.equal(validateState({...state,settings:{autoExport:true}}).settings.autoExport,false);
  for(const value of [null,{},[],{...state,cases:[null]},{...state,settings:[]},{...state,pins:Array(1001).fill({})}])assert.throws(()=>validateState(value));
  assert.throws(()=>validateState({...state,settings:{text:'x'.repeat(8*1024*1024)}}),/8 MB/);
});
test('Browser scanner detects structured facts with the desktop model',()=>{
  const result=scanner.scanDetailed(JSON.stringify({email:'synthetic@example.org',address:'12 Example Road',ip:'1.1.1.1'}),'fixture.json',{kinds:['email','ipv4','address'],minConfidence:0,limit:100});
  assert.ok(result.hits.some(hit=>hit.kind==='email'&&hit.value==='synthetic@example.org'));
  assert.ok(result.hits.some(hit=>hit.kind==='ipv4'&&hit.value==='1.1.1.1'));
  assert.ok(!scanner.scanDetailed('999.2.3.4','fixture.txt',{kinds:['ipv4'],minConfidence:0}).hits.length);
});
test('Browser report exports escape markup and honor secret exclusions',()=>{
  const record={id:'fixture',title:'<script>alert(1)</script>',people:[{id:'person',name:'Synthetic Person',email:'fixture@example.org',customCategories:[],evidence:[{fields:{password:'never-export-this',email:'fixture@example.org'}}]}]};
  const html=exporter.htmlReport(record,investigation.defaults,{});
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('never-export-this'));
  assert.match(investigation.textReport(record,investigation.defaults,{}),/Synthetic Person/);
});
test('API fails closed when accounts are not configured',async()=>{
  const response=await worker.fetch(new Request('https://h3x.example/api/session'),{});
  assert.equal(response.status,503);
  assert.equal((await response.json()).configured,false);
});
test('Login validates the key and sets an expiring HttpOnly SameSite cookie',async()=>{
  const request=key=>new Request('https://h3x.example/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fixtureName,key})});
  assert.equal((await worker.fetch(request('00000000'),env)).status,401);
  const response=await worker.fetch(request(fixtureKey),env);assert.equal(response.status,200);
  const value=response.headers.get('set-cookie');
  for(const flag of ['HttpOnly','SameSite=Strict','Secure','Max-Age=28800','Path=/api'])assert.ok(value.includes(flag));
  assert.ok(!value.includes(fixtureKey));
  assert.equal((await resolveAccount(new Request('https://h3x.example',{headers:{Cookie:value.split(';')[0]}}),env)).name,fixtureName);
});
test('Forged and expired account sessions cannot authorize an API request',async()=>{
  for(const value of ['h3x_account=forged',`h3x_account=${'c'.repeat(64)}.${'b'.repeat(64)}`]){
    const response=await worker.fetch(new Request('https://h3x.example/api/rpc',{method:'POST',headers:{Cookie:value}}),env);
    assert.equal(response.status,401);
  }
  const expired=await worker.fetch(new Request('https://h3x.example/api/rpc',{method:'POST',headers:{Cookie:fixtureCookie}}),accountEnvironment({expired:true}));
  assert.equal(expired.status,401);
});
test('Cross-origin calls and non-JSON RPC payloads are rejected',async()=>{
  assert.equal((await api('credentials',{}, {headers:{Origin:'https://untrusted.example'}})).status,403);
  const response=await worker.fetch(new Request('https://h3x.example/api/rpc',{method:'POST',headers:{Cookie:await cookie(),'Content-Type':'text/plain'},body:'{}'}),env);
  assert.equal(response.status,400);
});
test('Request size is enforced even without Content-Length',async()=>{
  await assert.rejects(()=>readBody(new Request('https://h3x.example',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(100)}),50),/exceeds/);
});
test('Credential status returns booleans without returning keys',async()=>{
  const response=await api('credentials',{}, {body:{credentials:{oathnet:'synthetic-provider-key'}}});
  const text=await response.text();assert.ok(!text.includes('synthetic-provider-key'));assert.equal(JSON.parse(text).oathnet,true);
});
test('Unknown routes and actions return JSON errors instead of the SPA',async()=>{
  assert.equal((await api('unknown')).status,404);
  const response=await worker.fetch(new Request('https://h3x.example/api/not-found',{method:'POST',headers:{Cookie:await cookie()}}),env);
  assert.equal(response.status,404);assert.match(response.headers.get('content-type'),/json/);
});
test('Username API uses known catalog IDs with bounded batch sizes',async()=>{
  const stats=await (await api('usernameCatalog')).json();assert.ok(stats.available>5000);
  const selected=await (await api('usernameSelect',{limit:7})).json();assert.equal(selected.ids.length,7);
  assert.equal((await api('usernameBatch',{query:'fixture',ids:['unknown-id']})).status,400);
  assert.equal((await api('usernameBatch',{query:'fixture',ids:selected.ids})).status,400);
});
test('Search adapter runs real shared routing with mocked public responses',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{assert.match(String(url),/^https:\/\/api.github.com\/users\//);return Response.json({login:'fixture-user',name:'Synthetic Person',public_repos:2})};
  try{
    const response=await api('searchBatch',{providers:['github'],query:'@fixture-user',settings:{}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/ndjson/);
    const lines=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
    const result=lines.find(line=>line.type==='result').data;assert.equal(result.items[0].fields.login,'fixture-user');
  }finally{globalThis.fetch=original}
});
test('Deep web requests reject unbounded desktop plans',async()=>{
  const response=await api('deepSearch',{plan:{tasks:[{provider:'brixhub',field:'email',query:'fixture@example.org',filters:{}}],longSearch:true,pages:0}});
  assert.equal(response.status,400);assert.match((await response.json()).error,/bounded task/);
});
test('Provider error messages cannot echo session API keys into the response',async()=>{
  const original=globalThis.fetch,key='synthetic-secret-not-for-output';
  globalThis.fetch=async()=>Response.json({success:false,message:'Rejected key '+key});
  try{
    const response=await api('search',{provider:'oathnet',query:'fixture@example.org',settings:{oathFamily:'breach'}},{body:{credentials:{oathnet:key}}});
    const text=await response.text();assert.ok(!text.includes(key));assert.ok(text.includes('[redacted]'));
  }finally{globalThis.fetch=original}
});
test('Canceling a streaming response aborts its provider operation',async()=>{
  let signal;
  const response=streamOperation(new Request('https://h3x.example'),async input=>{signal=input;await new Promise(resolve=>input.addEventListener('abort',resolve,{once:true}));return {};});
  await Promise.resolve();await response.body.cancel();assert.equal(signal.aborted,true);
});
test('Logout clears the session cookie',async()=>{
  const response=await worker.fetch(new Request('https://h3x.example/api/logout',{method:'POST',headers:{Cookie:await cookie()}}),env);
  assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
});
