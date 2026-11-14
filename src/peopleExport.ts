import type {Person,Evidence} from './Investigations';
import type {SearchPerson} from './peopleModel';
import {personFacts} from './peopleModel.ts';
import {mergeSearchPeople} from './peopleMerge.ts';

type Prepared={fields:Record<string,unknown>;patch:Partial<Person>};
type Prepare=(payload:{fields:Record<string,unknown>;excluded:string[];current?:Person})=>Promise<Prepared>;
const personFields:Record<string,keyof Person>={name:'name',first_name:'firstName',last_name:'lastName',date_of_birth:'dateOfBirth',age:'age',gender:'gender',tax_code:'taxCode',phone:'phone',email:'email',username:'username',address:'address',postal_code:'postalCode',shipping:'shipping'};

function savedIdentity(person:Person):SearchPerson{
  const fields:Record<string,unknown>={...Object.fromEntries(Object.entries(personFields).map(([key,field])=>[key,person[field]])),phone:[person.phone,person.altPhone].filter(Boolean)};
  if(/^Person \d+$|^Unnamed person$/i.test(person.name))delete fields.name;
  const facts=personFacts({id:person.id,source:'Saved',fields});
  // Evidence may retain contacts omitted from the editable summary.
  for(const evidence of person.evidence)facts.push(...personFacts({id:evidence.id,source:evidence.source,fields:evidence.fields}).filter(f=>['email','phone','discord_id','steam_id','fivem_license','fivem_license2','xbl','live_id'].includes(f.key)));
  return {id:person.id,title:person.name,items:[{id:person.id,source:'Saved'}],details:facts.map(f=>({...f,confidence:50,explanation:'',sources:[],recordIds:[],conflict:false})),confidence:50,matchReasons:[],warnings:[]};
}

export function matchingSavedPerson(search:SearchPerson,people:Person[]):Person|undefined{
 const marker='incoming-identity',incoming={...search,items:[{id:marker,source:'Incoming'}]};
 const identities=people.map(savedIdentity);
 const group=mergeSearchPeople([...identities,incoming]).find(person=>person.items.some(item=>item.id===marker));
 const matches=people.filter(person=>group?.items.some(item=>item.id===person.id));
 return matches.length===1?matches[0]:undefined;
}

export async function mergeSavedPeople(people:Person[],prepare:Prepare,excluded:string[]):Promise<Person[]>{
 const result:Person[]=[];
 for(const group of mergeSearchPeople(people.map(savedIdentity))){
  const ids=new Set(group.items.map(item=>item.id)),members=people.filter(person=>ids.has(person.id));
  if(members.length===1){result.push(members[0]);continue}
  const current=members.find(person=>savedIdentity(person).details.some(d=>['name','first_name','last_name'].includes(d.key)))||members[0];
  const merged=await exportSearchPerson({...group,items:[]},current,prepare,excluded,'');
  merged.notes=[...new Set(members.map(person=>person.notes).filter(Boolean))].join('\n\n');
  merged.evidence=[...new Map(members.flatMap(person=>person.evidence).map(evidence=>[evidence.id,evidence])).values()];
  const categories=[...merged.customCategories||[],...members.flatMap(person=>person.customCategories||[])];
  merged.customCategories=[...new Map(categories.map(category=>[category.label+'\0'+category.value,category])).values()];
  result.push(merged);
 }
 return result;
}

export async function exportSearchPerson(search:SearchPerson,current:Person,prepare:Prepare,excluded:string[],query:string):Promise<Person>{
 const values:Record<string,string[]>={};
 for(const detail of search.details)(values[detail.key]??=[]).push(detail.value);
 const fields:Record<string,unknown>=Object.fromEntries(Object.entries(values).map(([key,list])=>[key,['phone','email','username'].includes(key)||!personFields[key]?list:list[0]]));
 // Apply the same exclusions as single-record saving before creating any fields.
 const combined=await prepare({fields,excluded,current});
 const patch:Partial<Person>={};
 for(const [key,value] of Object.entries(combined.patch)){
  if(['phone','email','username','altPhone'].includes(key)||!(current as any)[key]||(key==='name'&&/^Person \d+$|^Unnamed person$/i.test(current.name)))(patch as any)[key]=value;
 }
 const customCategories=[...(current.customCategories||[])];
 for(const [key,raw] of Object.entries(combined.fields)){
  const details=search.details.filter(d=>d.key===key);if(!details.length)continue;
  const alternatives=personFields[key]&&values[key].length>1&&!['phone','email','username'].includes(key);
  if(personFields[key]&&!alternatives)continue;
  // Never recover excluded alternatives from the unfiltered source facts.
  const extra=alternatives?await prepare({fields:{[key]:values[key]},excluded}):null;
  const exported=extra?extra.fields[key]:raw;if(exported==null)continue;
  const label=(alternatives?'Alternative ':'')+details[0].label;
  const value=(Array.isArray(exported)?exported:[exported]).map(String).join(', ');
  if(!customCategories.some(c=>c.label===label&&c.value===value))customCategories.push({id:crypto.randomUUID(),label,value});
 }
 const evidence:Evidence[]=[...current.evidence];
 for(const item of search.items){
  if(evidence.some(e=>e.originId===item.id&&e.query===query))continue;
  const prepared=await prepare({fields:item.fields||{},excluded});
  evidence.push({id:crypto.randomUUID(),originId:item.id,source:item.source,query,savedAt:new Date().toISOString(),fields:prepared.fields});
 }
 const context=search.reviewContext?await prepare({fields:{notes:search.reviewContext},excluded}):null;
 const note=typeof context?.fields.notes==='string'?context.fields.notes:'';
 const notes=note&&!current.notes.includes(note)?[current.notes,note].filter(Boolean).join('\n\n'):current.notes;
 return {...current,...patch,customCategories,evidence,notes};
}
