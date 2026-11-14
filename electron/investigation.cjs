'use strict';
const {isFrenchPhoneContext,uniquePhones,uniquePhoneFields}=require('./phone-identity.cjs');
const defaults=['id','*_id','es_ids','timestamp','timestamps','created_at','updated_at','indexed_at','saved_at','createdAt','updatedAt','savedAt','password','token','cookie','session'];
const normalize=k=>String(k).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase().replace(/[\s.-]+/g,'_').replace(/^_+|_+$/g,'');
function clean(fields,excluded=defaults){
 const patterns=excluded.map(k=>new RegExp('^'+normalize(k).split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$','i'));
 const visit=v=>Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!patterns.some(p=>p.test(normalize(k)))).map(([k,v])=>[k,visit(v)])):v;
 return visit(fields||{});
}
function uniqueValues(values,kind){
 if(kind==='phone')return uniquePhones(values.map(v=>String(v??'')).join(', '));
 const seen=new Set();return values.flatMap(v=>String(v??'').split(/[,;\n]+/)).map(v=>v.trim()).filter(Boolean).filter(v=>{const id=kind==='phone'?v.replace(/\D/g,''):v.toLowerCase();if(!id||seen.has(id))return false;seen.add(id);return true}).join(', ');
}
function birthDate(value){
 const text=String(value??'').trim();let match=text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T.*)?$/),y,m,d;
 if(match)[,y,m,d]=match;else{match=text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);if(!match)return '';[,d,m,y]=match}
 const date=new Date(Date.UTC(+y,+m-1,+d));if(+y<1850||date.getUTCFullYear()!==+y||date.getUTCMonth()!==+m-1||date.getUTCDate()!==+d||date>Date.now())return '';
 return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function mergeDetails(current,patch){
 const result={...patch};
 for(const field of ['phone','email','username','altPhone'])if(patch[field])result[field]=uniqueValues([current?.[field],patch[field]],/phone/i.test(field)?'phone':field);
 if(result.phone||result.altPhone||current?.altPhone)Object.assign(result,uniquePhoneFields(result.phone??current?.phone??'',result.altPhone??current?.altPhone??''))
 return result;
}
function prepare(fields,excluded,current){
 const filtered=clean(fields,excluded),patch={},multi={phone:[],email:[],username:[],altPhone:[]},parts={};
 const aliases={name:'name',full_name:'name',fullname:'name',nom_affichage:'name',first_name:'firstName',firstname:'firstName',given_name:'firstName',prenom:'firstName',last_name:'lastName',lastname:'lastName',surname:'lastName',nom:'lastName',nom_famille:'lastName',gender:'gender',sex:'gender',sexe:'gender',genre:'gender',age:'age',years_old:'age',eta:'age',username:'username',user_name:'username',usernames:'username',login:'username',nom_utilisateur:'username',phone:'phone',phones:'phone',phone_number:'phone',phone_numbers:'phone',phone_national:'phone',phone_international:'phone',international_number:'phone',local_number:'phone',e164:'phone',contact_phone:'phone',telephone:'phone',telephone_number:'phone',mobile:'phone',mobile_number:'phone',tel:'phone',cell_phone:'phone',email:'email',emails:'email',email_address:'email',email_addresses:'email',address:'address',address_street:'address',street_address:'address',home_address:'address',adresse:'address',date_of_birth:'dateOfBirth',date_birth:'dateOfBirth',dob:'dateOfBirth',birth_date:'dateOfBirth',birthdate:'dateOfBirth',date_naissance:'dateOfBirth',codice_fis:'taxCode',codice_fiscale:'taxCode',tax_code:'taxCode',alt_phone:'altPhone',alternate_phone:'altPhone',cap:'postalCode',postal_code:'postalCode',code_postal:'postalCode',shipping:'shipping',shipping_address:'shipping'};
 function scalar(field,v){if(v==null||!String(v).trim())return;const text=String(v).trim();if(field in multi){if(/phone/i.test(field)){for(const number of text.split(/[,;\n]+/).map(v=>v.trim()))if(/^\+?[\d ().-]{3,}$/.test(number))multi[field].push(number)}else multi[field].push(text)}else if(field==='dateOfBirth'){const date=birthDate(text);if(date)patch[field]=date}else if(field==='age'){const m=text.match(/^(\d{1,3})(?:\s*(?:years?(?: old)?|ans?|anni))?$/i);if(m&&+m[1]<=125)patch.age=String(+m[1])}else patch[field]=text}
 function collect(field,v){if(Array.isArray(v))v.forEach(x=>collect(field,x));else if(v&&typeof v==='object'){for(const [k,value] of Object.entries(v))if(/^(value|number|address|username|email|phone)$/i.test(k))collect(field,value)}else scalar(field,v)}
 function visit(obj){for(const [key,v] of Object.entries(obj||{})){const k=normalize(key).replace(/_?\d+$/,'');const field=aliases[k];if(field)collect(field,v);else if(v&&typeof v==='object')visit(v);if(['jour_naissance','birth_day','day_of_birth'].includes(k))parts.day=Number(v);if(['mois_naissance','birth_month','month_of_birth'].includes(k))parts.month=Number(v);if(['annee_naissance','birth_year','year_of_birth'].includes(k))parts.year=Number(v)}}
 visit(filtered);for(const [field,values] of Object.entries(multi)){const combined=uniqueValues(values,/phone/i.test(field)?'phone':field);if(combined)patch[field]=combined}
 if(!patch.dateOfBirth&&parts.year&&parts.month&&parts.day)patch.dateOfBirth=birthDate(`${parts.year}-${parts.month}-${parts.day}`);
 if(patch.dateOfBirth&&!patch.age){const today=new Date(),birth=new Date(patch.dateOfBirth+'T00:00:00Z');let age=today.getUTCFullYear()-birth.getUTCFullYear();if(today.getUTCMonth()<birth.getUTCMonth()||(today.getUTCMonth()===birth.getUTCMonth()&&today.getUTCDate()<birth.getUTCDate()))age--;if(age>=0&&age<=125)patch.age=String(age)}
 if(patch.name){const [surname,...given]=patch.name.split(/\s+/);patch.lastName??=surname;patch.firstName??=given.join(' ')}
 if(patch.lastName||patch.firstName)patch.name=[patch.lastName,patch.firstName].filter(Boolean).join(' ');
 const merged=mergeDetails(current,patch);
 if(merged.phone||merged.altPhone)Object.assign(merged,uniquePhoneFields(merged.phone||'',merged.altPhone||'',isFrenchPhoneContext(fields)||isFrenchPhoneContext(current)));
 return {fields:filtered,patch:merged};
}
function decorateText(text,settings={}){const top=String(settings.txtHeaderArt||'').slice(0,12000),bottom=String(settings.txtFooterArt||'').slice(0,12000);return [top,text.replace(/\s+$/,''),bottom].filter(Boolean).join('\r\n\r\n')+'\r\n'}
function hydrateRecord(record){return {...record,people:(record.people||[]).map(person=>{const stored={...person};delete stored.evidence;delete stored.customCategories;if(/^Person \d+$/.test(stored.name||''))delete stored.name;const details=prepare({evidence:(person.evidence||[]).map(e=>e.fields||{}),customCategories:person.customCategories,stored}).patch;return {...person,...details}})}}

