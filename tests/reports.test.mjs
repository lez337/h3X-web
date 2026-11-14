import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{InvestigationReport,H3xAccount} from '../dist/server/index.js';
import {createHash} from 'node:crypto';
import {generateReportCode} from '../worker/reports.mjs';

const ownerId='a'.repeat(64),ownerToken='b'.repeat(64);
function namespace(ObjectClass=InvestigationReport){
  const states=new Map();
  function context(id){
    if(states.has(id))return states.get(id);
    const data=new Map();let queue=Promise.resolve();
    const ctx={data,alarmTime:null,storage:{
      async get(key){if(Array.isArray(key))return new Map(key.filter(k=>data.has(k)).map(k=>[k,structuredClone(data.get(k))]));return structuredClone(data.get(key));},
      async put(key,value){if(typeof key==='object'){for(const [k,v] of Object.entries(key))data.set(k,structuredClone(v))}else data.set(key,structuredClone(value));},
      async deleteAll(){data.clear()},async setAlarm(time){ctx.alarmTime=time},async deleteAlarm(){ctx.alarmTime=null}
    },blockConcurrencyWhile(operation){const result=queue.then(operation);queue=result.catch(()=>{});return result;}};
    states.set(id,ctx);return ctx;
  }
  return {states,context,idFromName:id=>id,get:id=>({fetch:request=>new ObjectClass(context(id),{}).fetch(request)})};
}
function environment(){
  const accounts=namespace(H3xAccount);
  accounts.context(ownerId).data.set('account',{id:ownerId,name:'ReportOwner',sessions:[{hash:createHash('sha256').update(ownerToken).digest('hex'),expires:Date.now()+3600000}]});
  return {H3X_ACCOUNTS:accounts,INVESTIGATION_REPORTS:namespace(),ASSETS:{fetch:()=>new Response('<div id="root"></div>')}};
}
const record={id:'local-case',title:'Private synthetic title',summary:'Private synthetic summary',people:[{id:'person-1',name:'Synthetic Person',email:'fixture@example.org',notes:'',evidence:[],customCategories:[{id:'hidden',label:'private_internal',value:'NEVER-SHARE-THIS'}]}]};
async function call(env,path,{body,owner=false,method='POST',cookie,origin}={}){
  const headers={'Content-Type':'application/json'};if(owner)headers.Cookie=`h3x_account=${ownerId}.${ownerToken}`;if(cookie)headers.Cookie=cookie;if(origin)headers.Origin=origin;
  return worker.fetch(new Request('https://h3x.example'+path,{method,headers,...method==='GET'?{}:{body:JSON.stringify(body||{})}}),env);
}
async function create(env){const response=await call(env,'/api/reports',{owner:true,body:{record,excluded:['private_internal']}});assert.equal(response.status,201);return response.json();}
async function activate(env,report){const response=await call(env,`/api/reports/${report.id}/activate`,{owner:true,body:{savedKey:true}});assert.equal(response.status,200);}
async function unlock(env,report,code=report.code){return call(env,`/api/reports/${report.id}/unlock`,{body:{code}});}

