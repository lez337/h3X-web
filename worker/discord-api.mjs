import providers from '../electron/providers.cjs';
import profiles from '../electron/oath-profiles.cjs';
import {resolveApiKey} from './accounts.mjs';

const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
export function discordIdentity(body){
  if(typeof body?.userId!=='string'||!/^\d{14,20}$/.test(body.userId))throw Error('A Discord user ID must be a string of 14-20 digits.');
  if(typeof body.username!=='string'||!/^\S{2,32}$/.test(body.username)||/[\x00-\x1f\x7f]/.test(body.username))throw Error('Enter a Discord username of 2-32 characters.');
  if(body.connectedUsernames!==undefined){
    if(!Array.isArray(body.connectedUsernames)||body.connectedUsernames.length>10||body.connectedUsernames.some(name=>typeof name!=='string'||!name.trim()||name.length>100||/[\x00-\x1f\x7f]/.test(name)))throw Error('Choose up to 10 connected account names, each up to 100 characters.');
    const connectedUsernames=[...new Map(body.connectedUsernames.map(name=>[name.trim().toLowerCase(),name.trim()])).values()].filter(name=>name.toLowerCase()!==body.username.toLowerCase());
    return {userId:body.userId,username:body.username,connectedUsernames};
  }
  return {userId:body.userId,username:body.username};
}
export async function lookupDiscord(identity,env,signal,lookup=async task=>{
  if(task.kind==='profile')return profiles.searchProfile({profileKind:'discord',parameter:'discord_id',query:identity.userId,signal},env.OATHNET_API_KEY);
  if(task.provider==='oathnet')return providers.searchOath({query:task.query,settings:{oathFamily:task.family,pageSize:20},signal},env.OATHNET_API_KEY);
  return providers.searchBrix({query:task.query,terms:{[task.field]:task.query},settings:{pageSize:20,redaction:true},signal});
}){
  const tasks=[{kind:'id',query:identity.userId,field:'discord_id'},{kind:'username',query:identity.username,field:'nom_utilisateur'}];
  const connected=identity.connectedUsernames||[];
  for(const name of connected)tasks.push({kind:'connected',query:name,field:'nom_utilisateur'});
  if(env.OATHNET_API_KEY){
    for(const family of ['breach','stealer'])for(const [kind,value] of [['id',identity.userId],['username',identity.username]])tasks.push({provider:'oathnet',kind,query:value,family});
    for(const family of ['breach','stealer'])for(const name of connected)tasks.push({provider:'oathnet',kind:'connected',query:name,family});
    tasks.push({kind:'profile'});
  }
  // Bound outgoing concurrency when optional connected account names are included.
  const outcomes=new Array(tasks.length);let next=0;
  await Promise.all(Array.from({length:Math.min(4,tasks.length)},async()=>{
    while(next<tasks.length){const i=next++;try{signal.throwIfAborted();outcomes[i]={status:'fulfilled',value:await lookup(tasks[i])}}catch(reason){outcomes[i]={status:'rejected',reason}}}
  }));
  const items=[],seen=new Set(),providerStatus=[];
  outcomes.forEach((result,index)=>{
    const task=tasks[index],label=task.kind==='connected'?`connected (${task.query})`:task.kind,source=task.kind==='profile'?'OathNet Discord':task.provider==='oathnet'?`OathNet ${task.family} ${label}`:'BrixHub '+label;
    providerStatus.push({source,status:result.status==='fulfilled'?'complete':'error',count:result.status==='fulfilled'?result.value.items.length:0});
    if(result.status==='fulfilled')for(const item of result.value.items){
      const fields=providers.mask(item.fields),signature=JSON.stringify([item.source,fields]);
      if(seen.has(signature))continue;seen.add(signature);
      items.push({...item,id:'discord-'+items.length,fields,matchedBy:task.kind,matchedQuery:task.query||identity.userId,matchNote:task.kind==='connected'?`Linked account name match (${task.query}); verify identity before drawing conclusions.`:task.kind==='username'?'Username match; verify identity before drawing conclusions.':'ID lookup result'});
    }
  });
  if(!env.OATHNET_API_KEY)providerStatus.push({source:'OathNet',status:'skipped',count:0,message:'Configure the OATHNET_API_KEY Worker secret to enable OathNet searches.'});
  const notices=['Username matches can refer to different people.'];
  if(providerStatus.some(p=>p.status==='error'))notices.push('Some providers failed. Results may be incomplete.');
  if(!env.OATHNET_API_KEY)notices.push('OathNet was not searched: configure the OATHNET_API_KEY Worker secret.');
  return {...identity,items,providerStatus,notice:notices.join(' '),quota:'No H3X call quota. Hosting and upstream limits apply.'};
}
export async function discordApi(request,env,readBody){
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const account=await resolveApiKey(request,env);
  if(!account)return json({error:'Invalid or revoked H3X API key.'},401);
  try{
    const identity=discordIdentity(await readBody(request,4096));
    return json(await lookupDiscord(identity,env,AbortSignal.any([request.signal,AbortSignal.timeout(identity.connectedUsernames?.length?240000:45000)])));
  }catch(error){return json({error:error.message||'Discord search failed.'},400);}
}
