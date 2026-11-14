// Local-only integration harness. Production uses wrangler.jsonc and never this server.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import worker from '../dist/server/index.js';
import {accountEnvironment} from './fixtures/account-session.mjs';
const root=path.resolve('dist/client');
const fixtureEnv=accountEnvironment();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'};
const assets={async fetch(request){
  const pathname=decodeURIComponent(new URL(request.url).pathname);let file=path.resolve(root,'.'+pathname);
  if(file!==root&&!file.startsWith(root+path.sep))return new Response('Forbidden',{status:403});
  try{if((await stat(file)).isDirectory())file=path.join(file,'index.html');await stat(file)}catch{file=path.join(root,'index.html')}
  return new Response(await readFile(file),{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream'}});
}};
globalThis.fetch=async url=>{
  if(String(url)==='https://api.github.com/users/h3x-fixture')return Response.json({login:'h3x-fixture',name:'Synthetic Fixture',public_repos:2,followers:3,html_url:'https://github.com/h3x-fixture',bio:'Local QA fixture'});
  throw Error('External requests are disabled in the local fixture server.');
};
http.createServer(async(req,res)=>{
  const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort()});
  try{
    const parts=[];for await(const part of req)parts.push(part);
    const request=new Request('http://127.0.0.1:8787'+req.url,{method:req.method,headers:req.headers,...parts.length?{body:Buffer.concat(parts)}:{},signal:abort.signal});
    const response=await worker.fetch(request,{...fixtureEnv,ASSETS:assets});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch(error){res.writeHead(500,{'Content-Type':'text/plain'});res.end(error.message)}
}).listen(8787,'127.0.0.1',()=>console.log('Fixture preview: http://127.0.0.1:8787 (synthetic data only)'));
