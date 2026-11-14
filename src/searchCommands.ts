type Command={name:string;hint:string;brix?:string;oath?:string;setting?:string;option?:string;username?:string;aliases?:string[]};
export const searchCommands:Command[]=[
 ...[
  ['name','Any name (BrixHub: all name fields)','nom_affichage','name','full_name'],['first_name','Given name','prenom','first_name','firstname'],['last_name','Surname','nom_famille','last_name','surname,lastname'],
  ['email','Email address','email','email'],['phone','Phone number','telephone','phone','tel'],['mobile','Mobile number','mobile','phone'],['username','Username','nom_utilisateur','username'],['ip','IP address','adresse_ip','ip'],
  ['address','Street address','adresse','address'],['city','City','ville','city'],['country','Country code','pays','country'],['postal_code','Postal code','code_postal','postal,zip'],['region','Region','region','state'],['department','Department','departement',''],
  ['dob','Birth date YYYY-MM-DD','date_naissance','date_birth','birthdate,date_birth'],['birth_year','Birth year','annee_naissance',''],['birth_month','Birth month','mois_naissance',''],['birth_day','Birth day','jour_naissance',''],['birth_city','Birth city','ville_naissance',''],['birth_name','Birth name','nom_naissance',''],['gender','M / F','genre',''],
  ['discord','Discord ID','discord_id','discord_id'],['steam','Steam ID','steam_id','gaming'],['license','FiveM license','fivem_license',''],['license2','FiveM license 2','fivem_license2',''],['xbl','Xbox Live ID','xbl',''],['live_id','Live ID','live_id',''],
  ['ssn','Social security number','nir','ssn'],['iban','IBAN','iban','iban'],['bic','BIC','bic',''],['vin','VIN / plate','vin',''],['company','Company','societe',''],['profession','Profession','profession',''],['role','Role','fonction',''],
  ...['email_domain','domain','subdomain','path','dbname','social','financial','gaming','password','hwid','log_id','source_type','password_hash','archive_hash','canonical_credential_id'].map(field=>[field,field.replace(/_/g,' ')+' (OathNet)','',''+field])
 ].map(([name,hint,brix,oath,aliases])=>({name,hint,brix:brix||undefined,oath:oath||undefined,aliases:[...(aliases||'').split(',').filter(Boolean),...(brix&&brix!==name?[brix]:[])]})),
 {name:'age',hint:'25, 18-30, >=18 (OathNet)'},
 ...[['type','Search type','searchQueryType'],['family','both / breach / stealer','oathFamily'],['page','Page number','page'],['limit','10 / 20 / 50 / 100 results','pageSize'],['flexible','on / off (BrixHub)','flexible'],['profiles','on / off (OathNet)','oathProfiles'],['services','discord,steam,xbox,roblox','oathProfileServices'],['cursor','Next page cursor','cursor']].map(([name,hint,setting])=>({name,hint,setting})),
 ...['sort','from','to','date_field','filter_id','view','wildcard','has_log_id','logic'].map(name=>({name,hint:name.replace(/_/g,' ')+' (OathNet)',option:name})),
 ...[['sites','all / number','limit'],['category','Username site category','category'],['site','Username site name or domain','siteFilter'],['concurrency','5 / 10 / 20 / max','concurrency']].map(([name,hint,username])=>({name,hint,username}))
];
const types=['auto','email','phone','discord','steam','address','name','first_name','last_name','username','ip','domain','roblox','text'];
function bool(value:string){if(/^(on|true|yes|1)$/i.test(value))return true;if(/^(off|false|no|0)$/i.test(value))return false;throw Error('Use on or off.');}
function integer(value:string,min:number,max:number){if(!/^\d+$/.test(value)||Number(value)<min||Number(value)>max)throw Error(`Use a whole number from ${min} to ${max}.`);return Number(value);}
export function parseSearchCommands(input:string,base:Record<string,any>,type='auto'){
 const settings:Record<string,any>={...base,searchQueryType:type,brixFilters:{...base.brixFilters},oathFilters:{...base.oathFilters},oathOptions:{...base.oathOptions},usernameSearchOptions:{limit:'all',category:'',siteFilter:'',concurrency:10,...(base.usernameSearchOptions?.schemaVersion===2?base.usernameSearchOptions:{}),schemaVersion:2}};
 const used:string[]=[],rules:any[]=[];let query='',error='';
 try{
  // Command boundaries only occur outside quoted values; URLs and slash paths stay intact.
  const boundaries:{start:number;end:number;name:string}[]=[];let quote='';
  for(let i=0;i<input.length;i++){
   const char=input[i];if(char==='\\'&&quote&&['\\',quote].includes(input[i+1])){i++;continue;}
   if(quote){if(char===quote)quote='';continue;}
   if(char==='"'||char==="'"){if(i===0||/\s/.test(input[i-1]))quote=char;continue;}
   if(char==='/'&&(i===0||/\s/.test(input[i-1]))){const match=input.slice(i).match(/^\/([a-z_][\w-]*)(?=\s|$)/i);if(match){boundaries.push({start:i,end:i+match[0].length,name:match[1].toLowerCase().replace(/-/g,'_')});i+=match[0].length-1;}}
  }
  if(!boundaries.length)return {query:input.trim(),settings,used,error};
  if(quote)throw Error('Close the quoted filter value.');
  query=input.slice(0,boundaries[0].start).trim();
  for(let i=0;i<boundaries.length;i++){
   const token=boundaries[i],command=searchCommands.find(c=>c.name===token.name||c.aliases?.includes(token.name));
   if(!command)throw Error(`Unknown command /${token.name}. Type / to see available commands.`);
   let value=input.slice(token.end,boundaries[i+1]?.start??input.length).trim();
   if(!value)throw Error(`Enter a value after /${token.name}.`);
   if(value.startsWith('"')||value.startsWith("'")){const q=value[0];if(value.at(-1)!==q)throw Error(`Quote the full value after /${token.name}.`);value=value.slice(1,-1).replace(/\\(["'\\])/g,'$1');}
   if(!value.trim())throw Error(`Enter a value after /${token.name}.`);
   used.push('/'+command.name);
   try{
    if(command.name==='age'){
     const range=value.match(/^(\d+)-(\d+)$/),comparison=value.match(/^(>=|<=|>|<|=)?\s*(\d+)$/);
     if(range){const low=integer(range[1],0,130),high=integer(range[2],low,130);rules.push({field:'age',operator:'gte',value:String(low)},{field:'age',operator:'lte',value:String(high)});}
     else if(comparison){rules.push({field:'age',operator:({'>=':'gte','<=':'lte','>':'gt','<':'lt','=':'eq'} as Record<string,string>)[comparison[1]||'='],value:String(integer(comparison[2],0,130))});}
     else throw Error('Use an age, range, or comparison, such as 25, 18-30, or >=18.');
    }else if(command.setting){
     let next:any=value;
     if(command.setting==='searchQueryType'&&!types.includes(value))throw Error('Choose '+types.join(', ')+'.');
     if(command.setting==='oathFamily'&&!['both','breach','stealer'].includes(value))throw Error('Use both, breach, or stealer.');
     if(command.setting==='page')next=integer(value,1,1000000);
     if(command.setting==='pageSize'){next=integer(value,10,100);if(![10,20,50,100].includes(next))throw Error('Use 10, 20, 50, or 100.');}
     if(['flexible','oathProfiles'].includes(command.setting))next=bool(value);
     if(command.setting==='oathProfileServices'){next=value.split(',').map(v=>v.trim());if(next.some((v:string)=>!['discord','steam','xbox','roblox'].includes(v)))throw Error('Use discord, steam, xbox, or roblox.');}
     settings[command.setting]=next;
    }else if(command.option){settings.oathOptions[command.option]=['wildcard','has_log_id'].includes(command.option)?bool(value):value;}
    else if(command.username){settings.usernameSearchOptions[command.username]=['limit','concurrency'].includes(command.username)?value===(command.username==='limit'?'all':'max')?value:integer(value,1,command.username==='limit'?100000:100):value;}
    else{
     if(command.brix)settings.brixFilters[command.brix]=value;
     if(command.name==='name')settings.brixNameSearch=value;
     if(command.oath){const prior=used.slice(0,-1).includes('/'+command.name)?settings.oathFilters[command.oath]:[];settings.oathFilters[command.oath]=[...(Array.isArray(prior)?prior:[]),value];}
    }
   }catch(e){throw Error(`/${token.name}: ${e instanceof Error?e.message:String(e)}`);}
  }
  if(rules.length){const existing=settings.oathFilters.filter;settings.oathFilters.filter=existing&&Object.keys(existing).length?{and:[existing,...rules]}:rules.length===1?rules[0]:{and:rules};}
 }catch(e){error=e instanceof Error?e.message:String(e);}
 return {query,settings,used,error};
}
