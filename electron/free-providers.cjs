'use strict';
const net = require('node:net');
const {domainToASCII} = require('node:url');
const crypto = require('node:crypto');
const catalog = require('./free-provider-catalog.json');
const registry = new Map(catalog.map(provider => [provider.id, provider]));

function domain(value) {
  const host = domainToASCII(String(value).toLowerCase().replace(/\.$/, ''));
  return host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(host) ? host : '';
}
function queryInfo(value, requested='auto') {
  const detected=require('./search-query.cjs').inspectQuery(value,requested);
  const query = String(value || '').trim();
  if (!query || query.length > 256 || /[\x00-\x1f\x7f]/.test(query)) throw Error('Enter one search term (up to 256 characters).');
  const types = new Set(); let host = '', url = '', postal, phone = '';
  if (/^https?:\/\//i.test(query)) {
    try {
      const parsed = new URL(query);
      host = domain(parsed.hostname);
      if (host && !parsed.username && !parsed.password && !parsed.port) { url = parsed.href; types.add('url'); }
    } catch {}
  } else if (net.isIP(query)) { types.add('ip'); if (net.isIP(query) === 4) types.add('ipv4'); }
  else if (/^CVE-\d{4}-\d{4,}$/i.test(query)) types.add('cve');
  else if (/^AS\d{1,10}$/i.test(query) && Number(query.slice(2)) <= 4294967295 && Number(query.slice(2)) > 0) types.add('asn');
  else if (/^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/i.test(query)) types.add('hash');
  else if (/^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{11,87})$/.test(query)) types.add('bitcoin');
  else if (/^[A-Z0-9]{18}\d{2}$/i.test(query)) types.add('lei');
  else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query) && !query.startsWith('@')) {
    host = domain(query.split('@')[1]); if (host) types.add('email');
  } else if ((postal = query.match(/^([a-z]{2})\s+([a-z0-9][a-z0-9 -]{1,11})$/i)) && /\d/.test(postal[2])) types.add('postal');
  else if ((host = domain(query))) types.add('domain');
  else {
    if (/^\+?[\d\s().-]+$/.test(query) && /\+/.test(query) && /^\+\d{7,15}$/.test(query.replace(/[\s().-]/g, ''))) {
      phone = query.replace(/[\s().-]/g, ''); types.add('phone');
    } else if (/^\d{9}(?:\d{5})?$/.test(query)) types.add('companyid');
    else if (!/[@/:]/.test(query.replace(/^@/, ''))) {
      types.add('text');
      if (detected.type==='username') types.add('username');
    }
  }
  if(['discord','steam','roblox','address','name','phone'].includes(detected.type)){
    types.delete('username');types.delete('text');
    types.add(detected.type==='name'||detected.type==='address'?'text':detected.type);
    if(detected.type==='phone'){if(requested==='phone')types.delete('companyid');phone=detected.query;}
  }
  if(requested==='username'){types.clear();types.add('username');types.add('text');}
  return {query, types: [...types], host, url, postal, phone, username: query.replace(/^@/, '')};
}
function supports(id, query) {
  const provider = registry.get(id);
  if (!provider) return false;
  const info = typeof query === 'string' ? queryInfo(query) : query;
  return provider.inputs.some(type => info.types.includes(type));
}

