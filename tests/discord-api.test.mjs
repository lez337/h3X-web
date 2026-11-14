import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {discordIdentity,lookupDiscord} from '../worker/discord-api.mjs';
import {accountEnvironment,fixtureCookie,fixtureName} from './fixtures/account-session.mjs';
import {accountName} from '../worker/accounts.mjs';

const identity={userId:'123456789012345678',username:'fictional.user'};
function call(env,path,body,headers={}){return worker.fetch(new Request('https://h3x.example'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);}
test('Account API keys are session-managed, hash-only, scoped, replaceable and revocable',async()=>{
  const env=accountEnvironment(),route='/api/account/api-key',headers={Cookie:fixtureCookie};
  assert.equal((await call(env,route,{action:'create'})).status,401);
  const {key}=await (await call(env,route,{action:'create'},headers)).json();
  assert.match(key,/^h3x_[a-f0-9]{64}_[a-f0-9]{64}$/);
  const meta=await env.H3X_ACCOUNTS.context(accountName(fixtureName).id).storage.get('account');
  assert.ok(meta.apiKeyHash);assert.ok(!JSON.stringify(meta).includes(key));
  assert.equal((await (await call(env,route,undefined,headers)).json()).enabled,true);
  const bearer={Authorization:'Bearer '+key};
  // A valid key reaches input validation; no live providers are called.
  assert.equal((await call(env,'/api/v1/discord/search',{},bearer)).status,400);
  assert.equal((await call(env,'/api/v1/discord/search',identity,headers)).status,401);
  for(const path of ['/api/workspace','/api/reports','/api/session']){
    const response=await call(env,path,undefined,bearer);
    if(path==='/api/session')assert.equal((await response.json()).authenticated,false);else assert.equal(response.status,401);
  }
  assert.equal((await call(env,route,{action:'revoke'},bearer)).status,401);
  assert.equal((await call(env,route,{action:'create'},{...headers,Origin:'https://discord.com'})).status,403);
  assert.equal((await call(env,route,{action:'create'},{...headers,'X-H3X-Account':'other'})).status,401);
  const replacement=await (await call(env,route,{action:'create'},headers)).json();assert.notEqual(replacement.key,key);
  assert.equal((await call(env,'/api/v1/discord/search',{},bearer)).status,401);
  assert.equal((await call(env,'/api/v1/discord/search',{}, {Authorization:'Bearer '+replacement.key})).status,400);
  await call(env,route,{action:'revoke'},headers);
  assert.equal((await call(env,'/api/v1/discord/search',{}, {Authorization:'Bearer '+replacement.key})).status,401);
});
test('Discord identity validation preserves snowflake precision and rejects malformed input',()=>{
  assert.deepEqual(discordIdentity(identity),identity);
  for(const value of [{...identity,userId:123456789012345678},{...identity,userId:'1'},{...identity,username:'x\n'},{...identity,username:'a'.repeat(33)},null])assert.throws(()=>discordIdentity(value));
});
test('Worker bearer endpoint returns live-adapter cards for both exact fields without exposing credentials',async()=>{
  const env=accountEnvironment();
  const {key}=await (await call(env,'/api/account/api-key',{action:'create'},{Cookie:fixtureCookie})).json();
  const original=globalThis.fetch,queries=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://api.brixhub.ru/api/v1/search');
    queries.push(JSON.parse(options.body));
    return Response.json({data:{results:[{username:identity.username,discord_id:identity.userId,token:'private-token'}]}});
  };
  try{
    const response=await call(env,'/api/v1/discord/search',identity,{Authorization:'Bearer '+key});
    assert.equal(response.status,200);const value=await response.json();
    assert.equal(value.items.length,1);assert.equal(value.items[0].fields.token,'[redacted]');
    assert.equal(queries[0].discord_id,identity.userId);assert.equal(queries[1].nom_utilisateur,identity.username);
    assert.ok(value.providerStatus.every(p=>p.status==='complete'));
    assert.equal(response.headers.get('cache-control'),'no-store, private');
  }finally{globalThis.fetch=original;}
});
test('Lookups query both identifiers, deduplicate cards, redact secrets and retain partial failures',async()=>{
  const tasks=[];
  const result=await lookupDiscord(identity,{OATHNET_API_KEY:'fixture-secret'},new AbortController().signal,async task=>{
    tasks.push(task);
    if(task.kind==='profile')throw Error('upstream failed with private credential');
    return {items:[{id:'one',source:'Fixture',fields:{username:identity.username,password:'do-not-return'}}]};
  });
  assert.equal(tasks.length,3);assert.equal(tasks[0].field,'discord_id');assert.equal(tasks[1].query,identity.username);
  assert.equal(result.items.length,1);assert.equal(result.items[0].fields.password,'[redacted]');
  assert.equal(result.providerStatus[2].status,'error');assert.match(result.notice,/incomplete/);
  assert.ok(!JSON.stringify(result).includes('private credential'));
  const failed=await lookupDiscord(identity,{},new AbortController().signal,async()=>{throw Error('offline')});
  assert.equal(failed.items.length,0);assert.ok(failed.providerStatus.every(p=>p.status==='error'));
});
