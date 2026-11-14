'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspectQuery}=require('./search-query.cjs');
const {queryInfo}=require('./free-providers.cjs');
const {profileTargets}=require('./oath-profiles.cjs');
const {searchWorkflow}=require('./search-workflow.cjs');
const {searchBrix}=require('./providers.cjs');

test('IDs, phone formats and streets use the right field and never match username providers',()=>{
 const examples=[['300760994454437890','discord','discord_id'],['76561199443618616','steam','steam_id'],['STEAM_0:0:65','steam','steam_id'],['[U:1:130]','steam','steam_id'],['steam:110000100000082','steam','steam_id'],['0624120834','phone','telephone'],['624120834','phone','telephone'],['+33 6 24 12 08 34','phone','telephone'],['(202) 555-0123','phone','telephone'],['10 rue de la Paix, Paris','address','adresse'],['rue de la Paix','address','adresse'],['Baker Street 221B, London','address','adresse']];
 for(const [query,type,field] of examples){const found=inspectQuery(query);assert.equal(found.type,type,query);assert.equal(found.field,field,query);assert.equal(queryInfo(query).types.includes('username'),false,query);}
 assert.equal(inspectQuery('STEAM_0:0:65').query,'76561197960265858');
 assert.equal(inspectQuery('[U:1:130]').query,'76561197960265858');
 assert.equal(inspectQuery('steam:110000100000082').query,'76561197960265858');
 assert.equal(inspectQuery('Jane Street').type,'name');
});
test('platform URLs, mentions, prefixes and explicit overrides normalize without losing ID precision',()=>{
 for(const value of ['<@300760994454437890>','<@!300760994454437890>','discord:300760994454437890','https://discord.com/users/300760994454437890'])assert.equal(inspectQuery(value).query,'300760994454437890');
 assert.deepEqual(profileTargets('https://steamcommunity.com/id/example').map(t=>t.kind),['steam']);
 assert.equal(inspectQuery('https://steamcommunity.com/profiles/76561199443618616').type,'steam');
 assert.equal(inspectQuery('76561199443618616','username').type,'username');
 assert.equal(inspectQuery('12345678901234','phone').type,'phone');
 assert.equal(inspectQuery('Dupont Jean','address').field,'adresse');
 assert.throws(()=>inspectQuery('hello','phone'),/phone number/);
 assert.throws(()=>inspectQuery('hello','discord'),/Discord ID/);
 assert.throws(()=>inspectQuery('hello','unknown'),/valid search type/);
});
test('phone numbers never start profile lookups, but explicit Roblox IDs and result fields still do',()=>{
 for(const phone of ['0624120834','624120834','+33624120834','06 24 12 08 34'])assert.deepEqual(profileTargets(phone),[]);
 assert.deepEqual(profileTargets('65',[],{searchQueryType:'roblox'}).map(t=>t.kind),['roblox']);
 assert.deepEqual(profileTargets('0624120834',[{fields:{roblox_id:'65'}}]).map(t=>t.kind),['roblox']);
});
test('batch skips incompatible username providers and preserves normalization and overrides',async()=>{
 for(const query of ['0624120834','300760994454437890','76561199443618616','10 rue de la Paix']){
  const calls=[];const result=await searchWorkflow({query,providers:['brixhub','whatsmyname','github','oathnet'],settings:{}},async p=>{calls.push(p);return {items:[]}});
  assert.equal(calls.some(p=>['github','whatsmyname'].includes(p.provider)),false,query);
  assert.equal(result.meta.providerStatus.filter(p=>p.status==='skipped').length,2);
 }
 const calls=[];await searchWorkflow({query:'76561199443618616',providers:['github'],settings:{searchQueryType:'username'}},async p=>{calls.push(p);return {items:[]}});assert.equal(calls.length,1);
});
test('BrixHub sends address and Steam fields, normalized phones, quick filters and explicit type choices',async()=>{
 const previous=global.fetch;const requests=[];
 global.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,text:async()=>JSON.stringify({data:{results:[]}})}};
 try{
  await searchBrix({query:'10 rue de la Paix',settings:{brixFilters:{ville:'Paris',pays:'FR'}}});assert.equal(requests.at(-1).adresse,'10 rue de la Paix');assert.equal(requests.at(-1).ville,'Paris');assert.equal(requests.at(-1).nom_famille,undefined);
  await searchBrix({query:'76561199443618616',settings:{}});assert.equal(requests.at(-1).steam_id,'76561199443618616');assert.equal(requests.at(-1).discord_id,undefined);
  await searchBrix({query:'06 24 12 08 34',settings:{}});assert.equal(requests.at(-1).telephone,'0624120834');
  await searchBrix({query:'76561199443618616',settings:{searchQueryType:'username'}});assert.equal(requests.at(-1).nom_utilisateur,'76561199443618616');
 }finally{global.fetch=previous;}
});