const value=v=>typeof v==='object'?JSON.stringify(v):String(v??'');
const personLabels={name:'Full Name',dateOfBirth:'Date of Birth',taxCode:'Codice Fis.',phone:'Phone',altPhone:'Alt. Phone',address:'Address',postalCode:'CAP',shipping:'Shipping',lastName:'Last name',firstName:'First name',age:'Age',gender:'Gender',username:'Username',email:'Email',notes:'Person notes'};
// Aligned continuations are soft wraps; four-space continuations preserve user newlines.
function reportField(label,value,labelWidth=13){
 const prefix=label.padEnd(labelWidth)+' : ',lines=[];
 for(const [index,paragraph] of String(value??'').replace(/\r\n?/g,'\n').split('\n').entries()){
  let rest=paragraph,indent=index?'    ':prefix;
  while(indent.length+rest.length>80){
   const available=80-indent.length;
   let split=rest.lastIndexOf(' ',available);
   if(split<=0)split=rest.indexOf(' ');
   // Keep indivisible values such as URLs intact, even when they exceed the width.
   if(split<=0)break;
   lines.push(indent+rest.slice(0,split));rest=rest.slice(split+1);indent=' '.repeat(prefix.length);
  }
  lines.push(indent+rest);
 }
 return lines;
}
function textReport(record,excluded,settings={}){
 excluded=[...(excluded||defaults),...(settings.hiddenFields||[])];
 const lines=[];const rule='-'.repeat(80);
 const labelWidth=Math.max(13,...(record.people||[]).flatMap(person=>(clean(person,excluded).customCategories||[])
  .filter(c=>String(c.label||'').trim()&&String(c.value??'').trim()&&Object.keys(clean({[String(c.label).trim()]:c.value},excluded)).length)
  .map(c=>String(c.label).trim().length)));
 for(const original of record.people||[]){
  const p=clean(original,excluded);Object.assign(p,mergeDetails({}, {phone:p.phone,altPhone:p.altPhone}));const detail=prepare({records:(p.evidence||[]).map(e=>e.fields||{}),categories:Object.fromEntries((p.customCategories||[]).map(c=>[c.label,c.value]))},excluded).patch;
  Object.assign(p,uniquePhoneFields(p.phone||detail.phone||'',p.altPhone||detail.altPhone||'',isFrenchPhoneContext(original)));
  const name=String(p.name||detail.name||'Unnamed person').replace(/[\r\n]/g,' ');
  lines.push(rule,' '.repeat(Math.max(0,Math.floor((80-name.length)/2)))+name,rule,'');
  const section=(title,entries)=>{
   const populated=entries.filter(([,val])=>String(val??'').trim());
   if(!populated.length)return;
   lines.push(`--- ${title} ---`,'');
   for(const [label,val] of populated)lines.push(...reportField(label,val,labelWidth),'');
  };
  for(const [title,keys] of [
   ['IDENTITY',['name','lastName','firstName','age','gender']],
   ['ADDRESSES',['address']],
   ['CONTACTS',['email','phone','altPhone','username']],
   ['OTHER DETAILS',['dateOfBirth','taxCode','postalCode','shipping']]
  ])section(title,keys.map(key=>[personLabels[key],['phone','altPhone'].includes(key)?p[key]:(p[key]||detail[key]||'')]));
  section('ADDITIONAL DETAILS',(p.customCategories||[]).filter(c=>String(c.label||'').trim()).filter(c=>Object.keys(clean({[String(c.label).trim()]:c.value},excluded)).length>0).map(c=>[String(c.label).trim(),c.value]));
  section('PERSON NOTES',[[personLabels.notes,p.notes||detail.notes||'']]);
 }
 if(!(record.people||[]).length){const title=String(record.title||'Investigation').replace(/[\r\n]/g,' ');lines.push(rule,title,rule,'')}
 if(String(record.summary||'').trim()||String(record.notes||'').trim()){
  lines.push('--- CASE OVERVIEW ---','');
  if(String(record.summary||'').trim())lines.push(...reportField('Summary',record.summary,labelWidth),'');
  if(String(record.notes||'').trim())lines.push(...reportField('Notes',record.notes,labelWidth),'');
 }
 return decorateText(lines.join('\r\n'),settings);
}
function parseFormatted(text,excluded){
 const record={title:'Imported investigation',summary:'',notes:'',people:[]};let person,evidence,lastKey,lastCategory;const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/);
 const labels=Object.fromEntries(Object.entries(personLabels).map(([key,label])=>[label,key]));let metadata=false;
 let wrapIndent=16;
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(/^[^\s:][^:]* : /.test(line))wrapIndent=line.indexOf(' : ')+3;
  if(/^--- (IDENTITY|CONTACTS|ADDRESSES|ADDITIONAL DETAILS|PERSON NOTES|OTHER DETAILS|CASE OVERVIEW) ---$/.test(line)){lastKey=null;lastCategory=null;if(line==='--- CASE OVERVIEW ---'){metadata=true;person=null;evidence=null}continue}
  if(line.startsWith(' '.repeat(wrapIndent))&&(lastKey||lastCategory)){
   const target=metadata?record:person;
   if(lastCategory)lastCategory.value+=' '+line.slice(wrapIndent);
   else if(target)target[lastKey]+=' '+line.slice(wrapIndent);
   continue;
  }
  if(line==='-'.repeat(80)&&lines[i+2]==='-'.repeat(80)){if(record.title==='Imported investigation')record.title=lines[i+1].trim();person={evidence:[]};record.people.push(person);i+=2;lastKey=null;lastCategory=null;metadata=false;continue}
  if(line==='[INVESTIGATION]'){metadata=true;person=null;evidence=null;continue}
  if(line==='[EVIDENCE]'&&person){evidence={fields:{}};person.evidence.push(evidence);lastKey=null;continue}
  if(line==='[/EVIDENCE]'){evidence=null;continue}
  const readable=line.match(/^(Summary|Notes)\s{2,}: (.*)$/);if(readable&&!evidence){metadata=true;lastKey=readable[1].toLowerCase();record[lastKey]=readable[2];continue}
  if(evidence){const m=line.match(/^Field ("(?:\\.|[^"\\])*"): (.*)$/);if(m)evidence.fields[JSON.parse(m[1])]=JSON.parse(m[2]);else{const m=line.match(/^(Source|Query): (.*)$/);if(m)evidence[m[1].toLowerCase()]=JSON.parse(m[2])}continue}
  if(metadata){if(line.startsWith('    ')&&lastKey){record[lastKey]+='\n'+line.slice(4);continue}const m=line.match(/^(Title|Summary|Notes): (.*)$/);if(m)record[m[1].toLowerCase()]=JSON.parse(m[2]);continue}
  if(person){if(line.startsWith('    ')&&lastKey){person[lastKey]+='\n'+line.slice(4);continue}if(line.startsWith('    ')&&lastCategory){lastCategory.value+='\n'+line.slice(4);continue}const m=line.match(/^([^:]+?)\s*: (.*)$/);if(m){lastKey=labels[m[1].trim()];lastCategory=null;if(lastKey){if(m[2])person[lastKey]=m[2]}else{lastCategory={id:require('node:crypto').randomUUID(),label:m[1].trim(),value:m[2]};(person.customCategories??=[]).push(lastCategory)}}}
 }
 record.people=record.people.filter(p=>Object.keys(p).some(k=>k!=='evidence'));
 for(const p of record.people)for(const e of p.evidence)e.fields=clean(e.fields,excluded);
 return {record};
}
function parseText(text,excluded){
 if(text.includes('-'.repeat(80))||text.startsWith('[INVESTIGATION]'))return parseFormatted(text,excluded);
 if(!text.replace(/^\uFEFF/,'').startsWith('H3X INVESTIGATION\n')&&!text.replace(/^\uFEFF/,'').startsWith('H3X INVESTIGATION\r\n')){
 const fields={};for(const line of text.split(/\r?\n/)){const match=line.match(/^\s*([^:=]+)\s*[:=]\s*(.+)$/);if(match)fields[match[1].trim()]=match[2].trim()}return {fields:clean(fields,excluded)};
 }
 const record={title:'Imported investigation',summary:'',notes:'',people:[]};let person,evidence;
 const labels={'Title':'title','Summary':'summary','Notes':'notes','Full name':'name','Last name':'lastName','First name':'firstName','Age':'age','Username':'username','Phone':'phone','Email':'email','Address':'address','Person notes':'notes'};
 for(const line of text.split(/\r?\n/)){if(line==='[PERSON]'){person={evidence:[]};record.people.push(person)}else if(line==='[/PERSON]')person=null;else if(line==='[EVIDENCE]'&&person){evidence={fields:{}};person.evidence.push(evidence)}else if(line==='[/EVIDENCE]')evidence=null;else if(line.startsWith('Field ')&&evidence){const m=line.match(/^Field ("(?:\\.|[^"\\])*"): (.*)$/);if(m)evidence.fields[JSON.parse(m[1])]=JSON.parse(m[2])}else{const m=line.match(/^([^:]+): (.*)$/);if(!m)continue;const v=JSON.parse(m[2]);if(evidence){if(m[1]==='Source')evidence.source=v;if(m[1]==='Query')evidence.query=v}else if(labels[m[1]])(person||record)[labels[m[1]]]=v}}
 for(const p of record.people)for(const e of p.evidence)e.fields=clean(e.fields,excluded);
 return {record};
}
module.exports={defaults,clean,prepare,mergeDetails,textReport,parseText,decorateText,hydrateRecord};
