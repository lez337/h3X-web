'use strict';
const crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {searchBrix,BRIX_FIELDS,validateFilter}=require('./providers.cjs');
const {searchGhunt}=require('./public-providers.cjs');
const BASE='https://oathnet.org/api/service/v2/bulk-search';
const MAX_BYTES=8*1024*1024,MAX_RECORDS=5000;
const privateField=/(?:password|passwd|secret|token|cookie|session|authorization|api.?key)|^(?:pwd|auth|raw|raw_response|output|response|log|log_content)$/i;
function cleanRecord(value,depth=0){
 if(depth>10)return null;
 if(Array.isArray(value))return value.slice(0,1000).map(v=>cleanRecord(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!privateField.test(key)).map(([key,v])=>[key,cleanRecord(v,depth+1)]));
 return typeof value==='string'?value.slice(0,16000):value;
}
function stable(value){return Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value}
function recordItem(fields,source){const cleaned=cleanRecord(fields);return {id:'deep-'+crypto.createHash('sha256').update(source+'\0'+JSON.stringify(stable(cleaned))).digest('hex').slice(0,24),source,fields:cleaned}}
function validatePlan(plan){
 if(!plan||!Array.isArray(plan.tasks)||!plan.tasks.length||plan.tasks.length>84||JSON.stringify(plan).length>100000)throw Error('Choose between 1 and 84 deep-search tasks.');
 if(![1,3].includes(plan.pages)&&!(plan.longSearch===true&&plan.pages===0))throw Error('Choose 100 or 300 records per BrixHub search.');
 for(const task of plan.tasks){
  if(!task||!['oathnet','brixhub','ghunt'].includes(task.provider)||!task.filters||typeof task.filters!=='object'||Array.isArray(task.filters))throw Error('Invalid deep-search task.');
  if(task.provider==='oathnet'){
   if(task.family!=='breach'||!Array.isArray(task.terms)||!task.terms.length||task.terms.length>36||task.terms.some(t=>typeof t!=='string'||!t.trim()||t.length>150||/[\u0000-\u001f]/.test(t)))throw Error('OathNet bulk search accepts up to 36 identity terms.');
  }else if(task.provider==='ghunt'){
   if(typeof task.query!=='string'||task.query.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(task.query)||task.settings?.ghuntPath!=null&&(typeof task.settings.ghuntPath!=='string'||task.settings.ghuntPath.length>1024))throw Error('Invalid GHunt email lookup.');
  }else if(!BRIX_FIELDS.has(task.field)||typeof task.query!=='string'||!task.query.trim()||task.query.length>150||/[\u0000-\u001f]/.test(task.query))throw Error('Invalid BrixHub identity term.');
 }
 return plan;
}
async function boundedText(response){
 if(Number(response.headers?.get('content-length'))>MAX_BYTES)throw Error('Provider output exceeds the 8 MB deep-search limit.');
 if(!response.body?.getReader){const text=await response.text();if(Buffer.byteLength(text)>MAX_BYTES)throw Error('Provider output exceeds the 8 MB deep-search limit.');return text}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw Error('Provider output exceeds the 8 MB deep-search limit.')}chunks.push(Buffer.from(value))}}finally{reader.releaseLock()}
 return Buffer.concat(chunks).toString('utf8');
}
function parseBulk(text){
 const records=[];
 function add(value){
  if(Array.isArray(value)){value.forEach(add);return}
  if(!value||typeof value!=='object')return;
  // Accept JSON arrays, envelopes, and per-term JSONL search envelopes.
  for(const key of ['items','results','records'])if(Array.isArray(value[key])){add(value[key]);return}
  if(value.data&&typeof value.data==='object'){add(value.data);return}
  if(value.record&&typeof value.record==='object'){add(value.record);return}
  records.push(value);
 }
 const trimmed=text.replace(/^\uFEFF/,'').trim();if(!trimmed)return [];
 try{add(JSON.parse(trimmed))}catch{for(const line of trimmed.split(/\r?\n/).filter(v=>v.trim())){let value;try{value=JSON.parse(line)}catch{throw Error('OathNet returned malformed bulk JSON output.')}add(value)}}
 return records;
}
// Contract: docs.oathnet.org/api-reference/endpoints/v2-bulk-search-create.
async function oathBulk(task,key,{signal,progress,fetcher=fetch,wait=delay,now=Date.now}={}){
 if(!key)throw Error('Add an OathNet API key in Settings.');
 const headers={'x-api-key':key,'Content-Type':'application/json'};
 function reason(body){
  const messages=[];
  function add(value,depth=0){
   if(depth>3||value==null)return;
   if(typeof value==='string')messages.push(value);
   else if(Array.isArray(value))value.slice(0,5).forEach(v=>add(v,depth+1));
   else if(typeof value==='object')for(const name of ['message','msg','error','detail','errors'])add(value[name],depth+1);
  }
  add(body);return [...new Set(messages)].join('; ').split(key).join('[redacted]').replace(/[\u0000-\u001f]/g,' ').slice(0,500);
 }
 async function request(url,options={}){
  signal?.throwIfAborted();
  const response=await fetcher(url,{...options,headers,redirect:'error',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(25000)])});
  if(!response.ok){
   let detail='';try{detail=reason(JSON.parse(await boundedText(response)))}catch{}
   const error=Error(`OathNet request failed (HTTP ${response.status})${detail?': '+detail:'.'}`);error.status=response.status;throw error;
  }
  return response;
 }
 async function json(url,options){const value=JSON.parse(await boundedText(await request(url,options)));if(value.success===false)throw Error('OathNet rejected the search'+(reason(value)?': '+reason(value):'.'));return value.data||value}
 const config={},extra={};
 const extraKeys=new Set(['sort','from','to','date_field','logic','view']);
 function setConfig(key,value){
  if(['q','cursor','page_size','search_id','__proto__','constructor','prototype'].includes(key)||value==null||value===''||Array.isArray(value)&&!value.length||typeof value==='object'&&!Object.keys(value).length)return;
  if(key==='extra_params'){for(const [name,v] of Object.entries(value))if(extraKeys.has(name))setConfig(name,v);return}
  (extraKeys.has(key)?extra:config)[key.replace(/\[\]$/,'')]=value;
 }
 for(const [key,value] of Object.entries(task.filters||{}))setConfig(key,value);
 for(const key of ['sort','from','to','date_field','logic','filter_id','view','wildcard'])setConfig(key,task.options?.[key]);
 if(Object.keys(extra).length)config.extra_params=extra;
 if(config.filter){if(typeof config.filter==='string')config.filter=JSON.parse(config.filter);if(config.filter&&typeof config.filter==='object'&&!Array.isArray(config.filter)&&!Object.keys(config.filter).length)delete config.filter;else validateFilter(config.filter)}
 if(config.filter_id&&!/^[a-f0-9]{24}$/i.test(config.filter_id))throw Error('OathNet filter ID must be 24 hexadecimal characters.');
 const terms=[...new Set(task.terms.map(term=>term.trim()))];
 let job;
 try{job=await json(BASE,{method:'POST',body:JSON.stringify({terms,service:'breach',format:'jsonl',limit:1000,...(Object.keys(config).length?{query_config:config}:{})})})}
 catch(error){
  // Only rejected job creation can fall back. Never resubmit an accepted job,
  // bypass filters, or retry authentication / quota / server failures.
  if(![400,404,405,422].includes(error.status))throw error;
  progress?.('OathNet bulk unavailable; searching the same identifiers individually');
  const rows=[],started=now();let requests=0,limited=false;
  try{
   for(let index=0;index<terms.length;index++){
    let cursor='';const cursors=new Set();
    do{
     signal?.throwIfAborted();
     if(now()-started>180000)throw Error('OathNet individual searches timed out after 3 minutes.');
     if(requests++>=50){limited=true;break}
     const params=new URLSearchParams({q:terms[index],page_size:String(Math.min(100,1000-rows.length))});
     for(const [key,value] of Object.entries({...config,...extra})){
      if(key==='extra_params')continue;
      if(key==='filter')params.set(key,JSON.stringify(value));
      else if(Array.isArray(value))for(const entry of value)params.append(key.endsWith('[]')?key:key+'[]',String(entry));
      else params.set(key,String(value));
     }
     if(cursor)params.set('cursor',cursor);
     progress?.(`OathNet individual search ${index+1}/${terms.length}`);
     const result=await json(BASE.replace(/bulk-search$/,'breach/search')+'?'+params);
     if(!Array.isArray(result.items))throw Error('Unexpected OathNet response: data.items missing.');
     rows.push(...result.items.slice(0,1000-rows.length));
     const next=typeof result.next_cursor==='string'?result.next_cursor:'';
     if(next&&cursors.has(next))throw Error('OathNet returned a repeated search cursor.');
     if(next)cursors.add(next);cursor=next;
     if(rows.length>=1000){limited=true;break}
    }while(cursor);
    if(limited)break;
   }
  }catch(fallbackError){if(signal?.aborted)throw fallbackError;throw Error(`${error.message} Individual-search fallback failed: ${fallbackError.message}`)}
  return {items:rows.map(fields=>recordItem(fields,'OathNet · breach')),limited};
 }
 const id=String(job.job_id||job.id||'');if(!/^[a-z0-9_-]{1,160}$/i.test(id))throw Error('OathNet did not return a valid bulk job ID.');
 const started=now();
 while(job.status!=='completed'){
  signal?.throwIfAborted();
  if(['canceled','cancelled','failed','error','expired'].includes(job.status))throw Error('OathNet bulk job '+job.status+'.');
  if(now()-started>180000)throw Error('OathNet bulk job timed out after 3 minutes.');
  progress?.(`OathNet bulk ${job.status||'queued'}${Number.isFinite(job.progress?.percent)?' · '+Math.round(job.progress.percent)+'%':''}`);
  await wait(Math.max(300,Math.min(5000,Number(job.next_poll_after_ms)||1000)),undefined,{signal});
  job=await json(BASE+'/'+encodeURIComponent(id));
 }
 const rows=parseBulk(await boundedText(await request(BASE+'/'+encodeURIComponent(id)+'/download')));
 return {items:rows.slice(0,1000).map(fields=>recordItem(fields,'OathNet · breach')),limited:rows.length>=1000||Number(job.result?.records)>=1000};
}
async function runDeepSearch(plan,{signal=new AbortController().signal,key='',progress=()=>{},oath=oathBulk,brix=searchBrix,ghunt=searchGhunt}={}){
 validatePlan(plan);let next=0,completed=0,limited=false;const items=new Map(),warnings=[];
 const pending=new Map(),requests=new Set();const maxRecords=plan.longSearch?Infinity:MAX_RECORDS;
 const collect=item=>{if(!items.has(item.id))pending.set(item.id,item);items.set(item.id,item)};
 const emit=message=>{const found=[...pending.values()];pending.clear();progress({completed,total:plan.tasks.length,records:items.size,message,...(found.length?{items:found}:{})})};
 emit('Starting deep search');
 await Promise.all(Array.from({length:Math.min(2,plan.tasks.length)},async()=>{
  while(next<plan.tasks.length&&!signal.aborted){
   const index=next++;let task=plan.tasks[index];const label=task.provider==='oathnet'?'OathNet bulk':task.provider==='ghunt'?'GHunt':'BrixHub';
   if(task.provider==='oathnet'){
    const context=JSON.stringify(stable({...task,terms:undefined,filtered:undefined}));
    const terms=task.terms.map(term=>term.trim()).filter(term=>{const id=context+'\0'+term;if(requests.has(id))return false;requests.add(id);return true});
    if(!terms.length){completed++;continue}task={...task,terms};
   }else{
    const taskKey=task.provider==='ghunt'?'ghunt:'+task.query.trim().toLowerCase():JSON.stringify(stable({...task,filtered:undefined}));if(requests.has(taskKey)){completed++;continue}requests.add(taskKey);
   }
   try{
    if(task.provider==='ghunt'){
     const result=await ghunt({query:task.query,settings:task.settings||{},signal});
     for(const item of result.items){if(items.size>=maxRecords){limited=true;break}collect({...recordItem(item.fields,item.source),profileType:item.profileType})}
     if(result.notice)warnings.push('GHunt: '+result.notice);
    }else if(task.provider==='oathnet'){
     const result=await oath(task,key,{signal,progress:emit});limited||=!!result.limited;
     for(const item of result.items){if(items.size>=maxRecords){limited=true;break}const cleaned=recordItem(item.fields,item.source);collect(cleaned)}
    }else{
     let page=1;const pageResults=new Set();while((plan.longSearch||page<=plan.pages)&&!signal.aborted){
      const result=await brix({query:task.query,terms:{[task.field]:task.query},signal,settings:{brixFilters:task.filters,flexible:false,pageSize:100,page}});
      const fingerprint=JSON.stringify(stable(result.items.map(item=>item.fields)));if(pageResults.has(fingerprint)){if(plan.longSearch)warnings.push('BrixHub repeated a page; pagination stopped.');break}pageResults.add(fingerprint);
      for(const item of result.items){if(items.size>=maxRecords){limited=true;break}const cleaned=recordItem(item.fields,'BrixHub');collect(cleaned)}
      emit('BrixHub page '+page+' received');
      const hasMore=result.meta?.pages!=null?Number(result.meta.pages)>page:result.meta?.total!=null?Number(result.meta.total)>page*100:result.items.length===100;
      if(!hasMore)break;
      if(!plan.longSearch&&page===plan.pages){limited=true;break}page++;
     }
    }
   }catch(error){if(!signal.aborted)warnings.push(`${label} ${task.filtered?'filtered':'unfiltered'} task ${index+1}: ${error.message||'Search failed.'}`)}
   finally{completed++;emit(label+' task finished')}
   if(items.size>=maxRecords){limited=true;break}
  }
 }));
 return {items:[...items.values()],completed,total:plan.tasks.length,canceled:signal.aborted,warnings:[...new Set(warnings)],limited};
}
function registerDeepSearch({ipcMain,key,log=async()=>{}}){
 const runs=new Map();
 ipcMain.handle('people:deep-search',async(event,payload)=>{
  const sender=event.sender,owner=sender.id;if(runs.has(owner))throw Error('A deep search is already running.');
  if(typeof payload?.runId!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(payload.runId))throw Error('Invalid deep-search run.');validatePlan(payload.plan);
  const controller=new AbortController(),abort=()=>controller.abort();runs.set(owner,{runId:payload.runId,controller});sender.once('destroyed',abort);
  try{const result=await runDeepSearch(payload.plan,{signal:controller.signal,key:payload.plan.tasks.some(t=>t.provider==='oathnet')?await key():'',progress:p=>{if(!sender.isDestroyed())sender.send('people:deep-progress',{...p,runId:payload.runId})}});await log('People deep search completed',`${result.items.length} records · ${result.completed}/${result.total} tasks`,{scope:'people'});return result}
  finally{sender.removeListener('destroyed',abort);runs.delete(owner)}
 });
 ipcMain.handle('people:deep-cancel',(event,payload)=>{const run=runs.get(event.sender.id);if(!run||run.runId!==payload?.runId)return false;run.controller.abort();return true});
}
module.exports={validatePlan,cleanRecord,recordItem,parseBulk,oathBulk,runDeepSearch,registerDeepSearch};
