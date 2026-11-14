// Match trunk-prefix variants; require one unambiguous international candidate.
export function isFrenchPhoneContext(value:unknown):boolean {
 if(Array.isArray(value))return value.some(isFrenchPhoneContext);
 if(!value||typeof value!=='object')return false;
 const entries=Object.entries(value);
 const french=(v:unknown):boolean=>Array.isArray(v)?v.some(french):typeof v==='string'&&/^(fr|fra|france|français|francais|french)$/i.test(v.trim());
 if(entries.some(([key,v])=>/^(country|countryname|countrycode|countryiso|countryiso2|countryalpha2|pays)$/i.test(key.replace(/[_\s.-]/g,''))&&french(v)))return true;
 if('label' in value&&'value' in value&&/^(country|country code|pays)$/i.test(String(value.label))&&french(value.value))return true;
 return entries.some(([,v])=>v&&typeof v==='object'&&isFrenchPhoneContext(v));
}
export function frenchPhone(value:string,french=false):string {
 const text=value.trim(),digits=phoneDigits(text);
 if(!/^\+?[\d\s().-]+$/.test(text))return value;
 if(/^(?:\+|00)/.test(text)&&!/^33[1-9]\d{8}$/.test(digits))return value;
 if(/^33[1-9]\d{8}$/.test(digits))return french||!text.startsWith('+')?'+'+digits:value;
 if(french&&/^0?[1-9]\d{8}$/.test(digits))return '+33'+digits.replace(/^0/,'');
 return value;
}
export function phoneDigits(value:string):string {
 return value.trim().replace(/^(\+|00)(\d{1,3})\s*\(0\)/,'$1$2').replace(/\D/g,'').replace(/^00/,'');
}
export function phoneKeys(values:string[]):Map<string,string>{
 const digits=values.map(phoneDigits);
 const international=values.filter(v=>/^(\+|00)/.test(v.trim())).map(phoneDigits);
 return new Map(values.map((v,i)=>{
  const d=digits[i];
  if(/^(\+|00)/.test(v.trim()))return [v,d];
  const local=d.startsWith('0')?d.slice(1):d;
  const candidates=[...new Set(international.filter(n=>n===d||(/^\d{8,12}$/.test(local)&&n.endsWith(local)&&n.length-local.length>=1&&n.length-local.length<=3)))];
  const national=/^\d{8,12}$/.test(local)&&digits.includes('0'+local)?'0'+local:d;
  return [v,candidates.length===1?candidates[0]:candidates.length?d:national];
 }));
}
export function preferredPhones(values:string[]):Map<string,string>{
 const keys=phoneKeys(values),preferred=new Map<string,string>();
 const rank=(v:string)=>v.startsWith('+')?2:v.startsWith('00')?1:0;
 for(const value of values){const key=keys.get(value);if(!key)continue;const current=preferred.get(key);if(!current||rank(value)>rank(current))preferred.set(key,value)}
 return preferred;
}
export function uniquePhones(value:string,exclude=''):string {
 const values=value.split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean),excluded=exclude.split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean);
 const keys=phoneKeys([...values,...excluded]),seen=new Set(excluded.map(v=>keys.get(v)));
 const preferred=preferredPhones([...values,...excluded]);
 return values.flatMap(v=>{const k=keys.get(v);if(!k||seen.has(k))return [];seen.add(k);return [preferred.get(k)!]}).join(', ');
}
export function uniquePhoneFields(phone:string,altPhone='',french=false):{phone:string;altPhone:string}{
 const format=(v:string)=>v.split(/[,;\n]+/).map(n=>frenchPhone(n.trim(),french)).join(', ');
 phone=format(phone);altPhone=format(altPhone);
 const values=[phone,altPhone].flatMap(v=>v.split(/[,;\n]+/).map(n=>n.trim()).filter(Boolean)),keys=phoneKeys(values),preferred=preferredPhones(values);
 const primary=phone.split(/[,;\n]+/).map(n=>n.trim()).filter(Boolean).map(v=>preferred.get(keys.get(v)!)||v).join(', ');
 return {phone:uniquePhones(primary),altPhone:uniquePhones(altPhone,primary)};
}
