import {randomInt,timingSafeEqual,createHash} from 'node:crypto';
import exporter from '../electron/investigation-html.cjs';
import {accountReports} from './accounts.mjs';

const encoder=new TextEncoder();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_HTML=4*1024*1024,CHUNK=60*1024,LOCK_MS=15*60*1000,SESSION_MS=60*60*1000;
const baseHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{...baseHeaders,...headers}});
const hash=value=>createHash('sha256').update(value).digest('hex');
export const generateReportCode=(random=()=>randomInt(10000))=>String(random()).padStart(4,'0');
async function codeHash(code,salt){
  const key=await crypto.subtle.importKey('raw',encoder.encode(code),'PBKDF2',false,['deriveBits']);
  return Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Buffer.from(salt,'hex'),iterations:100000},key,256)).toString('hex');
}
function cookie(request){return (request.headers.get('cookie')||'').split(';').map(part=>part.trim()).find(part=>part.startsWith('h3x_report='))?.slice('h3x_report='.length)||'';}
function namespace(env,id){
  if(!env.INVESTIGATION_REPORTS)throw Error('Hosted reports are not configured. Deploy the updated Cloudflare configuration first.');
  return env.INVESTIGATION_REPORTS.get(env.INVESTIGATION_REPORTS.idFromName(id));
}
export async function createHostedReport(payload,env,origin,account){
  if(!payload?.record||typeof payload.record!=='object'||Array.isArray(payload.record)||!Array.isArray(payload.record.people||[]))return json({error:'Choose an investigation to export.'},400);
  if(payload.excluded!=null&&(!Array.isArray(payload.excluded)||payload.excluded.some(value=>typeof value!=='string')))return json({error:'Invalid export exclusions.'},400);
  // Generate trusted HTML on the server; clients cannot publish arbitrary scripts.
  const html=exporter.htmlReport(payload.record,payload.excluded,payload.settings||{});
  if(encoder.encode(html).length>MAX_HTML)return json({error:'The HTML report exceeds the 4 MB sharing limit.'},413);
  const id=crypto.randomUUID(),stub=namespace(env,id);
  const response=await stub.fetch(new Request('https://report.internal/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,html,ownerId:account.id})}));
  if(!response.ok)return response;
  const created=await response.json();
  const indexed=await accountReports(env,account,'add',{id,title:String(payload.record.title||'Untitled investigation').slice(0,200),createdAt:new Date().toISOString()});
  if(!indexed.ok)return indexed;
  return json({...created,url:new URL('/reports/'+id,origin).href},201);
}
export function reportRoute(path){const match=path.match(/^\/api\/reports\/([^/]+)\/(activate|discard|delete|unlock|content|lock|access)$/);return match&&UUID.test(match[1])?{id:match[1],action:match[2]}:null;}
export async function forwardReport(request,env,route,payload,ownerId){
  const target=new URL(request.url);target.pathname='/'+route.action;target.search='';
  const headers=new Headers();
  if(ownerId)headers.set('X-H3X-Report-Owner',ownerId);
  if(['content','lock'].includes(route.action))headers.set('Cookie',request.headers.get('Cookie')||'');
  const readOnly=['content','access'].includes(route.action);
  if(!readOnly)headers.set('Content-Type','application/json');
  const response=await namespace(env,route.id).fetch(new Request(target,{method:readOnly?'GET':'POST',headers,...readOnly?{}:{body:JSON.stringify(payload)}}));
  return response;
}

// One persistent object per UUID serializes guesses across clients and Worker isolates.
// The fetch-handler class API is intentionally used so Node regression tests can run it too.
export class InvestigationReport {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{
    try{return await this.handle(request)}catch{return json({error:'The report could not be processed. Please try again.'},500)}
  });}
  async handle(request){
    const path=new URL(request.url).pathname,storage=this.ctx.storage;
    const meta=await storage.get('meta');
    if(path==='/create'&&request.method==='POST'){
      if(meta)return json({error:'This report already exists.'},409);
      const {id,html,ownerId}=await request.json();
      if(!UUID.test(id)||typeof html!=='string'||encoder.encode(html).length>MAX_HTML)return json({error:'Invalid report.'},400);
      const code=generateReportCode(),salt=Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
      const data=encoder.encode(html),chunks=Math.ceil(data.length/CHUNK),pendingUntil=Date.now()+SESSION_MS;
      const entries={meta:{id,ownerId,active:false,salt,codeHash:await codeHash(code,salt),chunks,failed:0,lockedUntil:0,sessions:[],createdAt:Date.now(),pendingUntil}};
      for(let index=0;index<chunks;index++)entries['html:'+index]=data.slice(index*CHUNK,(index+1)*CHUNK);
      await storage.put(entries);await storage.setAlarm(pendingUntil);
      return json({id,code,active:false},201);
    }
    if(!meta||(!meta.active&&Date.now()>=meta.pendingUntil))return json({error:'This report is unavailable.'},404);
    if(path==='/delete'&&request.method==='POST'){
      if(!meta.ownerId||request.headers.get('X-H3X-Report-Owner')!==meta.ownerId)return json({error:'Only the report creator can delete this link.'},403);
      await storage.deleteAlarm();await storage.deleteAll();return json({deleted:true});
    }
    if(['/activate','/discard'].includes(path)&&meta.ownerId&&request.headers.get('X-H3X-Report-Owner')!==meta.ownerId)return json({error:'Only the report creator can activate or discard this link.'},403);
    if(path==='/activate'&&request.method==='POST'){
      const payload=await request.json();
      if(payload.access!==undefined&&!['public','protected'].includes(payload.access))return json({error:'Choose public or protected access.'},400);
      const isPublic=payload.access==='public';
      if(meta.active){
        if((meta.public===true)!==isPublic)return json({error:'Create a new export to change report access.'},409);
        return json({id:meta.id,active:true,public:meta.public===true});
      }
      if(!isPublic&&payload.savedKey!==true)return json({error:'Confirm that you saved the key.'},400);
      meta.public=isPublic;
      if(isPublic){delete meta.salt;delete meta.codeHash;meta.sessions=[];meta.failed=0;meta.lockedUntil=0;}
      meta.active=true;await storage.put('meta',meta);await storage.deleteAlarm();return json({id:meta.id,active:true,public:isPublic});
    }
    if(path==='/discard'&&request.method==='POST'){
      if(meta.active)return json({error:'An active report cannot be discarded from the creation dialog.'},409);
      await storage.deleteAlarm();await storage.deleteAll();return json({discarded:true});
    }
    if(!meta.active)return json({error:'This report is unavailable.'},404);
    if(path==='/access'&&request.method==='GET')return json({public:meta.public===true,...meta.public===true?{url:`/api/reports/${meta.id}/content`}:{}});
    if(path==='/unlock'&&request.method==='POST'&&meta.public===true)return json({public:true,url:`/api/reports/${meta.id}/content`});
    if(path==='/lock'&&request.method==='POST'){
      if(meta.public===true)return json({error:'Public reports do not use an access code.'},400);
      const token=cookie(request);meta.sessions=meta.sessions.filter(session=>session.hash!==hash(token));await storage.put('meta',meta);
      return json({locked:true},200,{'Set-Cookie':`h3x_report=; Path=/api/reports/${meta.id}; HttpOnly; SameSite=Strict${new URL(request.url).protocol==='https:'?'; Secure':''}; Max-Age=0`});
    }
    if(path==='/unlock'&&request.method==='POST'){
      const {code}=await request.json(),now=Date.now();
      if(meta.lockedUntil>now)return json({error:'Too many incorrect codes. Try again in 15 minutes.'},429,{'Retry-After':String(Math.ceil((meta.lockedUntil-now)/1000))});
      if(meta.lockedUntil){meta.failed=0;meta.lockedUntil=0;}
      const valid=typeof code==='string'&&/^\d{4}$/.test(code)&&timingSafeEqual(Buffer.from(await codeHash(code,meta.salt),'hex'),Buffer.from(meta.codeHash,'hex'));
      if(!valid){
        meta.failed++;if(meta.failed>=5)meta.lockedUntil=now+LOCK_MS;
        await storage.put('meta',meta);
        return meta.lockedUntil?json({error:'Too many incorrect codes. Try again in 15 minutes.'},429,{'Retry-After':'900'}):json({error:'Incorrect code. Please try again.'},401);
      }
      const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      meta.sessions=meta.sessions.filter(session=>session.expires>now).slice(-19);meta.sessions.push({hash:hash(token),expires:now+SESSION_MS});
      await storage.put('meta',meta);
      const flags=`; Path=/api/reports/${meta.id}; HttpOnly; SameSite=Strict${new URL(request.url).protocol==='https:'?'; Secure':''}; Max-Age=3600`;
      return json({url:`/api/reports/${meta.id}/content`},200,{'Set-Cookie':'h3x_report='+token+flags});
    }
    if(path==='/content'&&request.method==='GET'){
      const token=cookie(request);
      if(meta.public!==true&&(!/^[A-Za-z0-9_-]{43}$/.test(token)||!meta.sessions.some(session=>session.expires>Date.now()&&session.hash===hash(token))))return json({error:'Enter the report code to open this investigation.'},401);
      const keys=Array.from({length:meta.chunks},(_,index)=>'html:'+index),parts=await storage.get(keys);
      if(keys.some(key=>!parts.has(key)))return json({error:'The report is unavailable.'},404);
      const html=new TextDecoder().decode(Buffer.concat(keys.map(key=>Buffer.from(parts.get(key)))));
      const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
      return new Response(html,{headers:{...baseHeaders,'Content-Type':'text/html;charset=utf-8','X-Frame-Options':'SAMEORIGIN',
        'Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src ${scripts.join(' ')||"'none'"}; img-src data: https:; frame-src https://www.google.com https://maps.google.com; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`}});
    }
    return json({error:'Report route not found.'},404);
  }
  alarm(){return this.ctx.blockConcurrencyWhile(async()=>{const meta=await this.ctx.storage.get('meta');if(meta&&!meta.active)await this.ctx.storage.deleteAll()});}
}
