import core from './username-core.cjs';
import snapshot from '../electron/username-sites.json' with {type:'json'};
import {isIP} from 'node:net';
let catalog;
export const getCatalog=()=>catalog??=core.buildCatalog(snapshot);
export function selection(options){
  const selected=core.selectSites(getCatalog(),options);
  return {ids:selected.sites.map(site=>site.id),eligible:selected.eligible,stats:getCatalog().stats};
}
async function publicHost(host,signal,request,cache){
  if(cache.has(host))return cache.get(host);
  const operation=(async()=>{
    if(isIP(host)||!host.includes('.')||/(?:^|\.)(localhost|local|internal|test|invalid|onion|i2p)$/.test(host))throw Error('Public hostname required.');
    const response=await request('https://cloudflare-dns.com/dns-query?type=A&name='+encodeURIComponent(host),{headers:{Accept:'application/dns-json'},signal});
    if(!response.ok)throw Error('DNS validation failed.');
    const data=await response.json(),answers=(data.Answer||[]).filter(answer=>answer.type===1);
    if(!answers.length||answers.some(answer=>!core.publicIPv4(answer.data)))throw Error('Public IPv4 DNS required.');
  })();cache.set(host,operation);return operation;
}
export function transport(request=fetch){
  const cache=new Map();
  return async function page(value,{signal,headers={},redirects=0}={}){
    const url=core.publicUrl(value);
    await publicHost(url.hostname,signal,request,cache);
    const response=await request(url.href,{headers:{Accept:'text/html,application/json',...headers},redirect:'manual',signal});
    if([301,302,303,307,308].includes(response.status)){
      await response.body?.cancel();
      if(redirects>=1)throw Error('Too many redirects.');
      return page(new URL(response.headers.get('location'),url).href,{signal,headers:{},redirects:redirects+1});
    }
    const reader=response.body?.getReader();let bytes=0;const parts=[];
    if(reader)try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>512*1024){await reader.cancel();throw Error('Profile exceeds response limit.')}parts.push(chunk.value)}}finally{reader.releaseLock()}
    const body=new Uint8Array(bytes);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.length}
    return {status:response.status,body:new TextDecoder().decode(body)};
  };
}
export async function checkBatch(payload,signal){
  core.accountName(payload.query);
  if(!Array.isArray(payload.ids)||!payload.ids.length||payload.ids.length>5||payload.ids.some(id=>typeof id!=='string'))throw Error('Choose one to five catalog sites per request.');
  const ids=new Set(payload.ids),sites=getCatalog().sites.filter(site=>ids.has(site.id));
  if(sites.length!==ids.size)throw Error('Unknown catalog site.');
  return core.scanUsername({sites,stats:getCatalog().stats},{...payload,limit:'all',concurrency:2}, {signal,request:transport()});
}
