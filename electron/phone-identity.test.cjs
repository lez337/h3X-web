const test=require('node:test');
const assert=require('node:assert/strict');
const frontend=require('../src/phoneIdentity.ts');
const backend=require('./phone-identity.cjs');
for(const [label,api] of [['frontend',frontend],['backend',backend]]){
 test(label+' formats French national phones only with French context',()=>{
  assert.equal(api.isFrenchPhoneContext({evidence:[{fields:{country_code:'FR'}}]}),true);
  assert.equal(api.isFrenchPhoneContext({customCategories:[{label:'Country',value:'France'}]}),true);
  assert.equal(api.isFrenchPhoneContext({country:'GB',notes:'France'}),false);
  assert.deepEqual(api.uniquePhoneFields('06 24 12 08 34, 624120834','0033624120834, 01 23 45 67 89',true),{phone:'+33624120834',altPhone:'+33123456789'});
  assert.equal(api.frenchPhone('+442079460123',true),'+442079460123');
  assert.equal(api.frenchPhone('1234',true),'1234');
  assert.equal(api.frenchPhone('0624120834'),'0624120834');
 });
 test(label+' prefers plus format regardless of order and keeps distinct or ambiguous numbers',()=>{
  for(const values of [
   '06 12 34 56 78, +33612345678, 0033612345678, 612345678',
   '0033612345678, 0612345678, +33612345678',
   '+33612345678, 0612345678',
   '0624120834, 624120834, +33624120834',
  ])assert.equal(api.uniquePhones(values),values.includes('624120834')?'+33624120834':'+33612345678');
  assert.equal(api.uniquePhones('0624120834, 624120834'),'0624120834');
  assert.deepEqual(api.uniquePhoneFields('0612345678','+33612345678, 0798765432'),{phone:'+33612345678',altPhone:'0798765432'});
  assert.equal(api.uniquePhones('0612345678, +33612345678, +44612345678'),'0612345678, +33612345678, +44612345678');
  assert.equal(api.uniquePhones('0612345678, 0798765432'),'0612345678, 0798765432');
 });
}

test('French country evidence formats cards, saved people and TXT exports',()=>{
 const {groupPeople}=require('../src/peopleModel.ts');
 const {prepare,hydrateRecord,textReport}=require('./investigation.cjs');
 const fields={country:'France',phone:'0624120834'};
 assert.equal(groupPeople([{id:'fr',source:'Test',fields}])[0].details.find(d=>d.key==='phone').value,'+33624120834');
 assert.equal(prepare(fields).patch.phone,'+33624120834');
 const record={people:[{name:'Alex',phone:'0624120834',evidence:[{fields}]}]};
 assert.equal(hydrateRecord(record).people[0].phone,'+33624120834');
 assert.match(textReport(record),/\+33624120834/);
 assert.equal(prepare({phone:'624120834'},undefined,record.people[0]).patch.phone,'+33624120834');
});
test('cards and graph prefer international labels while retaining source support',()=>{
 const {groupPeople}=require('../src/peopleModel.ts');
 const [person]=groupPeople([{id:'local',source:'A',fields:{email:'alex@example.org',phone:'0612345678'}},{id:'international',source:'B',fields:{email:'alex@example.org',phone:'+33612345678'}}]);
 const phones=person.details.filter(d=>d.key==='phone');
 assert.equal(phones.length,1);assert.equal(phones[0].value,'+33612345678');assert.deepEqual(phones[0].recordIds,['local','international']);
 const [single]=groupPeople([{id:'one',source:'A',fields:{phone:['0033612345678','+33612345678','0612345678']}}]);
 assert.equal(single.details.filter(d=>d.key==='phone').length,1);
 assert.equal(single.details.find(d=>d.key==='phone').value,'+33612345678');
 const {graphNodes}=require('../src/graphModel.ts');
 const nodes=graphNodes({cases:[{id:'case',title:'Case',people:[{id:'person',name:'Alex',phone:'0612345678, 612345678',altPhone:'+33612345678',notes:''}]}],pins:[],links:[],graph:{nodes:[],positions:{},hidden:[]}}).filter(n=>n.kind==='Phone');
 assert.equal(nodes.length,1);assert.equal(nodes[0].label,'+33612345678');
 const {mergeDetails}=require('./investigation.cjs');
 assert.deepEqual(mergeDetails({phone:'0612345678'},{altPhone:'+33612345678'}),{phone:'+33612345678',altPhone:''});
});

test('search groups national and international phones across records without another shared field',()=>{
 const {groupPeople}=require('../src/peopleModel.ts');
 const rows=['0624120834','624120834','+33624120834'].map((phone,i)=>({id:String(i),source:'Provider '+i,fields:{phone}}));
 for(const ordered of [rows,[...rows].reverse()]){
  const people=groupPeople(ordered);
  assert.equal(people.length,1);
  const phones=people[0].details.filter(d=>d.key==='phone');
  assert.equal(phones.length,1);assert.equal(phones[0].value,'+33624120834');
  assert.equal(phones[0].recordIds.length,3);assert.ok(people[0].matchReasons.includes('Same phone'));
 }
 assert.equal(groupPeople(rows.slice(0,2)).length,1);
 assert.equal(groupPeople([
  {...rows[0],fields:{phone:'0624120834',dob:'1990-01-01'}},
  {...rows[2],fields:{phone:'+33624120834',dob:'1980-01-01'}},
 ]).length,2);
 const ambiguous=groupPeople([...rows,{id:'uk',source:'Other',fields:{phone:'+44624120834'}}]);
 assert.equal(ambiguous.length,4);
});
