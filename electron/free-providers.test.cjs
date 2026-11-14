'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {catalog,queryInfo,supports,requestJson,createFreeProviders} = require('./free-providers.cjs');
const {searchWorkflow} = require('./search-workflow.cjs');
const json = (value,status=200,headers={}) => new Response(JSON.stringify(value),{status,headers});

// Representative documented shapes, including false/zero values and nested records.
const fixtures = {
 dns:['person@example.com','dns.google',{Status:0,AD:true,Answer:[{name:'example.com',type:1,data:'192.0.2.1',TTL:300}]},'domain','example.com'],
 crtsh:['example.com','crt.sh',[{id:42,name_value:'www.example.com\n*.example.com\nwww.example.com\nevil.test',issuer_name:'CA',not_before:'2026-01-01',not_after:'2027-01-01'}],'domain','www.example.com'],
 domainsdb:['example.com','api.domainsdb.info',{domains:[{domain:'example.com',isDead:false}]},'domain','example.com'],
 ipquery:['1.1.1.1','api.ipquery.io',{ip:'1.1.1.1',isp:{asn:'AS13335'},location:{latitude:0,longitude:0},risk:{is_proxy:false}},'latitude',0],
 internetdb:['1.1.1.1','internetdb.shodan.io',{ip:'1.1.1.1',ports:[443],vulns:[]},'ip','1.1.1.1'],
 ripestat:['1.1.1.1','stat.ripe.net',{status:'ok',data:{prefix:'1.1.1.0/24',asns:['13335']}},'prefix','1.1.1.0/24'],
 peeringdb:['AS13335','www.peeringdb.com',{data:[{id:1,name:'Example network',asn:13335}]},'asn',13335],
 ipinfo:['1.1.1.1','api.ipinfo.io',{ip:'1.1.1.1',asn:'AS13335',country:'Australia'},'asn','AS13335'],
 wayback:['https://example.com/path','archive.org',{archived_snapshots:{closest:{available:true,url:'https://web.archive.org/web/20260101000000/https://example.com/path',timestamp:'20260101000000',status:'200'}}},'captured_at','20260101000000'],
 arquivo:['Example Company','arquivo.pt',{response_items:[{title:'Example',originalURL:'https://example.com',linkToArchive:'https://arquivo.pt/wayback/example',tstamp:'20260101000000'}]},'title','Example'],
 loc:['Example Company','www.loc.gov',{results:[{title:'Document',url:'https://www.loc.gov/item/1',description:['Historical document']}]},'title','Document'],
 wikidata:['Example Company','www.wikidata.org',{search:[{id:'Q1',label:'Example',description:'Example entity',concepturi:'http://www.wikidata.org/entity/Q1'}]},'entity_id','Q1'],
 gitlab:['@example','gitlab.com',[{username:'example',name:'Example',web_url:'https://gitlab.com/example'},{username:'different',name:'Other'}],'username','example'],
 hackernews:['example','hacker-news.firebaseio.com',{id:'example',karma:0,created:1600000000,about:'<script>alert(1)</script>',submitted:[1]},'karma',0],
 bluesky:['example','public.api.bsky.app',{handle:'example.bsky.social',did:'did:plc:test',displayName:'Example',followersCount:0},'username','example.bsky.social'],
 youtube:['@example','www.googleapis.com',{items:[{id:'UC1234567890123456789012',snippet:{title:'Example channel'},statistics:{videoCount:'0'}}]},'name','Example channel'],
 geopf:['10 rue de Paris','data.geopf.fr',{features:[{properties:{label:'10 rue de Paris',city:'Paris',postcode:'75001',score:0.98},geometry:{coordinates:[2.35,48.85]}}]},'latitude',48.85],
 zippopotam:['FR 63130','api.zippopotam.us',{'post code':'63130',country:'France',places:[{'place name':'Royat',state:'Auvergne',latitude:'45.76',longitude:'3.05'}]},'place','Royat'],
 companiesfr:['Mozilla','recherche-entreprises.api.gouv.fr',{results:[{nom_complet:'Mozilla',siren:'123456789',siege:{adresse:'Example office',code_postal:'75001'}}]},'company','Mozilla'],
 gleif:['Example Company','api.gleif.org',{data:[{id:'LEI',attributes:{lei:'LEI',entity:{legalName:{name:'Example'},legalAddress:{country:'FR'},status:'ACTIVE'}}}]},'company','Example'],
 emaildomain:['person@example.com','open.kickbox.com',{disposable:false},'disposable',false],
 veriphone:['+33 1 23 45 67 89','api.veriphone.io',{status:'success',phone:'+33123456789',phone_valid:false,carrier:'Example'},'phone_valid',false],
 hunter:['example.com','api.hunter.io',{data:{organization:'Example',emails:[{value:'contact@example.com',confidence:80,sources:[{uri:'https://example.com/contact'}]}]}},'email','contact@example.com'],
 urlscan:['example.com','urlscan.io',{results:[{_id:'report-id',page:{url:'https://example.com/',domain:'example.com',ip:'192.0.2.1'},task:{time:'2026-01-01'}}]},'domain','example.com'],
 abuseipdb:['1.1.1.1','api.abuseipdb.com',{data:{ipAddress:'1.1.1.1',abuseConfidenceScore:0,totalReports:0}},'totalReports',0],
 virustotal:['example.com','www.virustotal.com',{data:{attributes:{reputation:0,last_analysis_stats:{malicious:0}}}},'reputation',0],
 otx:['example.com','otx.alienvault.com',{pulse_info:{count:0},reputation:0},'pulse_count',0],
 nvd:['CVE-2021-44228','services.nvd.nist.gov',{vulnerabilities:[{cve:{id:'CVE-2021-44228',descriptions:[{lang:'en',value:'Example CVE'}],references:[{url:'https://example.com/advisory'}]}}]},'cve','CVE-2021-44228'],
 circl:['CVE-2021-44228','vulnerability.circl.lu',{cveMetadata:{datePublished:'2021-12-10'},containers:{cna:{title:'Example CVE',descriptions:[{lang:'en',value:'Example'}]}}},'description','Example'],
 epss:['CVE-2021-44228','api.first.org',{data:[{cve:'CVE-2021-44228',epss:'0.9',percentile:'0.99',date:'2026-11-13'}]},'epss','0.9'],
 bitcoin:['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa','mempool.space',{address:'1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',chain_stats:{tx_count:1,funded_txo_sum:100,spent_txo_sum:25},mempool_stats:{tx_count:0}},'balance_satoshis',75]
};

