import {groupPeople,personFacts,type PeopleItem,type SearchPerson,type PersonFact} from './peopleModel.ts';
import {phoneKeys} from './phoneIdentity.ts';
import {mergeSearchPeople} from './peopleMerge.ts';

export type DeepTerm={id:string;key:string;label:string;value:string;brixField:string};
export type DeepOptions={oath:boolean;brix:boolean;ghunt?:boolean;saveOath?:boolean;mode:'both'|'filtered'|'unfiltered';savedFilters:boolean;followContacts:boolean;pages:number;related?:boolean;keepSearching?:boolean;longSearch?:boolean};
export type DeepTask={provider:'oathnet'|'brixhub'|'ghunt';query?:string;terms?:string[];field?:string;family?:'breach';filtered:boolean;filters:Record<string,unknown>;options?:Record<string,unknown>;settings?:{ghuntPath?:string}};
export type DeepPlan={tasks:DeepTask[];pages:number;longSearch?:boolean};
export type DeepProgress={runId:string;completed:number;total:number;records:number;message:string;items?:PeopleItem[]};
export type DeepRun={items:PeopleItem[];completed:number;total:number;canceled:boolean;warnings:string[];limited:boolean};
export type DeepHit={item:PeopleItem;reasons:string[]};
export type DeepMatch=DeepHit&{kind:'same'|'related'|'unmatched';conflicts:string[];familyLinks?:{personId:string;title:string;basis:string[]}[]};
export type DeepMatches={same:DeepMatch[];related:DeepMatch[];unmatched:DeepMatch[]};
export type ReviewFact={id:string;key:string;label:string;value:string;original:string;sources:string[];recordIds:string[];known:boolean;corroborated:boolean;conflict:boolean;keep:boolean;edited:boolean};
export type DeepReviewGroup={id:string;person:SearchPerson;kind:DeepMatch['kind'];matches:DeepMatch[];rows:ReviewFact[]};

