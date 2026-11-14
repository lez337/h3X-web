'use strict';
const net = require('node:net');
const {inspectQuery}=require('./search-query.cjs');
const OATH_BASE='https://oathnet.org/api/service/v2';
const BRIX_URL='https://api.brixhub.ru/api/v1/search';
const BRIX_FIELDS=new Set(['nom_famille','prenom','nom_affichage','nom_utilisateur','email','telephone','mobile','adresse_ip','discord_id','ville','code_postal','departement','region','pays','societe','profession','fonction','nom_naissance','jour_naissance','mois_naissance','annee_naissance','date_naissance','ville_naissance','genre','adresse','steam_id','fivem_license','xbl','live_id','fivem_license2','nir','iban','bic','vin']);
const sensitiveKey=/password|passwd|secret|token|cookie|session|auth|api.?key|credit.?card|ssn|social.?security/i;
function mask(value,depth=0){
  if(depth>16)return null;
  if(Array.isArray(value))return value.slice(0,1000).map(entry=>mask(entry,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,sensitiveKey.test(key)?'[redacted]':mask(entry,depth+1)]));
  return value;
}
async function json(url,options={}){
  const response=await fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  let body='';
  if(response.body?.getReader){const reader=response.body.getReader(),parts=[];let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>4*1024*1024){await reader.cancel();throw Error('Provider response exceeds 4 MB.')}parts.push(Buffer.from(part.value))}}finally{reader.releaseLock()}body=Buffer.concat(parts).toString('utf8')}
  else{body=await response.text();if(Buffer.byteLength(body)>4*1024*1024)throw Error('Provider response exceeds 4 MB.');}
  let data;try{data=JSON.parse(body)}catch{throw new Error(`Provider returned non-JSON (HTTP ${response.status}).`)}
  if(!response.ok)throw new Error(`Provider returned HTTP ${response.status}.`);
  return data;
}
function cleanQuery(query){const q=String(query||'').trim();if(!q||q.length>256||/[\u0000-\u001f]/.test(q))throw new Error('Enter one search term (up to 256 characters).');return q;}
function rows(items,source){const rowsList=items.slice(0,100).filter(v=>v&&typeof v==='object');for(let i=0;i<rowsList.length;i++){const v=mask(rowsList[i]);const extra=/stealer/i.test(source)&&typeof v.log_id==='string'?{logId:v.log_id}:{};rowsList[i]={id:`${source}-${i}`,source,...extra,fields:v}}return rowsList;}
function detectField(query,type='auto'){return inspectQuery(query,type).field;}
function validateFilter(tree){
  let leaves=0;
  function visit(node,depth){
    if(!node||typeof node!=='object'||Array.isArray(node))throw Error('OathNet filter must contain objects.');
    const groups=['and','or'].filter(k=>k in node);
    if(groups.length){if(groups.length!==1||'field' in node||depth>=2||!Array.isArray(node[groups[0]])||!node[groups[0]].length)throw Error('Invalid OathNet filter group (maximum nesting: 2).');node[groups[0]].forEach(n=>visit(n,depth+1));return;}
    if(++leaves>50)throw Error('OathNet allows at most 50 filter rules.');
    if(typeof node.field!=='string'||!node.field.trim()||!['eq','neq','in','not_in','contains','starts_with','ends_with','wildcard','gt','gte','lt','lte','exists'].includes(node.operator))throw Error('Invalid OathNet field or operator.');
    if(node.operator==='exists'){if(node.value!==undefined&&typeof node.value!=='boolean')throw Error('EXISTS requires a boolean.');}
    else if(['in','not_in'].includes(node.operator)){if(!Array.isArray(node.value)||!node.value.length||node.value.some(v=>typeof v!=='string'))throw Error('IN / NOT IN require a non-empty string array.');}
    else if(typeof node.value!=='string'||!node.value.length)throw Error('OathNet filter values must be strings.');
    if(['contains','starts_with','ends_with','wildcard'].includes(node.operator)&&/^(ip|date_birth|indexed_at|pwned_at)$/.test(node.field))throw Error('Pattern operators cannot be used on date or IP fields.');
    if(['contains','ends_with','wildcard'].includes(node.operator)&&node.value.replace(/[*?]/g,'').length<2)throw Error('Pattern filters need at least two non-wildcard characters.');
  }
  visit(tree,0);
}
async function searchOath({query,settings,signal},key){
  if(!['breach','stealer'].includes(settings?.oathFamily)){
    const outcomes=await Promise.allSettled(['breach','stealer'].map(oathFamily=>searchOath({query,signal,settings:{...settings,oathFamily,cursor:undefined}},key)));
    const successful=outcomes.filter(x=>x.status==='fulfilled').map(x=>x.value);
    if(!successful.length)throw outcomes[0].reason;
    const datasets=outcomes.map((outcome,i)=>({family:['breach','stealer'][i],status:outcome.status==='fulfilled'?'complete':'error',count:outcome.status==='fulfilled'?outcome.value.items.length:0,message:outcome.status==='rejected'?String(outcome.reason?.message||'Lookup failed.'):''}));
    const failures=datasets.filter(x=>x.status==='error');
    return {items:successful.flatMap(x=>x.items),meta:{datasets},notice:failures.length?failures.map(x=>`OathNet ${x.family} unavailable: ${x.message}`).join(' · '):'Breach and stealer datasets searched'};
  }

  if(!key)throw new Error('Add an OathNet API key in Settings.');
  if(settings?.oathOptions?.filter_id&&!/^[a-f0-9]{24}$/i.test(settings?.oathOptions?.filter_id))throw Error('OathNet filter ID must be 24 hexadecimal characters.');
  if(!String(query||'').trim()&&!Object.values(settings?.oathFilters||{}).some(v=>Array.isArray(v)?v.length:typeof v==='object'&&v?Object.keys(v).length:!!String(v||'').trim()))throw Error('Enter a query or at least one OathNet filter.');
  const family=settings?.oathFamily==='stealer'?'stealer':'breach';
  const params=new URLSearchParams({...String(query||'').trim()?{q:cleanQuery(query)}:{},page_size:String(Math.min(100,Math.max(1,Number(settings?.pageSize)||20)))});
  for(const [k,v] of Object.entries(settings?.oathOptions||{}))if(['sort','from','to','date_field','logic','cursor','filter_id','search_id','view','wildcard','has_log_id'].includes(k)&&v!==''&&v!=null)params.set(k,String(v));
  for(const [k,v] of Object.entries(settings?.oathFilters||{})){
    if(['q','cursor','page_size'].includes(k)||v==null||v==='')continue;
    if(k==='filter'){const tree=typeof v==='string'?JSON.parse(v):v;if(Object.keys(tree).length){validateFilter(tree);params.set(k,JSON.stringify(tree));}}
    else if(Array.isArray(v))for(const entry of v)params.append(k.endsWith('[]')?k:k+'[]',String(entry));
    else if(typeof v!=='object')params.set(k,String(v));
  }
  if(settings?.cursor)params.set('cursor',String(settings.cursor).slice(0,512));
  const data=await json(`${OATH_BASE}/${family}/search?${params}`,{headers:{'x-api-key':key},signal});
  if(data.success===false)throw new Error(String(data.message||'OathNet rejected the search.'));
  const payload=data.data||data;
  if(!Array.isArray(payload.items))throw new Error('Unexpected OathNet response: data.items missing.');
  return {items:rows(payload.items,`OathNet · ${family}`),meta:{total:payload.meta?.total??null,nextCursor:payload.next_cursor||null},notice:'OathNet V2 search'};
}
async function searchBrix({query,settings,terms:explicitTerms,signal}){
  if(settings?.brixNameSearch&&!explicitTerms)return searchBrixNames({query,settings,signal});
  const filtersOnly=!String(query||'').trim();
  const info=filtersOnly?{field:'',query:''}:inspectQuery(query,settings?.searchQueryType||'auto');
  if(!explicitTerms&&info.type==='name')return searchBrixNames({query:'',settings,signal,name:info.query,dropDisplayFilter:false});
  const field=info.field;
  const q=filtersOnly?'':cleanQuery(info.query);
  const filters={};
  if(settings?.brixFilters&&typeof settings?.brixFilters==='object')for(const [k,v] of Object.entries(settings?.brixFilters))if(BRIX_FIELDS.has(k)&&String(v).trim())filters[k]=String(v).trim().slice(0,150);
  const nameParts=q.split(/\s+/);
  if(explicitTerms&&(!Object.keys(explicitTerms).length||Object.entries(explicitTerms).some(([k,v])=>!BRIX_FIELDS.has(k)||typeof v!=='string'||!v.trim()||v.length>150)))throw Error('Invalid BrixHub search terms.');
  const terms=explicitTerms||(filtersOnly?{}:(field==='nom_affichage'&&nameParts.length>1?{nom_famille:nameParts[0],prenom:nameParts.slice(1).join(' ')}:{[field]:q}));
  if(filtersOnly&&!Object.keys(filters).length&&!explicitTerms)throw Error('Enter a query or at least one BrixHub filter.');
  const body={...filters,...terms,page:Math.max(1,Number(settings?.page)||1),per_page:Math.min(100,Math.max(1,Number(settings?.pageSize)||20)),flexible:Boolean(settings?.flexible)};
  const data=await json(BRIX_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(data.status===false||data.success===false)throw new Error(String(data.message||'BrixHub rejected the search.'));
  if(!Array.isArray(data.data?.results))throw new Error('Unexpected BrixHub response: data.results missing.');
  return {items:rows(data.data.results,'BrixHub'),meta:{total:data.meta?.total??null,page:data.meta?.page??body.page,pages:data.meta?.pages??null},notice:'BrixHub public API · temporary endpoint'};
}
async function searchBrixNames({query,settings,signal,name:requestedName,dropDisplayFilter=true}){
  const name=String(requestedName??settings.brixNameSearch).trim().replace(/\s+/g,' ');
  if(!name||name.length>150||/[\u0000-\u001f]/.test(name))throw Error('Enter a name up to 150 characters.');
  const filters={...settings.brixFilters};
  // The slash command's display-name value represents OR across name fields.
  // Keep all other explicit filters as AND constraints on every request.
  if(dropDisplayFilter)delete filters.nom_affichage;
  if(String(query||'').trim()){
    const info=inspectQuery(query,settings?.searchQueryType||'auto');
    filters[info.field]=info.query;
  }
  const candidates=['nom_affichage','prenom','nom_famille','nom_naissance','nom_utilisateur'].map(field=>({[field]:name}));
  const parts=name.split(' ');
  for(let split=1;split<parts.length;split++){
    const left=parts.slice(0,split).join(' '),right=parts.slice(split).join(' ');
    candidates.push({prenom:left,nom_famille:right},{prenom:right,nom_famille:left});
  }
  const plans=[],seenPlans=new Set();
  for(const terms of candidates){
    if(Object.entries(terms).some(([key,value])=>filters[key]&&String(filters[key]).trim().toLowerCase()!==value.toLowerCase()))continue;
    const signature=JSON.stringify(Object.entries(terms).sort(([a],[b])=>a.localeCompare(b)));
    if(!seenPlans.has(signature)){seenPlans.add(signature);plans.push(terms)}
  }
  const outcomes=new Array(plans.length);let next=0;
  await Promise.all(Array.from({length:Math.min(3,plans.length)},async()=>{
    while(next<plans.length&&!signal?.aborted){
      const index=next++;
      try{outcomes[index]={result:await searchBrix({query,terms:plans[index],settings:{...settings,brixNameSearch:undefined,brixFilters:filters},signal})}}
      catch(error){outcomes[index]={error}}
    }
  }));
  const completed=outcomes.filter(value=>value?.result);
  if(!completed.length)throw outcomes.find(value=>value?.error)?.error||signal?.reason||Error('No BrixHub name searches completed.');
  function canonical(value){
    if(Array.isArray(value))return value.map(canonical);
    if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
    return value;
  }
  const seen=new Set(),items=[];
  for(const {result} of completed)for(const item of result.items){
    const signature=JSON.stringify(canonical(item.fields));
    if(!seen.has(signature)){seen.add(signature);items.push({...item,id:'BrixHub-'+items.length})}
  }
  const failures=outcomes.filter(value=>value?.error).length;
  return {items,meta:{total:null,page:Math.max(1,Number(settings.page)||1),pages:Math.max(1,...completed.map(({result})=>Number(result.meta?.pages)||1)),nameSearches:completed.length,nameSearchErrors:failures},notice:`BrixHub: searched all name fields and both first/last name orders.${failures?` ${failures} name searches failed; completed results retained.`:''}`};
}
async function searchGithub({query,signal}){
  const q=cleanQuery(query).replace(/^@/,'');
  if(!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(q))throw new Error('GitHub lookup requires a username.');
  const data=await json(`https://api.github.com/users/${encodeURIComponent(q)}`,{headers:{'User-Agent':'H3X-Searcher','Accept':'application/vnd.github+json'},signal});
  return {items:rows([{login:data.login,name:data.name,public_repos:data.public_repos,followers:data.followers,created_at:data.created_at,html_url:data.html_url,bio:data.bio}],'GitHub'),meta:{total:1},notice:'Public GitHub profile; verify identity independently'};
}
async function searchRdap({query,signal}){
  const q=cleanQuery(query);const kind=net.isIP(q)?'ip':'domain';
  if(kind==='domain'&&!/^(?:[a-z\d-]+\.)+[a-z]{2,}$/i.test(q))throw new Error('RDAP lookup requires a domain or IP address.');
  const data=await json(`https://rdap.org/${kind}/${encodeURIComponent(q)}`,{signal});
  return {items:rows([{name:data.ldhName||data.handle||q,status:data.status,events:data.events,nameservers:data.nameservers?.map(x=>x.ldhName),links:data.links?.filter(x=>x.rel==='self').map(x=>x.href)}],'RDAP'),meta:{total:1},notice:'Public registration data; availability varies by registry'};
}
module.exports={mask,validateFilter,detectField,searchOath,searchBrix,searchGithub,searchRdap,BRIX_FIELDS};