// Only fixed service endpoints are fetched. Result URLs are displayed, never crawled.
async function requestJson(url, {headers = {}, notFound = false} = {}, request = fetch) {
  let response;
  try {
    response = await request(url, {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(18000), headers: {'Accept':'application/json', 'User-Agent':'H3X-Searcher/0.2 (public API lookup)', ...headers}});
  } catch (error) {
    throw Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Provider timed out. Try again later.' : 'Could not reach this provider. Check your connection or try again later.');
  }
  if (response.status === 404 && notFound) return null;
  if (response.status === 429) {
    const seconds = response.headers?.get('retry-after');
    throw Error('Provider quota reached.' + (/^\d{1,6}$/.test(seconds || '') ? ` Retry in ${seconds} seconds.` : ' Try again later or check your free quota.'));
  }
  if ([401,403].includes(response.status)) throw Error('Provider denied access. Check the API key, account permissions and free-plan terms.');
  if (!response.ok) throw Error(`Provider returned HTTP ${response.status}. Try again later.`);
  let body = '';
  const reader = response.body?.getReader();
  if (reader) {
    const decoder = new TextDecoder(); let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length; if (size > 4 * 1024 * 1024) throw Error('Provider response exceeded 4 MB. Narrow your query.');
        body += decoder.decode(chunk.value, {stream:true});
      }
      body += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
  } else { body = await response.text(); if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw Error('Provider response exceeded 4 MB.'); }
  let data; try { data = JSON.parse(body); } catch { throw Error('Provider returned an unexpected response instead of JSON.'); }
  if (data?.error || data?.success === false || data?.status === 'error') throw Error('Provider rejected the lookup. Check the query and account quota.');
  return data;
}
const endpoint = (base, params) => base + '?' + new URLSearchParams(params);
const array = value => { if (!Array.isArray(value)) throw Error('Provider returned an unexpected result format.'); return value; };
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] != null).map(key => [key, object[key]]));

