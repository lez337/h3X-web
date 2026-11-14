import {frenchPhone,isFrenchPhoneContext,phoneDigits,phoneKeys,preferredPhones} from './phoneIdentity.ts';
export type PeopleItem = {id:string;source:string;profileType?:string;fields?:Record<string,unknown>};
export type PersonDetail = {key:string;label:string;value:string;confidence:number;explanation:string;sources:string[];recordIds:string[];conflict:boolean};
export type SearchPerson = {id:string;title:string;items:PeopleItem[];details:PersonDetail[];confidence:number;matchReasons:string[];warnings:string[];reviewContext?:string};
export type PersonFact = {key:string;label:string;value:string;normalized:string};
type Fact = PersonFact;
type RecordInfo = {item:PeopleItem;facts:Fact[];emails:Set<string>;phones:Set<string>;births:Set<string>;names:Set<string>};
const keyName=(key:string)=>key.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase().replace(/[\s.-]+/g,'_');
const aliases:Record<string,string>={
 name:'name',full_name:'name',fullname:'name',real_name:'name',nom_affichage:'name',nom_complet:'name',display_name:'name',
 first_name:'first_name',firstname:'first_name',given_name:'first_name',prenom:'first_name',
 last_name:'last_name',lastname:'last_name',surname:'last_name',nom:'last_name',nom_famille:'last_name',
 email:'email',emails:'email',email_address:'email',email_addresses:'email',mail:'email',mails:'email',e_mail:'email',adresse_email:'email',
 phone:'phone',phones:'phone',phone_number:'phone',phone_numbers:'phone',phone_national:'phone',phone_international:'phone',international_number:'phone',local_number:'phone',e164:'phone',contact_phone:'phone',telephone:'phone',telephone_number:'phone',mobile:'phone',mobile_number:'phone',tel:'phone',cell_phone:'phone',alt_phone:'phone',alternate_phone:'phone',
 date_of_birth:'date_of_birth',date_birth:'date_of_birth',dob:'date_of_birth',birth_date:'date_of_birth',birthdate:'date_of_birth',date_naissance:'date_of_birth',date_de_naissance:'date_of_birth',
 address:'address',addresses:'address',address_street:'address',street_address:'address',home_address:'address',adresse:'address',indirizzo:'address',
 username:'username',usernames:'username',user_name:'username',login:'username',nom_utilisateur:'username',
 city:'city',ville:'city',country:'country',country_code:'country',countrycode:'country',country_iso:'country',country_iso2:'country',pays:'country',postal_code:'postal_code',postcode:'postal_code',zip_code:'postal_code',code_postal:'postal_code',cap:'postal_code',
 tax_code:'tax_code',codice_fiscale:'tax_code',codice_fis:'tax_code',age:'age',years_old:'age',
};
const labels:Record<string,string>={name:'Full name',first_name:'First name',last_name:'Last name',email:'Email',phone:'Phone',date_of_birth:'Date of birth',address:'Address',username:'Username',city:'City',country:'Country',postal_code:'Postal code',tax_code:'Tax code',age:'Age'};
const singular=new Set(['name','first_name','last_name','date_of_birth','tax_code','age']);
const ignored=/^(?:password|passwd|pwd|token|access_token|refresh_token|secret|cookie|cookies|session|authorization|api_key|output|response|raw|raw_response)$/;
// Activity and provider diagnostics belong on their source cards, not a person.
const activityField=/(?:^|_)(?:maps?|reviews?|ratings?|statistics|stats|contributions?|photos?|avatars?|banners?|calendar|play_games|output|response)(?:_|$)/;
const missing=/^(?:null|undefined|unknown|unavailable|none|n\/a|-|\[redacted[^\]]*\]|\*+|x{4,})$/i;
const normalizeText=(text:string)=>text.normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
// Compare complete names regardless of accents, separators or given/family order.
// A single name part is not enough to link records through a birth date.
const normalizeName=(text:string)=>{
 const parts=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/['’]/g,'').match(/[\p{L}\p{N}]+/gu)||[];
 return parts.length>=2?parts.sort().join(' '):'';
};
export function normalizePhone(value:string):string {
 if(!/^\+?[\d\s().-]+$/.test(value.trim()))return '';
 const digits=phoneDigits(value);
 return digits.length>=7&&digits.length<=15&&!/^(\d)\1+$/.test(digits)?digits:'';
}
export function normalizeBirthDate(value:string):string {
 let parts=value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T\d{2}:\d{2}.*)?$/),year:number,month:number,day:number;
 if(parts){year=+parts[1];month=+parts[2];day=+parts[3]}
 else {parts=value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);if(!parts)return '';day=+parts[1];month=+parts[2];year=+parts[3]}
 const date=new Date(Date.UTC(year,month-1,day));
 if(year<1850||date.getTime()>Date.now()||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return '';
 return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function extract(item:PeopleItem):RecordInfo {
 const facts:Fact[]=[],seen=new Set<string>(),french=isFrenchPhoneContext(item.fields);
 function add(key:string,label:string,value:unknown){
  if(value==null||typeof value==='object')return;
  const text=String(value).trim();if(!text||missing.test(text))return;
  let normalized=normalizeText(text),display=text;
  if(key==='name')normalized=normalizeName(text)||normalized;
  if(key==='first_name'||key==='last_name')normalized=normalized.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(key==='email') {if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))return;display=normalized}
  if(key==='phone'){display=frenchPhone(text,french);normalized=normalizePhone(display);if(!normalized)return}
  if(key==='date_of_birth'){normalized=normalizeBirthDate(text);if(normalized)display=normalized;else key='unparsed_birth_date'}
  const id=key+'\0'+normalized;if(seen.has(id)){
   if(key==='phone'){const existing=facts.find(f=>f.key===key&&f.normalized===normalized)!;existing.value=preferredPhones([existing.value,display]).get(normalized)||existing.value}
   return;
  }seen.add(id);facts.push({key,label,value:display,normalized});
 }
 function collect(key:string,label:string,value:unknown,depth:number){
  if(depth>10)return;
  if(Array.isArray(value)){value.forEach(v=>collect(key,label,v,depth+1));return}
  if(value&&typeof value==='object'){
   for(const [child,v] of Object.entries(value)){
    if(['value','number','address'].includes(keyName(child))&&['email','phone'].includes(key))collect(key,label,v,depth+1);
    else visit({[child]:v},key==='address'?'address':label,depth+1);
   }
   return;
  }
  if(typeof value==='string'&&['email','phone','username'].includes(key))value.split(/[,;\n]+/).forEach(v=>add(key,label,v));
  else add(key,label,value);
 }
 function visit(value:Record<string,unknown>,path='',depth=0){
  if(depth>10)return;
  const birthParts:Record<string,number>={};
  const partialBirthFields:[string,unknown][]=[];
  for(const [raw,v] of Object.entries(value)){
   const name=keyName(raw),base=name.replace(/_?\d+$/,''),canonical=aliases[name]||aliases[base];
   if(ignored.test(name)||activityField.test(name)||/(?:password|passwd|secret|cookie|token)/.test(name))continue;
   const part={jour_naissance:'day',birth_day:'day',day_of_birth:'day',mois_naissance:'month',birth_month:'month',month_of_birth:'month',annee_naissance:'year',birth_year:'year',year_of_birth:'year'}[name];
   if(part&&typeof v!=='object'&&v!=null){birthParts[part]=Number(v);partialBirthFields.push([raw,v]);continue}
   const key=canonical||(path?keyName(path)+'.':'')+name;
   const label=labels[key]||(path?path+' / ':'')+raw.replace(/[_-]/g,' ');
   collect(key,label,v,depth+1);
  }
  const date=birthParts.year&&birthParts.month&&birthParts.day?normalizeBirthDate(`${birthParts.year}-${birthParts.month}-${birthParts.day}`):'';
  if(date)add('date_of_birth','Date of birth',date);
  else for(const [raw,v] of partialBirthFields)collect((path?keyName(path)+'.':'')+keyName(raw),(path?path+' / ':'')+raw.replace(/[_-]/g,' '),v,depth+1);
 }
 visit(item.fields||{});
 const keys=phoneKeys(facts.filter(f=>f.key==='phone').map(f=>f.value));
 for(const fact of facts)if(fact.key==='phone')fact.normalized=keys.get(fact.value)||fact.normalized;
 const values=(key:string)=>new Set(facts.filter(f=>f.key===key).map(f=>f.normalized));
 const names=new Set(facts.filter(f=>f.key==='name'&&!/[\/@]/.test(f.value)).map(f=>normalizeName(f.value)).filter(Boolean));
 const first=values('first_name'),last=values('last_name');
 if(first.size===1&&last.size===1){const name=normalizeName([...first][0]+' '+[...last][0]);if(name)names.add(name)}
 return {item,facts,emails:values('email'),phones:values('phone'),births:values('date_of_birth'),names};
}
const intersects=(a:Set<string>,b:Set<string>)=>[...a].some(v=>b.has(v));
export function personFacts(item:PeopleItem):PersonFact[]{return extract(item).facts}
// Count provider families conservatively: repeated records and mirrored datasets
// from one provider do not become independent confirmations.
const sourceFamily=(source:string)=>normalizeText(source).split(/\s*[·|�]\s*|\s+-\s+/)[0].replace(/\s+(breach|stealer|profiles?|accounts?)$/,'');

