import type {PersonDetail,SearchPerson} from './peopleModel';

export const peopleCommands = [
 {name:'inname',example:'/inname "alx"',description:'Name contains your letters in order, even with gaps'},
 {name:'name',example:'/name "alex"',description:'Name contains this text'},
 {name:'email',example:'/email "@example.org"',description:'Email contains this text'},
 {name:'phone',example:'/phone "0142"',description:'Phone contains these digits'},
 {name:'username',example:'/username "alex"',description:'Username contains this text'},
 {name:'address',example:'/address "paris"',description:'Street, city, postal code or country'},
 {name:'dob',example:'/dob "1990"',description:'Birth date contains this text'},
 {name:'age',example:'/age 18-30',description:'Age: exact number, range, or comparison (>=18)'},
 {name:'source',example:'/source "provider"',description:'Supporting source contains this text'},
 {name:'has',example:'/has "email"',description:'Has a field (name, email, phone, etc.)'},
 {name:'confidence',example:'/confidence 65',description:'Minimum record-match support score'},
] as const;
type Clause={command:string;value:string;exclude:boolean};
export type PeopleQuery={clauses:Clause[];error:string};
export const searchText=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const names=new Set(['name','first_name','last_name']);
const addresses=new Set(['address','city','postal_code','country']);
const fieldAlias:Record<string,string>={dob:'date_of_birth',birth:'date_of_birth',birthdate:'date_of_birth',mail:'email',user:'username',tel:'phone',firstname:'first_name',lastname:'last_name',postcode:'postal_code'};

