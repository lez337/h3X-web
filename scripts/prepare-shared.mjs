import {build} from 'esbuild';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
await mkdir('src/web', {recursive:true});
await mkdir('worker', {recursive:true});
// Keep the desktop implementation as the source of truth for exports and detection.
await build({
  stdin: {contents: `export {default as investigation} from './electron/investigation.cjs';
    export {default as exporter} from './electron/investigation-html.cjs';
    export {default as scanner} from './electron/scanner.cjs';`, resolveDir:process.cwd()},
  bundle:true, format:'esm', platform:'browser', outfile:'src/web/shared.js',
  plugins:[{name:'browser-builtins',setup(b){
    b.onResolve({filter:/^node:(net|crypto)$/},args=>({path:args.path,namespace:'browser-builtins'}));
    b.onLoad({filter:/.*/,namespace:'browser-builtins'},args=>({contents:args.path==='node:crypto'
      ? 'exports.randomUUID = () => globalThis.crypto.randomUUID();'
      : `exports.isIP = value => { if(typeof value!=='string')return 0;
          if(/^(?:0|[1-9]\\d{0,2})(?:\\.(?:0|[1-9]\\d{0,2})){3}$/.test(value)&&value.split('.').every(x=>+x<=255))return 4;
          if(!value.includes(':')||/[\\s%\\[\\]]/.test(value))return 0;
          try {return new URL('http://['+value+']/').hostname.startsWith('[')?6:0}catch{return 0} };` }));
  }}]
});
const source=await readFile('electron/username-search.cjs','utf8');
// Reuse rule parsing, missing-account controls and classification, not Node HTTPS/filesystem IPC.
const core=`'use strict';
const net=require('node:net'),crypto=require('node:crypto');
const BUNDLED=require('../electron/username-sites.json');
const SOURCE_URL='https://github.com/soxoj/maigret';
const statuses=['match','possible','not_found','inconclusive','skipped'];
const strings=value=>Array.isArray(value)?value.filter(v=>typeof v==='string'&&v.length<=500):[];
const requestPage=()=>{throw Error('A Worker transport is required.')};
${source.slice(source.indexOf('function accountName'),source.indexOf('// Resolve and pin'))}
${source.slice(source.indexOf('function safePattern'),source.indexOf('function createCatalogStore'))}
${source.slice(source.indexOf('function configuredOptions'),source.indexOf('async function searchUsernameProvider'))}
module.exports={accountName,publicUrl,publicIPv4,buildCatalog,selectSites,scanUsername,configuredOptions,usernameEvidence};
`;
await writeFile('worker/username-core.cjs',core);