export function groupPeople(items:PeopleItem[]):SearchPerson[] {
 const records=items.map(extract).filter(r=>r.emails.size||r.phones.size||r.births.size||r.facts.some(f=>['name','first_name','last_name'].includes(f.key)&&!/[\/@]/.test(f.value)&&!/^\S+\.\S+$/.test(f.value)));
 // Resolve phone aliases across sources before building the identity links.
 const sharedPhoneKeys=phoneKeys(records.flatMap(r=>r.facts.filter(f=>f.key==='phone').map(f=>f.value)));
 for(const record of records){
  for(const fact of record.facts)if(fact.key==='phone')fact.normalized=sharedPhoneKeys.get(fact.value)||fact.normalized;
  record.phones=new Set(record.facts.filter(f=>f.key==='phone').map(f=>f.normalized));
 }
 const parent=records.map((_,i)=>i),warnings=records.map(()=>new Set<string>());
 const root=(i:number):number=>parent[i]===i?i:(parent[i]=root(parent[i]));
 const join=(a:number,b:number)=>{a=root(a);b=root(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b)};
 const edges:[number,number][]=[],index=new Map<string,number[]>();
 records.forEach((r,i)=>{
  const tokens=[...r.emails].map(v=>'e:'+v).concat([...r.phones].map(v=>'p:'+v));
  // Full names are already case-, accent- and order-independent. A missing
  // birth date must not split otherwise identical names into separate cards.
  for(const name of r.names)tokens.push('n:'+name);
  for(const token of tokens){const previous=index.get(token)||[];for(const j of previous)edges.push([j,i]);previous.push(i);index.set(token,previous)}
 });
 const pairs=[...new Map(edges.map(([a,b])=>[a+':'+b,[a,b] as [number,number]])).values()];
 for(const [a,b] of pairs){
  const x=records[a].births,y=records[b].births;
  if(x.size>1||y.size>1||(x.size&&y.size&&!intersects(x,y))){warnings[a].add('Shared contact with a different birth date; kept separate.');warnings[b].add('Shared contact with a different birth date; kept separate.');continue}
  if((!x.size&&!y.size)||(x.size&&y.size))join(a,b);
 }
 // Resolve undated components only when all their dated candidates agree. This
 // prevents an undated record from bridging people with different birth dates.
 const candidates=new Map<number,Set<number>>();
 for(const [a,b] of pairs){
  if(records[a].births.size>1||records[b].births.size>1)continue;
  const undated=!records[a].births.size?a:!records[b].births.size?b:-1;
  if(undated<0)continue;const dated=undated===a?b:a;if(!records[dated].births.size)continue;
  const key=root(undated),list=candidates.get(key)||new Set<number>();list.add(root(dated));candidates.set(key,list);
 }
 for(const [component,dated] of candidates){
  const births=new Set([...dated].flatMap(i=>[...records[i].births]));
  if(births.size>1){for(let i=0;i<records.length;i++)if(root(i)===component||dated.has(root(i)))warnings[i].add('Ambiguous shared contact: an undated record matches different birth dates.');continue}
  for(const target of dated)join(component,target);
 }
 const groups=new Map<number,number[]>();records.forEach((_,i)=>{const key=root(i),group=groups.get(key)||[];group.push(i);groups.set(key,group)});
 return [...groups.values()].map(members=>{
  const entries=members.map(i=>records[i]);
  const phoneAliases=phoneKeys(entries.flatMap(r=>r.facts.filter(f=>f.key==='phone').map(f=>f.value)));
  for(const r of entries)for(const fact of r.facts)if(fact.key==='phone')fact.normalized=phoneAliases.get(fact.value)||fact.normalized;
  const preferred=preferredPhones([...phoneAliases.keys()]);
  const byField=new Map<string,Map<string,{fact:Fact;records:RecordInfo[]}>>();
  for(const r of entries)for(const fact of r.facts){const values=byField.get(fact.key)||new Map(),current=values.get(fact.normalized)||{fact,records:[]};if(!current.records.includes(r))current.records.push(r);values.set(fact.normalized,current);byField.set(fact.key,values)}
  const details:PersonDetail[]=[];
  for(const [key,values] of byField)for(const {fact,records:support} of values.values()){
   const sources=[...new Set(support.map(r=>r.item.source))],families=new Set(sources.map(sourceFamily)),conflict=singular.has(key)&&values.size>1;
   const confidence=Math.max(20,Math.min(95,50+15*Math.min(3,families.size-1)-(conflict?20:0)));
   details.push({key,label:fact.label,value:key==='phone'?preferred.get(fact.normalized)||fact.value:fact.value,confidence,sources,recordIds:[...new Set(support.map(r=>r.item.id))],conflict,explanation:`${families.size} provider ${families.size===1?'family':'families'}, ${support.length} supporting ${support.length===1?'record':'records'}. ${conflict?'Alternative values returned; confidence reduced. ':''}Heuristic support score; not verified accuracy.`});
  }
  const order=['name','first_name','last_name','date_of_birth','email','phone','username','age','address','city','postal_code','country'];
  details.sort((a,b)=>{const rank=(k:string)=>order.includes(k)?order.indexOf(k):100;return rank(a.key)-rank(b.key)||b.confidence-a.confidence||a.value.localeCompare(b.value)});
  const repeated=(kind:'emails'|'phones'|'births')=>entries.some((a,i)=>entries.slice(i+1).some(b=>intersects(a[kind],b[kind])));
  const sameNameAndBirth=entries.some((a,i)=>entries.slice(i+1).some(b=>intersects(a.names,b.names)&&intersects(a.births,b.births)));
  const sameName=entries.some((a,i)=>entries.slice(i+1).some(b=>intersects(a.names,b.names)));
  const matchReasons=[repeated('emails')?'Same email':'',repeated('phones')?'Same phone':'',sameNameAndBirth?'Same full name and birth date':sameName?'Same full name':'',repeated('births')&&entries.length>1?'Birth date agrees':''].filter(Boolean);
  const groupWarnings=[...new Set(members.flatMap(i=>[...warnings[i]]))];
  if(entries.some(r=>r.births.size>1))groupWarnings.push('Multiple birth dates in one source record; automatic matching disabled.');
  if(details.some(d=>d.conflict))groupWarnings.push('Conflicting details are shown as alternatives.');
  const title=details.find(f=>f.key==='name')?.value||[details.find(f=>f.key==='last_name')?.value,details.find(f=>f.key==='first_name')?.value].filter(Boolean).join(' ')||details.find(f=>f.key==='email'||f.key==='phone')?.value||'Unnamed person';
  let confidence=entries.length===1?35:repeated('emails')&&repeated('phones')?90:repeated('emails')?80:70;
  if(entries.length>1&&repeated('births'))confidence+=5;
  if(groupWarnings.length)confidence-=15;
  return {id:entries.map(r=>r.item.id).sort().join('|'),title,items:entries.map(r=>r.item),details,confidence:Math.max(20,Math.min(95,confidence)),matchReasons,warnings:groupWarnings};
 });
}