test('Codes have four digits, including leading zeros',()=>{
  assert.equal(generateReportCode(()=>7),'0007');assert.equal(generateReportCode(()=>0),'0000');assert.equal(generateReportCode(()=>9999),'9999');
  for(let i=0;i<20;i++)assert.match(generateReportCode(),/^\d{4}$/);
});
test('Only signed-in owners can create links, and each export gets a new UUID and code',async()=>{
  const env=environment();assert.equal((await call(env,'/api/reports',{body:{record}})).status,401);
  const first=await create(env),second=await create(env);
  assert.match(first.id,/^[0-9a-f-]{36}$/);assert.match(first.code,/^\d{4}$/);assert.notEqual(first.id,second.id);
  assert.equal(first.url,'https://h3x.example/reports/'+first.id);assert.equal(first.active,false);
  const meta=env.INVESTIGATION_REPORTS.states.get(first.id).data.get('meta');
  assert.equal(meta.code,undefined);assert.notEqual(meta.codeHash,first.code);assert.ok(meta.salt);
});
test('Links stay locked until the creator confirms that the key was saved',async()=>{
  const env=environment(),report=await create(env);
  assert.equal((await unlock(env,report)).status,404);
  assert.equal((await call(env,`/api/reports/${report.id}/activate`,{body:{savedKey:true}})).status,401);
  for(const savedKey of [undefined,false,'true',1])assert.equal((await call(env,`/api/reports/${report.id}/activate`,{owner:true,body:{savedKey}})).status,400);
  await activate(env,report);assert.equal(env.INVESTIGATION_REPORTS.states.get(report.id).alarmTime,null);
});
test('Only the correct code opens content; visitors do not need the workspace access key',async()=>{
  const env=environment(),report=await create(env);await activate(env,report);
  const content=`/api/reports/${report.id}/content`;
  const locked=await call(env,content,{method:'GET'});assert.equal(locked.status,401);assert.ok(!(await locked.text()).includes(record.title));
  const wrong=report.code==='0000'?'1111':'0000';const denied=await unlock(env,report,wrong);assert.equal(denied.status,401);assert.ok(!(await denied.text()).includes(record.title));
  const response=await unlock(env,report);assert.equal(response.status,200);
  const value=await response.json();assert.equal(value.url,content);assert.equal(value.code,undefined);assert.equal(value.html,undefined);
  const cookie=response.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict','Max-Age=3600',`Path=/api/reports/${report.id}`])assert.ok(cookie.includes(flag));
  const opened=await call(env,content,{method:'GET',cookie:cookie.split(';')[0]});assert.equal(opened.status,200);
  const html=await opened.text();assert.ok(html.includes(record.title));assert.ok(html.includes('fixture@example.org'));assert.ok(!html.includes('NEVER-SHARE-THIS'));
  assert.match(opened.headers.get('cache-control'),/no-store/);assert.match(opened.headers.get('content-security-policy'),/script-src 'sha256-/);
});
test('Report cookies cannot open another UUID, forged or expired sessions',async()=>{
  const env=environment(),first=await create(env),second=await create(env);await activate(env,first);await activate(env,second);
  const response=await unlock(env,first),cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call(env,`/api/reports/${second.id}/content`,{method:'GET',cookie})).status,401);
  assert.equal((await call(env,`/api/reports/${first.id}/content`,{method:'GET',cookie:'h3x_report=forged'})).status,401);
  const meta=env.INVESTIGATION_REPORTS.states.get(first.id).data.get('meta');meta.sessions[0].expires=Date.now()-1;
  assert.equal((await call(env,`/api/reports/${first.id}/content`,{method:'GET',cookie})).status,401);
});
test('Failed guesses persist across object recreation and lock every client after five attempts',async()=>{
  const env=environment(),report=await create(env);await activate(env,report);const wrong=report.code==='0000'?'1111':'0000';
  const attempts=await Promise.all(Array.from({length:8},()=>unlock(env,report,wrong)));
  assert.deepEqual(attempts.map(response=>response.status),[401,401,401,401,429,429,429,429]);
  const blocked=await unlock(env,report);assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
  env.INVESTIGATION_REPORTS.states.get(report.id).data.get('meta').lockedUntil=Date.now()-1;
  assert.equal((await unlock(env,report)).status,200);
});
test('Lock view invalidates the viewer cookie on the server',async()=>{
  const env=environment(),report=await create(env);await activate(env,report);
  const response=await unlock(env,report),cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call(env,`/api/reports/${report.id}/lock`,{cookie})).status,200);
  assert.equal((await call(env,`/api/reports/${report.id}/content`,{method:'GET',cookie})).status,401);
});
test('Pending reports can be canceled and abandoned drafts are cleaned by their alarm',async()=>{
  const env=environment(),report=await create(env);
  assert.equal((await call(env,`/api/reports/${report.id}/discard`,{owner:true})).status,200);
  assert.equal(env.INVESTIGATION_REPORTS.states.get(report.id).data.size,0);
  const pending=await create(env),ctx=env.INVESTIGATION_REPORTS.states.get(pending.id);await new InvestigationReport(ctx,{}).alarm();assert.equal(ctx.data.size,0);
});
test('Unknown, malformed and cross-origin report requests expose no investigation',async()=>{
  const env=environment();
  assert.equal((await call(env,'/api/reports/0b416d86-6bc2-465b-afc3-429cecd25293/unlock',{body:{code:'0000'}})).status,404);
  assert.notEqual((await call(env,'/api/reports/not-a-uuid/unlock',{body:{code:'0000'}})).status,200);
  const report=await create(env);await activate(env,report);
  assert.equal((await call(env,`/api/reports/${report.id}/unlock`,{body:{code:report.code},origin:'https://untrusted.example'})).status,403);
});
test('Large Unicode reports survive storage chunking and remain immutable snapshots',async()=>{
  const env=environment(),notes='é Fictional report notes. '.repeat(5000);
  const response=await call(env,'/api/reports',{owner:true,body:{record:{...record,notes}}});assert.equal(response.status,201);
  const report=await response.json();assert.ok(env.INVESTIGATION_REPORTS.states.get(report.id).data.get('meta').chunks>1);await activate(env,report);
  const open=await unlock(env,report),cookie=open.headers.get('set-cookie').split(';')[0];
  const content=await call(env,`/api/reports/${report.id}/content`,{method:'GET',cookie});const html=await content.text();assert.ok(html.includes('é Fictional report notes.'));assert.ok(!html.includes('�'));
});
test('Explicit public activation opens the report without a code, cookie or account',async()=>{
  const env=environment(),report=await create(env);
  assert.equal((await call(env,`/api/reports/${report.id}/access`,{method:'GET'})).status,404);
  assert.equal((await call(env,`/api/reports/${report.id}/content`,{method:'GET'})).status,404);
  const activated=await call(env,`/api/reports/${report.id}/activate`,{owner:true,body:{access:'public'}});
  assert.equal(activated.status,200);assert.equal((await activated.json()).public,true);
  const access=await call(env,`/api/reports/${report.id}/access`,{method:'GET'});
  assert.deepEqual(await access.json(),{public:true,url:`/api/reports/${report.id}/content`});
  const response=await call(env,`/api/reports/${report.id}/content`,{method:'GET'});
  assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(record.title));assert.ok(!html.includes('NEVER-SHARE-THIS'));assert.equal(response.headers.get('set-cookie'),null);
  const meta=env.INVESTIGATION_REPORTS.states.get(report.id).data.get('meta');assert.equal(meta.codeHash,undefined);assert.equal(meta.salt,undefined);assert.equal(meta.sessions.length,0);
});
test('Public access requires explicit owner selection and cannot weaken an existing protected report',async()=>{
  const env=environment(),report=await create(env);
  assert.equal((await call(env,`/api/reports/${report.id}/activate`,{body:{access:'public'}})).status,401);
  for(const access of [true,'true','PUBLIC','',0])assert.equal((await call(env,`/api/reports/${report.id}/activate`,{owner:true,body:{access}})).status,400);
  await activate(env,report);
  assert.deepEqual(await (await call(env,`/api/reports/${report.id}/access`,{method:'GET'})).json(),{public:false});
  assert.equal((await call(env,`/api/reports/${report.id}/activate`,{owner:true,body:{access:'public'}})).status,409);
  assert.equal((await call(env,`/api/reports/${report.id}/content?public=true`,{method:'GET'})).status,401);
  const meta=env.INVESTIGATION_REPORTS.states.get(report.id).data.get('meta');delete meta.public;
  assert.deepEqual(await (await call(env,`/api/reports/${report.id}/access`,{method:'GET'})).json(),{public:false});
  assert.equal((await call(env,`/api/reports/${report.id}/content`,{method:'GET'})).status,401);
});
test('Another signed-in account cannot publish or discard the creator\'s pending report',async()=>{
  const env=environment(),report=await create(env),otherId='c'.repeat(64);
  env.H3X_ACCOUNTS.context(otherId).data.set('account',{id:otherId,name:'OtherOwner',sessions:[{hash:createHash('sha256').update(ownerToken).digest('hex'),expires:Date.now()+3600000}]});
  const cookie=`h3x_account=${otherId}.${ownerToken}`;
  assert.equal((await call(env,`/api/reports/${report.id}/activate`,{cookie,body:{access:'public'}})).status,403);
  assert.equal((await call(env,`/api/reports/${report.id}/discard`,{cookie})).status,403);
  assert.equal((await call(env,`/api/reports/${report.id}/access`,{method:'GET'})).status,404);
  assert.equal((await call(env,`/api/reports/${report.id}/activate`,{owner:true,body:{access:'public'}})).status,200);
});

