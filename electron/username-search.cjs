'use strict';
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const BUNDLED = require('./username-sites.json');
const DATA_URL = 'https://raw.githubusercontent.com/soxoj/maigret/main/maigret/resources/data.json';
const SOURCE_URL = 'https://github.com/soxoj/maigret';
const statuses = ['match','possible','not_found','inconclusive','skipped'];

function accountName(value) {
  const account = String(value || '').trim().replace(/^@/, '');
  if (!/^[\p{L}\p{N}_.-]{1,64}$/u.test(account) || /^[.-]+$/.test(account)) throw Error('Enter one username using letters, numbers, dots, underscores or hyphens (up to 64 characters).');
  return account;
}
function publicUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || !url.hostname.includes('.') || net.isIP(url.hostname) || /(?:^|\.)(localhost|local|internal|test|invalid|onion|i2p)$/.test(url.hostname)) throw Error('A public HTTPS site is required.');
  return url;
}
function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a,b] = address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&[0,168].includes(b) || a===198&&[18,19,51].includes(b) || a===100&&b>=64&&b<=127 || a===203&&b===0);
}
// Resolve and pin each connection to a public address. Redirects are checked again.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, {all:true, family:4}, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(a=>!publicIPv4(a.address))) return callback(Error('Site resolved to a non-public address.'));
    const entry = addresses[0];
    callback(null, ...(options.all ? [[entry]] : [entry.address,4]));
  });
}
async function requestPage(value, {signal, maxBytes=512*1024, headers={}, redirects=0, origin}={}) {
  const url = publicUrl(value);
  const host = url.hostname.replace(/^www\./, '');
  if (origin && host !== origin) throw Error('Site redirected to another domain.');
  const response = await new Promise((resolve,reject) => {
    const request = https.get(url, {signal,lookup:publicLookup,headers:{'User-Agent':'H3X-Searcher/Public-Username-Search','Accept':'text/html, application/json','Accept-Encoding':'identity',...headers}}, response => {
      const chunks=[];let bytes=0;
      response.on('data', chunk => {bytes+=chunk.length;if(bytes>maxBytes){response.destroy(Error('Site response exceeded the size limit.'));return}chunks.push(chunk)});
      response.on('error',reject);
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8'),url:url.href}));
    });
    request.on('error',reject);
  });
  if ([301,302,303,307,308].includes(response.status)) {
    if (redirects>=3 || !response.headers.location) throw Error('Site redirect could not be checked.');
    return requestPage(new URL(response.headers.location,url).href,{signal,maxBytes,headers,redirects:redirects+1,origin:origin||host});
  }
  return response;
}
const strings = value => Array.isArray(value) ? value.filter(s=>typeof s==='string'&&s.length>0&&s.length<=2000).slice(0,60) : [];
function safePattern(pattern) {
  if(typeof pattern!=='string'||pattern.length>180||/[()|]|\\[1-9]/.test(pattern))return false;
  const tokens=pattern.replace(/\[(?:\\.|[^\]\\])*\]|\\./g,'x');
  return (tokens.match(/[?*+]|\{\d+,\d*\}/g)||[]).length<=2;
}
function sanitizedSnapshot(data, snapshot={date:new Date().toISOString(),url:SOURCE_URL,license:'MIT'}) {
  if (!data || !data.sites || Array.isArray(data.sites) || typeof data.sites!=='object' || Object.keys(data.sites).length>20000) throw Error('Invalid username catalog.');
  const keys = ['url','urlMain','urlProbe','urlSubpath','usernameUnclaimed','checkType','presenseStrs','absenceStrs','tags','regexCheck','type','encoding','alexaRank','errors','disabled','engine','requestMethod','protocol','requiresAuth'];
  function clean(site) {
    const out={};for(const key of keys) if (Object.hasOwn(site,key)) out[key]=site[key];
    out.requiresAuth=Boolean(site.requiresAuth||site.activation||site.requestPayload||Object.keys(site.headers||{}).some(k=>/authorization|cookie|token|api.?key/i.test(k)));
    // Do not import cookies, bearer tokens, browser impersonation or activation flows.
    out.headers=Object.fromEntries(Object.entries(site.headers||{}).filter(([k,v])=>/^(accept|accept-language|x-ig-app-id)$/i.test(k)&&typeof v==='string'&&!/[\r\n]/.test(v)));
    return out;
  }
  return {snapshot,sites:Object.fromEntries(Object.entries(data.sites).filter(([,s])=>s&&typeof s==='object').map(([name,s])=>[name,clean(s)])),engines:Object.fromEntries(Object.entries(data.engines||{}).filter(([,s])=>s?.site).map(([name,s])=>[name,{site:clean(s.site)}]))};
}
function buildCatalog(data) {
  const sites=[], seen=new Set();let disabled=0,unsupported=0,duplicates=0;
  for (const [name,original] of Object.entries(data.sites)) {
    const engine=data.engines?.[original.engine]?.site||{};
    const rule={...engine,...original};
    rule.presenseStrs=[...strings(original.presenseStrs),...strings(engine.presenseStrs)];
    rule.absenceStrs=[...strings(original.absenceStrs),...strings(engine.absenceStrs)];
    if (rule.disabled) {disabled++;continue}
    // Other identifier types and authenticated/special protocols are separate tools.
    if (rule.requiresAuth||engine.requiresAuth||rule.activation||rule.requestPayload||rule.requestMethod&&rule.requestMethod!=='GET'||rule.protocol&&rule.protocol!=='https'||rule.type&&rule.type!=='username'||rule.encoding&&rule.encoding!=='utf-8'||!['message','status_code'].includes(rule.checkType)) {unsupported++;continue}
    const fill=value=>String(value||'').replaceAll('{urlMain}',String(rule.urlMain||'').replace(/\/$/, '')).replaceAll('{urlSubpath}',rule.urlSubpath||'');
    const profile=fill(rule.url),probe=fill(rule.urlProbe||rule.url);
    try {publicUrl(profile.replaceAll('{username}','h3xcheck'));publicUrl(probe.replaceAll('{username}','h3xcheck'));if(!profile.includes('{username}')||!probe.includes('{username}')||/\{(?!username\})/.test(profile+probe))throw Error()} catch {unsupported++;continue}
    // Run only bounded, non-grouping validation expressions from the upstream data.
    if(rule.regexCheck && !safePattern(rule.regexCheck)) {unsupported++;continue}
    let regex=null;try{if(rule.regexCheck)regex=new RegExp(rule.regexCheck)}catch{unsupported++;continue}
    const key=profile.replace(/^https:\/\/www\./,'https://').replace(/\/$/,'').toLowerCase();
    if(seen.has(key)){duplicates++;continue}seen.add(key);
    const tags=[...new Set([...strings(rule.tags),...(original.engine?[original.engine.toLowerCase()]:[])])].filter(t=>t.length<=60);
    if(rule.checkType==='message'&&!rule.presenseStrs.length&&!rule.absenceStrs.length){unsupported++;continue}
    if(/breach|stealer|leaked.?data|credential/i.test(name+' '+tags.join(' '))){unsupported++;continue}
    sites.push({id:crypto.createHash('sha256').update(key).digest('hex').slice(0,16),name:name.slice(0,160),profile,probe,host:new URL(probe.replaceAll('{username}','h3xcheck')).hostname,tags,rank:Number(rule.alexaRank)||1e9,checkType:rule.checkType,presence:rule.presenseStrs,absence:rule.absenceStrs,errors:strings(Object.keys(rule.errors||{})),headers:rule.headers||{},regex,control:rule.usernameUnclaimed});
  }
  sites.sort((a,b)=>a.rank-b.rank||a.name.localeCompare(b.name));
  return {sites,stats:{total:Object.keys(data.sites).length,available:sites.length,disabled,unsupported,duplicates,snapshot:data.snapshot||BUNDLED.snapshot,categories:[...new Set(sites.flatMap(s=>s.tags))].sort()}};
}
function selectSites(catalog, options={}) {
  const category=String(options.category||''),query=String(options.siteFilter||'').toLowerCase().slice(0,100);
  const list=catalog.sites.filter(s=>(!category||s.tags.includes(category))&&(!query||(s.name+' '+s.host).toLowerCase().includes(query)));
  const limit=options.limit==='all'||options.limit==null?list.length:Math.min(10000,Math.max(1,Math.trunc(Number(options.limit)||list.length)));
  return {sites:list.slice(0,limit),eligible:list.length};
}
const wall = /<title[^>]*>\s*(?:just a moment|attention required|access denied|sign in|log in)|cf-chl-|challenge-platform|verify (?:that )?you are human|captcha-container|g-recaptcha|h-captcha|you must be logged[ -]in|you must be logged in|you need to (?:log|sign) in|login required|sign in to (?:continue|view)|гостям запрещено|вы должны быть авторизованы|для того, чтобы это сделать, нужно сначала войти|du musst eingeloggt sein/i;
function classify(site, response) {
  if ([401,403,407,429].includes(response.status)||response.status>=500||wall.test(response.body)||site.errors.some(s=>response.body.includes(s))) return {status:'inconclusive',reason:response.status===429?'Site rate limit reached.':'Site blocked the check, required login, or returned an error.'};
  if ([404,410].includes(response.status)) return {status:'not_found',reason:'Site returned a missing-page response.'};
  if(response.status<200||response.status>=300)return {status:'inconclusive',reason:'Unexpected HTTP response.'};
  if(site.absence.some(s=>response.body.includes(s)))return {status:'not_found',reason:'Site returned its missing-account marker.'};
  if(site.checkType==='message'){
    if(site.presence.some(s=>response.body.includes(s)))return {status:'match',reason:'Public page matched the site detection rule.'};
    if(!site.presence.length&&site.absence.length)return {status:'possible',reason:'No missing-account marker; verify the public profile.'};
    return {status:'inconclusive',reason:'No reliable account marker in the response.'};
  }
  return {status:'possible',reason:'Public endpoint responded successfully; verify the profile.'};
}
async function checkSite(site, account, {request=requestPage,signal,timeout=8000}={}) {
  const start=Date.now(),url=site.profile.replaceAll('{username}',encodeURIComponent(account));
  const base={id:site.id,site:site.name,host:site.host,url,username:account,categories:site.tags,source:'Maigret',checkedAt:new Date().toISOString()};
  const result=outcome=>({...base,...outcome,durationMs:Date.now()-start});
  if(site.regex&&!site.regex.test(account))return result({status:'skipped',reason:'Username does not fit this site’s format.'});
  try {
    const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
    const response=await request(site.probe.replaceAll('{username}',encodeURIComponent(account)),{signal:combined,headers:site.headers});
    const outcome=classify(site,response);
    if(!['match','possible'].includes(outcome.status))return result({...outcome,httpStatus:response.status});
    let control=String(site.control||'');
    if(!/^[\p{L}\p{N}_.-]{1,64}$/u.test(control)||control.toLowerCase()===account.toLowerCase()||site.regex&&!site.regex.test(control)) control='h3x'+crypto.randomBytes(8).toString('hex');
    if(site.regex&&!site.regex.test(control))return result({status:'inconclusive',reason:'Could not validate the site using a missing-account control.'});
    const negative=classify(site,await request(site.probe.replaceAll('{username}',encodeURIComponent(control)),{signal:combined,headers:site.headers}));
    // A generic success page is not evidence of an account. A control must be absent.
    if(negative.status!=='not_found')return result({status:'inconclusive',reason:'Missing-account control did not distinguish this page from a generic or blocked response.'});
    return result({...outcome,reason:outcome.reason+' Missing-account control passed.',httpStatus:response.status});
  } catch(error) {
    return result({status:'inconclusive',reason:signal?.aborted?'Check canceled.':error.name==='TimeoutError'||error.name==='AbortError'?'Site timed out.':'Site unavailable or response could not be checked.'});
  }
}
async function scanUsername(catalog, options, {request=requestPage,signal,onProgress=()=>{}}={}) {
  const account=accountName(options.query),selection=selectSites(catalog,options),started=Date.now();
  const results=[],counts=Object.fromEntries(statuses.map(s=>[s,0]));let next=0,last=0,pending=[];
  const emit=force=>{if(force||Date.now()-last>=150){onProgress({runId:options.runId,query:account,total:selection.sites.length,eligible:selection.eligible,completed:results.length,counts:{...counts},results:pending,elapsedMs:Date.now()-started});pending=[];last=Date.now()}};
  emit(true);
  const concurrency=options.concurrency==='max'?100:Math.min(20,Math.max(1,Math.trunc(Number(options.concurrency)||10)));
  // One active check per hostname; a large registry can contain several profiles per site.
  const hosts=new Set(),queue=[...selection.sites];
  async function worker(){while(queue.length&&!signal?.aborted){const index=queue.findIndex(s=>!hosts.has(s.host));if(index<0){await new Promise(resolve=>setTimeout(resolve,25));continue}const [site]=queue.splice(index,1);hosts.add(site.host);let row;try{row=await checkSite(site,account,{request,signal})}finally{hosts.delete(site.host)}results.push(row);counts[row.status]++;pending.push(row);next++;emit(false)}}
  await Promise.all(Array.from({length:Math.min(concurrency,queue.length)},worker));emit(true);
  return {runId:options.runId,query:account,results,counts,total:selection.sites.length,eligible:selection.eligible,completed:next,canceled:Boolean(signal?.aborted),elapsedMs:Date.now()-started,snapshot:catalog.stats.snapshot};
}
function createCatalogStore(directory, request=requestPage) {
  let catalog, loading;
  const cachePath=path.join(directory,'username-catalog.json');
  async function load(){if(catalog)return catalog;if(!loading)loading=(async()=>{let data=BUNDLED;try{const stat=await fs.stat(cachePath);if(stat.size<=12*1024*1024){const cached=JSON.parse(await fs.readFile(cachePath,'utf8'));if(cached.snapshot?.url===SOURCE_URL)data=sanitizedSnapshot(cached,cached.snapshot)}}catch{}catalog=buildCatalog(data);return catalog})();return loading}
  async function refresh(){
    const response=await request(DATA_URL,{signal:AbortSignal.timeout(25000),maxBytes:12*1024*1024});
    if(response.status!==200)throw Error('Could not refresh the public username catalog.');
    const data=sanitizedSnapshot(JSON.parse(response.body)),updated=buildCatalog(data);
    if(updated.stats.available<500)throw Error('The downloaded catalog was incomplete. The previous catalog is still available.');
    await fs.mkdir(directory,{recursive:true});const tmp=cachePath+'.'+crypto.randomUUID()+'.tmp';
    try{await fs.writeFile(tmp,JSON.stringify(data));await fs.rename(tmp,cachePath)}finally{await fs.rm(tmp,{force:true})}
    catalog=updated;return catalog;
  }
  return {load,refresh};
}
function registerUsernameSearch({ipcMain,directory,log=async()=>{},store=createCatalogStore(directory),scan=scanUsername}) {
  const jobs=new Map();
  ipcMain.handle('username:catalog',async(_,payload={})=>(await (payload.refresh?store.refresh():store.load())).stats);
  ipcMain.handle('username:cancel',event=>{const job=jobs.get(event.sender.id);if(!job)return false;job.abort();return true});
  async function run(event,payload={},parentSignal){
    const id=event.sender.id;if(jobs.has(id))throw Error('A username search is already running.');
    accountName(payload.query);
    if(typeof payload.runId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(payload.runId))throw Error('Invalid search identifier.');
    const controller=new AbortController();jobs.set(id,controller);
    const parentAbort=()=>controller.abort();parentSignal?.addEventListener('abort',parentAbort,{once:true});if(parentSignal?.aborted)controller.abort();
    const destroyed=()=>controller.abort();event.sender.once('destroyed',destroyed);
    try{await log('Username search started','Public profile checks',{scope:'username'});const result=await scan(await store.load(),payload,{signal:controller.signal,onProgress:progress=>{if(!event.sender.isDestroyed())event.sender.send('username:progress',progress)}});if(!event.sender.isDestroyed())event.sender.send('username:progress',{...result,results:[],finished:true});await log(result.canceled?'Username search stopped':'Username search completed',`${result.completed} checks; ${result.counts.match} matches; ${result.counts.possible} possible`,{scope:'username',durationMs:result.elapsedMs});return result}
    finally{parentSignal?.removeEventListener('abort',parentAbort);event.sender.removeListener('destroyed',destroyed);jobs.delete(id)}
  }
  ipcMain.handle('username:scan',run);
  return {run};
}
function configuredOptions(settings={}) {
  const saved=settings.usernameSearchOptions;
  return saved?.schemaVersion===2?{limit:saved.limit??'all',category:saved.category||'',siteFilter:saved.siteFilter||'',concurrency:saved.concurrency||10}:{limit:'all',category:'',siteFilter:'',concurrency:10};
}
function usernameEvidence(hit) {
  return {id:'username-'+hit.id,source:'H3X Username',profileType:'username',query:hit.username,fields:{username:hit.username,site:hit.site,url:hit.url,status:hit.status==='match'?'Profile match':'Possible profile',detection_reason:hit.reason,categories:hit.categories.join(', '),checked_at:hit.checkedAt,rule_source:'Maigret (MIT)',identity:'Shared handle only; account ownership unverified'}};
}
async function searchUsernameProvider(payload,event,service) {
  try{accountName(payload.query)}catch{return {items:[],meta:{skipped:true,reason:'Username search requires one public username.'}}}
  const run=await service.run(event,{...configuredOptions(payload.settings),query:payload.query,runId:payload.usernameRunId||crypto.randomUUID()},payload.signal);
  return {items:run.results.filter(hit=>['match','possible'].includes(hit.status)).map(usernameEvidence),meta:{usernameRun:run},notice:run.canceled?'Username search stopped; completed checks retained.':''};
}
module.exports={accountName,publicUrl,publicIPv4,publicLookup,requestPage,safePattern,sanitizedSnapshot,buildCatalog,selectSites,classify,checkSite,scanUsername,createCatalogStore,registerUsernameSearch,configuredOptions,usernameEvidence,searchUsernameProvider};