test('every catalog entry has an exercised adapter and no breach or trial-only service',()=>{
 assert.equal(catalog.length,31);assert.deepEqual(catalog.map(p=>p.id).sort(),Object.keys(fixtures).sort());
 assert.equal(new Set(catalog.map(p=>p.id)).size,catalog.length);
 for(const provider of catalog){assert.ok(provider.inputs.length);assert.match(provider.docs,/^https:\/\//);assert.doesNotMatch(provider.label,/breach|leak|stealer|pwned/i);assert.doesNotMatch(provider.free,/trial/i)}
});

for(const [id,[query,host,data,field,expected]] of Object.entries(fixtures))test(id+' uses its HTTPS read endpoint and produces usable cards',async()=>{
 const calls=[];const api=createFreeProviders({request:async(url,options)=>{
  const parsed=new URL(url);assert.equal(parsed.host,host);assert.equal(parsed.protocol,'https:');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.ok(options.signal);calls.push({parsed,options});return json(data);
 }});
 const result=await api.search({provider:id,query},'test-key');
 assert.ok(result.items.length);assert.ok(result.items[0].id.startsWith('free-'+id+'-'));assert.equal(result.items[0].source,catalog.find(p=>p.id===id).label);
 assert.equal(result.items[0].fields[field],expected);assert.equal(result.items[0].query,query);assert.ok(result.items[0].observedAt);
 assert.ok(!JSON.stringify(result).includes('test-key'));
 if(['dns','emaildomain'].includes(id)){assert.ok(calls.every(call=>!call.parsed.href.includes('person')))}
 if(['ipinfo','veriphone','abuseipdb','virustotal','otx','urlscan'].includes(id))assert.ok(calls.every(call=>!call.parsed.href.includes('test-key')));
 if(id==='veriphone'){assert.equal(calls[0].parsed.searchParams.get('mode'),'static');assert.equal(calls[0].options.headers.Authorization,'Bearer test-key')}
 if(id==='gitlab')assert.equal(result.items.length,1);
 if(id==='dns')assert.equal(calls.length,6);
 if(id==='crtsh')assert.equal(result.items.length,2);
});

test('query routing keeps structured selectors out of unrelated providers',()=>{
 for(const [query,type] of [['example.com','domain'],['person@example.com','email'],['2001:db8::1','ip'],['AS13335','asn'],['FR 63130','postal'],['GB SW1A 1AA','postal'],['+33123456789','phone'],['123456789','companyid'],['CVE-2021-44228','cve'],['5493001KJTIIGC8Y1R12','lei'],['a'.repeat(64),'hash'],['https://example.com/path','url']])assert.ok(queryInfo(query).types.includes(type),query);
 assert.equal(queryInfo('@example').username,'example');assert.equal(supports('dns','name@example.com'),true);assert.equal(supports('veriphone','CVE-2021-44228'),false);assert.equal(supports('internetdb','2001:db8::1'),false);
 for(const query of ['https://user:password@example.com','http://localhost/test','http://127.0.0.1','not an https://url'])assert.equal(supports('wayback',query),false);
 assert.throws(()=>queryInfo('x\nCookie: secret'),/search term/);assert.throws(()=>queryInfo('a'.repeat(257)),/256/);
});

test('cache saves quota, keys isolate caches and provider cooldowns never retry automatically',async()=>{
 let clock=0,calls=0;const api=createFreeProviders({now:()=>clock,request:async()=>{calls++;return json(fixtures.virustotal[2])}});
 const payload={provider:'virustotal',query:'example.com'};
 await api.search(payload,'key1');assert.equal((await api.search(payload,'key1')).meta.cached,true);assert.equal(calls,1);
 await assert.rejects(api.search({...payload,query:'other.com'},'key1'),/retry in 15 seconds/);
 await assert.rejects(api.search(payload,'key2'),/rate limit/);clock=15000;await api.search(payload,'key2');assert.equal(calls,2);
 clock=320000;await api.search(payload,'key1');assert.equal(calls,3);
});

test('missing credentials and incompatible selectors never issue network requests',async()=>{
 const api=createFreeProviders({request:async()=>assert.fail('No request expected')});
 await assert.rejects(api.search({provider:'veriphone',query:'+33123456789'}),/Settings > Free APIs/);
 assert.equal((await api.search({provider:'veriphone',query:'example.com'})).meta.skipped,true);
 await assert.rejects(api.search({provider:'unknown',query:'example.com'}),/Unknown/);
});

test('HTTP errors never expose provider response bodies, keys or URLs',async()=>{
 for(const status of [400,401,403,429,500]){
  await assert.rejects(requestJson('https://example.com?key=private-key',{},async()=>json({error:'private-key'},status,{'Retry-After':'60'})),error=>{assert.ok(!error.message.includes('private-key'));return true});
 }
 await assert.rejects(requestJson('https://example.com',{},async()=>new Response('not json')),/instead of JSON/);
 await assert.rejects(requestJson('https://example.com',{},async()=>new Response(' '.repeat(4*1024*1024+1))),/exceeded 4 MB/);
 await assert.rejects(requestJson('https://example.com',{},async()=>{throw Object.assign(Error('secret'),{name:'TimeoutError'})}),/timed out/);
 assert.equal(await requestJson('https://example.com',{notFound:true},async()=>json({},404)),null);
});

test('card limits are bounded and DNS partial failures retain records',async()=>{
 const api=createFreeProviders({request:async(url)=>{
  if(new URL(url).searchParams.get('type')==='AAAA')return json({},500);
  return json({Status:0,Answer:Array.from({length:70},(_,i)=>({type:1,data:'192.0.2.'+i,TTL:0}))});
 }});
 const result=await api.search({provider:'dns',query:'example.com',settings:{freeApiLimit:10000}});
 assert.equal(result.items.length,50);assert.equal(result.meta.limited,true);assert.match(result.notice,/AAAA/);assert.equal(result.items[0].fields.ttl,0);
});

test('batch bounds concurrency, preserves source order, reports errors and skips incompatible queries',async()=>{
 let active=0,max=0;const ids=['dns','crtsh','domainsdb','wayback','emaildomain','urlscan','virustotal','veriphone'];
 const result=await searchWorkflow({providers:ids,query:'example.com'},async payload=>{
  active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,5));active--;
  if(payload.provider==='crtsh')throw Error('Quota reached');return {items:[{id:payload.provider,source:payload.provider,fields:{}}],meta:{}};
 });
 assert.equal(max,4);assert.deepEqual(result.items.map(item=>item.id),ids.filter(id=>!['crtsh','veriphone'].includes(id)));
 assert.equal(result.meta.providerStatus.find(p=>p.id==='veriphone').status,'skipped');assert.equal(result.meta.providerStatus.find(p=>p.id==='crtsh').status,'error');assert.match(result.notice,/Certificate Transparency: Quota reached/);
 const skipped=await searchWorkflow({providers:['veriphone','bitcoin'],query:'example.com'},()=>assert.fail('No lookup expected'));
 assert.equal(skipped.items.length,0);assert.ok(skipped.meta.providerStatus.every(p=>p.status==='skipped'));
});

