import {useEffect,useState} from 'react';
import './search-query.css';
import {searchCommands} from './searchCommands';

export function SearchCommandHelp({query,onQuery,disabled,error,used,providers}:{query:string;onQuery:(value:string)=>void;disabled:boolean;error:string;used:string[];providers:string[]}){
 const [selected,setSelected]=useState(0),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{setSelected(0);setDismissed(false)},[query]);
 const partial=query.match(/(?:^|\s)\/([\w-]*)$/);
 const suggestions=partial?searchCommands.filter(c=>c.name.startsWith(partial[1].toLowerCase().replace(/-/g,'_'))):[];
 const scoped=[...new Set(used)].flatMap(name=>{
  const c=searchCommands.find(c=>'/'+c.name===name)!;
  const supported=c.brix||c.oath?[...(c.brix?['brixhub']:[]),...(c.oath?['oathnet']:[])]:c.name==='age'||c.option?['oathnet']:c.username?['whatsmyname']:[];
  if(!supported.length)return [];
  const label=supported.map(p=>p==='brixhub'?'BrixHub':p==='oathnet'?'OathNet':'Username search').join(' / ');
  return !supported.some(p=>providers.includes(p))?[`${name} needs ${label}.`]:supported.length===1?[`${name}: ${label} only.`]:[];
 });
 function insert(name:string){onQuery(partial?query.slice(0,query.lastIndexOf('/'))+'/'+name+' ':query+(query&&!/\s$/.test(query)?' ':'')+'/'+name+' ');requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.search-box input')?.focus());}
 useEffect(()=>{
  if(!suggestions.length||dismissed||disabled)return;
  const handle=(event:KeyboardEvent)=>{
   if(!(event.target instanceof HTMLInputElement)||!event.target.matches('.search-box input')||event.isComposing)return;
   if(!['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)||event.shiftKey)return;
   event.preventDefault();event.stopPropagation();
   if(event.key==='Escape'){setDismissed(true);return;}
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){setSelected(index=>(index+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length);return;}
   insert(suggestions[Math.min(selected,suggestions.length-1)].name);
  };
  window.addEventListener('keydown',handle,true);
  document.getElementById('search-command-'+suggestions[Math.min(selected,suggestions.length-1)].name)?.scrollIntoView({block:'nearest'});
  return()=>window.removeEventListener('keydown',handle,true);
 },[query,selected,dismissed,disabled]);
 return <div className="search-command-help">
  {!dismissed&&suggestions.length>0&&<div className="search-command-suggestions" aria-label="Slash command suggestions"><div className="search-command-heading"><span>SEARCH COMMANDS</span><small><kbd>Enter</kbd> Select <kbd>Esc</kbd> Close</small></div><div className="search-command-rows">{suggestions.map((c,index)=><button type="button" id={'search-command-'+c.name} className={index===selected?'command-selected':''} key={c.name} disabled={disabled} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setSelected(index)} onClick={()=>insert(c.name)}><span className="search-command-icon" aria-hidden="true">/</span><b>/{c.name}</b><small>{c.hint}</small><span className="search-command-enter" aria-hidden="true"><kbd>Enter</kbd></span></button>)}</div></div>}
  <div id="search-command-status" role="status">{error?<span className="query-detection error">{error}</span>:used.length>0?<small>{[...new Set(used)].join(' · ')} · Applied to this search</small>:null}</div>
  {!error&&scoped.length>0&&<p role="status">{scoped.join(' ')}</p>}

 </div>;
}

const types=[['auto','Auto detect'],['email','Email'],['phone','Phone number'],['discord','Discord ID'],['steam','Steam ID'],['address','Street address'],['name','Full name'],['first_name','First name'],['last_name','Last name'],['username','Username'],['ip','IP address'],['domain','Domain'],['roblox','Roblox ID'],['text','Text']];
export function activeSearchFilters(settings:Record<string,any>,providers:string[]){
 const active:string[]=[];
 for(const [provider,key] of [['brixhub','brixFilters'],['oathnet','oathFilters'],['oathnet','oathOptions']]){
  if(!providers.includes(provider))continue;
  for(const [field,value] of Object.entries(settings[key]||{})){
   if(value==null||value===''||Array.isArray(value)&&!value.length||typeof value==='object'&&!Object.keys(value).length)continue;
   active.push(`${provider==='brixhub'?'BrixHub':'OathNet'} · ${field.replace(/_/g,' ')}: ${typeof value==='object'?JSON.stringify(value):String(value)}`);
  }
 }
 if(providers.includes('brixhub')&&Number(settings.page)>1)active.push('BrixHub · page: '+settings.page);
 if(providers.includes('oathnet')&&settings.cursor)active.push('OathNet · next page cursor');
 return active;
}
type TypeProps={query:string;type:string;onType:(value:string)=>void;disabled:boolean};
export function SearchTypeSelector({query,type,onType,disabled}:TypeProps){
 const [info,setInfo]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  let stale=false;setInfo('');setError('');
  if(!query.trim()||!window.h3x.inspectQuery)return;
  window.h3x.inspectQuery(query,type).then(value=>{if(!stale)setInfo(value.label)}).catch(e=>{if(!stale)setError(e instanceof Error?e.message:String(e))});
  return()=>{stale=true};
 },[query,type]);
 return <div className="search-type-selector"><select aria-label="Search type" title={error||'Search type'} value={type} disabled={disabled} onChange={e=>onType(e.target.value)}>{types.map(([id,label])=><option key={id} value={id}>{id==='auto'&&info?'Auto: '+info:label}</option>)}</select>{error&&<span className="query-detection error" role="status">{error}</span>}</div>;
}
type Props={providers:string[];settings:Record<string,any>};
export default function SearchQueryControls({providers,settings}:Props){
 const active=activeSearchFilters(settings,providers);
 if(!active.length)return null;
 return <div className="search-query-controls"><div className="active-search-filters" aria-label="Active search filters">{active.map((label,index)=><span key={index} title={label}>{label}</span>)}</div></div>;
}