const brixFields:Record<string,string>={email:'email',phone:'telephone',username:'nom_utilisateur',first_name:'prenom',last_name:'nom_famille',name:'nom_affichage',address:'adresse',ip:'adresse_ip',ip_address:'adresse_ip',adresse_ip:'adresse_ip',discord:'discord_id',discord_id:'discord_id',steam_id:'steam_id',fivem_license:'fivem_license',fivem_license2:'fivem_license2',xbl:'xbl',live_id:'live_id',vin:'vin'};
const contextFields:Record<string,string>={first_name:'prenom',last_name:'nom_famille',date_of_birth:'date_naissance',city:'ville',postal_code:'code_postal',country:'pays',company:'societe',societe:'societe',occupation:'profession',profession:'profession',fonction:'fonction',region:'region',department:'departement',departement:'departement',birth_city:'ville_naissance',ville_naissance:'ville_naissance',gender:'genre',genre:'genre'};
export const deepDefaults:DeepOptions={oath:true,brix:true,ghunt:false,saveOath:true,mode:'both',savedFilters:false,followContacts:true,pages:1,related:true};
const text=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const name=(value:string)=>(text(value).match(/[\p{L}\p{N}]+/gu)||[]).sort().join(' ');
const nameIsFull=(value:string)=>(text(value).match(/[\p{L}\p{N}]+/gu)||[]).length>=2;
export function providerFamily(source:string){return /oathnet/i.test(source)?'oathnet':/brixhub/i.test(source)?'brixhub':text(source).split(/\s+[·•|–—-]\s+/)[0]}
function factsFor(person:SearchPerson):PersonFact[]{
 const fields:Record<string,string[]>={};
 for(const d of person.details)if(!d.conflict)(fields[d.key]??=[]).push(d.value);
 return personFacts({id:'seed',source:'Seed',fields});
}
export function deepTerms(person:SearchPerson):DeepTerm[]{
 const facts=factsFor(person),terms:DeepTerm[]=[],seen=new Set<string>();
 const add=(fact:PersonFact)=>{const field=brixFields[fact.key.split('.').at(-1)!];if(!field||fact.value.length>150||fact.value.length<3||fact.key==='name'&&!nameIsFull(fact.value))return;const id=field+':'+fact.normalized;if(!seen.has(id)){seen.add(id);terms.push({id,key:fact.key,label:fact.label,value:fact.value,brixField:field})}};
 for(const key of ['email','phone','username','name','address'])facts.filter(f=>f.key===key).forEach(add);
 if(!terms.some(t=>t.key==='name')){
  const first=facts.find(f=>f.key==='first_name'),last=facts.find(f=>f.key==='last_name');
  if(first&&last)add({key:'name',label:'Full name',value:first.value+' '+last.value,normalized:name(first.value+' '+last.value)});
 }
 facts.filter(f=>!['email','phone','username','name','address'].includes(f.key)).forEach(add);
 for(const detail of person.details)if(!detail.conflict&&detail.key.includes('.')){const leaf=detail.key.split('.').at(-1)!;if(brixFields[leaf])personFacts({id:'term',source:'Seed',fields:{[leaf]:detail.value}}).forEach(add)}
 return terms;
}
export function makeDeepPlan(person:SearchPerson,terms:DeepTerm[],options:DeepOptions,settings:Record<string,any>):DeepPlan{
 const modes=options.mode==='both'?[true,false]:[options.mode==='filtered'],tasks:DeepTask[]=[],facts=factsFor(person);
 const unique=(key:string)=>{const values=facts.filter(f=>f.key===key);return values.length===1?values[0].value:undefined};
 const brixContext:Record<string,unknown>={};for(const [key,field] of Object.entries(contextFields)){const value=unique(key);if(value)brixContext[field]=value}
 const seedName=deepTerms(person).find(t=>t.key==='name')?.value;if(seedName&&!brixContext.prenom&&!brixContext.nom_famille)brixContext.nom_affichage=seedName;
 // A filtered bulk pass accepts an exact seed contact or full name + birth date.
 const rules:any[]=terms.filter(t=>['email','phone'].includes(t.key)).map(t=>({field:t.key,operator:'eq',value:t.value}));
 if(seedName&&unique('date_of_birth'))rules.push({and:[{field:'full_name',operator:'eq',value:seedName},{field:'date_birth',operator:'eq',value:unique('date_of_birth')}]});
 const autoFilter=rules.length===1?rules[0]:rules.length?{or:rules}:undefined;
 // A broad Oath pass already includes the records targeted by identity filters.
 // Keep explicit filtered-only searches and allow opting back into both passes.
 const oathModes=options.saveOath!==false&&options.mode==='both'?[false]:modes;
 if(options.oath&&terms.length)for(const filtered of oathModes){
  const filters:Record<string,unknown>=filtered&&options.savedFilters?{...settings.oathFilters}:{};
  if(filtered&&(!filters.filter||typeof filters.filter==='object'&&!Object.keys(filters.filter as object).length)&&autoFilter)filters.filter=autoFilter;
  tasks.push({provider:'oathnet',family:'breach',terms:[...new Set(terms.filter(t=>!['ip','ip_address','adresse_ip'].includes(t.key)).map(t=>t.value))],filtered,filters,options:filtered&&options.savedFilters?{...settings.oathOptions}: {}});
 }
 if(options.brix)for(const term of terms)for(const filtered of modes){
  if(['ip','ip_address','adresse_ip'].includes(term.key)&&(!filtered||!unique('email')&&!unique('phone')&&!(seedName&&unique('date_of_birth'))))continue;
  const filters:Record<string,unknown>=filtered?{...brixContext,...(options.savedFilters?settings.brixFilters:{})}:{};
  // A shared-contact lookup must also be able to return a different person.
  // Keep explicit saved filters, but remove automatic target-only constraints.
  if(filtered&&options.related&&['email','phone','address'].includes(term.key))for(const field of Object.keys(brixContext))if(!options.savedFilters||settings.brixFilters?.[field]==null)delete filters[field];
  if(['ip','ip_address','adresse_ip'].includes(term.key)){if(unique('email'))filters.email=unique('email');else if(unique('phone'))filters.telephone=unique('phone');}
  delete filters[term.brixField];
  tasks.push({provider:'brixhub',query:term.value,field:term.brixField,filtered,filters});
 }
 if(options.ghunt)for(const term of terms)if(term.key==='email')tasks.push({provider:'ghunt',query:term.value.trim().toLowerCase(),filtered:false,filters:{},settings:{ghuntPath:settings.ghuntPath}});
 // Skip identical passes when there is no additional filter to apply.
 const seen=new Set<string>();return {tasks:tasks.filter(task=>{if(task.provider==='oathnet'&&!task.terms?.length)return false;const id=JSON.stringify({...task,filtered:undefined});if(seen.has(id))return false;seen.add(id);return true}),pages:options.longSearch?0:options.pages,longSearch:options.longSearch};
}
function stableRequest(value:unknown):unknown{
 if(Array.isArray(value))return value.map(stableRequest);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,stableRequest(v)]));
 return value;
}
// Share this ledger across every follow-up round, and reset it for Search again.
// A different batch must not resubmit identifiers with the same query settings.
export function pendingDeepPlan(plan:DeepPlan,requests:Set<string>):DeepPlan{
 const tasks:DeepTask[]=[];
 for(const task of plan.tasks){
  if(task.provider==='oathnet'){
   const context=JSON.stringify(stableRequest({...task,terms:undefined,filtered:undefined}));
   const terms=(task.terms||[]).map(term=>term.trim()).filter(term=>{
    const id=context+'\0'+term;if(requests.has(id))return false;requests.add(id);return true;
   });
   if(terms.length)tasks.push({...task,terms});
  }else{
   const id=task.provider==='ghunt'?'ghunt:'+task.query?.trim().toLowerCase():JSON.stringify(stableRequest({...task,filtered:undefined}));
   if(!requests.has(id)){requests.add(id);tasks.push(task)}
  }
 }
 return {...plan,tasks};
}
function identity(facts:PersonFact[]){
 const values=(key:string)=>new Set(facts.filter(f=>f.key===key).map(f=>key==='name'?name(f.value):f.normalized));
 const names=values('name');const first=values('first_name'),last=values('last_name');
 if(first.size===1&&last.size===1)names.add(name([...first][0]+' '+[...last][0]));
 const surnames=values('last_name');
 // Unlabelled full names have uncertain order; use only the final name part as
 // a hint. An explicit surname takes precedence over this inference.
 if(!surnames.size)for(const fact of facts.filter(f=>f.key==='name'&&nameIsFull(f.value))){const parts=text(fact.value).match(/[\p{L}\p{N}]+/gu)||[];surnames.add(parts.at(-1)!)}
 return {emails:values('email'),phones:facts.filter(f=>f.key==='phone').map(f=>f.value),births:values('date_of_birth'),names:new Set([...names].filter(nameIsFull)),surnames,
  addresses:new Set(facts.filter(f=>f.key==='address'&&f.value.length>=8).map(f=>text(f.value).replace(/[^\p{L}\p{N}]+/gu,' ').trim())),usernames:values('username'),cities:values('city'),postals:values('postal_code'),countries:values('country'),companies:new Set(facts.filter(f=>['company','societe','organization','organisation','employer'].includes(f.key)).map(f=>text(f.value))),
  accounts:new Set(facts.filter(f=>['discord_id','steam_id','fivem_license','fivem_license2','xbl','live_id'].includes(f.key.split('.').at(-1)!)).map(f=>f.key.split('.').at(-1)+':'+text(f.value)))};
}
const overlaps=(a:Set<string>,b:Set<string>)=>[...a].some(v=>b.has(v));
export function classifyDeepHits(seed:SearchPerson,items:PeopleItem[]):DeepMatches{
 const original=identity(factsFor(seed)),result:DeepMatches={same:[],related:[],unmatched:[]};
 const identityRecords=[{...seed,items:[{id:'identity:seed',source:'Seed'}]},...items.map(item=>({id:item.id,title:'',items:[item],details:personFacts(item).map(f=>({...f,confidence:50,explanation:'',sources:[item.source],recordIds:[item.id],conflict:false})),confidence:0,matchReasons:[],warnings:[]}))];
 const target=mergeSearchPeople(identityRecords).find(person=>person.items.some(item=>item.id==='identity:seed'));
 const targetRecords=new Set(target?.items.filter(item=>item.id!=='identity:seed').map(item=>item.id));
 for(const item of items){
  const candidate=identity(personFacts(item));
  const birthConflict=candidate.births.size>1||original.births.size>1||original.births.size>0&&candidate.births.size>0&&!overlaps(original.births,candidate.births);
  const nameConflict=original.names.size>0&&candidate.names.size>0&&!overlaps(original.names,candidate.names);
  const email=overlaps(original.emails,candidate.emails),keys=phoneKeys([...original.phones,...candidate.phones]),knownPhones=new Set(original.phones.map(p=>keys.get(p)));
  const phone=candidate.phones.some(p=>knownPhones.has(keys.get(p))),sameName=overlaps(original.names,candidate.names),birth=overlaps(original.births,candidate.births);
  const surname=overlaps(original.surnames,candidate.surnames),address=overlaps(original.addresses,candidate.addresses),username=overlaps(original.usernames,candidate.usernames),account=overlaps(original.accounts,candidate.accounts),company=overlaps(original.companies,candidate.companies),city=overlaps(original.cities,candidate.cities);
  const same=!birthConflict&&!nameConflict&&(targetRecords.has(item.id)||(email||phone)&&(sameName||birth||email&&phone)||sameName&&birth);
  // Correlation establishes a possible link, not ownership or a family relation.
  const related=email||phone||account||address&&(surname||sameName||birth)||username&&(surname||sameName||birth)||sameName&&company&&city;
  const kind=same?'same':related?'related':'unmatched';
  const reasons=[email?'Exact seed email':'',phone?'Same seed phone':'',sameName?'Full name agrees':'',surname&&!sameName?'Surname agrees':'',birth?'Birth date agrees':'',address?'Same street address':'',username?'Same username':'',account?'Same account identifier':'',company?'Same company':'',city?'Same city':''].filter(Boolean);
  const conflicts=[nameConflict?'Different full name':'',birthConflict?'Different or ambiguous birth date':''].filter(Boolean);
  if(!reasons.length)reasons.push('No identity correlation found');
  if(kind==='unmatched'&&reasons[0]!=='No identity correlation found')reasons.push('Not enough supporting information to establish a link');
  result[kind].push({item,reasons,conflicts,kind});
 }
 // One bounded correlation pass can use contacts found in a strong original
 // identity match. Related and unmatched records never become identity anchors.
 const confirmed=identity([...factsFor(seed),...result.same.flatMap(match=>personFacts(match.item))]);
 const rest:DeepMatch[]=[];
 for(const match of result.unmatched){
  const candidate=identity(personFacts(match.item)),keys=phoneKeys([...confirmed.phones,...candidate.phones]),phones=new Set(confirmed.phones.map(phone=>keys.get(phone)));
  const email=overlaps(confirmed.emails,candidate.emails),phone=candidate.phones.some(value=>phones.has(keys.get(value))),account=overlaps(confirmed.accounts,candidate.accounts);
  if(email||phone||account){
   result.related.push({...match,kind:'related',reasons:[...match.reasons.filter(reason=>!/No identity correlation|Not enough supporting/.test(reason)),email?'Email shared with a same-person result':'',phone?'Phone shared with a same-person result':'',account?'Account identifier shared with a same-person result':''].filter(Boolean)});
  }else rest.push(match);
 }
 result.unmatched=rest;
 return result;
}
export function trustedDeepHits(seed:SearchPerson,items:PeopleItem[]):{hits:DeepHit[];rejected:number}{
 const matches=classifyDeepHits(seed,items);return {hits:matches.same,rejected:matches.related.length+matches.unmatched.length};
}
function excludedKey(key:string,excluded:string[]){return key.split('.').some(part=>excluded.some(pattern=>new RegExp('^'+pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$','i').test(part)))}
export function reviewDeepFacts(seed:SearchPerson,hits:DeepHit[],excluded:string[]):ReviewFact[]{
 const seedFacts=factsFor(seed),all=[...seed.items,...hits.map(h=>h.item)],phoneMap=phoneKeys(all.flatMap(i=>personFacts(i).filter(f=>f.key==='phone').map(f=>f.value)));
 const normalized=(f:PersonFact)=>f.key==='phone'?phoneMap.get(f.value)||f.normalized:f.normalized;
 const known=new Set(seedFacts.map(f=>f.key+'\0'+normalized(f))),map=new Map<string,ReviewFact>();
 for(const item of all)for(const fact of personFacts(item)){
  if(excludedKey(fact.key,excluded))continue;
  const id=fact.key+'\0'+normalized(fact),current=map.get(id)||{id,key:fact.key,label:fact.label,value:fact.value,original:fact.value,sources:[],recordIds:[],known:known.has(id),corroborated:false,conflict:false,keep:false,edited:false};
  if(fact.key==='phone'&&fact.value.startsWith('+'))current.value=current.original=fact.value;
  if(!current.sources.includes(item.source))current.sources.push(item.source);
  if(!current.recordIds.includes(item.id))current.recordIds.push(item.id);map.set(id,current);
 }
 const rows=[...map.values()],singular=new Set(['name','first_name','last_name','date_of_birth','age','tax_code']);
 for(const row of rows){row.corroborated=new Set(row.sources.map(providerFamily)).size>=2;row.conflict=singular.has(row.key)&&rows.some(other=>other.key===row.key&&other.id!==row.id);row.keep=!row.conflict&&(row.known||row.corroborated)}
 const order=['name','last_name','first_name','date_of_birth','age','email','phone','username','address','city','postal_code','country'];
 const rank=(key:string)=>order.includes(key)?order.indexOf(key):100;
 return rows.sort((a,b)=>rank(a.key)-rank(b.key)||Number(b.known)-Number(a.known)||a.label.localeCompare(b.label)||a.value.localeCompare(b.value));
}
export function reviewedPerson(seed:SearchPerson,rows:ReviewFact[]):SearchPerson{
 const kept=rows.filter(row=>row.keep&&row.value.trim()),id='deep:'+seed.id;
 return {id,title:kept.find(r=>r.key==='name')?.value||seed.title,confidence:seed.confidence,matchReasons:['Reviewed deep search'],warnings:[],
  details:kept.map(row=>({key:row.key,label:row.label,value:row.value.trim(),confidence:row.corroborated?65:50,explanation:row.edited?'Edited during review.':'Retained during deep-search review.',sources:row.sources,recordIds:[row.id],conflict:row.conflict})),
  // Export the reviewed values only. Original fields must never restore deleted or edited data.
  items:kept.map(row=>({id:id+':'+row.id,source:(row.sources.join(' / ')||'Manual review')+(row.edited?' (edited)':' (reviewed)'),fields:{[row.key]:row.value.trim()}}))};
}
export function deepReviewGroups(seed:SearchPerson,matches:DeepMatches,excluded:string[]):DeepReviewGroup[]{
 const groups:DeepReviewGroup[]=[{id:'target',person:seed,kind:'same',matches:matches.same,rows:reviewDeepFacts(seed,matches.same,excluded)}];
 for(const kind of ['related','unmatched'] as const){
  const buckets=new Map<string,DeepMatch[]>();
  for(const match of matches[kind]){const names=identity(personFacts(match.item)).names,key=names.size===1?[...names][0]:match.item.id;const bucket=buckets.get(key)||[];bucket.push(match);buckets.set(key,bucket)}
  for(const bucket of buckets.values()){
   const people=groupPeople(bucket.map(hit=>hit.item));
   // Account-only and other arbitrary returned records also remain reviewable.
   const included=new Set(people.flatMap(person=>person.items.map(item=>item.id)));
   for(const hit of bucket)if(!included.has(hit.item.id)){
    const facts=personFacts(hit.item);people.push({id:hit.item.id,title:facts.find(f=>['name','email','username','phone'].includes(f.key))?.value||hit.item.source+' record',items:[hit.item],details:facts.map(f=>({key:f.key,label:f.label,value:f.value,confidence:50,explanation:'Provider record; identity not confirmed.',sources:[hit.item.source],recordIds:[hit.item.id],conflict:false})),confidence:20,matchReasons:[],warnings:[]});
   }
   for(const person of people){
    const ids=new Set(person.items.map(item=>item.id));
    groups.push({id:kind+':'+person.id,person,kind,matches:bucket.filter(hit=>ids.has(hit.item.id)),rows:reviewDeepFacts(person,[],excluded).map(row=>({...row,known:false,keep:false}))});
   }
  }
 }
 return groups;
}
export function deepRecordGroups(seed:SearchPerson,matches:DeepMatches,excluded:string[]):DeepReviewGroup[]{
 const supported=reviewDeepFacts(seed,matches.same,excluded);
 const phones=phoneKeys([...supported.filter(row=>row.key==='phone').map(row=>row.original),...matches.same.flatMap(hit=>personFacts(hit.item).filter(fact=>fact.key==='phone').map(fact=>fact.value))]);
 const hits=(['same','related','unmatched'] as const).flatMap(kind=>matches[kind]);
 const records=hits.map(hit=>{
  const kind=hit.kind;
  const facts=personFacts(hit.item),person:SearchPerson={id:hit.item.id,title:groupPeople([hit.item])[0]?.title||facts.find(f=>['name','email','username','phone'].includes(f.key))?.value||hit.item.source+' record',items:[hit.item],details:facts.map(f=>({...f,confidence:50,explanation:'Provider record',sources:[hit.item.source],recordIds:[hit.item.id],conflict:false})),confidence:kind==='same'?65:20,matchReasons:hit.reasons,warnings:hit.conflicts};
  return person;
 });
 return mergeSearchPeople(records).map(person=>{
  const ids=new Set(person.items.map(item=>item.id)),members=hits.filter(hit=>ids.has(hit.item.id));
  const kind=members.some(hit=>hit.kind==='same')?'same':members.some(hit=>hit.kind==='related')?'related':'unmatched';
  const rows=reviewDeepFacts(person,[],excluded).map(row=>{
   const support=kind==='same'?supported.find(f=>f.key===row.key&&(f.id===row.id||f.original===row.original||f.key==='phone'&&phones.get(f.original)===phones.get(row.original))):undefined;
   return {...row,sources:support?.sources||row.sources,known:!!support?.known,corroborated:!!support?.corroborated,conflict:!!support?.conflict,keep:!!support?.keep};
  });
  return {id:'record:'+person.id,person,kind,matches:members,rows};
 });
}
export function reviewedPeople(groups:DeepReviewGroup[]):SearchPerson[]{
 return mergeSearchPeople(groups.filter(group=>group.rows.some(row=>row.keep&&row.value.trim())).map(group=>{
  const person=reviewedPerson(group.person,group.rows);
  if(group.kind!=='same'){
   person.matchReasons=[group.kind==='related'?'Possible connection; separate person':'Unmatched record; included manually',...new Set(group.matches.flatMap(match=>match.reasons))];
   person.warnings=[...new Set(group.matches.flatMap(match=>match.conflicts))];
  }
   const family=[...new Map(group.matches.flatMap(match=>match.familyLinks||[]).map(link=>[link.personId,link])).values()];
   if(family.length){
    const value=family.map(link=>'Possible family of '+link.title+' (same surname; '+link.basis.join(', ')+')').join('; ');
    person.matchReasons.push(value);
    person.details.push({key:'family_connection',label:'Family connection',value,confidence:20,explanation:'Shared details suggest a possible family connection; unconfirmed.',sources:[],recordIds:[],conflict:false});
    person.items.push({id:person.id+':family',source:'Deep search correlation',fields:{family_connection:value}});
   }
   if(group.kind!=='same'||family.length)person.reviewContext=[...person.matchReasons,...person.warnings].join('\n');
   if(group.kind!=='same')person.items=person.items.map(item=>({...item,source:`${group.kind==='related'?'Possible connection':'Unmatched'} · ${item.source}`}));
  return person;
 }));
}
export function discoveredContacts(seed:SearchPerson,hits:DeepHit[],searched:DeepTerm[]):DeepTerm[]{
 const rows=reviewDeepFacts(seed,hits,[]),person=reviewedPerson(seed,rows.map(r=>({...r,keep:!r.conflict}))),seen=new Set(searched.map(t=>t.id));
 return deepTerms(person).filter(t=>['email','phone'].includes(t.key)&&!seen.has(t.id));
}

// Recursive discovery expands connections, never the original person's identity.
export function classifyDeepNetwork(seed:SearchPerson,items:PeopleItem[],recursive=false):DeepMatches{
 const result=classifyDeepHits(seed,items);
 const hits=[...result.same,...result.related,...result.unmatched];
 const nodes=[{id:seed.id,title:seed.title,data:identity(factsFor(seed)),hit:null as DeepMatch|null},...hits.map(hit=>{
  const facts=personFacts(hit.item);
  return {id:hit.item.id,title:facts.find(f=>f.key==='name')?.value||[facts.find(f=>f.key==='first_name')?.value,facts.find(f=>f.key==='last_name')?.value].filter(Boolean).join(' ')||hit.item.source+' record',data:identity(facts),hit};
 })];
 const phones=phoneKeys(nodes.flatMap(node=>node.data.phones));
 const tokens=(node:typeof nodes[number])=>[...node.data.emails].map(v=>'email:'+v).concat(node.data.phones.map(v=>'phone:'+phones.get(v)),[...node.data.addresses].map(v=>'address:'+v));
 const index=new Map<string,Set<number>>();
 nodes.forEach((node,i)=>tokens(node).forEach(token=>{if(!index.has(token))index.set(token,new Set());index.get(token)!.add(i)}));
 const connected=new Set([0,...nodes.flatMap((node,i)=>node.hit&&node.hit.kind!=='unmatched'?[i]:[])]),queue=[...connected];
 for(let n=0;n<queue.length;n++){
  const a=nodes[queue[n]],candidates=new Set(tokens(a).flatMap(token=>[...(index.get(token)||[])]));
  for(const i of candidates){
   const b=nodes[i];if(a===b||!b.hit)continue;
   const surname=overlaps(a.data.surnames,b.data.surnames),sameName=overlaps(a.data.names,b.data.names);
   const email=overlaps(a.data.emails,b.data.emails),phone=a.data.phones.some(value=>b.data.phones.some(other=>phones.get(value)===phones.get(other)));
   const locationConflict=(['cities','postals','countries'] as const).some(key=>a.data[key].size&&b.data[key].size&&!overlaps(a.data[key],b.data[key]));
   const address=!locationConflict&&overlaps(a.data.addresses,b.data.addresses);
   if(!email&&!phone&&!(address&&surname))continue;
   if(recursive&&!connected.has(i)){
    connected.add(i);queue.push(i);b.hit.kind='related';b.hit.reasons=[...b.hit.reasons.filter(reason=>!/No identity correlation|Not enough supporting/.test(reason)),...(email?['Email shared with '+a.title]:[]),...(phone?['Phone shared with '+a.title]:[]),...(address?['Address shared with '+a.title]:[])];
   }
   if(connected.has(i)&&surname&&!sameName&&a.data.names.size&&b.data.names.size){
    const basis=[email?'Shared email':'',phone?'Shared phone':'',address?'Shared home address':''].filter(Boolean);
    b.hit.familyLinks??=[];
    if(!b.hit.familyLinks.some(link=>name(link.title)===name(a.title)))b.hit.familyLinks.push({personId:a.id,title:a.title,basis});
   }
  }
 }
 return {same:result.same,related:hits.filter(hit=>hit.kind==='related'),unmatched:hits.filter(hit=>hit.kind==='unmatched')};
}
export function nextDeepSearchTerms(matches:DeepMatches,searched:DeepTerm[]):DeepTerm[]{
 const found=[...matches.same,...matches.related].flatMap(hit=>{
  const facts=personFacts(hit.item),person:SearchPerson={id:hit.item.id,title:'',items:[hit.item],details:facts.map(f=>({...f,confidence:50,explanation:'',sources:[],recordIds:[],conflict:false})),confidence:0,matchReasons:[],warnings:[]};
  return deepTerms(person).filter(term=>(hit.kind==='same'||['email','phone','address'].includes(term.key))&& (term.key!=='address'||term.value.length>=8));
 });
 const phones=phoneKeys([...searched,...found].filter(term=>term.key==='phone').map(term=>term.value));
 const key=(term:DeepTerm)=>term.key+':'+(term.key==='phone'?phones.get(term.value):text(term.value).replace(term.key==='address'?/[^\p{L}\p{N}]+/gu:/\s+/g,' '));
 const seen=new Set(searched.map(key));
 return found.filter(term=>{const id=key(term);if(seen.has(id))return false;seen.add(id);return true});
}
