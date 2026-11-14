import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../dist/server/index.js';

const shell=await readFile(new URL('../index.html',import.meta.url),'utf8');
const id='12345678-1234-4234-8234-123456789abc';
const assets={async fetch(){return new Response(shell,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Length':String(Buffer.byteLength(shell)),ETag:'old-shell','Content-Security-Policy':"frame-ancestors 'none'"}})}};

test('Home links expose a logo and complete preview metadata without JavaScript',async()=>{
  const response=await worker.fetch(new Request('https://h3x.example/'),{ASSETS:assets});
  const html=await response.text();
  assert.match(html,/<meta property="og:title" content="H3X — Investigation Workspace">/);
  assert.match(html,/<meta property="og:image" content="https:\/\/h3x.example\/icon.png">/);
  assert.match(html,/<meta name="twitter:card" content="summary">/);
  assert.equal((html.match(/<title>/g)||[]).length,1);
  assert.equal((html.match(/<meta name="description"/g)||[]).length,1);
  assert.ok(html.includes('<script type="module" src="/src/main.tsx"></script>'));
  assert.equal(response.headers.get('content-security-policy'),"frame-ancestors 'none'");
  assert.equal(response.headers.get('content-length'),null);
  assert.equal(response.headers.get('etag'),null);
});

test('Report previews stay generic, omit query secrets, and never read report storage',async()=>{
  const response=await worker.fetch(new Request(`https://custom.example/reports/${id}?code=9876`,{headers:{Cookie:'h3x_report=private-session','User-Agent':'Discordbot'}}),{ASSETS:assets});
  const html=await response.text();
  assert.match(html,/H3X — Shared Investigation/);
  assert.match(html,/Protected investigations require an access code/);
  assert.ok(html.includes(`property="og:url" content="https://custom.example/reports/${id}"`));
  assert.ok(html.includes('content="https://custom.example/icon.png"'));
  assert.doesNotMatch(html,/9876|private-session/);
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow, noarchive');
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('Image and unrelated page responses remain untouched',async()=>{
  for(const url of ['https://h3x.example/icon.png','https://h3x.example/reports/invalid']){
    const original=new Response('unchanged',{headers:{'Content-Type':'image/png',ETag:'asset'}});
    const response=await worker.fetch(new Request(url),{ASSETS:{fetch:()=>original}});
    assert.equal(response,original);
  }
});

test('HEAD previews have no body and deployment routes pages through the Worker',async()=>{
  const response=await worker.fetch(new Request(`https://h3x.example/reports/${id}`,{method:'HEAD'}),{ASSETS:assets});
  assert.equal(await response.text(),'');
  const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.ok(config.assets.run_worker_first.includes('/'));
  assert.ok(config.assets.run_worker_first.includes('/reports/*'));
});
