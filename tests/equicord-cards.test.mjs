import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({entryPoints:['plugins/equicord/h3xSearch/presentation.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {cardFields,cardTitle}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('Cards group nested provider data into readable fields and hide credentials',()=>{
  const fields={username:'fictional.user',email:'fictional@example.test',city:'Example City',metadata:{dataset:'fixture',password:'private',nested:{token:'private'}},username_history:[{username:'previous.user'}],password:'private',secret:'[redacted]'};
  const rows=cardFields(fields);
  assert.equal(cardTitle(fields),'fictional.user');
  assert.equal(rows.find(row=>row.value===fields.email).group,'Contact');
  assert.equal(rows.find(row=>row.value===fields.city).group,'Location');
  assert.equal(rows.find(row=>row.value==='fixture').group,'Details');
  assert.ok(rows.some(row=>row.value==='previous.user'&&row.group==='Identity'));
  assert.ok(!JSON.stringify(rows).includes('private'));
  assert.ok(rows.every(row=>!row.value.includes('{')));
});

test('Cards bound oversized nested records and handle empty or redacted fields',()=>{
  assert.equal(cardTitle({username:'[redacted]'}),'Search record');
  assert.deepEqual(cardFields({empty:null,password:'hidden',blank:''}),[]);
  const rows=cardFields({entries:Array.from({length:1000},()=>({value:'x'.repeat(4000)}))});
  assert.ok(rows.length<=120);
  assert.ok(rows.every(row=>row.value.length<=2000));
});