export function parsePeopleQuery(input:string):PeopleQuery {
 const clauses:Clause[]=[];let pos=0;
 const fail=(error:string)=>({clauses:[],error});
 const value=():string|null=>{
  if(input[pos]==='"'||input[pos]==="'"){
   const quote=input[pos++];let text='';
   while(pos<input.length){const char=input[pos++];if(char===quote)return text;if(char==='\\'&&(input[pos]===quote||input[pos]==='\\'))text+=input[pos++];else text+=char}
   return null;
  }
  const start=pos;while(pos<input.length&&!/\s/.test(input[pos]))pos++;return input.slice(start,pos);
 };
 while(pos<input.length){
  while(/\s/.test(input[pos]||'')&&pos<input.length)pos++;if(pos>=input.length)break;
  let exclude=false;if(input[pos]==='-'&&input[pos+1]&&!/\s/.test(input[pos+1])){exclude=true;pos++}
  let command='text';
  if(input[pos]==='/'){
   pos++;const start=pos;while(pos<input.length&&/[a-z_]/i.test(input[pos]))pos++;
   command=input.slice(start,pos).toLowerCase();
   if(!peopleCommands.some(c=>c.name===command))return fail(`Unknown command /${command}. Open the command guide to choose a filter.`);
   if(pos<input.length&&!/\s/.test(input[pos]))return fail(`Use a space after /${command}.`);
   while(pos<input.length&&/\s/.test(input[pos]))pos++;
   if(pos>=input.length||/^\/?-?\//.test(input.slice(pos)))return fail(`Add a value after /${command}, for example ${peopleCommands.find(c=>c.name===command)?.example}.`);
  }
  const text=value();if(text===null)return fail('Close the quotation mark to finish this filter.');
  if(!text.trim())return fail('Enter a non-empty filter value.');
  if(pos<input.length&&!/\s/.test(input[pos]))return fail('Separate filters with a space.');
  if(command==='confidence'&&(!/^\d{1,3}$/.test(text)||+text>100))return fail('Confidence must be a whole number from 0 to 100.');
  if(command==='age'&&!/^(?:\d{1,3}|(?:>=|<=|>|<|=)\d{1,3}|\d{1,3}-\d{1,3})$/.test(text))return fail('Use /age 25, /age 18-30, or /age >=18.');
  if(command==='age'&&text.includes('-')&&+text.split('-')[0]>+text.split('-')[1])return fail('The age range must start with the younger age.');
  clauses.push({command,value:text,exclude});
 }
 return {clauses,error:''};
}

export function orderedLetterIndices(value:string,needle:string):number[] {
 // Index original characters so accent folding never breaks highlighted text.
 const wanted=[...searchText(needle).replace(/\s/g,'')];if(!wanted.length)return [];
 const found:number[]=[];let index=0;
 for(let i=0;i<value.length&&index<wanted.length;i++){if(searchText(value[i])===wanted[index]){found.push(i);index++}}
 return index===wanted.length?found:[];
}
function fieldsFor(person:SearchPerson,command:string):PersonDetail[]{
 return person.details.filter(d=>command==='inname'||command==='name'?names.has(d.key):command==='address'?addresses.has(d.key):d.key===(fieldAlias[command]||command));
}
export function matchesPeopleQuery(person:SearchPerson,query:PeopleQuery):boolean {
 if(query.error)return false;
 return query.clauses.every(clause=>{
  const {command,value}=clause,needle=searchText(value);
  let match=false;
  if(command==='text')match=[person.title,...person.details.flatMap(d=>[d.label,d.value]),...person.items.map(i=>i.source)].some(v=>searchText(v).includes(needle));
  else if(command==='source')match=person.items.some(i=>searchText(i.source).includes(needle));
  else if(command==='confidence')match=person.confidence>=+value;
  else if(command==='age'){
   const today=new Date(),births=person.details.filter(d=>d.key==='date_of_birth').map(d=>new Date(d.value+'T00:00:00Z'));
   const ages=births.length?births.map(b=>today.getUTCFullYear()-b.getUTCFullYear()-(today.getUTCMonth()<b.getUTCMonth()||(today.getUTCMonth()===b.getUTCMonth()&&today.getUTCDate()<b.getUTCDate())?1:0)):person.details.filter(d=>d.key==='age'&&/^\d{1,3}$/.test(d.value)).map(d=>+d.value);
   match=ages.some(age=>{
    if(value.includes('-')){const [min,max]=value.split('-').map(Number);return age>=min&&age<=max}
    const [,op='',amount]=value.match(/^(>=|<=|>|<|=)?(\d+)$/)!;const n=+amount;
    return op==='>='?age>=n:op==='<='?age<=n:op==='>'?age>n:op==='<'?age<n:age===n;
   });
  }
  else if(command==='has'){
   const field=searchText(value).replace(/[\s-]+/g,'_');
   match=person.details.some(d=>d.key===(fieldAlias[field]||field)||(field==='name'&&names.has(d.key))||(field==='address'&&addresses.has(d.key))||searchText(d.label).replace(/\s+/g,'_')===field);
  }else{
   const values=fieldsFor(person,command).map(d=>d.value);
   if((command==='name'||command==='inname')&&values.length)values.push(person.title,[person.details.find(d=>d.key==='first_name')?.value,person.details.find(d=>d.key==='last_name')?.value].filter(Boolean).join(' '));
   if(command==='inname')match=values.some(v=>orderedLetterIndices(v,value).length>0);
   else if(command==='phone'){
    const digits=value.replace(/\D/g,'');match=!!digits&&values.some(v=>v.replace(/\D/g,'').includes(digits));
   }else match=values.some(v=>searchText(v).includes(needle));
  }
  return clause.exclude?!match:match;
 });
}

export function peopleHighlightIndices(value:string,query:PeopleQuery,key?:string):Set<number>{
 const indices=new Set<number>();
 if(query.error)return indices;
 for(const clause of query.clauses){
  if(clause.exclude||['has','confidence','source'].includes(clause.command))continue;
  const c=clause.command;
  if(c!=='text'&&!(c==='inname'||c==='name'?key&&names.has(key):c==='address'?key&&addresses.has(key):key===(fieldAlias[c]||c)))continue;
  if(c==='inname')orderedLetterIndices(value,clause.value).forEach(i=>indices.add(i));
  else{
   let folded='',map:number[]=[];
   for(let i=0;i<value.length;i++){const part=searchText(value[i]);folded+=part;map.push(...Array(part.length).fill(i))}
   const needle=searchText(clause.value);let at=0;
   while(needle&&(at=folded.indexOf(needle,at))!==-1){for(let i=at;i<at+needle.length;i++)indices.add(map[i]);at+=needle.length}
  }
 }
 return indices;
}