test('Creators can list their HTML exports without exposing codes or HTML',async()=>{
  const env=environment(),report=await create(env);
  assert.equal((await call(env,'/api/reports',{method:'GET'})).status,401);
  const response=await call(env,'/api/reports',{method:'GET',owner:true});
  assert.equal(response.status,200);
  const {reports}=await response.json();assert.equal(reports.length,1);
  assert.deepEqual(Object.keys(reports[0]).sort(),['createdAt','id','title']);
  assert.equal(reports[0].id,report.id);assert.equal(reports[0].title,record.title);
  assert.equal((await call(env,`/api/reports/${report.id}/discard`,{owner:true})).status,200);
  assert.deepEqual(await (await call(env,'/api/reports',{method:'GET',owner:true})).json(),{reports:[]});
});

test('Deleting public and protected HTML exports erases content and revokes existing viewer sessions',async()=>{
  for(const access of ['public','protected']){
    const env=environment(),report=await create(env);
    await call(env,`/api/reports/${report.id}/activate`,{owner:true,body:{access,savedKey:true}});
    const unlocked=await unlock(env,report),cookie=unlocked.headers.get('set-cookie')?.split(';')[0];
    assert.equal((await call(env,`/api/reports/${report.id}/delete`,{owner:true})).status,200);
    assert.equal(env.INVESTIGATION_REPORTS.states.get(report.id).data.size,0);
    for(const action of ['access','content'])assert.equal((await call(env,`/api/reports/${report.id}/${action}`,{method:'GET',cookie})).status,404);
    assert.equal((await unlock(env,report)).status,404);
    assert.deepEqual(await (await call(env,'/api/reports',{method:'GET',owner:true})).json(),{reports:[]});
    assert.equal((await call(env,`/api/reports/${report.id}/delete`,{owner:true})).status,200);
  }
});

