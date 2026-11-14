'use strict';

const EMAIL=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
function extractEmails(query,items=[]){
 const found=new Map();
 function add(value){
  if(Array.isArray(value)){value.forEach(add);return}
  if(typeof value!=='string')return;
  for(const part of value.split(/[,;\s]+/)){const email=part.trim();if(email.length<=254&&EMAIL.test(email))found.set(email.toLowerCase(),email)}
 }
 add(query);
 function visit(value,depth=0){
  if(!value||typeof value!=='object'||depth>8)return;
  if(Array.isArray(value)){value.forEach(v=>visit(v,depth+1));return}
  for(const [key,entry] of Object.entries(value)){
   if(/password|cookie|token|secret|session|auth|output|response/i.test(key))continue;
   if(/^(?:e_?mails?|email_addresses|email_address|mail|mails|adresse_email|adresses_email)$/i.test(key.replace(/[\s.-]/g,'_')))add(entry);
   else if(entry&&typeof entry==='object')visit(entry,depth+1);
  }
 }
 for(const item of items)if(!/stealer|ghunt/i.test(item.source||''))visit(item.fields);
 return [...found.values()];
}
const {supportsRoblox,profileTargets}=require('./oath-profiles.cjs');
const freeProviders=require('./free-providers.cjs');
const {inspectQuery}=require('./search-query.cjs');
async function searchWorkflow(payload,search){
 if(!payload||!Array.isArray(payload.providers)||payload.providers.length>50||payload.providers.some(p=>typeof p!=='string'))throw Error('Choose up to 50 providers.');
 const filtersOnly=!String(payload.query||'').trim();
 const detected=filtersOnly?{query:'',type:'text'}:inspectQuery(payload.query,payload.settings?.searchQueryType||'auto');
 const originalQuery=payload.query;
 payload={...payload,query:detected.query,settings:{...payload.settings,searchQueryType:detected.type}};
 const queryInfo=filtersOnly?{types:[]}:freeProviders.queryInfo(payload.query,detected.type);
 const selected=[...new Set(payload.providers||[])];
 const tasks=selected.filter(p=>p!=='ghunt'&&p!=='whatsmyname').concat(selected.includes('whatsmyname')?['whatsmyname']:[]);
 // Keep the result order stable while limiting fan-out across public services.
 const outcomes=new Array(tasks.length);let taskIndex=0;
 await Promise.all(Array.from({length:Math.min(4,tasks.length)},async()=>{
  while(taskIndex<tasks.length&&!payload.signal?.aborted){const i=taskIndex++,provider=tasks[i];
   const incompatible=filtersOnly&&!['oathnet','brixhub'].includes(provider)||(['whatsmyname','github'].includes(provider)&&detected.type!=='username')||(provider==='rdap'&&!['domain','ip'].includes(detected.type));
   if(incompatible||freeProviders.registry.has(provider)&&!freeProviders.supports(provider,queryInfo)){
    outcomes[i]={status:'fulfilled',value:{items:[],meta:{skipped:true,reason:'Query type does not match this provider.'}}};continue;
   }
   if(provider==='whatsmyname')continue;
   try{outcomes[i]={status:'fulfilled',value:await search({...payload,provider})}}catch(reason){outcomes[i]={status:payload.signal?.aborted?'canceled':'rejected',reason}}
  }
 }));
 const items=[],warnings=[];let successes=0;const metas=[];
 const providerStatus=[];
 outcomes.forEach((outcome,i)=>{
  if(!outcome)return;
  const name=tasks[i]==='whatsmyname'?'Username search':freeProviders.registry.get(tasks[i])?.label||tasks[i];
  if(outcome.status==='canceled'){providerStatus.push({id:tasks[i],label:name,status:'skipped',count:0,message:'Search stopped.'})}
  else if(outcome.status==='rejected'){const message=String(outcome.reason?.message||'Lookup failed.');warnings.push(name+': '+message);providerStatus.push({id:tasks[i],label:name,status:'error',count:0,message})}
  else if(outcome.value.meta?.skipped)providerStatus.push({id:tasks[i],label:name,status:'skipped',count:0,message:outcome.value.meta.reason});
  else{successes++;items.push(...outcome.value.items);if(tasks[i]!=='oathRoblox')metas.push(outcome.value.meta||{});if(outcome.value.notice)warnings.push(outcome.value.notice);if(tasks[i]==='oathnet'&&Array.isArray(outcome.value.meta?.datasets)){for(const dataset of outcome.value.meta.datasets)providerStatus.push({id:`oathnet-${dataset.family}`,label:`OathNet ${dataset.family}`,status:dataset.status,count:dataset.count,message:dataset.message})}else providerStatus.push({id:tasks[i],label:name,status:'complete',count:outcome.value.items.length,cached:!!outcome.value.meta?.cached,limited:!!outcome.value.meta?.limited,message:outcome.value.notice||''})}
 });
 let profilesChecked=0;
 if(!payload.signal?.aborted&&selected.includes('oathnet')&&payload.settings?.oathProfiles!==false){
  const targets=profileTargets(payload.query,items,payload.settings);profilesChecked=Math.min(targets.length,12);
  if(targets.length>12)warnings.push('OathNet checked the first 12 unique account identifiers. Search an identifier directly to check another.');
  let next=0;
  const profiles=await Promise.all(Array.from({length:Math.min(3,profilesChecked)},async()=>{
   const results=[];
   while(next<profilesChecked&&!payload.signal?.aborted){const index=next++,target=targets[index];try{results.push({index,result:await search({...payload,provider:'oathProfile',profileKind:target.kind,parameter:target.parameter,query:target.query})})}catch(error){if(!payload.signal?.aborted)results.push({index,error})}}
   return results;
  }));
  const ids=new Set(items.map(item=>item.id));
  for(const outcome of profiles.flat().sort((a,b)=>a.index-b.index)){
   if(outcome.error)warnings.push(`OathNet ${targets[outcome.index].kind}: ${outcome.error.message}`);
   else{successes++;for(const item of outcome.result.items)if(!ids.has(item.id)){ids.add(item.id);items.push(item)}if(outcome.result.notice)warnings.push(outcome.result.notice)}
  }
 }
 let emailCount=0;
 if(!payload.signal?.aborted&&selected.includes('ghunt')){
  const emails=extractEmails(payload.query,items);emailCount=Math.min(emails.length,10);
  if(!emails.length)warnings.push('GHunt skipped: no email addresses in the query or email fields of the results.');
  if(emails.length>10)warnings.push('GHunt checked the first 10 unique emails. Search another email directly to check it.');
  let next=0;
  const ghunt=await Promise.all(Array.from({length:Math.min(2,emailCount)},async()=>{
   const results=[];
   while(next<emailCount&&!payload.signal?.aborted){const index=next++;try{results.push({index,result:await search({...payload,provider:'ghunt',query:emails[index]})})}catch(error){if(!payload.signal?.aborted)results.push({index,error})}}
   return results;
  }));
  for(const outcome of ghunt.flat().sort((a,b)=>a.index-b.index)){
   if(outcome.error)warnings.push(`GHunt email ${outcome.index+1}: ${outcome.error.message}`);
   else{successes++;items.push(...outcome.result.items);if(outcome.result.notice)warnings.push(outcome.result.notice)}
  }
 }
 if(selected.includes('whatsmyname')&&detected.type==='username'&&!payload.signal?.aborted){
  try{const result=await search({...payload,provider:'whatsmyname'});items.push(...result.items);metas.push(result.meta||{});successes++;providerStatus.push({id:'whatsmyname',label:'Username search',status:'complete',count:result.items.length});if(result.notice)warnings.push(result.notice)}catch(error){const message=error.message||'Username search failed.';warnings.push(message);providerStatus.push({id:'whatsmyname',label:'Username search',status:'error',count:0,message})}
 }
 if(!payload.signal?.aborted&&!successes&&warnings.length&&emailCount)throw Error([...new Set(warnings)].join(' · '));
 if(!payload.signal?.aborted&&!successes&&tasks.length&&warnings.length)throw Error([...new Set(warnings)].join(' · '));
 return {query:originalQuery,items,meta:{queryType:detected.type,...(metas.length===1?metas[0]:{}),canceled:!!payload.signal?.aborted,providerStatus,profilesChecked,emailsChecked:emailCount,usernameRun:metas.find(meta=>meta.usernameRun)?.usernameRun},notice:payload.signal?.aborted?'Search stopped; completed results retained.':[...new Set(warnings)].join(' · ')};
}
module.exports={extractEmails,supportsRoblox,searchWorkflow};
