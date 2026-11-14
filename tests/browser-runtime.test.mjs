import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import JSZip from 'jszip';

const workerCode=(await build({entryPoints:['src/web/file-worker.ts'],bundle:true,format:'iife',platform:'browser',write:false})).outputFiles[0].text;
async function scan(files,options={}){
  const messages=[];
  const context={postMessage:value=>messages.push(value),importScripts:()=>{},TextDecoder,Uint8Array,ArrayBuffer,DataView,Blob,File,Promise,setTimeout,clearTimeout,setImmediate,console};
  context.self=context;
  vm.runInNewContext(workerCode,context);
  await context.self.onmessage({data:{files,options:{kinds:['email'],minConfidence:0,limit:100,...options}}});
  const result=messages.find(message=>message.type==='result');
  assert.ok(result,JSON.stringify(messages));return result.data;
}
test('Browser file worker scans UTF-16 CSV and reports real progress',async()=>{
  const buffer=Buffer.concat([Buffer.from([255,254]),Buffer.from('email\r\nfixture@example.org\r\n','utf16le')]);
  const result=await scan([new File([buffer],'fixture.csv')]);
  assert.equal(result.filesScanned,1);assert.equal(result.hits[0].value,'fixture@example.org');assert.ok(result.encodings.includes('UTF-16 LE'));
});
test('Browser ZIP worker scans text entries and skips unsupported contents',async()=>{
  const zip=new JSZip();zip.file('fixture.txt','Email: zip-fixture@example.org');zip.file('image.png','not an image');
  const result=await scan([new File([await zip.generateAsync({type:'uint8array'})],'fixture.zip')]);
  assert.equal(result.filesScanned,1);assert.equal(result.hits[0].value,'zip-fixture@example.org');assert.ok(result.warnings.some(warning=>/Unsupported/.test(warning.message)));
});
test('Browser ZIP worker bounds decompression rather than trusting compressed size',async()=>{
  const zip=new JSZip();zip.file('oversized.txt','x'.repeat(21*1024*1024));
  const result=await scan([new File([await zip.generateAsync({type:'uint8array',compression:'DEFLATE'})],'bounded.zip')]);
  assert.equal(result.filesScanned,0);assert.ok(result.warnings.some(warning=>/decompression limit/.test(warning.message)));
});

const bridgeCode=(await build({entryPoints:['src/web/bridge.ts'],bundle:true,format:'esm',platform:'browser',write:false,plugins:[{
  name:'test-local-storage',setup(b){b.onResolve({filter:/^\.\/storage$/},()=>({path:'storage',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const loadWorkspace=async()=>({settings:{}}), saveWorkspace=async()=>true,read=async()=>[],log=async()=>{},accountId=()=>undefined;`}))}
}]})).outputFiles[0].text;
globalThis.window=new EventTarget();
const {bridge,clearSessionKeys}=await import('data:text/javascript;base64,'+Buffer.from(bridgeCode).toString('base64'));
test('Browser stop retains provider results already received in the current group',async()=>{
  const original=globalThis.fetch;let signaled;
  const available=new Promise(resolve=>signaled=resolve);
  globalThis.fetch=async(_url,options)=>new Response(new ReadableStream({start(controller){
    controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'providerResult',data:{provider:'github',result:{items:[{id:'retained',source:'GitHub',fields:{name:'Synthetic Fixture'}}]}}})+'\n'));
    options.signal.addEventListener('abort',()=>controller.error(new DOMException('Canceled','AbortError')),{once:true});signaled();
  }}),{headers:{'Content-Type':'application/x-ndjson'}});
  try{
    const running=bridge.searchBatch({providers:['github'],query:'fixture',runId:'stop-fixture',settings:{}});
    await available;await new Promise(resolve=>setImmediate(resolve));await bridge.cancelSearch('stop-fixture');
    const result=await running;assert.equal(result.meta.canceled,true);assert.equal(result.items[0].id,'retained');
  }finally{globalThis.fetch=original}
});
test('Browser deep search splits tasks and combines progress without losing completed records',async()=>{
  const original=globalThis.fetch;const tasks=[];
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);tasks.push(body.payload.plan.tasks);
    const item={id:'task-'+tasks.length,fields:{email:'fixture@example.org'}};
    return new Response(JSON.stringify({type:'deepProgress',data:{runId:'deep-fixture',completed:1,total:1,items:[item]}})+'\n'+JSON.stringify({type:'result',data:{items:[item],completed:1,total:1,warnings:[],limited:false}})+'\n',{headers:{'Content-Type':'application/x-ndjson'}});
  };
  try{
    const result=await bridge.deepSearch({runId:'deep-fixture',plan:{pages:1,tasks:[{provider:'brixhub'},{provider:'brixhub'}]}});
    assert.equal(tasks.length,2);assert.ok(tasks.every(batch=>batch.length===1));assert.equal(result.items.length,2);assert.equal(result.completed,2);
  }finally{globalThis.fetch=original}
});
test('Browser provider keys are cleared when the session ends',async()=>{
  const original=globalThis.fetch;const captured=[];
  globalThis.fetch=async(_url,options)=>{captured.push(JSON.parse(options.body).credentials);return Response.json({})};
  try{await bridge.setCredential('oathnet','synthetic-key');await bridge.credentials();clearSessionKeys();await bridge.credentials();assert.equal(captured[0].oathnet,'synthetic-key');assert.deepEqual(captured[1],{})}finally{globalThis.fetch=original}
});
test('HTML export creates a protected link and waits for the creation dialog to finish',async()=>{
  const original=globalThis.fetch;let received,creation;
  const shown=new Promise(resolve=>{creation=resolve});
  const onCreated=event=>creation(event.detail);window.addEventListener('h3x-report-created',onCreated);
  globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/reports');received=JSON.parse(options.body);return Response.json({id:'00000000-0000-4000-8000-000000000001',code:'0007',url:'https://h3x.example/reports/00000000-0000-4000-8000-000000000001',active:false})};
  try{
    const record={id:'fixture-case',title:'Synthetic report',people:[]};let finished=false;
    const exporting=bridge.exportCase({record,excluded:['password'],format:'html'}).then(result=>{finished=true;return result});
    const dialog=await shown;assert.equal(dialog.report.code,'0007');assert.equal(finished,false);assert.deepEqual(received.record,record);assert.equal(received.credentials,undefined);
    await assert.rejects(()=>bridge.exportCase({record,format:'html'}),/Finish the current report/);
    dialog.finish(true);assert.equal(await exporting,true);
  }finally{window.removeEventListener('h3x-report-created',onCreated);globalThis.fetch=original}
});
test('Leaving the workspace cancels an unfinished sharing dialog',async()=>{
  const original=globalThis.fetch;let resolveShown;
  const shown=new Promise(resolve=>resolveShown=resolve),onCreated=event=>resolveShown(event.detail);
  window.addEventListener('h3x-report-created',onCreated);
  globalThis.fetch=async()=>Response.json({id:'00000000-0000-4000-8000-000000000002',code:'1234',url:'https://h3x.example/reports/00000000-0000-4000-8000-000000000002',active:false});
  try{const exporting=bridge.exportCase({record:{title:'Fixture',people:[]},format:'html'});await shown;clearSessionKeys();assert.equal(await exporting,false)}finally{window.removeEventListener('h3x-report-created',onCreated);globalThis.fetch=original}
});
