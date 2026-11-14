import type {Case} from './Investigations';
import {resultLocations} from './mapLocations.ts';
import {visibleFields} from './fieldVisibility.ts';

export type InvestigationLocation={id:string;address:string;members:{caseId:string;personId:string;name:string}[]};
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
function cityOf(fields:Record<string,unknown>):string{
 for(const [key,value] of Object.entries(fields)){
  if(!/^(city|town|ville|locality|municipality|comune|addresscity|homecity|residentialcity)$/.test(key.toLowerCase().replace(/[\s_.-]/g,'')))continue;
  for(const entry of Array.isArray(value)?value:[value])if(typeof entry==='string'&&entry.trim()&&!/^(null|unknown|\[redacted[^\]]*\])$/i.test(entry.trim()))return entry.trim();
 }
 return '';
}

// Keep the owning case and person even when addresses overlap across investigations.
export function investigationLocations(cases:Case[],hiddenFields:string[]=[]):InvestigationLocation[]{
 const groups=new Map<string,InvestigationLocation>();
 for(const record of cases)for(const person of record.people||[]){
  const fields=visibleFields(Object.fromEntries(Object.entries({address:person.address,shipping_address:person.shipping,postal_code:person.postalCode}).filter(([,v])=>!!v)),hiddenFields);
  const categories=visibleFields(Object.fromEntries((person.customCategories||[]).map(c=>[c.label,c.value])),hiddenFields);
  const evidence=(person.evidence||[]).map(e=>({id:e.id,fields:visibleFields(e.fields,hiddenFields) as Record<string,unknown>}));
  const home=normalize(person.address||'');
  // Recover the city from the record for this address, rather than an unrelated address.
  const matching=evidence.find(item=>cityOf(item.fields)&&home&&resultLocations([item]).some(l=>normalize(l.address)===home||normalize(l.address).startsWith(home+', ')));
  const city=cityOf(categories)||cityOf(matching?.fields||{})||cityOf(evidence.find(item=>cityOf(item.fields)&&!resultLocations([item]).length)?.fields||{});
  const withCity=(value:Record<string,unknown>)=>{const ownCity=cityOf(value);return ownCity||city?{...value,city:ownCity||city}:value;};
  const items=[{id:person.id,fields:withCity(fields)},{id:person.id,fields:withCity(categories)},...evidence.map(e=>({...e,fields:withCity(e.fields)}))];
  // One location per person: prefer the editable home address, then the first saved alternative.
  const location=resultLocations(items)[0];
  if(location){
   const group=groups.get(location.id)||{id:location.id,address:location.address,members:[]};
   if(!group.members.some(m=>m.caseId===record.id&&m.personId===person.id))group.members.push({caseId:record.id,personId:person.id,name:person.name||'Unnamed person'});
   groups.set(location.id,group);
  }
 }
 return [...groups.values()];
}
