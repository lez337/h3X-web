const names=new Map<string,string>();
const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
// Intl supplies localized country names without a network lookup.
for(const locale of ['en','fr','de','es','it','pt']){
 const display=new Intl.DisplayNames([locale],{type:'region'});
 for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){
  const code=String.fromCharCode(a,b),name=display.of(code);
  if(new Intl.Locale('und-'+code).region===code&&name&&name!==code&&!['EU','UN','EZ','QO','XA','XB','ZZ'].includes(code)){names.set(normalize(name),code);names.set(code.toLowerCase(),code)}
 }
}
for(const [name,code] of Object.entries({uk:'GB',usa:'US',england:'GB',scotland:'GB',wales:'GB',holland:'NL','south korea':'KR','north korea':'KP',russia:'RU'}))names.set(name,code);
export function countryCode(value:unknown):string|undefined {
 return typeof value==='string'?names.get(normalize(value)):undefined;
}
export function suppliedCountries(value:unknown):string[]{
 const found=new Set<string>();
 const countryKey=/^(country|countryname|countrycode|countrycode2|countryiso|countryiso2|countryisocode|countryiso2code|countryalpha2|countryalpha2code|pays)$/i;
 const compact=(key:string)=>key.replace(/[_.\s-]/g,'');
 function addCountry(v:unknown,depth:number){
  if(depth>10)return;
  if(Array.isArray(v)){v.forEach(entry=>addCountry(entry,depth+1));return}
  const code=countryCode(v);if(code){found.add(code);return}
  if(v&&typeof v==='object')for(const [key,entry] of Object.entries(v)){
   if(countryKey.test(compact(key))||/^(name|code|iso|iso2|isocode|iso2code|alpha2|alpha2code)$/i.test(compact(key)))addCountry(entry,depth+1);
  }
 }
 function visit(v:unknown,depth=0){
  if(depth>10||!v||typeof v!=='object')return;
  if(Array.isArray(v)){v.forEach(x=>visit(x,depth+1));return}
  for(const [key,entry] of Object.entries(v)){
   if(countryKey.test(compact(key))){
    addCountry(entry,depth+1);
   }else if(typeof entry==='object')visit(entry,depth+1);
  }
 }
 visit(value);return [...found];
}
