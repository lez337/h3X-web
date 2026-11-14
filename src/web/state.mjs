export function blank(){return {version:1,cases:[],pins:[],links:[],shortcuts:[],bots:[],settings:{rememberProviders:true,selectedProviders:['github','rdap'],oathFamily:'both',pageSize:20,brixField:'auto',flexible:false,redaction:true,usernameSearchOptions:{schemaVersion:2,limit:100,concurrency:10,category:'',siteFilter:''},deepSearchOptions:{ghunt:false}}};}
export function validateState(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid workspace.');
  const state=blank();
  for(const key of ['cases','pins','links','shortcuts','bots']){
    if(!Array.isArray(value[key])||value[key].length>1000||value[key].some(item=>!item||typeof item!=='object'||Array.isArray(item)))throw Error(`Invalid ${key} list.`);
    state[key]=value[key];
  }
  if(!value.settings||typeof value.settings!=='object'||Array.isArray(value.settings))throw Error('Invalid workspace settings.');
  state.settings={...state.settings,...value.settings,autoExport:false};
  if(new TextEncoder().encode(JSON.stringify(state)).length>8*1024*1024)throw Error('Workspace exceeds 8 MB.');
  return state;
}
