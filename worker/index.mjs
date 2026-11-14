import {setTimeout as delay} from 'node:timers/promises';
import providers from '../electron/providers.cjs';
import freeProviders from '../electron/free-providers.cjs';
import profiles from '../electron/oath-profiles.cjs';
import workflow from '../electron/search-workflow.cjs';
import query from '../electron/search-query.cjs';
import deep from '../electron/people-deep.cjs';
import geo from '../electron/geocoding.cjs';
import {getCatalog,selection,checkBatch} from './username.mjs';
import {createHostedReport,reportRoute,forwardReport} from './reports.mjs';
export {InvestigationReport} from './reports.mjs';
import {accountAuth,resolveAccount,accountWorkspace,accountReports,rotateAccountKey} from './accounts.mjs';
export {H3xAccount} from './accounts.mjs';
import {withLinkPreview} from './link-preview.mjs';

const encoder=new TextEncoder();
const credentials=['oathnet',...freeProviders.catalog.filter(p=>p.credential).map(p=>p.id)];
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200,extra={})=>Response.json(value,{status,headers:{...headers,...extra}});
function redact(value,keys){
  if(typeof value==='string'){for(const key of Object.values(keys))if(key.length>=4)value=value.split(key).join('[redacted]');return value;}
  if(Array.isArray(value))return value.map(entry=>redact(entry,keys));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,redact(entry,keys)]));
  return value;
}
export async function readBody(request,max=1024*1024){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('JSON content type required.');
  if(Number(request.headers.get('content-length'))>max)throw Error(`Request exceeds ${max/1024/1024} MB.`);
  const reader=request.body?.getReader();if(!reader)throw Error('Request body required.');
  const parts=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>max){await reader.cancel();throw Error(`Request exceeds ${max/1024/1024} MB.`)}parts.push(part.value)}}finally{reader.releaseLock()}
  const data=new Uint8Array(bytes);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length}
  return JSON.parse(new TextDecoder().decode(data));
}
function userKeys(payload,env){
  const input=payload.credentials||{},keys={};
  for(const id of credentials){const value=input[id]??(id==='oathnet'?env.OATHNET_API_KEY:env['PROVIDER_'+id.toUpperCase()]);
    if(value!=null&&(typeof value!=='string'||value.length>1024||/[\r\n\x00]/.test(value)))throw Error('Invalid provider key.');
    keys[id]=value||'';
  }return keys;
}
export function streamOperation(request,operation,sanitize=value=>value){
  const abort=new AbortController();
  const disconnected=()=>abort.abort();request.signal.addEventListener('abort',disconnected,{once:true});
  if(request.signal.aborted)abort.abort();
  let heartbeat;
  const stream=new ReadableStream({
    start(controller){
      const emit=(type,data)=>{if(!abort.signal.aborted)controller.enqueue(encoder.encode(JSON.stringify({type,data:sanitize(data)})+'\n'))};
      heartbeat=setInterval(()=>emit('ping',null),15000);
      Promise.resolve().then(()=>operation(abort.signal,emit)).then(result=>emit('result',result),error=>emit('error',{message:error.message||'Operation failed.'})).finally(()=>{
        clearInterval(heartbeat);request.signal.removeEventListener('abort',disconnected);if(!abort.signal.aborted)controller.close();
      });
    },
    cancel(){clearInterval(heartbeat);request.signal.removeEventListener('abort',disconnected);abort.abort();}
  });
  return new Response(stream,{headers:{...headers,'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'}});
}
export function searchProvider(keys,signal,free=freeProviders.createFreeProviders()){
  return async payload=>{
    signal.throwIfAborted();
    const options={...payload,settings:payload.settings||{},signal};
    switch(payload.provider){
      case 'oathnet': return providers.searchOath(options,keys.oathnet);
      case 'oathProfile': return profiles.searchProfile(options,keys.oathnet);
      case 'brixhub': return providers.searchBrix(options);
      case 'github': return providers.searchGithub(options);
      case 'rdap': return providers.searchRdap(options);
      case 'ghunt': case 'telegram': throw Error('This integration requires the Windows desktop application.');
      default: if(freeProviders.registry.has(payload.provider))return free.search(options,keys[payload.provider]);
    }throw Error('Unknown web provider.');
  };
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!path.startsWith('/api/'))return withLinkPreview(request,await env.ASSETS.fetch(request));
    try{
      const origin=request.headers.get('origin');
      if(origin&&origin!==new URL(request.url).origin)return json({error:'Origin rejected.'},403);
      if(request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Origin rejected.'},403);
      const shared=reportRoute(path);
      if(shared&&['content','access'].includes(shared.action)){
        if(request.method!=='GET')return json({error:'Method not allowed.'},405,{'Allow':'GET'});
        return await forwardReport(request,env,shared);
      }
      if(shared&&['unlock','lock'].includes(shared.action)){
        if(request.method!=='POST')return json({error:'Method not allowed.'},405,{'Allow':'POST'});
        return await forwardReport(request,env,shared,await readBody(request,1024));
      }
      if(path==='/api/session'&&request.method==='GET')return await accountAuth(request,env,path);
      if(['/api/accounts','/api/login','/api/logout'].includes(path)){
        if(request.method!=='POST')return json({error:'Method not allowed.'},405,{'Allow':'POST'});
        return await accountAuth(request,env,path,path==='/api/logout'?{}:await readBody(request,4096));
      }
      const account=await resolveAccount(request,env);
      if(!account)return json({error:'Sign in to use H3X.'},401);
      if(request.headers.has('X-H3X-Account')&&request.headers.get('X-H3X-Account')!==account.id)return json({error:'The signed-in account changed in another tab. Sign in again.'},401);
      if(path==='/api/workspace'){
        if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed.'},405,{'Allow':'GET, POST'});
        return await accountWorkspace(request,env,account,request.method==='POST'?await readBody(request,8*1024*1024+4096):undefined);
      }
      if(path==='/api/reports'&&request.method==='GET')return await accountReports(env,account,'list');
      if(request.method!=='POST')return json({error:'Method not allowed.'},405,{'Allow':'POST'});
      if(path==='/api/account/key')return await rotateAccountKey(env,account,await readBody(request,4096));
      if(path==='/api/reports')return await createHostedReport(await readBody(request,8*1024*1024),env,new URL(request.url).origin,account);
      if(shared&&['delete','discard'].includes(shared.action)){
        const response=await forwardReport(request,env,shared,await readBody(request,1024),account.id);
        if(response.ok||response.status===404){
          const removed=await accountReports(env,account,'remove',{id:shared.id});
          if(!removed.ok)return removed;
          if(response.status===404)return json({deleted:true});
        }
        return response;
      }
      if(shared&&shared.action==='activate')return await forwardReport(request,env,shared,await readBody(request,1024),account.id);
      if(path!=='/api/rpc')return json({error:'API route not found.'},404);
      const payload=await readBody(request),keys=userKeys(payload,env),p=payload.payload||{};
      switch(payload.action){
        case 'credentials': return json(Object.fromEntries(credentials.map(id=>[id,!!keys[id]])));
        case 'inspectQuery': return json(query.inspectQuery(p.query,p.type||'auto'));
        case 'providerMatches': {const info=freeProviders.queryInfo(p.query);return json(freeProviders.catalog.filter(provider=>freeProviders.supports(provider.id,info)).map(provider=>provider.id));}
        case 'geocode': return json(await geo.createGeocoder()(p.query,p.refresh));
        case 'usernameCatalog': if(p.refresh)throw Error('Catalog updates are shipped with web deployments.');return json(getCatalog().stats);
        case 'usernameSelect': return json(selection(p));
        case 'usernameBatch': return json(await checkBatch(p,request.signal));
        case 'search': return streamOperation(request,signal=>searchProvider(keys,signal)(p),value=>redact(value,keys));
        case 'searchBatch': {
          if(!Array.isArray(p.providers)||p.providers.length>4)throw Error('Choose up to four providers per web request.');
          return streamOperation(request,(signal,emit)=>workflow.searchWorkflow(p,async task=>{
            const result=await searchProvider(keys,signal)(task);emit('providerResult',{provider:task.provider,result});return result;
          }),value=>redact(value,keys));
        }
        case 'deepSearch': {
          deep.validatePlan(p.plan);
          if(p.plan.longSearch||p.plan.tasks.length!==1)throw Error('Web deep search accepts one bounded task per request.');
          return streamOperation(request,(signal,emit)=>deep.runDeepSearch(p.plan,{key:keys.oathnet,signal,
            oath:(task,key,options)=>{let requests=0;return deep.oathBulk(task,key,{...options,
              wait:(_ms,value,settings)=>delay(5000,value,settings),
              fetcher:(url,init)=>{if(++requests>40)throw Error('Web task request limit reached. Narrow the search.');return fetch(url,init)}
            })},
            progress:progress=>emit('deepProgress',{...progress,runId:p.runId})}),value=>redact(value,keys));
        }
        case 'stealerTree': throw Error('Stealer file trees are available only in the desktop application.');
        default: return json({error:'Unknown API operation.'},404);
      }
    }catch(error){return json({error:error instanceof SyntaxError?'Invalid JSON.':error.message||'Request failed.'},400);}
  }
};