async function lookup(id, info, limit, key, request) {
  const {query:q,host,url,username} = info;
  const get = (u, options) => requestJson(u, options, request);
  switch (id) {
    case 'dns': {
      const types = ['A','AAAA','MX','NS','TXT','CNAME'];
      const outcomes = await Promise.allSettled(types.map(type => get(endpoint('https://dns.google/resolve',{name:host,type,edns_client_subnet:'0.0.0.0/0'}))));
      const records = [], failed = [];
      outcomes.forEach((outcome,i) => {
        if (outcome.status === 'rejected') failed.push(types[i]);
        else if (outcome.value.Status === 3) return;
        else if (outcome.value.Status !== 0) failed.push(types[i]);
        else for (const answer of outcome.value.Answer || []) records.push({domain:host,record_type:({1:'A',28:'AAAA',15:'MX',2:'NS',16:'TXT',5:'CNAME'})[answer.type]||String(answer.type),value:answer.data,ttl:answer.TTL,dnssec_validated:outcome.value.AD===true});
      });
      if (failed.length === types.length) throw Error('DNS lookups failed. Try again later.');
      return {rows:[...new Map(records.map(row=>[JSON.stringify(row),row])).values()],notice:failed.length?'Some DNS record types were unavailable: '+failed.join(', '):''};
    }
    case 'crtsh': {
      const data = array(await get(endpoint('https://crt.sh/',{q:'%.'+host,output:'json'})));
      const names = new Map();
      for (const cert of data) for (const name of String(cert.name_value||'').split('\n')) {
        const clean = name.replace(/^\*\./,'').toLowerCase();
        if ((clean === host || clean.endsWith('.'+host)) && !names.has(name)) names.set(name,{domain:name,issuer:cert.issuer_name,valid_from:cert.not_before,valid_until:cert.not_after,certificate_url:'https://crt.sh/?id='+encodeURIComponent(cert.id)});
      }
      return {rows:[...names.values()]};
    }
    case 'domainsdb': {
      const data = await get(endpoint('https://api.domainsdb.info/v1/domains/search',{domain:host,limit}));
      return {rows:array(data.domains).map(row=>pick(row,['domain','country','isDead','create_date','update_date','A','AAAA','NS','MX']))};
    }
    case 'ipquery': {
      const data = await get('https://api.ipquery.io/'+encodeURIComponent(q));
      if (!data.ip) throw Error('IPQuery returned no IP details.');
      return {rows:[{ip:data.ip,...data.isp,...data.location,classification:data.risk,location_accuracy:'Approximate IP location; not a person or street address'}]};
    }
    case 'internetdb': {
      const data = await get('https://internetdb.shodan.io/'+encodeURIComponent(q),{notFound:true});
      return {rows:data?[{...pick(data,['ip','ports','hostnames','cpes','tags','vulns']),observation:'Previously indexed services; possible vulnerabilities inferred from service metadata'}]:[]};
    }
    case 'ripestat': {
      const data = await get(endpoint('https://stat.ripe.net/data/'+(info.types.includes('asn')?'as-overview':'network-info')+'/data.json',{resource:q}));
      if (data.status !== 'ok' || !data.data) throw Error('RIPEstat could not resolve this resource.');
      return {rows:[{resource:q,...pick(data.data,['prefix','asns','holder','announced','type','block','resource']),url:'https://stat.ripe.net/resource/'+encodeURIComponent(q)}]};
    }
    case 'peeringdb': {
      const data = await get(endpoint('https://www.peeringdb.com/api/net',{asn:q.slice(2),depth:0,limit}));
      return {rows:array(data.data).map(row=>({...pick(row,['name','aka','asn','website','info_type','info_traffic','policy_general','policy_url','notes']),url:'https://www.peeringdb.com/net/'+row.id}))};
    }
    case 'ipinfo': return {rows:[await get('https://api.ipinfo.io/lite/'+encodeURIComponent(q),{headers:{Authorization:'Bearer '+key}})]};
    case 'wayback': {
      const data = await get(endpoint('https://archive.org/wayback/available',{url:url||'https://'+host}));
      const snapshot = data.archived_snapshots?.closest;
      return {rows:snapshot?.available?[{original_url:url||'https://'+host,archive_url:snapshot.url,captured_at:snapshot.timestamp,status:snapshot.status}]:[]};
    }
    case 'arquivo': {
      const data = await get(endpoint('https://arquivo.pt/textsearch',{...(url?{versionHistory:url}:{q}),maxItems:limit}));
      return {rows:array(data.response_items).map(row=>({title:row.title,original_url:row.originalURL,archive_url:row.linkToArchive,captured_at:row.tstamp,content_type:row.mimeType}))};
    }
    case 'loc': {
      const data = await get(endpoint('https://www.loc.gov/search/',{q,fo:'json',c:limit}));
      return {rows:array(data.results).map(row=>pick(row,['title','date','description','url','contributor','location','original_format']))};
    }
    case 'wikidata': {
      const data = await get(endpoint('https://www.wikidata.org/w/api.php',{action:'wbsearchentities',search:q,language:'en',format:'json',limit}));
      return {rows:array(data.search).map(row=>({entity_id:row.id,title:row.label,description:row.description,url:row.concepturi}))};
    }
    case 'gitlab': {
      const data = array(await get(endpoint('https://gitlab.com/api/v4/users',{username,per_page:limit})));
      return {rows:data.filter(row=>row.username?.toLowerCase()===username.toLowerCase()).map(row=>pick(row,['username','name','web_url','state']))};
    }
    case 'hackernews': {
      const data = await get('https://hacker-news.firebaseio.com/v0/user/'+encodeURIComponent(username)+'.json');
      return {rows:data?[{username:data.id,karma:data.karma,created_at:new Date(data.created*1000).toISOString(),about:data.about,submission_count:data.submitted?.length||0,url:'https://news.ycombinator.com/user?id='+encodeURIComponent(data.id)}]:[]};
    }
    case 'bluesky': {
      const actor = host || username+'.bsky.social';
      const data = await get(endpoint('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile',{actor}),{notFound:true});
      return {rows:data?[{username:data.handle,did:data.did,name:data.displayName,bio:data.description,followers:data.followersCount,following:data.followsCount,posts:data.postsCount,created_at:data.createdAt,url:'https://bsky.app/profile/'+encodeURIComponent(data.handle)}]:[]};
    }
    case 'youtube': {
      const params = {part:'snippet,statistics',...(/^UC[a-z0-9_-]{22}$/i.test(username)?{id:username}:{forHandle:username}),key};
      const data = await get(endpoint('https://www.googleapis.com/youtube/v3/channels',params));
      return {rows:array(data.items).map(row=>({channel_id:row.id,name:row.snippet?.title,description:row.snippet?.description,country:row.snippet?.country,created_at:row.snippet?.publishedAt,...row.statistics,url:'https://www.youtube.com/channel/'+row.id}))};
    }
    case 'geopf': {
      const data = await get(endpoint('https://data.geopf.fr/geocodage/search',{q,index:'address',limit:Math.min(limit,15)}));
      return {rows:array(data.features).map(row=>({address:row.properties?.label,city:row.properties?.city,postcode:row.properties?.postcode,country:'FR',longitude:row.geometry?.coordinates?.[0],latitude:row.geometry?.coordinates?.[1],match_score:row.properties?.score,result_type:row.properties?.type}))};
    }
    case 'zippopotam': {
      const [country,code] = [info.postal[1].toLowerCase(),info.postal[2]];
      const data = await get('https://api.zippopotam.us/'+country+'/'+encodeURIComponent(code),{notFound:true});
      return {rows:data?array(data.places).map(row=>({place:row['place name'],state:row.state,country:data.country,postcode:data['post code'],latitude:row.latitude,longitude:row.longitude})):[]};
    }
    case 'companiesfr': {
      const data = await get(endpoint('https://recherche-entreprises.api.gouv.fr/search',{q,per_page:Math.min(limit,25),page:1}));
      return {rows:array(data.results).map(row=>({company:row.nom_complet,siren:row.siren,siret:row.siege?.siret,status:row.etat_administratif,activity:row.activite_principale,address:row.siege?.adresse,city:row.siege?.libelle_commune,postcode:row.siege?.code_postal,country:'FR',url:'https://annuaire-entreprises.data.gouv.fr/entreprise/'+row.siren}))};
    }
    case 'gleif': {
      const data = await get(endpoint('https://api.gleif.org/api/v1/lei-records',{[info.types.includes('lei')?'filter[lei]':'filter[entity.legalName]']:q,'page[size]':limit}));
      return {rows:array(data.data).map(row=>({company:row.attributes?.entity?.legalName?.name,lei:row.attributes?.lei,status:row.attributes?.entity?.status,address:row.attributes?.entity?.legalAddress?.addressLines?.filter(Boolean).join(', '),city:row.attributes?.entity?.legalAddress?.city,postcode:row.attributes?.entity?.legalAddress?.postalCode,country:row.attributes?.entity?.legalAddress?.country,registration:row.attributes?.registration,url:'https://search.gleif.org/#/record/'+encodeURIComponent(row.attributes?.lei||row.id)}))};
    }
    case 'emaildomain': {
      const data = await get('https://open.kickbox.com/v1/disposable/'+encodeURIComponent(host));
      if (typeof data.disposable !== 'boolean') throw Error('Disposable-domain classification was unavailable.');
      return {rows:[{domain:host,disposable:data.disposable,scope:'Domain classification only; mailbox existence and deliverability are unknown'}]};
    }
    case 'veriphone': {
      const data = await get(endpoint('https://api.veriphone.io/v3/verify',{phone:info.phone,mode:'static'}),{headers:{Authorization:'Bearer '+key}});
      if (data.status !== 'success') throw Error('Phone validation was unavailable. Check the number and API quota.');
      return {rows:[{...pick(data,['phone','phone_valid','reason','phone_type','phone_region','country','country_code','country_prefix','international_number','local_number','e164','carrier','valid','line_type','region','timezone','geographical']),lookup_mode:'Static numbering-plan data; does not establish ownership or reachability'}]};
    }
    case 'hunter': {
      const data = await get(endpoint('https://api.hunter.io/v2/domain-search',{domain:host,limit:Math.min(limit,10),api_key:key}));
      return {rows:array(data.data?.emails).map(row=>({email:row.value,type:row.type,confidence:row.confidence,company:data.data.organization,domain:host,sources:(row.sources||[]).map(source=>pick(source,['uri','extracted_on','last_seen_on']))}))};
    }
    case 'urlscan': {
      const quoted = value => '"'+value.replace(/[\\"]/g,'\\$&')+'"';
      const expression = info.types.includes('ip')?'ip:'+quoted(q):url?'page.url.keyword:'+quoted(url):'domain:'+host;
      const data = await get(endpoint('https://urlscan.io/api/v1/search/',{q:expression,size:limit}),{headers:key?{'api-key':key}:{}});
      return {rows:array(data.results).filter(row=>!url||row.page?.url===url||row.task?.url===url).map(row=>({url:row.page?.url,domain:row.page?.domain,ip:row.page?.ip,country:row.page?.country,title:row.page?.title,scanned_at:row.task?.time,report_url:row._id?'https://urlscan.io/result/'+encodeURIComponent(row._id)+'/':undefined}))};
    }
    case 'abuseipdb': {
      const data = await get(endpoint('https://api.abuseipdb.com/api/v2/check',{ipAddress:q,maxAgeInDays:90}),{headers:{Key:key}});
      if (!data.data?.ipAddress) throw Error('AbuseIPDB returned no IP report.');
      return {rows:[pick(data.data,['ipAddress','isPublic','ipVersion','abuseConfidenceScore','countryCode','usageType','isp','domain','hostnames','totalReports','numDistinctUsers','lastReportedAt'])]};
    }
    case 'virustotal': {
      const kind = info.types.includes('hash')?'files':info.types.includes('ip')?'ip_addresses':url?'urls':'domains';
      const resource = url?Buffer.from(url).toString('base64url'):host||q;
      const data = await get('https://www.virustotal.com/api/v3/'+kind+'/'+encodeURIComponent(resource),{headers:{'x-apikey':key},notFound:true});
      return {rows:data?[{resource:url||host||q,...pick(data.data?.attributes,['last_analysis_stats','last_analysis_date','reputation','categories','tags','meaningful_name','type_description','size']),report_url:'https://www.virustotal.com/gui/'+({files:'file',domains:'domain',ip_addresses:'ip-address',urls:'url'})[kind]+'/'+encodeURIComponent(resource)}]:[]};
    }
    case 'otx': {
      const kind = info.types.includes('hash')?'file':info.types.includes('ip')?(net.isIP(q)===4?'IPv4':'IPv6'):'domain';
      const data = await get('https://otx.alienvault.com/api/v1/indicators/'+kind+'/'+encodeURIComponent(host||q)+'/general',{headers:{'X-OTX-API-KEY':key},notFound:true});
      return {rows:data?[{indicator:host||q,type:kind,pulse_count:data.pulse_info?.count,...pick(data,['reputation','validation','whois','country_name','asn','type_title'])}]:[]};
    }
    case 'nvd': {
      const data = await get(endpoint('https://services.nvd.nist.gov/rest/json/cves/2.0',{cveId:q.toUpperCase()}));
      return {rows:array(data.vulnerabilities).map(({cve})=>({cve:cve.id,status:cve.vulnStatus,description:cve.descriptions?.find(item=>item.lang==='en')?.value,published:cve.published,modified:cve.lastModified,severity:cve.metrics,references:cve.references?.slice(0,10).map(item=>item.url),url:'https://nvd.nist.gov/vuln/detail/'+cve.id}))};
    }
    case 'circl': {
      const data = await get('https://vulnerability.circl.lu/api/vulnerability/'+encodeURIComponent(q.toLowerCase()),{notFound:true});
      return {rows:data && Object.keys(data).length?[{cve:q.toUpperCase(),title:data.containers?.cna?.title,description:data.containers?.cna?.descriptions?.find(item=>item.lang?.startsWith('en'))?.value||data.summary,published:data.cveMetadata?.datePublished,references:data.containers?.cna?.references?.slice(0,10).map(item=>item.url),url:'https://vulnerability.circl.lu/vuln/'+encodeURIComponent(q.toLowerCase())}]:[]};
    }
    case 'epss': {
      const data = await get(endpoint('https://api.first.org/data/v1/epss',{cve:q.toUpperCase()}));
      return {rows:array(data.data).map(row=>({...row,source:'FIRST.org / EPSS',scope:'Model estimate of exploitation in the next 30 days; not an assessment of a specific system'}))};
    }
    case 'bitcoin': {
      const data = await get('https://mempool.space/api/address/'+encodeURIComponent(q),{notFound:true});
      return {rows:data?[{bitcoin_address:data.address,confirmed_transactions:data.chain_stats?.tx_count,received_satoshis:data.chain_stats?.funded_txo_sum,spent_satoshis:data.chain_stats?.spent_txo_sum,balance_satoshis:data.chain_stats?.funded_txo_sum-data.chain_stats?.spent_txo_sum,unconfirmed:data.mempool_stats,url:'https://mempool.space/address/'+encodeURIComponent(q)}]:[]};
    }
    default: throw Error('Unknown public API provider.');
  }
}

function createFreeProviders({request = fetch, now = Date.now} = {}) {
  const cache = new Map(), nextAllowed = new Map(), active = new Set();
  async function search({provider:id, query, settings = {}, signal}, key = '') {
    const provider = registry.get(id); if (!provider) throw Error('Unknown public API provider.');
    const info = queryInfo(query,settings.searchQueryType||'auto');
    if (!supports(id, info)) return {items:[],meta:{skipped:true,reason:'Query type does not match this provider.'},notice:''};
    if (provider.credential === 'required' && !key) throw Error('Add a free '+provider.label+' API key in Settings > Free APIs.');
    const limit = Math.min(50,Math.max(1,Math.floor(Number(settings.freeApiLimit)||10)));
    const cacheKey = JSON.stringify([id,info.query,limit,crypto.createHash('sha256').update(key).digest('hex')]);
    const cached = cache.get(cacheKey);
    if (cached && now()-cached.time < 300000) return {...cached.result,meta:{...cached.result.meta,cached:true}};
    if (active.has(id)) throw Error('This provider already has a lookup in progress.');
    if ((nextAllowed.get(id)||0)>now()) throw Error('Provider rate limit: retry in '+Math.ceil((nextAllowed.get(id)-now())/1000)+' seconds.');
    active.add(id); nextAllowed.set(id,now()+({virustotal:15000,nvd:6000,emaildomain:1000}[id]||1000));
    try {
      signal?.throwIfAborted();
      const result = await lookup(id, info, limit, key, (url,options={})=>request(url,{...options,signal:signal?AbortSignal.any([signal,options.signal||AbortSignal.timeout(18000)]):options.signal}));
      signal?.throwIfAborted();
      const rows = array(result.rows), observedAt = new Date(now()).toISOString();
      const items = rows.slice(0,limit).map((row,index)=>({id:'free-'+id+'-'+crypto.createHash('sha256').update(info.query).digest('hex').slice(0,12)+'-'+index,source:provider.label,fields:Object.fromEntries(Object.entries(row).filter(([,value])=>value!=null&&value!=='')),query:info.query,observedAt}));
      const value = {items,meta:{shown:items.length,limited:rows.length>limit,observedAt},notice:result.notice||''};
      cache.set(cacheKey,{time:now(),result:value}); if (cache.size>200) cache.delete(cache.keys().next().value);
      return value;
    } finally { active.delete(id); }
  }
  return {search};
}
module.exports = {catalog, registry, queryInfo, supports, requestJson, createFreeProviders};