test('URL, ASN, hash and full-handle queries use the correct adapter branches',async()=>{
 const scenarios=[
  ['urlscan','https://example.com/a?x=1',u=>assert.equal(u.searchParams.get('q'),'page.url.keyword:"https://example.com/a?x=1"'),{results:[]}],
  ['ripestat','AS13335',u=>assert.equal(u.pathname,'/data/as-overview/data.json'),{status:'ok',data:{holder:'Example',announced:true}}],
  ['bluesky','custom.example.com',u=>assert.equal(u.searchParams.get('actor'),'custom.example.com'),{handle:'custom.example.com'}],
  ['youtube','UC1234567890123456789012',u=>{assert.equal(u.searchParams.get('id'),'UC1234567890123456789012');assert.equal(u.searchParams.get('forHandle'),null)},{items:[]}],
  ['virustotal','https://example.com/a',u=>assert.equal(u.pathname,'/api/v3/urls/'+Buffer.from('https://example.com/a').toString('base64url')),{data:{attributes:{}}}],
  ['virustotal','a'.repeat(64),u=>assert.equal(u.pathname,'/api/v3/files/'+'a'.repeat(64)),{data:{attributes:{}}}],
  ['otx','2001:db8::1',u=>assert.equal(u.pathname,'/api/v1/indicators/IPv6/2001%3Adb8%3A%3A1/general'),{pulse_info:{count:0}}],
  ['gleif','5493001KJTIIGC8Y1R12',u=>assert.equal(u.searchParams.get('filter[lei]'),'5493001KJTIIGC8Y1R12'),{data:[]}]
 ];
 for(const [provider,query,check,data] of scenarios){
  const api=createFreeProviders({request:async url=>{check(new URL(url));return json(data)}});
  await api.search({provider,query},'key');
 }
});

test('street addresses are usable by the map and wallet identifiers are not treated as streets',async()=>{
 const api=createFreeProviders({request:async url=>json(new URL(url).host==='api.gleif.org'?{data:[{attributes:{lei:'LEI',entity:{legalName:{name:'Example'},legalAddress:{addressLines:['10 Example Road','Floor 2'],city:'Paris',postalCode:'75001',country:'FR'}}}}]}:fixtures.bitcoin[2])});
 const entity=await api.search({provider:'gleif',query:'Example'});
 assert.equal(entity.items[0].fields.address,'10 Example Road, Floor 2');assert.equal(entity.items[0].fields.country,'FR');
 const bitcoin=await api.search({provider:'bitcoin',query:fixtures.bitcoin[0]});
 assert.equal(bitcoin.items[0].fields.address,undefined);assert.equal(bitcoin.items[0].fields.bitcoin_address,fixtures.bitcoin[0]);
});
