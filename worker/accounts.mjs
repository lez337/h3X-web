import {createHash,randomInt,timingSafeEqual} from 'node:crypto';
import {blank,validateState} from '../src/web/state.mjs';

const encoder=new TextEncoder(),decoder=new TextDecoder();
const COOKIE='h3x_account',SESSION_MS=8*3600000,LOCK_MS=15*60000,CHUNK=60*1024;
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
const hash=value=>createHash('sha256').update(value).digest('hex');
export const generateAccountKey=(random=()=>randomInt(100000000))=>String(random()).padStart(8,'0');
export function accountName(value){
  if(typeof value!=='string')throw Error('Choose an account name.');
  const name=value.trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(name))throw Error('Use 3–32 letters, numbers, dots, underscores or hyphens for your name.');
  return {name,id:hash(name.toLowerCase())};
}
async function keyHash(key,salt){
  const material=await crypto.subtle.importKey('raw',encoder.encode(key),'PBKDF2',false,['deriveBits']);
  return Buffer.from(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Buffer.from(salt,'hex'),iterations:100000},material,256)).toString('hex');
}
function namespace(env,id){return env.H3X_ACCOUNTS.get(env.H3X_ACCOUNTS.idFromName(id));}
function sessionCookie(request){
  const cookie=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
  return /^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(cookie)?cookie:'';
}
const flags=request=>`; Path=/api; HttpOnly; SameSite=Strict${new URL(request.url).protocol==='https:'?'; Secure':''}`;
async function internal(env,id,path,body){return namespace(env,id).fetch(new Request('https://account.internal'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));}
export async function resolveAccount(request,env){
  const cookie=sessionCookie(request);if(!cookie||!env.H3X_ACCOUNTS)return null;
  const [id,token]=cookie.split('.');
  const response=await internal(env,id,'/session',{token});
  return response.ok?{...(await response.json()).account,token}:null;
}
export async function accountAuth(request,env,path,body){
  if(!env.H3X_ACCOUNTS)return json({error:'Accounts are not configured. Deploy the updated Cloudflare configuration.',configured:false},503);
  if(path==='/api/session'){
    const account=await resolveAccount(request,env);
    return json({authenticated:!!account,configured:true,account:account?{id:account.id,name:account.name}:null});
  }
  if(path==='/api/logout'){
    const cookie=sessionCookie(request);
    if(cookie&&request.headers.has('X-H3X-Account')&&request.headers.get('X-H3X-Account')!==cookie.split('.')[0])return json({error:'The signed-in account changed in another tab. Sign in again.'},401);
    if(cookie){const [id,token]=cookie.split('.');await internal(env,id,'/logout',{token});}
    return json({ok:true},200,{'Set-Cookie':`${COOKIE}=; Max-Age=0${flags(request)}`});
  }
  const {name,id}=accountName(body?.name);
  if(path==='/api/login'&&(typeof body.key!=='string'||!/^\d{8}$/.test(body.key)))return json({error:'Enter your name and 8-digit account key.'},400);
  // A separate persistent limiter also bounds attempts that cycle through names.
  const ip=hash(request.headers.get('CF-Connecting-IP')||'local');
  const limit=await internal(env,'ip:'+ip,'/limit',{kind:path==='/api/accounts'?'create':'login'});
  if(!limit.ok)return limit;
  const response=await internal(env,id,path==='/api/accounts'?'/create':'/login',{id,name,key:body.key});
  if(!response.ok)return response;
  const value=await response.json(),{token,...result}=value;
  return json(result,response.status,token?{'Set-Cookie':`${COOKIE}=${id}.${token}; Max-Age=28800${flags(request)}`} : {});
}
export async function accountWorkspace(request,env,account,body){
  return internal(env,account.id,request.method==='GET'?'/load':'/save',{token:account.token,...request.method==='GET'?{}:{state:body.state,revision:body.revision}});
}

