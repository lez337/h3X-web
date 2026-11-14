import type {Person} from './Investigations';
import {isFrenchPhoneContext,uniquePhoneFields} from './phoneIdentity.ts';

// Explicit merges retain the selected person's identity and preserve conflicts.
export function mergeInvestigationPeople(target:Person,source:Person):Person {
 const merged:Person={...target};
 const categories=[...(target.customCategories||[]),...(source.customCategories||[])];
 const labels:Record<string,string>={name:'Full name',lastName:'Last name',firstName:'First name',age:'Age',gender:'Gender',dateOfBirth:'Date of birth',taxCode:'Codice Fis.',address:'Home address',postalCode:'Postal code',shipping:'Shipping address'};
 for(const key of Object.keys(labels) as (keyof Person)[]){
  const current=String(target[key]||'').trim(),incoming=String(source[key]||'').trim();
  if(!incoming)continue;
  if(!current||(key==='name'&&/^(Person \d+|Unnamed person)$/i.test(current))){(merged as any)[key]=incoming;continue}
  if(current.toLowerCase()!==incoming.toLowerCase())categories.push({id:crypto.randomUUID(),label:'Alternative '+labels[key],value:incoming});
 }
 const combine=(values:string[])=>[...new Map(values.flatMap(v=>v.split(/[,;\n]+/)).map(v=>v.trim()).filter(Boolean).map(v=>[v.toLowerCase(),v])).values()].join(', ');
 merged.email=combine([target.email||'',source.email||'']);
 merged.username=combine([target.username||'',source.username||'']);
 Object.assign(merged,uniquePhoneFields([target.phone,source.phone].filter(Boolean).join(', '),[target.altPhone,source.altPhone].filter(Boolean).join(', '),isFrenchPhoneContext([target,source])));
 merged.notes=[...new Set([target.notes,source.notes].filter(Boolean))].join('\n\n');
 merged.evidence=[...new Map([...(target.evidence||[]),...(source.evidence||[])].map(e=>[e.id,e])).values()];
 merged.customCategories=[...new Map(categories.map(c=>[c.label.trim().toLowerCase()+'\0'+c.value.trim().toLowerCase(),c])).values()];
 return merged;
}