test('Deleting an HTML link requires the creator account, including for older unlisted links',async()=>{
  const env=environment(),report=await create(env),otherId='c'.repeat(64);
  env.H3X_ACCOUNTS.context(otherId).data.set('account',{id:otherId,name:'OtherOwner',sessions:[{hash:createHash('sha256').update(ownerToken).digest('hex'),expires:Date.now()+3600000}]});
  const cookie=`h3x_account=${otherId}.${ownerToken}`;
  await activate(env,report);
  assert.deepEqual(await (await call(env,'/api/reports',{method:'GET',cookie})).json(),{reports:[]});
  assert.equal((await call(env,`/api/reports/${report.id}/delete`)).status,401);
  assert.equal((await call(env,`/api/reports/${report.id}/delete`,{cookie})).status,403);
  assert.equal((await call(env,`/api/reports/${report.id}/delete`,{owner:true,origin:'https://untrusted.example'})).status,403);
  assert.equal((await call(env,`/api/reports/${report.id}/delete`,{owner:true,method:'GET'})).status,405);
  assert.equal((await call(env,`/api/reports/${report.id}/access`,{method:'GET'})).status,200);
  // Existing reports retain ownership even if no account index entry exists.
  env.H3X_ACCOUNTS.context(ownerId).data.delete('reports');
  assert.equal((await call(env,`/api/reports/${report.id}/delete`,{owner:true})).status,200);
});