// One object per normalized name provides atomic name reservation and isolated data.
export class H3xAccount {
  constructor(ctx){this.ctx=ctx;}
  fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{
    try{return await this.handle(request)}catch(error){return json({error:error instanceof SyntaxError?'Invalid JSON.':error.message||'Account request failed.'},400)}
  });}
  async handle(request){
    const path=new URL(request.url).pathname,body=await request.json(),storage=this.ctx.storage,now=Date.now();
    if(path==='/limit'){
      const kind=body.kind==='create'?'create':'login',max=kind==='create'?10:30;
      let limit=await storage.get(kind);
      if(!limit||limit.until<=now)limit={count:0,until:now+LOCK_MS};
      if(limit.count>=max)return json({error:'Too many attempts. Try again in 15 minutes.'},429,{'Retry-After':String(Math.ceil((limit.until-now)/1000))});
      limit.count++;await storage.put(kind,limit);await storage.setAlarm(Math.max(limit.until,now+LOCK_MS));return json({ok:true});
    }
    let meta=await storage.get('account');
    if(path==='/create'){
      if(meta)return json({error:'This name is already taken. Choose another name.'},409);
      const {name,id}=accountName(body.name);if(id!==body.id)return json({error:'Invalid account.'},400);
      const key=generateAccountKey(),salt=Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
      meta={id,name,salt,keyHash:await keyHash(key,salt),createdAt:now,sessions:[]};
      await storage.put('account',meta);
      // The key is returned once. Creating an account does not log it in.
      return json({account:{id,name},key},201);
    }
    if(path==='/login'){
      if(typeof body.key!=='string'||!/^\d{8}$/.test(body.key))return json({error:'Enter an 8-digit account key.'},400);
      let attempts=await storage.get('attempts')||{failed:0,lockedUntil:0};
      if(attempts.lockedUntil>now)return json({error:'Too many incorrect keys. Try again in 15 minutes.'},429,{'Retry-After':String(Math.ceil((attempts.lockedUntil-now)/1000))});
      if(attempts.lockedUntil)attempts={failed:0,lockedUntil:0};
      const salt=meta?.salt||'00000000000000000000000000000000';
      const candidate=await keyHash(body.key,salt);
      if(!meta||!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(meta.keyHash,'hex'))){
        attempts.failed++;if(attempts.failed>=5)attempts.lockedUntil=now+LOCK_MS;
        await storage.put('attempts',attempts);if(!meta)await storage.setAlarm(now+LOCK_MS);
        return json({error:'Incorrect account name or key.'},401);
      }
      const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
      meta.sessions=[...meta.sessions.filter(s=>s.expires>now).slice(-19),{hash:hash(token),expires:now+SESSION_MS}];
      await storage.put({account:meta,attempts:{failed:0,lockedUntil:0}});
      return json({authenticated:true,account:{id:meta.id,name:meta.name},token});
    }
    const session=meta&&typeof body.token==='string'&&/^[a-f0-9]{64}$/.test(body.token)&&meta.sessions.find(s=>s.hash===hash(body.token)&&s.expires>now);
    if(!session)return json({error:'Sign in to use H3X.'},401);
    if(path==='/session')return json({account:{id:meta.id,name:meta.name}});
    if(path==='/logout'){meta.sessions=meta.sessions.filter(s=>s!==session);await storage.put('account',meta);return json({ok:true});}
    const workspace=await storage.get('workspace')||{revision:0,chunks:0};
    if(path==='/load'){
      if(!workspace.chunks)return json({state:blank(),revision:0});
      const parts=await storage.get(Array.from({length:workspace.chunks},(_,i)=>'state:'+i));
      const data=Buffer.concat(Array.from({length:workspace.chunks},(_,i)=>Buffer.from(parts.get('state:'+i))));
      return json({state:JSON.parse(decoder.decode(data)),revision:workspace.revision});
    }
    if(path==='/save'){
      if(!Number.isSafeInteger(body.revision)||body.revision!==workspace.revision)return json({error:'Your account was updated in another tab or device. Download a backup of your changes, then reload before editing further.'},409);
      const state=validateState(body.state),data=encoder.encode(JSON.stringify(state)),chunks=Math.ceil(data.length/CHUNK),revision=workspace.revision+1;
      await storage.transaction(async txn=>{
        const entries={workspace:{revision,chunks}};
        for(let i=0;i<chunks;i++)entries['state:'+i]=data.slice(i*CHUNK,(i+1)*CHUNK);
        await txn.put(entries);
        if(workspace.chunks>chunks)await txn.delete(Array.from({length:workspace.chunks-chunks},(_,i)=>'state:'+(chunks+i)));
      });
      return json({ok:true,revision});
    }
    return json({error:'Account route not found.'},404);
  }
  async alarm(){if(!await this.ctx.storage.get('account'))await this.ctx.storage.deleteAll();}
}
