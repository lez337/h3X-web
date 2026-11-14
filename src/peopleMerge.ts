import {personFacts,type SearchPerson} from './peopleModel.ts';
import {phoneKeys} from './phoneIdentity.ts';

export const personNameKey=(value:string)=>(value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/['’]/g,'').match(/[\p{L}\p{N}]+/gu)||[]).sort().join(' ');
const fullName=(value:string)=>personNameKey(value).split(' ').length>=2;
const overlaps=(a:Set<string>,b:Set<string>)=>[...a].some(value=>b.has(value));
function reviewFacts(person:SearchPerson){
 const fields:Record<string,string[]>={};
 for(const detail of person.details)(fields[detail.key]??=[]).push(detail.value);
 return personFacts({id:person.id,source:'Identity',fields});
}

// Merge identity records while retaining their sources and reviewed values.
export function mergeSearchPeople(people:SearchPerson[]):SearchPerson[]{
 const facts=people.map(reviewFacts),phones=phoneKeys(facts.flatMap(rows=>rows.filter(f=>f.key==='phone').map(f=>f.value)));
 const identities=facts.map(rows=>{
  const values=(key:string)=>new Set(rows.filter(f=>f.key===key).map(f=>f.normalized));
  const names=new Set(rows.filter(f=>f.key==='name'&&fullName(f.value)).map(f=>personNameKey(f.value)));
  const first=values('first_name'),last=values('last_name');
  if(first.size===1&&last.size===1)names.add(personNameKey([...first][0]+' '+[...last][0]));
  const contacts=rows.flatMap(f=>f.key==='email'?['email:'+f.normalized]:f.key==='phone'?['phone:'+phones.get(f.value)]:['discord_id','steam_id','fivem_license','fivem_license2','xbl','live_id'].includes(f.key)?[f.key+':'+f.normalized]:[]);
  return {names,first,last,partialNames:rows.filter(f=>['name','first_name','last_name'].includes(f.key)).map(f=>({key:f.key,value:personNameKey(f.value)})),births:values('date_of_birth'),contacts:new Set(contacts),hasName:rows.some(f=>['name','first_name','last_name'].includes(f.key))};
 });
 const parent=people.map((_,i)=>i),births=identities.map(data=>new Set(data.births));
 const root=(i:number):number=>parent[i]===i?i:(parent[i]=root(parent[i]));
 const compatible=(a:number,b:number)=>{const x=births[root(a)],y=births[root(b)];return x.size<=1&&y.size<=1&&(!x.size||!y.size||overlaps(x,y))};
 const join=(a:number,b:number)=>{a=root(a);b=root(b);if(a!==b&&compatible(a,b)){parent[b]=a;births[a]=new Set([...births[a],...births[b]])}};
 const nameIndex=new Map<string,number[]>();
 identities.forEach((data,i)=>data.names.forEach(name=>{const list=nameIndex.get(name)||[];list.push(i);nameIndex.set(name,list)}));
 for(const members of nameIndex.values()){
  const dates=new Set(members.flatMap(i=>[...identities[i].births])),buckets=new Map<string,number>();
  for(const i of members){const key=dates.size>1?[...identities[i].births].sort().join('|'):'';const previous=buckets.get(key);if(previous===undefined)buckets.set(key,i);else join(previous,i)}
 }
 const contactIndex=new Map<string,number[]>();
 identities.forEach((data,i)=>data.contacts.forEach(contact=>{const list=contactIndex.get(contact)||[];list.push(i);contactIndex.set(contact,list)}));
 // Resolve unnamed records as a component before attaching them. A shared
 // household contact must never bridge two different named identities.
 identities.forEach((data,i)=>{if(data.hasName)return;for(const contact of data.contacts)for(const j of contactIndex.get(contact)||[])if(!identities[j].hasName)join(i,j)});
 const candidates=new Map<number,Set<number>>();
 identities.forEach((data,i)=>{if(data.hasName)return;const component=root(i),targets=candidates.get(component)||new Set<number>();for(const contact of data.contacts)for(const j of contactIndex.get(contact)||[])if(identities[j].names.size)targets.add(root(j));candidates.set(component,targets)});
 for(const [component,targets] of candidates)if(targets.size===1){const target=[...targets][0];if(compatible(component,target))join(target,component)}
 // A provider may return only a first or last name. Attach it through a
 // unique contact owner, requiring every supplied name part to agree.
 // Count all owners first so a household contact remains ambiguous.
 const partialTargets=new Map<number,number>();
 identities.forEach((data,i)=>{
  if(data.names.size||!data.hasName)return;
  const targets=new Set<number>();
  for(const contact of data.contacts)for(const j of contactIndex.get(contact)||[])if(identities[j].names.size)targets.add(root(j));
  if(targets.size!==1)return;
  const target=[...targets][0],owners=identities.filter((_,j)=>root(j)===target&&identities[j].names.size);
  const agrees=data.partialNames.every(part=>owners.some(owner=>{
   const explicit=part.key==='first_name'?owner.first:part.key==='last_name'?owner.last:undefined;
   if(explicit?.size)return explicit.has(part.value);
   return [...owner.names].some(name=>part.value.split(' ').every(token=>name.split(' ').includes(token)));
  }));
  if(agrees&&compatible(i,target))partialTargets.set(i,target);
 });
 for(const [i,target] of partialTargets)join(target,i);
 const groups=new Map<number,number[]>();
 people.forEach((_,i)=>{const key=root(i),members=groups.get(key)||[];members.push(i);groups.set(key,members)});
 return [...groups.values()].map(members=>{
  if(members.length===1)return people[members[0]];
  const entries=members.map(i=>people[i]),primary=members.find(i=>identities[i].names.size)??members[0];
  const details=new Map<string,SearchPerson['details'][number]>();
  for(const i of members)for(const detail of people[i].details){
   const normalized=detail.key==='name'?personNameKey(detail.value):detail.key==='phone'?phones.get(detail.value):facts[i].find(f=>f.key===detail.key&&f.value===detail.value)?.normalized||detail.value.trim().toLowerCase();
   const key=detail.key+'\0'+normalized,previous=details.get(key);
   details.set(key,previous?{...previous,sources:[...new Set([...previous.sources,...detail.sources])],recordIds:[...new Set([...previous.recordIds,...detail.recordIds])],confidence:Math.max(previous.confidence,detail.confidence)}:{...detail});
   if(detail.key==='phone'&&detail.value.startsWith('+'))details.get(key)!.value=detail.value;
  }
  const singular=new Set(['name','first_name','last_name','date_of_birth','age','tax_code']);
  const rows=[...details.values()];
  for(const row of rows)if(singular.has(row.key))row.conflict=rows.some(other=>other.key===row.key&&other!==row);
  return {...people[primary],id:entries.map(entry=>entry.id).sort().join('|'),details:rows,
   items:[...new Map(entries.flatMap(entry=>entry.items).map(item=>[item.id,item])).values()],
   matchReasons:[...new Set(entries.flatMap(entry=>entry.matchReasons))],warnings:[...new Set(entries.flatMap(entry=>entry.warnings))],
   reviewContext:entries.map(entry=>entry.reviewContext).filter(Boolean).filter((value,i,all)=>all.indexOf(value)===i).join('\n')||undefined};
 });
}
