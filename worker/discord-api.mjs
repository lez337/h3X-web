import providers from '../electron/providers.cjs';
import profiles from '../electron/oath-profiles.cjs';
import {resolveApiKey} from './accounts.mjs';

const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
export function discordIdentity(body){
  if(typeof body?.userId!=='string'||!/^\d{14,20}$/.test(body.userId))throw Error('A Discord user ID must be a string of 14-20 digits.');
  if(typeof body.username!=='string'||!/^\S{2,32}$/.test(body.username)||/[\x00-\x1f\x7f]/.test(body.username))throw Error('Enter a Discord username of 2-32 characters.');
  return {userId:body.userId,username:body.username};
}
export async function lookupDiscord(identity,env,signal,lookup=async task=>{
  if(task.kind==='profile')return profiles.searchProfile({profileKind:'discord',parameter:'discord_id',query:identity.userId,signal},env.OATHNET_API_KEY);
  return providers.searchBrix({query:task.query,terms:{[task.field]:task.query},settings:{pageSize:20,redaction:true},signal});
}){
  const tasks=[{kind:'id',query:identity.userId,field:'discord_id'},{kind:'username',query:identity.username,field:'nom_utilisateur'}];
  if(env.OATHNET_API_KEY)tasks.push({kind:'profile'});
  const outcomes=await Promise.allSettled(tasks.map(lookup)),items=[],seen=new Set(),providerStatus=[];
  outcomes.forEach((result,index)=>{
    const task=tasks[index],source=task.kind==='profile'?'OathNet Discord':'BrixHub '+task.kind;
    providerStatus.push({source,status:result.status==='fulfilled'?'complete':'error',count:result.status==='fulfilled'?result.value.items.length:0});
    if(result.status==='fulfilled')for(const item of result.value.items){
      const fields=providers.mask(item.fields),signature=JSON.stringify([item.source,fields]);
      if(seen.has(signature))continue;seen.add(signature);
      items.push({...item,id:'discord-'+items.length,fields,matchedBy:task.kind,matchNote:task.kind==='username'?'Username match; verify identity before drawing conclusions.':'ID lookup result'});
    }
  });
  return {...identity,items,providerStatus,notice:providerStatus.some(p=>p.status==='error')?'Some providers failed. Results may be incomplete.':'Username matches can refer to different people.',quota:'No H3X call quota. Hosting and upstream limits apply.'};
}
export async function discordApi(request,env,readBody){
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const account=await resolveApiKey(request,env);
  if(!account)return json({error:'Invalid or revoked H3X API key.'},401);
  try{
    const identity=discordIdentity(await readBody(request,4096));
    return json(await lookupDiscord(identity,env,AbortSignal.any([request.signal,AbortSignal.timeout(45000)])));
  }catch(error){return json({error:error.message||'Discord search failed.'},400);}
}
